/**
 * OmniEng Optical Materials & Glass Dispersion Catalog
 * Standard: Schott, Ohara, & Optical Polymer Sellmeier Equations
 * Industrial Parity: Zemax OpticStudio / SYNOPSYS CODE V glass catalogs.
 */

class OpticalMaterials {
  static FRAUNHOFER_WAVELENGTHS_UM = {
    t: 1.01398,    // Infrared mercury line
    s: 0.85211,    // Infrared cesium line
    r: 0.7065188,  // Red helium line
    C: 0.6562725,  // Red hydrogen line
    d: 0.5875618,  // Yellow helium line (standard reference)
    e: 0.546074,   // Green mercury line
    F: 0.4861327,  // Blue hydrogen line
    g: 0.4358343,  // Blue mercury line
    h: 0.4046561,  // Violet mercury line
    i: 0.3650146   // UV mercury line
  };

  /**
   * 6-term Sellmeier coefficients:
   * n^2(λ) = 1 + B1*λ^2/(λ^2 - C1) + B2*λ^2/(λ^2 - C2) + B3*λ^2/(λ^2 - C3)
   * where λ is in micrometers (μm).
   */
  static GLASS_CATALOG = {
    'Schott_NBK7': {
      name: 'Schott N-BK7 Standard Borosilicate Crown',
      category: 'Crown',
      B1: 1.03961212,
      B2: 0.231792344,
      B3: 1.01046945,
      C1: 0.00600069867,
      C2: 0.0200179144,
      C3: 103.560653,
      nominal_nd: 1.51680,
      nominal_Vd: 64.17
    },
    'Schott_NSF11': {
      name: 'Schott N-SF11 Dense Flint',
      category: 'Flint',
      B1: 1.73759695,
      B2: 0.313747346,
      B3: 1.89878101,
      C1: 0.013188707,
      C2: 0.0623068142,
      C3: 155.23629,
      nominal_nd: 1.78472,
      nominal_Vd: 25.76
    },
    'Schott_NLAK9': {
      name: 'Schott N-LAK9 Lanthanum Crown',
      category: 'Lanthanum Crown',
      B1: 1.57945041,
      B2: 0.283151977,
      B3: 1.02636254,
      C1: 0.00780287413,
      C2: 0.0286884841,
      C3: 86.8180327,
      nominal_nd: 1.69100,
      nominal_Vd: 54.71
    },
    'Schott_F2': {
      name: 'Schott F2 Classical Optical Flint',
      category: 'Flint',
      B1: 1.34533359,
      B2: 0.209073176,
      B3: 0.93735716,
      C1: 0.00997743871,
      C2: 0.0470450767,
      C3: 111.886764,
      nominal_nd: 1.62004,
      nominal_Vd: 36.37
    },
    'Fused_Silica': {
      name: 'Synthetic Fused Silica (Corning 7980)',
      category: 'Fused Silica',
      B1: 0.6961663,
      B2: 0.4079426,
      B3: 0.8974794,
      C1: 0.004679148,
      C2: 0.01351206,
      C3: 97.93400,
      nominal_nd: 1.45846,
      nominal_Vd: 67.82
    },
    'OpticalFluorite_CaF2': {
      name: 'Single Crystal Calcium Fluoride (CaF2)',
      category: 'Fluorite',
      B1: 0.5675888,
      B2: 0.4710914,
      B3: 3.8484723,
      C1: 0.00252643,
      C2: 0.01007833,
      C3: 1200.556,
      nominal_nd: 1.43384,
      nominal_Vd: 95.34
    },
    'PMMA_Acrylic': {
      name: 'Poly(methyl methacrylate) Optical Grade',
      category: 'Optical Polymer',
      B1: 1.1819,
      B2: 0.029,
      B3: 0.02,
      C1: 0.0105,
      C2: 0.021,
      C3: 100.0,
      nominal_nd: 1.4917,
      nominal_Vd: 57.4
    },
    'Polycarbonate_Optical': {
      name: 'Optical Grade Polycarbonate (PC)',
      category: 'Optical Polymer',
      B1: 1.4182,
      B2: 0.1796,
      B3: 0.5,
      C1: 0.0213,
      C2: 0.052,
      C3: 120.0,
      nominal_nd: 1.5855,
      nominal_Vd: 30.3
    },
    'Air': {
      name: 'Dry Atmospheric Air at 1 atm, 20°C',
      category: 'Gas',
      B1: 0.0,
      B2: 0.0,
      B3: 0.0,
      C1: 1.0,
      C2: 1.0,
      C3: 1.0,
      nominal_nd: 1.000277,
      nominal_Vd: 89330.0
    }
  };

