/**
 * Atmospheric & Low-Pressure Storage Tank Venting Engine: API 2000 (7th Edition).
 * Standards: API Standard 2000 / ISO 28300 (Venting Atmospheric and Low-pressure Storage Tanks).
 *
 * Implements:
 * 1. Normal Thermal Inbreathing (Vacuum Relief) & Outbreathing (Pressure Relief):
 *    - Liquid movement pump-in / pump-out volumetric displacement
 *    - Thermal breathing from day/night atmospheric temperature swings and rain squalls
 *    - Volatile (e.g. LNG, LPG, condensate, gasoline) vs non-volatile liquid factors
 *    - Latitude (below / above 42°) and tank insulation reduction factors
 * 2. Emergency Venting for External Fire Exposure:
 *    - Wetted surface area calculation (vertical, horizontal, spherical tanks up to 9.14 m / 30 ft)
 *    - API 2000 heat absorption equations across 4 area tiers (up to > 93 m2)
 *    - Environmental factor (Fenv) for insulation, drainage, and water deluge
 *    - Required venting capacity in equivalent standard air (Nm3/h) and vapor mass rate (kg/h)
 * 3. Equipment Sizing:
 *    - PVRV (Pressure/Vacuum Relief Valve) normal breather nozzle selection
 *    - Emergency relief hatch / hinged manway cover sizing.
 */

'use strict';

