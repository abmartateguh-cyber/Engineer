/**
 * API 521 Annex C Flare Thermal Radiation & Sterile Radius Sizing Engine.
 *
 * Implements standard flare thermal radiation modeling:
 *  - Heat release calculation Q = m_dot * LHV.
 *  - Fraction of heat radiated F based on molecular weight, smokeless assist, and API 521 benchmarks.
 *  - Flame length L using API 521 / Brzustowski-Sommer correlation.
 *  - Flame tilt theta and flame center displacement (xc, zc) under crosswind.
 *  - Atmospheric transmissivity tau accounting for humidity and distance.
 *  - Ground-level flare radiation flux K_flare and total flux (flare + solar).
 *  - API 521 Table 10 permissible exposure levels:
 *      * 1.58 kW/m^2: Continuous personnel presence without protective clothing
 *      * 4.73 kW/m^2: Emergency actions lasting several minutes with standard workwear
 *      * 6.31 kW/m^2: Escape only (max 1 minute exposure)
 *      * 9.46 kW/m^2: Equipment only / unoccupied structures
 *  - Minimum flare stack height H_min and sterile boundary radius R_boundary determination.
 */

'use strict';

/**
 * API 521 Table 10 Permissible Thermal Radiation Exposure Levels.
 */
const API_521_RADIATION_LIMITS = Object.freeze({
  continuous_personnel: {
    maxFluxKwM2: 1.58, // 500 Btu/h*ft^2
    description: 'Maximum for continuous personnel exposure with unlimited time, no protective clothing'
  },
  emergency_action: {
    maxFluxKwM2: 4.73, // 1500 Btu/h*ft^2
    description: 'Areas where emergency actions lasting up to several minutes may be required with standard clothing'
  },
  escape_only: {
    maxFluxKwM2: 6.31, // 2000 Btu/h*ft^2
    description: 'Areas where personnel exposure is limited to escape only (max 1 minute)'
  },
  equipment_only: {
    maxFluxKwM2: 9.46, // 3000 Btu/h*ft^2
    description: 'Maximum at equipment or structures where personnel are not present'
  }
});

/**
 * Typical Lower Heating Values (LHV in kJ/kg) for flare relief gases.
 */
const FLARE_GAS_LHV = Object.freeze({
  methane: 50000.0, // kJ/kg
  lng_vapor: 49000.0,
  ethane: 47500.0,
  propane: 46300.0,
  butane: 45700.0,
  ethylene: 47200.0,
  hydrogen: 120000.0,
  acid_gas_lean: 8000.0 // Low calorific fuel/acid gas
});

/**
 * Calculate fraction of heat radiated F (API 521 Annex C).
 * F = 0.20 * sqrt(MW / 16), bounded between 0.15 and 0.35.
 *
 * @param {Object} p
 * @param {number} p.molecularWeight
 * @param {boolean} [p.isSmokelessAssisted=false] Steam or air assist reduces soot radiation
 * @returns {number} Fraction of heat radiated F (0.15 to 0.35)
 */
function calculateRadiationFractionF(p) {
  const mw = p.molecularWeight || 16.0;
  const isSmokeless = Boolean(p.isSmokelessAssisted);

  // Baseline API 521 correlation
  let F = 0.20 * Math.sqrt(mw / 16.0);
  if (isSmokeless) {
    F *= 0.85; // ~15% reduction in luminous soot radiation
  }

  return Math.min(0.35, Math.max(0.15, F));
}

/**
 * Calculate flame length L in meters (API 521 Brzustowski-Sommer power-law fit).
 * L = 0.00607 * (Q_watts)^0.478
 *
 * @param {number} heatReleaseKw Total heat release rate in kW
 * @returns {number} Flame length in meters
 */
function calculateFlameLength(heatReleaseKw) {
  if (heatReleaseKw <= 0) return 0;
  const heatReleaseW = heatReleaseKw * 1000.0;
  return 0.00607 * Math.pow(heatReleaseW, 0.478);
}

