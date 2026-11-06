'use strict';

/**
 * Process Control & Safeguarding Narrative Generator.
 *
 * Implements:
 * 1. Regulatory PID feedback control narratives (Flow, Pressure, Temperature, Level)
 * 2. Advanced and coordinated control strategies:
 *    - Cascade control (Master TIC -> Slave FIC)
 *    - Split-Range control (dual valve pressure regulation: makeup fuel gas vs flare)
 *    - Ratio control (stoichiometric combustion air / refrigerant component blending)
 *    - Override / High-Low Selector control (compressor suction throttle vs discharge limit)
 *    - Dynamic Compressor Anti-Surge control (Surge Limit Line SLL, Surge Control Line SCL margin,
 *      derivative surge anticipation, fast open characteristic)
 *    - Three-element drum level control (feedforward steam flow + feedback drum level)
 * 3. Safeguarding, SIS interlocks & Cause-and-Effect logic:
 *    - Trip sensor voting architectures: 1oo1, 1oo2, 2oo3 (Triple Modular Redundant)
 *    - Plant Shutdown Hierarchy: ESD Level 0 (Total Plant), Level 1 (Train), Level 2 (Unit Depressuring/Blowdown), Level 3 (Equipment Trip)
 *    - Executive safeguarding actions: de-energize to trip, fail-close ESDV, fail-open BDV, motor trip
 * 4. Multi-Unit LNG Plant Narrative Generator (Liquefaction, Amine Treating, NGL Recovery, Storage & BOG)
 * 5. Structured JSON and formatted Markdown export
 */

const CONTROL_TYPES = Object.freeze({
  REGULATORY_PID: 'regulatory_pid',
  CASCADE: 'cascade',
  SPLIT_RANGE: 'split_range',
  RATIO: 'ratio',
  OVERRIDE: 'override',
  ANTI_SURGE: 'anti_surge',
  THREE_ELEMENT: 'three_element'
});

const VOTING_LOGIC = Object.freeze({
  ONE_OUT_OF_ONE: '1oo1',
  ONE_OUT_OF_TWO: '1oo2',
  TWO_OUT_OF_THREE: '2oo3'
});

const ESD_LEVELS = Object.freeze({
  LEVEL_0_TOTAL_PLANT: 'ESD Level 0: Total Plant Emergency Shutdown',
  LEVEL_1_TRAIN: 'ESD Level 1: LNG Train Process Shutdown',
  LEVEL_2_UNIT_DEPRESSURING: 'ESD Level 2: Process Unit Isolation & Flare Blowdown',
  LEVEL_3_EQUIPMENT_TRIP: 'ESD Level 3: Individual Equipment Trip'
});

class ControlNarrativeBuilder {
  constructor(options = {}) {
    this.title = options.title || 'Process Control & Safeguarding Philosophy';
    this.facility = options.facility || 'Baseload LNG Liquefaction Facility';
    this.documentNumber = options.documentNumber || 'CN-LNG-5001';
    this.revision = options.revision || '0';
    this.author = options.author || 'OmniEng Process Control Discipline';

    this.regulatoryLoops = [];
    this.advancedStrategies = [];
    this.safeguardingInterlocks = [];
  }

  /**
   * Add a single-input single-output regulatory PID control loop narrative.
   */
  addRegulatoryLoop(loop) {
    const record = {
      type: CONTROL_TYPES.REGULATORY_PID,
      loopTag: loop.loopTag,
      description: loop.description,
      processVariableTag: loop.processVariableTag,
      pvRange: loop.pvRange || '0 - 100 %',
      setpointNormal: loop.setpointNormal,
      engineeringUnits: loop.engineeringUnits,
      manipulatedVariableTag: loop.manipulatedVariableTag,
      mvType: loop.mvType || 'Control Valve',
      action: loop.action || 'REVERSE', // DIRECT (PV up -> MV up) or REVERSE (PV up -> MV down)
      controllerMode: loop.controllerMode || 'AUTO',
      algorithm: loop.algorithm || 'PID with Anti-Reset Windup and Derivative Filter',
      tuningGuidance: loop.tuningGuidance || 'Proportional + Integral action; derivative inactive for noisy flow/level',
      failSafeState: loop.failSafeState || 'FC (Fail Close on loss of air/signal)',
      alarms: {
        lowLow: loop.alarms?.lowLow || null,
        low: loop.alarms?.low || null,
        high: loop.alarms?.high || null,
        highHigh: loop.alarms?.highHigh || null
      }
    };
    this.regulatoryLoops.push(record);
    return record;
  }

