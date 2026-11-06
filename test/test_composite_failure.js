/**
 * Verification Gate: Composite laminate failure prediction — Classical Laminated Plate Theory
 * (CLPT) [A,B,D] matrices, ply stress recovery, Tsai-Wu and Hashin failure criteria, and
 * first-ply failure (FPF) load multiplier.
 *
 * Reference material (unidirectional carbon/epoxy lamina):
 *   E1 = 140 GPa, E2 = 10 GPa, G12 = 5 GPa, nu12 = 0.3, t_ply = 0.125 mm
 *   Xt = 1500 MPa, Xc = 1200 MPa, Yt = 50 MPa, Yc = 200 MPa, S = 70 MPa
 *
 * All analytic references are computed by hand in this file from the engineering constants,
 * independent of the engine internals. Loads are expressed in N/m (N per metre width);
 * 100 N/mm = 1e5 N/m.
 *
 * Scope: first-ply failure only. The engine does NOT implement progressive damage or
 * delamination propagation; that limitation is asserted explicitly below.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompositePly, CompositeLaminateCLPT } = require('../src/core/cae/composite_clpt');

const MAT = {
  thicknessMm: 0.125,
  E1: 140e9,
  E2: 10e9,
  G12: 5e9,
  nu12: 0.3,
  strengths: { Xt: 1500e6, Xc: 1200e6, Yt: 50e6, Yc: 200e6, S: 70e6 }
};

const T_PLY = MAT.thicknessMm * 1e-3; // 0.125e-3 m

function makePly(deg) {
  return new CompositePly({ ...MAT, orientationDeg: deg });
}

function crossPlyLaminate() {
  return new CompositeLaminateCLPT([makePly(0), makePly(90), makePly(90), makePly(0)]);
}

/**
 * Hand-computed reduced stiffness Q from engineering constants (independent of engine).
 */
function handQ() {
  const nu21 = (MAT.nu12 * MAT.E2) / MAT.E1;
  const denom = 1 - MAT.nu12 * nu21;
  return {
    Q11: MAT.E1 / denom,
    Q12: (MAT.nu12 * MAT.E2) / denom,
    Q22: MAT.E2 / denom,
    Q66: MAT.G12
  };
}

test('CLPT [0/90]s: B = 0 to 1e-9, A matches rule-of-mixtures, D11 matches analytic bending stiffness', () => {
  const Q = handQ();
  const laminate = crossPlyLaminate();

  // --- [B] must vanish for a symmetric layup ---
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(laminate.B[r][c]) < 1e-9,
        `B[${r}][${c}] = ${laminate.B[r][c]} must be zero to 1e-9 for symmetric [0/90]s`
      );
    }
  }

  // --- Hand rule-of-mixtures / CLT reference ---
  const A11ref = 2 * T_PLY * (Q.Q11 + Q.Q22); // 2 t (Q11 + Q22)
  const A12ref = 4 * T_PLY * Q.Q12; // 4 t Q12
  const A66ref = 4 * T_PLY * Q.Q66; // 4 t Q66
  const D11ref = ((2 * T_PLY ** 3) / 3) * (7 * Q.Q11 + Q.Q22); // 1/3 Σ Qbar11 (zk^3 - z_{k-1}^3), [0/90]s

  const rel = (got, ref) => Math.abs(got - ref) / Math.abs(ref);

  assert.ok(rel(laminate.A[0][0], A11ref) < 1e-3, `A11=${laminate.A[0][0]} vs ref=${A11ref}`);
  assert.ok(rel(laminate.A[1][1], A11ref) < 1e-3, `A22=${laminate.A[1][1]} vs ref=${A11ref} (balanced)`);
  assert.ok(rel(laminate.A[0][1], A12ref) < 1e-3, `A12=${laminate.A[0][1]} vs ref=${A12ref}`);
  assert.ok(rel(laminate.A[2][2], A66ref) < 1e-3, `A66=${laminate.A[2][2]} vs ref=${A66ref}`);
  assert.ok(rel(laminate.D[0][0], D11ref) < 1e-3, `D11=${laminate.D[0][0]} vs ref=${D11ref}`);

  assert.ok(rel(laminate.A[0][0], A11ref) < 1e-6, 'A11 actually matches hand CLT to machine precision');
  assert.ok(rel(laminate.D[0][0], D11ref) < 1e-6, 'D11 actually matches hand CLT to machine precision');
});

