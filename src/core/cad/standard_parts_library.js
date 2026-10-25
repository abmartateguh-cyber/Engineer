/**
 * Caller-dimensioned, experimental part geometry helpers.
 *
 * Catalog lookups remain unavailable until source, revision, applicability, and
 * redistribution rights have been reviewed. The geometry helpers below do not
 * assert compliance with ISO, DIN, ASME, or a vendor specification.
 */

'use strict';

const CATALOG_UNAVAILABLE_MESSAGE =
  'Standard-part records are unavailable pending source, revision, applicability, and redistribution review.';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite value in millimeters.`);
  }
}

function hexVertices(acrossFlatsMm) {
  const circumradiusMm = acrossFlatsMm / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, index) => {
    const angleRad = Math.PI / 6 + (index * Math.PI) / 3;
    return {
      xMm: circumradiusMm * Math.cos(angleRad),
      yMm: circumradiusMm * Math.sin(angleRad)
    };
  });
}

function boundsForHex(vertices, minZMm, maxZMm) {
  const xValues = vertices.map((point) => point.xMm);
  const yValues = vertices.map((point) => point.yMm);
  return [Math.min(...xValues), Math.min(...yValues), minZMm, Math.max(...xValues), Math.max(...yValues), maxZMm];
}

class StandardPartsLibrary {
  static getAvailability() {
    return {
      success: false,
      status: 'UNAVAILABLE',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: CATALOG_UNAVAILABLE_MESSAGE
      }
    };
  }

  static _unavailableGeometry(message) {
    return {
      success: false,
      status: 'UNAVAILABLE',
      validationLevel: 'experimental',
      error: { code: 'UNSUPPORTED', message }
    };
  }

  /**
   * Describes a generic hex-head bolt envelope from caller-supplied dimensions.
   *
   * Object form: { shankDiameterMm, shankLengthMm, headAcrossFlatsMm,
   * headHeightMm }. A legacy positional call may pass the first two dimensions;
   * head dimensions must still be supplied in the fourth argument.
   */
  static generateHexBolt(input, shankLengthMm, _legacyPropertyClass, explicitHeadDimensions) {
    const dimensions = isRecord(input)
      ? input
      : {
          ...(isRecord(explicitHeadDimensions) ? explicitHeadDimensions : {}),
          shankDiameterMm: input,
          shankLengthMm
        };
    const { shankDiameterMm, headAcrossFlatsMm, headHeightMm } = dimensions;
    const bodyLengthMm = dimensions.shankLengthMm ?? dimensions.lengthMm;

    if (shankDiameterMm === undefined || bodyLengthMm === undefined) {
      return this._unavailableGeometry('Explicit shank diameter and under-head length in millimeters are required.');
    }
    if (headAcrossFlatsMm === undefined || headHeightMm === undefined) {
      return this._unavailableGeometry(
        'Explicit head across-flats width and head height are required; no standard dimensions are inferred.'
      );
    }

    requirePositiveFinite(shankDiameterMm, 'shankDiameterMm');
    requirePositiveFinite(bodyLengthMm, 'shankLengthMm');
    requirePositiveFinite(headAcrossFlatsMm, 'headAcrossFlatsMm');
    requirePositiveFinite(headHeightMm, 'headHeightMm');
    if (headAcrossFlatsMm <= shankDiameterMm) {
      throw new RangeError('headAcrossFlatsMm must exceed shankDiameterMm.');
    }

    const headVerticesMm = hexVertices(headAcrossFlatsMm);
    const boundsMm = boundsForHex(headVerticesMm, -headHeightMm, bodyLengthMm);
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataProvenance: 'caller-supplied dimensions; no standard or vendor record used',
      units: 'mm',
      geometryType: 'generic-hex-head-bolt-envelope',
      shankDiameterMm,
      nominalDiameterMm: shankDiameterMm,
      shankLengthMm: bodyLengthMm,
      lengthMm: bodyLengthMm,
      headAcrossFlatsMm,
      headWidthAcrossFlatsMm: headAcrossFlatsMm,
      headHeightMm,
      headVerticesMm,
      threadGeometry: 'not generated',
      boundingBoxMm: boundsMm,
      boundingBox: boundsMm
    };
  }

  /**
   * Describes a generic hexagonal nut envelope. No pitch, thread class, strength,
   * or standards compliance is inferred.
   */
  static generateHexNut(input, _legacyPropertyClass, explicitDimensions) {
    const dimensions = isRecord(input)
      ? input
      : {
          ...(isRecord(explicitDimensions) ? explicitDimensions : {}),
          nominalDiameterMm: input
        };
    const { outerAcrossFlatsMm, thicknessMm, boreDiameterMm } = dimensions;

    if (outerAcrossFlatsMm === undefined || thicknessMm === undefined || boreDiameterMm === undefined) {
      return this._unavailableGeometry(
        'Explicit outer width, thickness, and bore diameter in millimeters are required.'
      );
    }

    requirePositiveFinite(outerAcrossFlatsMm, 'outerAcrossFlatsMm');
    requirePositiveFinite(thicknessMm, 'thicknessMm');
    requirePositiveFinite(boreDiameterMm, 'boreDiameterMm');
    if (boreDiameterMm >= outerAcrossFlatsMm) {
      throw new RangeError('boreDiameterMm must be smaller than outerAcrossFlatsMm.');
    }

    const verticesMm = hexVertices(outerAcrossFlatsMm);
    const boundsMm = boundsForHex(verticesMm, 0, thicknessMm);
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataProvenance: 'caller-supplied dimensions; no standard or vendor record used',
      units: 'mm',
      geometryType: 'generic-hex-nut-envelope',
      nominalDiameterMm: dimensions.nominalDiameterMm ?? null,
      outerAcrossFlatsMm,
      thicknessMm,
      boreDiameterMm,
      outerVerticesMm: verticesMm,
      threadGeometry: 'not generated',
      boundingBoxMm: boundsMm,
      boundingBox: boundsMm
    };
  }

  /**
   * Describes a caller-dimensioned bearing envelope and rolling-element layout.
   * Raceway profiles, load ratings, speed ratings, and manufacturer data are not
   * calculated.
   */
  static generateBallBearing(dimensions) {
    if (!isRecord(dimensions)) {
      return this._unavailableGeometry(
        'An explicit bearing dimension object is required; designation lookup is unavailable.'
      );
    }

    const { boreDiameterMm, outerDiameterMm, widthMm, rollingElementDiameterMm, pitchDiameterMm } = dimensions;
    const rollingElementCount = dimensions.rollingElementCount;
    for (const [name, value] of Object.entries({
      boreDiameterMm,
      outerDiameterMm,
      widthMm,
      rollingElementDiameterMm,
      pitchDiameterMm
    })) {
      requirePositiveFinite(value, name);
    }
    if (!Number.isSafeInteger(rollingElementCount) || rollingElementCount < 3 || rollingElementCount > 256) {
      throw new RangeError('rollingElementCount must be an integer from 3 through 256.');
    }
    if (boreDiameterMm >= outerDiameterMm) {
      throw new RangeError('boreDiameterMm must be smaller than outerDiameterMm.');
    }
    if (
      pitchDiameterMm - rollingElementDiameterMm <= boreDiameterMm ||
      pitchDiameterMm + rollingElementDiameterMm >= outerDiameterMm
    ) {
      throw new RangeError('Rolling elements do not fit between the supplied bore and outer diameters.');
    }

    const rollingElementCentersMm = Array.from({ length: rollingElementCount }, (_, index) => {
      const angleRad = (2 * Math.PI * index) / rollingElementCount;
      return {
        xMm: (pitchDiameterMm / 2) * Math.cos(angleRad),
        yMm: (pitchDiameterMm / 2) * Math.sin(angleRad),
        zMm: 0
      };
    });
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataProvenance: 'caller-supplied dimensions; no standard or vendor record used',
      units: 'mm',
      geometryType: 'generic-bearing-envelope-and-rolling-element-layout',
      boreDiameterMm,
      outerDiameterMm,
      widthMm,
      rollingElementCount,
      rollingElementDiameterMm,
      pitchDiameterMm,
      rollingElementCentersMm,
      racewayGeometry: 'not generated',
      loadRatings: 'not calculated',
      speedRatings: 'not calculated',
      boundingBoxMm: [
        -outerDiameterMm / 2,
        -outerDiameterMm / 2,
        -widthMm / 2,
        outerDiameterMm / 2,
        outerDiameterMm / 2,
        widthMm / 2
      ],
      boundingBox: [
        -outerDiameterMm / 2,
        -outerDiameterMm / 2,
        -widthMm / 2,
        outerDiameterMm / 2,
        outerDiameterMm / 2,
        widthMm / 2
      ]
    };
  }

  /**
   * Formats a descriptive threaded-hole note from caller-supplied dimensions.
   * It does not assign a tolerance class or claim conformance to a drafting
   * standard.
   */
  static generateHoleCallout(input, tapDepthMm, isCounterbore, explicitDimensions) {
    const dimensions = isRecord(input)
      ? input
      : {
          ...(isRecord(explicitDimensions) ? explicitDimensions : {}),
          nominalDiameterMm: input,
          tapDepthMm,
          isCounterbore
        };
    const { nominalDiameterMm, pitchMm, tapDrillDiameterMm } = dimensions;
    const depthMm = dimensions.tapDepthMm;
    const counterboreDiameterMm = dimensions.counterboreDiameterMm;
    const counterboreDepthMm = dimensions.counterboreDepthMm;

    if (
      nominalDiameterMm === undefined ||
      pitchMm === undefined ||
      tapDrillDiameterMm === undefined ||
      depthMm === undefined
    ) {
      return this._unavailableGeometry(
        'Explicit nominal diameter, pitch, tap-drill diameter, and tap depth in millimeters are required.'
      );
    }
    for (const [name, value] of Object.entries({
      nominalDiameterMm,
      pitchMm,
      tapDrillDiameterMm,
      tapDepthMm: depthMm
    })) {
      requirePositiveFinite(value, name);
    }
    if (tapDrillDiameterMm >= nominalDiameterMm) {
      throw new RangeError('tapDrillDiameterMm must be smaller than nominalDiameterMm.');
    }
    if ((counterboreDiameterMm === undefined) !== (counterboreDepthMm === undefined)) {
      throw new TypeError('Counterbore diameter and depth must be supplied together.');
    }
    if (counterboreDiameterMm !== undefined) {
      requirePositiveFinite(counterboreDiameterMm, 'counterboreDiameterMm');
      requirePositiveFinite(counterboreDepthMm, 'counterboreDepthMm');
      if (counterboreDiameterMm <= nominalDiameterMm) {
        throw new RangeError('counterboreDiameterMm must exceed nominalDiameterMm.');
      }
    }

    const callout = [
      `Threaded hole: nominal diameter ${nominalDiameterMm} mm`,
      `pitch ${pitchMm} mm`,
      `tap-drill diameter ${tapDrillDiameterMm} mm`,
      `tap depth ${depthMm} mm`
    ];
    if (counterboreDiameterMm !== undefined) {
      callout.push(`counterbore diameter ${counterboreDiameterMm} mm`, `counterbore depth ${counterboreDepthMm} mm`);
    }

    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataProvenance: 'caller-supplied dimensions; no standard or vendor record used',
      units: 'mm',
      callout: callout.join('; '),
      nominalDiameterMm,
      pitchMm,
      tapDrillDiameterMm,
      tapDepthMm: depthMm,
      counterboreDiameterMm: counterboreDiameterMm ?? null,
      counterboreDepthMm: counterboreDepthMm ?? null
    };
  }
}

module.exports = { StandardPartsLibrary };
