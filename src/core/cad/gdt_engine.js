/**
 * Experimental GD&T arithmetic examples for simple position, profile, and
 * orientation inputs. These helpers do not implement a complete ASME Y14.5
 * interpretation or provide an inspection or compliance decision.
 */

'use strict';

class DatumReferenceFrame {
  /**
   * @param {Object} datums
   * @param {string} [datums.primary='A'] - Constrains 3 DOFs (e.g. plane Z=0)
   * @param {string} [datums.secondary='B'] - Constrains 2 DOFs (e.g. line/pin X=0)
   * @param {string} [datums.tertiary='C'] - Constrains 1 DOF (e.g. point Y=0)
   */
  constructor(datums = {}) {
    this.primary = datums.primary || 'A';
    this.secondary = datums.secondary || 'B';
    this.tertiary = datums.tertiary || 'C';
    this.origin = { x: 0, y: 0, z: 0 };
    this.axes = {
      x: { x: 1, y: 0, z: 0 },
      y: { x: 0, y: 1, z: 0 },
      z: { x: 0, y: 0, z: 1 }
    };
  }
}

class FeatureControlFrame {
  /**
   * @param {Object} fcfSpec
   * @param {string} fcfSpec.geometricCharacteristic - 'POSITION', 'PROFILE', 'PERPENDICULARITY', 'PARALLELISM', 'RUNOUT'
   * @param {number} fcfSpec.specifiedTolerance - Tolerance zone diameter or width (mm)
   * @param {string} [fcfSpec.materialCondition='RFS'] - 'RFS' (Regardless of Feature Size), 'MMC', 'LMC'
   * @param {string[]} [fcfSpec.datumPrecedence=['A', 'B', 'C']]
   */
  constructor(fcfSpec = {}) {
    this.characteristic = fcfSpec.geometricCharacteristic || 'POSITION';
    this.tolerance = fcfSpec.specifiedTolerance || 0.10;
    this.materialCondition = fcfSpec.materialCondition || 'RFS';
    this.datumPrecedence = fcfSpec.datumPrecedence || ['A', 'B', 'C'];
  }
}

class GDTEngine {
  /**
   * Computes a simple position-deviation and supplied-tolerance comparison.
   * This does not interpret a complete ASME Y14.5 callout.
   * @param {Object} holeSpec
   * @param {number} holeSpec.nominalX - Basic dimension X (mm)
   * @param {number} holeSpec.nominalY - Basic dimension Y (mm)
   * @param {number} holeSpec.measuredX - Actual manufactured coordinate X (mm)
   * @param {number} holeSpec.measuredY - Actual manufactured coordinate Y (mm)
   * @param {number} holeSpec.nominalDiameter - Nominal hole diameter (mm)
   * @param {number} holeSpec.measuredDiameter - Actual measured hole diameter (mm)
   * @param {number} holeSpec.lowerTolerance - Lower size tolerance (e.g. -0.05)
   * @param {number} holeSpec.upperTolerance - Upper size tolerance (e.g. +0.10)
   * @param {FeatureControlFrame} fcf - Position Feature Control Frame
   * @returns {Object} Experimental arithmetic result for the supplied values
   */
  static evaluateTruePosition(holeSpec, fcf) {
    const dx = holeSpec.measuredX - holeSpec.nominalX;
    const dy = holeSpec.measuredY - holeSpec.nominalY;
    // True Position deviation diameter = 2 * sqrt(dx^2 + dy^2)
    const deviationDiameter = 2.0 * Math.hypot(dx, dy);

    // Calculate Bonus Tolerance from Maximum Material Condition (MMC)
    let bonusTolerance = 0.0;
    const mmcSize = holeSpec.nominalDiameter + holeSpec.lowerTolerance; // For a hole, MMC is smallest hole size
    const lmcSize = holeSpec.nominalDiameter + holeSpec.upperTolerance; // Largest hole size

    if (fcf.materialCondition === 'MMC') {
      // Bonus = measured size - MMC size (for an internal hole)
      bonusTolerance = Math.max(0.0, holeSpec.measuredDiameter - mmcSize);
    } else if (fcf.materialCondition === 'LMC') {
      bonusTolerance = Math.max(0.0, lmcSize - holeSpec.measuredDiameter);
    }

    const totalAllowedTolerance = fcf.tolerance + bonusTolerance;
    const passed = deviationDiameter <= totalAllowedTolerance;

    return {
      characteristic: 'TRUE_POSITION',
      nominalPosition: { x: holeSpec.nominalX, y: holeSpec.nominalY },
      measuredPosition: { x: holeSpec.measuredX, y: holeSpec.measuredY },
      radialOffset: Math.hypot(dx, dy),
      deviationDiameter: Number(deviationDiameter.toFixed(4)),
      specifiedTolerance: fcf.tolerance,
      bonusTolerance: Number(bonusTolerance.toFixed(4)),
      totalAllowedTolerance: Number(totalAllowedTolerance.toFixed(4)),
      materialCondition: fcf.materialCondition,
      passed,
      marginRemainingMm: Number((totalAllowedTolerance - deviationDiameter).toFixed(4))
    };
  }