  /**
   * Add an advanced or coordinated control strategy narrative.
   */
  addAdvancedStrategy(strategy) {
    const record = {
      type: strategy.type,
      strategyTag: strategy.strategyTag,
      title: strategy.title,
      objective: strategy.objective,
      architecture: strategy.architecture,
      primaryController: strategy.primaryController,
      secondaryController: strategy.secondaryController || null,
      selectorType: strategy.selectorType || null, // 'HIGH_SELECTOR', 'LOW_SELECTOR', 'SPLIT_RANGE_BLOCK'
      operationalDescription: strategy.operationalDescription,
      dynamicConsiderations: strategy.dynamicConsiderations,
      operatorInterface: strategy.operatorInterface || 'Standard faceplate with bumpless transfer mode'
    };
    this.advancedStrategies.push(record);
    return record;
  }

  /**
   * Add a Safety Instrumented System (SIS) trip interlock narrative.
   */
  addSafeguardingInterlock(interlock) {
    const record = {
      interlockTag: interlock.interlockTag,
      service: interlock.service,
      esdLevel: interlock.esdLevel || ESD_LEVELS.LEVEL_3_EQUIPMENT_TRIP,
      silTarget: interlock.silTarget || 'SIL 2',
      sensors: interlock.sensors || [],
      votingLogic: interlock.votingLogic || VOTING_LOGIC.TWO_OUT_OF_THREE,
      tripSetpoint: interlock.tripSetpoint || null,
      normalOperatingPoint: interlock.normalOperatingPoint || null,
      tripInitiator: interlock.tripInitiator, // e.g., 'Level High-High (LSHH > 85%)'
      executiveActions: interlock.executiveActions || [],
      resetPhilosophy: interlock.resetPhilosophy || 'Latching trip requiring operator reset permissive after conditions normalize',
      bypassConditions: interlock.bypassConditions || 'Maintenance bypass subject to MOS (Maintenance Override Switch) keylock and time limit'
    };
    this.safeguardingInterlocks.push(record);
    return record;
  }

  /**
   * Export complete narrative data structure to JSON.
   */
  toJson() {
    return {
      title: this.title,
      facility: this.facility,
      documentNumber: this.documentNumber,
      revision: this.revision,
      regulatoryLoopCount: this.regulatoryLoops.length,
      advancedStrategyCount: this.advancedStrategies.length,
      safeguardingInterlockCount: this.safeguardingInterlocks.length,
      regulatoryLoops: this.regulatoryLoops,
      advancedStrategies: this.advancedStrategies,
      safeguardingInterlocks: this.safeguardingInterlocks
    };
  }

