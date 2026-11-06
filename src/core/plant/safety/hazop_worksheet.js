/**
 * IEC 61882 Hazard and Operability (HAZOP) Study Worksheet Generator.
 *
 * Implements standard functional safety and process hazard analysis (PHA):
 *  - Standard IEC 61882 Guidewords (No, Less, More, Reverse, As Well As, Part Of, Other Than).
 *  - Process Parameters: Flow, Pressure, Temperature, Level, Composition, Relief, Maintenance, Utilities.
 *  - Structured HAZOP Deviation entries with Causes, Consequences, Safeguards, and Actions.
 *  - 5x5 Industrial Risk Matrix (Severity 1-5, Likelihood 1-5, Risk Priority Ranking).
 *  - Pre-engineered HAZOP node templates for standard LNG complex operations:
 *      * Node 1: Feed Gas Reception & Acid Gas Treating (Amine)
 *      * Node 2: Liquefaction Main Cryogenic Heat Exchanger (MCHE) & Refrigerant
 *      * Node 3: NGL Recovery & Fractionation
 *      * Node 4: LNG Storage & Boil-Off Gas (BOG) Compression
 *      * Node 5: Marine Loading & Regasification
 *      * Node 6: Claus Sulfur Recovery Unit (SRU)
 *  - Formatted export to CSV (RFC 4180), JSON, and Markdown documentation.
 */

'use strict';

/**
 * Standard IEC 61882 Guidewords.
 */
const IEC_61882_GUIDEWORDS = Object.freeze([
  'NO / NOT',
  'LESS',
  'MORE',
  'REVERSE',
  'AS WELL AS',
  'PART OF',
  'OTHER THAN'
]);

/**
 * Standard Process Parameters.
 */
const PROCESS_PARAMETERS = Object.freeze([
  'Flow',
  'Pressure',
  'Temperature',
  'Level',
  'Composition',
  'Phase / State',
  'Relief / Containment',
  'Utilities',
  'Maintenance / Operations'
]);

/**
 * Standard 5x5 Risk Matrix evaluation.
 */
const RISK_MATRIX = Object.freeze({
  severityLevels: {
    1: 'Minor (Negligible impact, first aid)',
    2: 'Low (Minor injury, slight plant damage)',
    3: 'Moderate (Lost time injury, localized fire/spill)',
    4: 'High (Single fatality, severe asset loss)',
    5: 'Critical (Multiple fatalities, catastrophic offsite release)'
  },
  likelihoodLevels: {
    1: 'Rare (< 1 in 10,000 yr)',
    2: 'Unlikely (1 in 1,000 - 10,000 yr)',
    3: 'Possible (1 in 100 - 1,000 yr)',
    4: 'Likely (1 in 10 - 100 yr)',
    5: 'Frequent (> 1 in 10 yr)'
  },
  /**
   * Calculate risk ranking based on Severity (1-5) and Likelihood (1-5).
   * Score = S * L (1 - 25).
   * @param {number} severity
   * @param {number} likelihood
   * @returns {{score:number, priority:'Low'|'Medium'|'High'|'Critical'}}
   */
  evaluateRisk(severity, likelihood) {
    const s = Math.min(5, Math.max(1, Math.round(severity || 3)));
    const l = Math.min(5, Math.max(1, Math.round(likelihood || 3)));
    const score = s * l;

    let priority = 'Low';
    if (score >= 16) {
      priority = 'Critical';
    } else if (score >= 10) {
      priority = 'High';
    } else if (score >= 5) {
      priority = 'Medium';
    }

    return { score, priority, severity: s, likelihood: l };
  }
});

/**
 * Single HAZOP Worksheet Line Item.
 */