test('Cross-ply [0/90]s neat Nx = 100 N/mm: inverse ABD strains + ply stress recovery', () => {
  const Q = handQ();
  const laminate = crossPlyLaminate();
  const Nx = 100 * 1e3; // 100 N/mm = 1e5 N/m

  const res = laminate.solveABD({ Nx, Ny: 0, Nxy: 0 });
  const [eps0x, eps0y] = res.strain;

  // Hand closed-form 2x2 inverse (Ny = 0): eps0x = Nx A22 / (A11 A22 - A12^2), eps0y = -Nx A12 / det
  const A11 = 2 * T_PLY * (Q.Q11 + Q.Q22);
  const A12 = 4 * T_PLY * Q.Q12;
  const det = A11 * A11 - A12 * A12;
  const eps0xRef = (Nx * A11) / det;
  const eps0yRef = (-Nx * A12) / det;

  const rel = (got, ref) => Math.abs(got - ref) / Math.abs(ref);
  assert.ok(rel(eps0x, eps0xRef) < 1e-3, `eps0x=${eps0x} vs hand=${eps0xRef}`);
  assert.ok(rel(eps0y, eps0yRef) < 1e-3, `eps0y=${eps0y} vs hand=${eps0yRef}`);
  assert.ok(rel(eps0x, eps0xRef) < 1e-6, 'eps0x actually matches hand inverse ABD to machine precision');

  const plies = laminate.recoverPlyStresses(res.strain, res.curvature);
  assert.strictEqual(plies.length, 4);

  // eps_x identical in all plies (midplane strain; zero curvature)
  const epsX0 = plies[0].epsilonGlobal[0];
  for (const p of plies) {
    assert.ok(Math.abs(p.epsilonGlobal[0] - epsX0) < 1e-12, 'epsilon_x identical in 0deg and 90deg plies');
  }

  // Lamina constitutive recovery: sigma1 = Q11 e1 + Q12 e2, etc., vs hand Q (0.1% tolerance)
  for (const p of plies) {
    const [e1, e2, g12] = p.epsilonLocal;
    const s1ref = Q.Q11 * e1 + Q.Q12 * e2;
    const s2ref = Q.Q12 * e1 + Q.Q22 * e2;
    const t12ref = Q.Q66 * g12;
    assert.ok(
      rel(p.sigmaLocal.sigma1, s1ref) < 1e-3,
      `ply ${p.plyIndex} sigma1=${p.sigmaLocal.sigma1} vs hand=${s1ref}`
    );
    assert.ok(
      rel(p.sigmaLocal.sigma2, s2ref) < 1e-3,
      `ply ${p.plyIndex} sigma2=${p.sigmaLocal.sigma2} vs hand=${s2ref}`
    );
    assert.ok(Math.abs(p.sigmaLocal.tau12 - t12ref) < 1e-3 * Math.abs(t12ref) + 1e-6, `ply ${p.plyIndex} tau12`);
  }

  // Resultant equilibrium: Nx = sum_k sigma_x^k t_k
  const NxRecovered = plies.reduce((sum, p) => sum + p.sigmaGlobal.sigmaX * T_PLY, 0);
  assert.ok(rel(NxRecovered, Nx) < 1e-3, `Nx recovered = ${NxRecovered} vs applied ${Nx}`);

  // Global stress split between 0deg and 90deg plies follows the material stiffness ratio.
  // Hand CLT: sigma_x(0deg) = Q11*ex + Q12*ey; sigma_x(90deg) = Q22*ex + Q12*ey
  // (the 90deg ply's global x-direction is its lamina 2-direction), with hand strains from
  // the closed-form 2x2 inverse ABD.
  const s0 = plies[0].sigmaGlobal.sigmaX; // 0deg ply
  const s90 = plies[1].sigmaGlobal.sigmaX; // 90deg ply
  const s0ref = Q.Q11 * eps0xRef + Q.Q12 * eps0yRef;
  const s90ref = Q.Q22 * eps0xRef + Q.Q12 * eps0yRef;
  assert.ok(rel(s0, s0ref) < 1e-3, `sigma_x(0deg)=${s0} vs hand=${s0ref}`);
  assert.ok(rel(s90, s90ref) < 1e-3, `sigma_x(90deg)=${s90} vs hand=${s90ref}`);
  const ratioEngine = s0 / s90;
  const ratioRef = s0ref / s90ref;
  assert.ok(rel(ratioEngine, ratioRef) < 1e-3, `stress ratio ${ratioEngine} vs hand ${ratioRef}`);

  console.log(
    `  [cross-ply] eps0x=${eps0x} eps0y=${eps0y}; sigma_x(0deg)=${(s0 / 1e6).toFixed(3)} MPa, ` +
      `sigma_x(90deg)=${(s90 / 1e6).toFixed(3)} MPa; ratio=${ratioEngine.toFixed(2)} (hand ${ratioRef.toFixed(2)})`
  );
});

