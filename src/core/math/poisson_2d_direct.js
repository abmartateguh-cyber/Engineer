/**
 * Direct solver for the uniform 2D five-point Poisson operator with zero
 * Dirichlet boundary values. It diagonalizes the operator with a DST-I basis.
 */
'use strict';

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

    for (let mode = 0; mode < gridSize; mode++) {
      for (let point = mode; point < gridSize; point++) {
        const value = Math.sin((Math.PI * (mode + 1) * (point + 1)) / (gridSize + 1));
        this.sineBasis[mode * gridSize + point] = value;
        this.sineBasis[point * gridSize + mode] = value;
      }
      this.oneDimensionalEigenvalues[mode] = 2 - 2 * Math.cos((Math.PI * (mode + 1)) / (gridSize + 1));
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

    const sineBasis = this.sineBasis;
    const eigenvalues = this.oneDimensionalEigenvalues;
    const firstTransform = new Float64Array(dimension);
    const spectralCoefficients = new Float64Array(dimension);
    const inverseY = new Float64Array(dimension);
    const solution = new Float64Array(dimension);
    const pairCount = Math.floor(gridSize / 2);
    const hasCenter = gridSize % 2 !== 0;
    const pairSums = new Float64Array(pairCount);
    const pairDifferences = new Float64Array(pairCount);

    // Apply the DST-I in x and transpose so each y transform reads contiguous data.
    for (let y = 0; y < gridSize; y++) {
      const rowBase = y * gridSize;
      let mirroredX = gridSize - 1;
      for (let x = 0; x < pairCount; x++, mirroredX--) {
        const leftValue = rhs[rowBase + x];
        const rightValue = rhs[rowBase + mirroredX];
        pairSums[x] = leftValue + rightValue;
        pairDifferences[x] = leftValue - rightValue;
      }

      for (let modeX = 0; modeX < gridSize; modeX++) {
        const basisBase = modeX * gridSize;
        const positiveParity = modeX % 2 === 0;
        let sum = 0;
        if (positiveParity) {
          for (let x = 0; x < pairCount; x++) sum += pairSums[x] * sineBasis[basisBase + x];
        } else {
          for (let x = 0; x < pairCount; x++) sum += pairDifferences[x] * sineBasis[basisBase + x];
        }
        if (hasCenter) {
          const center = pairCount;
          sum += rhs[rowBase + center] * sineBasis[basisBase + center];
        }
        firstTransform[basisBase + y] = sum;
      }
    }

    // Apply the DST-I in y and divide by the exact eigenvalues of the stencil.
    for (let modeX = 0; modeX < gridSize; modeX++) {
      const transformBase = modeX * gridSize;
      let mirroredY = gridSize - 1;
      for (let y = 0; y < pairCount; y++, mirroredY--) {
        const topValue = firstTransform[transformBase + y];
        const bottomValue = firstTransform[transformBase + mirroredY];
        pairSums[y] = topValue + bottomValue;
        pairDifferences[y] = topValue - bottomValue;
      }

      for (let modeY = 0; modeY < gridSize; modeY++) {
        const basisBase = modeY * gridSize;
        const positiveParity = modeY % 2 === 0;
        let sum = 0;
        if (positiveParity) {
          for (let y = 0; y < pairCount; y++) sum += pairSums[y] * sineBasis[basisBase + y];
        } else {
          for (let y = 0; y < pairCount; y++) sum += pairDifferences[y] * sineBasis[basisBase + y];
        }
        if (hasCenter) {
          const center = pairCount;
          sum += firstTransform[transformBase + center] * sineBasis[basisBase + center];
        }
        spectralCoefficients[transformBase + modeY] = sum / (eigenvalues[modeX] + eigenvalues[modeY]);
      }
    }

    // Invert y, then x. DST-I is self-inverse up to the scale factor above.
    // Its sine basis is symmetric, so read the basis in row-major order during
    // the inverse passes instead of striding through columns.
    for (let modeX = 0; modeX < gridSize; modeX++) {
      const coefficientBase = modeX * gridSize;
      let mirroredModeY = gridSize - 1;
      for (let modeY = 0; modeY < pairCount; modeY++, mirroredModeY--) {
        const lowMode = spectralCoefficients[coefficientBase + modeY];
        const highMode = spectralCoefficients[coefficientBase + mirroredModeY];
        pairSums[modeY] = lowMode + highMode;
        pairDifferences[modeY] = lowMode - highMode;
      }

      for (let y = 0; y < gridSize; y++) {
        const positiveParity = y % 2 === 0;
        let sum = 0;
        const basisBase = y * gridSize;
        const pairs = positiveParity ? pairSums : pairDifferences;
        for (let modeY = 0; modeY < pairCount; modeY++) sum += pairs[modeY] * sineBasis[basisBase + modeY];
        if (hasCenter) {
          const center = pairCount;
          sum += spectralCoefficients[coefficientBase + center] * sineBasis[basisBase + center];
        }
        inverseY[y * gridSize + modeX] = sum * this.scale;
      }
    }

    for (let y = 0; y < gridSize; y++) {
      const rowBase = y * gridSize;
      let mirroredModeX = gridSize - 1;
      for (let modeX = 0; modeX < pairCount; modeX++, mirroredModeX--) {
        const leftMode = inverseY[rowBase + modeX];
        const rightMode = inverseY[rowBase + mirroredModeX];
        pairSums[modeX] = leftMode + rightMode;
        pairDifferences[modeX] = leftMode - rightMode;
      }

      for (let x = 0; x < gridSize; x++) {
        const positiveParity = x % 2 === 0;
        let sum = 0;
        const basisBase = x * gridSize;
        const pairs = positiveParity ? pairSums : pairDifferences;
        for (let modeX = 0; modeX < pairCount; modeX++) sum += pairs[modeX] * sineBasis[basisBase + modeX];
        if (hasCenter) {
          const center = pairCount;
          sum += inverseY[rowBase + center] * sineBasis[basisBase + center];
        }
        solution[rowBase + x] = sum * this.scale;
      }
    }

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
