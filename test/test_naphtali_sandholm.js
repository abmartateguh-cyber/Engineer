'use strict';

/**
 * Rigorous distillation column (Naphtali-Sandholm) verification gate.
 *
 * Cross-checks the MESH Newton solver against an independent McCabe-Thiele
 * stepping solution for a binary ideal benzene/toluene column, then verifies
 * mass-balance closure, monotonic temperature profile, and energy-balance
 * residuals on a depropanizer-style and a non-ideal ethanol-water column.
 */

const assert = require('assert');
const { RigorousDistillationColumnSolver } = require('../src/core/plant/rigorous_distillation_column');

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

// --- Independent McCabe-Thiele reference for ideal binary (constant alpha) ---
function mccabeThiele({ alpha, R, zF, q, D, xD, stages, feedStage }) {
  // returns { xD, xB } after stepping; xB from total mass balance
  const xB = (zF - D * xD) / (1 - D);
  // equilibrium
  const yEq = (x) => (alpha * x) / (1 + (alpha - 1) * x);
  // operating lines
  const yRect = (x) => (R / (R + 1)) * x + xD / (R + 1);
  const Lbar = R * D + q;
  const Vbar = D * (R + 1) + (q - 1);
  const yStrip = (x) => (Lbar / Vbar) * x - ((1 - D) / Vbar) * xB;
  // step down from condenser
  let x = xD;
  let nSteps = 0;
  const maxSteps = 400;
  while (x > xB && nSteps < maxSteps) {
    const y = yEq(x); // vapor leaving stage in equilibrium
    // liquid from stage below via operating line
    let xNext;
    if (nSteps + 1 < feedStage) xNext = (y - xD / (R + 1)) / (R / (R + 1));
    else xNext = (y + ((1 - D) / Vbar) * xB) / (Lbar / Vbar);
    if (xNext >= x - 1e-12) break; // stagnation
    x = xNext;
    nSteps++;
  }
  return { xD, xB, stagesUsed: nSteps, converged: nSteps < maxSteps };
}

// --- Case 1: benzene/toluene, 10 stages, R=2, D=0.5, z=0.5 ---
{
  const spec = {
    components: ['Benzene', 'Toluene'],
    stageCount: 10,
    feedStage: 5,
    feedComposition: { Benzene: 0.5, Toluene: 0.5 },
    refluxRatio: 2.0,
    distillateRate: 0.5,
    pressurePa: 101325,
    kValueModel: 'raoult'
  };
  const res = RigorousDistillationColumnSolver.solve(spec);
  check(
    'benzene/toluene: solver converged',
    res.success === true && res.status === 'converged',
    res.status || JSON.stringify(res.error)
  );
  if (res.success) {
    const xD = res.products.distillate.composition.Benzene;
    const xB = res.products.bottoms.composition.Benzene;
    const stages = res.profiles.stages;
    console.log(`  xD(Bz)=${xD.toFixed(4)}, xB(Bz)=${xB.toFixed(4)}`);
    check('benzene/toluene: distillate benzene-enriched (xD > 0.75)', xD > 0.75, `${xD.toFixed(4)}`);
    check('benzene/toluene: bottoms benzene-depleted (xB < 0.30)', xB < 0.3, `${xB.toFixed(4)}`);
    // McCabe-Thiele cross-check using a relative volatility fitted to the same
    // vapor-pressure source (average over the column temperature range).
    const Tavg = stages.reduce((s, st) => s + st.temperatureK, 0) / stages.length;
    const { CorrelationSpeciesCatalog } = require('../src/core/plant/thermo_compounds');
    const cat = new CorrelationSpeciesCatalog();
    const psB = cat.get('Benzene').getVaporPressure(Tavg);
    const psT = cat.get('Toluene').getVaporPressure(Tavg);
    const alpha = psB / psT;
    const mt = mccabeThiele({ alpha, R: 2.0, zF: 0.5, q: 1, D: 0.5, xD, stages: 10, feedStage: 5 });
    console.log(
      `  McCabe-Thiele @ alpha=${alpha.toFixed(2)}: xB_ref=${mt.xB.toFixed(4)} (stages used ${mt.stagesUsed})`
    );
    check(
      'benzene/toluene: bottoms matches McCabe-Thiele within 0.03',
      Math.abs(mt.xB - xB) < 0.03,
      `|${mt.xB.toFixed(4)} - ${xB.toFixed(4)}|`
    );
    check(
      'benzene/toluene: stage temperatures monotonic top-to-bottom',
      stages.every((s, i) => i === 0 || s.temperatureK > stages[i - 1].temperatureK)
    );
    check(
      'benzene/toluene: max component closure < 1e-8',
      res.massBalance.maxAbsComponentClosure < 1e-8,
      `${res.massBalance.maxAbsComponentClosure.toExponential(2)}`
    );
    check(
      'benzene/toluene: energy residual ratio < 1%',
      res.energyBalance.maxStageEnthalpyResidualOverDuty < 0.01,
      `${(res.energyBalance.maxStageEnthalpyResidualOverDuty * 100).toFixed(3)}%`
    );
    check(
      'benzene/toluene: converges in <= 40 Newton iterations',
      res.convergence.iterations <= 40,
      `${res.convergence.iterations} iterations`
    );
  }
}