test('Tsai-Wu [0]8 uniaxial: predicted failure stress matches closed-form quadratic to 1e-9', () => {
  const plies = Array.from({ length: 8 }, () => makePly(0));
  const laminate = new CompositeLaminateCLPT(plies);
  const h = laminate.totalThickness; // 1 mm
  const Nx = 1e5; // N/m
  const sigmaUnit = Nx / h; // Pa at unit load

  // Hand closed form: F11 s^2 + F1 s - 1 = 0 -> s* = (-F1 + sqrt(F1^2 + 4 F11)) / (2 F11)
  const Xt = MAT.strengths.Xt;
  const Xc = MAT.strengths.Xc;
  const F1 = 1 / Xt - 1 / Xc;
  const F11 = 1 / (Xt * Xc);
  const sStar = (-F1 + Math.sqrt(F1 * F1 + 4 * F11)) / (2 * F11);

  // Sanity: the quadratic form itself must hit 1.0 exactly at sStar
  assert.ok(Math.abs(F11 * sStar * sStar + F1 * sStar - 1) < 1e-9, 'quadratic FI(s*) = 1');
  assert.ok(Math.abs(sStar - Xt) / Xt < 1e-9, 'closed-form root collapses to Xt');

  const fpf = laminate.firstPlyFailure({ Nx, Ny: 0, Nxy: 0 }, { criterion: 'tsai-wu' });
  assert.ok(Number.isFinite(fpf.loadMultiplier) && fpf.loadMultiplier > 0, `multiplier ${fpf.loadMultiplier}`);
  assert.ok(Math.abs(fpf.failureIndexAtMultiplier - 1) < 1e-6, `FI(lambda*)=${fpf.failureIndexAtMultiplier}`);

  const sigmaPredicted = fpf.loadMultiplier * sigmaUnit;
  assert.ok(
    Math.abs(sigmaPredicted - sStar) / sStar < 1e-9,
    `predicted failure stress ${sigmaPredicted} vs closed form ${sStar} (rel ${Math.abs(sigmaPredicted - sStar) / sStar})`
  );

  console.log(
    `  [tsai-wu] Xt=${(Xt / 1e6).toFixed(1)} MPa, predicted ${(sigmaPredicted / 1e6).toFixed(6)} MPa, ` +
      `delta=${(Math.abs(sigmaPredicted - sStar) / sStar).toExponential(2)}`
  );
});

test('Hashin fiber-tension: transverse tension alone never triggers fiber mode; fiber load does', () => {
  const ply0 = makePly(0);
  const ply90 = makePly(90);
  const Yt = MAT.strengths.Yt;

  // Transverse tension only, no fiber loading
  const hT = CompositeLaminateCLPT.evaluateHashin(ply0, 0, 0.5 * Yt, 0);
  assert.strictEqual(hT.fiberFailureIndex, 0, 'transverse tension alone must not contribute to fiber index');
  assert.strictEqual(hT.isFiberSafe, true);
  assert.ok(hT.matrixFailureIndex > 0);

  // FPF check on a [90]8 laminate under Nx: fiber mode must never be selected
  const plies90 = Array.from({ length: 8 }, () => makePly(90));
  const lam90 = new CompositeLaminateCLPT(plies90);
  const fpf90 = lam90.firstPlyFailure({ Nx: 1e5, Ny: 0, Nxy: 0 }, { criterion: 'hashin' });
  assert.ok(
    Number.isFinite(fpf90.loadMultiplier) && fpf90.loadMultiplier > 0,
    '90deg laminate has a finite FPF multiplier'
  );
  assert.ok(fpf90.criticalMode.startsWith('hashin-matrix'), `critical mode must be matrix, got ${fpf90.criticalMode}`);

  // Fiber-dominated uniaxial load on [0]8 must trigger fiber mode at sigma1 = Xt
  const plies0 = Array.from({ length: 8 }, () => makePly(0));
  const lam0 = new CompositeLaminateCLPT(plies0);
  const h = lam0.totalThickness;
  const Nx = 1e5;
  const fpf0 = lam0.firstPlyFailure({ Nx, Ny: 0, Nxy: 0 }, { criterion: 'hashin' });
  assert.strictEqual(
    fpf0.criticalMode,
    'hashin-fiber-tension',
    'fiber-dominated uniaxial load must trigger fiber mode'
  );
  assert.ok(Math.abs(fpf0.failureIndexAtMultiplier - 1) < 1e-6);
  const sigmaFib = (fpf0.loadMultiplier * Nx) / h;
  assert.ok(Math.abs(sigmaFib - MAT.strengths.Xt) / MAT.strengths.Xt < 1e-6, `fiber failure stress ${sigmaFib} vs Xt`);

  console.log(
    `  [hashin] transverse-only fiber index=0; [0]8 fiber failure at ${(sigmaFib / 1e6).toFixed(3)} MPa = Xt`
  );

  // verify P using
  console.log(
    '  [hashin] [90]8 under Nx: critical mode = ' +
      fpf90.criticalMode +
      ', multiplier = ' +
      fpf90.loadMultiplier.toFixed(4)
  );
});