  /**
   * Generate formal engineering Markdown deliverable.
   */
  toMarkdown() {
    const lines = [];

    lines.push(`# ${this.title}`);
    lines.push(`**Facility:** ${this.facility}  `);
    lines.push(`**Document Number:** ${this.documentNumber} | **Revision:** ${this.revision}  `);
    lines.push(`**Prepared By:** ${this.author}  `);
    lines.push('---');
    lines.push('');

    // Section 1
    lines.push('## 1. General Control Architecture & Philosophy');
    lines.push(
      'The plant automation architecture enforces strict physical and functional segregation between the Basic Process Control System (BPCS/DCS) and the Safety Instrumented System (SIS) in accordance with IEC 61511. All regulatory controls, cascade loops, and continuous optimizations reside in the fault-tolerant DCS controllers. Independent Triple Modular Redundant (TMR) safety logic solvers execute safety instrumented functions and emergency shutdown sequences with de-energize-to-trip field wiring.'
    );
    lines.push('');

    // Section 2
    lines.push('## 2. Regulatory PID Control Loops');
    lines.push('| Loop Tag | Description | PV Tag | Setpoint | MV Tag | Action | Fail State |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const loop of this.regulatoryLoops) {
      lines.push(
        `| **${loop.loopTag}** | ${loop.description} | ${loop.processVariableTag} | ${loop.setpointNormal} ${loop.engineeringUnits} | ${loop.manipulatedVariableTag} | ${loop.action} | ${loop.failSafeState.split(' ')[0]} |`
      );
    }
    lines.push('');

    lines.push('### 2.1 Detailed Loop Operational Narratives');
    for (const loop of this.regulatoryLoops) {
      lines.push(`#### Loop ${loop.loopTag}: ${loop.description}`);
      lines.push(`- **Controlled Variable (PV):** ${loop.processVariableTag} (Range: ${loop.pvRange})`);
      lines.push(`- **Manipulated Variable (MV):** ${loop.manipulatedVariableTag} (${loop.mvType})`);
      lines.push(`- **Normal Setpoint:** ${loop.setpointNormal} ${loop.engineeringUnits}`);
      lines.push(`- **Controller Action:** ${loop.action} (${loop.action === 'DIRECT' ? 'PV increase increases MV' : 'PV increase decreases MV'})`);
      lines.push(`- **Algorithm & Tuning:** ${loop.algorithm}. *${loop.tuningGuidance}*`);
      lines.push(`- **Fail-Safe Response:** ${loop.failSafeState}`);
      lines.push('- **Alarm Thresholds:**');
      if (loop.alarms.lowLow) lines.push(`  - Low-Low (Trip): ${loop.alarms.lowLow} ${loop.engineeringUnits}`);
      if (loop.alarms.low) lines.push(`  - Low (Pre-Alarm): ${loop.alarms.low} ${loop.engineeringUnits}`);
      if (loop.alarms.high) lines.push(`  - High (Pre-Alarm): ${loop.alarms.high} ${loop.engineeringUnits}`);
      if (loop.alarms.highHigh) lines.push(`  - High-High (Trip): ${loop.alarms.highHigh} ${loop.engineeringUnits}`);
      lines.push('');
    }

    // Section 3
    lines.push('## 3. Advanced & Coordinated Control Strategies');
    for (const adv of this.advancedStrategies) {
      lines.push(`### 3.${this.advancedStrategies.indexOf(adv) + 1} ${adv.title} [${adv.strategyTag}]`);
      lines.push(`- **Strategy Type:** \`${adv.type.toUpperCase()}\``);
      lines.push(`- **Control Objective:** ${adv.objective}`);
      lines.push(`- **Architecture & Master/Slave:** ${adv.architecture}`);
      lines.push(`- **Operational Description:** ${adv.operationalDescription}`);
      lines.push(`- **Dynamic Considerations & Constraints:** ${adv.dynamicConsiderations}`);
      lines.push(`- **Operator Interface:** ${adv.operatorInterface}`);
      lines.push('');
    }

    // Section 4
    lines.push('## 4. Safeguarding, Interlocks & Emergency Shutdown (SIS)');
    lines.push('| Interlock Tag | Service | Hierarchy Level | Voting | Trip Setpoint | Target SIL | Actions |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const int of this.safeguardingInterlocks) {
      lines.push(
        `| **${int.interlockTag}** | ${int.service} | ${int.esdLevel.split(':')[0]} | ${int.votingLogic} | ${int.tripSetpoint || 'Per C&E'} | ${int.silTarget} | ${int.executiveActions.length} Actions |`
      );
    }
    lines.push('');

    lines.push('### 4.1 Detailed Safeguarding Interlock Narratives');
    for (const int of this.safeguardingInterlocks) {
      lines.push(`#### Interlock ${int.interlockTag}: ${int.service}`);
      lines.push(`- **Shutdown Hierarchy:** ${int.esdLevel}`);
      lines.push(`- **Safety Integrity Level:** ${int.silTarget}`);
      lines.push(`- **Sensor Architecture:** ${int.votingLogic} voting across [${int.sensors.join(', ')}]`);
      lines.push(`- **Trip Initiator Condition:** ${int.tripInitiator}`);
      if (int.tripSetpoint) lines.push(`- **Trip Setpoint:** ${int.tripSetpoint}`);
      if (int.normalOperatingPoint) lines.push(`- **Normal Operating Point:** ${int.normalOperatingPoint}`);
      lines.push('- **Executive Actions Executed Automatically:**');
      for (const act of int.executiveActions) {
        lines.push(`  1. ${act}`);
      }
      lines.push(`- **Reset Permissive:** ${int.resetPhilosophy}`);
      lines.push(`- **Bypass Governance:** ${int.bypassConditions}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * Factory creating comprehensive control and safeguarding narratives for a full LNG complex.
 */
function createWorldScaleLngControlNarratives() {
  const builder = new ControlNarrativeBuilder({
    title: 'Process Control & Safeguarding Philosophy Specification',
    facility: '5.0 MTPA World-Scale LNG Liquefaction Complex',
    documentNumber: 'FEED-I&C-CN-001',
    revision: '0'
  });

  // 1. Regulatory loops
  builder.addRegulatoryLoop({
    loopTag: '10-PIC-1001',
    description: 'Feed Gas Pipeline Header Pressure Control',
    processVariableTag: '10-PT-1001',
    pvRange: '0 - 100 barg',
    setpointNormal: 68.0,
    engineeringUnits: 'barg',
    manipulatedVariableTag: '10-PV-1001',
    action: 'REVERSE',
    controllerMode: 'AUTO',
    failSafeState: 'FC (Fail Close to isolate incoming high pressure)',
    tuningGuidance: 'Fast PI response; integral time 15 s, proportional gain 2.2',
    alarms: { low: 55.0, lowLow: 48.0, high: 74.0, highHigh: 80.0 }
  });

  builder.addRegulatoryLoop({
    loopTag: '10-FIC-1201',
    description: 'Lean aMDEA Amine Flow to Acid Gas Absorber',
    processVariableTag: '10-FT-1201',
    pvRange: '0 - 1000 m3/h',
    setpointNormal: 650.0,
    engineeringUnits: 'm3/h',
    manipulatedVariableTag: '10-FV-1201',
    action: 'DIRECT',
    failSafeState: 'FC (Fail Close to prevent uncontrolled column flooding)',
    tuningGuidance: 'PI control with anti-windup; fast loop cycle',
    alarms: { low: 450.0, lowLow: 350.0, high: 800.0, highHigh: 880.0 }
  });

  builder.addRegulatoryLoop({
    loopTag: '30-LIC-3005',
    description: 'Demethanizer Column Sump Liquid Level Control',
    processVariableTag: '30-LIT-3005',
    pvRange: '0 - 3000 mmH2O',
    setpointNormal: 1500.0,
    engineeringUnits: 'mmH2O',
    manipulatedVariableTag: '30-LV-3005',
    action: 'DIRECT',
    failSafeState: 'FC (Fail Close to avoid unsealing reboiler)',
    tuningGuidance: 'Averaging level PI control; large integral time to dampen surge to downstream deethanizer',
    alarms: { low: 600.0, lowLow: 300.0, high: 2400.0, highHigh: 2700.0 }
  });

  builder.addRegulatoryLoop({
    loopTag: '40-TIC-4001',
    description: 'MCHE LNG Rundown Subcooling Temperature Control',
    processVariableTag: '40-TT-4001',
    pvRange: '-200 - 0 degC',
    setpointNormal: -161.5,
    engineeringUnits: 'degC',
    manipulatedVariableTag: '40-FV-4001',
    action: 'DIRECT',
    failSafeState: 'FC (Fail Close on cryo loss)',
    tuningGuidance: 'PID with derivative on PV; filter time constant 10 s to handle cryogenic delay',
    alarms: { low: -165.0, high: -155.0, highHigh: -145.0 }
  });

  // 2. Advanced Control Strategies
  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.CASCADE,
    strategyTag: '10-CC-1210',
    title: 'Amine Regenerator Stripper Column Temperature / Steam Cascade',
    objective: 'Maintain precise stripping tray temperature regardless of LP steam header fluctuations',
    architecture: 'Master controller 10-TIC-1210 (Stripping Tray Temp) sets remote setpoint of Slave 10-FIC-1210 (LP Steam Flow)',
    primaryController: '10-TIC-1210 (Master Temperature Controller)',
    secondaryController: '10-FIC-1210 (Slave Steam Flow Controller)',
    operationalDescription:
      'The primary temperature controller evaluates column stripping section equilibrium. Process disturbances in LP steam header pressure are instantaneously rejected by the inner slave flow loop before column thermal inertia is disturbed.',
    dynamicConsiderations: 'Slave flow loop is tuned 5x faster than master temperature loop to guarantee stability.'
  });

  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.SPLIT_RANGE,
    strategyTag: '50-SRC-5001',
    title: 'Fuel Gas Header / Flare Pressure Split-Range Control',
    objective: 'Regulate fuel gas header pressure by first admitting makeup fuel gas and venting to flare only on extreme overpressure',
    architecture: 'Single pressure controller 50-PIC-5001 driving two control valves across 0-100% output with 5% deadband',
    selectorType: 'SPLIT_RANGE_BLOCK',
    operationalDescription:
      'Controller output 0% to 45% opens makeup natural gas valve 50-PV-5001A. Between 45% and 55% both valves remain seated (deadband). Output 55% to 100% throttles excess gas valve 50-PV-5001B to flare header.',
    dynamicConsiderations: 'Prevents wasteful flare loss during minor process fluctuations while safeguarding header against overpressure.'
  });

  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.ANTI_SURGE,
    strategyTag: '40-ASC-4101',
    title: 'Propane & Mixed Refrigerant (MR) Centrifugal Compressor Dynamic Anti-Surge Control',
    objective: 'Prevent aerodynamic compressor surge while minimizing recycle gas energy consumption',
    architecture: 'Dedicated high-speed (20 ms loop cycle) anti-surge controller computing dynamic distance to Surge Limit Line (SLL)',
    operationalDescription:
      'The operating point is tracked in coordinates of reduced pressure ratio versus suction orifice differential pressure. A Surge Control Line (SCL) is defined at 10% safety margin above SLL. If the operating point crosses SCL, the recycle valve 40-FV-4101 opens proportionally. If the rate-of-change of approach d(dist)/dt is rapid, derivative surge anticipation triggers an instant step opening.',
    dynamicConsiderations: 'Fast-stroking electro-hydraulic recycle valve achieves full open stroke in less than 1.2 seconds with linear characteristic.'
  });

  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.RATIO,
    strategyTag: '40-RC-4201',
    title: 'Liquefaction Train Mixed Refrigerant (MR) Component Ratio Control',
    objective: 'Optimize heat transfer pinch across MCHE by holding precise molar ratio of nitrogen, methane, ethane, and propane',
    architecture: 'Online GC analysis 40-AT-4201 sets refrigerant make-up injection ratio valves',
    operationalDescription:
      'Maintains target molecular weight of circulating mixed refrigerant to achieve thermal match with natural gas cooling curve.',
    dynamicConsiderations: 'Closed-loop trim using MCHE warm-end delta T temperature feedback.'
  });

  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.OVERRIDE,
    strategyTag: '40-OVC-4101',
    title: 'MR Refrigeration Compressor Low Suction vs High Discharge Pressure Override',
    objective: 'Safeguard compressor from vacuum suction and excessive discharge pressure using a low-select override block',
    architecture: 'Dual PID controllers (Suction PIC and Discharge PIC) routed through a Low Selector Block (LS) driving suction throttle valve 40-PV-4101',
    primaryController: '40-PIC-4101A (Suction Pressure Controller)',
    secondaryController: '40-PIC-4101B (Discharge Pressure Override Controller)',
    selectorType: 'LOW_SELECTOR',
    operationalDescription:
      'Under normal conditions, the suction pressure controller governs valve 40-PV-4101. If discharge pressure approaches design limit (85 barg), the discharge override controller takes control to throttle flow and prevent trip.',
    dynamicConsiderations: 'External reset feedback prevents integral windup of the unselected controller.'
  });

  builder.addAdvancedStrategy({
    type: CONTROL_TYPES.THREE_ELEMENT,
    strategyTag: '10-3EC-1301',
    title: 'High-Pressure Steam Boiler Drum Three-Element Level Control',
    objective: 'Prevent swell/shrink false level swings during rapid steam demand changes',
    architecture: 'Cascade with feedforward: drum level LIC trims feedwater flow FIC with feedforward steam flow FT',
    primaryController: '10-LIC-1301 (Drum Level Controller)',
    secondaryController: '10-FIC-1301 (Feedwater Flow Controller)',
    operationalDescription:
      'Steam flow FT-1301 and Feedwater flow FT-1302 provide high-speed mass balance feedforward, while drum level LIC-1301 slowly trims the setpoint to maintain exact water line.',
    dynamicConsiderations: 'Eliminates reverse response from boiler swell/shrink phenomena.'
  });

  // 3. Safeguarding Interlocks
  builder.addSafeguardingInterlock({
    interlockTag: '10-I-1001',
    service: 'Feed Gas High-High Pressure Pipeline Isolation',
    esdLevel: ESD_LEVELS.LEVEL_1_TRAIN,
    silTarget: 'SIL 3',
    sensors: ['10-PT-1002A', '10-PT-1002B', '10-PT-1002C'],
    votingLogic: VOTING_LOGIC.TWO_OUT_OF_THREE,
    tripSetpoint: '82.0 barg',
    normalOperatingPoint: '68.0 barg',
    tripInitiator: 'Header pressure exceeds 82.0 barg on 2 out of 3 transmitters',
    executiveActions: [
      'De-energize dual redundant solenoids on Emergency Shutdown Valve 10-ESDV-1001 (Fail Close in < 2 seconds)',
      'Trip Feed Gas booster compressor motor 10-K-101 via high-voltage breaker shunt trip',
      'Signal Train Level 1 shutdown to central DCS and illuminate main trip annunciator'
    ],
    resetPhilosophy: 'Manual latching reset at both local field push-button station and DCS safety graphics faceplate required.'
  });

  builder.addSafeguardingInterlock({
    interlockTag: '10-I-1201',
    service: 'Acid Gas Stripper Reboiler LP Steam High-Pressure Isolation',
    esdLevel: ESD_LEVELS.LEVEL_3_EQUIPMENT_TRIP,
    silTarget: 'SIL 2',
    sensors: ['10-PSHH-1205A', '10-PSHH-1205B'],
    votingLogic: VOTING_LOGIC.ONE_OUT_OF_TWO,
    tripSetpoint: '6.5 barg',
    normalOperatingPoint: '3.5 barg',
    tripInitiator: 'Reboiler steam pressure exceeds 6.5 barg on 1 of 2 pressure switches (1oo2)',
    executiveActions: [
      'De-energize fail-close LP steam isolation valve 10-XV-1210',
      'Vent reboiler condensate return manifold'
    ],
    resetPhilosophy: 'Automatic permissive reset when steam header drops below 4.5 barg and operator acks.'
  });

  builder.addSafeguardingInterlock({
    interlockTag: '40-I-4001',
    service: 'MCHE Cryogenic Depressuring & Flare Blowdown Interlock',
    esdLevel: ESD_LEVELS.LEVEL_2_UNIT_DEPRESSURING,
    silTarget: 'SIL 3',
    sensors: ['40-TSHH-4005A', '40-TSHH-4005B', '40-TSHH-4005C'],
    votingLogic: VOTING_LOGIC.TWO_OUT_OF_THREE,
    tripSetpoint: 'Differential delta T > 50 degC or Pressure > 75.0 barg',
    normalOperatingPoint: 'Delta T < 15 degC, Normal pressure 55.0 barg',
    tripInitiator: 'MCHE tube differential thermal contraction or excessive tube rupture pressure',
    executiveActions: [
      'De-energize Blowdown Valve 40-BDV-4001 to Fail Open to cryogenic flare in < 3 seconds',
      'Close MCHE natural gas feed inlet ESDV 40-ESDV-4001',
      'Trip Propane and Mixed Refrigerant refrigeration compressor gas turbines via fuel stop valves'
    ],
    resetPhilosophy: 'Post-trip inspection and senior engineering supervisor key-switch reset required.'
  });

  builder.addSafeguardingInterlock({
    interlockTag: '50-I-5001',
    service: 'Full Containment LNG Storage Tank Overfill Protection',
    esdLevel: ESD_LEVELS.LEVEL_0_TOTAL_PLANT,
    silTarget: 'SIL 3',
    sensors: ['50-LSHH-5001A', '50-LSHH-5001B', '50-LSHH-5001C'],
    votingLogic: VOTING_LOGIC.TWO_OUT_OF_THREE,
    tripSetpoint: '36.8 m (98.5% tank volumetric capacity)',
    normalOperatingPoint: '28.0 m',
    tripInitiator: 'LNG liquid level exceeds 36.8 meters (98.5% tank volumetric capacity)',
    executiveActions: [
      'Close LNG rundown inlet ESDV 50-ESDV-5001 to Tank A',
      'Divert LNG production to secondary Tank B if available, else initiate Liquefaction Train Rundown Trip',
      'Sound high-decibel audible alarm and visual beacons across tank farm'
    ],
    resetPhilosophy: 'Level must subside below 35.0 meters with management of change (MOC) formal sign-off.'
  });

  return builder;
}

module.exports = {
  CONTROL_TYPES,
  VOTING_LOGIC,
  ESD_LEVELS,
  ControlNarrativeBuilder,
  createWorldScaleLngControlNarratives
};
