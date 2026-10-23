/**
 * OmniEng Curated Community Sample Projects & Industrial Reference Catalog
 * Contains 8 turnkey real-world projects ready to load, inspect, simulate, and edit with AI or manual controls.
 */

const COMMUNITY_SAMPLES = [
  {
    id: 'sample_nasa_space_launch_system',
    title: 'NASA Space Launch System & Engine (CEA Thermochemistry, WBS 06 Digital Twin & Trajectory)',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'High-detail NASA 2-stage orbital launch vehicle digital twin with Al-Li 2195 isogrid cryogenic tanks, octaweb 9-engine cluster, macro staged combustion turbopumps, coaxial injector dome, Bartz Narloy-Z cooling channels, and NASA WBS 06.01-06.08 subsystem entities.',
    tags: ['NASA SLS', 'NASA CEA', 'NASA-SP-125', 'Bartz Cooling', 'Euler Turbopumps', 'WBS 06 Entities', 'Tsiolkovsky Staging'],
    cadParams: { type: 'nasa_space_rocket', mode: 'full_stack', vehicleHeightM: 70.0, coreDiameterM: 4.0 },
    cfdParams: { chamberPressureBar: 300.0, mixtureRatio: 3.4, expansionRatio: 40.0, seaLevelIsp: 324.5, vacuumIsp: 382.4 },
    gncParams: { liftoffThrustKn: 19890.0, grossLiftoffMassKg: 1420000.0, payloadToLeoKg: 22500.0, netDeltaVMps: 9450.0 }
  },
  {
    id: 'sample_smartphone_flagship',
    title: 'Flagship Smartphone (CAD, Drop Test & Vapor Chamber Thermal)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'High-density smartphone chassis with triple camera barrel, 1.5m drop test explicit FEA, and vapor chamber thermal dissipation.',
    tags: ['PTC Creo', 'Ansys Mechanical', 'Ansys Icepak', 'SolidWorks'],
    cadParams: { type: 'box', width: 75, height: 8.2, depth: 160, material: 'Titanium Grade 5' },
    dropParams: { dropHeight: 1.5, phoneMass: 0.205, impactAngle: 'corner' },
    thermalParams: { socPowerWatts: 8.5, hasVaporChamber: true, chassisMaterial: 'Titanium' },
    pcbLayers: 14
  },
  {
    id: 'sample_wearable_smartwatch',
    title: 'Smartwatch Enclosure (Water Resistance & Thermal CHT)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'Ultra-compact wearable body with curved display stack, IP68 water pressure simulation, and wireless charging thermal dissipation.',
    tags: ['SolidWorks', 'Ansys Mechanical', 'Altium'],
    cadParams: { type: 'cylinder', radius: 21, height: 10.5, material: 'Ceramic & Aluminum' },
    dropParams: { dropHeight: 1.0, phoneMass: 0.055, impactAngle: 'face' },
    thermalParams: { socPowerWatts: 2.2, hasVaporChamber: false, chassisMaterial: 'Aluminum' },
    pcbLayers: 8
  },
  {
    id: 'sample_riscv_soc_tapeout',
    title: 'RISC-V 32-bit CPU Core (RTL Synthesis & Calibre DRC/LVS)',
    industry: 'Semiconductor & EDA',
    studio: 'eda',
    description: '32-bit RISC-V ALU & execution stage in Verilog synthesized to SkyWater 130nm standard cells with clean Calibre DRC.',
    tags: ['Synopsys Design Compiler', 'Siemens Calibre', 'Cadence Virtuoso'],
    verilogSource: `module riscv_alu (\n  input clk, input [31:0] a, input [31:0] b, input [3:0] alu_op,\n  output reg [31:0] y, output reg zero\n);\n  always @(posedge clk) begin\n    case (alu_op)\n      4'b0000: y <= a + b;\n      4'b0001: y <= a - b;\n      4'b0010: y <= a & b;\n      4'b0011: y <= a | b;\n      default: y <= a ^ b;\n    endcase\n    zero <= (y == 0);\n  end\nendmodule`,
    drcRules: { minWidth: 50, minSpacing: 45 },
    targetClockMHz: 250
  },
  {
    id: 'sample_cmos_image_sensor',
    title: 'CMOS Image Sensor Pixel Array (Custom Analog IC & Virtuoso Layout)',
    industry: 'Semiconductor & EDA',
    studio: 'eda',
    description: '4-Transistor (4T) pinned photodiode analog pixel schematic, transient transfer gate SPICE simulation, and layout verification.',
    tags: ['Cadence Virtuoso', 'Ansys RedHawk', 'Spectre SPICE'],
    verilogSource: `module pixel_readout (\n  input rst, input tx_pulse,\n  output reg v_out\n);\n  always @(posedge tx_pulse) begin\n    v_out <= ~rst;\n  end\nendmodule`,
    drcRules: { minWidth: 65, minSpacing: 60 },
    targetClockMHz: 100
  },
  {
    id: 'sample_quadcopter_fpv_carbon',
    title: 'Carbon-Fiber FPV Drone (CATIA Aero Surfacing, Rotor CFD & Simulink)',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Aerodynamic carbon fiber X-frame airframe CAD, 5-inch propeller Navier-Stokes rotor CFD, and 6-DOF closed-loop autopilot.',
    tags: ['CATIA', 'Ansys Fluent', 'MATLAB Simulink', 'Fusion 360'],
    cadParams: { type: 'box', width: 220, height: 35, depth: 220, material: 'Toray T700 Carbon Fiber' },
    cfdParams: { rpm: 8500, diameterInches: 5.1, pitchInches: 3.5 },
    gncParams: { targetAltitude: 12.0, windGustSpeed: 3.5 }
  },
  {
    id: 'sample_vtol_hybrid_delivery',
    title: 'Long-Range Hybrid VTOL Drone (Aerodynamics & Transition GNC)',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Tilt-rotor delivery UAV with high-lift NACA 2412 wing surfacing, transition hover-to-cruise CFD, and flight state machine.',
    tags: ['CATIA Aero', 'STAR-CCM+', 'Simulink GNC'],
    cadParams: { type: 'cylinder', radius: 45, height: 1200, material: 'Composite Sandwich' },
    cfdParams: { rpm: 6000, diameterInches: 16.0, pitchInches: 8.0 },
    gncParams: { targetAltitude: 50.0, windGustSpeed: 6.0 }
  },
  {
    id: 'sample_crude_distillation_unit',
    title: 'Atmospheric Crude Distillation Column (Aspen HYSYS Process Simulation)',
    industry: 'Oil & Gas',
    studio: 'oilgas',
    description: '50,000 BPD crude petroleum refinery fractionation column, Peng-Robinson VLE flash, and product draw optimization.',
    tags: ['Aspen HYSYS', 'AutoCAD Plant 3D'],
    processParams: { feedBPD: 50000, trayCount: 30, refluxRatio: 2.6 },
    feedComposition: { Methane: 0.05, Ethane: 0.08, Propane: 0.12, nButane: 0.15, Naphtha: 0.22, Kerosene: 0.18, Diesel: 0.20 }
  },
  {
    id: 'sample_offshore_piping_manifold',
    title: 'Offshore Platform High-Pressure Piping Loop (Caesar II / AutoPIPE Stress)',
    industry: 'Oil & Gas',
    studio: 'oilgas',
    description: '8-inch Class 300 offshore steam & crude manifold pipeline evaluating ASME B31.3 thermal expansion loops and pressure surge.',
    tags: ['Bentley AutoPIPE', 'Caesar II', 'Aveva E3D'],
    pipingParams: { pipeSpec: '8_SCH40', materialKey: 'A106-B', designPressureBar: 30.0, operatingTempC: 240.0, straightLengthM: 40.0, hasExpansionLoop: true }
  },
  {
    id: 'sample_camera_lens_50mm',
    title: '50mm f/1.4 Aspherical Multi-Element Camera Lens (Creo / NX Optomechanics & Cutaway)',
    industry: 'Consumer Electronics',
    studio: 'consumer',
    description: 'High-precision optomechanical lens assembly showcasing internal 8-element 6-group optics (Schott Crown/Flint & CaF2 Fluorite), 9-blade dynamic iris aperture diaphragm, VCM focus helicoids, matte light baffles, full-frame sensor plane, and paraxial ray tracing.',
    tags: ['PTC Creo Optomechanics', 'Siemens NX', 'Zemax Optics', '3D Cutaway Inspection', 'Schott Glass'],
    cadParams: { type: 'camera_lens', focalLengthMm: 50.0, fStop: 1.4, cutawayAngle: 1.5708, showRays: true },
    opticsParams: { focalLengthMm: 50.0, fStop: 1.4, subjectDistM: 2.0 },
    pcbLayers: 4
  },
  {
    id: 'sample_raptor_propulsion_stand',
    title: 'Raptor Vacuum Test Stand & Supersonic Plume (CFD, STOP Multiphysics & Shock Diamonds)',
    industry: 'Drone & Aerospace',
    studio: 'aerospace',
    description: 'Full-scale methane-LOX staged combustion rocket engine stand featuring regeneratively cooled nozzle, hydraulic gimbal actuator, supersonic shock diamond exhaust plume shader, and STOP coupled thermal deflections.',
    tags: ['SpaceX Raptor', 'Zemax STOP', 'Ansys Fluent', 'Supersonic Shock Diamonds', 'NASA CEA'],
    cadParams: { type: 'raptor_test_stand', nozzleRadiusM: 1.2, chamberPressureBar: 300.0 },
    cfdParams: { machNumber: 2.8, shockDiamonds: 4 },
    gncParams: { gimbalAngleDeg: 4.5, thrustKn: 2200.0 }
  }
];

if (typeof window !== 'undefined') {
  window.COMMUNITY_SAMPLES = COMMUNITY_SAMPLES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMMUNITY_SAMPLES };
}

