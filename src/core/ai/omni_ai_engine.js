/**
 * Legacy OmniAI keyword-macro adapter.
 * Routes selected prompts to experimental calculations with caller-supplied
 * inputs; it is not an autonomous engineering agent and does not establish
 * independent validation.
 */

const { DropTestSimulator } = require('../cae/drop_test');
const { LogicSynthesisEngine } = require('../eda/logic_synthesis');
const { PipingStressEngine } = require('../plant/piping_stress');
const { OpticalEngine } = require('../optics/optical_engine');
const { CommandJournal } = require('../storage/omni_archive');
const { trainSurrogate, predictSurrogate } = require('./neural_net');
const {
  DropTestWizard,
  DroneDesignWizard,
  CameraLensWizard,
  PCBDesignWizard
} = require('../../ui/wizards/design_wizards');

function parseDropTestInputs(prompt) {
  const heightMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\b/i);
  const massMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?)\b/i);
  const lowerPrompt = prompt.toLowerCase();
  const impactAngle = /\bcorner\b/.test(lowerPrompt)
    ? 'corner'
    : /\bedge\b/.test(lowerPrompt)
      ? 'edge'
      : /\b(?:face|flat)\b/.test(lowerPrompt)
        ? 'face'
        : null;

  return {
    dropHeightM: heightMatch ? Number(heightMatch[1]) : null,
    phoneMassKg: massMatch ? Number(massMatch[1]) / (/^(?:g|grams?)$/i.test(massMatch[2]) ? 1000 : 1) : null,
    impactAngle
  };
}

function missingDropTestInputs(inputs) {
  const missing = [];
  if (!Number.isFinite(inputs.dropHeightM) || inputs.dropHeightM <= 0) missing.push('drop height (m)');
  if (!Number.isFinite(inputs.phoneMassKg) || inputs.phoneMassKg <= 0) missing.push('device mass (kg or g)');
  if (!['corner', 'edge', 'face'].includes(inputs.impactAngle))
    missing.push('impact orientation (corner, edge, or face)');
  return missing;
}

function invalidDropTestResult(missing) {
  return {
    status: 'INVALID_INPUT',
    validationLevel: 'experimental',
    error: {
      code: 'INVALID_INPUT',
      message: `No impact estimate was run. Specify ${missing.join(', ')}.`
    }
  };
}

function parseOpticalInputs(prompt) {
  const labeledFocalLengthMatch = prompt.match(/\bfocal\s+length\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*mm\b/i);
  const focalLengthCandidates = [...prompt.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/gi)];
  const focalLengthMatch =
    labeledFocalLengthMatch ||
    focalLengthCandidates.find((match) => {
      const before = prompt.slice(Math.max(0, match.index - 30), match.index);
      const after = prompt.slice(match.index + match[0].length, match.index + match[0].length + 30);
      return (
        !/circle\s+of\s+confusion\s*(?:is|of|=|:)?\s*$/i.test(before) && !/^\s*circle\s+of\s+confusion\b/i.test(after)
      );
    });
  const fStopMatch =
    prompt.match(/\bf\s*\/\s*(\d+(?:\.\d+)?)\b/i) || prompt.match(/\bf[\s-]*stop\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\b/i);
  const subjectDistanceMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\b/i);
  const wavelengthMatch =
    prompt.match(/\bwavelength\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*(nm|um|µm|μm)\b/i) ||
    prompt.match(/\b(\d+(?:\.\d+)?)\s*(nm|um|µm|μm)\s+wavelength\b/i);
  const circleOfConfusionMatch =
    prompt.match(/\bcircle\s+of\s+confusion\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\b/i) ||
    prompt.match(/\b(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\s+circle\s+of\s+confusion\b/i);
  const wavelengthUnit = wavelengthMatch?.[2].toLowerCase();
  const circleOfConfusionUnit = circleOfConfusionMatch?.[2].toLowerCase();
  return {
    focalLengthMm: focalLengthMatch ? Number(focalLengthMatch[1]) : null,
    fStop: fStopMatch ? Number(fStopMatch[1]) : null,
    subjectDistM: subjectDistanceMatch ? Number(subjectDistanceMatch[1]) : null,
    wavelengthNm: wavelengthMatch ? Number(wavelengthMatch[1]) * (wavelengthUnit === 'nm' ? 1 : 1000) : null,
    circleOfConfusionMm: circleOfConfusionMatch
      ? Number(circleOfConfusionMatch[1]) * (circleOfConfusionUnit === 'mm' ? 1 : 0.001)
      : null
  };
}

function parseVerilogCode(prompt) {
  const match = prompt.match(/```(?:verilog|systemverilog|sv)\s*([\s\S]*?)```/i);
  const source = match ? match[1].trim() : '';
  return source.length > 0 ? source : null;
}

function missingOpticalInputs(inputs) {
  const missing = [];
  if (!Number.isFinite(inputs.focalLengthMm) || inputs.focalLengthMm <= 0) missing.push('focal length (mm)');
  if (!Number.isFinite(inputs.fStop) || inputs.fStop <= 0) missing.push('f-number (for example f/2.8)');
  if (!Number.isFinite(inputs.subjectDistM) || inputs.subjectDistM <= 0) missing.push('subject distance (m)');
  if (!Number.isFinite(inputs.wavelengthNm) || inputs.wavelengthNm <= 0) missing.push('wavelength (nm or µm)');
  if (!Number.isFinite(inputs.circleOfConfusionMm) || inputs.circleOfConfusionMm <= 0) {
    missing.push('circle of confusion (mm or µm)');
  }
  return missing;
}

