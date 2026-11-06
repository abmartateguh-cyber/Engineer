'use strict';

// Test-only constitutive constants. These are synthetic fixtures, not material data.
const SYNTHETIC_J2_MATERIAL = Object.freeze({
  yieldStressMPa: 250,
  hardeningModulusMPa: 500,
  E_MPa: 30000,
  nu: 0.25
});

const SYNTHETIC_JOHNSON_COOK_MATERIAL = Object.freeze({
  A: 250,
  B: 300,
  n: 0.4,
  C: 0.01,
  m: 1,
  T_room: 300,
  T_melt: 1800,
  eps0_dot: 1,
  D1: 0.1,
  D2: 0.2,
  D3: -1,
  D4: 0.01,
  D5: 1
});

const SYNTHETIC_CONTINUUM_MATERIAL = Object.freeze({
  E: 2.1e11,
  nu: 0.3,
  yieldStress: 250e6,
  hardeningModulus: 1e9,
  A: 250e6,
  B: 300e6,
  n: 0.4,
  C: 0.01,
  m: 1,
  refStrainRate: 1,
  Tmelt: 1800,
  Troom: 300
});

const SYNTHETIC_LINEAR_ELASTIC_MATERIAL = Object.freeze({
  E: 2.1e11,
  nu: 0.3,
  yieldStress: 250e6
});

const SYNTHETIC_COMPOSITE_PLY = Object.freeze({
  thicknessMm: 0.125,
  orientationDeg: 0,
  E1: 30e9,
  E2: 10e9,
  G12: 5e9,
  nu12: 0.25,
  strengths: Object.freeze({ Xt: 1800e6, Xc: 1200e6, Yt: 50e6, Yc: 200e6, S: 80e6 })
});

const SYNTHETIC_HYPERELASTIC_MOONEY_RIVLIN = Object.freeze({ C10: 0.3e6, C01: 0.15e6 });

const SYNTHETIC_VOF_FLUID_PROPERTIES = Object.freeze({
  surfaceTensionNPerM: 0.01,
  rho1: 2,
  rho2: 1,
  mu1: 0.02,
  mu2: 0.01
});

module.exports = {
  SYNTHETIC_J2_MATERIAL,
  SYNTHETIC_JOHNSON_COOK_MATERIAL,
  SYNTHETIC_CONTINUUM_MATERIAL,
  SYNTHETIC_LINEAR_ELASTIC_MATERIAL,
  SYNTHETIC_COMPOSITE_PLY,
  SYNTHETIC_HYPERELASTIC_MOONEY_RIVLIN,
  SYNTHETIC_VOF_FLUID_PROPERTIES
};
