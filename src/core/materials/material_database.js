/**
 * Material property database facade.
 *
 * Loads the reference catalog of documented-typical values with explicit
 * provenance and exposes the historical API shape:
 *   { MATERIAL_DATABASE, MaterialManager }
 * The catalog lives in ./material_database_certified.js — see that module for
 * sourcing and validation-status caveats (values are documented-typical and
 * are not design allowables).
 */

'use strict';

const { MATERIAL_DATABASE, REFERENCE_TEMPERATURE_K, interpolateProperty } = require('./material_database_certified');

class MaterialManager {
  static getMaterial(key) {
    if (typeof key !== 'string') return null;
    return Object.hasOwn(MATERIAL_DATABASE, key) ? MATERIAL_DATABASE[key] : null;
  }

  static listAllMaterials() {
    return Object.keys(MATERIAL_DATABASE);
  }

  /**
   * Compute mass and centroidal inertia from a reviewed material record and
   * explicit positive dimensions.
   */
  static computeInertiaCuboid(matKey, widthM, heightM, depthM) {
    const mat = this.getMaterial(matKey);
    if (!mat) {
      throw new Error('Material property data is unavailable; no reviewed record matches the requested key.');
    }
    if (![widthM, heightM, depthM].every((value) => Number.isFinite(value) && value > 0)) {
      throw new TypeError('Cuboid dimensions must be explicit finite positive values in meters.');
    }

    const volumeM3 = widthM * heightM * depthM;
    const massKg = volumeM3 * mat.densityKgM3;

    return {
      materialName: mat.name,
      massKg: Number(massKg.toFixed(4)),
      volumeCm3: Number((volumeM3 * 1e6).toFixed(2)),
      densityKgM3: mat.densityKgM3,
      Ixx: Number(((1 / 12) * massKg * (heightM * heightM + depthM * depthM)).toExponential(4)),
      Iyy: Number(((1 / 12) * massKg * (widthM * widthM + depthM * depthM)).toExponential(4)),
      Izz: Number(((1 / 12) * massKg * (widthM * widthM + heightM * heightM)).toExponential(4)),
      yieldStrengthMPa: mat.yieldStrengthMPa,
      thermalConductivityW_mK: mat.thermalConductivityW_mK
    };
  }

  /**
   * Compute mass and centroidal inertia for a caller-described homogeneous
   * solid cuboid. Density and its source are supplied by the caller; this
   * method does not identify or qualify a material.
   */
  static computeCuboidMassProperties({ widthM, heightM, depthM, densityKgM3, densitySource } = {}) {
    if (![widthM, heightM, depthM, densityKgM3].every((value) => Number.isFinite(value) && value > 0)) {
      throw new TypeError('Cuboid dimensions in meters and density in kg/m³ must be explicit finite positive values.');
    }
    if (typeof densitySource !== 'string' || densitySource.trim().length === 0 || densitySource.length > 1000) {
      throw new TypeError('Provide a nonempty density source of at most 1000 characters.');
    }

    const volumeM3 = widthM * heightM * depthM;
    const massKg = volumeM3 * densityKgM3;
    const Ixx = (massKg * (heightM * heightM + depthM * depthM)) / 12;
    const Iyy = (massKg * (widthM * widthM + depthM * depthM)) / 12;
    const Izz = (massKg * (widthM * widthM + heightM * heightM)) / 12;
    if (![volumeM3, massKg, Ixx, Iyy, Izz].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError('Cuboid mass properties exceed the finite numeric range.');
    }

    return {
      success: true,
      status: 'ok',
      validationLevel: 'experimental',
      model: 'Homogeneous solid cuboid',
      assumptions: [
        'The supplied dimensions describe a solid cuboid.',
        'The supplied density is uniform and applies to the entire cuboid.',
        'Inertia is about centroidal principal axes aligned with the cuboid.'
      ],
      inputs: {
        widthM,
        heightM,
        depthM,
        densityKgM3,
        densitySource: densitySource.trim()
      },
      results: { volumeM3, massKg, Ixx, Iyy, Izz }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MATERIAL_DATABASE,
    MaterialManager,
    REFERENCE_TEMPERATURE_K,
    interpolateProperty
  };
}
