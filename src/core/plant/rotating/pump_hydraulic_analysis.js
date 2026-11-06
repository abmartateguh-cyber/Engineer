/**
 * Centrifugal Pump Hydraulic Analysis: NPSHa, Cavitation & API 682 Mechanical Seal Plan Selector.
 *
 * Implements:
 * 1. Rigorous Net Positive Suction Head Available (NPSHa) calculation:
 *    NPSHa = (P_vessel_abs - P_vap) / (rho * g) + z_static - h_friction_loss
 * 2. API 610 NPSH Margin Evaluation (absolute margin >= 1.0 m, margin ratio >= 1.35).
 * 3. Hydraulic cavitation risk indexing (NPSH3% head breakdown vs incipient bubble formation).
 * 4. API 682 4th Edition Mechanical Seal Flush Piping Plan Selection:
 *    - Plan 11, Plan 21, Plan 31, Plan 52, Plan 53A/B/C, Plan 72, Plan 74.
 */

'use strict';

class PumpHydraulicAnalysis {
  /**
   * Calculates Net Positive Suction Head Available (NPSHa).
   *
   * @param {Object} params
   * @param {number} params.suctionVesselPressureBarg - Suction vessel operating pressure (barg)
   * @param {number} params.liquidVaporPressureBarg - Vapor pressure at operating temperature (barg)
   * @param {number} params.liquidDensityKgM3 - Liquid density rho (kg/m3)
   * @param {number} params.staticLiquidHeadM - Elevation of liquid surface above pump centerline z (m, positive for flooded)
   * @param {number} params.suctionFrictionLossM - Total piping, valve, and strainer head loss h_f (m)
   * @param {number} params.npshRequiredM - Manufacturer NPSH required at duty point NPSHr (m)
   * @returns {Object} NPSH evaluation and margin compliance report
   */
  static evaluateNpsh(params) {
    const {
      suctionVesselPressureBarg,
      liquidVaporPressureBarg,
      liquidDensityKgM3,
      staticLiquidHeadM,
      suctionFrictionLossM,
      npshRequiredM
    } = params;

    const g = 9.80665; // m/s2
    const rho = liquidDensityKgM3;

    // Absolute pressures in Pascals
    const P_vessel_abs_Pa = (suctionVesselPressureBarg + 1.01325) * 1e5;
    const P_vap_abs_Pa = Math.max(0, (liquidVaporPressureBarg + 1.01325) * 1e5);

    // Pressure head terms in meters of liquid: h = P / (rho * g)
    const vesselHeadM = P_vessel_abs_Pa / (rho * g);
    const vaporPressureHeadM = P_vap_abs_Pa / (rho * g);

    // NPSHa = (P_vessel - P_vap)/(rho*g) + z - h_friction
    const npshAvailableM = (vesselHeadM - vaporPressureHeadM) + staticLiquidHeadM - suctionFrictionLossM;

    const absoluteMarginM = npshAvailableM - npshRequiredM;
    const marginRatio = npshRequiredM > 0 ? npshAvailableM / npshRequiredM : 999.0;

    // API 610 recommends: absolute margin >= 1.0 m and ratio >= 1.35 for hydrocarbon/chemical service
    const isCompliant = absoluteMarginM >= 1.0 && marginRatio >= 1.35;

    let cavitationRisk = 'None / Safe Margins';
    if (npshAvailableM <= npshRequiredM) {
      cavitationRisk = 'CRITICAL: Severe Choked Cavitation with Impeller Erosion & Head Drop (NPSHa <= NPSHr)';
    } else if (!isCompliant) {
      cavitationRisk = 'Marginal: Incipient Cavitation Possible. Increase static head or reduce line friction';
    }

    return {
      suctionVesselHeadM: Math.round(vesselHeadM * 10) / 10,
      vaporPressureHeadM: Math.round(vaporPressureHeadM * 10) / 10,
      staticElevationHeadM: staticLiquidHeadM,
      suctionFrictionLossM,
      npshAvailableM: Math.round(npshAvailableM * 100) / 100,
      npshRequiredM,
      absoluteMarginM: Math.round(absoluteMarginM * 100) / 100,
      marginRatio: Math.round(marginRatio * 100) / 100,
      isCompliant,
      cavitationRisk
    };
  }

  /**
   * Recommends API 682 Mechanical Seal Flush Piping Plan based on fluid hazard and conditions.
   *
   * @param {Object} serviceConditions
   * @param {boolean} serviceConditions.isSourH2S - True if sour hydrocarbon with H2S
   * @param {boolean} serviceConditions.isCryogenic - True if cryogenic liquid (e.g. LNG, liquid ethylene)
   * @param {boolean} serviceConditions.isHighTemperature - True if > 150 °C (hot oil / bottoms)
   * @param {boolean} serviceConditions.hasAbrasiveSolids - True if sand, scale, or catalyst fines present
   * @returns {Object} API 682 seal configuration and piping plan recommendation
   */
  static selectApi682SealPlan(serviceConditions) {
    const { isSourH2S, isCryogenic, isHighTemperature, hasAbrasiveSolids } = serviceConditions;

    if (isSourH2S) {
      return {
        sealArrangement: 'Arrangement 3 (Dual Pressurized Mechanical Seal)',
        pipingPlan: 'Plan 53B / 53C (Pressurized Barrier Fluid System with Bladder Accumulator)',
        rationale: 'Mandated by NACE MR0175 and API 682 for lethal/toxic sour H2S service to guarantee zero fugitive emissions into atmosphere.',
        barrierFluidPressure: 'Maintained at minimum 1.5 to 2.0 bar above maximum seal chamber pressure.'
      };
    }

    if (isCryogenic) {
      return {
        sealArrangement: 'Arrangement 1 or Arrangement 2 (Single or Dual Seal with Cryogenic Vapor Flush)',
        pipingPlan: 'Plan 72 / 74 (Dual Gas Seal with Buffer / Barrier High-Purity Nitrogen)',
        rationale: 'Cryogenic LNG (-162 °C) flashing across liquid faces creates dry running; pressurized dry gas N2 seal prevents icing and product leakage.',
        barrierFluidPressure: 'High-purity dry nitrogen (99.99%) seal barrier.'
      };
    }

    if (hasAbrasiveSolids) {
      return {
        sealArrangement: 'Arrangement 1 (Single Cartridge Mechanical Seal)',
        pipingPlan: 'Plan 31 (Recirculation from Discharge through Cyclone Separator to Seal Chamber)',
        rationale: 'Cyclone separator centrifugally extracts abrasive particulate solids before clean fluid flushes seal faces.',
        barrierFluidPressure: 'Cleaned discharge stream directed back to seal faces.'
      };
    }

    if (isHighTemperature) {
      return {
        sealArrangement: 'Arrangement 1 (Single Cartridge with High-Temp Welded Metal Bellows)',
        pipingPlan: 'Plan 21 (Discharge Flush with In-Line Shell-and-Tube Heat Exchanger Cooler)',
        rationale: 'Cooling the flush fluid protects O-rings/elastomers and prevents liquid vaporization in the seal chamber.',
        barrierFluidPressure: 'Recirculation flow through 603 cooler.'
      };
    }

    // Default general clean service
    return {
      sealArrangement: 'Arrangement 1 (Single Cartridge Seal)',
      pipingPlan: 'Plan 11 (Standard Flush from Pump Discharge to Seal Chamber through Orifice)',
      rationale: 'Industry standard for clean, stable hydrocarbon and utility water services under 150 °C.',
      barrierFluidPressure: 'Self-flushing from discharge.'
    };
  }
}

module.exports = {
  PumpHydraulicAnalysis
};