class HazopWorksheetRow {
  /**
   * @param {Object} spec
   * @param {string} spec.rowId Unique row identifier (e.g. '1.1')
   * @param {string} spec.guideword IEC 61882 Guideword (e.g. 'MORE')
   * @param {string} spec.parameter Process parameter (e.g. 'Pressure')
   * @param {string} spec.deviation Specific deviation (e.g. 'More Pressure / Overpressure')
   * @param {string[]} spec.causes List of credible initiating causes
   * @param {string[]} spec.consequences Potential unmitigated consequences
   * @param {string[]} spec.safeguards Existing protection safeguards
   * @param {number} spec.initialSeverity 1 to 5
   * @param {number} spec.initialLikelihood 1 to 5
   * @param {string[]} [spec.recommendations=[]] Proposed action items
   * @param {number} [spec.mitigatedSeverity] 1 to 5 after safeguards/actions
   * @param {number} [spec.mitigatedLikelihood] 1 to 5 after safeguards/actions
   * @param {string} [spec.actionParty='Process / SIS'] Responsible engineering group
   */
  constructor(spec) {
    this.rowId = spec.rowId;
    this.guideword = spec.guideword;
    this.parameter = spec.parameter;
    this.deviation = spec.deviation;
    this.causes = spec.causes || [];
    this.consequences = spec.consequences || [];
    this.safeguards = spec.safeguards || [];
    this.initialRisk = RISK_MATRIX.evaluateRisk(spec.initialSeverity, spec.initialLikelihood);
    this.recommendations = spec.recommendations || [];
    this.actionParty = spec.actionParty || 'Process / Instrumentation';

    const mitS = spec.mitigatedSeverity !== undefined ? spec.mitigatedSeverity : spec.initialSeverity;
    const mitL = spec.mitigatedLikelihood !== undefined ? spec.mitigatedLikelihood : Math.max(1, spec.initialLikelihood - 1);
    this.mitigatedRisk = RISK_MATRIX.evaluateRisk(mitS, mitL);
  }
}

/**
 * HAZOP Study Node.
 */
class HazopNode {
  /**
   * @param {Object} spec
   * @param {number|string} spec.nodeNumber Node identifier (e.g. 1)
   * @param {string} spec.name Node descriptive title
   * @param {string} spec.designIntent Process design intent and operating parameters
   * @param {string} spec.boundary System boundaries (e.g. from battery limit to V-101 inlet)
   * @param {string} [spec.pidReferences='P&ID-1001'] Drawing references
   */
  constructor(spec) {
    this.nodeNumber = spec.nodeNumber;
    this.name = spec.name;
    this.designIntent = spec.designIntent;
    this.boundary = spec.boundary;
    this.pidReferences = spec.pidReferences || 'P&ID-001';
    this.rows = [];
  }

  /**
   * Add a deviation worksheet row to the node.
   * @param {HazopWorksheetRow|Object} row
   * @returns {HazopWorksheetRow}
   */
  addRow(row) {
    const r = row instanceof HazopWorksheetRow ? row : new HazopWorksheetRow(row);
    this.rows.push(r);
    return r;
  }
}

/**
 * Master HAZOP Study Worksheet Generator.
 */
class HazopStudyGenerator {
  /**
   * @param {Object} [spec]
   * @param {string} [spec.title='LNG Facility IEC 61882 HAZOP Study']
   * @param {string} [spec.facility='World-Scale LNG Export Terminal']
   * @param {string} [spec.team='Lead Process Engineer, Safety Lead, Operations Lead']
   */
  constructor(spec = {}) {
    this.title = spec.title || 'LNG Complex Process HAZOP Study';
    this.facility = spec.facility || 'LNG Plant & Utilities Complex';
    this.team = spec.team || 'Process, SIS, Operations, Mechanical';
    this.date = new Date().toISOString().split('T')[0];
    this.nodes = [];
  }

  /**
   * Add a node to the study.
   * @param {HazopNode|Object} node
   * @returns {HazopNode}
   */
  addNode(node) {
    const n = node instanceof HazopNode ? node : new HazopNode(node);
    this.nodes.push(n);
    return n;
  }

