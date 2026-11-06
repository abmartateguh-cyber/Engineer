/**
 * Fire & Gas (F&G) Detection & NFPA 15 Deluge Spray Sizing Engine.
 *
 * Implements standard industrial safety engineering:
 *  - Detector technology catalog: Point IR, Catalytic bead, Open-Path line-of-sight IR,
 *    Triple-IR (IR3) optical flame, Ultrasonic acoustic leak detectors (UAGD), and Toxic H2S cells.
 *  - Alarm & Executive voting: 1ooN (alert / HVAC extract) and 2ooN (confirmed trip / executive ESD).
 *  - Detector layout mapping and grid coverage density estimation for plant process envelopes.
 *  - NFPA 15 Water Spray Fixed Systems (Deluge) sizing:
 *      * Design spray densities: Process units (10.2 L/min/m^2), LNG pumps (12.2 L/min/m^2),
 *        vessels (10.2 L/min/m^2), structural steel (4.1 L/min/m^2).
 *      * Firewater hydraulic demand calculation with hydraulic imbalance margin.
 *      * Spray nozzle hydraulic sizing: q = K * sqrt(P) and nozzle count calculation.
 */

'use strict';

/**
 * Standard detector technologies and technical characteristics.
 */
const DETECTOR_TECHNOLOGIES = Object.freeze({
  point_ir_gas: {
    technology: 'Point Infrared (PIR)',
    measuredVariable: 'Hydrocarbon Gas Concentration (% LEL)',
    measurementRange: '0 - 100% LEL',
    typicalAlarms: { lowAlarmLelPct: 20.0, highHighTripLelPct: 50.0 },
    effectiveRadiusM: 5.0, // Recommended coverage radius around potential leak sources
    responseTimeT90Sec: 3.5,
    advantages: 'Fails safe, immune to poisons, operates without oxygen',
    votingRecommendation: '2ooN for executive shutdown; 1ooN for warning alarm'
  },
  catalytic_bead_gas: {
    technology: 'Catalytic Bead (Electro-catalytic pellistor)',
    measuredVariable: 'Combustible Gas Concentration (% LEL)',
    measurementRange: '0 - 100% LEL',
    typicalAlarms: { lowAlarmLelPct: 20.0, highHighTripLelPct: 50.0 },
    effectiveRadiusM: 4.5,
    responseTimeT90Sec: 10.0,
    advantages: 'Detects hydrogen and general hydrocarbons; low cost',
    votingRecommendation: '2ooN for executive shutdown'
  },
  open_path_ir_gas: {
    technology: 'Open-Path Line-of-Sight Infrared (OPGD)',
    measuredVariable: 'Integrated Path Gas Concentration (LEL-m)',
    measurementRange: '0 - 5.0 LEL-m',
    typicalAlarms: { lowAlarmLelM: 1.0, highHighTripLelM: 2.5 },
    minPathLengthM: 5.0,
    maxPathLengthM: 120.0,
    responseTimeT90Sec: 2.0,
    advantages: 'Covers perimeter line across prevailing wind, fast detection of large clouds',
    votingRecommendation: '1ooN or 2ooN perimeter fence isolation'
  },
  triple_ir_flame: {
    technology: 'Multi-Spectrum Triple Infrared (IR3)',
    measuredVariable: 'Flame Optical Radiation (CO2 resonance ~4.3 um)',
    measurementRange: 'Up to 60m for 0.1 m^2 n-heptane pan fire',
    fieldOfViewDeg: 90.0,
    effectiveDistanceM: 45.0,
    responseTimeSec: 3.0,
    advantages: 'Long range, high immunity to false alarms (sunlight, hot turbine casings, arc welding)',
    votingRecommendation: '2ooN confirmed flame for automatic deluge activation'
  },
  ultrasonic_acoustic_leak: {
    technology: 'Ultrasonic Acoustic Gas Leak Detector (UAGD)',
    measuredVariable: 'Acoustic Sound Pressure in 20 - 100 kHz band (dB)',
    measurementRange: '40 - 105 dB',
    triggerThresholdDb: 68.0,
    effectiveRadiusM: 15.0, // Radius around high-pressure gas equipment (> 2 barg)
    responseTimeSec: 0.1, // Speed of sound
    advantages: 'Instantaneous detection unaffected by wind direction or cloud dilution',
    votingRecommendation: '1ooN for rapid early warning; 2ooN with gas detector for trip'
  },
  toxic_h2s_electrochemical: {
    technology: 'Electrochemical Cell H2S Detector',
    measuredVariable: 'Hydrogen Sulfide Concentration (ppm)',
    measurementRange: '0 - 100 ppm',
    typicalAlarms: { lowAlarmPpm: 5.0, highHighTripPpm: 10.0 },
    effectiveRadiusM: 4.0,
    responseTimeT90Sec: 15.0,
    advantages: 'High sensitivity to toxic sour gas',
    votingRecommendation: '1ooN for personnel evacuation siren; 2ooN for unit trip'
  }
});

