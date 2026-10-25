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
    if (
      typeof record.referenceTemperatureC !== 'number' ||
      !Number.isFinite(record.referenceTemperatureC) ||
      record.referenceTemperatureC <= -273.15
    ) {
      throw new TypeError('An optical material record needs a finite referenceTemperatureC above absolute zero.');
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
    if (Object.hasOwn(record, 'dndT')) {
      throw new TypeError('Thermo-optic coefficients must use the unit-explicit dndTPerK field.');
    }
    if (record.dndTPerK !== undefined && (typeof record.dndTPerK !== 'number' || !Number.isFinite(record.dndTPerK))) {
      throw new TypeError('The supplied thermo-optic coefficient must be finite and named per kelvin.');
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

  calculateIndex(glass, wavelengthUm, temperatureC) {
    const record = typeof glass === 'string' ? this.getGlass(glass) : glass;
    if (!record) throw new RangeError(`Glass '${glass}' is not available; supply an explicit optical material record.`);
    if (record.formula !== 'sellmeier1' || !Array.isArray(record.B) || !Array.isArray(record.C)) {
      throw new TypeError('The supplied record is not an isotropic three-term Sellmeier material.');
    }
    if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
      throw new TypeError('Wavelength must be a finite positive value in micrometers.');
    }
    if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC <= -273.15) {
      throw new TypeError('Temperature must be finite and above absolute zero in degrees Celsius.');
    }
    if (
      typeof record.referenceTemperatureC !== 'number' ||
      !Number.isFinite(record.referenceTemperatureC) ||
      record.referenceTemperatureC <= -273.15
    ) {
      throw new TypeError('The supplied optical material record needs an explicit referenceTemperatureC.');
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
    if (temperatureC !== record.referenceTemperatureC) {
      if (record.dndTPerK === undefined) {
        throw new RangeError('Thermo-optic correction is unavailable without a caller-supplied dndTPerK coefficient.');
      }
      index += record.dndTPerK * (temperatureC - record.referenceTemperatureC);
    }
    if (!Number.isFinite(index) || index <= 0) {
      throw new RangeError('The supplied material data produce a nonpositive refractive index.');
    }
    return index;
  }

  getRefractiveIndex(glass, wavelengthUm, temperatureC) {
    return this.calculateIndex(glass, wavelengthUm, temperatureC);
  }

  getOpticalProperties(glass, temperatureC) {
    const record = typeof glass === 'string' ? this.getGlass(glass) : glass;
    if (!record) throw new RangeError(`Glass '${glass}' is not available; supply an explicit optical material record.`);
    if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC <= -273.15) {
      throw new TypeError('A finite calculation temperature above absolute zero in degrees Celsius is required.');
    }
    const nd = this.calculateIndex(record, this.spectralLines.d, temperatureC);
    const nF = this.calculateIndex(record, this.spectralLines.F, temperatureC);
    const nC = this.calculateIndex(record, this.spectralLines.C, temperatureC);
    const ne = this.calculateIndex(record, this.spectralLines.e, temperatureC);
    const ng = this.calculateIndex(record, this.spectralLines.g, temperatureC);
    const nFp = this.calculateIndex(record, this.spectralLines.F_prime, temperatureC);
    const nCp = this.calculateIndex(record, this.spectralLines.C_prime, temperatureC);
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
      temperatureC,
      dataReferenceTemperatureC: record.referenceTemperatureC,
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
      dndTPerK: record.dndTPerK
    };
  }

  findNearestGlasses(targetNd, targetVd, temperatureC, maxResults = 5) {
    if (![targetNd, targetVd].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('Target index and Abbe values must be finite numbers.');
    }
    if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC <= -273.15) {
      throw new TypeError('A finite temperature above absolute zero in degrees Celsius is required.');
    }
    if (!Number.isInteger(maxResults) || maxResults < 0)
      throw new RangeError('maxResults must be a nonnegative integer.');
    const candidates = [];
    for (const [name, record] of this.database.entries()) {
      if (record.formula !== 'sellmeier1') continue;
      const properties = this.getOpticalProperties(record, temperatureC);
      const dNd = (properties.nd - targetNd) / 0.1;
      const dVd = (properties.Abbe_Vd - targetVd) / 10.0;
      candidates.push({
        name,
        supplier: record.supplier,
        type: record.type,
        nd: properties.nd,
        Abbe_Vd: properties.Abbe_Vd,
        temperatureC,
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
