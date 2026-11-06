/**
 * Layer of Protection Analysis (CCPS LOPA) Engine.
 *
 * Implements standard Center for Chemical Process Safety (CCPS) LOPA methodology:
 *  - Initiating event frequency database (per year) for process equipment and control failures.
 *  - Conditional modifiers: probability of occupancy, ignition, and vulnerability.
 *  - Independent Protection Layer (IPL) credit evaluation (PFD calculation, independence checks).
 *  - Mitigated consequence frequency determination vs tolerable risk targets.
 *  - Required Risk Reduction Factor (RRF) and SIF SIL target allocation.
 */

'use strict';

/**
 * Standard CCPS published initiating event frequencies (events per year).
 * Reference: CCPS "Layer of Protection Analysis: Simplified Process Risk Assessment".
 */
const INITIATING_EVENT_FREQUENCIES = Object.freeze({
  bpcs_control_loop_failure: {
    description: 'BPCS single control loop failure (runaway or closed)',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  bpcs_transmitter_failure: {
    description: 'Process sensor / transmitter undetected failure or drift',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  cooling_water_failure: {
    description: 'Total loss of cooling water to process unit',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  power_failure_total: {
    description: 'Loss of normal electrical power supply',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  instrument_air_failure: {
    description: 'Loss of instrument air pressure',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  pump_mechanical_seal_failure: {
    description: 'Single mechanical seal failure on flammable liquid pump',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  operator_routine_error: {
    description: 'Operator error during well-practiced, routine task with procedure',
    frequencyPerYear: 0.01,
    source: 'CCPS LOPA Table 5.1'
  },
  operator_stress_error: {
    description: 'Operator error during upset condition or high-stress scenario',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  },
  heat_exchanger_tube_rupture: {
    description: 'Single shell-and-tube heat exchanger tube failure',
    frequencyPerYear: 0.01,
    source: 'CCPS LOPA Table 5.1'
  },
  small_pipe_leak: {
    description: 'Small line / fitting pinhole leak (<= 10 mm hole)',
    frequencyPerYear: 0.01,
    source: 'CCPS LOPA Table 5.1'
  },
  pipe_rupture: {
    description: 'Full-bore catastrophic piping rupture (> 100 mm)',
    frequencyPerYear: 0.0001,
    source: 'CCPS LOPA Table 5.1'
  },
  vessel_rupture: {
    description: 'Catastrophic rupture of pressure vessel or column',
    frequencyPerYear: 0.00001,
    source: 'CCPS LOPA Table 5.1'
  },
  unloading_hose_failure: {
    description: 'Transfer hose failure during loading/unloading',
    frequencyPerYear: 0.1,
    source: 'CCPS LOPA Table 5.1'
  }
});

/**
 * Standard CCPS published IPL credit rules and nominal PFD values.
 */
const STANDARD_IPL_CREDITS = Object.freeze({
  bpcs_interlock: {
    description: 'Basic Process Control System interlock loop',
    pfd: 0.1, // RRF = 10
    maxCreditsAllowed: 1,
    notes: 'Permitted only if independent of initiating event and control sensor'
  },
  operator_alarm_and_intervention: {
    description: 'Operator response to independent alarm with clear procedure and >= 10 min response time',
    pfd: 0.1, // RRF = 10
    maxCreditsAllowed: 1,
    notes: 'Requires dedicated alarm, unambiguous diagnostic, and sufficient response window'
  },
  psv_spring_loaded: {
    description: 'Conventional or balanced bellows spring-loaded relief valve',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Must be sized per API 520 and inspected on scheduled frequency'
  },
  psv_pilot_operated: {
    description: 'Pilot-operated relief valve (POSV)',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Properly maintained for non-plugging service'
  },
  rupture_disc: {
    description: 'Bursting rupture disc alone or beneath PSV',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Passive mechanical relief'
  },
  dike_bund_containment: {
    description: 'Secondary containment dike or spill impoundment basin',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Passive containment for liquid pool hazard reduction'
  },
  flame_arrestor: {
    description: 'In-line or end-of-line detonation/deflagration arrestor',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Passive flame barrier, inspected for fouling'
  },
  blast_wall: {
    description: 'Reinforced concrete blast-deflecting wall',
    pfd: 0.01, // RRF = 100
    maxCreditsAllowed: 1,
    notes: 'Passive barrier mitigating overpressure exposure'
  },
  check_valve_dual: {
    description: 'Dual check valves in series under regular inspection program',
    pfd: 0.1, // RRF = 10
    maxCreditsAllowed: 1,
    notes: 'Dual independent valves; single check valve generally receives 0 credit in CCPS LOPA'
  }
});

/**
 * Standard CCPS corporate risk tolerability targets for corporate and community safety.
 */
const DEFAULT_RISK_TARGETS = Object.freeze({
  catastrophic: {
    label: 'Catastrophic (Multiple Fatalities / Severe Offsite Impact)',
    targetFrequencyPerYear: 1.0e-6,
    tolerableMaxRisk: 1.0e-6
  },
  major: {
    label: 'Major (Single Fatality Onsite / Severe Disability / Moderate Offsite)',
    targetFrequencyPerYear: 1.0e-5,
    tolerableMaxRisk: 1.0e-5
  },
  moderate: {
    label: 'Moderate (Severe Lost-Time Injury / Significant Asset Loss)',
    targetFrequencyPerYear: 1.0e-4,
    tolerableMaxRisk: 1.0e-4
  },
  minor: {
    label: 'Minor (First Aid Injury / Minor Spill within Bund)',
    targetFrequencyPerYear: 1.0e-3,
    tolerableMaxRisk: 1.0e-3
  }
});

/**
 * CCPS Layer of Protection Analysis (LOPA) Scenario Evaluator.
 */
class LopaScenario {
  /**
   * @param {Object} spec
   * @param {string} spec.id Scenario identifier (e.g. 'LOPA-LNG-001')
   * @param {string} spec.description Description of scenario
   * @param {string} spec.initiatingEvent Initiating event name or custom key
   * @param {number} [spec.initiatingFrequency] Custom frequency per year (overrides table)
   * @param {'catastrophic'|'major'|'moderate'|'minor'} [spec.severity='major'] Consequence severity
   * @param {number} [spec.customTargetFrequency] Custom tolerable risk target (per year)
   * @param {Object} [spec.conditionalModifiers] Probabilities <= 1.0
   * @param {number} [spec.conditionalModifiers.occupancy=1.0] Probability of personnel in area
   * @param {number} [spec.conditionalModifiers.ignition=1.0] Probability of ignition given release
   * @param {number} [spec.conditionalModifiers.vulnerability=1.0] Probability of injury/fatality
   * @param {Array<Object>} [spec.ipls=[]] List of credited Independent Protection Layers
   */
  constructor(spec) {
    this.id = spec.id || 'LOPA-001';
    this.description = spec.description || 'Process overpressure scenario';
    this.initiatingEvent = spec.initiatingEvent;
    this.severity = spec.severity || 'major';

    // Resolve initiating event frequency
    if (spec.initiatingFrequency !== undefined) {
      if (spec.initiatingFrequency < 0 || !Number.isFinite(spec.initiatingFrequency)) {
        throw new RangeError('initiatingFrequency must be a non-negative finite number');
      }
      this.initiatingFrequency = spec.initiatingFrequency;
    } else if (INITIATING_EVENT_FREQUENCIES[spec.initiatingEvent]) {
      this.initiatingFrequency = INITIATING_EVENT_FREQUENCIES[spec.initiatingEvent].frequencyPerYear;
    } else {
      this.initiatingFrequency = 0.1; // Default conservative 1 event in 10 years
    }

    // Resolve target frequency
    if (spec.customTargetFrequency !== undefined) {
      if (spec.customTargetFrequency <= 0 || !Number.isFinite(spec.customTargetFrequency)) {
        throw new RangeError('customTargetFrequency must be a positive finite number');
      }
      this.targetFrequency = spec.customTargetFrequency;
    } else if (DEFAULT_RISK_TARGETS[this.severity]) {
      this.targetFrequency = DEFAULT_RISK_TARGETS[this.severity].targetFrequencyPerYear;
    } else {
      this.targetFrequency = 1.0e-5;
    }

    // Conditional modifiers
    const mods = spec.conditionalModifiers || {};
    this.occupancy = mods.occupancy !== undefined ? Math.min(1.0, Math.max(0.0, mods.occupancy)) : 1.0;
    this.ignition = mods.ignition !== undefined ? Math.min(1.0, Math.max(0.0, mods.ignition)) : 1.0;
    this.vulnerability = mods.vulnerability !== undefined ? Math.min(1.0, Math.max(0.0, mods.vulnerability)) : 1.0;

    // Protection layers
    this.ipls = [];
    if (Array.isArray(spec.ipls)) {
      for (const ipl of spec.ipls) {
        this.addIpl(ipl);
      }
    }
  }

  /**
   * Add a credited Independent Protection Layer to the scenario.
   * @param {Object} ipl
   * @param {string} ipl.name Identifier/tag for the IPL
   * @param {string} [ipl.type] Preset type from STANDARD_IPL_CREDITS
   * @param {number} [ipl.pfd] Probability of Failure on Demand (e.g. 0.1 or 0.01)
   * @param {boolean} [ipl.independentOfInitiator=true] Must be true to receive credit
   */
  addIpl(ipl) {
    let pfd = ipl.pfd;
    if (pfd === undefined && ipl.type && STANDARD_IPL_CREDITS[ipl.type]) {
      pfd = STANDARD_IPL_CREDITS[ipl.type].pfd;
    }
    if (pfd === undefined || pfd <= 0 || pfd > 1.0) {
      pfd = 0.1; // Default nominal IPL credit
    }

    const independent = ipl.independentOfInitiator !== undefined ? ipl.independentOfInitiator : true;
    this.ipls.push({
      name: ipl.name || `IPL-${this.ipls.length + 1}`,
      type: ipl.type || 'custom',
      pfd,
      rrf: 1.0 / pfd,
      independentOfInitiator: independent,
      credited: independent
    });
  }

  /**
   * Evaluate the LOPA scenario:
   * 1. Unmitigated consequence frequency = f_IE
   * 2. Total conditional modifier = Occupancy * Ignition * Vulnerability
   * 3. Total existing IPL credit = product of credited IPL PFDs
   * 4. Mitigated consequence frequency without SIF = f_IE * Modifiers * IPLs
   * 5. Required RRF = f_mitigated / f_target
   * 6. Required SIL determination.
   *
   * @returns {Object} Comprehensive LOPA calculation report
   */
  evaluate() {
    const totalModifier = this.occupancy * this.ignition * this.vulnerability;

    // Filter to only credited IPLs (must be independent of initiating event)
    let cumulativeIplPfd = 1.0;
    const evaluatedIpls = this.ipls.map((ipl) => {
      // CCPS rule: if initiating event was BPCS failure, BPCS cannot be credited as an IPL
      let isEligible = ipl.independentOfInitiator;
      if (
        (this.initiatingEvent === 'bpcs_control_loop_failure' ||
          this.initiatingEvent === 'bpcs_transmitter_failure') &&
        ipl.type === 'bpcs_interlock'
      ) {
        isEligible = false;
      }

      if (isEligible) {
        cumulativeIplPfd *= ipl.pfd;
      }

      return {
        ...ipl,
        credited: isEligible
      };
    });

    const mitigatedFrequencyWithoutSif = this.initiatingFrequency * totalModifier * cumulativeIplPfd;
    const requiredRrf = mitigatedFrequencyWithoutSif / this.targetFrequency;
    const requiredPfd = requiredRrf > 1.0 ? 1.0 / requiredRrf : 1.0;

    let requiredSil = 0;
    let silTargetLabel = 'No SIF Required';

    if (requiredRrf > 1.0 && requiredRrf < 10.0) {
      requiredSil = 0;
      silTargetLabel = 'Marginal (RRF < 10, BPCS/Alarm enhancement recommended)';
    } else if (requiredRrf >= 10.0 && requiredRrf < 100.0) {
      requiredSil = 1;
      silTargetLabel = 'SIL 1';
    } else if (requiredRrf >= 100.0 && requiredRrf < 1000.0) {
      requiredSil = 2;
      silTargetLabel = 'SIL 2';
    } else if (requiredRrf >= 1000.0 && requiredRrf < 10000.0) {
      requiredSil = 3;
      silTargetLabel = 'SIL 3';
    } else if (requiredRrf >= 10000.0) {
      requiredSil = 4;
      silTargetLabel = 'SIL 4 (Recommend Inherently Safer Process Redesign)';
    }

    const riskReductionMetWithoutSif = mitigatedFrequencyWithoutSif <= this.targetFrequency;

    return {
      scenarioId: this.id,
      description: this.description,
      initiatingEvent: this.initiatingEvent,
      initiatingFrequencyPerYear: this.initiatingFrequency,
      severityCategory: this.severity,
      targetFrequencyPerYear: this.targetFrequency,
      modifiers: {
        occupancy: this.occupancy,
        ignition: this.ignition,
        vulnerability: this.vulnerability,
        combinedModifier: totalModifier
      },
      ipls: evaluatedIpls,
      totalIplPfd: cumulativeIplPfd,
      totalIplRrf: cumulativeIplPfd > 0 ? 1.0 / cumulativeIplPfd : 0,
      mitigatedFrequencyWithoutSif,
      riskReductionMetWithoutSif,
      requiredRrf: Math.max(1.0, requiredRrf),
      requiredPfdTarget: requiredPfd,
      requiredSil,
      silTargetLabel
    };
  }
}

/**
 * Multi-scenario LOPA Study Manager.
 */
class LopaStudy {
  constructor(studyName = 'LNG Complex LOPA Study') {
    this.name = studyName;
    this.scenarios = [];
  }

  /**
   * Add a scenario to the study.
   * @param {LopaScenario|Object} scenario
   * @returns {LopaScenario}
   */
  addScenario(scenario) {
    const s = scenario instanceof LopaScenario ? scenario : new LopaScenario(scenario);
    this.scenarios.push(s);
    return s;
  }

  /**
   * Evaluate all scenarios in the study and generate aggregate summary.
   * @returns {Object}
   */
  evaluateAll() {
    const results = this.scenarios.map((s) => s.evaluate());
    const countBySil = {
      'No SIF': 0,
      'SIL 1': 0,
      'SIL 2': 0,
      'SIL 3': 0,
      'SIL 4': 0
    };

    for (const r of results) {
      if (r.requiredSil === 0) countBySil['No SIF']++;
      else if (r.requiredSil === 1) countBySil['SIL 1']++;
      else if (r.requiredSil === 2) countBySil['SIL 2']++;
      else if (r.requiredSil === 3) countBySil['SIL 3']++;
      else if (r.requiredSil >= 4) countBySil['SIL 4']++;
    }

    return {
      studyName: this.name,
      totalScenarios: results.length,
      silDistribution: countBySil,
      scenarioResults: results
    };
  }
}

module.exports = {
  INITIATING_EVENT_FREQUENCIES,
  STANDARD_IPL_CREDITS,
  DEFAULT_RISK_TARGETS,
  LopaScenario,
  LopaStudy
};