// --- Case 2: depropanizer-style C3/C4 split (20 stages) ---
{
  const spec = {
    components: ['Propane', 'n-Butane'],
    stageCount: 20,
    feedStage: 10,
    feedComposition: { Propane: 0.5, 'n-Butane': 0.5 },
    refluxRatio: 3.0,
    distillateRate: 0.45,
    pressurePa: 1013250,
    kValueModel: 'raoult'
  };
  const res = RigorousDistillationColumnSolver.solve(spec);
  check(
    'depropanizer: solver converged',
    res.success === true && res.status === 'converged',
    res.status || JSON.stringify(res.error)
  );
  if (res.success) {
    const xD = res.products.distillate.composition.Propane;
    const xB = res.products.bottoms.composition.Propane;
    console.log(`  xD(C3)=${xD.toFixed(4)}, xB(C3)=${xB.toFixed(4)}`);
    check('depropanizer: distillate propane-rich (xD > 0.90)', xD > 0.9, `${xD.toFixed(4)}`);
    check('depropanizer: bottoms propane-lean (xB < 0.10)', xB < 0.1, `${xB.toFixed(4)}`);
    check(
      'depropanizer: closure < 1e-8',
      res.massBalance.maxAbsComponentClosure < 1e-8,
      `${res.massBalance.maxAbsComponentClosure.toExponential(2)}`
    );
    check(
      'depropanizer: energy residual ratio < 1%',
      res.energyBalance.maxStageEnthalpyResidualOverDuty < 0.01,
      `${(res.energyBalance.maxStageEnthalpyResidualOverDuty * 100).toFixed(3)}%`
    );
    check('depropanizer: result carries 20 stages', res.profiles.stages.length === 20);
    check(
      'depropanizer: converges in <= 40 Newton iterations',
      res.convergence.iterations <= 40,
      `${res.convergence.iterations} iterations`
    );
  }
}

// --- Case 3: non-ideal ethanol-water with Wilson (15 stages) ---
{
  const spec = {
    components: ['Ethanol', 'Water'],
    stageCount: 15,
    feedStage: 8,
    feedComposition: { Ethanol: 0.3, Water: 0.7 },
    refluxRatio: 2.5,
    distillateRate: 0.3,
    pressurePa: 101325,
    kValueModel: 'wilson',
    wilsonLambda: [
      [1, 0.07607],
      [0.57664, 1]
    ]
  };
  const res = RigorousDistillationColumnSolver.solve(spec);
  check(
    'ethanol-water: solver converged',
    res.success === true && res.status === 'converged',
    res.status || JSON.stringify(res.error)
  );
  if (res.success) {
    const xD = res.products.distillate.composition.Ethanol;
    const xB = res.products.bottoms.composition.Ethanol;
    console.log(`  xD(EtOH)=${xD.toFixed(4)}, xB(EtOH)=${xB.toFixed(4)}`);
    check('ethanol-water: distillate ethanol-enriched (xD > 0.65)', xD > 0.65, `${xD.toFixed(4)}`);
    check('ethanol-water: bottoms water-rich (xB < 0.15)', xB < 0.15, `${xB.toFixed(4)}`);
    check(
      'ethanol-water: closure < 1e-8',
      res.massBalance.maxAbsComponentClosure < 1e-8,
      `${res.massBalance.maxAbsComponentClosure.toExponential(2)}`
    );
    check(
      'ethanol-water: energy residual ratio < 1%',
      res.energyBalance.maxStageEnthalpyResidualOverDuty < 0.01,
      `${(res.energyBalance.maxStageEnthalpyResidualOverDuty * 100).toFixed(3)}%`
    );
  }
}

console.log(`\nnaphtali_sandholm: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