class TankBreathingApi2000 {
  /**
   * Calculates normal inbreathing and outbreathing requirements per API 2000 Section 3.3.
   *
   * @param {Object} params
   * @param {number} params.tankCapacityM3 - Tank total nominal volume (m3)
   * @param {number} params.pumpInRateM3H - Maximum liquid filling / pump-in rate (m3/h)
   * @param {number} params.pumpOutRateM3H - Maximum liquid emptying / pump-out rate (m3/h)
   * @param {boolean} [params.isVolatileLiquid=false] - True if flash point < 37.8 °C or boiling point < 37.8 °C (LNG, condensate)
   * @param {number} [params.latitudeDegrees=30.0] - Site geographic latitude in degrees
   * @param {boolean} [params.isInsulated=false] - True if tank has thermal insulation
   * @param {number} [params.insulationConductivityWmK=0.04] - Insulation thermal conductivity (W/(m*K))
   * @param {number} [params.insulationThicknessMm=50.0] - Insulation thickness (mm)
   * @param {number} [params.tankDiameterM=20.0] - Tank diameter (m)
   * @param {number} [params.tankHeightM=15.0] - Tank shell height (m)
   * @returns {Object} Rigorous API 2000 normal venting calculation results
   */
  static calculateNormalBreathing(params) {
    const {
      tankCapacityM3,
      pumpInRateM3H,
      pumpOutRateM3H,
      isVolatileLiquid = false,
      latitudeDegrees = 30.0,
      isInsulated = false,
      insulationConductivityWmK = 0.04,
      insulationThicknessMm = 50.0,
      tankDiameterM = 20.0,
      tankHeightM = 15.0
    } = params;

    const V_tk = Math.max(1.0, tankCapacityM3);
    const V_pi = Math.max(0.0, pumpInRateM3H);
    const V_po = Math.max(0.0, pumpOutRateM3H);

    // 1. INBREATHING (VACUUM RELIEF)
    // 1.1 Liquid movement inbreathing Vim (API 2000 Table 1: 0.94 Nm3/h of air per m3/h of pump-out)
    const inbreathingLiquidM3H = 0.94 * V_po;

    // 1.2 Thermal inbreathing ViT (API 2000 7th Edition Section 3.3.2.2 / Table 2)
    // ViT = C * V_tk^0.70 * Ri
    const absLat = Math.abs(latitudeDegrees);
    let C_in = 0.32;
    if (isVolatileLiquid) {
      if (absLat < 42.0) {
        C_in = 0.50;
      } else if (absLat <= 58.0) {
        C_in = 0.32;
      } else {
        C_in = 0.25;
      }
    } else {
      if (absLat < 42.0) {
        C_in = 0.32;
      } else if (absLat <= 58.0) {
        C_in = 0.25;
      } else {
        C_in = 0.20;
      }
    }

    // Insulation reduction factor Ri per API 2000 (7th Ed) Eq. 6:
    // Rin = 1 / (1 + (h * lin / lambda)) with inside heat transfer coefficient h = 4.0 W/(m2*K)
    let R_in = 1.0;
    if (isInsulated) {
      const lin_m = Math.max(0.001, insulationThicknessMm / 1000.0);
      const lambda_in = Math.max(0.001, insulationConductivityWmK);
      const h_inside = 4.0; // W/(m2*K) per API 2000
      const denominator = 1.0 + (h_inside * lin_m) / lambda_in;
      R_in = Math.max(0.20, 1.0 / denominator); // API 2000 minimum credit limit 0.20
    }

    const inbreathingThermalM3H = C_in * Math.pow(V_tk, 0.70) * R_in;
    const totalInbreathingNm3H = inbreathingLiquidM3H + inbreathingThermalM3H;

    // 2. OUTBREATHING (PRESSURE RELIEF)
    // 2.1 Liquid movement outbreathing Vom (API 2000 Section 3.3.2.3 / Table 1)
    // Non-volatile: 1.07 * V_pi; Volatile (LNG, condensate): 2.14 * V_pi
    const liquidOutbreathingFactor = isVolatileLiquid ? 2.14 : 1.07;
    const outbreathingLiquidM3H = liquidOutbreathingFactor * V_pi;

    // 2.2 Thermal outbreathing VoT per API 2000 (7th Edition) Section 3.3.2.4 & Table 3:
    // VoT = Y * V_tk^0.90 * Ri
    let Y_out = 0.32;
    if (absLat < 42.0) {
      Y_out = 0.32;
    } else if (absLat <= 58.0) {
      Y_out = 0.25;
    } else {
      Y_out = 0.20;
    }

    const outbreathingThermalM3H = Y_out * Math.pow(V_tk, 0.90) * R_in;
    const totalOutbreathingNm3H = outbreathingLiquidM3H + outbreathingThermalM3H;

    // Recommended PVRV size selection based on standard capacities
    let recommendedPvrvSizeIn = '2" (DN 50)';
    const governingRate = Math.max(totalInbreathingNm3H, totalOutbreathingNm3H);
    if (governingRate > 6000.0) {
      recommendedPvrvSizeIn = 'Dual 12" (2x DN 300) or Multi-Valve Array';
    } else if (governingRate > 3500.0) {
      recommendedPvrvSizeIn = '12" (DN 300)';
    } else if (governingRate > 2200.0) {
      recommendedPvrvSizeIn = '10" (DN 250)';
    } else if (governingRate > 1400.0) {
      recommendedPvrvSizeIn = '8" (DN 200)';
    } else if (governingRate > 750.0) {
      recommendedPvrvSizeIn = '6" (DN 150)';
    } else if (governingRate > 350.0) {
      recommendedPvrvSizeIn = '4" (DN 100)';
    } else if (governingRate > 150.0) {
      recommendedPvrvSizeIn = '3" (DN 80)';
    }

    return {
      standard: 'API 2000 (7th Edition) / ISO 28300 Normal Breathing',
      tankCapacityM3: V_tk,
      fluidService: isVolatileLiquid ? 'Volatile Liquid (Boiling Pt < 37.8 °C or Flash Pt < 37.8 °C)' : 'Non-Volatile Liquid',
      latitudeFactorY: Y_out,
      insulationReductionFactorRi: Number(R_in.toFixed(3)),
      insulationReductionFactorY: Number(R_in.toFixed(3)), // backward compatibility alias
      inbreathing: {
        liquidMovementNm3H: Number(inbreathingLiquidM3H.toFixed(1)),
        thermalWeatherNm3H: Number(inbreathingThermalM3H.toFixed(1)),
        totalRequiredNm3H: Number(totalInbreathingNm3H.toFixed(1))
      },
      outbreathing: {
        liquidMovementNm3H: Number(outbreathingLiquidM3H.toFixed(1)),
        thermalWeatherNm3H: Number(outbreathingThermalM3H.toFixed(1)),
        totalRequiredNm3H: Number(totalOutbreathingNm3H.toFixed(1))
      },
      governingNormalVentingRateNm3H: Number(governingRate.toFixed(1)),
      recommendedPvrvSize: recommendedPvrvSizeIn
    };
  }

