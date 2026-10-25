/**
 * Experimental cross-solver correlations for published MOOSE cantilever beam
 * cases. The element and sparse solver are production modules; the mesh
 * assembly is kept here because OmniEng has no public beam-mesh assembler.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TimoshenkoBeam3D } = require('../cae/beam_timoshenko_3d');
const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

const REFERENCE_CASES = Object.freeze({
  timoshenko: Object.freeze({
    id: 'MOOSE_TIMOSHENKO_CANTILEVER_10_ELEMENT',
    fileName: 'moose_timoshenko_cantilever_10_element.json',
    sha256: '1aefe64c3358cf74d0a5f4913c023a555de13e86d954b07d17e860319f9ac690'
  }),
  eulerLimit: Object.freeze({
    id: 'MOOSE_EULER_CANTILEVER_10_ELEMENT',
    fileName: 'moose_euler_cantilever_10_element.json',
    sha256: '15c02977c0bec0733ffc2de0a2ed937906219f811c0af42823292d90fb44e63e'
  })
});

function loadReference(configuration) {
  const referencePath = path.join(__dirname, 'references', configuration.fileName);
  const bytes = fs.readFileSync(referencePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== configuration.sha256) {
    throw new Error(`MOOSE beam reference checksum mismatch for ${configuration.id}: ${sha256}`);
  }

  const reference = JSON.parse(bytes.toString('utf8'));
  const numericInputs = [
    reference.case?.length,
    reference.case?.youngsModulus,
    reference.case?.poissonRatio,
    reference.case?.shearCorrectionFactor,
    reference.case?.area,
    reference.case?.secondMomentIy,
    reference.case?.secondMomentIz,
    reference.case?.tipLoad,
    reference.case?.reportedTipDeflection,
    reference.tolerances?.maximumRelativeTipDeflectionError,
    reference.tolerances?.maximumIndependentlyComputedRelativeResidual
  ];
  if (
    reference.id !== configuration.id ||
    reference.formatVersion !== 1 ||
    !Number.isInteger(reference.case?.elementCount) ||
    reference.case.elementCount < 1 ||
    numericInputs.some((value) => !Number.isFinite(value)) ||
    reference.case.length <= 0 ||
    reference.case.youngsModulus <= 0 ||
    reference.case.area <= 0 ||
    reference.case.secondMomentIy <= 0 ||
    reference.case.secondMomentIz <= 0 ||
    reference.case.shearCorrectionFactor <= 0 ||
    reference.case.tipLoad === 0 ||
    reference.case.reportedTipDeflection === 0 ||
    reference.tolerances.maximumRelativeTipDeflectionError <= 0 ||
    reference.tolerances.maximumIndependentlyComputedRelativeResidual <= 0
  ) {
    throw new TypeError(`MOOSE beam reference artifact ${configuration.id} has an invalid schema.`);
  }

  if (Number.isFinite(reference.case.shearModulus)) {
    const derivedShearModulus = reference.case.youngsModulus / (2 * (1 + reference.case.poissonRatio));
    const relativeShearModulusDifference =
      Math.abs(derivedShearModulus - reference.case.shearModulus) / Math.abs(reference.case.shearModulus);
    if (!Number.isFinite(relativeShearModulusDifference) || relativeShearModulusDifference > 2e-8) {
      throw new TypeError(`MOOSE beam reference artifact ${configuration.id} has inconsistent E, nu, and G values.`);
    }
  }

  return { reference, referencePath, sha256 };
}

function assembleAndSolve(reference) {
  const { elementCount, length } = reference.case;
  const freeDofCount = 6 * elementCount;
  const solver = new WasmSparseMultifrontalSolver(freeDofCount, freeDofCount, {
    enableStructuredPoissonDirect: false
  });
  const assembled = Array.from({ length: freeDofCount }, () => new Float64Array(freeDofCount));
  const spacing = length / elementCount;
  const { youngsModulus: E, poissonRatio: nu, area: A, secondMomentIy: Iy, secondMomentIz: Iz } = reference.case;
  const section = {
    E,
    nu,
    A,
    Iy,
    Iz,
    // The source cases have no torsional load. This positive J affects only
    // the uncoupled torsion block and is not used to fit the bending result.
    J: Iy + Iz,
    ky: reference.case.shearCorrectionFactor,
    kz: reference.case.shearCorrectionFactor
  };

  for (let element = 0; element < elementCount; element++) {
    const beam = new TimoshenkoBeam3D(
      element,
      [element, element + 1],
      [
        { x: element * spacing, y: 0, z: 0 },
        { x: (element + 1) * spacing, y: 0, z: 0 }
      ],
      section
    );
    const localStiffness = beam.computeLocalStiffnessMatrix();

    for (let localRow = 0; localRow < 12; localRow++) {
      const globalRow = 6 * (element + Math.floor(localRow / 6)) + (localRow % 6);
      if (globalRow < 6) continue;
      const row = globalRow - 6;

      for (let localColumn = 0; localColumn < 12; localColumn++) {
        const globalColumn = 6 * (element + Math.floor(localColumn / 6)) + (localColumn % 6);
        if (globalColumn < 6) continue;
        const column = globalColumn - 6;
        const value = localStiffness[localRow * 12 + localColumn];
        solver.addEntry(row, column, value);
        assembled[row][column] += value;
      }
    }
  }

  const rhs = new Float64Array(freeDofCount);
  const tipYIndex = freeDofCount - 6 + 1;
  rhs[tipYIndex] = reference.case.tipLoad;
  const factorization = solver.factorize();
  const solution = solver.solve(rhs);

  let residualSquared = 0;
  let rhsSquared = 0;
  for (let row = 0; row < freeDofCount; row++) {
    let applied = 0;
    for (let column = 0; column < freeDofCount; column++) {
      applied += assembled[row][column] * solution.solution[column];
    }
    residualSquared += (rhs[row] - applied) ** 2;
    rhsSquared += rhs[row] ** 2;
  }

  const derivedShearModulus = E / (2 * (1 + nu));
  return {
    tipDeflection: solution.solution[tipYIndex],
    factorizationMethod: factorization.solverMethod,
    solverConverged: solution.converged,
    solverReportedRelativeResidual: solution.relativeResidual,
    independentlyComputedRelativeResidual: Math.sqrt(residualSquared / rhsSquared),
    derivedShearModulus,
    unknownCount: freeDofCount,
    elementLength: spacing
  };
}

function runMooseBeamReference(configuration) {
  const { reference, referencePath, sha256 } = loadReference(configuration);
  let actual;
  try {
    actual = assembleAndSolve(reference);
  } catch (error) {
    return {
      id: reference.id,
      name: reference.name,
      targetValue: reference.case.reportedTipDeflection,
      calculatedValue: null,
      units: reference.case.deflectionUnits,
      errorPercent: null,
      tolerancePercent: reference.tolerances.maximumRelativeTipDeflectionError * 100,
      passed: false,
      status: 'failed',
      reason: `Production beam or sparse solve failed: ${error.message}`,
      metadata: { solverExecuted: true, referenceArtifactSha256: sha256 }
    };
  }

  const relativeError =
    Math.abs(actual.tipDeflection - reference.case.reportedTipDeflection) /
    Math.abs(reference.case.reportedTipDeflection);
  const residualLimit = reference.tolerances.maximumIndependentlyComputedRelativeResidual;
  const passed =
    actual.solverConverged &&
    Number.isFinite(actual.tipDeflection) &&
    relativeError <= reference.tolerances.maximumRelativeTipDeflectionError &&
    Number.isFinite(actual.independentlyComputedRelativeResidual) &&
    actual.independentlyComputedRelativeResidual <= residualLimit;

  return {
    id: reference.id,
    name: reference.name,
    targetValue: reference.case.reportedTipDeflection,
    calculatedValue: actual.tipDeflection,
    units: reference.case.deflectionUnits,
    errorPercent: relativeError * 100,
    tolerancePercent: reference.tolerances.maximumRelativeTipDeflectionError * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Beam deflection or independent residual exceeded its predeclared tolerance.',
    metadata: {
      solverExecuted: true,
      solver: 'TimoshenkoBeam3D plus WasmSparseMultifrontalSolver',
      solverMethod: actual.factorizationMethod,
      referenceArtifact: path.relative(__dirname, referencePath),
      referenceArtifactSha256: sha256,
      referenceSource: reference.source.url,
      referenceKind: reference.referenceKind,
      elementCount: reference.case.elementCount,
      elementLength: actual.elementLength,
      unknownCount: actual.unknownCount,
      derivedShearModulus: actual.derivedShearModulus,
      publishedShearModulus: reference.case.shearModulus,
      solverReportedRelativeResidual: actual.solverReportedRelativeResidual,
      independentlyComputedRelativeResidual: actual.independentlyComputedRelativeResidual,
      maximumIndependentlyComputedRelativeResidual: residualLimit,
      limitations: reference.limitations
    }
  };
}

module.exports = { REFERENCE_CASES, runMooseBeamReference };