/**
 * Calculate atmospheric transmissivity tau (Brzustowski / API 521).
 * tau = 0.79 * (100 / (r * RH))^0.0625, capped at 1.0.
 *
 * @param {number} distanceM Distance from flame center to receiver in meters
 * @param {number} [relativeHumidityPct=50.0] Ambient relative humidity %
 * @returns {number} Atmospheric transmissivity factor (0.7 to 1.0)
 */
function calculateTransmissivity(distanceM, relativeHumidityPct = 50.0) {
  const r = Math.max(1.0, distanceM);
  const rh = Math.min(100.0, Math.max(10.0, relativeHumidityPct));
  const tau = 0.79 * Math.pow(100.0 / (r * rh), 0.0625);
  return Math.min(1.0, Math.max(0.70, tau));
}

/**
 * API 521 Flare Thermal Radiation Sizing Engine.
 */
class FlareRadiationApi521 {
  /**
   * @param {Object} spec
   * @param {string} [spec.flareTag='FLARE-MAIN']
   * @param {number} spec.reliefRateKgH Mass flaring rate in kg/h
   * @param {number} [spec.lowerHeatingValueKjKg=50000.0] Gas LHV in kJ/kg
   * @param {number} [spec.molecularWeight=18.0] Gas molecular weight
   * @param {number} [spec.tipDiameterM=1.0] Flare tip inner diameter
   * @param {number} [spec.stackHeightM=50.0] Flare stack height in meters
   * @param {number} [spec.windSpeedMPerS=10.0] Design crosswind speed in m/s (default 10 m/s = 36 km/h)
   * @param {number} [spec.solarRadiationKwM2=0.79] Background solar flux (default 0.79 kW/m^2 = 250 Btu/h*ft^2)
   * @param {number} [spec.relativeHumidityPct=50.0] Ambient relative humidity %
   * @param {boolean} [spec.isSmokelessAssisted=false] Steam/air assist
   */
  constructor(spec) {
    this.flareTag = spec.flareTag || 'FLARE-MAIN';
    this.reliefRateKgH = spec.reliefRateKgH;
    this.lhvKjKg = spec.lowerHeatingValueKjKg || FLARE_GAS_LHV.methane;
    this.molecularWeight = spec.molecularWeight || 18.0;
    this.tipDiameterM = spec.tipDiameterM || 1.0;
    this.stackHeightM = spec.stackHeightM !== undefined ? spec.stackHeightM : 50.0;
    this.windSpeedMPerS = spec.windSpeedMPerS !== undefined ? spec.windSpeedMPerS : 10.0;
    this.solarRadiationKwM2 = spec.solarRadiationKwM2 !== undefined ? spec.solarRadiationKwM2 : 0.79;
    this.relativeHumidityPct = spec.relativeHumidityPct || 50.0;
    this.isSmokelessAssisted = Boolean(spec.isSmokelessAssisted);

    // Compute basic thermal parameters
    const massFlowKgS = this.reliefRateKgH / 3600.0;
    this.heatReleaseKw = massFlowKgS * this.lhvKjKg; // kW
    this.radiationFractionF = calculateRadiationFractionF({
      molecularWeight: this.molecularWeight,
      isSmokelessAssisted: this.isSmokelessAssisted
    });
    this.radiantHeatKw = this.heatReleaseKw * this.radiationFractionF;
    this.flameLengthM = calculateFlameLength(this.heatReleaseKw);

    // Flare tip exit velocity: u_j = m_dot / (rho_tip * A_tip)
    const tipAreaM2 = (Math.PI / 4.0) * Math.pow(this.tipDiameterM, 2);
    // Approximate density of relief gas at tip (~100°C, 1 atm)
    const rhoTip = (101325.0 * this.molecularWeight) / (8314.46 * 373.15);
    this.tipVelocityMPerS = massFlowKgS / (rhoTip * tipAreaM2);

    // Flame tilt angle under crosswind (Brzustowski / API 521 Annex C)
    const u_w = Math.max(0.1, this.windSpeedMPerS);
    const u_j = Math.max(1.0, this.tipVelocityMPerS);
    // Tilt angle theta from vertical
    this.tiltAngleRad = Math.atan2(u_w, u_j);
    this.tiltAngleDeg = (this.tiltAngleRad * 180.0) / Math.PI;

    // Center of flame radiation (simple point-source at 0.5 * flame length)
    this.flameCenterXcM = 0.5 * this.flameLengthM * Math.sin(this.tiltAngleRad);
    this.flameCenterZcM = this.stackHeightM + 0.5 * this.flameLengthM * Math.cos(this.tiltAngleRad);
  }

