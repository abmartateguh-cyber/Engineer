/**
 * Verification case for the production uniform-grid Poisson solver path.
 * The analytical solution and predeclared tolerances live in a separate,
 * versioned reference artifact. This is numerical verification, not physical
 * validation against measurements.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

const REFERENCE_PATH = path.join(__dirname, 'references', 'poisson_2d_sine_mms.json');
const REFERENCE_SHA256 = 'dbcbd4383a4a5e0b8109ada9a57bc117c298675da2c2f44cc5e268b2cf209204';

function loadReference() {
  const bytes = fs.readFileSync(REFERENCE_PATH);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== REFERENCE_SHA256) {
    throw new Error(`Poisson manufactured-solution reference checksum mismatch: ${sha256}`);
  }
  const reference = JSON.parse(bytes.toString('utf8'));
  if (
    reference.id !== 'POISSON_2D_SINE_MMS' ||
    reference.formatVersion !== 1 ||
    !Array.isArray(reference.gridSizes) ||
    reference.gridSizes.length < 3 ||
    !reference.tolerances ||
    !Array.isArray(reference.tolerances.observedOrderRange) ||
    reference.tolerances.observedOrderRange.length !== 2
  ) {
    throw new TypeError('Poisson manufactured-solution reference artifact has an invalid schema.');
  }
  return { reference, sha256 };
}

function solveGrid(gridSize) {
  const unknowns = gridSize * gridSize;
  const spacing = 1 / (gridSize + 1);
  const matrix = new WasmSparseMultifrontalSolver(unknowns, unknowns);
  const rhs = new Float64Array(unknowns);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const index = y * gridSize + x;
      matrix.addEntry(index, index, 4);
      if (x > 0) matrix.addEntry(index, index - 1, -1);
      if (x + 1 < gridSize) matrix.addEntry(index, index + 1, -1);
      if (y > 0) matrix.addEntry(index, index - gridSize, -1);
      if (y + 1 < gridSize) matrix.addEntry(index, index + gridSize, -1);

      const xPosition = (x + 1) * spacing;
      const yPosition = (y + 1) * spacing;
      rhs[index] = spacing ** 2 * 2 * Math.PI ** 2 * Math.sin(Math.PI * xPosition) * Math.sin(Math.PI * yPosition);
    }
  }

  const factorization = matrix.factorize();
  const result = matrix.solve(rhs);
  let errorSquared = 0;
  let residualSquared = 0;
  let rhsSquared = 0;

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const index = y * gridSize + x;
      const numerical = result.solution[index];
      const exact = Math.sin(Math.PI * (x + 1) * spacing) * Math.sin(Math.PI * (y + 1) * spacing);
      errorSquared += (numerical - exact) ** 2;

      let applied = 4 * numerical;
      if (x > 0) applied -= result.solution[index - 1];
      if (x + 1 < gridSize) applied -= result.solution[index + 1];
      if (y > 0) applied -= result.solution[index - gridSize];
      if (y + 1 < gridSize) applied -= result.solution[index + gridSize];
      residualSquared += (rhs[index] - applied) ** 2;
      rhsSquared += rhs[index] ** 2;
    }
  }

  return {
    gridSize,
    spacing,
    solverMethod: factorization.solverMethod,
    rmsError: Math.sqrt(errorSquared / unknowns),
    independentRelativeResidual: Math.sqrt(residualSquared / rhsSquared),
    solverRelativeResidual: result.relativeResidual,
    solverConverged: result.converged
  };
}

function runPoissonManufacturedSolution() {
  const { reference, sha256 } = loadReference();
  const gridResults = reference.gridSizes.map(solveGrid);
  const observedOrders = [];

  for (let index = 1; index < gridResults.length; index++) {
    const coarse = gridResults[index - 1];
    const fine = gridResults[index];
    observedOrders.push(Math.log(coarse.rmsError / fine.rmsError) / Math.log(coarse.spacing / fine.spacing));
  }

  const [minimumOrder, maximumOrder] = reference.tolerances.observedOrderRange;
  const allResidualsPass = gridResults.every(
    (result) =>
      Number.isFinite(result.independentRelativeResidual) &&
      result.independentRelativeResidual <= reference.tolerances.maximumRelativeResidual
  );
  const errorsDecrease = gridResults.every(
    (result, index) => index === 0 || result.rmsError < gridResults[index - 1].rmsError
  );
  const ordersPass = observedOrders.every((order) => order >= minimumOrder && order <= maximumOrder);
  const methodsPass = gridResults.every((result) => result.solverMethod === '2d-poisson-dst1');
  const internalReportsPass = gridResults.every(
    (result) =>
      result.solverConverged &&
      Number.isFinite(result.solverRelativeResidual) &&
      Math.abs(result.solverRelativeResidual - result.independentRelativeResidual) <= 1e-8
  );
  const passed = allResidualsPass && errorsDecrease && ordersPass && methodsPass && internalReportsPass;

  return {
    id: reference.id,
    name: reference.name,
    targetValue: `${minimumOrder} to ${maximumOrder}`,
    calculatedValue: observedOrders.map((order) => order.toFixed(4)).join(', '),
    units: 'observed order',
    errorPercent: null,
    tolerancePercent: null,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Poisson manufactured-solution convergence or residual criteria failed.',
    metadata: {
      referenceArtifact: path.relative(__dirname, REFERENCE_PATH),
      referenceArtifactSha256: sha256,
      referenceKind: reference.referenceKind,
      solverExecuted: true,
      solverMethods: gridResults.map((result) => result.solverMethod),
      gridResults,
      checks: {
        maximumRelativeResidual: reference.tolerances.maximumRelativeResidual,
        minimumObservedOrder: minimumOrder,
        maximumObservedOrder: maximumOrder,
        errorsDecrease,
        independentResidualsPass: allResidualsPass,
        observedOrdersPass: ordersPass,
        solverMethodsPass: methodsPass,
        internalResidualReportsPass: internalReportsPass
      }
    }
  };
}

module.exports = { runPoissonManufacturedSolution };
