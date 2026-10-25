'use strict';

/**
 * Experimental Sellmeier calculation helpers with an empty default catalog.
 * Callers may pass explicitly supplied records; this module contains no vendor data.
 */
class OpticalGlassCatalog {
  constructor(records = []) {
    if (!Array.isArray(records)) throw new TypeError('Optical material records must be supplied as an array.');
    this.spectralLines = Object.freeze({
      t: 1.01398,
      s: 0.85211,
      r: 0.70652,
      C: 0.65627,
      C_prime: 0.64385,
      d: 0.58756,
      e: 0.54607,
      F: 0.48613,
      F_prime: 0.47999,
      g: 0.43583,
      h: 0.40466,
      i: 0.36501
    });
    this.database = new Map();
    records.forEach((record) => this.registerGlass(record));
  }

  registerGlass(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('An optical material record is required.');
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
      throw new TypeError('An optical material record needs a nonempty name.');
    }
    if (record.formula === 'sellmeier1') {
      for (const field of ['B', 'C']) {
        if (!Array.isArray(record[field]) || record[field].length !== 3 || !record[field].every(Number.isFinite)) {
          throw new TypeError(`Sellmeier ${field} coefficients must contain three finite numbers.`);
        }
      }
    } else if (record.formula === 'birefringent') {
      if (![record.no, record.ne].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        throw new TypeError('Birefringent records need finite positive ordinary and extraordinary indices.');
      }
    } else {
      throw new TypeError('Optical material formula must be sellmeier1 or birefringent.');
    }
    const normalized = {
      ...record,
      dataStatus: record.dataStatus || 'caller-supplied',
      provenance: record.provenance || null
    };
    this.database.set(record.name.trim().toUpperCase(), normalized);
    return normalized;
  }

  getGlass(glassName) {
    if (typeof glassName !== 'string' || !glassName.trim()) return null;
    return this.database.get(glassName.trim().toUpperCase()) || null;
  }

  calculateIndex(glass, wavelengthUm = 0.58756, temperatureC = 20.0) {
    const record = typeof glass === 'string' ? this.getGlass(glass) : glass;
    if (!record) throw new RangeError(`Glass '${glass}' is not available; supply an explicit optical material record.`);
    if (record.formula !== 'sellmeier1' || !Array.isArray(record.B) || !Array.isArray(record.C)) {
      throw new TypeError('The supplied record is not an isotropic three-term Sellmeier material.');
    }
    if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
      throw new TypeError('Wavelength must be a finite positive value in micrometers.');
    }
    if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC)) {
      throw new TypeError('Temperature must be a finite value in degrees Celsius.');
    }

    const wavelengthSquared = wavelengthUm * wavelengthUm;
    let nSquared = 1;
    for (let index = 0; index < 3; index++) {
      const denominator = wavelengthSquared - record.C[index];
      if (Math.abs(denominator) < 1e-15) {
        throw new RangeError(`Wavelength ${wavelengthUm} um is singular for the supplied Sellmeier record.`);
      }
      nSquared += (record.B[index] * wavelengthSquared) / denominator;
    }
    if (!Number.isFinite(nSquared) || nSquared <= 0) {
      throw new RangeError('The supplied Sellmeier coefficients do not produce a finite positive index.');
    }

    let index = Math.sqrt(nSquared);
    if (temperatureC !== 20.0 && record.dndT !== undefined) {
      if (typeof record.dndT !== 'number' || !Number.isFinite(record.dndT)) {
        throw new TypeError('The supplied thermo-optic coefficient must be finite.');
      }
      index += record.dndT * (temperatureC - 20.0);
    }
    if (!Number.isFinite(index) || index <= 0) {
      throw new RangeError('The supplied material data produce a nonpositive refractive index.');
    }
    return index;
  }

  getRefractiveIndex(glass, wavelengthUm = 0.58756, temperatureC = 20.0) {
    return this.calculateIndex(glass, wavelengthUm, temperatureC);
  }

  getOpticalProperties(glass) {
    const record = typeof glass === 'string' ? this.getGlass(glass) : glass;
    if (!record) throw new RangeError(`Glass '${glass}' is not available; supply an explicit optical material record.`);
    const nd = this.calculateIndex(record, this.spectralLines.d);
    const nF = this.calculateIndex(record, this.spectralLines.F);
    const nC = this.calculateIndex(record, this.spectralLines.C);
    const ne = this.calculateIndex(record, this.spectralLines.e);
    const ng = this.calculateIndex(record, this.spectralLines.g);
    const nFp = this.calculateIndex(record, this.spectralLines.F_prime);
    const nCp = this.calculateIndex(record, this.spectralLines.C_prime);
    const deltaN = nF - nC;
    if (Math.abs(deltaN) < 1e-15 || Math.abs(nFp - nCp) < 1e-15) {
      throw new RangeError('The supplied Sellmeier record does not define finite Abbe numbers.');
    }

    return {
      name: record.name,
      supplier: record.supplier,
      type: record.type,
      dataStatus: record.dataStatus || 'caller-supplied',
      provenance: record.provenance || null,
      nd,
      ne,
      nF,
      nC,
      ng,
      Abbe_Vd: (nd - 1.0) / deltaN,
      Abbe_Ve: (ne - 1.0) / (nFp - nCp),
      partialDispersion_PgF: (ng - nF) / deltaN,
      density: record.density,
      thermalExpansion: record.thermalExpansion,
      dndT: record.dndT
    };
  }

  findNearestGlasses(targetNd, targetVd, maxResults = 5) {
    if (![targetNd, targetVd].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('Target index and Abbe values must be finite numbers.');
    }
    if (!Number.isInteger(maxResults) || maxResults < 0)
      throw new RangeError('maxResults must be a nonnegative integer.');
    const candidates = [];
    for (const [name, record] of this.database.entries()) {
      if (record.formula !== 'sellmeier1') continue;
      const properties = this.getOpticalProperties(record);
      const dNd = (properties.nd - targetNd) / 0.1;
      const dVd = (properties.Abbe_Vd - targetVd) / 10.0;
      candidates.push({
        name,
        supplier: record.supplier,
        type: record.type,
        nd: properties.nd,
        Abbe_Vd: properties.Abbe_Vd,
        distance: Math.sqrt(dNd * dNd + dVd * dVd)
      });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.slice(0, maxResults);
  }

  get catalogSize() {
    return this.database.size;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpticalGlassCatalog };
}
if (typeof window !== 'undefined') {
  window.OpticalGlassCatalog = OpticalGlassCatalog;
}