  /**
   * Calculate ground radiation at a specific downwind horizontal distance from flare base.
   *
   * @param {number} downwindDistanceM Horizontal distance along wind direction from stack base
   * @param {number} [receiverHeightM=1.8] Personnel ear/head height in meters
   * @returns {Object} Flare radiation flux, solar flux, total flux (kW/m^2)
   */
  calculateGroundRadiation(downwindDistanceM, receiverHeightM = 1.8) {
    const dx = downwindDistanceM - this.flameCenterXcM;
    const dz = this.flameCenterZcM - receiverHeightM;
    const distanceM = Math.sqrt(dx * dx + dz * dz);

    const tau = calculateTransmissivity(distanceM, this.relativeHumidityPct);
    // Point source radiation: K = (tau * Qr) / (4 * pi * D^2)
    const flareFluxKwM2 = (tau * this.radiantHeatKw) / (4.0 * Math.PI * Math.pow(distanceM, 2));
    const totalFluxKwM2 = flareFluxKwM2 + this.solarRadiationKwM2;

    return {
      downwindDistanceM,
      distanceFromFlameCenterM: distanceM,
      transmissivityTau: tau,
      flareFluxKwM2,
      solarFluxKwM2: this.solarRadiationKwM2,
      totalFluxKwM2
    };
  }

  /**
   * Generate radial radiation profile from stack base out to a specified distance.
   *
   * @param {number} [maxDistanceM=500.0]
   * @param {number} [stepM=20.0]
   * @returns {Array<Object>} Profile points
   */
  generateRadiationProfile(maxDistanceM = 500.0, stepM = 20.0) {
    const profile = [];
    for (let d = 0; d <= maxDistanceM; d += stepM) {
      profile.push(this.calculateGroundRadiation(d));
    }
    return profile;
  }