/**
 * Standard NFPA 15 Deluge Design Spray Densities (L/min/m^2).
 * Sourced from NFPA 15 Standard for Water Spray Fixed Systems for Fire Protection.
 */
const NFPA_15_DENSITIES = Object.freeze({
  process_units: {
    description: 'Process vessels, compressors, and general process equipment envelopes',
    densityLMinM2: 10.2, // 0.25 gpm/ft^2
    standardReference: 'NFPA 15 Section 7.4.2'
  },
  pumps_lng_flammable: {
    description: 'Pumps handling flammable liquids, LNG, LPG, or seal areas',
    densityLMinM2: 12.2, // 0.30 gpm/ft^2
    standardReference: 'NFPA 15 Section 7.4.3'
  },
  vessels_spheres_bullets: {
    description: 'Pressurized storage vessels, bullets, and sphere wetted surface exposure',
    densityLMinM2: 10.2, // 0.25 gpm/ft^2
    standardReference: 'NFPA 15 Section 7.4.1'
  },
  cable_trays: {
    description: 'Electrical and instrument cable trays',
    densityLMinM2: 12.2, // 0.30 gpm/ft^2
    standardReference: 'NFPA 15 Section 7.5'
  },
  structural_steel: {
    description: 'Structural steel columns, beams, and pipe racks supporting equipment',
    densityLMinM2: 4.1, // 0.10 gpm/ft^2
    standardReference: 'NFPA 15 Section 7.4.2.2'
  }
});

/**
 * Standard open spray deluge nozzles (metric K-factors in L/min / bar^0.5).
 */
const DELUGE_NOZZLES = Object.freeze({
  'K-22': { kFactor: 22.0, sprayAngleDeg: 120.0, thread: '1/2" NPT' },
  'K-30': { kFactor: 30.0, sprayAngleDeg: 120.0, thread: '1/2" NPT' },
  'K-42': { kFactor: 42.0, sprayAngleDeg: 120.0, thread: '3/4" NPT' },
  'K-58': { kFactor: 58.0, sprayAngleDeg: 120.0, thread: '3/4" NPT' },
  'K-80': { kFactor: 80.0, sprayAngleDeg: 120.0, thread: '1" NPT' }
});

/**
 * Evaluate Fire & Gas voting logic across multiple detector channels in a zone.
 *
 * @param {Object} p
 * @param {'1ooN'|'2ooN'} p.votingScheme
 * @param {Array<{tag:string, value:number, isFault?:boolean}>} p.detectors Channel list
 * @param {number} p.threshold Trigger threshold value (e.g. 20% LEL or 50% LEL)
 * @returns {Object} Voting decision, active count, alarm triggered
 */
function evaluateFgVoting(p) {
  const voting = p.votingScheme || '2ooN';
  const detectors = p.detectors || [];
  const threshold = p.threshold;

  let activeDetectors = [];
  let faultDetectors = [];

  for (const det of detectors) {
    if (det.isFault) {
      faultDetectors.push(det.tag);
    } else if (det.value === true || det.triggered === true || det.isAlarm === true) {
      activeDetectors.push(det.tag);
    } else if (typeof det.value === 'number' && threshold !== undefined && det.value >= threshold) {
      activeDetectors.push(det.tag);
    }
  }

  const activeCount = activeDetectors.length;
  let requiredActive = 2; // Default for 2ooN

  if (voting === '1ooN' || voting === '1oo1' || voting === '1oo2') {
    requiredActive = 1;
  } else if (voting === '2ooN' || voting === '2oo2' || voting === '2oo3') {
    requiredActive = 2;
  } else {
    const match = String(voting).match(/^(\d+)oo(\d+|N)$/i);
    if (match) {
      requiredActive = parseInt(match[1], 10);
    }
  }

  const isTriggered = activeCount >= requiredActive;

  return {
    votingScheme: voting,
    totalChannels: detectors.length,
    activeCount,
    requiredActive,
    isTriggered,
    activeDetectors,
    faultDetectors
  };
}

