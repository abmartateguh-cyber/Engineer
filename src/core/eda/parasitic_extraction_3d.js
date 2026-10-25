/**
 * OmniEng 3D Interconnect Parasitic Extraction (PEX) Engine
 *
 * Experimental analytical RC estimate example:
 * 1. Wire sheet and line resistance: R = rho * (L / (w * t)).
 * 2. 3D Electrostatic Capacitance components:
 *    - Area capacitance to underlying substrate / ground plane.
 *    - Conformal fringe electric field capacitance (Palmer / Chang formula).
 *    - Lateral inter-wire cross-coupling capacitance between adjacent routing tracks.
 * 3. Distributed Pi-model (C_in, R, C_out) generation for SPICE simulation.
 *
 * No field-solver correlation, foundry stack data, or signoff extraction is included.
 */

'use strict';

const EPSILON_0 = 8.8541878128e-12; // F/m (Vacuum permittivity)

class ParasiticExtraction3D {
  /**
   * Extracts total resistance and 3D capacitance for an on-chip metal interconnect wire
   * @param {Object} wireSpec
   * @param {number} wireSpec.lengthUm - Wire length (microns)
   * @param {number} wireSpec.widthUm - Wire width (microns)
   * @param {number} wireSpec.thicknessUm - Wire thickness (microns)
   * @param {number} wireSpec.spacingUm - Distance to adjacent parallel wire (microns)
   * @param {number} wireSpec.dielectricHeightUm - Distance to underlying ground plane (microns)
   * @param {number} wireSpec.dielectricPermittivity - User-supplied relative permittivity
   * @param {number} wireSpec.resistivityOhmM - User-supplied metal resistivity (Ohm*m)
   * @returns {Object} Experimental RC estimates and a lumped Pi-network
   */
  static extractWireRC(wireSpec = {}) {
    const requiredFields = [
      'lengthUm',
      'widthUm',
      'thicknessUm',
      'spacingUm',
      'dielectricHeightUm',
      'dielectricPermittivity',
      'resistivityOhmM'
    ];
    const missingFields = requiredFields.filter((field) => wireSpec[field] === undefined);
    if (missingFields.length > 0) {
      throw new TypeError(`Missing required interconnect inputs: ${missingFields.join(', ')}`);
    }
    for (const field of requiredFields) {
      if (!Number.isFinite(wireSpec[field]) || wireSpec[field] <= 0) {
        throw new TypeError(`Interconnect input '${field}' must be a positive finite number`);
      }
    }

    const lengthUm = wireSpec.lengthUm;
    const widthUm = wireSpec.widthUm;
    const thicknessUm = wireSpec.thicknessUm;
    const spacingUm = wireSpec.spacingUm;
    const dielectricHeightUm = wireSpec.dielectricHeightUm;
    const k = wireSpec.dielectricPermittivity;
    const rho = wireSpec.resistivityOhmM;

    const L = lengthUm * 1e-6; // m
    const w = widthUm * 1e-6;
    const t = thicknessUm * 1e-6;
    const s = spacingUm * 1e-6;
    const h = dielectricHeightUm * 1e-6;
    const eps = EPSILON_0 * k;

    // 1. Line resistance R = rho * L / (w * t)
    const crossSectionArea = w * t;
    const resistanceOhms = (rho * L) / crossSectionArea;

    // 2. Parallel-plate area capacitance to substrate: C_area = eps * (w * L) / h
    const cArea = (eps * (w * L)) / h;

    // 3. Conformal fringe capacitance (Palmer semi-empirical 2D conformal mapping)
    // C_fringe = 2 * eps * L * ( 0.075 * (w/h) + 2.8 * (t/h)^0.222 )
    const cFringe = 2.0 * eps * L * (0.075 * (w / h) + 2.8 * Math.pow(t / h, 0.222));

    // 4. Inter-wire cross-coupling capacitance (adjacent track at spacing s)
    // Parallel-plate lateral: eps * (t * L) / s plus lateral fringe
    const cCouplingPlate = (eps * (t * L)) / s;
    const cCouplingFringe = 1.064 * eps * L * Math.pow(t / s, 0.222);
    const cCoupling = 2.0 * (cCouplingPlate + cCouplingFringe); // Two adjacent sides

    const totalCapacitance = cArea + cFringe + cCoupling;
    const elmoreDelayPs = resistanceOhms * totalCapacitance * 0.5 * 1e12;
    const numericResults = [
      resistanceOhms,
      cArea,
      cFringe,
      cCoupling,
      totalCapacitance,
      elmoreDelayPs,
      cArea * 1e15,
      cFringe * 1e15,
      cCoupling * 1e15,
      totalCapacitance * 1e15,
      resistanceOhms * 0.5
    ];
    if (!numericResults.every(Number.isFinite)) {
      throw new RangeError('Interconnect inputs produced a non-finite RC estimate');
    }

    // Distributed Pi-model: C_in = C_total / 2, R = R_total, C_out = C_total / 2
    return {
      validationLevel: 'experimental',
      assumptions: {
        dielectricPermittivity: k,
        resistivityOhmM: rho,
        capacitanceModel: 'parallel-plate and simplified fringe approximations; not field-solver correlated'
      },
      wireLengthUm: lengthUm,
      wireWidthUm: widthUm,
      resistanceOhms: Number(resistanceOhms.toFixed(3)),
      capacitanceAreaFf: Number((cArea * 1e15).toFixed(3)),
      capacitanceFringeFf: Number((cFringe * 1e15).toFixed(3)),
      capacitanceCouplingFf: Number((cCoupling * 1e15).toFixed(3)),
      totalCapacitanceFf: Number((totalCapacitance * 1e15).toFixed(3)),
      elmoreDelayPs: Number(elmoreDelayPs.toFixed(3)),
      piModel: {
        CinFf: Number((totalCapacitance * 0.5 * 1e15).toFixed(3)),
        ROhms: Number(resistanceOhms.toFixed(3)),
        CoutFf: Number((totalCapacitance * 0.5 * 1e15).toFixed(3))
      }
    };
  }
}

module.exports = {
  EPSILON_0,
  ParasiticExtraction3D
};