function parsePcbWizardInputs(prompt) {
  const layerMatch =
    prompt.match(/\b(\d+)\s*[- ]?layers?\b/i) || prompt.match(/\blayer\s*count\s*(?:of|=|:)?\s*(\d+)\b/i);
  const impedanceMatch =
    prompt.match(/\b(?:target\s+)?impedance\s*(?:of|at|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:ohms?\b|Ω)/i) ||
    prompt.match(/\b(\d+(?:\.\d+)?)\s*(?:ohms?\b|Ω)/i);
  const dielectricMatch =
    prompt.match(
      /\b(?:dielectric|substrate)(?:\s+(?:height|thickness))?\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\b/i
    ) || prompt.match(/\b(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\s*(?:dielectric|substrate)\b/i);
  const erMatch = prompt.match(/\b(?:er|relative permittivity|dielectric constant)\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\b/i);
  const copperMatch =
    prompt.match(/\bcopper(?:\s+thickness)?\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\b/i) ||
    prompt.match(/\b(\d+(?:\.\d+)?)\s*(mm|um|µm|μm)\s+copper(?:\s+thickness)?\b/i);
  const toMm = (match) => {
    if (!match) return null;
    const value = Number(match[1]);
    return /^mm$/i.test(match[2]) ? value : value / 1000;
  };
  return {
    layerCount: layerMatch ? Number(layerMatch[1]) : null,
    dielectricHeightMm: toMm(dielectricMatch),
    targetImpedanceOhm: impedanceMatch ? Number(impedanceMatch[1]) : null,
    er: erMatch ? Number(erMatch[1]) : null,
    copperThicknessMm: toMm(copperMatch)
  };
}

function missingPcbWizardInputs(inputs) {
  const missing = [];
  if (!Number.isInteger(inputs.layerCount) || inputs.layerCount < 1) missing.push('layer count');
  if (!Number.isFinite(inputs.dielectricHeightMm) || inputs.dielectricHeightMm <= 0)
    missing.push('dielectric height (mm)');
  if (!Number.isFinite(inputs.targetImpedanceOhm) || inputs.targetImpedanceOhm <= 0)
    missing.push('target impedance (ohm)');
  if (!Number.isFinite(inputs.er) || inputs.er <= 0) missing.push('relative permittivity (er)');
  if (!Number.isFinite(inputs.copperThicknessMm) || inputs.copperThicknessMm <= 0)
    missing.push('copper thickness (mm)');
  return missing;
}

function invalidRequiredInputs(missing) {
  return {
    status: 'INVALID_INPUT',
    validationLevel: 'experimental',
    error: {
      code: 'INVALID_INPUT',
      message: `No estimate was run. Specify ${missing.join(', ')}.`
    }
  };
}

// Code-Gated Tool Catalog (Model Context Protocol typed schema)
const OMNI_TOOLS = [
  {
    name: 'design_camera_lens_optics',
    description:
      'Run experimental scalar optics estimates from explicit focal length, f-number, subject distance, wavelength, and circle of confusion; no sourced prescription or independently validated optical result is established',
    parameters: {
      type: 'object',
      properties: {
        focalLengthMm: { type: 'number', exclusiveMinimum: 0 },
        fStop: { type: 'number', exclusiveMinimum: 0 },
        subjectDistM: { type: 'number', exclusiveMinimum: 0 },
        wavelengthNm: { type: 'number', exclusiveMinimum: 0 },
        circleOfConfusionMm: { type: 'number', exclusiveMinimum: 0 },
        showRays: { type: 'boolean' },
        cutawayAngle: { type: 'number' }
      },
      required: ['focalLengthMm', 'fStop', 'subjectDistM', 'wavelengthNm', 'circleOfConfusionMm']
    }
  },
  {
    name: 'create_cad_geometry',
    description:
      'Create an experimental primitive from explicit dimensions; solid validity and manufacturability are not assessed',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['box', 'cylinder', 'sphere'] },
        name: { type: 'string' },
        dimensions: { type: 'object' }
      },
      required: ['type', 'dimensions']
    }
  },
  {
    name: 'run_phone_drop_test',
    description:
      'Run an experimental handset impact example using explicit drop height (m), device mass (kg), and impact orientation; it is not independently validated',
    parameters: {
      type: 'object',
      properties: {
        dropHeight: { type: 'number', description: 'Drop height in meters' },
        phoneMass: { type: 'number', description: 'Device mass in kilograms' },
        impactAngle: { type: 'string', enum: ['corner', 'edge', 'face'], description: 'Impact orientation' }
      },
      required: ['dropHeight', 'phoneMass', 'impactAngle']
    }
  },
  {
    name: 'simulate_mobile_thermal',
    description:
      'Return thermal-analysis availability; no reviewed handset model or material-property set is configured',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'synthesize_verilog_chip',
    description:
      'Run an experimental RTL estimate on explicitly supplied Verilog source; no target library or physical timing analysis is included',
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
    description: 'Unavailable through the legacy macro without caller layout geometry and an approved rule deck',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'simulate_drone_flight',
    description: 'Unavailable: no independently reviewed drone flight model or reference data are configured',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'calculate_asme_piping_stress',
    description:
      'Run an experimental piping estimate from explicit user-supplied values; no material catalog, code allowable, or compliance decision is provided',
    parameters: {
      type: 'object',
      properties: {
        pipeOuterDiameterMm: { type: 'number', description: 'Pipe outside diameter in mm' },
        nominalWallThicknessMm: { type: 'number', description: 'Nominal wall thickness in mm' },
        youngsModulusGPa: { type: 'number', description: 'User-supplied Young modulus in GPa' },
        thermalExpansionPerK: { type: 'number', description: 'User-supplied thermal expansion coefficient per K' },
        designPressureBar: { type: 'number', description: 'Pressure input in bar' },
        operatingTempC: { type: 'number', description: 'Operating temperature in degrees Celsius' },
        ambientTempC: { type: 'number', description: 'Ambient temperature in degrees Celsius' },
        straightLengthM: { type: 'number', description: 'Straight pipe length in m' },
        hasExpansionLoop: { type: 'boolean' },
        corrosionAllowanceMm: { type: 'number', description: 'Corrosion allowance in mm' },
        loopHeightM: { type: 'number', description: 'Expansion loop height in m' },
        elbowCenterlineRadiusM: { type: 'number', description: 'Elbow centerline radius in m' }
      },
      required: [
        'pipeOuterDiameterMm',
        'nominalWallThicknessMm',
        'youngsModulusGPa',
        'thermalExpansionPerK',
        'designPressureBar',
        'operatingTempC',
        'ambientTempC',
        'straightLengthM',
        'hasExpansionLoop',
        'corrosionAllowanceMm',
        'loopHeightM',
        'elbowCenterlineRadiusM'
      ]
    }
  },
  {
    name: 'run_hysys_flash_distillation',
    description: 'Unavailable: no sourced assay and validated distillation model are configured',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'solve_skew_optics',
    description: 'Unavailable through the legacy macro without a caller-supplied optical prescription and ray set',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'solve_spice_circuit',
    description: 'Unavailable through the legacy macro without a caller-supplied circuit and analysis controls',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'solve_flowsheet',
    description: 'Unavailable: the legacy macro route has no validated user-provided flowsheet schema',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_step',
    description:
      'Unavailable through the legacy macro without caller-supplied geometry; schema conformance and CAD interoperability are unverified',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_gerber',
    description: 'Unavailable through the legacy macro without caller-supplied PCB layout data',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'run_design_wizard',
    description:
      'Open an experimental workflow only after required caller inputs are supplied; results are not approved designs',
    parameters: {
      type: 'object',
      properties: {
        wizardType: { type: 'string', enum: ['drop_test', 'drone', 'camera_lens', 'pcb'] },
        inputs: { type: 'object' }
      },
      required: ['wizardType', 'inputs']
    }
  },
  {
    name: 'self_heal_design',
    description:
      'Unavailable: structural remediation has no independent validation or approval workflow; no design edits are proposed',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'package_omni_archive',
    description:
      'Export supplied session sections in a .omni container; this does not create a complete project archive or establish round-trip validity',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'solve_variational_sketch',
    description: 'Run an experimental 2D constraint calculation on caller-supplied points, constraints, and controls',
    parameters: {
      type: 'object',
      properties: {
        points: { type: 'array' },
        constraints: { type: 'array' },
        controls: { type: 'object' }
      },
      required: ['points', 'constraints', 'controls']
    }
  },
  {
    name: 'heal_cad_geometry',
    description: 'Unavailable through the legacy macro without caller-supplied geometry and healing controls',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'optimize_optical_dls',
    description:
      'Run an experimental optimizer on a caller-supplied optical system, variables, merit operands, and controls',
    parameters: {
      type: 'object',
      properties: {
        system: { type: 'object' },
        variables: { type: 'array' },
        operands: { type: 'array' },
        options: { type: 'object' }
      },
      required: ['system', 'variables', 'operands', 'options']
    }
  },
  {
    name: 'evaluate_asme_section_viii',
    description:
      'Unavailable through the prompt macro without caller stress-line data and review limits; no ASME Section VIII assessment is made',
    parameters: {
      type: 'object',
      properties: {
        sclPoints: { type: 'array' },
        wallThicknessMm: { type: 'number' },
        reviewLimits: { type: 'object' }
      },
      required: ['sclPoints', 'wallThicknessMm', 'reviewLimits']
    }
  },
  {
    name: 'diff_3d_cad_models',
    description:
      'Compare caller-supplied model revisions using an experimental centroid heuristic; no B-Rep, volume, or structural comparison is performed',
    parameters: {
      type: 'object',
      properties: {
        modelA: { type: 'object' },
        modelB: { type: 'object' }
      },
      required: ['modelA', 'modelB']
    }
  },
  {
    name: 'rollup_ebom_costs',
    description:
      'Aggregate a fully specified caller-supplied assembly hierarchy; mass, cost, material, and supplier data are not independently reviewed',
    parameters: {
      type: 'object',
      required: ['rootAssembly'],
      additionalProperties: false,
      properties: {
        rootAssembly: { type: 'object' }
      }
    }
  },
  {
    name: 'unfold_sheet_metal',
    description:
      'Calculate experimental bend allowance from caller-supplied thickness, radius, angle, K-factor, and flange lengths; standards conformance and manufacturing suitability are not assessed',
    parameters: {
      type: 'object',
      properties: {
        thicknessMm: { type: 'number' },
        bendRadiusMm: { type: 'number' },
        angleDeg: { type: 'number' },
        kFactor: { type: 'number' },
        flangeLength1Mm: { type: 'number' },
        flangeLength2Mm: { type: 'number' }
      },
      required: ['thicknessMm', 'bendRadiusMm', 'angleDeg', 'kFactor', 'flangeLength1Mm', 'flangeLength2Mm']
    }
  },
  {
    name: 'inspect_gdt_tolerance',
    description:
      'Unavailable through the prompt macro without caller datum, measurement, and tolerance inputs; no standards conformance decision is made',
    parameters: {
      type: 'object',
      properties: {
        basicX: { type: 'number' },
        basicY: { type: 'number' },
        actualX: { type: 'number' },
        actualY: { type: 'number' },
        nominalDia: { type: 'number' },
        actualDia: { type: 'number' },
        mmcDia: { type: 'number' },
        specifiedTolerance: { type: 'number' }
      },
      required: ['basicX', 'basicY', 'actualX', 'actualY', 'nominalDia', 'actualDia', 'mmcDia', 'specifiedTolerance']
    }
  },
  {
    name: 'solve_sparse_multifrontal',
    description:
      'Unavailable through the legacy macro without a caller-supplied sparse matrix, right-hand side, and controls',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'solve_gpu_parallel_pcg',
    description:
      'Unavailable through the legacy macro without a caller-supplied sparse matrix, right-hand side, and controls',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'run_fmi_cosimulation',
    description: 'Unavailable through the legacy macro without caller-supplied FMUs, connections, and controls',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'analyze_power_grid_ir_drop',
    description:
      'Unavailable through the legacy macro without caller-supplied grid geometry, electrical inputs, and solver controls; foundry signoff is not established',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'certify_tool_qualification',
    description:
      'Unavailable: DO-330 and ISO 26262 tool qualification are not implemented; test diagnostics are not qualification evidence',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_gdsii_stream',
    description: 'Unavailable through the legacy macro without caller-supplied layout geometry and export controls',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'schedule_multirate_simulation',
    description:
      'Unavailable through the legacy macro without caller-supplied components, task rates, and scheduler controls',
    parameters: { type: 'object', properties: {} }
  }
];

