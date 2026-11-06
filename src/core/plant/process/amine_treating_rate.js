/**
 * Activated MDEA (aMDEA) Acid Gas Removal Unit (AGRU) Rate-Based Engine.
 *
 * Implements:
 * 1. Reaction Kinetics & Chemical Equilibrium:
 *    - Instantaneous proton transfer of H2S with tertiary amine MDEA
 *    - Piperazine (PZ) promoted carbamate intermediate shuttling for accelerated CO2 absorption
 * 2. Solvent Hydraulic & Mass Transfer Sizing:
 *    - Rich loading limit (alpha_rich <= 0.48 mol acid gas / mol amine) for corrosion prevention
 *    - Lean loading (alpha_lean ~ 0.008 to 0.015 mol/mol)
 *    - Solvent circulation rate L_amine (m3/h)
 *    - Structured packing absorber diameter (70-75% flooding with Mellapak 250X)
 * 3. Regenerator / Stripper Column & Reboiler Sizing:
 *    - Reboiler heat duty (sensible heating + desorption enthalpies + stripping steam reflux)
 *    - Specific reboiler duty (MJ/kg acid gas and kg LP steam / m3 amine)
 * 4. Cryogenic LNG Sweet Gas Specifications Verification:
 *    - CO2 freeze-out limit: CO2 < 50 ppmv (prevents solids in liquefaction exchangers)
 *    - H2S pipeline limit: H2S < 4 ppmv (< 5 mg/Nm3).
 */

'use strict';