/**
 * Sizing engine for NFPA 15 Water Spray Fixed Deluge Systems.
 */
class Nfpa15DelugeSizingEngine {
  /**
   * Sizing firewater demand and nozzles for an equipment protection envelope.
   *
   * @param {Object} spec
   * @param {string} [spec.systemTag='DELUGE-01']
   * @param {string} [spec.serviceType='process_units'] Key in NFPA_15_DENSITIES or custom
   * @param {number} [spec.customDensityLMinM2] Custom density override
   * @param {number} spec.protectedSurfaceAreaM2 Total wetted / envelope surface area in m^2
   * @param {number} [spec.hydraulicImbalanceFactor=1.15] Hydraulic design margin (15% standard)
   * @param {number} [spec.operatingNozzlePressureBar=2.0] Pressure at nozzle tip in bar (typically 1.4 - 3.5 bar)
   * @param {string} [spec.nozzleType='K-30'] Key in DELUGE_NOZZLES
   * @returns {Object} Complete NFPA 15 hydraulic report
   */
  static sizeDelugeSystem(spec) {
    const areaM2 = spec.protectedSurfaceAreaM2;
    if (areaM2 <= 0) throw new RangeError('protectedSurfaceAreaM2 must be > 0');

    let density = spec.customDensityLMinM2;
    if (density === undefined) {
      const sType = spec.serviceType || 'process_units';
      density = NFPA_15_DENSITIES[sType] ? NFPA_15_DENSITIES[sType].densityLMinM2 : 10.2;
    }

    const margin = spec.hydraulicImbalanceFactor !== undefined ? spec.hydraulicImbalanceFactor : 1.15;
    const pNozzleBar = spec.operatingNozzlePressureBar || 2.0;

    // Net flow rate = Area * Density
    const qNetLMin = areaM2 * density;
    // Total design flow with hydraulic imbalance margin
    const qDesignLMin = qNetLMin * margin;
    const qDesignM3H = (qDesignLMin * 60.0) / 1000.0;

    // Nozzle hydraulic flow: q = K * sqrt(P)
    const nozzleKey = spec.nozzleType || 'K-30';
    const nozzleSpec = DELUGE_NOZZLES[nozzleKey] || DELUGE_NOZZLES['K-30'];
    const nozzleFlowLMin = nozzleSpec.kFactor * Math.sqrt(pNozzleBar);

    // Number of nozzles required
    const nozzleCount = Math.ceil(qDesignLMin / nozzleFlowLMin);
    const actualTotalFlowLMin = nozzleCount * nozzleFlowLMin;
    const actualTotalFlowM3H = (actualTotalFlowLMin * 60.0) / 1000.0;

    // Spacing
    const areaPerNozzle = areaM2 / nozzleCount;
    const nominalSpacingM = Math.sqrt(areaPerNozzle);

    return {
      systemTag: spec.systemTag || 'DELUGE-01',
      protectedSurfaceAreaM2: areaM2,
      designDensityLMinM2: density,
      hydraulicImbalanceFactor: margin,
      operatingNozzlePressureBar: pNozzleBar,
      flowDemand: {
        netLMin: qNetLMin,
        netM3H: (qNetLMin * 60.0) / 1000.0,
        designLMin: qDesignLMin,
        designM3H: qDesignM3H,
        actualTotalLMin: actualTotalFlowLMin,
        actualTotalM3H: actualTotalFlowM3H
      },
      nozzles: {
        selectedNozzle: nozzleKey,
        kFactor: nozzleSpec.kFactor,
        sprayAngleDeg: nozzleSpec.sprayAngleDeg,
        singleNozzleFlowLMin: nozzleFlowLMin,
        requiredCount: nozzleCount,
        areaPerNozzleM2: areaPerNozzle,
        nominalSpacingM: Math.round(nominalSpacingM * 100) / 100
      }
    };
  }
}

/**
 * F&G Plant Zone Detector Layout Evaluator.
 */
