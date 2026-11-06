/**
 * Direct solver for the uniform 2D five-point Poisson operator with zero
 * Dirichlet boundary values. It diagonalizes the operator with a DST-I basis.
 *
 * Performance notes: the four separable DST-I passes share a single tight
 * kernel. The sine basis is pre-split at construction into even-mode and
 * odd-mode tables (even modes only see pair sums, odd modes only pair
 * differences), so the inner loops are branch-free, typed-array-friendly,
 * and unrolled by four accumulators for instruction-level parallelism.
 */
'use strict';

/**
 * One separable DST-I pass over an n x n matrix.
 *
 * For every outer row, gather the symmetric pair sums/differences of that
 * row, then contract them against the precomputed even/odd basis tables.
 * Even output modes use the pair sums; odd output modes use the pair
 * differences. The center sample (odd n) is handled as a fused tail term.
 *
 * @param {Float64Array} src  n x n input (row-major on the outer axis).
 * @param {Float64Array} dst  n x n output.
 * @param {number} n          grid size.
 * @param {number} pairCount  number of symmetric pairs (floor(n / 2)).
 * @param {number} evenCount  number of even modes (ceil(n / 2)).
 * @param {number} oddCount   number of odd modes (floor(n / 2)).
 * @param {Float64Array} evenBasis  evenCount x pairCount basis rows.
 * @param {Float64Array} oddBasis   oddCount x pairCount basis rows.
 * @param {Float64Array|null} centerWeights  per-mode center basis entries.
 * @param {boolean} hasCenter  true when n is odd.
 * @param {number} scale       post-transform scale factor.
 * @param {boolean} transposedOut  write dst[mode * n + outer] instead of
 *                                 dst[outer * n + mode].
 * @param {Float64Array|null} eigenValues  when set, divide each output by
 *                                         eigenValues[outer] + eigenValues[mode].
 * @param {Float64Array} pairSums       scratch, length pairCount.
 * @param {Float64Array} pairDifferences  scratch, length pairCount.
 */
function applyDstPass(
  src,
  dst,
  n,
  pairCount,
  evenCount,
  oddCount,
  evenBasis,
  oddBasis,
  centerWeights,
  hasCenter,
  scale,
  transposedOut,
  eigenValues,
  pairSums,
  pairDifferences
) {
  const mainWidth = pairCount & ~3;
  const useEigenDivisor = eigenValues !== null;
  const centerWeight = hasCenter ? centerWeights : null;

  for (let outer = 0; outer < n; outer++) {
    const outerBase = outer * n;
    let mirrored = n - 1;
    for (let x = 0; x < pairCount; x++, mirrored--) {
      const leftValue = src[outerBase + x];
      const rightValue = src[outerBase + mirrored];
      pairSums[x] = leftValue + rightValue;
      pairDifferences[x] = leftValue - rightValue;
    }
    const centerValue = hasCenter ? src[outerBase + pairCount] : 0;

    let evenRow = 0;
    for (let r = 0; r < evenCount; r++, evenRow += pairCount) {
      let sum0 = 0;
      let sum1 = 0;
      let sum2 = 0;
      let sum3 = 0;
      let x = 0;
      for (; x < mainWidth; x += 4) {
        sum0 += pairSums[x] * evenBasis[evenRow + x];
        sum1 += pairSums[x + 1] * evenBasis[evenRow + x + 1];
        sum2 += pairSums[x + 2] * evenBasis[evenRow + x + 2];
        sum3 += pairSums[x + 3] * evenBasis[evenRow + x + 3];
      }
      for (; x < pairCount; x++) sum0 += pairSums[x] * evenBasis[evenRow + x];
      let sum = sum0 + sum1 + (sum2 + sum3);
      const mode = 2 * r;
      if (centerWeight !== null) sum += centerValue * centerWeight[mode];
      if (useEigenDivisor) sum /= eigenValues[outer] + eigenValues[mode];
      dst[transposedOut ? mode * n + outer : outerBase + mode] = sum * scale;
    }

    let oddRow = 0;
    for (let r = 0; r < oddCount; r++, oddRow += pairCount) {
      let sum0 = 0;
      let sum1 = 0;
      let sum2 = 0;
      let sum3 = 0;
      let x = 0;
      for (; x < mainWidth; x += 4) {
        sum0 += pairDifferences[x] * oddBasis[oddRow + x];
        sum1 += pairDifferences[x + 1] * oddBasis[oddRow + x + 1];
        sum2 += pairDifferences[x + 2] * oddBasis[oddRow + x + 2];
        sum3 += pairDifferences[x + 3] * oddBasis[oddRow + x + 3];
      }
      for (; x < pairCount; x++) sum0 += pairDifferences[x] * oddBasis[oddRow + x];
      let sum = sum0 + sum1 + (sum2 + sum3);
      const mode = 2 * r + 1;
      if (centerWeight !== null) sum += centerValue * centerWeight[mode];
      if (useEigenDivisor) sum /= eigenValues[outer] + eigenValues[mode];
      dst[transposedOut ? mode * n + outer : outerBase + mode] = sum * scale;
    }
  }
}