  /**
   * Evaluates Profile of a Surface across measured surface points against nominal CAD geometry
   * @param {Array<Object>} measuredPoints Array of { x, y, z, nominalDist }
   * @param {number} profileTolerance Bilateral tolerance zone width (mm)
   * @returns {Object}
   */
  static evaluateProfileOfSurface(measuredPoints = [], profileTolerance = 0.20) {
    let maxPlusDeviation = 0.0;
    let maxMinusDeviation = 0.0;

    for (const pt of measuredPoints) {
      const dev = pt.nominalDist !== undefined ? pt.nominalDist : 0.0;
      if (dev > maxPlusDeviation) maxPlusDeviation = dev;
      if (dev < maxMinusDeviation) maxMinusDeviation = dev;
    }

    // Profile error is peak-to-valley spread centered on nominal
    const actualProfileZone = 2.0 * Math.max(Math.abs(maxPlusDeviation), Math.abs(maxMinusDeviation));
    const passed = actualProfileZone <= profileTolerance;

    return {
      characteristic: 'PROFILE_OF_SURFACE',
      pointsInspected: measuredPoints.length,
      maxPlusDeviation: Number(maxPlusDeviation.toFixed(4)),
      maxMinusDeviation: Number(maxMinusDeviation.toFixed(4)),
      actualProfileZone: Number(actualProfileZone.toFixed(4)),
      specifiedTolerance: profileTolerance,
      passed
    };
  }

  /**
   * Evaluates Perpendicularity of a planar or cylindrical face to a datum plane
   * @param {Object} measuredNormal { x, y, z }
   * @param {Object} datumNormal { x, y, z }
   * @param {number} faceLengthMm Length of feature being inspected
   * @param {number} specifiedTolerance Maximum allowable angular projection deviation (mm)
   * @returns {Object}
   */
  static evaluatePerpendicularity(measuredNormal, datumNormal, faceLengthMm = 100.0, specifiedTolerance = 0.05) {
    // For perpendicular faces, dot product normal_face . normal_datum = 0
    const dot = measuredNormal.x * datumNormal.x + measuredNormal.y * datumNormal.y + measuredNormal.z * datumNormal.z;
    const angleRad = Math.acos(Math.max(-1.0, Math.min(1.0, Math.abs(dot))));
    const angularDeviationRad = Math.abs(angleRad - Math.PI / 2.0);

    // Linear projected deviation over face length
    const projectedDeviation = faceLengthMm * Math.tan(angularDeviationRad);
    const passed = projectedDeviation <= specifiedTolerance;

    return {
      characteristic: 'PERPENDICULARITY',
      angularDeviationDeg: Number(((angularDeviationRad * 180.0) / Math.PI).toFixed(4)),
      projectedDeviationMm: Number(projectedDeviation.toFixed(4)),
      specifiedToleranceMm: specifiedTolerance,
      passed
    };
  }
}

module.exports = {
  DatumReferenceFrame,
  FeatureControlFrame,
  GDTEngine
};
