/**
 * Experimental optical algorithms for caller-supplied prescriptions, material
 * properties, and ray inputs. No independent optical validation or commercial
 * parity is implied.
 */

const { OpticalMaterials } = require('./optical_materials');
const { SkewRayTracer } = require('./skew_ray_tracer');
const { SeidelAberrations } = require('./seidel_aberrations');

class OpticalEngine {
  static Materials = OpticalMaterials;
  static SkewTracer = SkewRayTracer;
  static Seidel = SeidelAberrations;
  static _materialProperties(material) {
    if (typeof material === 'number' && Number.isFinite(material) && material > 0) {
      return { nd: material, nF: material, nC: material };
    }
    if (
      material &&
      typeof material === 'object' &&
      ['nd', 'nF', 'nC'].every((key) => Number.isFinite(material[key]) && material[key] > 0)
    ) {
      return { nd: material.nd, nF: material.nF, nC: material.nC };
    }
    const properties = OpticalMaterials.getFraunhoferProperties(material);
    if (!['nd', 'nF', 'nC'].every((key) => Number.isFinite(properties[key]) && properties[key] > 0)) {
      throw new TypeError('An optical material must supply finite positive d/F/C indices.');
    }
    return properties;
  }

  static _requirePrescription(prescription) {
    if (
      !prescription ||
      typeof prescription !== 'object' ||
      !Array.isArray(prescription.elements) ||
      prescription.elements.length === 0
    ) {
      throw new TypeError('An explicit optical prescription with at least one element is required.');
    }
    for (const field of ['focalLengthMm', 'objectSpaceMaterial', 'gapMaterial', 'imageSpaceMaterial']) {
      if (prescription[field] === undefined || prescription[field] === null) {
        throw new TypeError(`Optical prescription requires explicit ${field}.`);
      }
    }
    if (!Number.isFinite(prescription.focalLengthMm) || prescription.focalLengthMm <= 0) {
      throw new TypeError('Optical prescription focalLengthMm must be finite and positive.');
    }
    return prescription;
  }

  // Compatibility alias: the application no longer bundles a 50 mm lens prescription.
  static get50mmPrescription(prescription) {
    if (prescription === undefined) {
      throw new RangeError('No source-reviewed 50 mm prescription is bundled; provide an explicit prescription.');
    }
    return this._requirePrescription(prescription);
  }

  static getOpticalSurfaces(prescription) {
    const rx = this._requirePrescription(prescription);
    const objectSpace = this._materialProperties(rx.objectSpaceMaterial);
    const gapMedium = this._materialProperties(rx.gapMaterial);
    const imageSpace = this._materialProperties(rx.imageSpaceMaterial);
    const surfaces = [];
    let surrounding = objectSpace;
    let skipFront = false;

    const appendSurface = (element, id, radius, zVertex, nextMedium, properties, coefficients = [0, 0, 0, 0]) => {
      surfaces.push({
        id,
        radius,
        zVertex,
        thickness: element.centerThicknessMm,
        clearRadius: element.clearApertureMm / 2,
        nIncident: properties.nd,
        nTransmitted: nextMedium.nd,
        nIncidentF: properties.nF,
        nIncidentC: properties.nC,
        nTransmittedF: nextMedium.nF,
        nTransmittedC: nextMedium.nC,
        conic: element.conicFront || 0,
        asphericCoeffs: coefficients,
        asphericA4: coefficients[0] || 0
      });
    };

    for (let index = 0; index < rx.elements.length; index++) {
      const element = rx.elements[index];
      const requiredNumbers = [
        element?.radiusFrontMm,
        element?.radiusRearMm,
        element?.centerThicknessMm,
        element?.clearApertureMm,
        element?.zPosMm
      ];
      if (!element || !element.opticalMaterial || !requiredNumbers.every(Number.isFinite)
        || element.centerThicknessMm <= 0 || element.clearApertureMm <= 0) {
        throw new TypeError(`Prescription element ${index} has incomplete geometry or material data.`);
      }

      const material = this._materialProperties(element.opticalMaterial);
      const frontCoefficients = element.asphericCoeffsFront || [0, 0, 0, 0];
      if (!Array.isArray(frontCoefficients) || frontCoefficients.length !== 4
        || !frontCoefficients.every(Number.isFinite)) {
        throw new TypeError(`Prescription element ${index} has invalid aspheric coefficients.`);
      }
      if (!skipFront) {
        appendSurface(
          element,
          `${element.id || index}_Front`,
          element.radiusFrontMm,
          element.zPosMm,
          material,
          surrounding,
          frontCoefficients
        );
      }

      const nextElement = rx.elements[index + 1];
      const cemented = Boolean(element.cementedToNext);
      if (cemented) {
        if (!nextElement) throw new TypeError('The final prescription element cannot be cemented to a following element.');
        if (!nextElement.opticalMaterial) throw new TypeError('A cemented element needs explicit material data.');
        const nextMaterial = this._materialProperties(nextElement.opticalMaterial);
        appendSurface(
          element,
          `${element.id || index}_${nextElement.id || index + 1}_Cemented`,
          element.radiusRearMm,
          element.zPosMm + element.centerThicknessMm,
          nextMaterial,
          material
        );
        surrounding = nextMaterial;
        skipFront = true;
      } else {
        const outgoingMedium = nextElement ? gapMedium : imageSpace;
        appendSurface(
          element,
          `${element.id || index}_Rear`,
          element.radiusRearMm,
          element.zPosMm + element.centerThicknessMm,
          outgoingMedium,
          material
        );
        surrounding = outgoingMedium;
        skipFront = false;
      }
    }
    return surfaces;
  }

