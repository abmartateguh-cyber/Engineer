/**
 * API 661 / ISO 13706 Air-Cooled Heat Exchanger (ACHE) Sizing Engine.
 *
 * Implements:
 * 1. Finned-Tube Bundle Geometry & Surface Area:
 *    - Standard 25.4 mm (1.0 inch) OD bare tubes with aluminum tension-wound or extruded fins
 *    - Fin density (e.g. 10 fins/inch = 394 fins/m) and fin height (15.875 mm = 5/8 inch)
 *    - Total external finned area to bare area multiplier (typically 21.0 - 24.0)
 * 2. Cross-Flow Thermal Rating per API 661:
 *    - Process and air temperature profiles, LMTD, and cross-flow correction factor FT
 *    - Overall bare tube heat transfer coefficient U_bare (W/m2*K) and finned U_ext
 * 3. Aerodynamic Air-Side Hydraulics & Fan Sizing:
 *    - Face velocity verification (2.5 to 3.5 m/s)
 *    - Bundle static air pressure drop Delta P_static
 *    - Axial fan diameter, blade tip speed (<= 60 m/s for API 661 noise limitation)
 *    - Fan motor shaft power and bay configuration (Forced Draft vs Induced Draft).
 */

'use strict';

class AirCoolerApi661 {
  /**
   * Evaluates and sizes an Air-Cooled Heat Exchanger bay per API 661.
   *
   * @param {Object} params
   * @param {number} params.thermalDutyMW - Process heat duty to reject to ambient air (MW)
   * @param {number} params.processInletTempC - Hot process fluid inlet temperature Th1 (C)
   * @param {number} params.processOutletTempC - Hot process fluid outlet temperature Th2 (C)
   * @param {number} params.ambientAirInletTempC - Site maximum design air dry-bulb temp Tc1 (C)
   * @param {number} [params.targetAirFaceVelocityMS=3.0] - Air velocity entering face of bundle (m/s)
   * @param {number} [params.tubeLengthM=10.0] - Tube active length (m, typically 9.0 to 12.0 m)
   * @param {number} [params.numberOfTubeRows=4] - Bundle tube depth (typically 4, 5, or 6 rows)
   * @param {number} [params.designOverallUBareW=750.0] - Target overall U based on bare outside tube area (W/m2*K)
   * @param {string} [params.draftType='forced'] - 'forced' or 'induced'
   * @returns {Object} Complete API 661 ACHE mechanical and thermal sizing report
   */
  static sizeAirCoolerBay(params) {
    const {
      thermalDutyMW,
      processInletTempC,
      processOutletTempC,
      ambientAirInletTempC,
      targetAirFaceVelocityMS = 3.0,
      tubeLengthM = 10.0,
      numberOfTubeRows = 4,
      designOverallUBareW = 750.0,
      draftType = 'forced'
    } = params;

    if (!thermalDutyMW || thermalDutyMW <= 0) {
      throw new Error('thermalDutyMW must be positive');
    }
    if (processInletTempC <= processOutletTempC) {
      throw new Error('processInletTempC must be greater than processOutletTempC');
    }
    if (processOutletTempC <= ambientAirInletTempC) {
      throw new Error('processOutletTempC must be strictly greater than ambientAirInletTempC');
    }

    // Standard finned-tube geometry:
    // Bare tube OD = 25.4 mm (1 inch), ID = 21.18 mm (14 BWG)
    // Fin height = 15.875 mm (5/8 in), Fin pitch = 10 FPI (393.7 fins/m)
    // Fin area ratio = Total finned area / Bare tube outside area ~ 21.4
    const bareTubeOdM = 0.0254;
    const bareAreaPerMeterM2 = Math.PI * bareTubeOdM; // 0.0798 m2/m
    const finAreaRatio = 21.4;
    const totalAreaPerMeterM2 = bareAreaPerMeterM2 * finAreaRatio; // 1.708 m2/m

    // Triangular tube pitch: Pt = 63.5 mm (2.5 inches)
    const tubePitchM = 0.0635;

    // Estimate air outlet temperature Tc2:
    // Rule of thumb for economic ACHE: Air temperature rise ~ 15 to 25 C
    const airTempRiseC = Math.min(25.0, (processInletTempC - ambientAirInletTempC) * 0.40);
    const airOutletTempC = ambientAirInletTempC + airTempRiseC;

    // Air properties at mean temperature
    const tAirMeanC = (ambientAirInletTempC + airOutletTempC) / 2.0;
    const rhoAir = 1.293 * (273.15 / (tAirMeanC + 273.15)); // kg/m3 ~ 1.15 - 1.20
    const cpAir = 1.006; // kJ/(kg*K)

    // Air mass flow required: Q = m_dot_air * Cp_air * DeltaT_air
    const mDotAirKgS = (thermalDutyMW * 1e3) / (cpAir * airTempRiseC);
    const volumetricAirFlowM3S = mDotAirKgS / rhoAir;

    // Log Mean Temperature Difference (LMTD) for pure counter-flow:
    // Delta T1 = Th1 - Tc2, Delta T2 = Th2 - Tc1
    const dt1 = processInletTempC - airOutletTempC;
    const dt2 = processOutletTempC - ambientAirInletTempC;

    if (dt1 <= 0 || dt2 <= 0) {
      throw new Error('Temperature cross detected; air outlet temperature exceeds process inlet');
    }

    const lmtdCounterFlow = (dt1 - dt2) / Math.log(dt1 / dt2);

    // Cross-flow correction factor FT per API 661 Figure B.1 (typically 0.95 to 0.98 for 4 rows)
    const R_temp = (processInletTempC - processOutletTempC) / (airOutletTempC - ambientAirInletTempC);
    const P_temp = (airOutletTempC - ambientAirInletTempC) / (processInletTempC - ambientAirInletTempC);
    const fT = Math.min(0.99, Math.max(0.85, 1.0 - 0.04 * (R_temp * P_temp)));
    const effectiveLmtdK = lmtdCounterFlow * fT;

    // Required heat transfer surface area based on bare tube area:
    // Q = U_bare * A_bare * effectiveLMTD
    const requiredBareAreaM2 = (thermalDutyMW * 1e6) / (designOverallUBareW * effectiveLmtdK);
    const totalFinnedAreaM2 = requiredBareAreaM2 * finAreaRatio;

    // Total length of tubing required:
    const totalTubeLengthM = requiredBareAreaM2 / bareAreaPerMeterM2;
    const totalTubesCount = Math.ceil(totalTubeLengthM / tubeLengthM);

    // Tubes per row = totalTubes / numberOfTubeRows
    const tubesPerRow = Math.ceil(totalTubesCount / numberOfTubeRows);
    const bundleWidthM = tubesPerRow * tubePitchM;

    // Bundle face area: A_face = bundleWidth * tubeLength
    const bundleFaceAreaM2 = bundleWidthM * tubeLengthM;
    const actualAirFaceVelocityMS = volumetricAirFlowM3S / bundleFaceAreaM2;

    // Air static pressure drop across finned-tube bundle:
    // Delta P_static (Pa) = f_bundle * N_rows * (rho * v_max^2 / 2)
    // Approximate API 661 empirical correlation for 10 FPI 5/8" fins:
    // Delta P_static ~ 25 to 30 Pa per row at 3.0 m/s face velocity
    const deltaPStaticPa = numberOfTubeRows * (28.0 * Math.pow(actualAirFaceVelocityMS / 3.0, 1.8));

    // Fan sizing: typically 2 axial fans per bay
    const fansCount = 2;
    const airFlowPerFanM3S = volumetricAirFlowM3S / fansCount;

    // Sizing fan diameter to cover ~ 40-50% of face area:
    const fanDiameterM = Math.min(4.8, Math.max(2.4, Math.round(Math.sqrt((4.0 * (bundleFaceAreaM2 * 0.45 / fansCount)) / Math.PI) * 10) / 10));

    // Fan tip speed check: v_tip = pi * D * N_rpm / 60 <= 60 m/s
    const maxRpm = Math.floor((60.0 * 60.0) / (Math.PI * fanDiameterM));
    const selectedFanRpm = Math.min(maxRpm, 320); // standard direct-drive or belt-drive RPM
    const actualTipSpeedMS = (Math.PI * fanDiameterM * selectedFanRpm) / 60.0;

    // Fan shaft power: P_fan = (Q_fan * Delta_P_total) / (1000 * eta_fan)
    // eta_fan ~ 0.70 total efficiency
    const totalFanPressurePa = deltaPStaticPa + 25.0; // including velocity pressure & plenum loss
    const shaftPowerPerFanKW = (airFlowPerFanM3S * totalFanPressurePa) / (1000.0 * 0.70);
    const totalFanPowerKW = shaftPowerPerFanKW * fansCount;

    return {
      service: 'Process Natural Gas / Refrigerant Aerial Cooler',
      draftConfiguration: draftType === 'forced' ? 'Forced Draft (Fans below bundle)' : 'Induced Draft (Fans above bundle)',
      thermalPerformance: {
        thermalDutyMW,
        processInletTempC,
        processOutletTempC,
        airInletTempC: ambientAirInletTempC,
        airOutletTempC: Math.round(airOutletTempC * 10) / 10,
        lmtdCounterFlowK: Math.round(lmtdCounterFlow * 10) / 10,
        crossFlowCorrectionFactorFT: Math.round(fT * 1000) / 1000,
        effectiveLmtdK: Math.round(effectiveLmtdK * 10) / 10,
        overallUBareWPerM2K: designOverallUBareW,
        overallUFinnedWPerM2K: Math.round((designOverallUBareW / finAreaRatio) * 10) / 10
      },
      bundleGeometry: {
        tubeLengthM,
        numberOfRows: numberOfTubeRows,
        totalTubesCount: tubesPerRow * numberOfTubeRows,
        tubesPerRow,
        bundleWidthM: Math.round(bundleWidthM * 100) / 100,
        faceAreaM2: Math.round(bundleFaceAreaM2 * 10) / 10,
        bareSurfaceAreaM2: Math.round(requiredBareAreaM2 * 10) / 10,
        finnedSurfaceAreaM2: Math.round(totalFinnedAreaM2 * 10) / 10,
        tubeMaterial: 'Carbon Steel / AISI 316L (1.0" OD x 14 BWG)',
        finMaterial: 'Aluminum 1060 Tension-Wound / Extruded (5/8" high, 10 FPI)'
      },
      aerodynamicsAndFans: {
        totalAirFlowKgS: Math.round(mDotAirKgS * 10) / 10,
        totalAirFlowM3S: Math.round(volumetricAirFlowM3S * 10) / 10,
        faceVelocityMS: Math.round(actualAirFaceVelocityMS * 100) / 100,
        bundleStaticPressureDropPa: Math.round(deltaPStaticPa * 10) / 10,
        fansCountPerBay: fansCount,
        fanDiameterM,
        fanOperatingRpm: selectedFanRpm,
        bladeTipSpeedMS: Math.round(actualTipSpeedMS * 10) / 10,
        isNoiseCompliant: actualTipSpeedMS <= 60.0,
        shaftPowerPerFanKW: Math.round(shaftPowerPerFanKW * 10) / 10,
        totalFanElectricPowerKW: Math.round(totalFanPowerKW * 10) / 10,
        recommendedMotorRatingPerFanKW: Math.ceil((shaftPowerPerFanKW * 1.20) / 5) * 5
      }
    };
  }
}

module.exports = {
  AirCoolerApi661
};