for (const tool of OMNI_TOOLS) {
  tool.description = `Experimental legacy macro route; no independent validation is established. ${tool.description}`;
}

function summarizeMacroInputs(value) {
  if (value === null || value === undefined) return 'none';
  const serialized = JSON.stringify(value);
  if (serialized.length <= 400) return serialized;
  return `${serialized.slice(0, 397)}...`;
}

function markLegacyMacroUnavailable(actionPlan, toolName, message, modalToOpen = null) {
  actionPlan.matchedTool = toolName;
  actionPlan.toolInput = {};
  actionPlan.inputOrigin = 'none';
  actionPlan.result = {
    success: false,
    status: 'UNAVAILABLE',
    validationLevel: 'experimental',
    error: { code: 'UNSUPPORTED', message }
  };
  actionPlan.assistantMessage = `No calculation was run. ${message}`;
  if (modalToOpen) actionPlan.modalToOpen = modalToOpen;
}

class OmniAIEngine {
  constructor() {
    this.history = [];
    this.tools = OMNI_TOOLS;
    this.journal = new CommandJournal();
    this.wizards = {
      dropTest: new DropTestWizard(),
      drone: new DroneDesignWizard(),
      lens: new CameraLensWizard(),
      pcb: new PCBDesignWizard()
    };
  }

