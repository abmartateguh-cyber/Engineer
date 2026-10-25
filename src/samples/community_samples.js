/**
 * Illustrative synthetic sample templates for exercising the workbench UI.
 * These are not real projects, sourced engineering data, or validated workflows.
 */

const COMMUNITY_SAMPLES = [
  {
    id: 'sample_nasa_space_launch_system',
    title: 'Two-Stage Launch Vehicle (Illustrative Geometry Template)',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Synthetic vehicle parameters for exercising the aerospace viewport. Geometry and values are illustrative; no NASA source, propulsion analysis, or flight validation is included.',
    tags: ['Synthetic example', 'Experimental', 'Aerospace viewport'],
    cadParams: { type: 'illustrative_launch_vehicle_geometry', mode: 'full_stack' }
  },
  {
    id: 'sample_smartphone_flagship',
    title: 'Phone Enclosure (Illustrative Geometry)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'Synthetic enclosure geometry for the workbench. Drop estimates are experimental; handset thermal analysis is unavailable.',
    tags: ['Synthetic example', 'Experimental', 'CAD'],
    cadParams: { type: 'box', width: 75, height: 8.2, depth: 160 },
    dropParams: { dropHeight: 1.5, phoneMass: 0.205, impactAngle: 'corner' },
    pcbLayers: 14
  },
  {
    id: 'sample_wearable_smartwatch',
    title: 'Wearable Enclosure (Illustrative Geometry)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'Synthetic enclosure geometry for exercising the consumer workbench. No ingress-protection or thermal qualification is represented.',
    tags: ['Synthetic example', 'Experimental', 'CAD'],
    cadParams: { type: 'cylinder', radius: 21, height: 10.5 },
    dropParams: { dropHeight: 1.0, phoneMass: 0.055, impactAngle: 'face' },
    pcbLayers: 8
  },
  {
    id: 'sample_riscv_soc_tapeout',
    title: 'Small RTL Example (Experimental Synthesis Input)',
    industry: 'Semiconductor & EDA',
    studio: 'eda',
    description: 'A small Verilog example for exercising parser and synthesis screens. It is not a complete CPU, foundry flow, DRC/LVS result, or signoff artifact.',
    tags: ['Synthetic example', 'Experimental', 'RTL'],
    verilogSource: `module riscv_alu (\n  input clk, input [31:0] a, input [31:0] b, input [3:0] alu_op,\n  output reg [31:0] y, output reg zero\n);\n  always @(posedge clk) begin\n    case (alu_op)\n      4'b0000: y <= a + b;\n      4'b0001: y <= a - b;\n      4'b0010: y <= a & b;\n      4'b0011: y <= a | b;\n      default: y <= a ^ b;\n    endcase\n    zero <= (y == 0);\n  end\nendmodule`,
    drcRules: { minWidth: 50, minSpacing: 45 },
    targetClockMHz: 250
  },
  {
    id: 'sample_cmos_image_sensor',
    title: 'Simple Sequential Logic Example (Experimental EDA Input)',
    industry: 'Semiconductor & EDA',
    studio: 'eda',
    description: 'A small Verilog snippet for exercising EDA screens. It does not model an image sensor, transistor-level circuit, or verified layout.',
    tags: ['Synthetic example', 'Experimental', 'RTL'],
    verilogSource: `module pixel_readout (\n  input rst, input tx_pulse,\n  output reg v_out\n);\n  always @(posedge tx_pulse) begin\n    v_out <= ~rst;\n  end\nendmodule`,
    drcRules: { minWidth: 65, minSpacing: 60 },
    targetClockMHz: 100
  },
  {
    id: 'sample_quadcopter_fpv_carbon',
    title: 'Synthetic Quadcopter Geometry Template',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Synthetic dimensions and flight inputs for exercising aerospace screens. The example does not provide correlated CFD or flight-control evidence.',
    tags: ['Synthetic example', 'Experimental', 'Controls'],
    cadParams: { type: 'illustrative_quadcopter_geometry' }
  },
  {
    id: 'sample_vtol_hybrid_delivery',
    title: 'Synthetic Airframe Geometry Template',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Synthetic airframe and flight inputs for exercising aerospace screens. No aerodynamic correlation or flight envelope is established.',
    tags: ['Synthetic example', 'Experimental', 'Controls'],
    cadParams: { type: 'illustrative_airframe_geometry' }
  },
  {
    id: 'sample_crude_distillation_unit',
    title: 'Process Stream Inputs (Illustrative, Not a Distillation Model)',
    industry: 'Oil & Gas',
    studio: 'oilgas',
    description: 'Synthetic composition and flow inputs for the plant workbench using supported component names. This is not a crude assay; no column model or product-yield calculation is provided.',
    tags: ['Synthetic example', 'Experimental', 'Process inputs'],
    processParams: { feedBPD: 50000, trayCount: 30, refluxRatio: 2.6 },
    feedComposition: { Methane: 0.05, Ethane: 0.08, Propane: 0.12, nButane: 0.15, nPentane: 0.3, nHexane: 0.3 }
  },
  {
    id: 'sample_offshore_piping_manifold',
    title: 'Piping Parameters (Illustrative Stress-Screening Inputs)',
    industry: 'Oil & Gas',
    studio: 'oilgas',
    description: 'Synthetic piping parameters for exercising input screens. They do not establish code compliance, pressure integrity, or a comparison to commercial piping tools.',
    tags: ['Synthetic example', 'Experimental', 'Piping inputs'],
    pipingParams: {
      pipeOuterDiameterMm: 219.1,
      nominalWallThicknessMm: 8.18,
      youngsModulusGPa: 200.0,
      thermalExpansionPerK: 1.2e-5,
      designPressureBar: 30.0,
      operatingTempC: 240.0,
      ambientTempC: 20.0,
      straightLengthM: 40.0,
      corrosionAllowanceMm: 1.6,
      hasExpansionLoop: true,
      loopHeightM: 4.8,
      elbowCenterlineRadiusM: 0.32865
    }
  },
  {
    id: 'sample_camera_lens_50mm',
    title: '50 mm Lens Inputs (Illustrative Optics Template)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'Synthetic focal-length and aperture inputs for exercising optics screens. No sourced prescription, glass catalog, measured performance, or validated ray-trace result is included.',
    tags: ['Synthetic example', 'Experimental', 'Optics inputs'],
    cadParams: { type: 'camera_lens', focalLengthMm: 50.0, fStop: 1.4, cutawayAngle: 1.5708, showRays: true },
    opticsParams: { focalLengthMm: 50.0, fStop: 1.4, subjectDistM: 2.0 },
    pcbLayers: 4
  },
  {
    id: 'sample_raptor_propulsion_stand',
    title: 'Illustrative Engine-Stand Geometry Template',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Synthetic parameters for exercising the aerospace viewport. This is not a real engine model and contains no propulsion, CFD, thermal, or flight validation.',
    tags: ['Synthetic example', 'Experimental', 'Aerospace viewport'],
    cadParams: { type: 'illustrative_engine_stand_geometry' }
  }
];

for (const sample of COMMUNITY_SAMPLES) {
  sample.sampleType = 'synthetic-example';
  sample.validationLevel = 'experimental';
  sample.provenance = 'Illustrative inputs; no independent source or validation';
}

if (typeof window !== 'undefined') {
  window.COMMUNITY_SAMPLES = COMMUNITY_SAMPLES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMMUNITY_SAMPLES };
}