  /**
   * Computes optical diffraction limits, depth of field, and aperture geometry.
   * @param {number} focalLengthMm e.g. 50mm
   * @param {number} fStop e.g. 1.4, 2.8, 5.6, 16.0
   * @param {number} subjectDistM
   * @param {number} wavelengthNm
   * @param {number} circleOfConfusionMm
   */
  static solveOpticalMetrics(focalLengthMm, fStop, subjectDistM, wavelengthNm, circleOfConfusionMm) {
    if (
      !Number.isFinite(focalLengthMm) ||
      focalLengthMm <= 0 ||
      !Number.isFinite(fStop) ||
      fStop <= 0 ||
      !Number.isFinite(subjectDistM) ||
      subjectDistM <= 0 ||
      !Number.isFinite(wavelengthNm) ||
      wavelengthNm <= 0 ||
      !Number.isFinite(circleOfConfusionMm) ||
      circleOfConfusionMm <= 0
    ) {
      throw new TypeError(
        'solveOpticalMetrics requires positive focalLengthMm, fStop, subjectDistM, wavelengthNm, and circleOfConfusionMm inputs.'
      );
    }
    const f = Number(focalLengthMm);
    const N = Number(fStop);
    const s = Number(subjectDistM) * 1000; // in mm
    const lambdaNm = Number(wavelengthNm);
    const lambdaMm = lambdaNm * 1e-6;

    // 1. Entrance Pupil Diameter (Clear aperture opening)
    // D = f / N
    const entrancePupilDiameterMm = f / N;

    // 2. Numerical Aperture (NA)
    // NA = n * sin(theta) ≈ D / (2 * f)
    const NA = entrancePupilDiameterMm / (2 * f);

    // 3. Airy Disk Diameter at the caller-supplied wavelength
    // d_Airy = 2.44 * lambda * N
    const airyDiskDiameterUm = 2.44 * lambdaMm * N * 1000;

    // 5. Hyperfocal Distance (H)
    // H = (f^2) / (N * c) + f
    const hyperfocalMm = (f * f) / (N * circleOfConfusionMm) + f;
    const hyperfocalM = hyperfocalMm / 1000;

    // 6. Near & Far Focus Limits (Depth of Field)
    // D_near = (s * (H - f)) / (H + s - 2f)
    // D_far = (s * (H - f)) / (H - s)
    const dNearMm = (s * (hyperfocalMm - f)) / (hyperfocalMm + s - 2 * f);
    let dFarMm = Infinity;
    if (hyperfocalMm > s) {
      dFarMm = (s * (hyperfocalMm - f)) / (hyperfocalMm - s);
    }
    const depthOfFieldMm = dFarMm === Infinity ? Infinity : Math.max(0, dFarMm - dNearMm);

    // 7. Cutoff Spatial Frequency (diffraction MTF cutoff in line pairs / mm)
    // f_cutoff = 1 / (lambda * N)
    const cutoffSpatialFreqLpMm = 1.0 / (lambdaMm * N);

    // 8. MTF50 resolution limit approximation (lp/mm where contrast = 50%)
    const mtf50LpMm = Math.min(120, cutoffSpatialFreqLpMm * 0.42);

    return {
      focalLengthMm: f,
      fStop: N,
      nominalFStop: N,
      subjectDistanceM: subjectDistM,
      subjectDistM: subjectDistM,
      entrancePupilDiameterMm: Number(entrancePupilDiameterMm.toFixed(2)),
      numericalAperture: Number(NA.toFixed(4)),
      airyDiskDiameterUm: Number(airyDiskDiameterUm.toFixed(2)),
      diffractionAiryDiskDiameter_um: Number(airyDiskDiameterUm.toFixed(2)),
      wavelengthNm: lambdaNm,
      circleOfConfusionMm: circleOfConfusionMm,
      hyperfocalDistanceM: Number(hyperfocalM.toFixed(2)),
      hyperfocalDistance_m: Number(hyperfocalM.toFixed(2)),
      nearLimitM: Number((dNearMm / 1000).toFixed(3)),
      nearFocusLimit_m: Number((dNearMm / 1000).toFixed(3)),
      farLimitM: dFarMm === Infinity ? 'Infinity' : Number((dFarMm / 1000).toFixed(3)),
      farFocusLimit_m: dFarMm === Infinity ? 'Infinity' : Number((dFarMm / 1000).toFixed(3)),
      depthOfFieldM: depthOfFieldMm === Infinity ? 'Infinity' : Number((depthOfFieldMm / 1000).toFixed(3)),
      depthOfField_m: depthOfFieldMm === Infinity ? 'Infinity' : Number((depthOfFieldMm / 1000).toFixed(3)),
      cutoffSpatialFreqLpMm: Math.round(cutoffSpatialFreqLpMm),
      mtf50ResolutionLpMm: Math.round(mtf50LpMm),
      mtf50ResolutionLimit_lp_per_mm: Math.round(mtf50LpMm),
      validationLevel: 'experimental',
      assumptions: ['MTF50 is estimated from a fixed approximation to the diffraction cutoff.']
    };
  }

