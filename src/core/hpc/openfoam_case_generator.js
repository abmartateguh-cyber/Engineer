/**
 * openfoam_case_generator.js
 *
 * Native OpenFOAM case deck generator: system/controlDict, system/fvSchemes,
 * system/fvSolution, constant/transportProperties, and a blockMeshDict
 * placeholder. Pure deterministic text generation, no external dependencies.
 */

'use strict';

const VALID_SOLVERS = new Set(['rhoCentralFoam', 'interFoam', 'chtMultiRegionFoam', 'pimpleFoam']);

const FOAM_FILE_HEADER = (objectName, location = 'system') => [
  '/*--------------------------------*- C++ -*----------------------------------*\\',
  '| =========                 |                                                 |',
  '| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |',
  '|  \\\\    /   O peration     | Version:  v2312                                 |',
  '|   \\\\  /    A nd           | Website:  www.openfoam.com                      |',
  '|    \\\\/     M anipulation  |                                                 |',
  '\\*---------------------------------------------------------------------------*/',
  'FoamFile',
  '{',
  '    version     2.0;',
  '    format      ascii;',
  '    class       dictionary;',
  `    location    "${location}";`,
  `    object      ${objectName};`,
  '}',
  '// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //',
  ''
];

function assertFiniteNumber(value, label, { positive = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive ' : ''}finite number, got ${JSON.stringify(value)}`);
  }
}