  /**
   * Automatically generate the standard 6 pre-engineered LNG complex HAZOP nodes.
   * Covers Feed Treating, Liquefaction MCHE, Fractionation, LNG Storage/BOG, Marine Loading, and SRU.
   */
  populateStandardLngNodes() {
    // -------------------------------------------------------------
    // Node 1: Feed Gas Reception & Amine Acid Gas Treating
    // -------------------------------------------------------------
    const node1 = this.addNode({
      nodeNumber: 1,
      name: 'Feed Gas Reception & Amine Acid Gas Removal Unit (AGRU)',
      designIntent: 'Separate liquids and remove CO2 to < 50 ppmv and H2S to < 4 ppmv at 65 barg and 35°C',
      boundary: 'From plant battery limit ESDV-1001 to Slug Catcher V-101 and Amine Absorber C-101',
      pidReferences: 'P&ID-01, P&ID-02'
    });

    node1.addRow({
      rowId: '1.1',
      guideword: 'MORE',
      parameter: 'Pressure',
      deviation: 'More Pressure / Severe Upstream Surge',
      causes: ['Upstream pipeline compressor surge', 'Amine absorber downstream control valve PCV-101 fails closed'],
      consequences: ['Overpressure of slug catcher V-101', 'Potential flange leak or vessel rupture'],
      safeguards: ['PAHH-101 (2oo3) trips feed ESDV-1001', 'Full-flow relief valve PSV-101 sized for fire & blocked outlet'],
      initialSeverity: 4,
      initialLikelihood: 3,
      recommendations: ['Verify PSV-101 inlet piping pressure drop does not exceed 3% per API 520'],
      mitigatedSeverity: 4,
      mitigatedLikelihood: 1,
      actionParty: 'Process / Piping'
    });

    node1.addRow({
      rowId: '1.2',
      guideword: 'LESS',
      parameter: 'Flow',
      deviation: 'Less / Loss of Lean Amine Flow to Absorber',
      causes: ['Lean amine circulation pump P-101A/B trip', 'Strainers plugged'],
      consequences: ['Inadequate acid gas stripping', 'CO2 and H2S breakthrough into downstream cryogenic liquefaction unit', 'Freezing and blockage of MCHE tubes'],
      safeguards: ['Auto-start of standby pump P-101B on low header pressure', 'FALL-102 trips feed gas to absorber if amine flow lost for > 60s'],
      initialSeverity: 4,
      initialLikelihood: 3,
      recommendations: ['Install online CO2 analyzer with executive trip interlock prior to molecular sieve dehydrators'],
      mitigatedSeverity: 4,
      mitigatedLikelihood: 1,
      actionParty: 'Instrumentation / SIS'
    });

    // -------------------------------------------------------------
    // Node 2: Liquefaction Main Cryogenic Heat Exchanger (MCHE)
    // -------------------------------------------------------------
    const node2 = this.addNode({
      nodeNumber: 2,
      name: 'Liquefaction MCHE & Mixed Refrigerant (MR) Cycle',
      designIntent: 'Subcool treated natural gas from -30°C to -162°C at 55 barg using mixed refrigerant',
      boundary: 'From molecular sieve outlet to MCHE E-201 and LNG subcooler',
      pidReferences: 'P&ID-05, P&ID-06'
    });

    node2.addRow({
      rowId: '2.1',
      guideword: 'LESS',
      parameter: 'Temperature',
      deviation: 'Less Temperature / Cryogenic Embrittlement of Carbon Steel Piping',
      causes: ['Downstream LNG depressuring or backflow into warm upstream piping during shutdown'],
      consequences: ['Thermal shock and brittle failure of carbon steel piping upstream of stainless steel boundary'],
      safeguards: ['TALL-201 low temperature interlock trips ESDV-2001', 'Dual cryogenic check valves in series'],
      initialSeverity: 5,
      initialLikelihood: 2,
      recommendations: ['Extend austenitic stainless steel (SS316L) piping boundary 10 meters upstream of MCHE inlet'],
      mitigatedSeverity: 5,
      mitigatedLikelihood: 1,
      actionParty: 'Materials / Piping'
    });

    node2.addRow({
      rowId: '2.2',
      guideword: 'MORE',
      parameter: 'Pressure',
      deviation: 'More Pressure / MR Compressor Settling-out Overpressure',
      causes: ['Emergency trip of MR compressor driver (Gas Turbine)', 'Thermal expansion of trapped liquid MR'],
      consequences: ['Exceeding maximum design settling pressure of MR suction scrubbers and heat exchanger shell'],
      safeguards: ['Fast-opening anti-surge recycle valves', 'PSV-202 on MR suction drum', 'Flare depressuring BDV'],
      initialSeverity: 4,
      initialLikelihood: 3,
      recommendations: ['Confirm settling-out pressure calculation accounts for warm ambient soak temperature'],
      mitigatedSeverity: 4,
      mitigatedLikelihood: 1,
      actionParty: 'Process / Rotating'
    });

    // -------------------------------------------------------------
    // Node 3: NGL Recovery & Fractionation
    // -------------------------------------------------------------
    const node3 = this.addNode({
      nodeNumber: 3,
      name: 'NGL Recovery & Fractionation (Demethanizer / Deethanizer)',
      designIntent: 'Separate heavy hydrocarbons (C2, C3, C4, C5+) to prevent freeze-out in MCHE',
      boundary: 'Scrub column C-301 and Deethanizer C-302',
      pidReferences: 'P&ID-04'
    });

    node3.addRow({
      rowId: '3.1',
      guideword: 'MORE',
      parameter: 'Level',
      deviation: 'More Level / Scrub Column Bottoms Liquid Carryover',
      causes: ['Bottoms level control valve LCV-301 fails shut', 'Bottoms transfer pump trip'],
      consequences: ['Heavy hydrocarbon carryover into cold box overhead', 'Plugging and wax deposition in cryogenic passes'],
      safeguards: ['LAHH-301 (2oo3) trips feed to column and closes suction ESDV'],
      initialSeverity: 3,
      initialLikelihood: 3,
      recommendations: ['Provide independent radar level transmitter for LAHH-301 dedicated to SIS'],
      mitigatedSeverity: 3,
      mitigatedLikelihood: 1,
      actionParty: 'Instrumentation'
    });

    // -------------------------------------------------------------
    // Node 4: LNG Storage Tank & Boil-Off Gas (BOG) Compression
    // -------------------------------------------------------------
    const node4 = this.addNode({
      nodeNumber: 4,
      name: 'Full Containment LNG Storage Tank & BOG Recovery',
      designIntent: 'Store refrigerated LNG at -162°C and 150 mbarg; recompress boil-off gas',
      boundary: 'LNG Tanks TK-401A/B and BOG Compressors K-401A/B',
      pidReferences: 'P&ID-07, P&ID-08'
    });

    node4.addRow({
      rowId: '4.1',
      guideword: 'OTHER THAN',
      parameter: 'Composition',
      deviation: 'Stratification and Rollover in Storage Tank',
      causes: ['Introduction of differing density LNG run into tank without adequate top/bottom fill mixing'],
      consequences: ['Spontaneous massive flash of trapped lower LNG layer (rollover)', 'Sudden extreme BOG evolution exceeding flare relief capacity'],
      safeguards: ['Density / temperature profiling probes throughout tank liquid height', 'Dual top and bottom filling nozzle selection manifolds'],
      initialSeverity: 5,
      initialLikelihood: 2,
      recommendations: ['Implement automated density logging and top/bottom fill selection based on feed density'],
      mitigatedSeverity: 5,
      mitigatedLikelihood: 1,
      actionParty: 'Operations / Process'
    });

    node4.addRow({
      rowId: '4.2',
      guideword: 'LESS',
      parameter: 'Pressure',
      deviation: 'Less Pressure / Vacuum in LNG Tank',
      causes: ['Sudden barometric rise', 'Rapid LNG sendout pumpage without sufficient vapor return'],
      consequences: ['Inner tank collapse or insulation damage due to external atmospheric overpressure'],
      safeguards: ['PALL-401 trips LNG export pumps', 'Vacuum relief valves venting in dry nitrogen / air as last resort'],
      initialSeverity: 5,
      initialLikelihood: 2,
      recommendations: ['Provide pilot-operated vacuum relief valves set at -5 mbarg with dedicated heated air/nitrogen intake'],
      mitigatedSeverity: 5,
      mitigatedLikelihood: 1,
      actionParty: 'Mechanical / Valves'
    });

    // -------------------------------------------------------------
    // Node 5: Marine Loading & Regasification
    // -------------------------------------------------------------
    const node5 = this.addNode({
      nodeNumber: 5,
      name: 'Marine Jetty LNG Loading Arms & Regasification Sendout',
      designIntent: 'Transfer LNG at 10,000 m^3/h to LNG carrier via loading arms with PERC emergency release',
      boundary: 'Jetty loading arms ML-501A-D and vapor return arm',
      pidReferences: 'P&ID-09, P&ID-10'
    });

    node5.addRow({
      rowId: '5.1',
      guideword: 'OTHER THAN',
      parameter: 'Containment',
      deviation: 'Ship Movement / Loading Arm Drift Exceeding Envelope',
      causes: ['Mooring line rupture during storm or surge wave'],
      consequences: ['Mechanical overextension of loading arms, cryogenic rupture, catastrophic LNG pool spill on seawater'],
      safeguards: ['Powered Emergency Release Couplers (PERC) with dual dry-break ball valves', 'ESD-1 jetty trip with hydraulic quick release'],
      initialSeverity: 5,
      initialLikelihood: 2,
      recommendations: ['Periodic proof test of jetty optical laser vessel drift monitoring system and dry-break release'],
      mitigatedSeverity: 5,
      mitigatedLikelihood: 1,
      actionParty: 'Marine / Safety'
    });

    // -------------------------------------------------------------
    // Node 6: Claus Sulfur Recovery Unit (SRU)
    // -------------------------------------------------------------
    const node6 = this.addNode({
      nodeNumber: 6,
      name: 'Sour Gas Treatment & Claus Sulfur Recovery Unit (SRU)',
      designIntent: 'Convert concentrated H2S acid gas into elemental sulfur via thermal stage and catalytic converters',
      boundary: 'Claus Reaction Furnace F-601 and Waste Heat Boiler E-601',
      pidReferences: 'P&ID-11'
    });

    node6.addRow({
      rowId: '6.1',
      guideword: 'MORE',
      parameter: 'Temperature',
      deviation: 'High Temperature / Thermal Runaway in Reaction Furnace',
      causes: ['Air-to-acid gas ratio control failure (excess oxygen combustion)'],
      consequences: ['Refractory brick failure, tube sheet overheating in waste heat boiler, lethal H2S release'],
      safeguards: ['TAHH-601 optical pyrometer trips acid gas feed valve', 'Ratio control with oxygen trim analyzer'],
      initialSeverity: 5,
      initialLikelihood: 3,
      recommendations: ['Install dual redundant infrared pyrometers for furnace flame temperature monitoring'],
      mitigatedSeverity: 5,
      mitigatedLikelihood: 1,
      actionParty: 'Instrumentation / Safety'
    });
  }

