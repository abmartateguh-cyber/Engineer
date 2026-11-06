/**
 * src/core/plant/equipment_nozzle_manager.js
 * 3D equipment nozzle orientation / flange-rating alignment checker.
 *
 * Verifies that a connected piping run mates correctly with an equipment
 * nozzle: elevation alignment, horizontal plan position, approach azimuth,
 * flange class equality, nominal size equality, and flange pressure rating
 * versus line design conditions.
 *
 * Units:
 *  - Coordinates and elevations: mm.
 *  - Azimuths: degrees from north (0 = +y/north, 90 = +x/east, clockwise
 *    when viewed from above).
 *  - Pressures: psig (gauge). The embedded rating table is the ASME B16.5
 *    carbon steel Group 1.1 rating in psig.
 *  - Temperatures: °F (matches the embedded rating-table temperatures).
 *
 * Flange rating table (ASME B16.5, carbon steel Group 1.1, psig):
 *    class  100°F  300°F  500°F  750°F
 *    150      285    260    230    170
 *    300      740    675    620    435
 *    600     1480   1350   1240    870
 *    900     2220   2025   1860   1305
 *    1500    3705   3375   3100   2175
 *    2500    6170   5625   5170   3625
 *
 * Fail-closed: malformed equipment or connected-piping records raise
 * descriptive errors; a connection is never reported as passing when its
 * inputs are invalid.
 */

'use strict';

const FLANGE_CLASSES = Object.freeze([150, 300, 600, 900, 1500, 2500]);
const RATING_TEMPERATURES_F = Object.freeze([100, 300, 500, 750]);

const FLANGE_RATING_PSIG = Object.freeze({
  150: Object.freeze([285, 260, 230, 170]),
  300: Object.freeze([740, 675, 620, 435]),
  600: Object.freeze([1480, 1350, 1240, 870]),
  900: Object.freeze([2220, 2025, 1860, 1305]),
  1500: Object.freeze([3705, 3375, 3100, 2175]),
  2500: Object.freeze([6170, 5625, 5170, 3625])
});

const DEFAULT_TOLERANCES = Object.freeze({
  elevationMm: 25,
  horizontalMm: 50,
  azimuthDeg: 10
});