class OpenFoamCaseGenerator {
  /**
   * Generates system/controlDict content.
   */
  static generateControlDict({
    application = 'rhoCentralFoam',
    startTime = 0,
    endTime = 0.05,
    deltaT = 1e-6,
    writeControl = 'adjustableRunTime',
    writeInterval = 0.001,
    maxCo = 0.5
  } = {}) {
    if (!VALID_SOLVERS.has(application)) {
      throw new Error(`Invalid OpenFOAM solver "${application}"; expected one of ${[...VALID_SOLVERS].join(', ')}`);
    }
    assertFiniteNumber(startTime, 'startTime', { positive: false });
    assertFiniteNumber(endTime, 'endTime');
    assertFiniteNumber(deltaT, 'deltaT');
    assertFiniteNumber(writeInterval, 'writeInterval');
    assertFiniteNumber(maxCo, 'maxCo');
    if (endTime <= startTime) {
      throw new Error(`endTime (${endTime}) must be greater than startTime (${startTime})`);
    }

    return [
      ...FOAM_FILE_HEADER('controlDict'),
      `application     ${application};`,
      'startFrom       startTime;',
      `startTime       ${startTime};`,
      'stopAt          endTime;',
      `endTime         ${endTime};`,
      `deltaT          ${deltaT};`,
      `writeControl    ${writeControl};`,
      `writeInterval   ${writeInterval};`,
      'purgeWrite      5;',
      'writeFormat     ascii;',
      'writePrecision  8;',
      'writeCompression off;',
      'timeFormat      general;',
      'timePrecision   6;',
      'runTimeModifiable true;',
      'adjustTimeStep  yes;',
      `maxCo           ${maxCo};`,
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Generates system/fvSchemes content.
   */
  static generateFvSchemes({ isCompressible = true } = {}) {
    return [
      ...FOAM_FILE_HEADER('fvSchemes'),
      'ddtSchemes',
      '{',
      isCompressible ? '    default         Euler;' : '    default         backward;',
      '}',
      '',
      'gradSchemes',
      '{',
      '    default         Gauss linear;',
      '}',
      '',
      'divSchemes',
      '{',
      '    default         none;',
      '    div(tauMC)      Gauss linear;',
      '    div(phi,U)      Gauss vanLeer;',
      '    div(phi,k)      Gauss upwind;',
      '    div(phi,omega)  Gauss upwind;',
      '}',
      '',
      'laplacianSchemes',
      '{',
      '    default         Gauss linear corrected;',
      '}',
      '',
      'interpolationSchemes',
      '{',
      '    default         linear;',
      '    reconstruct(rho) vanLeer;',
      '    reconstruct(U)   vanLeerV;',
      '    reconstruct(T)   vanLeer;',
      '}',
      '',
      'snGradSchemes',
      '{',
      '    default         corrected;',
      '}',
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Generates system/fvSolution content with PBiCG solver and DIC preconditioner.
   */
  static generateFvSolution() {
    return [
      ...FOAM_FILE_HEADER('fvSolution'),
      'solvers',
      '{',
      '    p',
      '    {',
      '        solver          PBiCG;',
      '        preconditioner  DIC;',
      '        tolerance       1e-06;',
      '        relTol         0.01;',
      '    }',
      '    "rho.*"',
      '    {',
      '        solver          diagonal;',
      '    }',
      '    "U.*"',
      '    {',
      '        solver          PBiCG;',
      '        preconditioner  DILU;',
      '        tolerance       1e-07;',
      '        relTol         0.01;',
      '    }',
      '    "e.*"',
      '    {',
      '        solver          PBiCG;',
      '        preconditioner  DILU;',
      '        tolerance       1e-07;',
      '        relTol         0.01;',
      '    }',
      '    "alpha.*"',
      '    {',
      '        solver          smoothSolver;',
      '        smoother        symGaussSeidel;',
      '        tolerance       1e-08;',
      '        relTol          0;',
      '        nSweeps         1;',
      '    }',
      '}',
      '',
      'PIMPLE',
      '{',
      '    nOuterCorrectors 2;',
      '    nCorrectors      2;',
      '    nNonOrthogonalCorrectors 0;',
      '}',
      '',
      'relaxationFactors',
      '{',
      '    fields',
      '    {',
      '        p           0.3;',
      '    }',
      '    equations',
      '    {',
      '        U           0.7;',
      '    }',
      '}',
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Generates constant/transportProperties content (Newtonian fluid).
   */
  static generateTransportProperties({ fluid = {}, geometry = 'channel' } = {}) {
    const rho = fluid.rho !== undefined ? fluid.rho : 1.225;
    const nu = fluid.nu !== undefined ? fluid.nu : 1.5e-5;
    const mu = fluid.mu !== undefined ? fluid.mu : 1.8e-5;
    const Cp = fluid.Cp !== undefined ? fluid.Cp : 1005;
    const Pr = fluid.Pr !== undefined ? fluid.Pr : 0.72;

    assertFiniteNumber(rho, 'fluid.rho');
    assertFiniteNumber(nu, 'fluid.nu');
    assertFiniteNumber(mu, 'fluid.mu');
    assertFiniteNumber(Cp, 'fluid.Cp');
    assertFiniteNumber(Pr, 'fluid.Pr');

    return [
      ...FOAM_FILE_HEADER('transportProperties', 'constant'),
      'transportModel  Newtonian;',
      '',
      'rho             rho [1 -3 0 0 0 0 0] ' + rho + ';',
      'nu              nu [0 2 -1 0 0 0 0] ' + nu + ';',
      'mu              mu [1 -1 -1 0 0 0 0] ' + mu + ';',
      'Cp              Cp [0 2 -2 -1 0 0 0] ' + Cp + ';',
      'Pr              Pr [0 0 0 0 0 0 0] ' + Pr + ';',
      '',
      `// Transport properties for ${geometry} case (placeholder)`,
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Generates system/blockMeshDict placeholder for a channel/cylinder geometry.
   */
  static generateBlockMeshDict({ geometry = 'channel', cells = null, dims = null } = {}) {
    if (geometry !== 'channel' && geometry !== 'cylinder') {
      throw new Error(`Unknown blockMesh geometry "${geometry}"; expected "channel" or "cylinder"`);
    }
    const defaultCells = geometry === 'channel' ? [40, 8, 8] : [32, 32, 8];
    const defaultDims = geometry === 'channel' ? [1.0, 0.1, 0.1] : [0.1, 0.1, 1.0];
    const [nx, ny, nz] = cells || defaultCells;
    const [lx, ly, lz] = dims || defaultDims;
    for (const c of [nx, ny, nz]) assertPositiveInteger(c, 'blockMesh cell count');
    for (const d of [lx, ly, lz]) assertFiniteNumber(d, 'blockMesh dimension');

    return [
      ...FOAM_FILE_HEADER('blockMeshDict'),
      `// ${geometry} geometry placeholder: ${lx} x ${ly} x ${lz} m`,
      'convertToMeters 1.0;',
      '',
      'vertices',
      '(',
      '    (0 0 0)',
      `    (${lx} 0 0)`,
      `    (${lx} ${ly} 0)`,
      `    (0 ${ly} 0)`,
      '    (0 0 ' + lz + ')',
      `    (${lx} 0 ${lz})`,
      `    (${lx} ${ly} ${lz})`,
      `    (0 ${ly} ${lz})`,
      ');',
      '',
      'blocks',
      '(',
      `    hex (0 1 2 3 4 5 6 7) (${nx} ${ny} ${nz}) simpleGrading (1 1 1)`,
      ');',
      '',
      'boundary',
      '(',
      '    inlet',
      '    {',
      '        type patch;',
      '        faces',
      '        (',
      '            (0 4 7 3)',
      '        );',
      '    }',
      '    outlet',
      '    {',
      '        type patch;',
      '        faces',
      '        (',
      '            (1 2 6 5)',
      '        );',
      '    }',
      '    walls',
      '    {',
      '        type wall;',
      '        faces',
      '        (',
      '            (0 1 5 4)',
      '            (3 7 6 2)',
      '            (0 3 2 1)',
      '            (4 5 6 7)',
      '        );',
      '    }',
      ');',
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Generates boundary condition 0/U vector field.
   */
  static generateUField({ inletVelocity = [100, 0, 0] } = {}) {
    if (
      !Array.isArray(inletVelocity) ||
      inletVelocity.length !== 3 ||
      inletVelocity.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    ) {
      throw new Error(`inletVelocity must be a [u, v, w] numeric triple, got ${JSON.stringify(inletVelocity)}`);
    }
    return [
      'FoamFile',
      '{',
      '    version     2.0;',
      '    format      ascii;',
      '    class       volVectorField;',
      '    location    "0";',
      '    object      U;',
      '}',
      'dimensions      [0 1 -1 0 0 0 0];',
      'internalField   uniform (0 0 0);',
      'boundaryField',
      '{',
      '    inlet',
      '    {',
      '        type            fixedValue;',
      `        value           uniform (${inletVelocity.join(' ')});`,
      '    }',
      '    outlet',
      '    {',
      '        type            zeroGradient;',
      '    }',
      '    walls',
      '    {',
      '        type            noSlip;',
      '    }',
      '}'
    ].join('\n');
  }

  /**
   * Generates system/decomposeParDict content for MPI domain decomposition.
   */
  static generateDecomposeParDict({ numberOfSubdomains = 4, method = 'scotch' } = {}) {
    assertPositiveInteger(numberOfSubdomains, 'numberOfSubdomains');
    return [
      ...FOAM_FILE_HEADER('decomposeParDict'),
      `numberOfSubdomains ${numberOfSubdomains};`,
      '',
      `method          ${method};`,
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Returns a complete native case tree as a { path: content } map.
   */
  static generateCaseTree(opts = {}) {
    const subdomains =
      opts.numberOfSubdomains ||
      opts.subdomains ||
      opts.cores ||
      (opts.decomposeParDict && opts.decomposeParDict.numberOfSubdomains) ||
      4;
    const method =
      (opts.decomposeParDict && opts.decomposeParDict.method) ||
      opts.decomposeMethod ||
      'scotch';

    const caseTree = {
      'system/controlDict': OpenFoamCaseGenerator.generateControlDict(opts.controlDict || opts),
      'system/fvSchemes': OpenFoamCaseGenerator.generateFvSchemes(opts.fvSchemes || {}),
      'system/fvSolution': OpenFoamCaseGenerator.generateFvSolution(),
      'system/blockMeshDict': OpenFoamCaseGenerator.generateBlockMeshDict(opts.blockMeshDict || {}),
      'system/decomposeParDict': OpenFoamCaseGenerator.generateDecomposeParDict({
        numberOfSubdomains: subdomains,
        method
      }),
      'constant/transportProperties': OpenFoamCaseGenerator.generateTransportProperties(
        opts.transportProperties || (opts.fluid ? { fluid: opts.fluid } : {})
      ),
      '0/U': OpenFoamCaseGenerator.generateUField(opts.uField || {})
    };
    return caseTree;
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
}

module.exports = {
  OpenFoamCaseGenerator,
  VALID_SOLVERS
};