  /**
   * Determine sterile boundary radius (m) from flare stack base for target radiation isopleths.
   * Targets: 1.58, 4.73, 6.31, 9.46 kW/m^2.
   *
   * Computes both:
   * 1. 3D distance from center of flame D = sqrt(tau * Qr / (4 * pi * (K - S)))
   * 2. Ground radius from stack base downwind: x_c + sqrt(D^2 - (z_c - z_rec)^2) if D > (z_c - z_rec), else 0.
   *
   * @param {number} [receiverHeightM=1.8]
   * @returns {Object} Sterile boundary radii for each API 521 limit
   */
  calculateSterileBoundaries(receiverHeightM = 1.8) {
    const calcIsopleth = (targetTotalFluxKwM2) => {
      const targetFlareFlux = targetTotalFluxKwM2 - this.solarRadiationKwM2;
      if (targetFlareFlux <= 0) {
        return { distance3DM: 0, groundRadiusM: 0 };
      }

      // Initial estimate of 3D distance assuming tau = 0.85
      let D = Math.sqrt((0.85 * this.radiantHeatKw) / (4.0 * Math.PI * targetFlareFlux));
      // Refine tau with distance
      for (let i = 0; i < 3; i++) {
        const tau = calculateTransmissivity(D, this.relativeHumidityPct);
        D = Math.sqrt((tau * this.radiantHeatKw) / (4.0 * Math.PI * targetFlareFlux));
      }

      const hVert = Math.max(0.0, this.flameCenterZcM - receiverHeightM);
      let groundRadius = 0.0;
      if (D > hVert) {
        const rCircle = Math.sqrt(Math.pow(D, 2) - Math.pow(hVert, 2));
        groundRadius = Math.round((this.flameCenterXcM + rCircle) * 10) / 10;
      }

      return {
        distance3DM: Math.round(D * 10) / 10,
        groundRadiusM: groundRadius
      };
    };

    const iso1_58 = calcIsopleth(API_521_RADIATION_LIMITS.continuous_personnel.maxFluxKwM2);
    const iso4_73 = calcIsopleth(API_521_RADIATION_LIMITS.emergency_action.maxFluxKwM2);
    const iso6_31 = calcIsopleth(API_521_RADIATION_LIMITS.escape_only.maxFluxKwM2);
    const iso9_46 = calcIsopleth(API_521_RADIATION_LIMITS.equipment_only.maxFluxKwM2);

    return {
      continuousPersonnelRadiusM_1_58: iso1_58.groundRadiusM,
      emergencyActionRadiusM_4_73: iso4_73.groundRadiusM,
      escapeOnlyRadiusM_6_31: iso6_31.groundRadiusM,
      equipmentOnlyRadiusM_9_46: iso9_46.groundRadiusM,
      distanceFromFlameCenterM_1_58: iso1_58.distance3DM,
      distanceFromFlameCenterM_4_73: iso4_73.distance3DM,
      distanceFromFlameCenterM_6_31: iso6_31.distance3DM,
      distanceFromFlameCenterM_9_46: iso9_46.distance3DM
    };
  }

  /**
   * Calculate minimum flare stack height required so that ground radiation at stack base
   * does not exceed a specified maximum limit (e.g. 4.73 or 6.31 kW/m^2).
   *
   * @param {number} [targetMaxBaseFluxKwM2=4.73] Allowable radiation at flare base
   * @returns {number} Minimum stack height in meters
   */
  calculateMinimumStackHeight(targetMaxBaseFluxKwM2 = 4.73) {
    if (this.reliefRateKgH <= 0 || this.heatReleaseKw <= 0) {
      return 15.0; // Structural baseline minimum
    }

    const targetFlareFlux = targetMaxBaseFluxKwM2 - this.solarRadiationKwM2;
    if (targetFlareFlux <= 0) return 100.0; // Background solar alone exceeds or equals target

    // Initial estimate of required 3D distance with baseline tau
    let requiredDistanceD = Math.sqrt((0.85 * this.radiantHeatKw) / (4.0 * Math.PI * targetFlareFlux));
    for (let i = 0; i < 3; i++) {
      const tau = calculateTransmissivity(requiredDistanceD, this.relativeHumidityPct);
      requiredDistanceD = Math.sqrt((tau * this.radiantHeatKw) / (4.0 * Math.PI * targetFlareFlux));
    }

    // D^2 = xc^2 + zc^2 = xc^2 + (H + 0.5*L*cos(theta))^2
    const inside = Math.pow(requiredDistanceD, 2) - Math.pow(this.flameCenterXcM, 2);
    if (inside <= 0) return 15.0;

    const zcNeeded = Math.sqrt(inside);
    const minHeight = zcNeeded - 0.5 * this.flameLengthM * Math.cos(this.tiltAngleRad);

    return Math.max(15.0, Math.round(minHeight * 10) / 10);
  }
}

module.exports = {
  API_521_RADIATION_LIMITS,
  FLARE_GAS_LHV,
  calculateRadiationFractionF,
  calculateFlameLength,
  calculateTransmissivity,
  FlareRadiationApi521
};
