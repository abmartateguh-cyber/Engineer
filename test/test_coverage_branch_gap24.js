'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 24, CAE cluster).
 *
 * Targets remaining uncovered branch blocks (error paths, guards, defaults,
 * fallbacks) across the 40 CAE solver modules owned by this cluster:
 * fatigue/norton/plasticity/hyperelastic/johnson-cook constitutive helpers,
 * explicit dynamics, CHT, Delaunay meshing, shell elements, VOF, sliding-mesh
 * turbomachinery, FVM/CFD solvers, radiation, random vibration, boundary-layer
 * meshing, solid elements, contact, FEA/CFD engine adapters, beam dynamics,
 * drop-test/animator, WebGPU CFD kernel, and CLPT composites. No production
 * source is modified.
 */

const assert = require('assert');

const { FatigueLifeAnalyzer } = require('../src/core/cae/fatigue_life_analyzer');
const { NortonBaileyCreepSolver } = require('../src/core/cae/norton_bailey_creep');
const { J2Plasticity } = require('../src/core/cae/nonlinear_plasticity');
const {
  GaussPoint3D,
  QuadraticTet10Element,
  MortarContactPair3D,
  LanczosModalEigensolver
} = require('../src/core/cae/continuum_plasticity_3d');
const { HyperelasticMaterial, HyperelasticMaterialModel } = require('../src/core/cae/hyperelastic_materials');
const { JohnsonCookFracture } = require('../src/core/cae/johnson_cook_fracture');
const { ExplicitDynamicsCrashSolver } = require('../src/core/cae/explicit_dynamics_crash');
const { ConjugateHeatTransferEngine } = require('../src/core/cae/conjugate_heat_transfer');
const { DelaunayMesher3D, Point3D, Tetrahedron, TriangleFace } = require('../src/core/cae/delaunay_mesher_3d');
const {
  DelaunayConstrained2D,
  mulberry32,
  orient2d,
  edgeKey,
  pointInPolygonWinding,
  segmentsIntersectStrict
} = require('../src/core/cae/delaunay_constrained_2d');
const { ShellMITC4Element } = require('../src/core/cae/shell_mitc4');
const { ShellAssembly, generatePlateMesh, buildShellStiffnessLocal } = require('../src/core/cae/shell_assembly');
const { VOFMultiphaseSolver } = require('../src/core/cae/vof_multiphase_solver');
const { SlidingMeshTurbomachinery } = require('../src/core/cae/sliding_mesh_turbomachinery');
const { SimpleNavierStokesSolver } = require('../src/core/cae/simple_navier_stokes');
const { TransonicRiemannSolver } = require('../src/core/cae/transonic_riemann_solver');
const { VenkatakrishnanLimiter } = require('../src/core/cae/venkatakrishnan_limiter');
const { RadiationDOMEngine, SIGMA_STEFAN_BOLTZMANN } = require('../src/core/cae/radiation_dom');
const { RandomVibrationPSDEngine } = require('../src/core/cae/random_vibration_psd');
const { PrismLayerMesher } = require('../src/core/cae/prism_layer_mesher');
const { ElementTET10 } = require('../src/core/cae/element_tet10');
const { ElementHEX20 } = require('../src/core/cae/element_hex20');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const { ContactFEM3D, BandedCholesky, DenseSolver, hex8Shape } = require('../src/core/cae/contact_fem_3d');
const { ContactMechanics3D } = require('../src/core/cae/contact_mechanics_3d');
const { FEANode, FEAElement, FEASolver } = require('../src/core/cae/fea_structural');
const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
const { CFDEngineAdapter } = require('../src/core/cae/cfd_engine_adapter');
const {
  createSeededRandom,
  CANTILEVER_BETA1L,
  eulerBernoulliCantileverOmega1,
  eulerBernoulliCantileverFrequencyHz,
  assembleBeamSystem,
  solveModalSubspace,
  rayleighFromTargets,
  harmonicFRF,
  randomVibrationPSD
} = require('../src/core/cae/beam_dynamic_response');
const { TimoshenkoBeam3D } = require('../src/core/cae/beam_timoshenko_3d');
const { AxisymThermoelastic8Node, q8Shape } = require('../src/core/cae/axisym_thermoelastic_8node');
const { PlaneStressQ8, q8Shape: q8ShapePS } = require('../src/core/cae/fe2d_q8_plane_stress');
const { Poisson2DMixed, q4Shape } = require('../src/core/cae/poisson_2d_mixed');
const { ThermalEngine } = require('../src/core/cae/thermal_cht');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { CFDSolver2D } = require('../src/core/cae/cfd_navier_stokes');
const { DropTestSimulator } = require('../src/core/cae/drop_test');
const { TransientDropAnimator } = require('../src/core/cae/transient_drop_animator');
const { WebGPUCFDKernel } = require('../src/core/cae/webgpu_cfd_kernel');
const { CompositePly, CompositeLaminateCLPT } = require('../src/core/cae/composite_clpt');

const MATERIAL = {
  fatigueStrengthCoeff: 1200e6,
  fatigueStrengthExponent: -0.085,
  ultimateTensileStrength: 600e6
};

async function runBranchGapTwentyFourCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Fatigue life analyzer
  // ------------------------------------------------------------------
  check('fatigue: rainflow guards, cycles, and residual half-cycles', () => {
    assert.deepStrictEqual(FatigueLifeAnalyzer.countRainflowCycles(null), []);
    assert.deepStrictEqual(FatigueLifeAnalyzer.countRainflowCycles([1, 2]), []);
    const cycles = FatigueLifeAnalyzer.countRainflowCycles([0, 1, 0, -1, 0]);
    assert(cycles.length >= 2);
    assert(cycles.some((c) => c.count === 1.0));
    assert(cycles.some((c) => c.count === 0.5));
  });

  check('fatigue: basquin Goodman branches, infinite life, and errors', () => {
    const nHigh = FatigueLifeAnalyzer.calculateBasquinCycles(1e6, 0, MATERIAL);
    assert(nHigh > 1);
    const nGoodman = FatigueLifeAnalyzer.calculateBasquinCycles(1e6, 200e6, MATERIAL);
    assert(nGoodman < nHigh);
    assert.strictEqual(FatigueLifeAnalyzer.calculateBasquinCycles(0, 0, MATERIAL), 1e12);
    assert.throws(() => FatigueLifeAnalyzer.calculateBasquinCycles(1e6, 0, {}), /explicit fatigueStrengthCoeff/);
    assert.throws(() => FatigueLifeAnalyzer.calculateBasquinCycles(NaN, 0, MATERIAL), /finite stress amplitude/);
    assert.throws(
      () => FatigueLifeAnalyzer.validateMaterialProperties({ ...MATERIAL, fatigueStrengthExponent: 0.1 }),
      /explicit fatigueStrengthCoeff/
    );
    assert.throws(
      () => FatigueLifeAnalyzer.validateMaterialProperties({ ...MATERIAL, ultimateTensileStrength: -1 }),
      /explicit fatigueStrengthCoeff/
    );
  });

  check('fatigue: cumulative damage failure flag, infinite life, miner default count', () => {
    const heavy = FatigueLifeAnalyzer.evaluateCumulativeDamage(
      Array.from({ length: 60 }, (_, i) => (i % 2 ? 800e6 : 0)),
      MATERIAL
    );
    assert.strictEqual(heavy.isFailed, true);
    const noLoad = FatigueLifeAnalyzer.evaluateCumulativeDamage([5, 5], MATERIAL);
    assert.strictEqual(noLoad.lifeInBlocks, Infinity);
    assert.strictEqual(noLoad.cumulativeDamageD, 0);
    assert.strictEqual(noLoad.safetyFactor, 999.0);
    const miner = new FatigueLifeAnalyzer().calculateMinerDamage(
      [{ amplitude: 100e6, mean: 0 }],
      1200e6,
      -0.085,
      600e6
    );
    assert(miner.isSafe);
  });

  // ------------------------------------------------------------------
  // Norton-Bailey creep
  // ------------------------------------------------------------------
  check('creep: secondary rate, validation guards, and defaults', () => {
    const rate = NortonBaileyCreepSolver.evaluateSecondaryCreepRate({ stressMPa: 100, A: 1e-10, n: 3.5 });
    assert(rate > 0);
    assert.throws(
      () => NortonBaileyCreepSolver.evaluateSecondaryCreepRate({ stressMPa: -1, A: 1e-10, n: 3 }),
      /explicit finite stress/
    );
    assert.throws(() => NortonBaileyCreepSolver.evaluateSecondaryCreepRate({ stressMPa: 100, A: -1, n: 3 }), /A >= 0/);
    assert.throws(
      () => NortonBaileyCreepSolver.evaluateSecondaryCreepRate({ stressMPa: 100, A: 1, n: NaN }),
      /explicit finite stress/
    );
  });

  check('creep: integration time-history cap, dt guards, and m validation', () => {
    const res = NortonBaileyCreepSolver.integrateCreepStrain({
      stressMPa: 50,
      totalHours: 10,
      A: 1e-10,
      n: 3,
      m: -0.3,
      dtHours: 0.001
    });
    assert.strictEqual(res.timeHistory.length, 50);
    assert(res.totalCreepStrain > 0);
    assert.throws(
      () => NortonBaileyCreepSolver.integrateCreepStrain({ stressMPa: 50, totalHours: 10, A: 1e-10, n: 3 }),
      /time exponent m/
    );
    assert.throws(
      () =>
        NortonBaileyCreepSolver.integrateCreepStrain({
          stressMPa: 50,
          totalHours: 10,
          A: 1e-10,
          n: 3,
          m: -0.3,
          dtHours: -1
        }),
      /dtHours/
    );
    assert.throws(
      () =>
        NortonBaileyCreepSolver.integrateCreepStrain({
          stressMPa: 50,
          totalHours: 10,
          A: 1e-10,
          n: 3,
          m: -2
        }),
      /explicit finite stress/
    );
  });

  check('creep: rupture time infinity branch and constant errors', () => {
    assert.strictEqual(NortonBaileyCreepSolver.evaluateRuptureTime(0, 10, 1), Infinity);
    const tr = NortonBaileyCreepSolver.evaluateRuptureTime(1e-4, 10, 1);
    assert(tr > 0);
    assert.throws(() => NortonBaileyCreepSolver.evaluateRuptureTime(-1, 10, 1), /non-negative creep rate/);
    assert.throws(() => NortonBaileyCreepSolver.evaluateRuptureTime(1, 0, 1), /Monkman-Grant/);
    assert.throws(() => NortonBaileyCreepSolver.evaluateRuptureTime(1, 10, -1), /Monkman-Grant/);
  });

  // ------------------------------------------------------------------
  // Nonlinear plasticity (J2)
  // ------------------------------------------------------------------
  check('plasticity: elastic and plastic radial return branches', () => {
    const props = { E: 200e3, nu: 0.3, yieldStress0: 250, hardeningModulus: 1000 };
    const elastic = J2Plasticity.integrateStress(
      { stress: [0, 0, 0, 0, 0, 0], equivPlasticStrain: 0 },
      [0.0001, -0.00003, -0.00007, 0, 0, 0],
      props
    );
    assert.strictEqual(elastic.isYielded, false);
    const plastic = J2Plasticity.integrateStress(
      { stress: [0, 0, 0, 0, 0, 0] },
      [0.01, -0.003, -0.007, 0.005, 0, 0],
      props
    );
    assert.strictEqual(plastic.isYielded, true);
    assert(plastic.deltaPlasticStrain > 0);
    assert.throws(() => J2Plasticity.integrateStress({}, [0, 0, 0, 0, 0, 0], null), /Explicit material properties/);
    assert.throws(() => J2Plasticity.integrateStress({}, [0, 0, 0, 0, 0, 0], { ...props, E: -1 }), /finite E/);
  });

  check('plasticity: radialReturnMapping guards and perfect-elastic branch', () => {
    const mat = { yieldStressMPa: 250, hardeningModulusMPa: 500, E_MPa: 200e3, nu: 0.3 };
    const e = J2Plasticity.radialReturnMapping([50, 0, 0, 0, 0, 0], 0, mat);
    assert.strictEqual(e.isPlastic, false);
    const p = J2Plasticity.radialReturnMapping([500, 0, 0, 0, 0, 0], 0, mat);
    assert.strictEqual(p.isPlastic, true);
    assert.throws(() => J2Plasticity.radialReturnMapping([1, 2], 0, mat), /six stress components/);
    assert.throws(() => J2Plasticity.radialReturnMapping([1, 2, 3, 4, 5, 6], -1, mat), /six stress components/);
    assert.throws(
      () => J2Plasticity.radialReturnMapping([1, 2, 3, 4, 5, 6], 0, { ...mat, nu: 0.7 }),
      /finite yieldStressMPa/
    );
  });

  // ------------------------------------------------------------------
  // Continuum plasticity 3D
  // ------------------------------------------------------------------
  check('continuum: tet10 material validation, shape functions, and jacobian', () => {
    const mat = {
      E: 200e9,
      nu: 0.3,
      yieldStress: 400e6,
      hardeningModulus: 1e9,
      A: 400e6,
      B: 500e6,
      n: 0.35,
      C: 0.02,
      m: 1.0,
      refStrainRate: 1.0,
      Tmelt: 1800,
      Troom: 293
    };
    assert.throws(() => new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {}), /material constants/);
    assert.throws(
      () => new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { ...mat, nu: 0.9 }),
      /Invalid continuum plasticity/
    );
    const elem = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], mat);
    assert.strictEqual(elem.gaussPoints.length, 4);
    const N = elem.evaluateShapeFunctions(0.25, 0.25, 0.25);
    assert(Math.abs(N[0] + N[1] + N[2] + N[3] + N[4] + N[5] + N[6] + N[7] + N[8] + N[9] - 1) < 1e-9);
    const dN = elem.evaluateShapeDerivatives(0.2, 0.3, 0.1);
    assert.strictEqual(dN.dNdL1.length, 10);
    const nodes = [];
    for (let i = 0; i < 10; i++) nodes.push({ x: i, y: i * i, z: i * i * i });
    const jac = elem.computeJacobian(nodes, 0.25, 0.25, 0.25);
    assert(jac.detJ !== 0);
    const flat = nodes.map(() => ({ x: 0, y: 0, z: 0 }));
    assert.throws(() => elem.computeJacobian(flat, 0.25, 0.25, 0.25), /Degenerate Jacobian/);
    const B = elem.constructBMatrix(jac.dNdx, jac.dNdy, jac.dNdz);
    assert.strictEqual(B.length, 6);
    assert.strictEqual(B[0].length, 30);
  });

  check('continuum: gauss-point radial return elastic/plastic branches and input errors', () => {
    const mat = {
      E: 200e9,
      nu: 0.3,
      yieldStress: 400e6,
      hardeningModulus: 1e9,
      A: 200e6,
      B: 500e6,
      n: 0.35,
      C: 0.02,
      m: 1.0,
      refStrainRate: 1.0,
      Tmelt: 1800,
      Troom: 293
    };
    const elem = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], mat);
    const gp = new GaussPoint3D(0, 0.1, 0.1, 0.1, 1);
    const elastic = elem.radialReturnMapping(gp, [1e-6, -1e-6, 0, 0, 0, 0], 1.0, 400);
    assert.strictEqual(elastic.isPlastic, false);
    const plastic = elem.radialReturnMapping(gp, [0.01, -0.003, -0.007, 0.002, 0, 0], 10.0, 400);
    assert.strictEqual(plastic.isPlastic, true);
    assert.strictEqual(gp.isYielded, true);
    assert.throws(() => elem.radialReturnMapping(gp, [0.01, 0, 0, 0, 0], 1, 400), /six finite strain increments/);
    assert.throws(() => elem.radialReturnMapping(gp, [0.01, 0, 0, 0, 0, 0], 0, 400), /six finite strain increments/);
    assert.throws(() => elem.radialReturnMapping(gp, [0.01, 0, 0, 0, 0, 0], 1, -1), /six finite strain increments/);
  });

  check('continuum: mortar contact penetration and non-contact branches', () => {
    const nodes = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      { id: 3, x: 0.2, y: 0.2, z: -0.001 },
      { id: 4, x: 0.2, y: 0.2, z: 2 }
    ];
    const pair = new MortarContactPair3D([0, 1, 2], [3, 4], { penaltyNormal: 1e10, frictionCoeff: 0.4 });
    assert.strictEqual(pair.penaltyNormal, 1e10);
    const res = pair.evaluateContact(nodes);
    assert.strictEqual(res.activeContactCount, 1);
    assert(res.totalNormalForce > 0);
    const pair2 = new MortarContactPair3D([0, 1, 2], [3, 4]);
    assert.strictEqual(pair2.frictionCoeff, 0.3);
  });

  check('continuum: lanczos eigensolver default and period-infinity paths', () => {
    const K = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 5]
    ];
    const M = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const solver = new LanczosModalEigensolver(2, 50, 1e-6);
    const res = solver.solve(K, M, 3);
    assert(res.modesFound >= 1);
    assert.strictEqual(res.sturmCheckPassed, true);
    assert(res.frequencies.every((f) => f.periodSec > 0));
    const K2 = [
      [1e-16, 0],
      [0, 1e-16]
    ];
    const res2 = new LanczosModalEigensolver(2).solve(K2, M.slice(0, 2), 2);
    assert(Array.isArray(res2.frequencies));
  });

  // ------------------------------------------------------------------
  // Hyperelastic materials
  // ------------------------------------------------------------------
  check('hyperelastic: model detection, uniaxial branches, and missing constants', () => {
    const mr = new HyperelasticMaterial('MOONEY_RIVLIN', { C10: 3e5, C01: 2e4 });
    assert(mr.evaluateUniaxialStress(2) > 0);
    const yeoh = new HyperelasticMaterial({ model: 'yeoh' }, { C10: 3e5, C20: -1e4, C30: 1e3 });
    assert.strictEqual(yeoh.modelType, 'YEOH');
    assert(yeoh.evaluateUniaxialStress(1.5) !== 0);
    const ogden = new HyperelasticMaterial({ model: 'ogden' }, { mu1: 4e5, alpha1: 2.0 });
    assert.strictEqual(ogden.modelType, 'OGDEN');
    assert(ogden.evaluateUniaxialStress(1.5) > 0);
    assert.throws(() => mr.requireFiniteConstants(['C10', 'C01', 'C20']), /explicit finite hyperelastic constants/);
    const unknown = new HyperelasticMaterial('SOMETHING', {});
    assert.strictEqual(unknown.evaluateUniaxialStress(1.5), 0.0);
  });

  check('hyperelastic: curve generation defaults and alias', () => {
    const mat = new HyperelasticMaterial('MOONEY_RIVLIN', { C10: 3e5, C01: 2e4 });
    const curve = mat.generateUniaxialCurve();
    assert.strictEqual(curve.length, 31);
    assert.strictEqual(curve[0].stretch, 1.0);
    assert.strictEqual(mat.generateUniaxialTensionCurve(2, 5).length, 6);
    assert.strictEqual(new HyperelasticMaterialModel().modelType, 'MOONEY_RIVLIN');
  });

  // ------------------------------------------------------------------
  // Johnson-Cook fracture
  // ------------------------------------------------------------------
  const JC_MAT = {
    A: 500e6,
    B: 900e6,
    n: 0.4,
    C: 0.02,
    m: 1.0,
    T_room: 293,
    T_melt: 1800,
    eps0_dot: 1.0,
    D1: 0.15,
    D2: 0.5,
    D3: -1.5,
    D4: 0.02,
    D5: 0.6
  };

  check('johnson-cook: material validation and failure strain clamps', () => {
    assert.throws(() => JohnsonCookFracture.validateMaterial({}), /flow and fracture constants/);
    assert.throws(() => JohnsonCookFracture.validateMaterial({ ...JC_MAT, T_melt: 100 }), /Require T_melt/);
    const epsF = JohnsonCookFracture.computeFailureStrain(0.4, 1e-6, 300, JC_MAT);
    assert(epsF >= 0.001);
    assert.throws(() => JohnsonCookFracture.computeFailureStrain(0.4, 0, 300, JC_MAT), /finite triaxiality/);
    assert.throws(() => JohnsonCookFracture.computeFailureStrain(0.4, 1, 0, JC_MAT), /finite triaxiality/);
  });

  check('johnson-cook: damage increment, flow stress extremes, fracture strain', () => {
    assert.throws(
      () => JohnsonCookFracture.computeDamageIncrement(-1, 0.4, 1, 300, JC_MAT),
      /non-negative plastic strain/
    );
    const d = JohnsonCookFracture.computeDamageIncrement(0.01, 0.4, 1, 300, JC_MAT);
    assert(d > 0);
    assert.strictEqual(JohnsonCookFracture.isElementFailed(1.0), true);
    assert.strictEqual(JohnsonCookFracture.isElementFailed(0.9), false);
    const flow = JohnsonCookFracture.computeFlowStress(JC_MAT, 0.1, 1e-6, 300);
    assert(flow >= 0);
    assert.throws(() => JohnsonCookFracture.computeFlowStress(JC_MAT, -1, 1, 300), /non-negative plastic strain/);
    const fr = JohnsonCookFracture.computeFractureStrain(JC_MAT, [600e6, 0, 0, 0, 0, 0], 1, 300);
    assert(fr.fractureStrain >= 0.005);
    assert(Math.abs(fr.triaxiality) <= 3);
    const hydro = JohnsonCookFracture.computeFractureStrain(JC_MAT, [0, 0, 0, 0, 0, 0], 1, 300);
    assert.strictEqual(hydro.triaxiality, 0);
    assert.throws(() => JohnsonCookFracture.computeFractureStrain(JC_MAT, [1, 2], 1, 300), /six stress components/);
  });

  check('johnson-cook: updateDamage fracture flag and rounding', () => {
    const up = JohnsonCookFracture.updateDamage(0.9, 0.05, 0.2);
    assert.strictEqual(up.isFractured, true);
    assert.strictEqual(up.intactFraction, 0);
    const up2 = JohnsonCookFracture.updateDamage(0.1, 0.001, 0.2);
    assert.strictEqual(up2.isFractured, false);
  });

  // ------------------------------------------------------------------
  // Explicit dynamics crash
  // ------------------------------------------------------------------
  check('explicit dynamics: wave speed and critical time-step branches', () => {
    const c = ExplicitDynamicsCrashSolver.calculateDilatationalWaveSpeed(200e9, 0.3, 7850);
    assert(c > 0);
    assert.throws(() => ExplicitDynamicsCrashSolver.calculateDilatationalWaveSpeed(0, 0.3, 7850), /positive finite E/);
    assert.throws(
      () => ExplicitDynamicsCrashSolver.calculateDilatationalWaveSpeed(200e9, 0.7, 7850),
      /positive finite E/
    );
    const solver = new ExplicitDynamicsCrashSolver();
    assert.strictEqual(solver.cflSafetyFactor, 0.9);
    const dtFromE = solver.calculateCriticalTimeStep(0.005, 200e9, 7850, 0.3);
    assert(dtFromE > 0);
    const dtDirect = solver.calculateCriticalTimeStep(0.005, 5000);
    assert(Math.abs(dtDirect - 9e-7) < 1e-12);
    assert.throws(() => solver.calculateCriticalTimeStep(0.005, 200e9, 7850, 3), /Poisson ratio/);
    assert.throws(() => solver.calculateCriticalTimeStep(-1, 5000), /positive finite characteristic length/);
    assert.throws(() => solver.calculateCriticalTimeStep(0.005, -1), /positive finite characteristic length/);
  });

  check('explicit dynamics: taylor bar impact solve and spec guards', () => {
    const crash = new ExplicitDynamicsCrashSolver({ cflSafetyFactor: 0.8 });
    const impact = crash.simulateTaylorBarImpact({
      length: 0.05,
      radius: 0.005,
      velocity: 200,
      yieldStress: 400e6,
      density: 7850,
      youngsModulus: 200e9,
      poissonsRatio: 0.3,
      elements: 10
    });
    assert.strictEqual(impact.success, true);
    assert(impact.finalLength < 0.05);
    assert(impact.mushroomRadius > 0.005);
    assert(impact.totalPlasticEnergyJ > 0);
    assert(impact.energyBalanceErrorPercent < 5);
    assert(impact.trace.length > 0);
    assert.throws(() => crash.simulateTaylorBarImpact({}), /positive finite bar geometry/);
    assert.throws(
      () =>
        crash.simulateTaylorBarImpact({
          barLength: 0.05,
          barRadius: 0.005,
          initialVelocity: 200,
          density: 7850,
          youngsModulus: 200e9,
          poissonsRatio: 0.3,
          yieldStress: 0
        }),
      /positive finite bar geometry/
    );
  });

  // ------------------------------------------------------------------
  // Conjugate heat transfer
  // ------------------------------------------------------------------
  check('cht: interface flux equation and validation branches', () => {
    const fluid = { T: 300, k: 0.6, wallDistance: 0.001 };
    const solid = { T: 350, k: 200, wallDistance: 0.002 };
    const res = ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux(fluid, solid, { area: 0.01, normal: [1, 0, 0] });
    assert(res.totalHeatPowerW > 0);
    assert.throws(
      () => ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux({}, solid, { area: 1 }),
      /explicit fluid cell/
    );
    assert.throws(
      () => ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux({ T: -1, k: 1, wallDistance: 1 }, solid, { area: 1 }),
      /must be positive/
    );
    assert.throws(
      () => ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux(fluid, solid, { area: 0 }),
      /positive finite interface face area/
    );
  });

  check('cht: coupled energy step with per-cell validation', () => {
    const pairs = [
      {
        fluidCell: { T: 300, k: 0.6, wallDistance: 0.001, rho: 1000, Cp: 4180, volume: 1e-6 },
        solidCell: { T: 350, k: 200, wallDistance: 0.002, rho: 2700, Cp: 900, volume: 1e-6 },
        face: { area: 1e-4 }
      }
    ];
    const out = ConjugateHeatTransferEngine.solveCoupledEnergyStep(pairs, 1e-3);
    assert.strictEqual(out.stepCompleted, true);
    assert(pairs[0].fluidCell.T > 300);
    assert.throws(() => ConjugateHeatTransferEngine.solveCoupledEnergyStep([], 0), /positive finite time step/);
    const bad = [
      {
        fluidCell: { T: 300, k: 0.6, wallDistance: 0.001, rho: 1000, Cp: 4180, volume: 0 },
        solidCell: { T: 350, k: 200, wallDistance: 0.002, rho: 2700, Cp: 900, volume: 1e-6 },
        face: { area: 1e-4 }
      }
    ];
    assert.throws(() => ConjugateHeatTransferEngine.solveCoupledEnergyStep(bad, 1e-3), /positive fluid cell density/);
  });

  // ------------------------------------------------------------------
  // Delaunay mesher 3D
  // ------------------------------------------------------------------
  check('delaunay3d: point/face/tet geometry branches', () => {
    const p1 = new Point3D(0, 0, 0, 0);
    const p2 = new Point3D(1, 0, 0, 1);
    const p3 = new Point3D(0, 1, 0, 2);
    const p4 = new Point3D(0, 0, 1, 3);
    assert.strictEqual(p1.distanceTo(p2), 1);
    const c = p1.clone();
    assert.strictEqual(c.id, 0);
    const face = new TriangleFace(p1, p2, p3);
    assert(face.area > 0);
    assert.strictEqual(face.getSortedEdgeKey(0, 1), '0-1');
    assert.strictEqual(face.getSortedFaceKey(), '0-1-2');
    const tet = new Tetrahedron(p1, p2, p3, p4, 7);
    assert(Math.abs(tet.volume - 1 / 6) < 1e-12);
    assert(tet.inCircumsphere(new Point3D(0.2, 0.2, 0.2)) !== undefined);
    const q = tet.computeQuality();
    assert(q.radiusRatio > 0);
    assert.strictEqual(tet.getFaces().length, 4);
    const flat = new Tetrahedron(
      new Point3D(0, 0, 0),
      new Point3D(1, 0, 0),
      new Point3D(2, 0, 0),
      new Point3D(3, 0, 0)
    );
    assert.strictEqual(flat.circumsphere.radius, 1e9);
    const noSphere = new Tetrahedron(p1, p2, p3, p4);
    noSphere.circumsphere = null;
    assert.strictEqual(noSphere.inCircumsphere(p1), false);
  });

  check('delaunay3d: meshClosedSurface pipeline and ray-triangle guards', () => {
    const mesher = new DelaunayMesher3D({ targetEdgeLength: 0.5, enableBoundaryLayers: false });
    assert.strictEqual(mesher.targetEdgeLength, 0.5);
    const verts = [new Point3D(0, 0, 0), new Point3D(1, 0, 0), new Point3D(0, 1, 0), new Point3D(0, 0, 1)];
    const faces = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 1],
      [1, 3, 2]
    ];
    const mesh = mesher.meshClosedSurface(verts, faces, { quadratic: false });
    assert(mesh.nodeCount > 0);
    assert(Array.isArray(mesh.elements));
    assert(mesh.metrics.totalVolume >= 0);
    const tri = new TriangleFace(verts[0], verts[1], verts[2]);
    assert.strictEqual(mesher._rayIntersectsTriangle({ x: 0.2, y: 0.2, z: 0.5 }, { x: 1, y: 0, z: 0 }, tri), false);
    assert.strictEqual(mesher._isPointInsideSurface(new Point3D(10, 10, 10), [tri]), false);
  });

  check('delaunay3d: hybrid prism-tet mesh fallbacks', () => {
    const mesher = new DelaunayMesher3D({ targetEdgeLength: 0.5 });
    const small = mesher.generateHybridPrismTetMesh(
      {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0]
        ],
        triangles: [[0, 1, 2]]
      },
      { firstLayerHeight: 0.001, layerCount: 2 },
      {}
    );
    assert.strictEqual(small.statistics.prismCount, 2);
    assert(Array.isArray(small.tets));
  });

  // ------------------------------------------------------------------
  // Constrained Delaunay 2D
  // ------------------------------------------------------------------
  check('delaunay2d: geometry helpers and winding branches', () => {
    assert(orient2d(0, 0, 1, 0, 0, 1) > 0);
    assert(orient2d(0, 0, 0, 1, 1, 0) < 0);
    assert.strictEqual(edgeKey(3, 1), '1-3');
    assert.strictEqual(
      pointInPolygonWinding(0.5, 0.5, [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ]),
      1
    );
    assert.strictEqual(
      pointInPolygonWinding(2, 2, [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ]),
      0
    );
    assert.strictEqual(segmentsIntersectStrict(0, 0, 1, 1, 0, 1, 1, 0), true);
    assert.strictEqual(segmentsIntersectStrict(0, 0, 1, 0, 2, 2, 3, 3), false);
    const rng = mulberry32(42);
    const a = rng();
    const b = rng();
    assert(a !== b);
    assert(a >= 0 && a < 1);
  });

  check('delaunay2d: triangulatePoints guards and collinear cleanup', () => {
    const d = new DelaunayConstrained2D();
    assert.strictEqual(d.tolerance, 1e-12);
    assert.strictEqual(d.seed, 1337);
    assert.throws(
      () =>
        d.triangulatePoints([
          [0, 0],
          [1, 1]
        ]),
      /at least 3 points/
    );
    const res = d.triangulatePoints([
      [0, 0],
      [1, 0],
      [0, 1]
    ]);
    assert.strictEqual(res.points.length, 3);
    assert(res.triangles.length >= 1);
    const collinear = d.triangulatePoints(
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1]
      ],
      {}
    );
    assert.strictEqual(collinear.points.length, 4);
    const dx = new DelaunayConstrained2D({ tolerance: 1e-10, seed: 7 });
    assert.strictEqual(dx.tolerance, 1e-10);
    assert.strictEqual(dx.seed, 7);
  });

  check('delaunay2d: polygon triangulation with holes, spacing, keepAll', () => {
    const d = new DelaunayConstrained2D();
    const boundary = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ];
    const holes = [
      [
        [0.3, 0.3],
        [0.7, 0.3],
        [0.7, 0.7],
        [0.3, 0.7]
      ]
    ];
    const mesh = d.triangulatePolygon(boundary, holes, { interiorSpacing: 0.09 });
    assert(mesh.nodes.length > 0);
    assert(mesh.metrics.triangleCount >= 0);
    assert.strictEqual(mesh.type, 'TRI3_CDT');
    assert.throws(
      () =>
        d.triangulatePolygon([
          [0, 0],
          [1, 1]
        ]),
      /boundary polygon/
    );
    const keepAll = d.triangulatePolygon(boundary, [], { keepAllTriangles: true, interiorPoints: [[0.5, 0.5]] });
    assert(keepAll.triangles.length >= 1);
    const extra = d.triangulatePolygon(boundary, [], { constraints: [[0, 2]] });
    assert(Array.isArray(extra.constrainedEdges));
  });

  // ------------------------------------------------------------------
  // Shell MITC4 element
  // ------------------------------------------------------------------
  check('shell mitc4: constructor guards and stiffness matrix branches', () => {
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    ];
    assert.throws(
      () => new ShellMITC4Element(0, [0, 1, 2, 3], coords, { thickness: 0, E: 1e11, nu: 0.3 }),
      /explicit thickness/
    );
    assert.throws(
      () => new ShellMITC4Element(0, [0, 1, 2, 3], coords, { thickness: 0.01, E: 1e11, nu: 0.6 }),
      /explicit thickness/
    );
    const el = new ShellMITC4Element(0, [0, 1, 2, 3], coords, { thickness: 0.01, E: 2e11, nu: 0.3 });
    assert.strictEqual(el.Dm[0][0] > 0, true);
    const Ke = el.computeStiffnessMatrix();
    assert.strictEqual(Ke.length, 24 * 24);
    assert(Ke[0] > 0);
    const degenerate = new ShellMITC4Element(
      1,
      [0, 1, 2, 3],
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 }
      ],
      { thickness: 0.01, E: 2e11, nu: 0.3 }
    );
    const Kd = degenerate.computeStiffnessMatrix();
    assert(Kd.length === 576);
  });

  // ------------------------------------------------------------------
  // Shell assembly
  // ------------------------------------------------------------------
  check('shell assembly: local stiffness and frame guards', () => {
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    ];
    const Ke = buildShellStiffnessLocal(coords, { thickness: 0.01, E: 2e11, nu: 0.3 });
    assert.strictEqual(Ke.length, 576);
    assert.throws(
      () =>
        buildShellStiffnessLocal(
          [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 }
          ],
          { thickness: 0.01, E: 2e11, nu: 0.3 }
        ),
      /Jacobian/
    );
  });

  check('shell assembly: plate mesh generation with holes and guards', () => {
    assert.throws(() => generatePlateMesh({ nx: 1, ny: 2, Lx: 1, Ly: 1 }), /integer divisions/);
    assert.throws(() => generatePlateMesh({ nx: 2, ny: 2, Lx: 0, Ly: 1 }), /positive finite numbers/);
    assert.throws(
      () => generatePlateMesh({ nx: 2, ny: 2, Lx: 1, Ly: 1, hole: { cx: 0.5, cy: 0.5, r: -1 } }),
      /Hole must be/
    );
    const plain = generatePlateMesh({ nx: 3, ny: 3, Lx: 1, Ly: 1 });
    assert.strictEqual(plain.nodes.length, 16);
    assert.strictEqual(plain.elements.length, 9);
    const circ = generatePlateMesh({ nx: 4, ny: 4, Lx: 1, Ly: 1, hole: { cx: 0.5, cy: 0.5, r: 0.3 } });
    assert(circ.nodes.length < 25);
    const rect = generatePlateMesh({ nx: 4, ny: 4, Lx: 1, Ly: 1, hole: { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 } });
    assert(rect.nodes.length < 25);
  });

  check('shell assembly: solver validation branches', () => {
    const asm = new ShellAssembly();
    assert.throws(() => asm.addNode(1, 2, NaN), /finite numbers/);
    asm.addNode(0, 0, 0);
    asm.addNode(1, 0, 0);
    asm.addNode(1, 1, 0);
    asm.addNode(0, 1, 0);
    assert.throws(() => asm.addElement([0, 1, 2], { thickness: 0.01, E: 1, nu: 0.3 }), /exactly 4 node ids/);
    assert.throws(() => asm.addElement([0, 0, 1, 2], { thickness: 0.01, E: 1, nu: 0.3 }), /duplicate node ids/);
    assert.throws(() => asm.addElement([0, 1, 2, 9], { thickness: 0.01, E: 1, nu: 0.3 }), /unknown node/);
    assert.throws(() => asm.addElement([0, 1, 2, 3], null), /explicit { thickness/);
    assert.throws(() => asm.addElement([0, 1, 2, 3], { thickness: 0.01, E: -1, nu: 0.3 }), /finite thickness/);
    const degenerateAsm = new ShellAssembly();
    degenerateAsm.addNode(0, 0, 0);
    degenerateAsm.addNode(1, 0, 0);
    degenerateAsm.addNode(2, 0, 0);
    degenerateAsm.addNode(0, 1, 0);
    assert.throws(() => degenerateAsm.addElement([0, 1, 2, 3], { thickness: 0.01, E: 1, nu: 0.3 }), /degenerate/);
    assert.throws(() => asm.fixDOF(99, 0), /unknown node/);
    assert.throws(() => asm.fixDOF(0, 7), /dofIndex/);
    assert.throws(() => asm.fixDOF(0, 0, NaN), /Prescribed displacement/);
    assert.throws(() => asm.fixNode(99, true), /unknown node/);
    assert.throws(() => asm.applyUniformPressure(NaN), /finite number/);
    assert.throws(() => asm.applyNodeLoad(99, 1, 1, 1), /unknown node/);
    assert.throws(() => asm.solveStatic(), /no nodes\/elements/);
  });

  check('shell assembly: plate solve with pressure and post-processing', () => {
    const asm = new ShellAssembly();
    const mesh = generatePlateMesh({ nx: 2, ny: 2, Lx: 1, Ly: 1 });
    for (const n of mesh.nodes) asm.addNode(n.x, n.y, n.z);
    for (const el of mesh.elements) asm.addElement(el.nodeIds, { thickness: 0.01, E: 2e11, nu: 0.3 });
    for (const n of mesh.nodes) {
      if (n.x < 1e-9 || n.x > 1 - 1e-9 || n.y < 1e-9 || n.y > 1 - 1e-9) {
        asm.fixDOF(n.id, 2);
      }
    }
    asm.fixDOF(0, 3).fixDOF(0, 4);
    asm.applyUniformPressure(10000);
    const res = asm.solveStatic();
    assert.strictEqual(res.status, 'solved');
    assert(res.maxDeflection > 0);
    assert(res.solverUsed.length > 0);
    assert(asm.results() === res);
    assert(Array.isArray(asm.displacementAt(0)));
    assert(typeof asm.deflectionAt(5) === 'number');
    const near = asm.nearestNodeDeflection(0.1, 0.1);
    assert(near.nodeId >= 0);
    const mom = asm.elementMoments(0);
    assert(Number.isFinite(mom.Mxx));
    assert.throws(() => asm.elementMoments(99), /Unknown element/);
    const empty = new ShellAssembly();
    assert.throws(() => empty.displacementAt(0), /Solve first/);
  });

  // ------------------------------------------------------------------
  // VOF multiphase
  // ------------------------------------------------------------------
  check('vof: constructor guards and mixture property clamps', () => {
    assert.throws(() => new VOFMultiphaseSolver({}), /explicit two-phase properties/);
    assert.throws(
      () => new VOFMultiphaseSolver({ surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 0 }),
      /Phase densities/
    );
    const vof = new VOFMultiphaseSolver({ surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 1.8e-5 });
    assert.strictEqual(vof.getMixtureProperties(0.5).density, 500.6);
    assert.strictEqual(vof.getMixtureProperties(2).alpha, 1);
    assert.strictEqual(vof.getMixtureProperties(-1).alpha, 0);
    assert.throws(() => vof.getMixtureProperties(NaN), /finite phase-1 volume fraction/);
  });

  check('vof: interface reconstruction, curvature, sweeps, and advection clips', () => {
    const vof = new VOFMultiphaseSolver({ surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 1.8e-5 });
    const nx = 8;
    const ny = 6;
    const dx = 0.1;
    const dy = 0.1;
    const C = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) C[j * nx + i] = i < 4 ? 1 : 0;
    const intf = vof.reconstructInterfaces(C, { nx, ny, dx, dy });
    assert.strictEqual(intf.normalsX.length, nx * ny);
    const flat = new Float64Array(nx * ny).fill(0.5);
    const flatIntf = vof.reconstructInterfaces(flat, { nx, ny, dx, dy });
    assert.strictEqual(flatIntf.normalsX[0], 0);
    const curv = vof.computeInterfaceCurvature(C, nx, ny, dx);
    assert.strictEqual(curv.kappa.length, nx * ny);
    const uField = new Float64Array(nx * ny).fill(0.5);
    const vField = new Float64Array(nx * ny).fill(0);
    const C2 = Float64Array.from(C);
    const res = vof.advect(C2, uField, vField, 0.01, { nx, ny, dx, dy });
    assert(res.massErrorRel < 0.2);
    assert(Number.isInteger(res.clipsApplied));
    const C3 = new Float64Array(nx * ny).fill(0.5);
    const resClip = vof.advect(C3, new Float64Array(nx * ny).fill(10), new Float64Array(nx * ny).fill(10), 0.1, {
      nx,
      ny,
      dx,
      dy
    });
    assert(resClip.clipsApplied >= 0);
  });

  check('vof: dam-break with small grid and guards', () => {
    const vof = new VOFMultiphaseSolver({ surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 1.8e-5 });
    assert.throws(
      () => vof.simulateDamBreak({ columnWidth: 0, columnHeight: 0.2, timeSec: 0.05 }),
      /positive column width/
    );
    const out = vof.simulateDamBreak({ columnWidth: 0.1, columnHeight: 0.2, timeSec: 0.05, gridX: 24 });
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.status, 'VOF_ADVECTION_SOLVED');
    assert(out.surgeFrontPositionM > 0);
    assert(Number.isFinite(out.massConservationErrorPercent));
    assert(out.trace.length > 0);
    assert(Number.isFinite(out.interfaceDiagnostics.meanInterfaceTiltRad));
  });

  // ------------------------------------------------------------------
  // Sliding mesh turbomachinery
  // ------------------------------------------------------------------
  check('turbomachinery: constructor defaults and slip correlations', () => {
    const m = new SlidingMeshTurbomachinery();
    assert.strictEqual(m.rpm, 3000);
    assert.strictEqual(m.slipCorrelation, 'wiesner');
    const w = m.computeSlipFactor();
    assert(w > 0 && w <= 1);
    const st = new SlidingMeshTurbomachinery({ slipCorrelation: 'stanitz', numberOfBlades: 7 });
    assert(st.computeSlipFactor() > 0);
    const badBlades = new SlidingMeshTurbomachinery();
    badBlades.numberOfBlades = 0;
    assert.throws(() => badBlades.computeSlipFactor(), /positive integer/);
  });

  check('turbomachinery: operating point branches and rotating-frame accelerations', () => {
    const m = new SlidingMeshTurbomachinery();
    const op = m.evaluatePumpOperatingPoint(0.001);
    assert(op.eulerHeadM > 0);
    assert(op.hydraulicEfficiencyPercent > 0);
    assert(op.shaftPowerW > 0);
    const tiny = m.evaluatePumpOperatingPoint(-5);
    assert.strictEqual(tiny.flowRateM3PerS, 1e-6);
    const acc = m.evaluateRotatingFrameAccelerations({ x: 0.1, y: 0, z: 0 }, { u: 1, v: 2, w: 0 });
    assert(acc.aCoriolis.y < 0);
    const mrf = m.calculateMRFAcceleration([1, 2, 0], [0, 0, 100], [0.1, 0, 0]);
    assert(mrf.magnitude > 0);
    const mrf2 = m.calculateMRFAcceleration({ u: 1, v: 2, w: 0 }, undefined, { x: 0.1, y: 0, z: 0 });
    assert(mrf2.magnitude > 0);
    const mrf3 = m.calculateMRFAcceleration({ u: 1, v: 2, w: 0 }, 50, { x: 0.1, y: 0, z: 0 });
    assert(mrf3.magnitude > 0);
    const lowE = new SlidingMeshTurbomachinery({
      bladeOutletAngleDeg: 75,
      bladeInletAngleDeg: 60,
      numberOfBlades: 3
    }).evaluatePumpOperatingPoint(0.02);
    assert(lowE.hydraulicEfficiency === null || Number.isFinite(lowE.hydraulicEfficiency));
    assert(Number.isFinite(lowE.shaftPowerW));
    assert(Number.isFinite(lowE.pressureRisePa));
  });

  check('turbomachinery: centrifugal curve restore and fallback results', () => {
    const m = new SlidingMeshTurbomachinery();
    const curve = m.evaluateCentrifugalPumpCurve(0.08, 0.012, 25, 3000);
    assert(curve.shutoffHeadM > 0);
    assert(Number.isFinite(curve.bepQ));
    assert.strictEqual(m.r2, 0.08);
    const curve2 = m.evaluateCentrifugalPumpCurve();
    assert(Number.isFinite(curve2.bepHeadM));
  });

  // ------------------------------------------------------------------
  // Simple Navier-Stokes
  // ------------------------------------------------------------------
  check('simplens: constructor defaults and rhie-chow face velocity', () => {
    const solver = new SimpleNavierStokesSolver({}, {});
    assert.strictEqual(solver.rho, 1.225);
    assert.strictEqual(solver.alphaU, 0.7);
    const face = { normal: { x: 1, y: 0, z: 0 }, area: 0.1 };
    const cL = { u: 1, v: 0, w: 0, p: 0, centroid: { x: 0, y: 0, z: 0 }, gradP: { x: 10, y: 0, z: 0 } };
    const cR = { u: 1, v: 0, w: 0, p: 1, centroid: { x: 1, y: 0, z: 0 } };
    const rc = solver.computeRhieChowFaceVelocity(face, cL, cR, 1e-4);
    assert(Number.isFinite(rc.un));
    const same = solver.computeRhieChowFaceVelocity(
      face,
      { u: 1, v: 0, w: 0, p: 0, centroid: { x: 0, y: 0, z: 0 } },
      { u: 1, v: 0, w: 0, p: 0, centroid: { x: 0, y: 0, z: 0 } },
      1e-4
    );
    assert(Number.isFinite(same.un));
  });

  check('simplens: SIMPLE iteration with interior, inlet, and gradient fallbacks', () => {
    const solver = new SimpleNavierStokesSolver({}, { density: 1.225, viscosity: 1.8e-5 });
    const cells = [
      { u: 0, v: 0, w: 0, p: 0, volume: 0.001, centroid: { x: 0, y: 0, z: 0 }, gradPPrime: { x: 1, y: 0, z: 0 } },
      { u: 0, v: 0, w: 0, p: 0, volume: 0.001, centroid: { x: 0.1, y: 0, z: 0 } },
      { u: 0, v: 0, w: 0, p: 0, volume: 0.001, centroid: { x: 0, y: 0.1, z: 0 } }
    ];
    const faces = [
      { leftCell: 0, rightCell: 1, area: 0.01, normal: { x: 1, y: 0, z: 0 } },
      { leftCell: 0, rightCell: 2, area: 0.01, normal: { x: 0, y: 1, z: 0 } },
      { leftCell: 0, rightCell: -1, boundaryType: 'inlet', area: 0.01, inletVelocity: 5 },
      { leftCell: -1, rightCell: 1, boundaryType: 'outlet', area: 0.01 }
    ];
    const m = solver.stepSIMPLE(cells, faces);
    assert(Number.isFinite(m.maxMassResidual));
    assert(Number.isFinite(m.maxMomentumResidual));
    assert(cells[0].u !== 0);
    const m2 = solver.stepSIMPLE(cells, faces);
    assert.strictEqual(m2.iteration, 2);
    assert(typeof m2.isConverged === 'boolean');
    const noNormal = { leftCell: 0, rightCell: 1, area: 0.01, normal: { x: 1, y: 0, z: 0 } };
    solver.stepSIMPLE(cells, [noNormal]);
    assert(Number.isFinite(cells[0].p));
  });

  // ------------------------------------------------------------------
  // Transonic Riemann solvers
  // ------------------------------------------------------------------
  check('riemann: roe flux with entropy-fix branches', () => {
    const left = { rho: 1.0, u: 100, v: 0, w: 0, p: 100000 };
    const right = { rho: 0.125, u: 0, v: 0, w: 0, p: 10000 };
    const f = TransonicRiemannSolver.solveRoeFlux(left, right);
    assert(f.massFlux !== 0);
    assert(f.scheme === 'roe');
    assert(f.waveSpeeds.aRoe > 0);
    const sub = TransonicRiemannSolver.solveRoeFlux(
      { rho: 1.2, u: 5, v: 0, w: 0, p: 101325 },
      { rho: 1.2, u: 4, v: 0, w: 0, p: 101300 },
      { x: 0, y: 1, z: 0 },
      2.0,
      1.3
    );
    assert(Number.isFinite(sub.massFlux));
    const defaults = TransonicRiemannSolver.solveRoeFlux({}, {});
    assert(defaults.waveSpeeds.aRoe >= 1);
  });

  check('riemann: AUSM+ mach-splitting and sign branches', () => {
    const f = TransonicRiemannSolver.solveAUSMPlusFlux(
      { rho: 1.0, u: 300, v: 0, w: 0, p: 100000 },
      { rho: 0.125, u: 0, v: 0, w: 0, p: 10000 }
    );
    assert(f.interfaceMach >= -1 && f.interfaceMach <= 1);
    const supersonic = TransonicRiemannSolver.solveAUSMPlusFlux(
      { rho: 1.0, u: 2000, v: 0, w: 0, p: 100000 },
      { rho: 1.0, u: 1900, v: 0, w: 0, p: 100000 }
    );
    assert(supersonic.massFlux > 0);
    const supersonicOut = TransonicRiemannSolver.solveAUSMPlusFlux(
      { rho: 1.0, u: -2000, v: 0, w: 0, p: 100000 },
      { rho: 1.0, u: -2100, v: 0, w: 0, p: 100000 }
    );
    assert(supersonicOut.massFlux < 0);
    const mid = TransonicRiemannSolver.solveAUSMPlusFlux(
      { rho: 1.0, u: 150, v: 0, w: 0, p: 100000 },
      { rho: 1.0, u: 140, v: 0, w: 0, p: 100000 }
    );
    assert(Number.isFinite(mid.momFlux));
  });

  check('riemann: HLLC wave-branch coverage', () => {
    const leftSup = TransonicRiemannSolver.solveHLLCFlux(
      { rho: 1.0, u: 2000, v: 0, w: 0, p: 100000 },
      { rho: 1.0, u: 1900, v: 0, w: 0, p: 100000 }
    );
    assert.strictEqual(leftSup.scheme, 'hllc');
    assert(leftSup.massFlux > 0);
    const rightSup = TransonicRiemannSolver.solveHLLCFlux(
      { rho: 1.0, u: -2000, v: 0, w: 0, p: 100000 },
      { rho: 1.0, u: -2100, v: 0, w: 0, p: 100000 }
    );
    assert(rightSup.massFlux < 0);
    const starL = TransonicRiemannSolver.solveHLLCFlux(
      { rho: 1.0, u: 200, v: 0, w: 0, p: 100000 },
      { rho: 0.5, u: -200, v: 0, w: 0, p: 20000 }
    );
    assert(Number.isFinite(starL.massFlux));
    const starR = TransonicRiemannSolver.solveHLLCFlux(
      { rho: 0.5, u: -200, v: 0, w: 0, p: 20000 },
      { rho: 1.0, u: 200, v: 0, w: 0, p: 100000 }
    );
    assert(Number.isFinite(starR.massFlux));
  });

  check('riemann: sod shock tube integration and boundary ghosts', () => {
    const out = TransonicRiemannSolver.runShockTube1D(20, 0.003, 0.4);
    assert.strictEqual(out.success, true);
    assert(out.steps > 0);
    assert(out.maxMach > 0);
    assert.strictEqual(out.cells.length, 20);
    const out2 = TransonicRiemannSolver.runShockTube1D(16, 0.0001, 0.9);
    assert(out2.steps > 0);
  });

  // ------------------------------------------------------------------
  // Venkatakrishnan limiter
  // ------------------------------------------------------------------
  check('venkatakrishnan: limiter branches empty/positive/negative/neutral', () => {
    const cell = { value: 1.0, volume: 1e-3, centroid: { x: 0, y: 0, z: 0 } };
    assert.strictEqual(VenkatakrishnanLimiter.computeCellLimiter(cell, [], { x: 0, y: 0, z: 0 }), 1.0);
    const nbUp = [{ value: 2.0, centroid: { x: 0.1, y: 0, z: 0 } }];
    const limUp = VenkatakrishnanLimiter.computeCellLimiter(cell, nbUp, { x: 1, y: 0, z: 0 });
    assert(limUp >= 0 && limUp <= 1);
    const nbDown = [{ value: 0.0, centroid: { x: 0.1, y: 0, z: 0 } }];
    const limDown = VenkatakrishnanLimiter.computeCellLimiter(cell, nbDown, { x: -1, y: 0, z: 0 });
    assert(limDown >= 0 && limDown <= 1);
    const limFlat = VenkatakrishnanLimiter.computeCellLimiter(cell, nbUp, { x: 0, y: 0, z: 0 });
    assert.strictEqual(limFlat, 1.0);
  });

  // ------------------------------------------------------------------
  // Radiation DOM
  // ------------------------------------------------------------------
  check('radiation: radiative flux h-radius branches and emissivity clamps', () => {
    const r = RadiationDOMEngine.evaluateRadiativeFlux({ T: 500 }, { T: 300 });
    assert(r.qRadWm2 > 0);
    assert(r.radiativeConductanceHr > 0);
    const equal = RadiationDOMEngine.evaluateRadiativeFlux({ T: 300 }, { T: 300 });
    assert.strictEqual(equal.qRadWm2, 0);
    assert(equal.radiativeConductanceHr > 0);
    const clamped = RadiationDOMEngine.evaluateRadiativeFlux({ T: 500, emissivity: 3 }, { T: 300, emissivity: 0 });
    assert(clamped.equivalentEmissivity < 1);
    const f = RadiationDOMEngine.evaluateRadiativeFlux({ T: 500 }, { T: 300 }, 0.5);
    assert(f.qRadWm2 < r.qRadWm2);
    assert(SIGMA_STEFAN_BOLTZMANN > 0);
  });

  check('radiation: S4 quadrature generates 24 directions', () => {
    const dirs = RadiationDOMEngine.getS4QuadratureDirections();
    assert.strictEqual(dirs.length, 24);
    assert(dirs.every((d) => Number.isFinite(d.weight)));
  });

  // ------------------------------------------------------------------
  // Random vibration PSD
  // ------------------------------------------------------------------
  check('psd: miles equation defaults and outputs', () => {
    const res = RandomVibrationPSDEngine.evaluateMilesVibration({});
    assert.strictEqual(res.naturalFrequencyHz, 150);
    assert.strictEqual(res.qualityFactorQ, 10);
    assert(res.acceleration3SigmaG > res.acceleration1SigmaG);
    const custom = RandomVibrationPSDEngine.evaluateMilesVibration({
      naturalFrequencyHz: 200,
      dampingRatio: 0.1,
      psdLevelG2Hz: 0.1,
      staticStressPerG: 2e6
    });
    assert.strictEqual(custom.qualityFactorQ, 5);
  });

  check('psd: curve integration log-log, slope -1, and fallback branches', () => {
    const short = RandomVibrationPSDEngine.integratePSDCurve([{ f: 20, psd: 0.04 }]);
    assert.strictEqual(short.overallGrms, 0);
    const logLog = RandomVibrationPSDEngine.integratePSDCurve([
      { f: 20, psd: 0.04 },
      { f: 2000, psd: 0.001 }
    ]);
    assert(logLog.overallGrms > 0);
    const minusOne = RandomVibrationPSDEngine.integratePSDCurve([
      { f: 1, psd: 1 },
      { f: 2, psd: 0.5 }
    ]);
    assert(minusOne.totalArea > 0);
    const linear = RandomVibrationPSDEngine.integratePSDCurve([
      { f: 20, psd: 0 },
      { f: 2000, psd: 0.04 }
    ]);
    assert(linear.overallGrms > 0);
  });

  // ------------------------------------------------------------------
  // Prism layer mesher
  // ------------------------------------------------------------------
  check('prism: first-layer-height guards and computation', () => {
    assert.throws(() => PrismLayerMesher.calculateFirstLayerHeight({}), /Velocity must be positive/);
    assert.throws(
      () =>
        PrismLayerMesher.calculateFirstLayerHeight({
          velocity: 10,
          density: 0,
          viscosity: 1,
          refLength: 1,
          targetYPlus: 1
        }),
      /Density must be positive/
    );
    assert.throws(
      () =>
        PrismLayerMesher.calculateFirstLayerHeight({
          velocity: 10,
          density: 1.2,
          viscosity: 0,
          refLength: 1,
          targetYPlus: 1
        }),
      /Viscosity must be positive/
    );
    assert.throws(
      () =>
        PrismLayerMesher.calculateFirstLayerHeight({
          velocity: 10,
          density: 1.2,
          viscosity: 1,
          refLength: 0,
          targetYPlus: 1
        }),
      /Reference length must be positive/
    );
    assert.throws(
      () =>
        PrismLayerMesher.calculateFirstLayerHeight({
          velocity: 10,
          density: 1.2,
          viscosity: 1,
          refLength: 1,
          targetYPlus: 0
        }),
      /Target y\+ must be positive/
    );
    const h = PrismLayerMesher.calculateFirstLayerHeight({
      velocity: 30,
      density: 1.225,
      viscosity: 1.8e-5,
      refLength: 1,
      targetYPlus: 1
    });
    assert(h.firstLayerHeightM > 0);
    assert(h.reynoldsNumber > 100);
  });

  check('prism: layer generation guards, zero-normal fallback, and volumes', () => {
    assert.throws(() => PrismLayerMesher.generatePrismLayers({ vertices: [], triangles: [] }), /Empty vertices array/);
    assert.throws(
      () => PrismLayerMesher.generatePrismLayers({ vertices: [[0, 0, 0]], triangles: [] }),
      /Empty triangles array/
    );
    assert.throws(
      () => PrismLayerMesher.generatePrismLayers({ vertices: [[0, 0, 0]], triangles: [[0, 0, 0]] }),
      /firstLayerHeight must be positive/
    );
    const mesh = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      triangles: [[0, 1, 2]]
    };
    const out = PrismLayerMesher.generatePrismLayers(mesh, {
      firstLayerHeight: 0.001,
      growthRatio: 1.2,
      layerCount: 3
    });
    assert.strictEqual(out.prismElementCount, 3);
    assert(out.allVertices.length > 3);
    assert(out.minElementVolume > 0);
    assert.strictEqual(out.invertedElementCount, 0);
    const cancelled = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 1]
      ]
    };
    const out2 = PrismLayerMesher.generatePrismLayers(cancelled, { firstLayerHeight: 0.001, layerCount: 2 });
    assert(out2.prismElementCount > 0);
  });

  // ------------------------------------------------------------------
  // TET10 / HEX20 elements
  // ------------------------------------------------------------------
  function tet10Nodes() {
    const n = [];
    n.push({ x: 0, y: 0, z: 0 });
    n.push({ x: 1, y: 0, z: 0 });
    n.push({ x: 0, y: 1, z: 0 });
    n.push({ x: 0, y: 0, z: 1 });
    n.push({ x: 0.5, y: 0, z: 0 });
    n.push({ x: 0.5, y: 0.5, z: 0 });
    n.push({ x: 0, y: 0.5, z: 0 });
    n.push({ x: 0, y: 0, z: 0.5 });
    n.push({ x: 0.5, y: 0, z: 0.5 });
    n.push({ x: 0, y: 0.5, z: 0.5 });
    return n;
  }

  check('tet10: stiffness matrix and centroid stress', () => {
    const el = new ElementTET10(
      0,
      Array.from({ length: 10 }, (_, i) => i),
      tet10Nodes(),
      200e9,
      0.3
    );
    assert(el.volume > 0);
    const K = el.computeStiffnessMatrix();
    assert.strictEqual(K.length, 900);
    assert(K[0] > 0);
    const u = new Float64Array(30);
    for (let i = 0; i < 30; i++) u[i] = 1e-5;
    const s = el.computeStress(u);
    assert(s.vonMises > 0);
    assert.strictEqual(s.stresses.length, 6);
    const flat = new ElementTET10(
      1,
      Array.from({ length: 10 }, (_, i) => i),
      tet10Nodes().map(() => ({ x: 0, y: 0, z: 0 })),
      200e9,
      0.3
    );
    const KFlat = flat.computeStiffnessMatrix();
    assert(KFlat.length === 900);
  });

  function hex20Nodes() {
    const n = [];
    for (let i = 0; i < 20; i++) {
      const nat = ElementHEX20.NATURAL_COORDS[i];
      n.push({ x: nat[0], y: nat[1], z: nat[2] });
    }
    return n;
  }

  check('hex20: shape derivatives, volume, stiffness, and stress', () => {
    const el = new ElementHEX20(
      0,
      Array.from({ length: 20 }, (_, i) => i),
      hex20Nodes(),
      200e9,
      0.3
    );
    assert(Math.abs(el.volume - 8) < 1e-9);
    const { dN_dxi, dN_deta, dN_dzeta } = el._evalShapeDerivatives(0, 0, 0);
    assert.strictEqual(dN_dxi.length, 20);
    const mid = el._evalShapeDerivatives(1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3));
    assert(mid.dN_dxi.length === 20);
    const K = el.computeStiffnessMatrix();
    assert.strictEqual(K.length, 3600);
    assert(K[0] > 0);
    const u = new Float64Array(60).fill(1e-5);
    const s = el.computeStress(u);
    assert(s.vonMises > 0);
    assert(Number.isFinite(s.sxx));
    const inverted = new ElementHEX20(
      1,
      Array.from({ length: 20 }, (_, i) => i),
      [
        { x: 1, y: 1, z: 1 },
        { x: -1, y: 1, z: 1 },
        { x: -1, y: -1, z: 1 },
        { x: 1, y: -1, z: 1 },
        { x: 1, y: 1, z: -1 },
        { x: -1, y: 1, z: -1 },
        { x: -1, y: -1, z: -1 },
        { x: 1, y: -1, z: -1 },
        { x: 0, y: 1, z: 1 },
        { x: -1, y: 0, z: 1 },
        { x: 0, y: -1, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 1, z: -1 },
        { x: -1, y: 0, z: -1 },
        { x: 0, y: -1, z: -1 },
        { x: 1, y: 0, z: -1 },
        { x: 1, y: 1, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: -1, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 }
      ],
      200e9,
      0.3
    );
    const Ki = inverted.computeStiffnessMatrix();
    assert(Ki.length === 3600);
  });

  // ------------------------------------------------------------------
  // Penalty contact
  // ------------------------------------------------------------------
  check('penalty: instance contact branches and defaults', () => {
    const c = new PenaltyContact();
    assert.strictEqual(c.penaltyStiffness, 1e8);
    assert.strictEqual(c.frictionCoeff, 0.35);
    const hit = c.evaluateNodeContact({ pos: [0, 0, -0.01], vel: [1, 0, -2] }, {});
    assert.strictEqual(hit.inContact, true);
    assert(hit.normalForceN > 0);
    assert(hit.strainEnergyJ > 0);
    const miss = c.evaluateNodeContact({ pos: [0, 0, 1], vel: [0, 0, 0] }, {});
    assert.strictEqual(miss.inContact, false);
    assert.strictEqual(miss.normalForceN, 0);
    const custom = new PenaltyContact({ penaltyStiffness: 1e7, frictionCoeff: 0.1 });
    assert.strictEqual(custom.penaltyStiffness, 1e7);
  });

  check('penalty: static evaluateContact with friction/no-friction branches', () => {
    const nodes = [
      { id: 0, pos: [0, 0, -1], vel: [2, 0, 0], mass: 0.1 },
      { id: 1, pos: [0, 0, -1], vel: [0, 0, 0], mass: 0.1 },
      { id: 2, pos: [0, 0, 5], vel: [0, 0, 0], mass: 0.1 }
    ];
    const res = PenaltyContact.evaluateContact(nodes, { normal: [0, 0, 1] });
    assert.strictEqual(res.activeContactCount, 2);
    assert(res.totalNormalForceN > 0);
    assert(res.totalFrictionForceN > 0);
    const noVel = PenaltyContact.evaluateContact([{ id: 0, pos: [0, 0, -0.5] }], {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      frictionCoeff: 0.5,
      penaltyStiffness: 1000
    });
    assert.strictEqual(noVel.contacts[0].frictionMagnitudeN, 0);
    const none = PenaltyContact.evaluateContact([{ id: 0, pos: [0, 0, 5] }], {});
    assert.strictEqual(none.hasContact, false);
  });

  check('penalty: applyContactForces no-contact and mass default branches', () => {
    const nodes = [{ id: 'a', pos: [0, 0, 0] }];
    assert.strictEqual(PenaltyContact.applyContactForces(nodes, { hasContact: false }), nodes);
    const withContact = PenaltyContact.applyContactForces([{ id: 'a', vel: [0, 0, 0] }], {
      hasContact: true,
      contacts: [{ nodeId: 'a', totalForceN: [10, 0, 0] }]
    });
    assert(withContact[0].accel[0] > 0);
    const heavy = PenaltyContact.applyContactForces([{ id: 'b', mass: 2 }], {
      hasContact: true,
      contacts: [{ nodeId: 'b', totalForceN: [10, 0, 0] }]
    });
    assert.strictEqual(heavy[0].accel[0], 5);
  });

  check('penalty: augmented Lagrangian iterations and convergence guards', () => {
    const nodes = [
      { id: 0, pos: [0, 0, -0.01], vel: [1, 0, 0] },
      { id: 1, pos: [0, 0, -0.02] }
    ];
    const res = PenaltyContact.evaluateAugmentedLagrangianContact(
      nodes,
      { normal: [0, 0, 1], penaltyStiffness: 1000, frictionCoeff: 0.2 },
      3,
      1e-4
    );
    assert.strictEqual(res.converged, true);
    assert(res.iterations >= 1);
    assert(res.totalNormalForceN > 0);
    const res2 = PenaltyContact.evaluateAugmentedLagrangianContact([{ id: 0, pos: [0, 0, 1] }], {});
    assert.strictEqual(res2.hasContact, false);
  });

  // ------------------------------------------------------------------
  // Contact FEM 3D
  // ------------------------------------------------------------------
  check('contactfem: linear solver classes branch coverage', () => {
    const d = new DenseSolver(2);
    d.add(0, 0, 2);
    d.add(0, 1, 1);
    d.add(1, 0, 1);
    d.add(1, 1, 2);
    const dx = d.solve([1, 2]);
    assert(Math.abs(dx[0] - 0) < 1e-9);
    const singular = new DenseSolver(2);
    assert.throws(() => singular.factorize(), /zero pivot/);
    const b = new BandedCholesky(3, 2);
    b.add(0, 0, 4);
    b.add(0, 1, 1);
    b.add(1, 1, 3);
    b.add(1, 2, 1);
    b.add(2, 2, 2);
    const bx = b.solve([1, 2, 3]);
    assert(Number.isFinite(bx[2]));
    assert.throws(() => b.add(0, 2, 1), /out of band/);
    const bad = new BandedCholesky(2, 2);
    bad.add(0, 0, -1);
    bad.add(1, 1, 1);
    assert.throws(() => bad.factorize(), /non-positive pivot/);
    const sh = hex8Shape(0, 0, 0);
    assert.strictEqual(sh.N.length, 8);
  });

  check('contactfem: solver guards and small hex solve', () => {
    assert.throws(() => new ContactFEM3D({ E: 0, nu: 0.3 }), /E must be a positive finite/);
    assert.throws(() => new ContactFEM3D({ E: 1, nu: 0.7 }), /nu must be in/);
    const solver = new ContactFEM3D({ E: 200e9, nu: 0.3 });
    for (let z = 0; z < 2; z++) {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          solver.addNode(x, y, z);
        }
      }
    }
    solver.addHex([0, 1, 3, 2, 4, 5, 7, 6]);
    assert.throws(() => solver.addHex([0, 1, 2]), /exactly 8 node ids/);
    solver.fixNode(0, true, true, true);
    solver.fixNode(1, true, true, true);
    solver.fixNode(2, true, true, true);
    solver.fixNode(3, true, true, true);
    solver.prescribeDisplacement(7, 2, -0.001);
    solver.applyNodalLoad(6, 0, 0, -100);
    const res = solver.solve({});
    assert.strictEqual(res.solverExecuted, true);
    assert(res.dofCount > 0);
    assert(Array.isArray(res.reactions.total));
    assert(Number.isFinite(res.maxPressurePa));
    assert.strictEqual(solver.contactPressures(), res);
    const empty = new ContactFEM3D({ E: 1, nu: 0.3 });
    assert.throws(() => empty.solve(), /mesh is empty/);
    const emptyN = new ContactFEM3D({ E: 1, nu: 0.3 });
    emptyN.addNode(0, 0, 0);
    assert.throws(() => emptyN.solve(), /mesh is empty/);
  });

  // ------------------------------------------------------------------
  // Contact mechanics 3D
  // ------------------------------------------------------------------
  check('contact mechanics: hertz analytical and quadrature branches', () => {
    const cm = new ContactMechanics3D();
    assert.strictEqual(cm.penaltyStiffness, 1e10);
    const params = { radius1: 0.02, load: 1000, E1: 200e9, nu1: 0.3, E2: 200e9, nu2: 0.3 };
    const a = cm.computeAnalyticalHertz(params);
    assert(a.contactRadiusMm > 0);
    assert(a.maxPressurePa > 0);
    const halfSpace = cm.computeAnalyticalHertz({ ...params, radius2: Infinity });
    assert(halfSpace.contactRadiusMm > 0);
    const solved = cm.solveSphereOnFlatContact(params);
    assert.strictEqual(solved.status, 'estimate-only');
    assert.strictEqual(solved.solverExecuted, false);
    assert(solved.profileMaxPressureErrorPercent < 5);
    assert(solved.integratedForceErrorPercent < 5);
    assert(Number.isFinite(solved.profileQuadrature.totalForceNewtons));
    const custom = new ContactMechanics3D({
      penaltyStiffness: 5e9,
      frictionCoefficient: 0.5,
      maxIterations: 5,
      tolerance: 1e-5
    });
    assert.strictEqual(custom.penaltyStiffness, 5e9);
  });

  // ------------------------------------------------------------------
  // FEA structural
  // ------------------------------------------------------------------
  check('fea: material resolution paths and element guards', () => {
    const solver = new FEASolver();
    const n0 = solver.addNode(0, 0, 0);
    assert.strictEqual(n0.id, 0);
    assert.throws(() => solver.addElement([0, 1, 2, 3], null), /Explicit material properties/);
    assert.throws(() => solver.addElement([0, 1, 2, 3], { E: 0, nu: 0.3, yieldStress: 1 }), /finite E/);
    assert.throws(
      () => solver.addElement([0, 1, 2, 3], 'NOT_A_MATERIAL'),
      /not present in the certified material database/
    );
    assert.throws(
      () => solver.addElement([0, 1, 2, 3], { materialId: 'NOPE', nu: 0.3 }),
      /not present in the certified material database/
    );
    const el = solver.addElement([0, 1, 2, 3], { materialId: 'AL-7075-T6', yieldStress: 400e6 });
    assert(Number.isFinite(el.material.E));
    assert.strictEqual(el.material.name, 'Aluminum alloy 7075-T6 (wrought, T6 heat treated)');
    const elObj = solver.addElement([0, 1, 2, 3], { E: 100e9, nu: 0.3, yieldStress: 200e6 });
    assert.strictEqual(elObj.material.E, 100e9);
    solver.fixNode(99);
    assert.strictEqual(solver.nodes[99], undefined);
    solver.applyForce(99, 1, 1, 1);
    assert.strictEqual(solver.nodes[99], undefined);
  });

  check('fea: empty solve and tet4 solve with prescribed displacement', () => {
    const solver = new FEASolver();
    const res = solver.solveStatic();
    assert.strictEqual(res.status, 'empty');
    const s2 = new FEASolver();
    s2.addNode(0, 0, 0);
    s2.addNode(1, 0, 0);
    s2.addNode(0, 1, 0);
    s2.addNode(0, 0, 1);
    s2.addElement([0, 1, 2, 3], { E: 70e9, nu: 0.33, yieldStress: 300e6 });
    s2.fixNode(0, true, true, true, [0.001, 0.002, 0.003]);
    s2.applyForce(3, 0, 0, -1000);
    const r2 = s2.solve();
    assert(r2.maxStress > 0);
    assert(r2.safetyFactor > 0);
    assert.strictEqual(r2.dofCount, 12);
    assert(typeof s2.computeRelativeEquilibriumResidual() === 'number');
    assert.strictEqual(new FEASolver().computeRelativeEquilibriumResidual(), null);
  });

  check('fea: tet10 and hex20 element solves', () => {
    const s10 = new FEASolver();
    const nodes = tet10Nodes();
    for (const n of nodes) s10.addNode(n.x, n.y, n.z);
    s10.addElement([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { E: 70e9, nu: 0.33, yieldStress: 300e6 });
    for (const i of [0, 1, 2, 3]) s10.fixNode(i);
    s10.applyForce(9, 0, 0, -1000);
    const r10 = s10.solveStatic();
    assert(r10.maxStress >= 0);
    const s20 = new FEASolver();
    const h20 = hex20Nodes().map((n) => ({ x: n.x * 0.1, y: n.y * 0.1, z: n.z * 0.1 }));
    for (const n of h20) s20.addNode(n.x, n.y, n.z);
    s20.addElement([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], {
      E: 70e9,
      nu: 0.33,
      yieldStress: 300e6
    });
    for (const i of [0, 1, 2, 3, 8, 9, 10, 11]) s20.fixNode(i);
    s20.applyForce(6, 0, 0, -1000);
    const r20 = s20.solveStatic();
    assert(r20.maxStress >= 0);
  });

  check('fea: degenerate tetrahedron fails closed', () => {
    const solver = new FEASolver();
    solver.addNode(0, 0, 0);
    solver.addNode(1, 0, 0);
    solver.addNode(2, 0, 0);
    solver.addNode(3, 0, 0);
    solver.addElement([0, 1, 2, 3], { E: 70e9, nu: 0.33, yieldStress: 300e6 });
    solver.fixNode(0);
    solver.applyForce(3, 0, 0, -1000);
    assert.throws(() => solver.solveStatic(), /Degenerate tetrahedral element|system solve failed/);
  });

  // ------------------------------------------------------------------
  // FEA engine adapter
  // ------------------------------------------------------------------
  check('fea adapter: linear elastic, meshing, drop test, and validation errors', async () => {
    const adapter = new FEAEngineAdapter();
    assert.strictEqual(adapter.domain, 'cae');
    assert(adapter.describeCapabilities().supportedOperations.includes('drop_test'));
    const events = [];
    const onEvent = (e) => events.push(e);
    const job = {
      jobId: 'j1',
      domain: 'cae',
      operation: 'linear_elastic_3d',
      parameters: {
        nodes: [
          { x: 0, y: 0, z: 0, fixed: [true, true, true] },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1, force: [0, 0, -1000] }
        ],
        elements: [{ nodes: [0, 1, 2, 3], material: { E: 70e9, nu: 0.33, yieldStress: 300e6 } }]
      }
    };
    const result = await adapter.execute(job, onEvent);
    assert(result.status === 'COMPLETED');
    assert(result.outputData.maxStress > 0);
    assert(events.some((e) => e.type === 'STARTED'));
    const meshJob = {
      jobId: 'j2',
      domain: 'cae',
      operation: 'mesh_planar_polygon_2d',
      parameters: {
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1]
        ]
      }
    };
    const meshRes = await adapter.execute(meshJob, onEvent);
    assert(meshRes.outputData.type === 'TRI3_CDT');
    const badMesh = {
      jobId: 'j3',
      domain: 'cae',
      operation: 'mesh_planar_polygon_2d',
      parameters: {
        polygon: [
          [0, 0],
          [1, 0]
        ]
      }
    };
    await assert.rejects(() => adapter.execute(badMesh, onEvent), /at least 3 vertices/);
    const dropJob = {
      jobId: 'j4',
      domain: 'cae',
      operation: 'drop_test',
      parameters: { dropHeightM: 1.5, phoneMassKg: 0.2, impactAngle: 'corner' }
    };
    const dropRes = await adapter.execute(dropJob, onEvent);
    assert(dropRes.outputData.peakForce_N > 0);
    const badDrop = {
      jobId: 'j5',
      domain: 'cae',
      operation: 'drop_test',
      parameters: { dropHeightM: 1.5, phoneMassKg: 0.2, impactAngle: 'side' }
    };
    await assert.rejects(() => adapter.execute(badDrop, onEvent), /drop_test requires/);
    await assert.rejects(
      () => adapter.execute({ jobId: 'j6', domain: 'wrong', operation: 'drop_test', parameters: {} }),
      /Domain mismatch/
    );
    await assert.rejects(
      () => adapter.execute({ jobId: 'j7', domain: 'cae', operation: 'nope', parameters: {} }),
      /not supported/
    );
    const aborted = {
      jobId: 'j8',
      domain: 'cae',
      operation: 'drop_test',
      parameters: { dropHeightM: 1.5, phoneMassKg: 0.2, impactAngle: 'face' }
    };
    await assert.rejects(() => adapter.execute(aborted, onEvent, { aborted: true }), /cancelled/i);
  });

  // ------------------------------------------------------------------
  // CFD engine adapter
  // ------------------------------------------------------------------
  check('cfd adapter: incompressible flow, fvm path, and aborts', async () => {
    const adapter = new CFDEngineAdapter();
    assert.strictEqual(adapter.domain, 'cfd');
    const onEvent = () => {};
    const job = {
      jobId: 'c1',
      domain: 'cfd',
      operation: 'incompressible_flow',
      parameters: { nx: 4, ny: 4, nz: 4, maxIterations: 3 }
    };
    const res = await adapter.execute(job, onEvent);
    assert.strictEqual(res.status, 'COMPLETED');
    assert(res.outputData.cellCount > 0);
    const fvmJob = {
      jobId: 'c2',
      domain: 'cfd',
      operation: 'fvm_navier_stokes_3d',
      parameters: { nx: 4, ny: 4, nz: 4, steps: 3, inletVelocity: 10 }
    };
    const fvmRes = await adapter.execute(fvmJob, onEvent);
    assert(fvmRes.outputData.stepCount > 0);
    const abortState = { aborted: false };
    const abortJob = {
      jobId: 'c3',
      domain: 'cfd',
      operation: 'incompressible_flow',
      parameters: { nx: 4, ny: 4, nz: 4, maxIterations: 50 }
    };
    await assert.rejects(
      () =>
        adapter.execute(
          abortJob,
          (e) => {
            if (e.type === 'RESIDUAL') abortState.aborted = true;
          },
          abortState
        ),
      /cancelled/i
    );
    await assert.rejects(
      () =>
        adapter.execute({ jobId: 'c4', domain: 'cfd', operation: 'fvm_navier_stokes_3d', parameters: {} }, onEvent, {
          aborted: true
        }),
      /cancelled/i
    );
  });

  // ------------------------------------------------------------------
  // Beam dynamic response
  // ------------------------------------------------------------------
  check('beam dynamics: seeded rng and euler-buckling helpers', () => {
    const rng1 = createSeededRandom(1234);
    const rng2 = createSeededRandom(1234);
    for (let i = 0; i < 5; i++) assert.strictEqual(rng1(), rng2());
    assert(CANTILEVER_BETA1L > 1.8);
    const omega = eulerBernoulliCantileverOmega1({ E: 200e9, I: 1e-8, rho: 7850, A: 1e-4, L: 1 });
    assert(omega > 0);
    assert(eulerBernoulliCantileverFrequencyHz(omega) > 0);
  });

  check('beam dynamics: assemble, modal subspace, frf, psd', () => {
    const nodesY = [0, 0.25, 0.5, 0.75, 1.0];
    const elements = [];
    for (let i = 0; i < 4; i++) elements.push({ a: i, b: i + 1, width: 0.05, depth: 0.1 });
    const fixed = new Set([0, 1]);
    const system = assembleBeamSystem({
      nodesY,
      elements,
      E: 200e9,
      nu: 0.3,
      rho: 7850,
      fixedDofs: fixed,
      masses: new Map([[4, 0.5]]),
      springDofs: new Map([[7, 1e6]])
    });
    assert(system.nr > 0);
    assert.throws(
      () =>
        assembleBeamSystem({ nodesY: [0, 0], elements: [{ a: 0, b: 1, width: 1, depth: 1 }], E: 1, nu: 0.3, rho: 1 }),
      /non-positive element length/
    );
    const modal = solveModalSubspace(system, { count: 3, maxIter: 200 });
    assert(modal.modes.length === 3);
    assert(modal.modes[0].fHz > 0);
    const aB = rayleighFromTargets([modal.modes[0].omega, modal.modes[1].omega], [0.02, 0.02]);
    assert(Number.isFinite(aB.alpha));
    const aSingle = rayleighFromTargets([100], [0.02]);
    assert(Number.isFinite(aSingle.beta));
    const frf = harmonicFRF(system, {
      modes: modal.modes,
      frequenciesHz: [1, 10, 50, 100, 200, 500, 1000],
      alpha: aB.alpha,
      beta: aB.beta,
      loadDof: 0,
      responseDof: 0
    });
    assert.strictEqual(frf.length, 7);
    assert(frf.every((p) => Number.isFinite(p.mag)));
    const psd = randomVibrationPSD(system, {
      modes: modal.modes,
      inputPsd: [
        { f: 1, S: 0.1 },
        { f: 10, S: 0.1 },
        { f: 100, S: 0.05 },
        { f: 1000, S: 0.01 }
      ],
      alpha: aB.alpha,
      beta: aB.beta,
      loadDof: 0,
      responseDof: 0
    });
    assert(Number.isFinite(psd.rms));
    assert(psd.points.length > 0);
  });

  // ------------------------------------------------------------------
  // Timoshenko beam 3D
  // ------------------------------------------------------------------
  check('timoshenko: constructor guards and stiffness matrices', () => {
    const section = { E: 200e9, nu: 0.3, A: 0.01, Iy: 8.33e-6, Iz: 8.33e-6, J: 1.4e-5, ky: 5 / 6, kz: 5 / 6 };
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    ];
    assert.throws(() => new TimoshenkoBeam3D(0, [0], coords, section), /two node indices/);
    assert.throws(() => new TimoshenkoBeam3D(0, [0, 1], [{ x: 0 }, { x: 1 }], section), /two finite 3D coordinates/);
    assert.throws(() => new TimoshenkoBeam3D(0, [0, 1], coords, { ...section, E: NaN }), /finite explicit values/);
    assert.throws(() => new TimoshenkoBeam3D(0, [0, 1], coords, { ...section, nu: 0.6 }), /physically admissible/);
    assert.throws(
      () =>
        new TimoshenkoBeam3D(
          0,
          [0, 1],
          [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 }
          ],
          section
        ),
      /length must be non-zero/
    );
    const beam = new TimoshenkoBeam3D(0, [0, 1], coords, section);
    const Ke = beam.computeLocalStiffnessMatrix();
    assert.strictEqual(Ke.length, 144);
    assert(Ke[0] > 0);
    const Kg = beam.computeGeometricStiffnessMatrix(1000);
    assert(Kg[1 * 12 + 1] > 0);
    const KgC = beam.computeGeometricStiffnessMatrix(-1000);
    assert(KgC[1 * 12 + 1] < 0);
    assert.throws(() => beam.computeGeometricStiffnessMatrix(NaN), /explicit finite axial load/);
  });

  check('timoshenko: euler buckling loads and guards', () => {
    const section = { E: 200e9, nu: 0.3, A: 0.01, Iy: 1.2e-5, Iz: 8.33e-6, J: 1.4e-5, ky: 5 / 6, kz: 5 / 6 };
    const beam = new TimoshenkoBeam3D(
      0,
      [0, 1],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      section
    );
    const pinned = beam.calculateEulerBucklingLoad(1.0);
    assert(pinned.criticalPcr > 0);
    assert(pinned.PcrY > pinned.PcrZ);
    const cantilever = beam.calculateEulerBucklingLoad(2.0);
    assert(cantilever.criticalPcr < pinned.criticalPcr);
    assert.throws(() => beam.calculateEulerBucklingLoad(0), /positive finite effective-length factor/);
  });

  // ------------------------------------------------------------------
  // Axisymmetric thermoelastic 8-node
  // ------------------------------------------------------------------
  check('axisym: q8 shape branches and element guards', () => {
    const { N, dNdxi, dNdeta } = q8Shape(0.2, -0.3);
    assert.strictEqual(N.length, 8);
    assert(dNdxi[4] !== undefined);
    assert(dNdxi[5] !== undefined);
    assert(dNdxi[0] !== undefined);
    const s = new AxisymThermoelastic8Node({ E: 200e9, nu: 0.3, alpha: 1.2e-5 });
    assert.throws(() => s.addQuad([0, 1, 2, 3, 4, 5, 6]), /8 node ids/);
    s.addNode(0.1, 0);
    s.addQuad([0, 1, 2, 3, 4, 5, 6, 7]);
    assert(s.elements.length === 1);
    assert.strictEqual(
      new AxisymThermoelastic8Node({ E: 1, nu: 0.3, alpha: 1, deltaTField: (r, z) => r + z }).deltaTField(1, 2),
      3
    );
  });

  check('axisym: solve with per-node deltaT and stress recovery', () => {
    const s = new AxisymThermoelastic8Node({ E: 200e9, nu: 0.3, alpha: 1.2e-5 });
    const coords = [
      { r: 0.1, z: 0.0 },
      { r: 0.2, z: 0.0 },
      { r: 0.2, z: 0.1 },
      { r: 0.1, z: 0.1 },
      { r: 0.15, z: 0.0 },
      { r: 0.2, z: 0.05 },
      { r: 0.15, z: 0.1 },
      { r: 0.1, z: 0.05 }
    ];
    const ids = coords.map((c) => s.addNode(c.r, c.z));
    s.addQuad(ids);
    for (const id of [0, 1, 4]) s.fixNode(id, true, true);
    s.prescribeDisplacement(5, 0, 0.0005);
    const res = s.solve();
    assert.strictEqual(res.solverExecuted, true);
    assert.strictEqual(res.displacement.length, 16);
    assert.strictEqual(res.stresses.length, 1);
    assert(Number.isFinite(res.stresses[0].sr));
    const atNode = s.stressAtNode(2);
    assert(typeof atNode.sr === 'number');
    assert.strictEqual(new AxisymThermoelastic8Node({ E: 1, nu: 0.3, alpha: 1 }).stressAtNode(0), null);
  });

  check('axisym: deltaTField mode and geometry errors', () => {
    const s = new AxisymThermoelastic8Node({ E: 200e9, nu: 0.3, alpha: 1.2e-5, deltaTField: (r) => 100 * r });
    const coords = [
      { r: 0.1, z: 0.0 },
      { r: 0.2, z: 0.0 },
      { r: 0.2, z: 0.1 },
      { r: 0.1, z: 0.1 },
      { r: 0.15, z: 0.0 },
      { r: 0.2, z: 0.05 },
      { r: 0.15, z: 0.1 },
      { r: 0.1, z: 0.05 }
    ];
    const ids = coords.map((c) => s.addNode(c.r, c.z));
    s.addQuad(ids);
    for (const id of ids) s.fixNode(id, true, true);
    const res = s.solve();
    assert(res.stresses[0].sr !== 0);
    const bad = new AxisymThermoelastic8Node({ E: 200e9, nu: 0.3, alpha: 1e-5 });
    const badCoords = [
      { r: 0.2, z: 0.0 },
      { r: 0.1, z: 0.0 },
      { r: 0.1, z: 0.1 },
      { r: 0.2, z: 0.1 },
      { r: 0.15, z: 0.0 },
      { r: 0.1, z: 0.05 },
      { r: 0.15, z: 0.1 },
      { r: 0.2, z: 0.05 }
    ];
    const badIds = badCoords.map((c) => bad.addNode(c.r, c.z));
    bad.addQuad(badIds);
    for (const id of badIds) bad.fixNode(id, true, true);
    assert.throws(() => bad.solve(), /non-positive Jacobian or radius/);
  });

  // ------------------------------------------------------------------
  // Plane stress Q8
  // ------------------------------------------------------------------
  check('plane stress q8: shape branches, guards, and solve', () => {
    const { N: N2 } = q8ShapePS(0, 0);
    assert.strictEqual(N2.length, 8);
    const s = new PlaneStressQ8({ E: 200e9, nu: 0.3, thickness: 0.001 });
    assert.strictEqual(s.t, 0.001);
    assert.throws(() => s.addQuad([0, 1, 2, 3, 4, 5, 6]), /Q8 element requires 8 node ids/);
    const coords = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 }
    ];
    const ids = coords.map((c) => s.addNode(c.x, c.y));
    s.addQuad(ids);
    s.fixNode(0, true, true);
    s.fixNode(1, true, true);
    s.fixNode(4, true, true);
    s.prescribeDisplacement(6, 1, 0.0001);
    s.applyNodalLoad(3, 0, 1000);
    const res = s.solve();
    assert.strictEqual(res.solverExecuted, true);
    assert.strictEqual(res.stresses.length, 1);
    assert(Number.isFinite(res.stresses[0].vonMises));
    assert.strictEqual(res.displacements.length, 8);
    const bad = new PlaneStressQ8({ E: 1, nu: 0.3 });
    bad.addNode(0, 0);
    bad.addNode(1, 0);
    bad.addNode(1, 1);
    bad.addNode(0, 1);
    bad.addNode(0.5, 0);
    bad.addNode(1, 0.5);
    bad.addNode(0.5, 1);
    bad.addNode(0, 0.5);
    bad.addQuad([0, 1, 2, 3, 4, 5, 6, 7]);
    bad.addQuad([7, 6, 5, 4, 3, 2, 1, 0]);
    for (let i = 0; i < 8; i++) bad.fixNode(i, true, true);
    assert.throws(() => bad.solve(), /non-positive Jacobian/);
  });

  // ------------------------------------------------------------------
  // Poisson 2D mixed
  // ------------------------------------------------------------------
  check('poisson mixed: guards, q4, tri, convection and flux branches', () => {
    assert.throws(() => new Poisson2DMixed({ conductivity: 1 }).addQuad([0, 1, 2]), /Q4 element requires 4 node ids/);
    assert.throws(
      () => new Poisson2DMixed({ conductivity: 1 }).addTriangle([0, 1]),
      /TRI3 element requires 3 node ids/
    );
    const s = new Poisson2DMixed({ conductivity: 15 });
    const q4 = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];
    const ids = q4.map((p) => s.addNode(p.x, p.y));
    s.addQuad(ids);
    const tId = s.addNode(2, 0);
    s.addNode(2, 1);
    s.addNode(2.5, 0.5);
    s.addTriangle([tId, tId + 2, tId + 1]);
    s.setTemperature(0, 20);
    s.setTemperature(tId, 25);
    s.addConvectionEdge([1, 2], 5, 50);
    s.addHeatFluxEdge([2, 3], 100);
    const res = s.solve();
    assert.strictEqual(res.solverExecuted, true);
    assert.strictEqual(res.temperature[0], 20);
    assert.strictEqual(res.nodeCount, 7);
    const bad = new Poisson2DMixed({ conductivity: 1 });
    bad.addNode(0, 0);
    bad.addNode(1, 0);
    bad.addNode(1, 1);
    bad.addNode(0, 1);
    bad.addQuad([0, 3, 2, 1]);
    bad.setTemperature(0, 0);
    assert.throws(() => bad.solve(), /non-positive Jacobian/);
    const badTri = new Poisson2DMixed({ conductivity: 1 });
    badTri.addNode(0, 0);
    badTri.addNode(1, 0);
    badTri.addNode(2, 0);
    badTri.addTriangle([0, 1, 2]);
    badTri.setTemperature(0, 0);
    assert.throws(() => badTri.solve(), /non-positive Jacobian/);
  });

  check('poisson mixed: fromConstrainedTriMesh and q4Shape', () => {
    const d = new DelaunayConstrained2D();
    const mesh = d.triangulatePolygon(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ],
      []
    );
    const s = Poisson2DMixed.fromConstrainedTriMesh(mesh, { conductivity: 10 });
    s.setTemperature(0, 30);
    const res = s.solve();
    assert(res.solverExecuted);
    const { N: Nq } = q4Shape(0.2, -0.2);
    assert.strictEqual(Nq.length, 4);
  });

  // ------------------------------------------------------------------
  // Thermal CHT engine
  // ------------------------------------------------------------------
  function thermalGrid(value, rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(value));
  }

  check('thermal: smartphone stub and invalid config branches', () => {
    const stub = ThermalEngine.simulateSmartphoneThermal();
    assert.strictEqual(stub.success, false);
    assert.strictEqual(stub.status, 'UNAVAILABLE');
    assert.strictEqual(ThermalEngine.solveTransientConduction2D(null).status, 'INVALID_INPUT');
    assert.strictEqual(ThermalEngine.solveTransientConduction2D({}).status, 'INVALID_INPUT');
    const base = {
      widthM: 0.1,
      heightM: 0.05,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.1,
      totalTimeSec: 0.5,
      initialTemperatureC: thermalGrid(20, 3, 3),
      conductivityWPerMK: thermalGrid(200, 3, 3),
      volumetricHeatCapacityJPerM3K: thermalGrid(3e6, 3, 3),
      heatGenerationWPerM3: thermalGrid(0, 3, 3)
    };
    assert.strictEqual(ThermalEngine.solveTransientConduction2D({ ...base, widthM: -1 }).status, 'INVALID_INPUT');
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, ambientTemperatureC: -300 }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, convectionCoefficientWPerM2K: -1 }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, initialTemperatureC: 'nope' }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, initialTemperatureC: thermalGrid(20, 2, 3) }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, conductivityWPerMK: thermalGrid(0, 3, 3) }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, volumetricHeatCapacityJPerM3K: thermalGrid(-1, 3, 3) })
        .status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, timeStepSec: 1000, totalTimeSec: 1e9 }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, timeStepSec: 100, totalTimeSec: 200 }).status,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      ThermalEngine.solveTransientConduction2D({ ...base, timeStepSec: 1, totalTimeSec: 1 }).status,
      'EXPERIMENTAL_ESTIMATE_ONLY'
    );
  });

  check('thermal: explicit solve, stability guard, heatmap, and harmonic mean', () => {
    const config = {
      widthM: 0.1,
      heightM: 0.05,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.1,
      totalTimeSec: 0.5,
      initialTemperatureC: thermalGrid(20, 3, 3),
      conductivityWPerMK: thermalGrid(200, 3, 3),
      volumetricHeatCapacityJPerM3K: thermalGrid(3e6, 3, 3),
      heatGenerationWPerM3: thermalGrid(0, 3, 3)
    };
    const res = ThermalEngine.solveTransientConduction2D(config);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert(res.results.temperatureC.length === 3);
    assert(res.results.temperatureMap.length === 1);
    assert(res.results.minimumTemperatureC <= res.results.maximumTemperatureC);
    const unstable = ThermalEngine.solveTransientConduction2D({ ...config, timeStepSec: 10, totalTimeSec: 20 });
    assert.strictEqual(unstable.status, 'INVALID_INPUT');
    assert.throws(() => ThermalEngine.exportSampledHeatmap([[1, 2]], 2, 1, 0, 1), /positive integers/);
    assert.throws(() => ThermalEngine.exportSampledHeatmap('nope', 2, 1), /bounded temperature grid/);
    assert.throws(() => ThermalEngine.exportSampledHeatmap([[1, NaN]], 2, 1), /rectangular and contain only finite/);
    assert.strictEqual(
      ThermalEngine.exportSampledHeatmap(
        [
          [20.25, 21.75],
          [22.5, 23.9]
        ],
        2,
        2,
        1,
        1
      )[0][0],
      20.3
    );
    assert.strictEqual(ThermalEngine._harmonicMean(2, 2), 2);
    assert.strictEqual(ThermalEngine._harmonicMean(2, 6), 3);
  });

  // ------------------------------------------------------------------
  // FVM Navier-Stokes 3D
  // ------------------------------------------------------------------
  check('fvm: constructor option branches and limiter', () => {
    const fvm = new FVMNavierStokes3D({
      cflBasis: 'convective',
      projection: true,
      localTimeStepping: true,
      steadyLineRelax: true,
      wallWakeLaw: true,
      twoLayerAllYPlus: true,
      outflowSpongeLength: 0.2,
      fluxScheme: 'roe'
    });
    assert.strictEqual(fvm.cflBasis, 'convective');
    assert.strictEqual(fvm.projection, true);
    assert.strictEqual(fvm.localTimeStepping, true);
    assert.strictEqual(fvm.fluxScheme, 'roe');
    const legacy = new FVMNavierStokes3D({});
    assert.strictEqual(legacy.cflBasis, 'acoustic');
    assert.strictEqual(legacy.fluxScheme, 'hllc');
    assert.strictEqual(legacy.wallLawConstant, 9.8);
    assert.strictEqual(fvm.venkatakrishnanLimiter(1.0, 2.0, { x: 1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }), 1.0);
    const flatLim = fvm.venkatakrishnanLimiter(1.0, 1.0, { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 });
    assert.strictEqual(flatLim, 1.0);
    assert.strictEqual(fvm.getKInlet(), 1.5 * Math.pow(0.05 * 15, 2));
    assert(fvm.getOmegaInlet() > 0);
    const explicit = new FVMNavierStokes3D({ kInlet: 1.0, omegaInlet: 100.0 });
    assert.strictEqual(explicit.getKInlet(), 1.0);
    assert.strictEqual(explicit.getOmegaInlet(), 100.0);
  });

  check('fvm: riemann flux branches and wall normal guard', () => {
    const fvm = new FVMNavierStokes3D({});
    const L = { u: 100, v: 0, w: 0, p: 100000, rho: 1.0 };
    const R = { u: 0, v: 0, w: 0, p: 10000, rho: 0.125 };
    const n = { x: 1, y: 0, z: 0 };
    const hllc = fvm.solveHLLCRiemannFlux(L, R, n, 1.0);
    assert(hllc.massFlux !== undefined);
    const roe = fvm.solveRoeRiemannFlux(L, R, n, 1.0);
    assert(roe.massFlux !== undefined);
    const ausm = fvm.solveAUSMPlusFlux(L, R, n, 1.0);
    assert(ausm.massFlux !== undefined);
    const cell = { id: 0, u: 1, v: 0, w: 0, rho: 1.2, wallDistance: 0.001, faceIndices: [0] };
    const badFace = { id: 0, boundaryType: 'wall', ownerId: 0, normal: { x: 0, y: 0, z: 0 } };
    fvm.faces = [badFace];
    assert.throws(() => fvm._wallTangentialSpeed(cell), /invalid face normal/);
    const noFace = { id: 1, u: 1, v: 1, w: 1, rho: 1.2, wallDistance: 0.001 };
    assert(fvm._wallTangentialSpeed(noFace) > 0);
  });

  check('fvm: step validation guards and solveSteps auto-init', () => {
    const fvm = new FVMNavierStokes3D({});
    assert.throws(() => fvm.step(0, 5), /positive finite inlet velocity/);
    assert.throws(() => fvm.step(10, 2.5), /positive integer iteration count/);
    assert.throws(() => fvm.step(10, 0), /positive integer iteration count/);
    assert.throws(() => fvm.step(10, 2), /initialized mesh/);
    assert.throws(() => fvm.updateSSTTurbulence(0), /positive finite time step/);
    const out = fvm.solveSteps(2, 10);
    assert(out.stepCount > 0);
    assert(fvm.cells.length > 0);
  });

  check('fvm: box-domain step with hllc/roe/ausm flux schemes', () => {
    const fvm = new FVMNavierStokes3D({ fluxScheme: 'hllc' });
    fvm.createBoxDomain(4, 4, 4, 0.4, 0.4, 0.4);
    const m = fvm.step(10, 2);
    assert(m.maxVelocity > 0);
    assert(m.maxTurbulentViscosity >= 0);
    const fvm2 = new FVMNavierStokes3D({ fluxScheme: 'ausm_plus' });
    fvm2.createBoxDomain(4, 4, 4, 0.4, 0.4, 0.4);
    const m2 = fvm2.step(10, 2);
    assert(m2.maxVelocity > 0);
    const fvm3 = new FVMNavierStokes3D({ fluxScheme: 'roe' });
    fvm3.createBoxDomain(4, 4, 4, 0.4, 0.4, 0.4);
    const m3 = fvm3.step(10, 2);
    assert(m3.maxVelocity > 0);
  });

  // ------------------------------------------------------------------
  // CFD solver 2D
  // ------------------------------------------------------------------
  check('cfd2d: constructor defaults and airfoil obstacle mask', () => {
    const cfd = new CFDSolver2D();
    assert.strictEqual(cfd.nx, 40);
    assert.strictEqual(cfd.ny, 30);
    assert(cfd.nu > 0);
    const small = new CFDSolver2D(16, 12, 0.8, 0.6);
    small.setAirfoilObstacle(0.4, 0.12, 4);
    const hasObstacle = small.obstacle.some((row) => Array.from(row).some((v) => v === 1));
    assert.strictEqual(hasObstacle, true);
    const zero = new CFDSolver2D(16, 12, 0.8, 0.6);
    zero.setAirfoilObstacle(0.05, 0.01, 0);
    assert(Array.isArray(zero.exportVelocityField()));
    assert(Array.isArray(zero.exportPressureField()));
  });

  check('cfd2d: solve loop, upwind branches, and forces', () => {
    const cfd = new CFDSolver2D(20, 15, 1.0, 0.75, 1.225, 1.81e-5);
    cfd.setAirfoilObstacle(0.4, 0.12, 4);
    const out = cfd.solve(15, 20);
    assert(out.liftCoeff_CL > -5 && out.liftCoeff_CL < 5);
    assert(out.dragCoeff_CD >= 0.005);
    assert(out.glideRatio >= 0);
    assert.strictEqual(out.grid.nx, 20);
    assert(out.velocityField.length > 0);
    assert(out.pressureField.length > 0);
  });

  check('cfd2d: propeller thrust guards and success path', () => {
    const unavailable = CFDSolver2D.solvePropellerThrust(null);
    assert.strictEqual(unavailable.status, 'unavailable');
    const invalid = CFDSolver2D.solvePropellerThrust({
      rpm: 1000,
      diameterM: 0.1,
      airDensityKgM3: 1.2,
      thrustCoefficient: 0.1,
      torqueCoefficient: 0.01,
      coefficientSource: ''
    });
    assert.strictEqual(invalid.status, 'invalid-input');
    const badRpm = CFDSolver2D.solvePropellerThrust({
      rpm: 10.5,
      diameterM: 0.1,
      airDensityKgM3: 1.2,
      thrustCoefficient: 0.1,
      torqueCoefficient: 0.01,
      coefficientSource: 'src'
    });
    assert.strictEqual(badRpm.status, 'invalid-input');
    const ok = CFDSolver2D.solvePropellerThrust({
      rpm: 12000,
      diameterM: 0.25,
      airDensityKgM3: 1.225,
      thrustCoefficient: 0.1,
      torqueCoefficient: 0.015,
      coefficientSource: 'prop-catalog-2024'
    });
    assert.strictEqual(ok.success, true);
    assert(ok.thrustN > 0);
    assert(Number.isFinite(ok.figureOfMerit));
  });

  // ------------------------------------------------------------------
  // Drop test
  // ------------------------------------------------------------------
  check('drop test: guards and all three impact angles', () => {
    assert.throws(() => DropTestSimulator.runSimulation({}), /dropHeight in meters/);
    assert.throws(
      () => DropTestSimulator.runSimulation({ dropHeight: 1.5, phoneMass: 0.2, impactAngle: 'side' }),
      /impactAngle/
    );
    for (const angle of ['corner', 'edge', 'face']) {
      const out = DropTestSimulator.runSimulation({ dropHeight: 1.5, phoneMass: 0.2, impactAngle: angle });
      assert.strictEqual(out.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
      assert(out.peakForce_N > 0);
      assert(out.peakDeceleration_G > 0);
      assert(out.peakChassisStress_MPa > 0);
      assert(out.timeHistory.length > 0);
      assert.strictEqual(out.inputs.impactAngle, angle);
    }
  });

  // ------------------------------------------------------------------
  // Transient drop animator
  // ------------------------------------------------------------------
  check('transient animator: guards and phases (free fall, contact, rebound)', () => {
    assert.throws(() => TransientDropAnimator.solveTransientHistory({}), /dropHeightM in meters/);
    assert.throws(
      () =>
        TransientDropAnimator.solveTransientHistory({
          dropHeightM: 1.5,
          phoneMassKg: 0.2,
          impactAngle: 'face',
          totalDurationMs: 10,
          stepCount: 0
        }),
      /totalDurationMs/
    );
    for (const angle of ['corner', 'edge', 'face']) {
      const out = TransientDropAnimator.solveTransientHistory({
        dropHeightM: 1.5,
        phoneMassKg: 0.2,
        impactAngle: angle,
        totalDurationMs: 50,
        stepCount: 500
      });
      assert.strictEqual(out.frameCount, 501);
      assert(out.peakDeceleration_G > 0);
      assert(out.frames.some((f) => f.inContact));
      assert(out.frames.some((f) => !f.inContact && f.timeMs < 0.6));
      assert(out.frames.every((f) => Number.isFinite(f.totalEnergy_J)));
    }
  });

  // ------------------------------------------------------------------
  // WebGPU CFD kernel
  // ------------------------------------------------------------------
  check('webgpu: constructor defaults, wgsl source, and cpu poisson solve', () => {
    const kernel = new WebGPUCFDKernel({ nx: 8, ny: 8, nz: 8, maxIterations: 5, tolerance: 1e-3 });
    assert.strictEqual(kernel.nx, 8);
    assert.strictEqual(kernel.maxIterations, 5);
    assert.strictEqual(kernel.useGPU, false);
    assert.strictEqual(kernel.gpuAvailable, false);
    const src = kernel.getWGSLShaderSource();
    assert(src.includes('@compute'));
    assert(src.includes('SimulationParams'));
    const total = 8 * 8 * 8;
    const divU = new Float32Array(total);
    for (let i = 0; i < total; i++) divU[i] = (i % 5) * 1e-5;
    const res = kernel.solvePressurePoisson(divU, 0.001);
    assert(Number.isInteger(res.iterations));
    assert(res.pressureField.length === total);
    assert(Number.isFinite(res.residualNorm));
    assert.strictEqual(res.backend, 'CPU (JavaScript Float32Array Jacobi)');
    const resInit = kernel.solvePressurePoisson(divU, 0.001, new Float32Array(total).fill(0.5));
    assert(resInit.pressureField.length === total);
    const alias = kernel.solvePoissonCPU(divU, 0.001);
    assert(alias.pressureField.length === total);
    const defaults = new WebGPUCFDKernel();
    assert.strictEqual(defaults.nx, 64);
    assert.strictEqual(defaults.dy, 0.01);
    const resSmall = defaults.solvePressurePoisson(new Float32Array(64 * 64 * 32), 0.001);
    assert(resSmall.totalCells === 64 * 64 * 32);
  });

  // ------------------------------------------------------------------
  // Composite CLPT
  // ------------------------------------------------------------------
  function makePly(overrides = {}) {
    return new CompositePly({
      thicknessMm: 0.15,
      orientationDeg: 45,
      E1: 140e9,
      E2: 10e9,
      G12: 5e9,
      nu12: 0.3,
      strengths: { Xt: 1500e6, Xc: 1200e6, Yt: 50e6, Yc: 200e6, S: 70e6 },
      ...overrides
    });
  }

  check('clpt: ply constructor guards and reduced stiffness', () => {
    assert.throws(() => new CompositePly({}), /explicit finite composite ply inputs/);
    assert.throws(() => makePly({ thicknessMm: 0 }), /outside the supported range/);
    assert.throws(() => makePly({ nu12: 0.6 }), /outside the supported range/);
    assert.throws(() => makePly({ strengths: { Xt: 100 } }), /positive lamina strengths/);
    const ply = makePly();
    assert.strictEqual(ply.t, 0.15e-3);
    assert(ply.Qbar11 > 0);
    assert(Number.isFinite(ply.Qbar16));
    assert(Number.isFinite(ply.Qbar26));
    const zero = makePly({ orientationDeg: 0 });
    assert(zero.Qbar11 > 0);
  });

  check('clpt: laminate ABD, tsai-wu, and hashin branches', () => {
    const laminate = new CompositeLaminateCLPT([
      makePly({ orientationDeg: 0 }),
      makePly({ orientationDeg: 90 }),
      makePly({ orientationDeg: 45 })
    ]);
    assert(laminate.A[0][0] > 0);
    assert(Number.isFinite(laminate.B[0][0]));
    assert(laminate.D[0][0] > 0);
    assert.throws(() => new CompositeLaminateCLPT([]), /non-empty array/);
    assert.throws(() => new CompositeLaminateCLPT([{}]), /CompositePly instances/);
    const ply = makePly();
    const safe = CompositeLaminateCLPT.evaluateTsaiWu(ply, 50e6, 10e6, 5e6);
    assert.strictEqual(safe.isSafe, true);
    const fail = CompositeLaminateCLPT.evaluateTsaiWu(ply, 800e6, 30e6, 50e6);
    assert.strictEqual(fail.isSafe, false);
    const zero = CompositeLaminateCLPT.evaluateTsaiWu(ply, 0, 0, 0);
    assert.strictEqual(zero.reserveFactor, Infinity);
    const fiberT = CompositeLaminateCLPT.evaluateHashin(ply, 100e6, -10e6, 20e6);
    assert(fiberT.fiberFailureIndex > 0);
    assert(fiberT.matrixFailureIndex > 0);
    const fiberC = CompositeLaminateCLPT.evaluateHashin(ply, -900e6, 10e6, 20e6);
    assert(fiberC.fiberFailureIndex > 0);
    const matrixC = CompositeLaminateCLPT.evaluateHashin(ply, 100e6, -100e6, 20e6);
    assert(matrixC.matrixFailureIndex > 0);
  });

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  await Promise.all(pending);
  console.log('');
  console.log('==============================================');
  console.log(`Branch-gap batch 24 (CAE cluster) summary:`);
  console.log(`  Total checks : ${totalTests}`);
  console.log(`  Passed       : ${passedTests}`);
  console.log(`  Failed       : ${failedTests}`);
  console.log('==============================================');
  if (failedTests > 0) {
    process.exitCode = 1;
  }
}

runBranchGapTwentyFourCoverageTests();