  /**
   * Export all study nodes and rows into standard RFC 4180 CSV text.
   * @returns {string} CSV text
   */
  toCsv() {
    const lines = [];
    lines.push(`"${this.title}","Facility: ${this.facility}","Team: ${this.team}","Date: ${this.date}"`);
    lines.push('');

    const headers = [
      'Node No.',
      'Node Name',
      'Row ID',
      'Guideword',
      'Parameter',
      'Deviation',
      'Causes',
      'Consequences',
      'Safeguards',
      'Init Severity',
      'Init Likelihood',
      'Init Risk Rank',
      'Recommendations',
      'Mit Severity',
      'Mit Likelihood',
      'Mit Risk Rank',
      'Action Discipline'
    ];
    lines.push(headers.map((h) => `"${h}"`).join(','));

    for (const node of this.nodes) {
      for (const row of node.rows) {
        const line = [
          node.nodeNumber,
          node.name,
          row.rowId,
          row.guideword,
          row.parameter,
          row.deviation,
          row.causes.join('; '),
          row.consequences.join('; '),
          row.safeguards.join('; '),
          row.initialRisk.severity,
          row.initialRisk.likelihood,
          row.initialRisk.priority,
          row.recommendations.join('; '),
          row.mitigatedRisk.severity,
          row.mitigatedRisk.likelihood,
          row.mitigatedRisk.priority,
          row.actionParty
        ];
        lines.push(line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
      }
    }

    return lines.join('\n');
  }

  /**
   * Export study as JSON data.
   * @returns {Object}
   */
  toJson() {
    return {
      title: this.title,
      facility: this.facility,
      team: this.team,
      date: this.date,
      totalNodes: this.nodes.length,
      totalRows: this.nodes.reduce((acc, n) => acc + n.rows.length, 0),
      nodes: this.nodes.map((n) => ({
        nodeNumber: n.nodeNumber,
        name: n.name,
        designIntent: n.designIntent,
        boundary: n.boundary,
        pidReferences: n.pidReferences,
        rows: n.rows.map((r) => ({
          rowId: r.rowId,
          guideword: r.guideword,
          parameter: r.parameter,
          deviation: r.deviation,
          causes: r.causes,
          consequences: r.consequences,
          safeguards: r.safeguards,
          initialRisk: r.initialRisk,
          recommendations: r.recommendations,
          mitigatedRisk: r.mitigatedRisk,
          actionParty: r.actionParty
        }))
      }))
    };
  }

  /**
   * Export study as clean Markdown table documentation.
   * @returns {string} Markdown text
   */
  toMarkdown() {
    const chunks = [];
    chunks.push(`# ${this.title}`);
    chunks.push(`**Facility:** ${this.facility} | **Date:** ${this.date} | **Team:** ${this.team}\n`);

    for (const node of this.nodes) {
      chunks.push(`## Node ${node.nodeNumber}: ${node.name}`);
      chunks.push(`- **Design Intent:** ${node.designIntent}`);
      chunks.push(`- **Boundary:** ${node.boundary}`);
      chunks.push(`- **P&ID References:** ${node.pidReferences}\n`);

      chunks.push('| ID | Deviation | Causes | Consequences | Safeguards | Init Risk | Recommendations | Mit Risk | Action |');
      chunks.push('|---|---|---|---|---|---|---|---|---|');

      const cleanMd = (s) => String(s || '').replace(/\|/g, '\\|');
      for (const r of node.rows) {
        const causes = r.causes.map(cleanMd).join('<br>');
        const consequences = r.consequences.map(cleanMd).join('<br>');
        const safeguards = r.safeguards.map(cleanMd).join('<br>');
        const recs = r.recommendations.map(cleanMd).join('<br>');
        chunks.push(
          `| ${r.rowId} | **${cleanMd(r.deviation)}** | ${causes} | ${consequences} | ${safeguards} | ${r.initialRisk.priority} (S${r.initialRisk.severity}/L${r.initialRisk.likelihood}) | ${recs} | ${r.mitigatedRisk.priority} (S${r.mitigatedRisk.severity}/L${r.mitigatedRisk.likelihood}) | ${cleanMd(r.actionParty)} |`
        );
      }
      chunks.push('\n');
    }

    return chunks.join('\n');
  }
}

module.exports = {
  IEC_61882_GUIDEWORDS,
  PROCESS_PARAMETERS,
  RISK_MATRIX,
  HazopWorksheetRow,
  HazopNode,
  HazopStudyGenerator
};