class Poisson2DDirichletDirectSolver {
  constructor(gridSize) {
    if (!Number.isInteger(gridSize) || gridSize < 1) {
      throw new RangeError('gridSize must be a positive integer.');
    }

    this.gridSize = gridSize;
    this.dimension = gridSize * gridSize;
    this.scale = 2 / (gridSize + 1);
    this.sineBasis = new Float64Array(this.dimension);
    this.oneDimensionalEigenvalues = new Float64Array(gridSize);

    const pairCount = Math.floor(gridSize / 2);
    const evenCount = Math.ceil(gridSize / 2);
    const oddCount = Math.floor(gridSize / 2);
    this._pairCount = pairCount;
    this._evenCount = evenCount;
    this._oddCount = oddCount;
    this._hasCenter = gridSize % 2 !== 0;
    this._evenBasis = new Float64Array(evenCount * pairCount);
    this._oddBasis = new Float64Array(oddCount * pairCount);
    this._centerWeights = new Float64Array(gridSize);

    for (let mode = 0; mode < gridSize; mode++) {
      const modeBasisRow = mode * gridSize;
      for (let point = mode; point < gridSize; point++) {
        const value = Math.sin((Math.PI * (mode + 1) * (point + 1)) / (gridSize + 1));
        this.sineBasis[modeBasisRow + point] = value;
        this.sineBasis[point * gridSize + mode] = value;
      }
      this.oneDimensionalEigenvalues[mode] = 2 - 2 * Math.cos((Math.PI * (mode + 1)) / (gridSize + 1));
    }

    for (let mode = 0; mode < gridSize; mode++) {
      const modeBasisRow = mode * gridSize;
      if (mode % 2 === 0) {
        const evenRow = (mode / 2) * pairCount;
        for (let x = 0; x < pairCount; x++) {
          this._evenBasis[evenRow + x] = this.sineBasis[modeBasisRow + x];
        }
      } else {
        const oddRow = ((mode - 1) / 2) * pairCount;
        for (let x = 0; x < pairCount; x++) {
          this._oddBasis[oddRow + x] = this.sineBasis[modeBasisRow + x];
        }
      }
      this._centerWeights[mode] = this.sineBasis[modeBasisRow + pairCount];
    }
  }

  solve(rhs) {
    const gridSize = this.gridSize;
    const dimension = this.dimension;
    if (!rhs || rhs.length !== dimension) {
      throw new RangeError(`rhs must contain exactly ${dimension} finite values.`);
    }

    for (let i = 0; i < dimension; i++) {
      if (!Number.isFinite(rhs[i])) throw new TypeError(`rhs[${i}] must be finite.`);
    }

    const pairCount = this._pairCount;
    const evenCount = this._evenCount;
    const oddCount = this._oddCount;
    const hasCenter = this._hasCenter;
    const scale = this.scale;
    const firstTransform = new Float64Array(dimension);
    const spectralCoefficients = new Float64Array(dimension);
    const inverseY = new Float64Array(dimension);
    const solution = new Float64Array(dimension);
    const pairSums = new Float64Array(pairCount);
    const pairDifferences = new Float64Array(pairCount);
    const evenBasis = this._evenBasis;
    const oddBasis = this._oddBasis;
    const centerWeights = hasCenter ? this._centerWeights : null;
    const eigenvalues = this.oneDimensionalEigenvalues;

    // Apply the DST-I in x and transpose so each y transform reads contiguous data.
    applyDstPass(
      rhs,
      firstTransform,
      gridSize,
      pairCount,
      evenCount,
      oddCount,
      evenBasis,
      oddBasis,
      centerWeights,
      hasCenter,
      1,
      true,
      null,
      pairSums,
      pairDifferences
    );

    // Apply the DST-I in y and divide by the exact eigenvalues of the stencil.
    applyDstPass(
      firstTransform,
      spectralCoefficients,
      gridSize,
      pairCount,
      evenCount,
      oddCount,
      evenBasis,
      oddBasis,
      centerWeights,
      hasCenter,
      1,
      false,
      eigenvalues,
      pairSums,
      pairDifferences
    );

    // Invert y, then x. DST-I is self-inverse up to the scale factor above.
    applyDstPass(
      spectralCoefficients,
      inverseY,
      gridSize,
      pairCount,
      evenCount,
      oddCount,
      evenBasis,
      oddBasis,
      centerWeights,
      hasCenter,
      scale,
      true,
      null,
      pairSums,
      pairDifferences
    );

    applyDstPass(
      inverseY,
      solution,
      gridSize,
      pairCount,
      evenCount,
      oddCount,
      evenBasis,
      oddBasis,
      centerWeights,
      hasCenter,
      scale,
      false,
      null,
      pairSums,
      pairDifferences
    );

    let residualSquared = 0;
    let rhsSquared = 0;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const i = y * gridSize + x;
        let value = 4 * solution[i];
        if (x > 0) value -= solution[i - 1];
        if (x + 1 < gridSize) value -= solution[i + 1];
        if (y > 0) value -= solution[i - gridSize];
        if (y + 1 < gridSize) value -= solution[i + gridSize];
        const residual = rhs[i] - value;
        residualSquared += residual * residual;
        rhsSquared += rhs[i] * rhs[i];
      }
    }

    const residualNorm = Math.sqrt(residualSquared);
    const relativeResidual = residualNorm / (Math.sqrt(rhsSquared) || 1);
    return {
      solution,
      dimension,
      gridSize,
      solverMethod: '2d-poisson-dst1',
      residualNorm,
      relativeResidual,
      converged: relativeResidual < 1e-8
    };
  }
}

module.exports = { Poisson2DDirichletDirectSolver };