const NOZZLE_ORIENTATIONS = Object.freeze(['vertical', 'horizontal']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

class EquipmentNozzleManager {
  static flangeClasses() {
    return FLANGE_CLASSES;
  }

  static ratingTemperaturesF() {
    return RATING_TEMPERATURES_F;
  }

  static flangeRatingTable() {
    return FLANGE_RATING_PSIG;
  }

  static defaultTolerances() {
    return DEFAULT_TOLERANCES;
  }

  static assertValidFlangeClass(flangeClass, context) {
    if (!FLANGE_CLASSES.includes(flangeClass)) {
      throw new Error(`${context}: flangeClass must be one of ${FLANGE_CLASSES.join('/')}; got ${flangeClass}`);
    }
  }

  /**
   * Validates an equipment record. Throws on malformed records (fail-closed).
   * @param {Object} equipment { tag, nozzles: [{ tag, x, y, z, azimuth,
   *   flangeClass, flangeType, sizeNPS, orientation, connectedLine }] }
   * @returns {Object} The verified equipment record.
   */
  static validateEquipment(equipment) {
    if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) {
      throw new Error('EquipmentNozzleManager: equipment record must be an object');
    }
    if (typeof equipment.tag !== 'string' || equipment.tag.length === 0) {
      throw new Error('EquipmentNozzleManager: equipment record requires a non-empty tag');
    }
    if (!Array.isArray(equipment.nozzles) || equipment.nozzles.length === 0) {
      throw new Error(`EquipmentNozzleManager: equipment '${equipment.tag}' requires at least one nozzle`);
    }
    for (const [index, nozzle] of equipment.nozzles.entries()) {
      EquipmentNozzleManager.validateNozzle(nozzle, `${equipment.tag}.nozzles[${index}]`);
    }
    return equipment;
  }

  static validateNozzle(nozzle, context) {
    if (!nozzle || typeof nozzle !== 'object' || Array.isArray(nozzle)) {
      throw new Error(`EquipmentNozzleManager: ${context} must be an object`);
    }
    const finiteNumbers = {
      x: nozzle.x,
      y: nozzle.y,
      z: nozzle.z,
      azimuth: nozzle.azimuth,
      sizeNPS: nozzle.sizeNPS
    };
    for (const [field, value] of Object.entries(finiteNumbers)) {
      if (!isFiniteNumber(value)) {
        throw new Error(`EquipmentNozzleManager: ${context}.${field} must be a finite number; got ${value}`);
      }
    }
    if (nozzle.sizeNPS <= 0) {
      throw new Error(`EquipmentNozzleManager: ${context}.sizeNPS must be positive; got ${nozzle.sizeNPS}`);
    }
    if (typeof nozzle.tag !== 'string' || nozzle.tag.length === 0) {
      throw new Error(`EquipmentNozzleManager: ${context}.tag must be a non-empty string`);
    }
    if (typeof nozzle.flangeType !== 'string' || nozzle.flangeType.length === 0) {
      throw new Error(`EquipmentNozzleManager: ${context}.flangeType must be a non-empty string`);
    }
    if (typeof nozzle.connectedLine !== 'string' || nozzle.connectedLine.length === 0) {
      throw new Error(`EquipmentNozzleManager: ${context}.connectedLine must be a non-empty string`);
    }
    if (!NOZZLE_ORIENTATIONS.includes(nozzle.orientation)) {
      throw new Error(
        `EquipmentNozzleManager: ${context}.orientation must be 'vertical' or 'horizontal'; got ${nozzle.orientation}`
      );
    }
    EquipmentNozzleManager.assertValidFlangeClass(nozzle.flangeClass, `EquipmentNozzleManager: ${context}`);
    return nozzle;
  }

  /**
   * Validates a connected-piping record. Throws on malformed records.
   * @param {Object} line { lineTag, startX, startY, startZ, endX, endY,
   *   endZ, flangeClass, sizeNPS, designPressure (psig),
   *   designTemperature (°F), [connectEnd ('start'|'end')],
   *   [connectedNozzleTag] }
   * @returns {Object} The verified line record.
   */
  static validateConnectedPiping(line) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new Error('EquipmentNozzleManager: connected-piping record must be an object');
    }
    if (typeof line.lineTag !== 'string' || line.lineTag.length === 0) {
      throw new Error('EquipmentNozzleManager: connected-piping record requires a non-empty lineTag');
    }
    const finiteNumbers = {
      startX: line.startX,
      startY: line.startY,
      startZ: line.startZ,
      endX: line.endX,
      endY: line.endY,
      endZ: line.endZ,
      designPressure: line.designPressure,
      designTemperature: line.designTemperature
    };
    for (const [field, value] of Object.entries(finiteNumbers)) {
      if (!isFiniteNumber(value)) {
        throw new Error(
          `EquipmentNozzleManager: line '${line.lineTag}'.${field} must be a finite number; got ${value}`
        );
      }
    }
    if (line.designPressure < 0) {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}'.designPressure must be >= 0; got ${line.designPressure}`
      );
    }
    if (line.designTemperature < 0) {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}'.designTemperature must be >= 0; got ${line.designTemperature}`
      );
    }
    if (!isFiniteNumber(line.sizeNPS) || line.sizeNPS <= 0) {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}'.sizeNPS must be a positive finite number; got ${line.sizeNPS}`
      );
    }
    EquipmentNozzleManager.assertValidFlangeClass(line.flangeClass, `EquipmentNozzleManager: line '${line.lineTag}'`);
    if (line.connectEnd !== undefined && line.connectEnd !== 'start' && line.connectEnd !== 'end') {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}'.connectEnd must be 'start' or 'end'; got ${line.connectEnd}`
      );
    }
    if (
      line.connectedNozzleTag !== undefined &&
      (typeof line.connectedNozzleTag !== 'string' || line.connectedNozzleTag.length === 0)
    ) {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}'.connectedNozzleTag must be a non-empty string when provided`
      );
    }
    return line;
  }

  /**
   * Returns the flange pressure rating (psig) for a flange class at a given
   * temperature (°F). Ratings are linearly interpolated between the tabulated
   * temperatures; temperatures below 100°F use the 100°F rating and
   * temperatures above 750°F use the 750°F rating (conservative bound).
   */
  static flangeRatingPsi(flangeClass, temperatureF) {
    EquipmentNozzleManager.assertValidFlangeClass(flangeClass, 'EquipmentNozzleManager: flangeRatingPsi');
    if (!isFiniteNumber(temperatureF) || temperatureF < 0) {
      throw new Error(
        `EquipmentNozzleManager: flangeRatingPsi temperature must be a finite non-negative number; got ${temperatureF}`
      );
    }
    const ratings = FLANGE_RATING_PSIG[flangeClass];
    const temps = RATING_TEMPERATURES_F;
    if (temperatureF <= temps[0]) {
      return ratings[0];
    }
    if (temperatureF >= temps[temps.length - 1]) {
      return ratings[ratings.length - 1];
    }
    for (let i = 0; i < temps.length - 1; i += 1) {
      if (temperatureF >= temps[i] && temperatureF < temps[i + 1]) {
        const fraction = (temperatureF - temps[i]) / (temps[i + 1] - temps[i]);
        return ratings[i] + fraction * (ratings[i + 1] - ratings[i]);
      }
    }
    return ratings[ratings.length - 1];
  }

  static normalizeAzimuth(degrees) {
    if (!isFiniteNumber(degrees)) {
      throw new Error(`EquipmentNozzleManager: azimuth must be a finite number; got ${degrees}`);
    }
    return ((degrees % 360) + 360) % 360;
  }

  static azimuthDeltaDeg(a, b) {
    const delta =
      Math.abs(EquipmentNozzleManager.normalizeAzimuth(a) - EquipmentNozzleManager.normalizeAzimuth(b)) % 360;
    return Math.min(delta, 360 - delta);
  }

  static resolveConnectionEndpoint(nozzle, line) {
    if (line.connectEnd === 'start') {
      return { x: line.startX, y: line.startY, z: line.startZ, end: 'start' };
    }
    if (line.connectEnd === 'end') {
      return { x: line.endX, y: line.endY, z: line.endZ, end: 'end' };
    }
    const distStart = Math.hypot(nozzle.x - line.startX, nozzle.y - line.startY, nozzle.z - line.startZ);
    const distEnd = Math.hypot(nozzle.x - line.endX, nozzle.y - line.endY, nozzle.z - line.endZ);
    return distStart <= distEnd
      ? { x: line.startX, y: line.startY, z: line.startZ, end: 'start' }
      : { x: line.endX, y: line.endY, z: line.endZ, end: 'end' };
  }

  /**
   * Computes the plan-view azimuth at which a line approaches its connection
   * endpoint: the bearing from the opposite endpoint toward the connection
   * endpoint. Falls back to the bearing from the nozzle to the connection
   * endpoint when the two line endpoints coincide in plan.
   * @returns {number|null} Degrees from north in [0, 360), or null when the
   *   line has no horizontal extent at the nozzle (azimuth undefined).
   */
  static computeApproachAzimuthDeg(nozzle, line, endpoint) {
    const planDx = endpoint.x - (endpoint.end === 'start' ? line.endX : line.startX);
    const planDy = endpoint.y - (endpoint.end === 'start' ? line.endY : line.startY);
    if (Math.hypot(planDx, planDy) > 1e-9) {
      return EquipmentNozzleManager.normalizeAzimuth((Math.atan2(planDx, planDy) * 180) / Math.PI);
    }
    const nozzleDx = endpoint.x - nozzle.x;
    const nozzleDy = endpoint.y - nozzle.y;
    if (Math.hypot(nozzleDx, nozzleDy) > 1e-9) {
      return EquipmentNozzleManager.normalizeAzimuth((Math.atan2(nozzleDx, nozzleDy) * 180) / Math.PI);
    }
    return null;
  }

  /**
   * Evaluates a nozzle-to-line connection against all alignment checks.
   * @param {Object} input
   * @param {Object} input.equipment Equipment record (see validateEquipment)
   * @param {string} input.nozzleTag Tag of the nozzle on the equipment
   * @param {Object} input.line Connected-piping record (see validateConnectedPiping)
   * @param {Object} [input.tolerances] Overrides for { elevationMm, horizontalMm, azimuthDeg }
   * @returns {Object} { pass, flags, checks, nozzle, line, equipmentTag,
   *   nozzleTag, lineTag, tolerances }
   */
  static evaluateConnection({ equipment, nozzleTag, line, tolerances }) {
    EquipmentNozzleManager.validateEquipment(equipment);
    EquipmentNozzleManager.validateConnectedPiping(line);
    if (typeof nozzleTag !== 'string' || nozzleTag.length === 0) {
      throw new Error('EquipmentNozzleManager: evaluateConnection requires a non-empty nozzleTag');
    }

    const nozzle = equipment.nozzles.find((n) => n.tag === nozzleTag);
    if (!nozzle) {
      throw new Error(`EquipmentNozzleManager: equipment '${equipment.tag}' has no nozzle '${nozzleTag}'`);
    }
    if (line.connectedNozzleTag !== undefined && line.connectedNozzleTag !== nozzleTag) {
      throw new Error(
        `EquipmentNozzleManager: line '${line.lineTag}' declares connectedNozzleTag '${line.connectedNozzleTag}', expected '${nozzleTag}'`
      );
    }
    if (nozzle.connectedLine !== line.lineTag) {
      throw new Error(
        `EquipmentNozzleManager: nozzle '${nozzleTag}' declares connectedLine '${nozzle.connectedLine}', expected '${line.lineTag}'`
      );
    }

    const tol = Object.assign({}, DEFAULT_TOLERANCES, tolerances || {});
    const endpoint = EquipmentNozzleManager.resolveConnectionEndpoint(nozzle, line);

    const checks = {};
    const flags = [];

    const deltaElevationMm = nozzle.z - endpoint.z;
    checks.elevation = {
      pass: Math.abs(deltaElevationMm) <= tol.elevationMm,
      nozzleElevationMm: nozzle.z,
      lineElevationMm: endpoint.z,
      deltaMm: deltaElevationMm,
      toleranceMm: tol.elevationMm
    };
    if (!checks.elevation.pass) {
      flags.push(
        `elevation mismatch: nozzle elevation ${nozzle.z} mm vs line connection elevation ${endpoint.z} mm (Δ ${deltaElevationMm} mm > tolerance ${tol.elevationMm} mm)`
      );
    }

    const dx = endpoint.x - nozzle.x;
    const dy = endpoint.y - nozzle.y;
    const horizontalDistanceMm = Math.hypot(dx, dy);
    checks.coordinate = {
      pass: horizontalDistanceMm <= tol.horizontalMm,
      nozzleX: nozzle.x,
      nozzleY: nozzle.y,
      lineX: endpoint.x,
      lineY: endpoint.y,
      distanceMm: horizontalDistanceMm,
      toleranceMm: tol.horizontalMm
    };
    if (!checks.coordinate.pass) {
      flags.push(
        `coordinate mismatch: line endpoint (${endpoint.x}, ${endpoint.y}) is ${horizontalDistanceMm} mm from nozzle (${nozzle.x}, ${nozzle.y}) in plan; tolerance ${tol.horizontalMm} mm`
      );
    }

    const approachAzimuthDeg = EquipmentNozzleManager.computeApproachAzimuthDeg(nozzle, line, endpoint);
    const nozzleAzimuthDeg = EquipmentNozzleManager.normalizeAzimuth(nozzle.azimuth);
    const expectedAzimuthDeg = nozzle.orientation === 'vertical' ? (nozzleAzimuthDeg + 180) % 360 : nozzleAzimuthDeg;
    checks.azimuth = {
      nozzleOrientation: nozzle.orientation,
      nozzleAzimuthDeg,
      expectedApproachAzimuthDeg: expectedAzimuthDeg,
      toleranceDeg: tol.azimuthDeg
    };
    if (approachAzimuthDeg === null) {
      checks.azimuth.pass = false;
      checks.azimuth.actualApproachAzimuthDeg = null;
      checks.azimuth.deltaDeg = null;
      checks.azimuth.reason = 'undefined approach azimuth: line has no horizontal extent at the nozzle';
      flags.push(checks.azimuth.reason);
    } else {
      checks.azimuth.actualApproachAzimuthDeg = approachAzimuthDeg;
      const azimuthDeltaDeg = EquipmentNozzleManager.azimuthDeltaDeg(approachAzimuthDeg, expectedAzimuthDeg);
      checks.azimuth.deltaDeg = azimuthDeltaDeg;
      checks.azimuth.pass = azimuthDeltaDeg <= tol.azimuthDeg;
      if (!checks.azimuth.pass) {
        flags.push(
          `azimuth deviation: line approaches at ${approachAzimuthDeg}°, expected ${expectedAzimuthDeg}° for ${nozzle.orientation} nozzle (Δ ${azimuthDeltaDeg}° > tolerance ${tol.azimuthDeg}°)`
        );
      }
    }

    checks.flangeRating = {
      pass: line.flangeClass === nozzle.flangeClass,
      lineClass: line.flangeClass,
      nozzleClass: nozzle.flangeClass
    };
    if (!checks.flangeRating.pass) {
      flags.push(`flange rating mismatch: line Class ${line.flangeClass} vs nozzle Class ${nozzle.flangeClass}`);
    }

    checks.size = {
      pass: line.sizeNPS === nozzle.sizeNPS,
      lineNPS: line.sizeNPS,
      nozzleNPS: nozzle.sizeNPS
    };
    if (!checks.size.pass) {
      flags.push(`size mismatch: line NPS ${line.sizeNPS} vs nozzle NPS ${nozzle.sizeNPS}`);
    }

    const ratingPsig = EquipmentNozzleManager.flangeRatingPsi(nozzle.flangeClass, line.designTemperature);
    checks.designPressure = {
      pass: line.designPressure <= ratingPsig,
      designPressurePsig: line.designPressure,
      ratingPsig,
      designTemperatureF: line.designTemperature,
      flangeClass: nozzle.flangeClass
    };
    if (!checks.designPressure.pass) {
      flags.push(
        `design pressure ${line.designPressure} psig exceeds Class ${nozzle.flangeClass} rating ${ratingPsig} psig at ${line.designTemperature}°F`
      );
    }

    return {
      pass: flags.length === 0,
      flags,
      checks,
      equipmentTag: equipment.tag,
      nozzleTag,
      lineTag: line.lineTag,
      nozzle,
      line,
      tolerances: tol,
      connectionEnd: endpoint.end
    };
  }
}

module.exports = {
  EquipmentNozzleManager,
  FLANGE_CLASSES,
  RATING_TEMPERATURES_F,
  FLANGE_RATING_PSIG,
  DEFAULT_TOLERANCES
};