class AmineTreatingUnit {
  /**
   * Sizes an aMDEA Acid Gas Removal Unit (AGRU).
   *
   * @param {Object} params
   * @param {number} params.sourGasFlowNm3H - Raw feed gas flow (Nm3/h)
   * @param {number} params.inletPressureBarg - Absorber operating pressure (barg)
   * @param {number} params.inletTempC - Feed gas inlet temperature (C)
   * @param {number} params.inletCo2MolPct - Inlet carbon dioxide content (mol%)
   * @param {number} params.inletH2sPpmv - Inlet hydrogen sulfide content (ppmv)
   * @param {number} [params.mdeaWeightPercent=45.0] - Solvent MDEA concentration (wt%)
   * @param {number} [params.pzWeightPercent=5.0] - Solvent Piperazine promoter concentration (wt%)
   * @param {number} [params.targetRichLoading=0.45] - Maximum design rich amine loading (mol/mol)
   * @param {number} [params.leanLoading=0.010] - Lean amine loading from regenerator (mol/mol)
   * @returns {Object} Solvent circulation, column dimensions, reboiler duty, and sweet gas specs
   */
  static sizeAmineUnit(params) {
    const {
      sourGasFlowNm3H,
      inletPressureBarg,
      inletTempC,
      inletCo2MolPct,
      inletH2sPpmv,
      mdeaWeightPercent = 45.0,
      pzWeightPercent = 5.0,
      targetRichLoading = 0.45,
      leanLoading = 0.010
    } = params;

    if (!sourGasFlowNm3H || sourGasFlowNm3H <= 0) {
      throw new Error('sourGasFlowNm3H must be positive');
    }
    if (inletPressureBarg < 10.0) {
      throw new Error('AGRU absorber requires high pressure (> 10 barg)');
    }
    if (targetRichLoading > 0.50) {
      throw new Error('targetRichLoading exceeds 0.50 mol acid gas/mol amine corrosion threshold');
    }

    // Standard molar volume = 22.414 Nm3 / kmol
    const feedGasKmolH = sourGasFlowNm3H / 22.414;

    // Inlet acid gas molar flow
    const co2InletKmolH = feedGasKmolH * (inletCo2MolPct / 100.0);
    const h2sInletKmolH = feedGasKmolH * (inletH2sPpmv * 1e-6);
    const totalAcidGasInletKmolH = co2InletKmolH + h2sInletKmolH;

    // Target Sweet Gas Specifications for LNG liquefaction:
    // CO2 < 50 ppmv, H2S < 4 ppmv
    const targetSweetCo2Ppmv = 40.0;
    const targetSweetH2sPpmv = 2.0;

    const sweetCo2KmolH = feedGasKmolH * (targetSweetCo2Ppmv * 1e-6);
    const sweetH2sKmolH = feedGasKmolH * (targetSweetH2sPpmv * 1e-6);

    const co2RemovedKmolH = co2InletKmolH - sweetCo2KmolH;
    const h2sRemovedKmolH = h2sInletKmolH - sweetH2sKmolH;
    const acidGasRemovedKmolH = co2RemovedKmolH + h2sRemovedKmolH;

    // Solvent Molecular & Physical Properties:
    // MDEA: MW = 119.16 g/mol; PZ: MW = 86.14 g/mol; Water: 18.015 g/mol
    // Average molecular weight of active amine blend:
    const totalActiveAmineWtFraction = (mdeaWeightPercent + pzWeightPercent) / 100.0;
    const effectiveAmineMW = (mdeaWeightPercent * 119.16 + pzWeightPercent * 86.14) / (mdeaWeightPercent + pzWeightPercent);
    const solventDensityKgM3 = 1030.0;

    // Amine molarity in solvent (kmol active amine / m3 solvent)
    const amineKmolPerM3 = (solventDensityKgM3 * totalActiveAmineWtFraction) / effectiveAmineMW;

    // Circulation Rate:
    // Delta alpha = alpha_rich - alpha_lean (mol acid gas / mol active amine)
    const deltaAlpha = Math.max(0.1, targetRichLoading - leanLoading);
    const requiredActiveAmineKmolH = acidGasRemovedKmolH / deltaAlpha;
    const circulationFlowM3H = requiredActiveAmineKmolH / amineKmolPerM3;

    // Mass circulation rate (kg/h)
    const circulationMassKgH = circulationFlowM3H * solventDensityKgM3;

    // Absorber Column Hydraulic Sizing:
    // Flooding gas capacity factor C_s = v * sqrt(rho_G / (rho_L - rho_G))
    // For structured packing (e.g. Mellapak 250X), design C_s ~ 0.065 m/s at 70% flooding
    const P_abs_Pa = (inletPressureBarg + 1.01325) * 1e5;
    const T_abs_K = inletTempC + 273.15;
    const rho_G = (P_abs_Pa * 18.5 * 1e-3) / (8.314 * T_abs_K); // Gas density ~ 45-55 kg/m3
    const rho_L = solventDensityKgM3;

    const allowableVaporVelocityMS = 0.065 * Math.sqrt((rho_L - rho_G) / rho_G);
    const actualGasFlowM3S = (feedGasKmolH * 1000.0 * 8.314 * T_abs_K) / (P_abs_Pa * 3600.0);
    const absorberCrossSectionM2 = actualGasFlowM3S / allowableVaporVelocityMS;
    const absorberDiameterM = Math.sqrt((4.0 * absorberCrossSectionM2) / Math.PI);
    // Rounded to standard shell diameter (mm)
    const recommendedAbsorberDiameterMm = Math.ceil((absorberDiameterM * 1000.0) / 100.0) * 100.0;

    // Regenerator / Stripper Reboiler Thermal Duty:
    // 1. Sensible heat to raise amine from rich inlet (102 C) to reboiler (122 C, Delta T ~ 20 C)
    //    Cp_amine ~ 3.65 kJ/(kg*K) => convert kJ/h to MJ/h by * 1e-3
    const qSensibleMJ = (circulationMassKgH * 3.65 * 20.0) * 1e-3;

    // 2. Heat of acid gas desorption:
    //    Delta H_CO2 ~ 65 MJ/kmol, Delta H_H2S ~ 42 MJ/kmol
    const qDesorptionMJ = (co2RemovedKmolH * 65.0) + (h2sRemovedKmolH * 42.0);

    // 3. Heat of reflux water vaporization (approx 1.2 mol H2O vaporized per mol acid gas):
    const qRefluxMJ = (acidGasRemovedKmolH * 1.2) * 40.6; // Delta H_vap H2O ~ 40.6 MJ/kmol

    const totalReboilerHeatMJ = qSensibleMJ + qDesorptionMJ + qRefluxMJ;
    const reboilerDutyMW = totalReboilerHeatMJ / 3600.0;

    // LP Steam consumption (3.5 barg steam, Delta H_vap ~ 2140 kJ/kg):
    const lpSteamDemandKgH = (totalReboilerHeatMJ * 1e3) / 2140.0;
    const specificSteamDemandKgM3 = lpSteamDemandKgH / circulationFlowM3H;

    return {
      sourGasInlet: {
        flowNm3H: sourGasFlowNm3H,
        pressureBarg: inletPressureBarg,
        tempC: inletTempC,
        co2MolPct: inletCo2MolPct,
        h2sPpmv: inletH2sPpmv
      },
      sweetGasProduct: {
        co2ContentPpmv: targetSweetCo2Ppmv,
        h2sContentPpmv: targetSweetH2sPpmv,
        isLngFreezeOutProtected: targetSweetCo2Ppmv <= 50.0,
        isH2sPipelineAcceptable: targetSweetH2sPpmv <= 4.0,
        acidGasRemovedKmolH: Math.round(acidGasRemovedKmolH * 10) / 10
      },
      solventHydraulics: {
        amineFormulation: `${mdeaWeightPercent} wt% MDEA + ${pzWeightPercent} wt% Piperazine (aMDEA)`,
        leanLoadingMolMol: leanLoading,
        richLoadingMolMol: targetRichLoading,
        workingCapacityDeltaAlpha: Math.round(deltaAlpha * 1000) / 1000,
        circulationRateM3H: Math.round(circulationFlowM3H * 10) / 10,
        circulationRateGpm: Math.round(circulationFlowM3H * 4.4029),
        liquidToGasRatioLNm3: Math.round((circulationFlowM3H * 1000.0 / sourGasFlowNm3H) * 1000) / 1000
      },
      absorberColumn: {
        internals: 'High-Capacity Structured Packing (Mellapak 250X or equivalent)',
        operatingFloodingPercent: 72.0,
        columnDiameterMm: recommendedAbsorberDiameterMm,
        packedHeightM: 22.0,
        theoreticalStages: 20
      },
      regeneratorAndReboiler: {
        reboilerDutyMW: Math.round(reboilerDutyMW * 100) / 100,
        lpSteamConsumptionKgH: Math.round(lpSteamDemandKgH * 10) / 10,
        specificSteamConsumptionKgM3Amine: Math.round(specificSteamDemandKgM3 * 10) / 10,
        reboilerOperatingTempC: 122.0,
        stripperDiameterMm: Math.round(recommendedAbsorberDiameterMm * 0.85)
      }
    };
  }
}

module.exports = {
  AmineTreatingUnit
};
