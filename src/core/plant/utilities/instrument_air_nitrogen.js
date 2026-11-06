/**
 * Instrument Air & Nitrogen Utilities Sizing Engine.
 *
 * Implements:
 * 1. Instrument & Plant Air Package:
 *    - Continuous and peak consumer demand aggregation (Nm3/h and FAD m3/min)
 *    - Multi-stage oil-free screw air compressor sizing with intercooler condensation
 *    - Twin-Tower Desiccant Air Dryer:
 *      * Pressure dew point (PDP) verification to -40 °C (ISO 8573.1 Class 2)
 *      * Activated alumina dynamic adsorption capacity & desiccant bed mass charge
 *      * Heatless vs Heated blower purge air regeneration consumption
 *    - Air Receiver Vessel Sizing (ride-through holdup time per API / ISO):
 *      V = (Q_demand * t_hold * P_atm) / (P_normal - P_min)
 * 2. High-Purity Nitrogen (N2) Generation & Storage Package:
 *    - Consumer sizing: LNG tank blanketing, dry gas seal buffer, flare purge, ship arm inerting
 *    - Technology trade-off: Pressure Swing Adsorption (PSA, 99.9%) vs Cryogenic ASU
 *    - Liquid Nitrogen (LIN) cryogenic vacuum-insulated backup storage and ambient vaporizers.
 */

'use strict';

class InstrumentAirNitrogenSystems {
  /**
   * Sizes the Instrument and Plant Air package including compressors, dryers, and receivers.
   *
   * @param {Object} params
   * @param {number} params.continuousInstrumentAirNm3H - Normal continuous instrument demand (Nm3/h)
   * @param {number} [params.intermittentInstrumentAirNm3H=300] - Peak intermittent demand (Nm3/h)
   * @param {number} [params.plantUtilityAirNm3H=400] - Utility maintenance air demand (Nm3/h)
   * @param {number} [params.supplyPressureBarg=7.5] - Normal header supply pressure (barg)
   * @param {number} [params.minimumInstrumentPressureBarg=4.5] - Lowest trip threshold pressure (barg)
   * @param {number} [params.holdupTimeMinutes=20] - Required receiver ride-through holdup time
   * @param {string} [params.dryerType='heatless'] - 'heatless' (15% purge) or 'heated_blower' (5% purge)
   * @returns {Object} Comprehensive air utility engineering report
   */
  static sizeAirPackage(params) {
    const {
      continuousInstrumentAirNm3H,
      intermittentInstrumentAirNm3H = 300,
      plantUtilityAirNm3H = 400,
      supplyPressureBarg = 7.5,
      minimumInstrumentPressureBarg = 4.5,
      holdupTimeMinutes = 20,
      dryerType = 'heatless'
    } = params;

    if (!continuousInstrumentAirNm3H || continuousInstrumentAirNm3H <= 0) {
      throw new Error('continuousInstrumentAirNm3H must be positive');
    }
    if (holdupTimeMinutes <= 0) {
      throw new Error('holdupTimeMinutes must be positive');
    }

    // Dryer regeneration purge loss percentage
    const purgeFraction = dryerType === 'heatless' ? 0.15 : 0.05;

    // Gross instrument air demand entering dryer
    const netInstrumentDemandNm3H = continuousInstrumentAirNm3H + 0.5 * intermittentInstrumentAirNm3H;
    const grossDryerInletNm3H = netInstrumentDemandNm3H / (1.0 - purgeFraction);
    const purgeAirLossNm3H = grossDryerInletNm3H * purgeFraction;

    // Total compressed air required from compressors
    const totalCompressorFlowNm3H = grossDryerInletNm3H + plantUtilityAirNm3H;
    const fadM3Min = totalCompressorFlowNm3H / 60.0; // Free Air Delivery

    // Compressor power calculation: 2-stage intercooled oil-free screw
    // P_shaft = (m_dot * R * T1 / eta_poly) * (2 * n/(n-1)) * [ rc^((n-1)/(2n)) - 1 ]
    // Rule of thumb for 8.5 barg screw compressor ~ 6.5 kW per m3/min FAD
    const compressorShaftPowerKW = fadM3Min * 6.5;

    // Air Receiver Sizing:
    // Sized to maintain instrument air header above P_min for holdupTimeMinutes
    // V_receiver = (Q_demand * t_hold * P_atm) / (P_supply - P_min)
    const P_atm = 1.01325; // bar
    const deltaPBar = supplyPressureBarg - minimumInstrumentPressureBarg;
    if (deltaPBar <= 0) {
      throw new Error('supplyPressureBarg must be higher than minimumInstrumentPressureBarg');
    }

    const demandM3Min = netInstrumentDemandNm3H / 60.0;
    const receiverVolumeM3 = (demandM3Min * holdupTimeMinutes * P_atm) / deltaPBar;

    // Desiccant dryer mass charge (Activated Alumina, dynamic capacity ~ 8% wt)
    // Water in saturated air at 35C and 8.0 barg: ~ 4.5 g/m3
    const moistureLoadKgH = (grossDryerInletNm3H * 0.0045);
    const cycleTimeH = dryerType === 'heatless' ? 0.1667 : 4.0; // 10 min vs 4 hours
    const waterAdsorbedPerCycleKg = moistureLoadKgH * cycleTimeH;
    const desiccantMassPerTowerKg = waterAdsorbedPerCycleKg / 0.08;

    return {
      demandSummary: {
        continuousInstrumentAirNm3H,
        peakInstrumentAirNm3H: continuousInstrumentAirNm3H + intermittentInstrumentAirNm3H,
        plantUtilityAirNm3H,
        netDryAirDeliveredNm3H: Math.round(netInstrumentDemandNm3H * 10) / 10
      },
      dryer: {
        type: dryerType === 'heatless' ? 'Heatless Twin-Tower Desiccant' : 'Heated Blower Purge Desiccant',
        targetPressureDewPointC: -40.0,
        inletGrossAirNm3H: Math.round(grossDryerInletNm3H * 10) / 10,
        purgeAirLossNm3H: Math.round(purgeAirLossNm3H * 10) / 10,
        purgeAirPercent: Math.round(purgeFraction * 1000) / 10,
        desiccantMaterial: 'Activated Alumina 1/8" Spheres',
        desiccantMassPerTowerKg: Math.round(desiccantMassPerTowerKg * 10) / 10
      },
      compressor: {
        configuration: '2 x 100% Duty / Standby Rotary Oil-Free Screw Compressors',
        dischargePressureBarg: supplyPressureBarg + 1.0, // 1 bar loss across pre-filters and dryer
        totalAirDeliveryNm3H: Math.round(totalCompressorFlowNm3H * 10) / 10,
        freeAirDeliveryM3Min: Math.round(fadM3Min * 10) / 10,
        estimatedShaftPowerKW: Math.round(compressorShaftPowerKW * 10) / 10,
        recommendedMotorRatingKW: Math.ceil((compressorShaftPowerKW * 1.15) / 10) * 10
      },
      receiverVessel: {
        holdupTimeMinutes,
        normalHeaderPressureBarg: supplyPressureBarg,
        minimumOperatingPressureBarg: minimumInstrumentPressureBarg,
        calculatedVolumeM3: Math.round(receiverVolumeM3 * 10) / 10,
        recommendedStandardVessels: `${Math.ceil(receiverVolumeM3 / 20.0)} x ${Math.min(20, Math.ceil(receiverVolumeM3))} m³ vertical receivers`
      }
    };
  }