  /**
   * Traces an explicit prescription through the sequential skew-ray engine.
   */
  static traceRays(prescription, options) {
    return this.traceExactSkewRays(prescription, options).tracedRays;
  }

  static traceExactSkewRays(prescription, options = {}) {
    const rx = this._requirePrescription(prescription);
    const {
      fStop,
      fieldAngleDeg,
      numRings,
      raysPerRing,
      wavelengthUm,
      sensorZMm,
      maxFrequencyLpMm
    } = options;
    if (!Number.isFinite(fStop) || fStop <= 0
      || !Number.isFinite(fieldAngleDeg)
      || !Number.isInteger(numRings) || numRings < 1
      || !Number.isInteger(raysPerRing) || raysPerRing < 1
      || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0
      || !Number.isFinite(sensorZMm)
      || !Number.isFinite(maxFrequencyLpMm) || maxFrequencyLpMm <= 0) {
      throw new TypeError('Ray tracing requires explicit aperture, field, pupil sampling, wavelength, sensor, and frequency inputs.');
    }

    const entrancePupilRadius = rx.focalLengthMm / fStop / 2;
    const surfaces = this.getOpticalSurfaces(rx);
    const pupilRays = SkewRayTracer.generatePupilRayGrid(
      entrancePupilRadius,
      numRings,
      raysPerRing,
      fieldAngleDeg,
      wavelengthUm
    );
    const tracedRays = SkewRayTracer.traceOpticalSystem(surfaces, pupilRays, sensorZMm);
    const spotDiagram = SkewRayTracer.computeSpotDiagram(tracedRays, sensorZMm);
    const mtf = SkewRayTracer.computeMTFCurve(spotDiagram.rmsSpotRadiusMm, fStop, maxFrequencyLpMm);
    return {
      fStop,
      fieldAngleDeg,
      wavelengthUm,
      entrancePupilRadiusMm: entrancePupilRadius,
      rayCount: tracedRays.length,
      spotDiagram,
      mtf,
      tracedRays,
      validationLevel: 'experimental'
    };
  }

  static computeSeidelAberrations(prescription, options = {}) {
    const rx = this._requirePrescription(prescription);
    const { entrancePupilRadiusMm, fieldAngleDeg } = options;
    const surfaces = this.getOpticalSurfaces(rx);
    return SeidelAberrations.computeSeidelCoefficients(surfaces, entrancePupilRadiusMm, fieldAngleDeg);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpticalEngine };
}