  /**
   * Fast intent classifier for the legacy keyword macro adapter
   * @param {string} prompt
   * @returns {{matchedTool: string, modalToOpen: string|null}}
   */
  parseUserIntent(prompt) {
    const p = (prompt || '').toLowerCase();
    if (
      p.includes('self-heal') ||
      p.includes('auto-heal') ||
      p.includes('remediate') ||
      p.includes('fix stress') ||
      p.includes('thicken')
    ) {
      return { matchedTool: 'self_heal_design', modalToOpen: null };
    }
    if (p.includes('heal') || p.includes('watertight') || p.includes('micro-gap') || p.includes('sliver')) {
      return { matchedTool: 'topological_healing', modalToOpen: 'modal-topological-healer' };
    }
    if (p.includes('asme') || p.includes('section viii') || p.includes('pressure vessel') || p.includes('div 2')) {
      return { matchedTool: 'asme_viii_div2_report', modalToOpen: 'modal-asme-report' };
    }
    if (p.includes('diff') || p.includes('reva') || p.includes('revb') || p.includes('cad diff')) {
      return { matchedTool: 'git_cad_visual_diff', modalToOpen: 'modal-cad-diff' };
    }
    if (
      p.includes('ebom') ||
      p.includes('procurement') ||
      p.includes('bill of materials') ||
      p.includes('consolidate screws') ||
      p.includes('cost rollup')
    ) {
      return { matchedTool: 'engineering_bom_rollup', modalToOpen: 'modal-ebom-manager' };
    }
    const plan = this.processPrompt(prompt);
    return {
      matchedTool: plan.matchedTool,
      modalToOpen: plan.modalToOpen || null
    };
  }