  /**
   * Sizes the High-Purity Nitrogen generation, blanketing, and storage package.
   *
   * @param {Object} params
   * @param {number} params.lngTankBlanketingNm3H - Continuous nitrogen for LNG tank roof/annulus
   * @param {number} params.dryGasSealBufferNm3H - Dry gas seal secondary buffer for all compressors
   * @param {number} params.flarePurgeNm3H - Minimum continuous sweep to flare header
   * @param {number} [params.intermittentPurgeNm3H=500] - Ship arm / piping inerting demand
   * @param {number} [params.storageAutonomyDays=10] - Days of liquid nitrogen backup storage
   * @returns {Object} Nitrogen package engineering parameters
   */
  static sizeNitrogenPackage(params) {
    const {
      lngTankBlanketingNm3H,
      dryGasSealBufferNm3H,
      flarePurgeNm3H,
      intermittentPurgeNm3H = 500,
      storageAutonomyDays = 10
    } = params;

    if (storageAutonomyDays <= 0) {
      throw new Error('storageAutonomyDays must be positive');
    }

    const continuousDemandNm3H = (lngTankBlanketingNm3H || 0) + (dryGasSealBufferNm3H || 0) + (flarePurgeNm3H || 0);
    if (continuousDemandNm3H <= 0) {
      throw new Error('Continuous nitrogen demand must be positive');
    }
    const peakDemandNm3H = continuousDemandNm3H + intermittentPurgeNm3H;

    // Technology selection:
    // For flow > 2000 Nm3/h or high purity -> Cryogenic ASU; otherwise PSA is optimal
    const technology = continuousDemandNm3H > 2500 ? 'Cryogenic Air Separation Unit (ASU)' : 'Pressure Swing Adsorption (PSA)';
    const purity = '99.99 vol% N2 (< 100 ppmv O2)';

    // Liquid Nitrogen (LIN) Emergency Backup Storage:
    // Volume required = (continuousDemand * 24 * autonomyDays) / liquid_to_gas_expansion_ratio
    // Liquid N2 expansion ratio: 1 m3 liquid ~ 694 Nm3 gas
    const totalGasStorageNeededNm3 = continuousDemandNm3H * 24.0 * storageAutonomyDays;
    const liquidVolumeM3 = totalGasStorageNeededNm3 / 694.0;

    // Ambient Air Vaporizer sizing (Nm3/h send-out)
    const vaporizerCapacityNm3H = peakDemandNm3H * 1.25; // 25% margin

    return {
      continuousDemandNm3H: Math.round(continuousDemandNm3H * 10) / 10,
      peakDemandNm3H: Math.round(peakDemandNm3H * 10) / 10,
      generationTechnology: technology,
      productPurity: purity,
      psaRecoveryEfficiency: '50% (Requires 2.0 Nm³ feed air per Nm³ N₂ product)',
      feedAirRequiredNm3H: Math.round(continuousDemandNm3H * 2.1 * 10) / 10,
      liquidNitrogenBackup: {
        autonomyDays: storageAutonomyDays,
        totalEquivalentGasNm3: Math.round(totalGasStorageNeededNm3),
        cryogenicTankVolumeM3: Math.round(liquidVolumeM3 * 10) / 10,
        tankType: 'Double-Walled Vacuum Perlite Insulated Cryogenic Vessel',
        ambientAirVaporizers: `2 x 100% Ambient Finned Vaporizers (${Math.round(vaporizerCapacityNm3H)} Nm³/h each)`
      },
      consumerBreakdown: {
        lngTankBlanketingNm3H,
        dryGasSealBufferNm3H,
        flarePurgeNm3H,
        intermittentPurgeNm3H
      }
    };
  }
}

module.exports = {
  InstrumentAirNitrogenSystems
};
