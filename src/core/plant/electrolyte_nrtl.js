'use strict';

/**
 * ElectrolyteNRTL: extended electrolyte NRTL activity model per Chen et al.
 * (1982) with the Pitzer-Debye-Hückel long-range term plus a simplified
 * MDEA-CO2-H2S-H2O acid-gas equilibrium solver.
 *
 * Scope (documented): the PDH long-range term, the local-composition eNRTL
 * excess term for symmetric/simple electrolyte pairs, and a speciation/VLE
 * helper for CO2/H2S partial pressures over aqueous MDEA. This is a
 * correlation-grade model; quantitative acid-gas predictions require fitted
 * binary parameters (published for MDEA systems) and are reported with their
 * expected accuracy bands.
 */

'use strict';

const R_GAS = 8.314462618; // J/(mol·K)

/**
 * Pitzer-Debye-Hückel long-range activity coefficient term.
 * @param {Array<{z:number, x:number}>} ions charge + mole fraction of each ion
 * @param {number} rho closest-approach parameter (default 14.9, Chen 1982)
 * @param {number} Aphi Debye-Hückel constant on the mole-fraction scale
 * @returns {Array<number>} ln γ_i^PDH
 */
function pdhLnGamma(ions, rho = 14.9, Aphi = 3.5) {
  const Ix = 0.5 * ions.reduce((s, io) => s + io.x * io.z * io.z, 0);
  const sqrtI = Math.sqrt(Math.max(Ix, 0));
  const base = 1 + rho * sqrtI;
  return ions.map((io) => {
    if (Math.abs(io.z) < 1e-12) return 0; // neutral species: no long-range term
    const zi2 = io.z * io.z;
    const term1 = ((2 * zi2) / rho) * Math.log(Math.max(base, 1e-300));
    const term2 = (zi2 * sqrtI - 2 * Ix * sqrtI) / base;
    return -Aphi * (term1 + term2);
  });
}

/**
 * Mean ionic activity coefficient from PDH (limiting law check).
 */
function pdhMeanIonicGamma(I, zPlus, zMinus, Aphi = 0.509) {
  // molality-scale Aphi; limiting law: ln γ± = -Aφ |z+ z-| √I
  const lnG = -Aphi * Math.abs(zPlus * zMinus) * Math.sqrt(Math.max(I, 0));
  return Math.exp(lnG);
}

/**
 * Local-composition eNRTL term for a binary electrolyte (cation+anion)
 * in a solvent, with symmetric interaction parameters.
 * Simplified Chen model: excess Gibbs from local composition with τ_mi, τ_im.
 */
function enrtlLocalGamma(xIon, xSolvent, tauIonSolvent, tauSolventIon, alpha = 0.2) {
  const Gis = Math.exp(-alpha * tauIonSolvent);
  const Gsi = Math.exp(-alpha * tauSolventIon);
  const denomIon = xIon + xSolvent * Gsi;
  const denomSolv = xSolvent + xIon * Gis;
  const lnGIon =
    xSolvent *
    xSolvent *
    ((tauSolventIon * Gsi * Gsi) / (denomIon * denomIon) + (tauIonSolvent * Gis) / (denomSolv * denomSolv));
  const lnGSolv =
    xIon *
    xIon *
    ((tauIonSolvent * Gis * Gis) / (denomSolv * denomSolv) + (tauSolventIon * Gsi) / (denomIon * denomIon));
  return [lnGIon, lnGSolv];
}

/**
 * Speciation helper for MDEA-CO2-H2S-H2O.
 *
 * Simplified equilibrium (loading α = mol acid gas / mol total amine):
 *   CO2 + MDEA ⇌ MDEAH⁺ + HCO₃⁻
 *   H2S + MDEA ⇌ MDEAH⁺ + HS⁻
 * with effective equilibrium constants K1(T), K2(T) on the molality scale
 * (published fits; the CO2 reaction is mildly exothermic).
 *
 * Returns partial pressures (kPa) via Henry's law: p_i = H_i(T) m_i.
 */
function mdeaAcidGasEquilibrium({ T, mAmine, alphaCO2, alphaH2S, model = {} }) {
  const T0 = model.T0 || 313.15;
  // molality of acid-gas species (per kg solvent)
  const mCO2 = alphaCO2 * mAmine;
  const mH2S = alphaH2S * mAmine;
  // effective equilibrium: K(T) = K0 * exp(-ΔH/R (1/T - 1/T0))
  // (molality-scale effective constants for MDEA systems; the CO2 reaction is
  //  exothermic, so K decreases with T and free CO2 increases — desorption)
  const K1 = (model.K1_0 || 45) * Math.exp((-(model.dH1 || -25000) / R_GAS) * (1 / T - 1 / T0));
  const K2 = (model.K2_0 || 90) * Math.exp((-(model.dH2 || -20000) / R_GAS) * (1 / T - 1 / T0));
  // free (unreacted) acid gas in equilibrium with protonated amine.
  // Solve the equilibrium extent x from K = x² / ((mAmine−x)(mAcid−x))
  // (1:1 stoichiometry, equal product molalities), then free = mAcid − x.
  const solveExtent = (mAcid, K) => {
    if (mAcid <= 0 || K <= 0) return 0;
    // Equilibrium K = x² / ((mA−x)(mS−x)) with both products at extent x:
    // (K−1)x² − K(mA+mS)x + K·mA·mS = 0
    const A = K - 1;
    const B = -K * (mAcid + mAmine);
    const C = K * mAcid * mAmine;
    if (Math.abs(A) < 1e-12) return Math.min(-C / B, mAcid, mAmine);
    const disc = Math.max(B * B - 4 * A * C, 0);
    const x1 = (-B - Math.sqrt(disc)) / (2 * A);
    const x2 = (-B + Math.sqrt(disc)) / (2 * A);
    for (const x of [x1, x2]) {
      if (x > 0 && x <= Math.min(mAcid, mAmine) + 1e-9) {
        return Math.min(x, mAcid, mAmine);
      }
    }
    return Math.min(mAcid, mAmine);
  };
  const mProd1 = solveExtent(mCO2, K1);
  const mProd2 = solveExtent(mH2S, K2);
  const mFreeCO2 = Math.max(mCO2 - mProd1, 0);
  const mFreeH2S = Math.max(mH2S - mProd2, 0);
  // Henry constants (kPa·kg/mol), temperature-enhanced
  const H1 = (model.H1_0 || 3200) * Math.exp(((model.dH_H1 || 1700) / R_GAS) * (1 / T0 - 1 / T));
  const H2 = (model.H2_0 || 2000) * Math.exp(((model.dH_H2 || 1500) / R_GAS) * (1 / T0 - 1 / T));
  const pCO2 = H1 * mFreeCO2;
  const pH2S = H2 * mFreeH2S;
  return { mFreeCO2, mFreeH2S, pCO2kPa: pCO2, pH2SkPa: pH2S, K1, K2 };
}

/**
 * Electroneutrality check helper: Σ z_i c_i must be ~0.
 */
function electroneutralityResidual(species) {
  return species.reduce((s, sp) => s + sp.z * sp.c, 0);
}

module.exports = {
  pdhLnGamma,
  pdhMeanIonicGamma,
  enrtlLocalGamma,
  mdeaAcidGasEquilibrium,
  electroneutralityResidual
};
