/**
 * Hagen-Poiseuille laminar pipe flow gold-slot reference.
 *
 * Analytic solution (exact, fully developed laminar pipe flow):
 *   DeltaP = 128 mu L Q / (pi D^4)
 *   u(r) = 2 V (1 - (r/R)^2),  V = Q / (pi R^2)  (parabolic profile)
 *
 * Production path: the production physics module
 * SymbolicPhysicsKnowledgeGraph.calculatePipePressureDrop
 * (src/core/ai/symbolic_reasoner.js) is executed in the laminar regime
 * (Re < 2300). The production module applies f = 64/Re, which reduces exactly
 * to the Hagen-Poiseuille closed form. The parabolic velocity profile is the
 * documented analytic reference (substitute) built from the production-reported
 * mean velocity V.
 */

'use strict';

const { SymbolicPhysicsKnowledgeGraph } = require('../../../src/core/ai/symbolic_reasoner');

const D = 0.02; // pipe inner diameter (m)
const L = 1.0; // pipe length (m)
const RHO = 1000.0; // density (kg/m^3)
const MU = 0.01; // dynamic viscosity (Pa*s)
const Q = 1.0e-6; // volumetric flow rate (m^3/s)

function runPoiseuilleProductionCheck() {
  const R = D / 2;
  const graph = new SymbolicPhysicsKnowledgeGraph();
  const prod = graph.calculatePipePressureDrop(Q, L, D, 0, RHO, MU);

  const area = Math.PI * R * R;
  const V = Q / area;
  const Re = (RHO * V * D) / MU;
  const dPanalytic = (128 * MU * L * Q) / (Math.PI * D ** 4);

  const laminar = prod.flowRegime === 'Laminar' && Re < 2300;
  const dPErrorPercent = (Math.abs(prod.pressureDropPa - dPanalytic) / dPanalytic) * 100;
  const velocityErrorPercent = (Math.abs(prod.velocityMs - V) / V) * 100;

  // Parabolic profile substitute, anchored to the production-reported mean velocity.
  const profile = [0, 0.5, 0.8, 0.95, 1.0].map((eta) => {
    const r = eta * R;
    return {
      rOverR: eta,
      uMs: +(2 * prod.velocityMs * (1 - eta * eta)).toFixed(6)
    };
  });
  // Verify the profile integrates back to the flow rate exactly (Simpson).
  const N = 2000;
  const dr = R / N;
  let integral = 0;
  for (let i = 0; i < N; i++) {
    const r0 = i * dr;
    const r1 = (i + 1) * dr;
    const f = (r) => 2 * Math.PI * r * 2 * prod.velocityMs * (1 - (r / R) ** 2);
    integral += (dr / 6) * (f(r0) + 4 * f((r0 + r1) / 2) + f(r1));
  }
  const integralErrorPercent = (Math.abs(integral - Q) / Q) * 100;

  const tolerancePercent = 2.0;
  const passed =
    laminar && dPErrorPercent <= tolerancePercent && velocityErrorPercent <= 1e-9 && integralErrorPercent <= 1e-9;
  return {
    id: 'HAGEN_POISEUILLE_LAMINAR_PIPE',
    name: 'Hagen-Poiseuille laminar pipe: production pressure drop vs closed form 128 mu L Q/(pi D^4); parabolic profile (analytic substitute)',
    targetValue: dPanalytic,
    calculatedValue: prod.pressureDropPa,
    units: 'Pa',
    errorPercent: dPErrorPercent,
    tolerancePercent,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Production laminar pressure drop deviates from Hagen-Poiseuille by ${dPErrorPercent.toFixed(4)}%.`,
    measured: {
      reynoldsNumber: Re,
      flowRegime: prod.flowRegime,
      pressureDropPa: prod.pressureDropPa,
      pressureDropAnalyticPa: dPanalytic,
      pressureDropErrorPercent: dPErrorPercent,
      velocityMs: prod.velocityMs,
      centerlineVelocityMs: 2 * prod.velocityMs,
      profileIntegralErrorPercent: integralErrorPercent,
      profile
    },
    expected: {
      pressureDropPa: dPanalytic,
      profile: 'u(r) = 2V(1 - (r/R)^2) (exact parabolic profile; analytic substitute, tabulated above)'
    },
    details: {
      reference: 'Hagen-Poiseuille closed form (exact): DeltaP = 128 mu L Q/(pi D^4), f = 64/Re in laminar regime.',
      solver: 'SymbolicPhysicsKnowledgeGraph.calculatePipePressureDrop (production; laminar branch)',
      label:
        'The pipe pressure-drop check executes the production module. The parabolic profile is asserted as a documented analytic substitute anchored to the production-reported mean velocity.',
      note: 'The production CFD surface does not expose a 2D channel velocity-profile solver; the profile is therefore reported as an analytic substitute.'
    }
  };
}

module.exports = { runPoiseuilleProductionCheck, D, L, RHO, MU, Q };
