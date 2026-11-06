/**
 * OmniEng Native Accelerator Interface
 * 
 * Selects available native-addon, WebAssembly and JavaScript typed-array kernels.
 * Backend selection is reported; relative performance has not been measured.
 */

'use strict';

const { WasmKernelEngine } = require('./wasm_kernel_engine');

class NativeAcceleratorInterface {
  constructor() {
    this.activeTier = 'js_typedarrays';
    this.nativeModule = null;
    this.wasmInstance = null;
    this.wasmEngine = null;
    this.hardwareAccelerationFactor = null;
    this._initializeBackend();
  }

  _initializeBackend() {
    // Attempt Tier 1: Native C++ Addon
    try {
      this.nativeModule = require('../../../build/Release/omnieng_native.node');
      this.activeTier = 'native_napi';
      return;
    } catch (e) {
      // Native addon not compiled; gracefully continue to Tier 2
    }

    // Attempt Tier 2: Real Bare-Metal WebAssembly Kernels with SIMD128
    try {
      this.wasmEngine = new WasmKernelEngine();
      this.wasmEngine.initSync();
      this.wasmInstance = this.wasmEngine.instance;
      this.activeTier = this.wasmEngine.isSimdAvailable ? 'wasm_simd128' : 'wasm_scalar';
    } catch (e) {
      this.activeTier = 'js_typedarrays_optimized';
    }

  }

  /**
   * General Matrix Multiplication: C = alpha * A * B + beta * C
   * Uses block-tiled cache optimization with loop unrolling.
   * @param {number} M Number of rows of A and C
   * @param {number} N Number of columns of B and C
   * @param {number} K Number of columns of A and rows of B
   * @param {number} alpha Scalar multiplier for A*B
   * @param {Float64Array} A Flattened row-major M x K matrix
   * @param {Float64Array} B Flattened row-major K x N matrix
   * @param {number} beta Scalar multiplier for C
   * @param {Float64Array} C Flattened row-major M x N matrix
   * @returns {Float64Array} Result matrix C
   */
  gemm(M, N, K, alpha, A, B, beta, C) {
    if (this.activeTier === 'native_napi' && this.nativeModule.gemm) {
      return this.nativeModule.gemm(M, N, K, alpha, A, B, beta, C);
    }

    // Cache-friendly blocked matrix multiplication (Tier 2 / Tier 3)
    const BLOCK = 32;

    // Apply beta scale
    if (beta === 0.0) {
      C.fill(0);
    } else if (beta !== 1.0) {
      for (let i = 0; i < M * N; i++) {
        C[i] *= beta;
      }
    }

    // Tiled matrix multiplication for L1/L2 cache locality
    for (let ii = 0; ii < M; ii += BLOCK) {
      const imax = Math.min(ii + BLOCK, M);
      for (let kk = 0; kk < K; kk += BLOCK) {
        const kmax = Math.min(kk + BLOCK, K);
        for (let jj = 0; jj < N; jj += BLOCK) {
          const jmax = Math.min(jj + BLOCK, N);

          for (let i = ii; i < imax; i++) {
            const iOffset = i * K;
            const cOffset = i * N;
            for (let k = kk; k < kmax; k++) {
              const aVal = alpha * A[iOffset + k];
              if (aVal === 0.0) continue;
              const bOffset = k * N;
              // 4x unrolled inner loop
              let j = jj;
              for (; j <= jmax - 4; j += 4) {
                C[cOffset + j]     += aVal * B[bOffset + j];
                C[cOffset + j + 1] += aVal * B[bOffset + j + 1];
                C[cOffset + j + 2] += aVal * B[bOffset + j + 2];
                C[cOffset + j + 3] += aVal * B[bOffset + j + 3];
              }
              for (; j < jmax; j++) {
                C[cOffset + j] += aVal * B[bOffset + j];
              }
            }
          }

        }
      }
    }

    return C;
  }

  /**
   * Sparse Matrix-Vector Multiplication: y = A * x
   * @param {{rows: number, cols: number, rowPtr: Int32Array, colInd: Int32Array, values: Float64Array}} csr 
   * @param {Float64Array} x 
   * @param {Float64Array} y Output vector
   * @returns {Float64Array}
   */
  spmv(csr, x, y = null) {
    const rows = csr.rows;
    if (!y) y = new Float64Array(rows);

    if (this.wasmEngine && this.wasmEngine.isReady) {
      this.wasmEngine.spmv(csr.rowPtr, csr.colInd, csr.values, x, y, rows);
      return y;
    }

    const rowPtr = csr.rowPtr;
    const colInd = csr.colInd;
    const values = csr.values;

    for (let i = 0; i < rows; i++) {
      let sum = 0.0;
      const start = rowPtr[i];
      const end = rowPtr[i + 1];
      for (let p = start; p < end; p++) {
        sum += values[p] * x[colInd[p]];
      }
      y[i] = sum;
    }
    return y;
  }

  /**
   * Vector dot product with WebAssembly acceleration & loop unrolling fallback
   * @param {Float64Array} a 
   * @param {Float64Array} b 
   * @returns {number}
   */
  dot(a, b) {
    if (this.wasmEngine && this.wasmEngine.isReady) {
      return this.wasmEngine.dotProduct(a, b);
    }

    const n = Math.min(a.length, b.length);
    let sum = 0.0;
    let i = 0;
    for (; i <= n - 4; i += 4) {
      sum += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
    }
    for (; i < n; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Vector AXPY: y = alpha * x + y with WebAssembly acceleration
   * @param {number} alpha 
   * @param {Float64Array} x 
   * @param {Float64Array} y 
   */
  axpy(alpha, x, y) {
    if (this.wasmEngine && this.wasmEngine.isReady) {
      this.wasmEngine.daxpy(x, y, alpha);
      return y;
    }

    const n = Math.min(x.length, y.length);
    let i = 0;
    for (; i <= n - 4; i += 4) {
      y[i]     += alpha * x[i];
      y[i + 1] += alpha * x[i + 1];
      y[i + 2] += alpha * x[i + 2];
      y[i + 3] += alpha * x[i + 3];
    }
    for (; i < n; i++) {
      y[i] += alpha * x[i];
    }
    return y;
  }

  /**
   * Diagnostic backend information
   */
  getBackendInfo() {
    return {
      activeTier: this.activeTier,
      isNativeAccelerated: this.activeTier === 'native_napi',
      isWasmSimd: this.activeTier === 'wasm_simd128',
      hardwareAccelerationFactor: null,
      isMeasuredBenchmark: false,
      performanceEvidence: 'not measured',
      optimizationStrategy: 'backend-selected kernels; relative performance not measured',
      simdCapabilities: typeof WebAssembly !== 'undefined' ? ['WASM-SIMD128-Ready', 'TypedArray-F64'] : ['TypedArray-F64']
    };
  }
}

// Global singleton instance
const accelerator = new NativeAcceleratorInterface();

module.exports = { NativeAcceleratorInterface, accelerator };