class FireGasZoneLayout {
  /**
   * @param {Object} spec
   * @param {string} spec.zoneName Name of plant area (e.g. 'MR Compressor Deck')
   * @param {number} spec.lengthM Zone length in meters
   * @param {number} spec.widthM Zone width in meters
   * @param {number} [spec.heightM=8.0] Deck height
   * @param {number} [spec.highPressureEquipmentCount=4] Compressors, heat exchangers, separators
   * @param {boolean} [spec.isCryogenicLng=true] Cryogenic service flag
   * @param {boolean} [spec.hasToxicH2s=false] Toxic H2S / sour gas presence
   */
  constructor(spec) {
    this.zoneName = spec.zoneName || 'Process Area';
    this.lengthM = spec.lengthM;
    this.widthM = spec.widthM;
    this.heightM = spec.heightM || 8.0;
    this.highPressureEquipmentCount = spec.highPressureEquipmentCount || 2;
    this.isCryogenicLng = spec.isCryogenicLng !== undefined ? spec.isCryogenicLng : true;
    this.hasToxicH2s = Boolean(spec.hasToxicH2s || spec.sourGas);
    this.detectors = [];
  }

  /**
   * Compute recommended detector quantities and placement grid for the zone.
   * @returns {Object} Detector mapping recommendations
   */
  generateRecommendedLayout() {
    const areaM2 = this.lengthM * this.widthM;

    // 1. Point IR Gas Detectors: 5m grid spacing gives ~25 m^2 coverage per detector
    // For 2ooN voting overlap, effective spacing is 5m
    const pointIrCount = Math.max(4, Math.ceil(areaM2 / 25.0));

    // 2. Open-Path IR Detectors: along perimeter boundaries (minimum 2 lines crossing boundary)
    const perimeterM = 2.0 * (this.lengthM + this.widthM);
    const opgdCount = Math.max(2, Math.ceil(perimeterM / 40.0));

    // 3. Flame Detectors (Triple IR): arranged for 2ooN triangulation coverage
    // Each IR3 covers ~40m cone, placed at diagonal corners
    const flameIr3Count = Math.max(3, Math.ceil(areaM2 / 300.0) + 1);

    // 4. Ultrasonic Acoustic Detectors: placed near high-pressure equipment
    const uagdCount = Math.max(2, this.highPressureEquipmentCount);

    // 5. Toxic H2S Detectors (if sour gas service, 4m effective radius per DETECTOR_TECHNOLOGIES.toxic_h2s_electrochemical)
    const toxicH2sCount = this.hasToxicH2s ? Math.max(2, Math.ceil(areaM2 / 20.0)) : 0;

    const recommendedDetectors = {
      pointIrGas: {
        count: pointIrCount,
        gridSpacingM: 5.0,
        description: 'Point IR sensors distributed on 5m grid at 0.5m above grade / tray'
      },
      openPathIrGas: {
        count: opgdCount,
        description: 'Line-of-sight beams across prevailing wind and fence perimeter'
      },
      flameIr3: {
        count: flameIr3Count,
        description: 'Multi-spectrum optical IR3 flame detectors for 2ooN fire voting'
      },
      ultrasonicAcoustic: {
        count: uagdCount,
        description: 'UAGD acoustic leak sensors for high-pressure gas machinery'
      }
    };

    if (this.hasToxicH2s) {
      recommendedDetectors.toxicH2s = {
        count: toxicH2sCount,
        gridSpacingM: 4.0,
        description: 'Electrochemical toxic H2S cells placed near potential sour gas release points'
      };
    }

    const votingMatrix = {
      gasLowAlarm: '1ooN PIR at 20% LEL -> Warning alarm & HVAC extraction boost',
      gasHighHighTrip: '2ooN PIR at 50% LEL or 1 OPGD at 2.5 LEL-m -> Executive ESD-1 / ESD-2 unit isolation',
      flameTrip: '2ooN IR3 confirmed flame -> Trip machinery, close ESDVs, trip deluge valve'
    };

    if (this.hasToxicH2s) {
      votingMatrix.toxicH2sAlarm = '1ooN H2S at 5 ppm -> Evacuation alarm; 2ooN H2S at 10 ppm -> Executive unit trip';
    }

    return {
      zoneName: this.zoneName,
      dimensions: {
        lengthM: this.lengthM,
        widthM: this.widthM,
        heightM: this.heightM,
        footprintAreaM2: areaM2
      },
      recommendedDetectors,
      votingMatrix
    };
  }
}

module.exports = {
  DETECTOR_TECHNOLOGIES,
  NFPA_15_DENSITIES,
  DELUGE_NOZZLES,
  evaluateFgVoting,
  Nfpa15DelugeSizingEngine,
  FireGasZoneLayout
};
