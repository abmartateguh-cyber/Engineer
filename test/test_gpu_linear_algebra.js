/**
 * Test Suite: GPULinearAlgebra (WGSL SpMV & Dot Product)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GPULinearAlgebra } = require('../src/core/math/gpu_linear_algebra');

test('GPULinearAlgebra: Evaluates CSR SpMV accurately matching direct product', () => {
  const gpu = new GPULinearAlgebra();

  // 3x3 matrix:
  // [ 2, -1,  0 ]
  // [-1,  2, -1 ]
  // [ 0, -1,  2 ]
  const rowPtr = new Int32Array([0, 2, 5, 7]);
  const colIdx = new Int32Array([0, 1, 0, 1, 2, 1, 2]);
  const values = new Float64Array([2.0, -1.0, -1.0, 2.0, -1.0, -1.0, 2.0]);
  const x = new Float64Array([1.0, 2.0, 3.0]);

  // Expected y = A * x:
  // y[0] = 2*1 - 1*2 + 0 = 0
  // y[1] = -1*1 + 2*2 - 1*3 = 0
  // y[2] = 0*1 - 1*2 + 2*3 = 4
  const y = gpu.multiplySpMV(rowPtr, colIdx, values, x);

  assert.equal(y.length, 3, 'Output vector must have 3 rows');
  assert.ok(Math.abs(y[0] - 0.0) < 1e-12, 'y[0] must be 0');
  assert.ok(Math.abs(y[1] - 0.0) < 1e-12, 'y[1] must be 0');
  assert.ok(Math.abs(y[2] - 4.0) < 1e-12, 'y[2] must be 4');
});

test('GPULinearAlgebra: Vector dot product and WGSL shader verification', () => {
  const gpu = new GPULinearAlgebra();
  const a = new Float64Array([1, 2, 3]);
  const b = new Float64Array([4, 5, 6]);

  const dot = gpu.dotProduct(a, b);
  assert.equal(dot, 1*4 + 2*5 + 3*6, 'Dot product must equal 32');

  const shader = gpu.getShaderSource();
  assert.ok(shader.includes('@compute'), 'Shader must contain compute entry point');
  assert.ok(shader.includes('@workgroup_size(64)'), 'Shader must define workgroup size');
});
