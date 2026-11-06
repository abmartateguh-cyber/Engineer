/**
 * Comprehensive Industrial Valve Taxonomy & Application Engineering Catalog.
 * Standards: API 6D, API 600, API 602, API 609, API 594, API 526, ASME B16.34, BS 6364.
 *
 * Implements:
 * 1. Detailed engineering classification of all industrial valve families.
 * 2. Pressure-temperature limits, leakage classes (ANSI/FCI 70-2 Class II to VI),
 *    fire-safe certification (API 607 / ISO 10497), and fugitive emissions (ISO 15848-1).
 * 3. Flow characteristics (Linear, Equal Percentage, Quick Opening, Modified Parabolic).
 * 4. Recovery factors (FL), critical pressure drop ratios (xT), and relative Cv/d^2.
 */

'use strict';

/**
 * @typedef {Object} ValveSpecEntry
 * @property {string} category - Isolation, Throttling/Control, Non-Return, Safety/Relief
 * @property {string} type - Valve specific design
 * @property {string} standard - Primary design standard (API, ASME, BS, ISO)
 * @property {string} bodyStyles - Split body, 3-piece, top-entry, welded, wafer, lug, flanged
 * @property {string} seatType - Soft seat (PTFE, PEEK, Devlon), Metal-to-metal (Stellite)
 * @property {string} leakageClass - FCI 70-2 (Class IV, V, VI, or API 598 Rate A)
 * @property {number} recoveryFactorFL - Typical liquid pressure recovery factor FL
 * @property {number} criticalPressureRatioXT - Typical gas pressure drop ratio factor xT
 * @property {string} characteristic - Inherent flow curve
 * @property {string} typicalServices - Cryogenic, Sour, Slurry, Steam, Hydrocarbon, Clean Gas
 */