  static GLASS_ALIASES = {
    'N-BK7': 'Schott_NBK7',
    'NBK7': 'Schott_NBK7',
    'N-SF11': 'Schott_NSF11',
    'NSF11': 'Schott_NSF11',
    'N-LAK9': 'Schott_NLAK9',
    'NLAK9': 'Schott_NLAK9',
    'F2': 'Schott_F2',
    'FusedSilica': 'Fused_Silica',
    'CaF2': 'OpticalFluorite_CaF2',
    'PMMA': 'PMMA_Acrylic',
    'Polycarbonate': 'Polycarbonate_Optical'
  };

  static _resolveGlassKey(key) {
    if (!key) return 'Air';
    return this.GLASS_ALIASES[key] || key;
  }

  /**
   * Returns Abbe number V_d for specified glass.
   */
  static getAbbeNumber(glassKey) {
    const resolved = this._resolveGlassKey(glassKey);
    return this.getFraunhoferProperties(resolved).Vd;
  }

  /**
   * Computes refractive index n(λ) using Sellmeier equation.
   * @param {string} glassKey Key in GLASS_CATALOG or alias
   * @param {number} wavelengthUm Wavelength in micrometers (e.g. 0.58756 for d-line)
   * @returns {number} Refractive index n
   */
  static getRefractiveIndex(glassKey, wavelengthUm = 0.5875618) {
    const resolved = this._resolveGlassKey(glassKey);
    if (resolved === 'Air') {
      return 1.000277;
    }

    const g = this.GLASS_CATALOG[resolved];
    if (!g) {
      // Default fallback if unknown
      return 1.5;
    }

    const lam = Number(wavelengthUm);
    const lam2 = lam * lam;

    const term1 = (g.B1 * lam2) / (lam2 - g.C1);
    const term2 = (g.B2 * lam2) / (lam2 - g.C2);
    const term3 = (g.B3 * lam2) / (lam2 - g.C3);

    const nSquared = 1.0 + term1 + term2 + term3;
    if (nSquared <= 0) {
      return g.nominal_nd || 1.5;
    }

    return Math.sqrt(nSquared);
  }

  /**
   * Returns Fraunhofer indices and Abbe number V_d = (n_d - 1) / (n_F - n_C)
   * @param {string} glassKey
   */
  static getFraunhoferProperties(glassKey) {
    const resolved = this._resolveGlassKey(glassKey);
    if (resolved === 'Air') {
      return { nd: 1.000277, nF: 1.000282, nC: 1.000275, ne: 1.000279, Vd: 89330.0 };
    }

    const nd = this.getRefractiveIndex(resolved, this.FRAUNHOFER_WAVELENGTHS_UM.d);
    const nF = this.getRefractiveIndex(resolved, this.FRAUNHOFER_WAVELENGTHS_UM.F);
    const nC = this.getRefractiveIndex(resolved, this.FRAUNHOFER_WAVELENGTHS_UM.C);
    const ne = this.getRefractiveIndex(resolved, this.FRAUNHOFER_WAVELENGTHS_UM.e);

    const deltaN = nF - nC;
    const Vd = deltaN !== 0 ? (nd - 1.0) / deltaN : 9999.0;

    return {
      nd: Number(nd.toFixed(5)),
      nF: Number(nF.toFixed(5)),
      nC: Number(nC.toFixed(5)),
      ne: Number(ne.toFixed(5)),
      Vd: Number(Vd.toFixed(2))
    };
  }

  /**
   * Registers a custom optical glass material.
   */
  static registerCustomGlass(glassKey, data) {
    this.GLASS_CATALOG[glassKey] = {
      name: data.name || glassKey,
      category: data.category || 'Custom',
      B1: Number(data.B1) || 0,
      B2: Number(data.B2) || 0,
      B3: Number(data.B3) || 0,
      C1: Number(data.C1) || 0,
      C2: Number(data.C2) || 0,
      C3: Number(data.C3) || 0,
      nominal_nd: Number(data.nominal_nd) || 1.5,
      nominal_Vd: Number(data.nominal_Vd) || 50.0
    };
  }

  /**
   * Returns list of all available optical materials.
   */
  static listGlasses() {
    return Object.keys(this.GLASS_CATALOG).map(k => ({
      key: k,
      ...this.GLASS_CATALOG[k],
      ...this.getFraunhoferProperties(k)
    }));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpticalMaterials };
}
