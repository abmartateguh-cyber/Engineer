'use strict';

/**
 * Optical dispersion calculations for explicitly supplied three-term Sellmeier data.
 * No vendor catalog is bundled. A registered material is caller-provided input, not
 * a source or validation claim.
 */
class OpticalMaterials {
  static FRAUNHOFER_WAVELENGTHS_UM = Object.freeze({
    t: 1.01398,
    s: 0.85211,
    r: 0.7065188,
    C: 0.6562725,
    d: 0.5875618,
    e: 0.546074,
    F: 0.4861327,
    g: 0.4358343,
    h: 0.4046561,
    i: 0.3650146
  });

  // Compatibility surface retained for one major version. Product startup leaves it empty.
  static GLASS_CATALOG = Object.create(null);
  static GLASS_ALIASES = Object.freeze({});

  static _resolveGlassKey(key) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new TypeError('An optical material record or registered material key is required.');
    }
    return this.GLASS_ALIASES[key] || key;
  }

  static _getMaterial(materialOrKey) {
    if (materialOrKey && typeof materialOrKey === 'object' && !Array.isArray(materialOrKey)) {
      return materialOrKey;
    }
    const key = this._resolveGlassKey(materialOrKey);
    const material = this.GLASS_CATALOG[key];
    if (!material) {
      throw new RangeError(`Optical material '${key}' is unavailable; supply explicit Sellmeier coefficients.`);
    }
    return material;
  }

  static _validateMaterial(material) {
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
      throw new TypeError('A Sellmeier material record is required.');
    }
    for (const name of ['B1', 'B2', 'B3', 'C1', 'C2', 'C3']) {
      if (typeof material[name] !== 'number' || !Number.isFinite(material[name])) {
        throw new TypeError(`Sellmeier coefficient ${name} must be a finite number.`);
      }
    }
    return material;
  }

  static getAbbeNumber(materialOrKey) {
    return this.getFraunhoferProperties(materialOrKey).Vd;
  }

  /** Compute n(lambda) from explicitly supplied Sellmeier coefficients. */
  static getRefractiveIndex(materialOrKey, wavelengthUm) {
    if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
      throw new TypeError('Wavelength must be a finite positive value in micrometers.');
    }
    const material = this._validateMaterial(this._getMaterial(materialOrKey));
    const wavelengthSquared = wavelengthUm * wavelengthUm;
    let nSquared = 1;
    for (let index = 1; index <= 3; index++) {
      const denominator = wavelengthSquared - material[`C${index}`];
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-15) {
        throw new RangeError(`Wavelength ${wavelengthUm} um is singular for the supplied Sellmeier record.`);
      }
      nSquared += (material[`B${index}`] * wavelengthSquared) / denominator;
    }
    if (!Number.isFinite(nSquared) || nSquared <= 0) {
      throw new RangeError('The supplied Sellmeier coefficients do not produce a finite positive index.');
    }
    return Math.sqrt(nSquared);
  }

  static getFraunhoferProperties(materialOrKey) {
    const nd = this.getRefractiveIndex(materialOrKey, this.FRAUNHOFER_WAVELENGTHS_UM.d);
    const nF = this.getRefractiveIndex(materialOrKey, this.FRAUNHOFER_WAVELENGTHS_UM.F);
    const nC = this.getRefractiveIndex(materialOrKey, this.FRAUNHOFER_WAVELENGTHS_UM.C);
    const ne = this.getRefractiveIndex(materialOrKey, this.FRAUNHOFER_WAVELENGTHS_UM.e);
    const deltaN = nF - nC;
    if (!Number.isFinite(deltaN) || Math.abs(deltaN) < 1e-15) {
      throw new RangeError('The supplied Sellmeier record does not define a finite Abbe number.');
    }
    return {
      nd: Number(nd.toFixed(8)),
      nF: Number(nF.toFixed(8)),
      nC: Number(nC.toFixed(8)),
      ne: Number(ne.toFixed(8)),
      Vd: Number(((nd - 1) / deltaN).toFixed(4))
    };
  }

  /** Register an explicitly supplied record in the current process. */
  static registerCustomGlass(glassKey, data) {
    if (typeof glassKey !== 'string' || !glassKey.trim()) {
      throw new TypeError('A nonempty custom material key is required.');
    }
    const material = this._validateMaterial(data);
    this.GLASS_CATALOG[glassKey] = {
      name: typeof material.name === 'string' && material.name.trim() ? material.name : glassKey,
      category: typeof material.category === 'string' ? material.category : 'Caller supplied',
      B1: material.B1,
      B2: material.B2,
      B3: material.B3,
      C1: material.C1,
      C2: material.C2,
      C3: material.C3
    };
    return this.GLASS_CATALOG[glassKey];
  }

  static listGlasses() {
    return Object.entries(this.GLASS_CATALOG).map(([key, material]) => ({
      key,
      ...material,
      ...this.getFraunhoferProperties(material)
    }));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpticalMaterials };
}
