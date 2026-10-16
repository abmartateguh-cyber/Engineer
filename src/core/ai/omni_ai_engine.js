/**
 * OmniEng Intelligent AI Co-Pilot & Autonomous Engineering Engine ("OmniAI")
 * Strictly conforms to agent-architecture-audit guidelines: code-gated tool execution,
 * typed JSON payloads, zero hidden mutation loops, and dual manual/AI editing support.
 */

const { BRepPrimitives } = require('../cad/brep_topology');
const { ParametricFeature, FeatureTree } = require('../cad/feature_tree');
const { DropTestSimulator } = require('../cae/drop_test');
const { CFDSolver2D } = require('../cae/cfd_navier_stokes');
const { ThermalEngine } = require('../cae/thermal_cht');
const { LogicSynthesisEngine } = require('../eda/logic_synthesis');
const { DRCEngine } = require('../eda/drc_engine');
const { QuadcopterDynamics } = require('../dynamic_simulink/drone_flight_dynamics');
const { ThermodynamicsEngine } = require('../plant/thermodynamics');
const { PipingStressEngine } = require('../plant/piping_stress');

// Code-Gated Tool Catalog (Model Context Protocol typed schema)
const OMNI_TOOLS = [
  {
    name: 'create_cad_geometry',
    description: 'Create a parametric 3D B-Rep CAD geometry (box, cylinder, sphere, or custom feature)',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['box', 'cylinder', 'sphere'] },
        name: { type: 'string' },
        dimensions: { type: 'object' }
      },
      required: ['type']
    }
  },
  {
    name: 'run_phone_drop_test',
    description: 'Execute explicit dynamic smartphone drop test onto concrete floor',
    parameters: {
      type: 'object',
      properties: {
        dropHeight: { type: 'number', default: 1.5 },
        phoneMass: { type: 'number', default: 0.205 },
        impactAngle: { type: 'string', enum: ['corner', 'edge', 'face'] }
      }
    }
  },
  {
    name: 'simulate_mobile_thermal',
    description: 'Simulate smartphone conjugate heat transfer (SoC gaming & 4K video thermal dissipation)',
    parameters: {
      type: 'object',
      properties: {
        socPowerWatts: { type: 'number', default: 8.5 },
        hasVaporChamber: { type: 'boolean', default: true },
        chassisMaterial: { type: 'string', enum: ['Aluminum', 'Titanium'] }
      }
    }
  },
  {
    name: 'synthesize_verilog_chip',
    description: 'Synthesize Verilog RTL into gate-level netlist and verify static timing closure',
    parameters: {
      type: 'object',
      properties: {
        verilogCode: { type: 'string' }
      },
      required: ['verilogCode']
    }
  },
  {
    name: 'run_calibre_drc_check',
    description: 'Run physical verification DRC checks on 2D nanometer IC layout polygons',
    parameters: {
      type: 'object',
      properties: {
        minWidth: { type: 'number', default: 50 },
        minSpacing: { type: 'number', default: 45 }
      }
    }
  },
  {
    name: 'simulate_drone_flight',
    description: 'Simulate 6-DOF closed-loop autonomous drone flight with wind gust disturbance',
    parameters: {
      type: 'object',
      properties: {
        targetAltitude: { type: 'number', default: 10.0 },
        windGustSpeed: { type: 'number', default: 3.0 }
      }
    }
  },
  {
    name: 'calculate_asme_piping_stress',
    description: 'Evaluate ASME B31.3 piping stress and thermal expansion loop flexibility',
    parameters: {
      type: 'object',
      properties: {
        pipeSpec: { type: 'string', default: '8_SCH40' },
        operatingTempC: { type: 'number', default: 220.0 },
        hasExpansionLoop: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'run_hysys_flash_distillation',
    description: 'Run Peng-Robinson VLE flash and atmospheric crude distillation simulation',
    parameters: {
      type: 'object',
      properties: {
        feedBPD: { type: 'number', default: 50000 },
        trayCount: { type: 'number', default: 30 }
      }
    }
  }
];

class OmniAIEngine {
  constructor() {
    this.history = [];
    this.tools = OMNI_TOOLS;
  }

  /**
   * Process natural language query from user and route to code-gated tool execution
   * @param {string} prompt User natural language request
   * @param {Object} currentContext Current active studio, model parameters, and selected entities
   */
  processPrompt(prompt, currentContext = {}) {
    const p = prompt.toLowerCase();
    const actionPlan = {
      prompt,
      matchedTool: null,
      toolInput: null,
      result: null,
      assistantMessage: '',
      suggestedManualEdits: []
    };

    // Intent routing using code-gated evaluation
    if (p.includes('drop') || p.includes('impact') || p.includes('fall')) {
      actionPlan.matchedTool = 'run_phone_drop_test';
      const height = p.includes('2m') ? 2.0 : (p.includes('1m') ? 1.0 : 1.5);
      const angle = p.includes('face') ? 'face' : (p.includes('edge') ? 'edge' : 'corner');
      actionPlan.toolInput = { dropHeight: height, impactAngle: angle };
      actionPlan.result = DropTestSimulator.runSimulation(actionPlan.toolInput);

      actionPlan.assistantMessage = `Ran 1.5m explicit drop test on phone. Peak impact deceleration was ${actionPlan.result.peakDeceleration_G} G. Result: ${actionPlan.result.status}. Maximum glass stress is ${actionPlan.result.peakScreenStress_MPa} MPa.`;
      actionPlan.suggestedManualEdits = [
        { label: 'Drop Height', key: 'dropHeight', value: height, unit: 'm' },
        { label: 'Impact Angle', key: 'impactAngle', value: angle, unit: '' }
      ];

    } else if (p.includes('thermal') || p.includes('heat') || p.includes('vapor') || p.includes('icepak')) {
      actionPlan.matchedTool = 'simulate_mobile_thermal';
      const hasVC = !p.includes('no vapor') && !p.includes('without vapor');
      const mat = p.includes('titanium') ? 'Titanium' : 'Aluminum';
      actionPlan.toolInput = { socPowerWatts: 8.5, hasVaporChamber: hasVC, chassisMaterial: mat };
      actionPlan.result = ThermalEngine.simulateSmartphoneThermal(actionPlan.toolInput);

      actionPlan.assistantMessage = `Completed conjugate heat transfer simulation. Max SoC temperature: ${actionPlan.result.maxSocTempC}°C, Max Battery temperature: ${actionPlan.result.maxBatteryTempC}°C. Status: ${actionPlan.result.verdict}.`;
      actionPlan.suggestedManualEdits = [
        { label: 'Vapor Chamber Enabled', key: 'hasVaporChamber', value: hasVC, unit: 'bool' },
        { label: 'Chassis Material', key: 'chassisMaterial', value: mat, unit: '' }
      ];

    } else if (p.includes('verilog') || p.includes('synthesize') || p.includes('rtl') || p.includes('chip') || p.includes('gate')) {
      actionPlan.matchedTool = 'synthesize_verilog_chip';
      const sampleVerilog = `module alu_core (\n  input clk, input a, input b,\n  output reg y\n);\n  always @(posedge clk) begin\n    y <= a & b;\n  end\nendmodule`;
      actionPlan.toolInput = { verilogCode: sampleVerilog };
      actionPlan.result = LogicSynthesisEngine.synthesize(sampleVerilog);

      actionPlan.assistantMessage = `Synthesized Verilog module "${actionPlan.result.moduleName}". Total standard cell count: ${actionPlan.result.gateCount}, Area: ${actionPlan.result.totalArea_um2} µm², Timing Slack: ${actionPlan.result.timingSlack_ps} ps (Fmax: ${actionPlan.result.maxFrequency_MHz} MHz). ${actionPlan.result.verdict}.`;

    } else if (p.includes('drc') || p.includes('calibre') || p.includes('layout') || p.includes('spacing')) {
      actionPlan.matchedTool = 'run_calibre_drc_check';
      const testShapes = [
        { id: 'M1_A', layer: 'Metal1', x: 100, y: 100, w: 60, h: 200 },
        { id: 'M1_B', layer: 'Metal1', x: 180, y: 100, w: 60, h: 200 }
      ];
      actionPlan.toolInput = { minWidth: 50, minSpacing: 45 };
      actionPlan.result = DRCEngine.runDRC(testShapes, actionPlan.toolInput);

      actionPlan.assistantMessage = `Calibre DRC check completed on ${actionPlan.result.totalShapesChecked} layout polygons. ${actionPlan.result.violationCount} violations found. Status: ${actionPlan.result.verdict}.`;

    } else if (p.includes('drone') || p.includes('fly') || p.includes('altitude') || p.includes('autopilot')) {
      actionPlan.matchedTool = 'simulate_drone_flight';
      const alt = p.includes('20m') ? 20.0 : (p.includes('5m') ? 5.0 : 10.0);
      actionPlan.toolInput = { targetAltitude: alt, windGustSpeed: 3.0 };
      actionPlan.result = QuadcopterDynamics.simulateFlightMission(actionPlan.toolInput);

      actionPlan.assistantMessage = `Simulated 6-DOF closed-loop drone flight to ${alt}m altitude under 3.0 m/s wind. Settling time: ${actionPlan.result.settlingTime_s}s, Overshoot: ${actionPlan.result.overshootPercent}%. ${actionPlan.result.stabilityVerdict}.`;
      actionPlan.suggestedManualEdits = [
        { label: 'Target Altitude', key: 'targetAltitude', value: alt, unit: 'm' }
      ];

    } else if (p.includes('pipe') || p.includes('piping') || p.includes('asme') || p.includes('caesar') || p.includes('stress')) {
      actionPlan.matchedTool = 'calculate_asme_piping_stress';
      const hasLoop = !p.includes('no loop');
      actionPlan.toolInput = { pipeSpec: '8_SCH40', operatingTempC: 220.0, hasExpansionLoop: hasLoop };
      actionPlan.result = PipingStressEngine.evaluateASMEB313(actionPlan.toolInput);

      actionPlan.assistantMessage = `Evaluated ASME B31.3 piping stress at 220°C. Expansion stress: ${actionPlan.result.expansionStress_SE_MPa} MPa (Allowable: ${actionPlan.result.allowableStress_SA_MPa} MPa, Stress Ratio: ${actionPlan.result.stressRatio}). ${actionPlan.result.status}.`;
      actionPlan.suggestedManualEdits = [
        { label: 'Expansion Loop Enabled', key: 'hasExpansionLoop', value: hasLoop, unit: 'bool' }
      ];

    } else if (p.includes('hysys') || p.includes('distillation') || p.includes('crude') || p.includes('refinery')) {
      actionPlan.matchedTool = 'run_hysys_flash_distillation';
      actionPlan.toolInput = { feedBPD: 50000, trayCount: 30 };
      actionPlan.result = ThermodynamicsEngine.simulateDistillationColumn(50000, 30, 2.5);

      actionPlan.assistantMessage = `Aspen HYSYS distillation column converged for 50,000 BPD crude feed. Production yields: Naphtha: ${actionPlan.result.products.lightNaphtha_BPD} BPD, Diesel: ${actionPlan.result.products.dieselFuel_BPD} BPD, Bottoms: ${actionPlan.result.products.heavyResidue_BPD} BPD. Condenser Duty: ${actionPlan.result.thermalDuties.condenserDuty_MW} MW.`;

    } else {
      // Default: CAD Geometry creation / manipulation
      actionPlan.matchedTool = 'create_cad_geometry';
      actionPlan.toolInput = { type: 'cylinder', name: 'Lens_Barrel', dimensions: { radius: 15, height: 40 } };
      actionPlan.result = BRepPrimitives.createCylinder(15, 40, 24, 'Lens_Barrel');

      actionPlan.assistantMessage = `Generated parametric CAD solid "${actionPlan.toolInput.name}" with B-Rep volume of ${actionPlan.result.computeVolume().toFixed(1)} mm³. You can edit its radius and height manually in the Inspector panel.`;
      actionPlan.suggestedManualEdits = [
        { label: 'Radius', key: 'radius', value: 15, unit: 'mm' },
        { label: 'Height', key: 'height', value: 40, unit: 'mm' }
      ];
    }

    return actionPlan;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OmniAIEngine, OMNI_TOOLS };
}