/** @type {Record<string, ValveSpecEntry>} */
const VALVE_TAXONOMY_CATALOG = {
  // -------------------------------------------------------------
  // ISOLATION VALVES: BALL
  // -------------------------------------------------------------
  'ball_floating': {
    category: 'Isolation',
    type: 'Floating Ball Valve (Soft Seated)',
    standard: 'API 608 / ASME B16.34',
    bodyStyles: '2-Piece, 3-Piece, End-Entry',
    seatType: 'PTFE, R-PTFE, PEEK',
    leakageClass: 'API 598 Rate A (Zero Bubble)',
    recoveryFactorFL: 0.60,
    criticalPressureRatioXT: 0.30,
    characteristic: 'Quick Opening / Modified Equal Percentage',
    typicalServices: 'General utility, LP/MP hydrocarbon, clean fluids up to 200 °C'
  },
  'ball_trunnion_api6d': {
    category: 'Isolation',
    type: 'Trunnion-Mounted Pipeline Ball Valve',
    standard: 'API 6D / ISO 14313',
    bodyStyles: 'Forged 3-Piece, Welded Body, Top-Entry (In-line serviceable)',
    seatType: 'Self-relieving SPE (Single Piston Effect) or DPE (Double Piston Effect) DBB',
    leakageClass: 'API 598 Rate A / ISO 5208 Rate A',
    recoveryFactorFL: 0.65,
    criticalPressureRatioXT: 0.35,
    characteristic: 'Modified Parabolic',
    typicalServices: 'High-pressure transmission, LNG feed, subsea, emergency shutdown ESDV'
  },
  'ball_cryogenic_extended': {
    category: 'Isolation',
    type: 'Cryogenic Trunnion Ball with Extended Vapor Column Bonnet',
    standard: 'BS 6364 / MESC SPE 77/200 / API 6D',
    bodyStyles: 'Top-Entry or 3-Piece Forged SS316L',
    seatType: 'PCTFE (Kel-F) or Cryogenic PEEK with internal cavity relief vent to upstream',
    leakageClass: 'BS 6364 Appendix A (Helium cryogenic seat leakage < 100 mm3/s/DN)',
    recoveryFactorFL: 0.62,
    criticalPressureRatioXT: 0.32,
    characteristic: 'Modified Equal Percentage',
    typicalServices: 'LNG production (-162 °C), liquid nitrogen, liquid ethylene'
  },

  // -------------------------------------------------------------
  // ISOLATION VALVES: GATE & PLUG
  // -------------------------------------------------------------
  'gate_flexible_wedge': {
    category: 'Isolation',
    type: 'Flexible Wedge Gate Valve',
    standard: 'API 600 / ASME B16.34',
    bodyStyles: 'Cast Steel, Bolted Bonnet (BB), Outside Screw & Yoke (OS&Y)',
    seatType: 'Metal-to-Metal (Hardfaced Stellite Gr 6)',
    leakageClass: 'API 598 Metal Seated Allowable',
    recoveryFactorFL: 0.85,
    criticalPressureRatioXT: 0.60,
    characteristic: 'Quick Opening (On-Off Only)',
    typicalServices: 'Steam distribution, high-temperature crude, boiler feedwater'
  },
  'gate_through_conduit': {
    category: 'Isolation',
    type: 'Through-Conduit Slab Gate Valve',
    standard: 'API 6D',
    bodyStyles: 'Full Bore, Piggable, Parallel Seats',
    seatType: 'PTFE Insert Metal-to-Metal with Double Block & Bleed (DBB)',
    leakageClass: 'API 598 Rate A',
    recoveryFactorFL: 0.90,
    criticalPressureRatioXT: 0.70,
    characteristic: 'On-Off Full Bore',
    typicalServices: 'Pipeline scraper traps, pigging headers, crude export'
  },
  'gate_expanding_api6d': {
    category: 'Isolation',
    type: 'Mechanical Expanding Gate Valve (Double Block and Bleed)',
    standard: 'API 6D / ISO 14313',
    bodyStyles: 'Cast or Forged Steel, Full Bore, Through-Conduit',
    seatType: 'Parallel Mechanical Wedging Expanding Gate, Metal-to-Metal with Secondary Seal',
    leakageClass: 'API 6D / API 598 Rate A (Zero Bubble)',
    recoveryFactorFL: 0.92,
    criticalPressureRatioXT: 0.72,
    characteristic: 'On-Off Full Bore Mechanical Tight Shutoff',
    typicalServices: 'Crude oil transmission, pipeline isolation, custody transfer, hot oil isolation'
  },
  'plug_twin_seal_dbb': {
    category: 'Isolation',
    type: 'Double Block and Bleed Expanding Plug Valve',
    standard: 'API 6D',
    bodyStyles: 'Top-Entry Tapered Body with Retractable Slips',
    seatType: 'Dual Resilient Seals on Slips (Viton / Fluorosilicone)',
    leakageClass: 'Zero Leakage / Verifiable DBB Body Bleed',
    recoveryFactorFL: 0.70,
    criticalPressureRatioXT: 0.40,
    characteristic: 'On-Off Positive Isolation',
    typicalServices: 'Fiscal custody transfer boundary, aviation fuel, manifold isolation'
  },

  // -------------------------------------------------------------
  // SPECIALTY ISOLATION VALVES: DIAPHRAGM, PINCH, KNIFE GATE
  // -------------------------------------------------------------
  'diaphragm_weir_mss_sp88': {
    category: 'Isolation & Throttling',
    type: 'Weir-Type Diaphragm Valve',
    standard: 'MSS SP-88 / BS EN 13397',
    bodyStyles: 'Flanged, Screwed, Lined Body (PTFE, PFA, Neoprene, Hard Rubber)',
    seatType: 'Weir Body Saddle with Flexible Elastomer/PTFE Diaphragm',
    leakageClass: 'MSS SP-88 / ANSI/FCI 70-2 Class VI (Bubble Tight)',
    recoveryFactorFL: 0.75,
    criticalPressureRatioXT: 0.55,
    characteristic: 'Linear to Equal Percentage up to 70% lift',
    typicalServices: 'Corrosive chemical dosing, acid gas treating, water treatment demineralizer, slurries'
  },
  'diaphragm_straight_through_mss_sp88': {
    category: 'Isolation',
    type: 'Straight-Through Full Bore Diaphragm Valve',
    standard: 'MSS SP-88 / BS EN 13397',
    bodyStyles: 'Flanged Cast Iron / Ductile Iron with Elastomer Lining',
    seatType: 'Full Bore Flat Bottom Body with High-Flex Elastomer Diaphragm',
    leakageClass: 'MSS SP-88 Rate A (Bubble Tight)',
    recoveryFactorFL: 0.85,
    criticalPressureRatioXT: 0.65,
    characteristic: 'Quick Opening / High Flow Full Bore',
    typicalServices: 'Heavy abrasive mining slurries, sewage sludge, cement handling, fibrous suspensions'
  },
  'pinch_valve_slurry': {
    category: 'Isolation & Throttling',
    type: 'Heavy-Duty Elastomer Sleeve Pinch Valve',
    standard: 'Manufacturer Standard / ASME B16.34',
    bodyStyles: 'Enclosed Cast Body or Open Frame, Pneumatic/Mechanical Pinch Mechanism',
    seatType: 'Full Bore Flexible Reinforced Elastomer Tube (Natural Rubber, EPDM, Viton)',
    leakageClass: 'ANSI/FCI 70-2 Class VI (100% Bubble-Tight Shutoff around solids)',
    recoveryFactorFL: 0.88,
    criticalPressureRatioXT: 0.68,
    characteristic: 'Modified Linear (True laminar straight-through passage)',
    typicalServices: 'Abrasive lime slurry, tailing transfer, catalyst fines, FGD limestone slurry'
  },
  'knife_gate_mss_sp81': {
    category: 'Isolation',
    type: 'Stainless Steel Bonnetless Knife Gate Valve',
    standard: 'MSS SP-81 / TAPPI TIS 405-8',
    bodyStyles: 'Wafer or Lugged Body, Uni-directional or Bi-directional, Beveled Knife Blade',
    seatType: 'Resilient Perimeter Elastomer (EPDM/PTFE) or Replaceable Metal Seat Ring',
    leakageClass: 'MSS SP-81 (40 ml/min/inch of diameter for metal) or Zero Leakage for Resilient',
    recoveryFactorFL: 0.88,
    criticalPressureRatioXT: 0.70,
    characteristic: 'On-Off Guillotine Shear Action',
    typicalServices: 'Pulp and paper stock, wastewater solids, fly ash slurry, powder bulk conveying'
  },

  // -------------------------------------------------------------
  // INSTRUMENTATION VALVES & MANIFOLDS
  // -------------------------------------------------------------
  'needle_valve_instrument': {
    category: 'Instrumentation & Metering',
    type: 'Precision Instrument Needle Valve',
    standard: 'ASME B16.34 / MSS SP-99 / MSS SP-105',
    bodyStyles: 'Barstock Forged SS316, Integral Bonnet or Union Bonnet, Panel Mount',
    seatType: 'Hardened Non-Rotating Stem Tip (Stellite, SS316, or PEEK Soft Tip)',
    leakageClass: 'ANSI/FCI 70-2 Class VI / API 598 Gas Tight',
    recoveryFactorFL: 0.82,
    criticalPressureRatioXT: 0.65,
    characteristic: 'Fine Micro-Metering Needle Curve',
    typicalServices: 'Pressure gauge isolation, sample take-off points, chemical injection calibration'
  },
  'manifold_instrument_valve': {
    category: 'Instrumentation & Metering',
    type: 'Multi-Valve Instrument Manifold (2-Valve, 3-Valve, 5-Valve)',
    standard: 'MSS SP-99 / MSS SP-105 / IEC 61518',
    bodyStyles: 'Direct Mount Coplanar, Remote Mount Flange-to-Flange, Barstock SS316L/Hastelloy',
    seatType: 'Non-Rotating Metal-to-Metal Needle Stem with Grafoil/PTFE Packing',
    leakageClass: 'MSS SP-99 Bubble-Tight',
    recoveryFactorFL: 0.80,
    criticalPressureRatioXT: 0.62,
    characteristic: 'Isolation and Equalizing Service',
    typicalServices: 'Differential pressure transmitter isolation, static pressure gauge zeroing, fiscal flow metering'
  },

  // -------------------------------------------------------------
  // SUBSEA VALVES (API 17D / ISO 13628-4)
  // -------------------------------------------------------------
  'subsea_failsafe_gate_api17d': {
    category: 'Subsea Isolation',
    type: 'Subsea Fail-Safe Close Hydraulic Actuated Slab Gate Valve',
    standard: 'API 17D / ISO 13628-4 / API 6A',
    bodyStyles: 'Forged Body, Welded or Flanged Bonnet, Hyperbaric Pressure Compensated',
    seatType: 'Metal-to-Metal Tungsten Carbide Coated Slab Gate and Seats with Spring Assist',
    leakageClass: 'API 17D / ISO 13628-4 Zero Bubble Gas Tight',
    recoveryFactorFL: 0.90,
    criticalPressureRatioXT: 0.72,
    characteristic: 'Fast Fail-Safe Close (<5 s under hyperbaric head)',
    typicalServices: 'Subsea Christmas tree production master, wing valve, subsea manifold isolation, deepwater up to 3000 m'
  },
  'subsea_ball_valve_api17d': {
    category: 'Subsea Isolation',
    type: 'Subsea Trunnion Ball Valve with ROV Receptacle',
    standard: 'API 17D / API 6D SS / ISO 13628-4',
    bodyStyles: 'Fully Welded or Bolted Forged Body with ROV Bucket & Dual Barrier Stem Seals',
    seatType: 'Primary Metal-to-Metal with Inconel 625 Clad Inlay and Spring Energized PEEK',
    leakageClass: 'API 6D SS Rate A (Subsea zero leakage)',
    recoveryFactorFL: 0.68,
    criticalPressureRatioXT: 0.38,
    characteristic: 'Full Bore Piggable Isolation',
    typicalServices: 'Subsea pipeline tie-in PLEM, subsea riser ESDV, deepwater flowline isolation'
  },

  // -------------------------------------------------------------
  // PRODUCTION & MULTIPHASE CHOKES (API 6A)
  // -------------------------------------------------------------
  'choke_multiphase_api6a': {
    category: 'Throttling/Control',
    type: 'High-Pressure Multiphase Production Choke Valve',
    standard: 'API 6A / ISO 10423 / ISO 13628-4',
    bodyStyles: 'Angle Pattern Forged Body (Class 2000 to 15000 psi rating)',
    seatType: 'Solid Tungsten Carbide Needle/Seat, Plug & Cage, or External Sleeve Trim',
    leakageClass: 'API 6A / ANSI/FCI 70-2 Class IV / V',
    recoveryFactorFL: 0.85,
    criticalPressureRatioXT: 0.75,
    characteristic: 'Modified Linear with bean size calibration (in 64ths of an inch)',
    typicalServices: 'Wellhead production letdown, multiphase gas-oil-water throttling, high sand erosive service'
  },

  // -------------------------------------------------------------
  // BUTTERFLY VALVES
  // -------------------------------------------------------------
  'butterfly_triple_offset': {
    category: 'Isolation & Throttling',
    type: 'Triple-Offset Metal-Seated Butterfly Valve (TOV)',
    standard: 'API 609 Category B / ASME B16.34',
    bodyStyles: 'Wafer, Lug, Double Flanged (Long / Short Pattern)',
    seatType: 'Laminated Stainless Steel & Graphite / Solid Stellite',
    leakageClass: 'FCI 70-2 Class VI / ISO 5208 Rate A (Bidirectional zero leakage)',
    recoveryFactorFL: 0.70,
    criticalPressureRatioXT: 0.50,
    characteristic: 'Equal Percentage (30° to 70° disc opening)',
    typicalServices: 'Cryogenic LNG, flare backpressure control, severe steam isolation'
  },

  // -------------------------------------------------------------
  // NON-RETURN (CHECK) VALVES
  // -------------------------------------------------------------
  'check_dual_plate_wafer': {
    category: 'Non-Return',
    type: 'Dual-Plate Spring-Assisted Wafer Check Valve',
    standard: 'API 594',
    bodyStyles: 'Wafer, Lugged, Flanged',
    seatType: 'Resilient (NBR/Viton) or Metal (Stellite)',
    leakageClass: 'API 598 Table 6',
    recoveryFactorFL: 0.80,
    criticalPressureRatioXT: 0.55,
    characteristic: 'Fast-closing spring-assisted non-slam',
    typicalServices: 'Centrifugal pump discharge, cooling water, gas compressors'
  },
  'check_axial_nozzle_nonslam': {
    category: 'Non-Return',
    type: 'Axial Flow Nozzle Non-Slam Check Valve',
    standard: 'API 6D / ASME B16.34',
    bodyStyles: 'Short Pattern Venturi Profile, Central Spring-Loaded Disc',
    seatType: 'Precision Ground Metal-to-Metal',
    leakageClass: 'API 598 Zero Liquid Leakage',
    recoveryFactorFL: 0.88,
    criticalPressureRatioXT: 0.65,
    characteristic: 'Extremely rapid dynamic response (<0.1 s closure before reverse flow)',
    typicalServices: 'High-head boiler feed pumps, gas turbine fuel gas, severe water hammer mitigation'
  },

  // -------------------------------------------------------------
  // CONTROL VALVES & SPECIALTY TRIMS
  // -------------------------------------------------------------
  'globe_control_cage_guided': {
    category: 'Throttling/Control',
    type: 'Heavy-Duty Globe Control Valve with Cage Guided Trim',
    standard: 'ISA-75.01 / IEC 60534 / ASME B16.34',
    bodyStyles: 'Straight Pattern Globe, Angle Pattern',
    seatType: 'Metal Seat (Class IV / V) or Soft Seat (Class VI)',
    leakageClass: 'ANSI/FCI 70-2 Class IV (standard), Class V (hot shutoff), Class VI (bubble-tight)',
    recoveryFactorFL: 0.90,
    criticalPressureRatioXT: 0.72,
    characteristic: 'Equal Percentage, Linear, or Quick Opening (interchangeable cages)',
    typicalServices: 'High-pressure drop liquid letdown, drum level control, steam throttling'
  },
  'globe_anticavitation_multistage': {
    category: 'Throttling/Control',
    type: 'Multi-Stage Tortuous Path Anti-Cavitation Control Valve',
    standard: 'ISA-75.01 / IEC 60534',
    bodyStyles: 'Angle Pattern or Heavy Globe Body',
    seatType: 'Hardened Tungsten Carbide / Stellite',
    leakageClass: 'ANSI/FCI 70-2 Class V',
    recoveryFactorFL: 0.98,
    criticalPressureRatioXT: 0.85,
    characteristic: 'Linear / Modified Equal Percentage',
    typicalServices: 'Boiler feed recirculation, high delta-P amine pump letdown (delta-P > 60 bar)'
  },
  'globe_low_noise_aerodynamic': {
    category: 'Throttling/Control',
    type: 'Drilled Hole Multi-Stage Low-Noise Gas Throttling Valve',
    standard: 'IEC 60534-8-3',
    bodyStyles: 'Expanded Outlet Globe Body',
    seatType: 'Hardened Stainless Steel',
    leakageClass: 'ANSI/FCI 70-2 Class IV',
    recoveryFactorFL: 0.88,
    criticalPressureRatioXT: 0.80,
    characteristic: 'Equal Percentage',
    typicalServices: 'Compressor anti-surge bypass, high-pressure natural gas letdown (>100 barg)'
  },
  'axial_flow_control_valve': {
    category: 'Throttling/Control',
    type: 'Axial Flow Sleeve / Needle Pressure Control Valve',
    standard: 'API 6D / ASME B16.34 / IEC 60534',
    bodyStyles: 'Symmetrical Streamlined Axial Body, Internal Rack-and-Pinion Sleeve Mechanism',
    seatType: 'Multi-stage Cage or Aerodynamic Sleeve with Resilient or Metal Shutoff',
    leakageClass: 'ANSI/FCI 70-2 Class V / Class VI',
    recoveryFactorFL: 0.92,
    criticalPressureRatioXT: 0.78,
    characteristic: 'Linear / Modified Equal Percentage with High Rangeability (100:1)',
    typicalServices: 'Gas transmission pressure regulation, gas turbine fuel letdown, high capacity underground gas storage'
  },

  // -------------------------------------------------------------
  // SAFETY & PRESSURE RELIEF VALVES (PRV / PSV / PVRV / RUPTURE DISC)
  // -------------------------------------------------------------
  'psv_spring_loaded_api526': {
    category: 'Safety/Relief',
    type: 'Flanged Spring-Loaded Safety Relief Valve',
    standard: 'API 526 / ASME Section VIII Div 1',
    bodyStyles: 'Angle Body Flanged Inlet x Expanded Outlet (Orifices D through T)',
    seatType: 'Metal-to-Metal or O-Ring Resilient Soft Seat',
    leakageClass: 'API 527 (Seat tightness within 90% of set pressure)',
    recoveryFactorFL: 0.95,
    criticalPressureRatioXT: 0.75,
    characteristic: 'Pop Action (Gases) / Proportional Lift (Liquids)',
    typicalServices: 'Overpressure protection for pressure vessels, columns, exchangers'
  },
  'psv_pilot_operated_api526': {
    category: 'Safety/Relief',
    type: 'Pilot-Operated Pressure Relief Valve (POPRV)',
    standard: 'API 526 / API 520 / ASME Section VIII',
    bodyStyles: 'Main Valve Angle Body + Non-Flowing Snap/Modulating Pilot',
    seatType: 'Resilient Soft Seat on Main Piston',
    leakageClass: 'Bubble-tight up to 98% of set pressure',
    recoveryFactorFL: 0.95,
    criticalPressureRatioXT: 0.78,
    characteristic: 'Modulating (opens proportionally to overpressure) or Snap Action',
    typicalServices: 'Cryogenic storage tanks, high backpressure flare headers, compressor discharge'
  },
  'pvrv_breather_api2000': {
    category: 'Safety/Relief',
    type: 'Pressure/Vacuum Relief Breather Valve (PVRV)',
    standard: 'API 2000 / ISO 28300',
    bodyStyles: 'Flanged Inlet x Weatherhood Exhaust, Dual Pallet Guided Design',
    seatType: 'Precision Machined Metal Pallet with FEP / PTFE / Viton Cushion Diaphragm',
    leakageClass: 'API 2000 Section 5.4 (Tightness: < 1.0 SCFH at 75% of set point)',
    recoveryFactorFL: 0.95,
    criticalPressureRatioXT: 0.80,
    characteristic: 'Direct Spring or Dead-Weight Loaded Proportional Breather Action',
    typicalServices: 'Atmospheric and low-pressure storage tanks, LNG storage tank blanket breathing, condensate tanks'
  },
  'rupture_disc_asme_api520': {
    category: 'Safety/Relief',
    type: 'Non-Fragmenting Reverse-Buckling Rupture Disc Device',
    standard: 'ASME Section VIII Div 1 (UG-127) / API 520 / ISO 4126-2',
    bodyStyles: 'Pre-torqued Insert Holder between Standard ASME B16.5 Flanges',
    seatType: 'Solid Metal (Hastelloy C276, Inconel, 316L) with Laser Score Line',
    leakageClass: 'Zero Leakage (Hermetic static metal membrane prior to burst)',
    recoveryFactorFL: 0.98,
    criticalPressureRatioXT: 0.85,
    characteristic: 'Full Bore Instantaneous Rupture (<2 ms opening)',
    typicalServices: 'Primary overpressure protection, isolation of corrosive fluid from PSV inlet, rapid runaway reaction relief'
  }
};

module.exports = {
  VALVE_TAXONOMY_CATALOG
};
