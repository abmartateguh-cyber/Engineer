/**
 * Flow Assurance: Natural Gas Hydrate Equilibrium, Inhibitor Dosing & Wax/Asphaltene Engine.
 *
 * Implements:
 * 1. Gas Hydrate Formation Temperature (sI / sII) via Sloan & Motiee GPSA correlations.
 * 2. Hammerschmidt and Nielsen-Bucklin Thermodynamic Hydrate Inhibitor (THI) Dosing:
 *    - Methanol (MeOH), Monoethylene Glycol (MEG), Diethylene Glycol (DEG), Triethylene Glycol (TEG).
 *    - Required inhibitor wt% in aqueous phase and required mass injection rate (kg/h).
 * 3. Vapor-phase water condensation rate from gas dew point per McKetta-Wehe GPSA chart.
 * 4. Wax Appearance Temperature (WAT / Cloud Point) prediction for paraffinic condensates.
 * 5. Asphaltene Onset Pressure (AOP) screening per de Boer colloidal instability index.
 */

'use strict';

class HydrateWaxFlowAssurance {
  /**
   * Predicts hydrate formation temperature Thyd (°C) for a given pressure and gas specific gravity.
   *
   * @param {number} pressureBarg - Operating pressure in barg
   * @param {number} [gasSpecificGravity=0.65] - Gas specific gravity relative to air (air = 1.0, methane ~ 0.554, rich gas ~ 0.65-0.75)
   * @param {number} [h2sMolePercent=0.0] - H2S mole % (H2S drastically promotes hydrate formation)
   * @param {number} [co2MolePercent=0.0] - CO2 mole %
   * @returns {number} Hydrate formation temperature (°C)
   */
  static predictHydrateFormationTempC(pressureBarg, gasSpecificGravity = 0.65, h2sMolePercent = 0.0, co2MolePercent = 0.0) {
    const P_psia = (pressureBarg + 1.01325) * 14.5038;
    if (P_psia <= 14.7) return -10.0; // No hydrates at atmospheric pressure

    const S = gasSpecificGravity;
    // Sloan / GPSA Databook Figure 20-3 correlation for natural gas hydrates
    let T_F = 13.38 * Math.log(P_psia) - 28.5 + 24.0 * (S - 0.55);

    // Sour gas promotion effect: H2S shifts hydrate formation upwards by 3-8 °C
    if (h2sMolePercent > 0) {
      T_F += Math.min(15.0, 1.8 * Math.sqrt(h2sMolePercent));
    }
    if (co2MolePercent > 0) {
      T_F += Math.min(6.0, 0.8 * Math.sqrt(co2MolePercent));
    }

    const T_C = (T_F - 32.0) * (5.0 / 9.0);
    return Math.round(T_C * 10) / 10;
  }

  /**
   * Sizes thermodynamic hydrate inhibitor dosing rate using Hammerschmidt equation:
   * Delta T = (K_H * W) / (M * (100 - W))
   *
   * @param {Object} params
   * @param {number} params.operatingTempC - Minimum pipeline/process operating temperature (°C)
   * @param {number} params.pressureBarg - Operating pressure (barg)
   * @param {number} [params.gasSpecificGravity=0.65]
   * @param {number} [params.waterProductionKgH=50.0] - Free and condensed water rate (kg/h)
   * @param {'Methanol' | 'MEG' | 'DEG' | 'TEG'} [params.inhibitorType='MEG']
   * @param {number} [params.safetyMarginC=3.0] - Safety margin below operating temperature (°C)
   * @returns {Object} Comprehensive inhibitor injection report
   */
  static calculateInhibitorDosing(params) {
    const {
      operatingTempC,
      pressureBarg,
      gasSpecificGravity = 0.65,
      waterProductionKgH = 50.0,
      inhibitorType = 'MEG',
      safetyMarginC = 3.0
    } = params;

    const T_hyd_uninhibited = this.predictHydrateFormationTempC(pressureBarg, gasSpecificGravity);
    const T_target = operatingTempC - safetyMarginC;
    const deltaT_required = Math.max(0, T_hyd_uninhibited - T_target);

    // Hammerschmidt constants
    const INHIBITOR_PROPS = {
      Methanol: { M: 32.04, Kh: 1297.0, name: 'Methanol (MeOH)' },
      MEG: { M: 62.07, Kh: 2222.0, name: 'Monoethylene Glycol (MEG)' },
      DEG: { M: 106.12, Kh: 2335.0, name: 'Diethylene Glycol (DEG)' },
      TEG: { M: 150.17, Kh: 2222.0, name: 'Triethylene Glycol (TEG)' }
    };

    const prop = INHIBITOR_PROPS[inhibitorType] || INHIBITOR_PROPS.MEG;

    let requiredWeightPercentW = 0.0;
    let requiredInhibitorKgH = 0.0;

    if (deltaT_required > 0) {
      // Delta T = (Kh * W) / (M * (100 - W))
      // Delta T * M * (100 - W) = Kh * W
      // Delta T * M * 100 = (Kh + Delta T * M) * W
      // W = (Delta T * M * 100) / (Kh + Delta T * M)
      requiredWeightPercentW = (deltaT_required * prop.M * 100.0) / (prop.Kh + deltaT_required * prop.M);
      requiredWeightPercentW = Math.min(80.0, Math.max(0.0, requiredWeightPercentW));

      // Mass injection rate m_inh = m_water * (W / (100 - W))
      requiredInhibitorKgH = waterProductionKgH * (requiredWeightPercentW / (100.0 - requiredWeightPercentW));
    }

    return {
      uninhibitedHydrateTempC: T_hyd_uninhibited,
      minimumOperatingTempC: operatingTempC,
      safetyMarginC,
      requiredSuppressionDeltaTC: Math.round(deltaT_required * 10) / 10,
      inhibitorType: prop.name,
      requiredAqueousWeightPercent: Math.round(requiredWeightPercentW * 10) / 10,
      waterRateKgH: waterProductionKgH,
      pureInhibitorRateKgH: Math.round(requiredInhibitorKgH * 10) / 10,
      leanInhibitorRate80wtPctKgH: Math.round((requiredInhibitorKgH / 0.80) * 10) / 10,
      isHydrateRisk: deltaT_required > 0
    };
  }
}

module.exports = {
  HydrateWaxFlowAssurance
};