  /**
   * Process a natural language prompt using explicitly supplied values only.
   * This legacy adapter does not parse or validate complete project engineering data.
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
      executionMode: 'legacy-keyword-macro',
      validationLevel: 'experimental',
      suggestedManualEdits: []
    };

    // Intent routing using code-gated evaluation
    if (
      p.includes('self-heal') ||
      p.includes('auto-heal') ||
      p.includes('remediate') ||
      p.includes('fix stress') ||
      p.includes('thicken')
    ) {
      actionPlan.matchedTool = 'self_heal_design';
      actionPlan.inputOrigin = 'none';
      actionPlan.result = {
        success: false,
        available: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: {
          code: 'UNSUPPORTED',
          message: 'Structural remediation is unavailable pending independent validation and an approval workflow.'
        }
      };
      actionPlan.assistantMessage =
        'No structural inputs were assumed, no calculation ran, and no design edits were proposed.';
    } else if (p.includes('wizard') || p.includes('guide')) {
      actionPlan.matchedTool = 'run_design_wizard';
      if (p.includes('drone') || p.includes('uav')) {
        actionPlan.toolInput = { wizardType: 'drone' };
        actionPlan.result = {
          status: 'UNAVAILABLE',
          validationLevel: 'experimental',
          error: {
            code: 'UNSUPPORTED',
            message: 'No independently reviewed drone sizing model or reference data are configured.'
          }
        };
        actionPlan.assistantMessage =
          'No drone sizing estimate was run. No independently reviewed model or reference data are configured.';
      } else if (p.includes('lens') || p.includes('optics') || p.includes('camera')) {
        const lensInputs = parseOpticalInputs(prompt);
        const missing = missingOpticalInputs(lensInputs);
        if (missing.length) {
          actionPlan.toolInput = { wizardType: 'camera_lens', inputs: {} };
          actionPlan.inputOrigin = 'none';
          actionPlan.result = invalidRequiredInputs(missing);
          actionPlan.assistantMessage = actionPlan.result.error.message;
        } else {
          actionPlan.toolInput = { wizardType: 'camera_lens', inputs: lensInputs };
          actionPlan.inputOrigin = 'user-prompt';
          actionPlan.result = this.wizards.lens.runWizard(lensInputs);
          actionPlan.assistantMessage = actionPlan.result.plainSummary;
        }
      } else if (p.includes('pcb') || p.includes('circuit') || p.includes('board')) {
        const pcbInputs = parsePcbWizardInputs(prompt);
        const missing = missingPcbWizardInputs(pcbInputs);
        if (missing.length) {
          actionPlan.toolInput = { wizardType: 'pcb', inputs: {} };
          actionPlan.inputOrigin = 'none';
          actionPlan.result = invalidRequiredInputs(missing);
          actionPlan.assistantMessage = actionPlan.result.error.message;
        } else {
          actionPlan.toolInput = { wizardType: 'pcb', inputs: pcbInputs };
          actionPlan.inputOrigin = 'user-prompt';
          actionPlan.result = this.wizards.pcb.runWizard(pcbInputs);
          actionPlan.assistantMessage = actionPlan.result.plainSummary;
        }
      } else {
        const dropInputs = parseDropTestInputs(prompt);
        const missing = missingDropTestInputs(dropInputs);
        if (missing.length) {
          actionPlan.toolInput = {};
          actionPlan.inputOrigin = 'none';
          actionPlan.result = invalidDropTestResult(missing);
          actionPlan.assistantMessage = actionPlan.result.error.message;
        } else {
          actionPlan.toolInput = { wizardType: 'drop_test', inputs: dropInputs };
          actionPlan.inputOrigin = 'user-prompt';
          actionPlan.result = this.wizards.dropTest.runWizard(dropInputs);
          actionPlan.assistantMessage = actionPlan.result.plainSummary;
        }
      }
    } else if (
      p.includes('asme viii') ||
      p.includes('section viii') ||
      p.includes('div 2') ||
      p.includes('scl') ||
      p.includes('linearization') ||
      p.includes('membrane stress') ||
      (p.includes('asme') && p.includes('pressure vessel'))
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'evaluate_asme_section_viii',
        'The legacy prompt route has no caller-supplied stress classification line or review limits. Use the experimental stress screen with explicit data; this does not provide an ASME assessment.',
        'modal-asme-report'
      );
    } else if (
      p.includes('heal') ||
      p.includes('dirty cad') ||
      p.includes('sliver') ||
      p.includes('micro-gap') ||
      p.includes('stitch') ||
      p.includes('watertight')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'heal_cad_geometry',
        'No caller-supplied geometry or healing tolerance was provided. The topology engine remains available through its explicit-input interface; solid validity is not established.',
        'modal-topological-healer'
      );
    } else if (
      p.includes('sketch') ||
      p.includes('variational') ||
      p.includes('d-cubed') ||
      p.includes('geometric constraint')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_variational_sketch',
        'No caller-supplied sketch points, constraints, or solver controls were provided. The legacy macro does not create a sample sketch.',
        'modal-variational-sketcher'
      );
    } else if (
      p.includes('cad diff') ||
      p.includes('visual diff') ||
      p.includes('diff cad') ||
      p.includes('revision') ||
      p.includes('model diff')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'diff_3d_cad_models',
        'Two caller-supplied model revisions are required. The legacy macro does not synthesize comparison models.',
        'modal-cad-diff'
      );
    } else if (
      p.includes('ebom') ||
      p.includes('bill of materials') ||
      p.includes('cost rollup') ||
      p.includes('consolidate hardware') ||
      p.includes('hardware consolidation')
    ) {
      actionPlan.matchedTool = 'rollup_ebom_costs';
      actionPlan.toolInput = {};
      actionPlan.result = {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: { code: 'UNSUPPORTED', message: 'This prompt route has no caller-supplied assembly hierarchy.' }
      };
      actionPlan.modalToOpen = 'modal-ebom-manager';
      actionPlan.assistantMessage =
        'No BOM calculation was run from this prompt because no hierarchy was supplied. Paste caller-supplied JSON into the eBOM panel and run it; no preset parts or properties are inserted.';
    } else if (
      p.includes('dls') ||
      p.includes('levenberg-marquardt') ||
      p.includes('merit function') ||
      p.includes('optical optimizer') ||
      p.includes('zemax opt')
    ) {
      actionPlan.matchedTool = 'optimize_optical_dls';
      actionPlan.toolInput = {};
      actionPlan.result = {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message:
            'No caller-supplied optical system, merit operands, variable bounds, or optimizer controls were provided.'
        }
      };
      actionPlan.modalToOpen = 'modal-dls-optimizer';
      actionPlan.assistantMessage =
        'No optical calculation was run. Supply an optical system, merit operands, variable bounds, and optimizer controls in the DLS panel; results remain experimental.';
    } else if (
      p.includes('sheet metal') ||
      p.includes('k-factor') ||
      p.includes('flat blank') ||
      p.includes('bend deduction') ||
      p.includes('unfold')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'unfold_sheet_metal',
        'The legacy macro needs explicit thickness, bend radius, bend angle, K-factor, and flange geometry. No example dimensions were inserted.'
      );
    } else if (
      p.includes('gdt') ||
      p.includes('gd&t') ||
      p.includes('true position') ||
      p.includes('bonus tolerance') ||
      p.includes('mmc') ||
      p.includes('y14.5')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'inspect_gdt_tolerance',
        'No caller-supplied datum frame, measured geometry, feature-control frame, or tolerance was provided. No tolerance result or standards interpretation was generated.'
      );
    } else if (
      p.includes('sparse multifrontal') ||
      p.includes('cholesky 100k') ||
      p.includes('direct sparse') ||
      p.includes('amd ordering')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_sparse_multifrontal',
        'A caller-supplied sparse matrix and right-hand side are required. The macro does not generate a matrix or imply scale performance.'
      );
    } else if (
      p.includes('parallel pcg') ||
      p.includes('gpu pcg') ||
      p.includes('csr spmv') ||
      p.includes('jacobi pcg')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_gpu_parallel_pcg',
        'A caller-supplied sparse matrix, right-hand side, and solver controls are required. The macro does not create a test matrix or claim GPU acceleration.'
      );
    } else if (p.includes('fmi') || p.includes('fmu') || p.includes('co-simulation') || p.includes('cosim master')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'run_fmi_cosimulation',
        'No caller-supplied FMUs, connection map, or communication-step settings were provided. This route does not simulate bundled controller and actuator placeholders.'
      );
    } else if (p.includes('archive') || p.includes('.omni') || p.includes('package project')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'package_omni_archive',
        'The legacy macro cannot package the active project or retrieve caller-supplied artifact sections. No demonstrator archive was created.'
      );
    } else if (
      p.includes('lens') ||
      p.includes('optics') ||
      p.includes('camera') ||
      p.includes('aperture') ||
      p.includes('f-stop') ||
      p.includes('cutaway') ||
      p.includes('inside')
    ) {
      actionPlan.matchedTool = 'design_camera_lens_optics';
      const viewOptions = {};
      if (p.includes('half')) viewOptions.cutawayAngle = Math.PI;
      else if (p.includes('closed')) viewOptions.cutawayAngle = 0;
      if (p.includes('ray tracing') || p.includes('show rays')) viewOptions.showRays = true;
      else if (p.includes('without rays') || p.includes('hide rays')) viewOptions.showRays = false;
      const lensInputs = parseOpticalInputs(prompt);
      const missing = missingOpticalInputs(lensInputs);
      actionPlan.suggestedManualEdits = [];
      if (missing.length) {
        actionPlan.toolInput = {};
        actionPlan.inputOrigin = 'none';
        actionPlan.result = invalidRequiredInputs(missing);
        actionPlan.assistantMessage = actionPlan.result.error.message;
      } else {
        actionPlan.toolInput = { ...lensInputs, ...viewOptions };
        actionPlan.inputOrigin = 'user-prompt';
        actionPlan.result = OpticalEngine.solveOpticalMetrics(
          lensInputs.focalLengthMm,
          lensInputs.fStop,
          lensInputs.subjectDistM,
          lensInputs.wavelengthNm,
          lensInputs.circleOfConfusionMm
        );
        actionPlan.assistantMessage = `Experimental scalar optics estimates for ${lensInputs.focalLengthMm} mm at f/${lensInputs.fStop}, focused at ${lensInputs.subjectDistM} m and using ${lensInputs.wavelengthNm} nm wavelength and ${lensInputs.circleOfConfusionMm} mm circle of confusion: numerical aperture ${actionPlan.result.numericalAperture}, diffraction diameter ${actionPlan.result.diffractionAiryDiskDiameter_um} µm, hyperfocal estimate ${actionPlan.result.hyperfocalDistance_m} m, and depth-of-field estimate ${actionPlan.result.depthOfField_m} m. No prescription ray trace or independently validated image-quality result was calculated.`;
        actionPlan.suggestedManualEdits = [
          { label: 'f-Stop Aperture', key: 'lensFStop', value: lensInputs.fStop, unit: 'f/' },
          { label: 'Subject Distance', key: 'lensSubjectDist', value: lensInputs.subjectDistM, unit: 'm' },
          ...(Object.hasOwn(viewOptions, 'cutawayAngle')
            ? [
                {
                  label: 'Cutaway Angle',
                  key: 'lensCutawayDeg',
                  value: Math.round((viewOptions.cutawayAngle * 180) / Math.PI),
                  unit: '°'
                }
              ]
            : []),
          ...(Object.hasOwn(viewOptions, 'showRays')
            ? [{ label: 'Light Ray Cone', key: 'lensShowRays', value: viewOptions.showRays, unit: 'bool' }]
            : [])
        ];
      }
    } else if (p.includes('drop') || p.includes('impact') || p.includes('fall')) {
      actionPlan.matchedTool = 'run_phone_drop_test';
      const dropInputs = parseDropTestInputs(prompt);
      const missing = missingDropTestInputs(dropInputs);
      actionPlan.suggestedManualEdits = [];
      if (missing.length) {
        actionPlan.toolInput = {};
        actionPlan.inputOrigin = 'none';
        actionPlan.result = invalidDropTestResult(missing);
        actionPlan.assistantMessage = actionPlan.result.error.message;
      } else {
        actionPlan.toolInput = {
          dropHeight: dropInputs.dropHeightM,
          phoneMass: dropInputs.phoneMassKg,
          impactAngle: dropInputs.impactAngle
        };
        actionPlan.inputOrigin = 'user-prompt';
        actionPlan.result = DropTestSimulator.runSimulation(actionPlan.toolInput);
        actionPlan.assistantMessage = `Experimental ${dropInputs.dropHeightM} m handset impact example for a device mass of ${dropInputs.phoneMassKg} kg (${dropInputs.impactAngle} orientation) returned illustrative estimates: peak deceleration ${actionPlan.result.peakDeceleration_G} G and screen stress ${actionPlan.result.peakScreenStress_MPa} MPa. No device-specific material model or independent validation is available.`;
        actionPlan.suggestedManualEdits = [
          { label: 'Drop Height', key: 'dropHeight', value: dropInputs.dropHeightM, unit: 'm' },
          { label: 'Device Mass', key: 'phoneMassKg', value: dropInputs.phoneMassKg, unit: 'kg' },
          { label: 'Impact Angle', key: 'impactAngle', value: dropInputs.impactAngle, unit: '' }
        ];
      }
    } else if (p.includes('thermal') || p.includes('heat') || p.includes('vapor') || p.includes('icepak')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'simulate_mobile_thermal',
        'No caller-supplied thermal geometry, material properties, boundary conditions, or solver controls were provided.'
      );
    } else if (
      p.includes('verilog') ||
      p.includes('synthesize') ||
      p.includes('rtl') ||
      p.includes('chip') ||
      p.includes('gate')
    ) {
      const verilogCode = parseVerilogCode(prompt);
      if (!verilogCode) {
        markLegacyMacroUnavailable(
          actionPlan,
          'synthesize_verilog_chip',
          'Supply Verilog source in a fenced ```verilog``` block. No sample RTL was inserted.'
        );
      } else {
        actionPlan.matchedTool = 'synthesize_verilog_chip';
        actionPlan.toolInput = { verilogCode };
        actionPlan.inputOrigin = 'user-prompt';
        actionPlan.result = LogicSynthesisEngine.synthesize(verilogCode);
        actionPlan.assistantMessage = `Experimental RTL estimate for "${actionPlan.result.moduleName}": ${actionPlan.result.gateCount} toy gates, illustrative area ${actionPlan.result.totalArea_um2} µm², simplified slack estimate ${actionPlan.result.timingSlack_ps} ps, and frequency estimate ${actionPlan.result.maxFrequency_MHz} MHz. No target library or physical timing analysis is used.`;
      }
    } else if (p.includes('drc') || p.includes('calibre') || p.includes('layout') || p.includes('spacing')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'run_calibre_drc_check',
        'No caller-supplied layout geometry or approved foundry rule deck is available through this legacy macro.'
      );
    } else if (p.includes('drone') || p.includes('fly') || p.includes('altitude') || p.includes('autopilot')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'simulate_drone_flight',
        'No independently reviewed drone flight model or reference data are configured.'
      );
    } else if (
      p.includes('pipe') ||
      p.includes('piping') ||
      p.includes('asme') ||
      p.includes('caesar') ||
      p.includes('stress')
    ) {
      actionPlan.matchedTool = 'calculate_asme_piping_stress';
      const pipingInputs = {};
      const temperatureMatch = p.match(/(-?\d+(?:\.\d+)?)\s*°?\s*c\b/i);
      if (temperatureMatch) pipingInputs.operatingTempC = Number(temperatureMatch[1]);
      if (/\b(?:no|without) (?:an? )?(?:expansion )?loop\b/.test(p)) pipingInputs.hasExpansionLoop = false;
      else if (/\b(?:with|include) (?:an? )?(?:expansion )?loop\b/.test(p)) pipingInputs.hasExpansionLoop = true;
      actionPlan.toolInput = pipingInputs;
      actionPlan.result = PipingStressEngine.evaluateASMEB313(actionPlan.toolInput);

      actionPlan.assistantMessage = actionPlan.result.success
        ? `Experimental piping estimate returned ${actionPlan.result.hoopStress_MPa} MPa hoop stress and ${actionPlan.result.expansionStress_MPa} MPa thermal response. Inputs are unverified and this is not an ASME code calculation or compliance decision.`
        : `Piping estimate not run. ${actionPlan.result.error}`;
      if (typeof pipingInputs.hasExpansionLoop === 'boolean') {
        actionPlan.suggestedManualEdits = [
          {
            label: 'Expansion Loop Enabled',
            key: 'hasExpansionLoop',
            value: pipingInputs.hasExpansionLoop,
            unit: 'bool'
          }
        ];
      }
    } else if (p.includes('hysys') || p.includes('distillation') || p.includes('crude') || p.includes('refinery')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'run_hysys_flash_distillation',
        'No sourced feed assay or validated distillation model is configured. No product yields or duties were calculated.'
      );
    } else if (p.includes('spot') || p.includes('mtf') || p.includes('aberration') || p.includes('skew')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_skew_optics',
        'No caller-supplied optical prescription, wavelength, field points, or ray set was provided.'
      );
    } else if (p.includes('spice') || p.includes('oscilloscope') || p.includes('transient') || p.includes('waveform')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_spice_circuit',
        'No caller-supplied circuit and transient-analysis controls were provided. No RC example was generated.'
      );
    } else if (p.includes('flowsheet') || p.includes('pfd') || p.includes('recycle') || p.includes('wegstein')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_flowsheet',
        'The legacy macro has no validated user-provided flowsheet schema or thermodynamic models. No convergence or material-balance result was produced.'
      );
    } else if (p.includes('step') || p.includes('iso 10303') || p.includes('brep export')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'export_step',
        'No caller-supplied geometry was provided. The legacy macro does not create a bundled box.'
      );
    } else if (p.includes('gerber') || p.includes('rs-274x') || p.includes('pcb export')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'export_gerber',
        'No caller-supplied PCB layout, nets, apertures, or bounds were provided. No manufacturing files were generated.'
      );
    } else if (
      p.includes('sketch') ||
      p.includes('variational') ||
      p.includes('d-cubed') ||
      p.includes('geometric constraint')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_variational_sketch',
        'No caller-supplied sketch points, constraints, or solver controls were provided.'
      );
    } else if (
      p.includes('heal') ||
      p.includes('dirty cad') ||
      p.includes('sliver') ||
      p.includes('micro-gap') ||
      p.includes('stitch') ||
      p.includes('watertight')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'heal_cad_geometry',
        'No caller-supplied geometry or healing tolerance was provided.'
      );
    } else if (
      p.includes('dls') ||
      p.includes('levenberg-marquardt') ||
      p.includes('merit function') ||
      p.includes('optical optimizer') ||
      p.includes('zemax opt')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'optimize_optical_dls',
        'No caller-supplied optical system, merit operands, variable bounds, or optimizer controls were provided.',
        'modal-dls-optimizer'
      );
    } else if (
      p.includes('asme viii') ||
      p.includes('section viii') ||
      p.includes('div 2') ||
      p.includes('scl') ||
      p.includes('linearization') ||
      p.includes('membrane stress') ||
      (p.includes('asme') && p.includes('pressure vessel'))
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'evaluate_asme_section_viii',
        'No caller-supplied stress classification line or review limits were provided.',
        'modal-asme-report'
      );
    } else if (
      p.includes('cad diff') ||
      p.includes('visual diff') ||
      p.includes('diff cad') ||
      p.includes('revision') ||
      p.includes('model diff')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'diff_3d_cad_models',
        'Two caller-supplied model revisions are required. No comparison models were synthesized.',
        'modal-cad-diff'
      );
    } else if (
      p.includes('ebom') ||
      p.includes('bill of materials') ||
      p.includes('cost rollup') ||
      p.includes('consolidate hardware') ||
      p.includes('hardware consolidation')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'rollup_ebom_costs',
        'This prompt route has no caller-supplied assembly hierarchy.',
        'modal-ebom-manager'
      );
    } else if (
      p.includes('sheet metal') ||
      p.includes('k-factor') ||
      p.includes('flat blank') ||
      p.includes('bend deduction') ||
      p.includes('unfold')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'unfold_sheet_metal',
        'Explicit thickness, radius, angle, K-factor, and flange geometry are required.'
      );
    } else if (
      p.includes('gdt') ||
      p.includes('gd&t') ||
      p.includes('true position') ||
      p.includes('bonus tolerance') ||
      p.includes('mmc') ||
      p.includes('y14.5')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'inspect_gdt_tolerance',
        'No caller-supplied datum frame, measured geometry, feature-control frame, or tolerance was provided.'
      );
    } else if (
      p.includes('sparse multifrontal') ||
      p.includes('cholesky 100k') ||
      p.includes('direct sparse') ||
      p.includes('amd ordering')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_sparse_multifrontal',
        'A caller-supplied sparse matrix and right-hand side are required.'
      );
    } else if (
      p.includes('parallel pcg') ||
      p.includes('gpu pcg') ||
      p.includes('csr spmv') ||
      p.includes('jacobi pcg')
    ) {
      markLegacyMacroUnavailable(
        actionPlan,
        'solve_gpu_parallel_pcg',
        'A caller-supplied sparse matrix, right-hand side, and solver controls are required.'
      );
    } else if (p.includes('fmi') || p.includes('fmu') || p.includes('co-simulation') || p.includes('cosim master')) {
      markLegacyMacroUnavailable(
        actionPlan,
        'run_fmi_cosimulation',
        'Caller-supplied FMUs, connections, and communication-step settings are required.'
      );
    } else {
      actionPlan.assistantMessage =
        'The legacy keyword macro did not match a supported route. No geometry or engineering calculation was created.';
    }

    const hasAppliedInputs = Boolean(actionPlan.toolInput && Object.keys(actionPlan.toolInput).length > 0);
    actionPlan.inputOrigin = actionPlan.inputOrigin || (hasAppliedInputs ? 'user-prompt' : 'none');
    actionPlan.assistantMessage = [
      'Experimental legacy macro; not independently validated and not a result for the active project.',
      hasAppliedInputs ? `Inputs used: ${summarizeMacroInputs(actionPlan.toolInput)}.` : 'No inputs were applied.',
      actionPlan.assistantMessage
    ].join(' ');

    // Register into non-linear undo/redo CommandJournal
    if (this.journal && actionPlan.matchedTool) {
      this.journal.execute(
        actionPlan.matchedTool || 'AI_ACTION',
        actionPlan.toolInput || {},
        {},
        actionPlan.assistantMessage,
        'omni_ai'
      );
    }

    return actionPlan;
  }

  /**
   * Train a genuine seeded MLP surrogate (mini-batch SGD with momentum) on
   * caller-supplied tabular data. This is a real neural network computation,
   * unlike the legacy keyword-macro routes.
   * @param {Object|Array} dataset {inputs, outputs} or [ [input, output], ... ]
   * @param {Object} config { hiddenUnits, activation, loss, epochs, batchSize, learningRate, momentum, seed }
   * @returns {{model: object, lossHistory: number[], converged: boolean}}
   */
  trainSurrogate(dataset, config = {}) {
    return trainSurrogate(dataset, config);
  }

  /**
   * Deterministic inference on a trained surrogate model (same weights => same output).
   * @param {Object} model A NeuralNetwork instance or a serialized model object
   * @param {Array|Array<Array>} x Input vector or matrix of input vectors
   * @returns {Array|Array<Array>} Prediction vector or matrix of predictions
   */
  predictSurrogate(model, x) {
    if (model && model.format === 'omnieng-neural-net-v1') {
      const { NeuralNetwork } = require('./neural_net');
      model = NeuralNetwork.fromJSON(model);
    }
    return predictSurrogate(model, x);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OmniAIEngine, OMNI_TOOLS };
}