  /**
   * Calculates emergency venting requirements for external fire exposure per API 2000 Section 3.4 & 4.3.
   *
   * @param {Object} params
   * @param {'vertical_cylinder'|'horizontal_cylinder'|'sphere'} [params.tankGeometry='vertical_cylinder'] - Tank shape
   * @param {number} params.tankDiameterM - Tank outer diameter (m)
   * @param {number} params.tankHeightM - Tank shell height or length (m)
   * @param {number} params.latentHeatOfVaporizationJPerKg - Latent heat of vaporization Lv (J/kg, e.g. LNG ~ 510,000)
   * @param {number} params.relievingTemperatureC - Relieving vapor temperature (°C, e.g. LNG -160 °C)
   * @param {number} params.molecularWeight - Vapor molecular weight M (kg/kmol, methane ~ 16.04)
   * @param {boolean} [params.isElevated=false] - True if vertical tank bottom head is elevated off grade and exposed to fire
   * @param {number} [params.environmentalFactorF=1.0] - Credit factor F (1.0 bare, 0.075 to 0.30 insulated)
   * @param {number} [params.normalVentingCreditNm3H=0.0] - Credit for existing PVRV outbreathing capacity
   * @returns {Object} Complete API 2000 fire venting evaluation results
   */
  static calculateEmergencyFireVenting(params) {
    const {
      tankGeometry = 'vertical_cylinder',
      tankDiameterM,
      tankHeightM,
      latentHeatOfVaporizationJPerKg,
      relievingTemperatureC,
      molecularWeight,
      isElevated = false,
      environmentalFactorF = 1.0,
      normalVentingCreditNm3H = 0.0
    } = params;

    const D = Math.max(0.5, tankDiameterM);
    const H = Math.max(0.5, tankHeightM);
    const Lv = Math.max(10000.0, latentHeatOfVaporizationJPerKg);
    const T_K = relievingTemperatureC + 273.15;
    const M = Math.max(1.0, molecularWeight);
    const F_env = Math.max(0.05, Math.min(1.0, environmentalFactorF));

    // Calculate wetted surface area Awetted up to 9.14 m (30 ft) above grade per API 2000 Section 4.3.3.1
    let wettedAreaM2 = 0.0;
    if (tankGeometry === 'vertical_cylinder') {
      const effectiveHeight = Math.min(H, 9.14);
      wettedAreaM2 = Math.PI * D * effectiveHeight;
      if (isElevated) {
        wettedAreaM2 += (Math.PI / 4.0) * D * D; // Add exposed bottom head area
      }
    } else if (tankGeometry === 'sphere') {
      const totalSphereArea = Math.PI * D * D;
      // Wetted area up to equator or 9.14 m, whichever is greater (typically 50% of sphere)
      wettedAreaM2 = 0.50 * totalSphereArea;
    } else {
      // Horizontal cylinder: 75% of total surface area per API 2000
      const cylinderArea = Math.PI * D * H + 2.0 * ((Math.PI / 4.0) * D * D);
      wettedAreaM2 = 0.75 * cylinderArea;
    }

    const A_w = Math.max(0.1, wettedAreaM2);

    // API 2000 Metric Heat Absorption Q in Watts (Section 4.3.3.2):
    // Tier 1: A_w < 9.3 m2: Q = 63,150 * A_w
    // Tier 2: 9.3 <= A_w < 18.6 m2: Q = 224,200 * A_w^0.566
    // Tier 3: 18.6 <= A_w < 93.0 m2: Q = 630,400 * A_w^0.338
    // Tier 4: A_w >= 93.0 m2: Q = 43,200 * A_w^0.82
    let heatInputWatts = 0.0;
    let heatAbsorptionTier = '';

    if (A_w < 9.3) {
      heatInputWatts = 63150.0 * A_w;
      heatAbsorptionTier = 'Tier 1: Aw < 9.3 m2 (Q = 63,150 * Aw)';
    } else if (A_w < 18.6) {
      heatInputWatts = 224200.0 * Math.pow(A_w, 0.566);
      heatAbsorptionTier = 'Tier 2: 9.3 <= Aw < 18.6 m2 (Q = 224,200 * Aw^0.566)';
    } else if (A_w < 93.0) {
      heatInputWatts = 630400.0 * Math.pow(A_w, 0.338);
      heatAbsorptionTier = 'Tier 3: 18.6 <= Aw < 93.0 m2 (Q = 630,400 * Aw^0.338)';
    } else {
      heatInputWatts = 43200.0 * Math.pow(A_w, 0.82);
      heatAbsorptionTier = 'Tier 4: Aw >= 93.0 m2 (Q = 43,200 * Aw^0.82)';
    }

    // Net heat absorption with environmental factor
    const netHeatInputWatts = heatInputWatts * F_env;

    // Required emergency venting capacity in equivalent standard air (Nm3/h of air)
    // API 2000 Eq. 4: q_air = 906.6 * (Q_net / Lv) * sqrt(T / M)
    const qAirTotalNm3H = 906.6 * (netHeatInputWatts / Lv) * Math.sqrt(T_K / M);

    // Vapor mass flow rate generated by fire (kg/h)
    const vaporReliefRateKgH = (netHeatInputWatts / Lv) * 3600.0;

    // Net emergency requirement after crediting normal PVRV outbreathing
    const netEmergencyAirRateNm3H = Math.max(0.0, qAirTotalNm3H - normalVentingCreditNm3H);

    // Recommended emergency relief hatch sizing
    let recommendedEmergencyHatch = '20" (DN 500) Hinged Emergency Manhole Cover';
    if (netEmergencyAirRateNm3H > 150000.0) {
      recommendedEmergencyHatch = 'Multiple 24" Emergency Hatches (3 or more) / Dedicated Flare Header Connection';
    } else if (netEmergencyAirRateNm3H > 80000.0) {
      recommendedEmergencyHatch = 'Dual 24" (2x DN 600) Emergency Relief Hatches';
    } else if (netEmergencyAirRateNm3H > 40000.0) {
      recommendedEmergencyHatch = '24" (DN 600) Emergency Relief Manhole Cover';
    } else if (netEmergencyAirRateNm3H > 20000.0) {
      recommendedEmergencyHatch = '20" (DN 500) Emergency Relief Manhole Cover';
    } else if (netEmergencyAirRateNm3H > 8000.0) {
      recommendedEmergencyHatch = '16" (DN 400) Emergency Relief Hatch';
    }

    return {
      standard: 'API 2000 Section 3.4 / 4.3 Emergency Fire Exposure Venting',
      tankGeometry,
      wettedSurfaceAreaM2: Number(A_w.toFixed(2)),
      heatAbsorptionTier,
      unadjustedHeatInputWatts: Number(heatInputWatts.toFixed(0)),
      environmentalFactorF: F_env,
      netHeatInputWatts: Number(netHeatInputWatts.toFixed(0)),
      netHeatInputMw: Number((netHeatInputWatts / 1e6).toFixed(3)),
      vaporReliefRateKgH: Number(vaporReliefRateKgH.toFixed(1)),
      totalEmergencyAirEquivalentNm3H: Number(qAirTotalNm3H.toFixed(1)),
      normalVentingCreditNm3H: Number(normalVentingCreditNm3H.toFixed(1)),
      netEmergencyReliefRequiredNm3H: Number(netEmergencyAirRateNm3H.toFixed(1)),
      recommendedEmergencyDevice: recommendedEmergencyHatch
    };
  }
}

module.exports = {
  TankBreathingApi2000
};
