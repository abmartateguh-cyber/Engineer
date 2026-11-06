'use strict';

/**
 * Real optical glass catalog data, transcribed from official manufacturer data.
 *
 * Every record is backed by a published manufacturer datasheet (SCHOTT / OHARA / Crystran).
 * Dispersion coefficients are the six-term Sellmeier B/C coefficients exactly as supplied by
 * the manufacturer in their machine-readable optical-glass catalogs (Zemax AGF format):
 *
 *  - SCHOTT AG, 'Optical Glass overview glass types (ZEMAX format)', June 2025 edition.
 *  - OHARA INC., 'OHARA Optical Glass Catalog (S-glass, L-glass, i-line, ...)', 2026-05-29 edition.
 *  - Crystran Ltd, 'Calcium Fluoride CaF2 Data Sheet' (Malitson 1963 Sellmeier coefficients).
 *
 * dndTPerK is the first-order (D0) thermo-optic coefficient of the manufacturer's published
 * index-vs-temperature model (reference temperature 20 C).
 */

const OPTICAL_GLASS_CATALOG_DATA = [
  {
    name: 'CaF2',
    supplier: 'Crystran Ltd',
    type: 'crystalline',
    family: 'fluoride-crystal',
    formula: 'sellmeier1',
    B: [0.5675888, 0.4710914, 3.8484723],
    C: [0.050263605 * 0.050263605, 0.1003909 * 0.1003909, 34.64904 * 34.64904],
    referenceTemperatureC: 20,
    dndTPerK: -10.6e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'Crystran Ltd',
      datasheetUrl: 'https://www.crystran.co.uk/optical-materials/calcium-fluoride-caf2',
      dataFileUrl: 'https://www.crystran.com/wp-content/uploads/2025/09/calcium-fluoride-caf2-data-sheet.pdf',
      retrievedAt: '2026-11-01',
      note: 'Malitson (1963) six-term Sellmeier coefficients; computed n(0.486/0.588/0.656 um) = 1.4370/1.4339/1.4325 matches the Crystran published table.'
    }
  },
  {
    name: 'N-BK7',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
    referenceTemperatureC: 20,
    dndTPerK: 1.86e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-K5',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.08511833, 0.199562005, 0.930511663],
    C: [0.00661099503, 0.024110866, 111.982777],
    referenceTemperatureC: 20,
    dndTPerK: -4.13e-7,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-BAK4',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.28834642, 0.132817724, 0.945395373],
    C: [0.00779980626, 0.0315631177, 105.965875],
    referenceTemperatureC: 20,
    dndTPerK: 3.06e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SK2',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.28189012, 0.257738258, 0.96818604],
    C: [0.0072719164, 0.0242823527, 110.377773],
    referenceTemperatureC: 20,
    dndTPerK: 3.8e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SSK2',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.4306027, 0.153150554, 1.01390904],
    C: [0.00823982975, 0.0333736841, 106.870822],
    referenceTemperatureC: 20,
    dndTPerK: 5.21e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-PK51',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'fluorophosphate',
    formula: 'sellmeier1',
    B: [1.15610775, 0.153229344, 0.785618966],
    C: [0.00585597402, 0.0194072416, 140.537046],
    referenceTemperatureC: 20,
    dndTPerK: -1.98e-5,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-PSK53',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.3434087, 0.241417935, 0.952896897],
    C: [0.00675074317, 0.0219910513, 103.551457],
    referenceTemperatureC: 20,
    dndTPerK: -9.29e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-FK5',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'fluorophosphate',
    formula: 'sellmeier1',
    B: [0.844309338, 0.344147824, 0.910790213],
    C: [0.00475111955, 0.0149814849, 97.8600293],
    referenceTemperatureC: 20,
    dndTPerK: -7.24e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-FK51',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'fluorophosphate',
    formula: 'sellmeier1',
    B: [0.971247817, 0.216901417, 0.904651666],
    C: [0.00472301995, 0.0153575612, 168.68133],
    referenceTemperatureC: 20,
    dndTPerK: -1.83e-5,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LAK8',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.33183167, 0.546623206, 1.19084015],
    C: [0.00620023871, 0.0216465439, 82.5827736],
    referenceTemperatureC: 20,
    dndTPerK: 4.1e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LAK21',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.22718116, 0.420783743, 1.01284843],
    C: [0.00602075682, 0.0196862889, 88.4370099],
    referenceTemperatureC: 20,
    dndTPerK: -2.36e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LAK22',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.14229781, 0.535138441, 1.04088385],
    C: [0.00585778594, 0.0198546147, 100.834017],
    referenceTemperatureC: 20,
    dndTPerK: 1.36e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LAK33A',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.44116999, 0.571749501, 1.16605226],
    C: [0.00680933877, 0.0222291824, 80.9379555],
    referenceTemperatureC: 20,
    dndTPerK: 2.63e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-BAF10',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.5851495, 0.143559385, 1.08521269],
    C: [0.00926681282, 0.0424489805, 105.613573],
    referenceTemperatureC: 20,
    dndTPerK: 3.79e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LLF6',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.22932376, 0.0755174062, 0.988839837],
    C: [0.00877776451, 0.0480429329, 112.136098],
    referenceTemperatureC: 20,
    dndTPerK: 2.48e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'F2',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.34533359, 0.209073176, 0.937357162],
    C: [0.00997743871, 0.0470450767, 111.886764],
    referenceTemperatureC: 20,
    dndTPerK: 1.51e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'SF6',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.72448482, 0.390104889, 1.04572858],
    C: [0.0134871947, 0.0569318095, 118.557185],
    referenceTemperatureC: 20,
    dndTPerK: 6.69e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF1',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.60865158, 0.237725916, 1.51530653],
    C: [0.0119654879, 0.0590589722, 135.521676],
    referenceTemperatureC: 20,
    dndTPerK: -3.72e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF5',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.52481889, 0.187085527, 1.42729015],
    C: [0.011254756, 0.0588995392, 129.141675],
    referenceTemperatureC: 20,
    dndTPerK: -2.51e-7,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF6',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.77931763, 0.338149866, 2.08734474],
    C: [0.0133714182, 0.0617533621, 174.01759],
    referenceTemperatureC: 20,
    dndTPerK: -4.93e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF8',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.55075812, 0.209816918, 1.46205491],
    C: [0.0114338344, 0.0582725652, 133.24165],
    referenceTemperatureC: 20,
    dndTPerK: -1.94e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF10',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.62153902, 0.256287842, 1.64447552],
    C: [0.0122241457, 0.0595736775, 147.468793],
    referenceTemperatureC: 20,
    dndTPerK: -4.68e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF11',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.73759695, 0.313747346, 1.89878101],
    C: [0.013188707, 0.0623068142, 155.23629],
    referenceTemperatureC: 20,
    dndTPerK: -3.56e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF14',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.69022361, 0.288870052, 1.7045187],
    C: [0.0130512113, 0.061369188, 149.517689],
    referenceTemperatureC: 20,
    dndTPerK: -5.56e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-SF15',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.57055634, 0.218987094, 1.50824017],
    C: [0.0116507014, 0.0597856897, 132.709339],
    referenceTemperatureC: 20,
    dndTPerK: -7.15e-7,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-KZFS4',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.35055424, 0.197575506, 1.09962992],
    C: [0.0087628207, 0.0371767201, 90.3866994],
    referenceTemperatureC: 20,
    dndTPerK: 1.81e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'N-LASF9',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [2.00029547, 0.298926886, 1.80691843],
    C: [0.0121426017, 0.0538736236, 156.530829],
    referenceTemperatureC: 20,
    dndTPerK: 1.05e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'LITHOSIL-Q',
    supplier: 'SCHOTT AG',
    type: 'optical-glass',
    family: 'fused-silica',
    formula: 'sellmeier1',
    B: [0.67071081, 0.433322857, 0.877379057],
    C: [0.00449192312, 0.0132812976, 95.8899878],
    referenceTemperatureC: 20,
    dndTPerK: 2.06e-5,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'SCHOTT AG',
      datasheetUrl:
        'https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?v=97b3ea2b&download=true',
      dataFileUrl:
        'https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true',
      retrievedAt: '2026-11-01',
      note: 'SCHOTT Optical Glass ZEMAX catalog (June 2025).'
    }
  },
  {
    name: 'S-BSL7',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'crown',
    formula: 'sellmeier1',
    B: [1.1515019, 0.118583612, 1.26301359],
    C: [0.010598413, -0.011822519, 129.617662],
    referenceTemperatureC: 20,
    dndTPerK: 7.52e-7,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-FPL51',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'fluorophosphate',
    formula: 'sellmeier1',
    B: [1.17010505, 0.0475710783, 0.763832445],
    C: [0.00616203924, 0.0263372876, 141.882642],
    referenceTemperatureC: 20,
    dndTPerK: -1.94e-5,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-LAL8',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.30663291, 0.571377253, 1.24303605],
    C: [0.00611862448, 0.021272147, 90.6285686],
    referenceTemperatureC: 20,
    dndTPerK: 2.07e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-LAL14',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.2372097, 0.589722623, 1.3192188],
    C: [0.015355132, -0.00030789625, 93.7202947],
    referenceTemperatureC: 20,
    dndTPerK: 2.12e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-LAM60',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.60673056, 0.36641564, 1.31761804],
    C: [0.0077504614, 0.0289967611, 93.0720709],
    referenceTemperatureC: 20,
    dndTPerK: 5.34e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-LAM66',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.92094221, 0.219901208, 1.72705231],
    C: [0.0115075241, 0.0547993543, 120.133674],
    referenceTemperatureC: 20,
    dndTPerK: -8.21e-7,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-TIH6',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.77227611, 0.34569125, 2.40788501],
    C: [0.0131182633, 0.0614479619, 200.753254],
    referenceTemperatureC: 20,
    dndTPerK: -5.61e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-TIH11',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.72677471, 0.324568628, 2.65816809],
    C: [0.0129369958, 0.0618255245, 221.904637],
    referenceTemperatureC: 20,
    dndTPerK: -4.72e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-TIH53',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.87904886, 0.369719775, 2.33730863],
    C: [0.014412177, 0.063881799, 182.66818],
    referenceTemperatureC: 20,
    dndTPerK: -5.54e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-TIM28',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [1.5427081, 0.217113891, 1.81904459],
    C: [0.0113925005, 0.0579224572, 167.697189],
    referenceTemperatureC: 20,
    dndTPerK: -1.87e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-NPH2',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'flint',
    formula: 'sellmeier1',
    B: [2.0386951, 0.437269641, 2.96711461],
    C: [0.0170796224, 0.0749254813, 174.155354],
    referenceTemperatureC: 20,
    dndTPerK: -5.52e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  },
  {
    name: 'S-LAH58',
    supplier: 'OHARA INC.',
    type: 'optical-glass',
    family: 'lanthanum',
    formula: 'sellmeier1',
    B: [1.78764964, 0.6526356, 1.79914564],
    C: [0.00847378536, 0.0313126408, 132.788001],
    referenceTemperatureC: 20,
    dndTPerK: 1.1e-6,
    dataStatus: 'datasheet-published',
    validationStatus: 'datasheet-published',
    provenance: {
      manufacturer: 'OHARA INC.',
      datasheetUrl: 'https://www.ohara-inc.co.jp/en/product/catalog/',
      dataFileUrl: 'https://www.ohara-inc.co.jp/wp-content/uploads/2022/02/OHARA_260529_CATALOG.zip',
      retrievedAt: '2026-11-01',
      note: 'OHARA Optical Glass Catalog (2026-05-29 edition), AGF dispersion data.'
    }
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OPTICAL_GLASS_CATALOG_DATA;
}