test('First-ply failure of [0/45/-45/90]s under biaxial loading: consistent multiplier at FI = 1', () => {
  const plies = [0, 45, -45, 90, 90, -45, 45, 0].map(makePly);
  const laminate = new CompositeLaminateCLPT(plies);
  const loads = { Nx: 1e5, Ny: 2e5, Nxy: 0 }; // biaxial

  const fpf = laminate.firstPlyFailure(loads, { criterion: 'tsai-wu' });

  assert.ok(
    Number.isFinite(fpf.loadMultiplier) && fpf.loadMultiplier > 0,
    `multiplier must be positive, got ${fpf.loadMultiplier}`
  );
  assert.ok(fpf.criticalPlyIndex >= 0 && fpf.criticalPlyIndex < 8, `critical ply ${fpf.criticalPlyIndex}`);
  assert.ok(typeof fpf.criticalMode === 'string' && fpf.criticalMode.length > 0);
  assert.ok(Math.abs(fpf.failureIndexAtMultiplier - 1) < 1e-6, `FI(lambda*)=${fpf.failureIndexAtMultiplier} != 1`);

  // Monotonicity of the critical ply: FI at lambda*/2 < 1 < FI at 2*lambda*
  const crit = fpf.perPly[fpf.criticalPlyIndex];
  const evalFI = (lambda) => {
    const scaled = { Nx: loads.Nx * lambda, Ny: loads.Ny * lambda, Nxy: loads.Nxy * lambda };
    const mem = laminate.solveABD(scaled);
    const rec = laminate.recoverPlyStresses(mem.strain, mem.curvature)[fpf.criticalPlyIndex];
    return CompositeLaminateCLPT.evaluateTsaiWu(
      plies[fpf.criticalPlyIndex],
      rec.sigmaLocal.sigma1,
      rec.sigmaLocal.sigma2,
      rec.sigmaLocal.tau12
    ).failureIndex;
  };
  const fiHalf = evalFI(fpf.loadMultiplier / 2);
  const fiDouble = evalFI(fpf.loadMultiplier * 2);
  assert.ok(fiHalf < 1, `FI(lambda*/2)=${fiHalf} must be < 1`);
  assert.ok(fiDouble > 1, `FI(2*lambda*)=${fiDouble} must be > 1`);

  console.log(
    `  [FPF biaxial] lambda*=${fpf.loadMultiplier.toFixed(5)}, critical ply #${fpf.criticalPlyIndex} ` +
      `(${crit.orientationDeg}deg, ${crit.mode}), FI(lambda*)=${fpf.failureIndexAtMultiplier.toFixed(9)}, ` +
      `FI(lambda*/2)=${fiHalf.toFixed(4)}, FI(2 lambda*)=${fiDouble.toFixed(4)}`
  );
});

test('Scope: engine covers first-ply failure only; no progressive damage/delamination model', () => {
  const laminate = crossPlyLaminate();
  // The engine intentionally does not implement progressive stiffness degradation or
  // delamination propagation. This gate is therefore an FPF (initiation) gate.
  assert.strictEqual(typeof laminate.progressiveFailure, 'undefined');
  assert.strictEqual(typeof laminate.progressiveFailureAnalysis, 'undefined');
  assert.strictEqual(typeof laminate.delaminationPropagation, 'undefined');
});
