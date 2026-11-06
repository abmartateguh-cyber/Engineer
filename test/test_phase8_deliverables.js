/**
 * Comprehensive Verification Test Suite for Phase 8 Deliverables:
 * Multi-Discipline FEED Package for World-Scale LNG Plant (5.0 MTPA).
 *
 * Covers:
 * 1. Master Piping Line List Generator (line_list.js)
 *    - Schedule rows across all 11 units
 *    - ASME B31.3 §345 hydrotest and pneumatic test pressures
 *    - NDE radiography percentages and PED 2014/68/EU categories
 *    - Tabular Markdown and CSV exports
 * 2. API / TEMA / ISA Equipment Datasheets (equipment_datasheets.js)
 *    - API 610 Centrifugal & Cryogenic VS6 Submerged LNG Pumps
 *    - API 617 Centrifugal Compressors (C3, MR, BOG) with API 684 rotordynamics
 *    - TEMA Shell & Tube and Brazed Aluminum Plate-Fin MCHE Exchangers
 *    - ASME Section VIII Div 1/2 Pressure Vessels, Columns, and Storage Tanks
 *    - API 526 Pressure Safety Relief Valves with API 520 sizing and dual flare routing
 *    - ISA-75.25 Control Valves with ISA-75.01 Cv sizing and IEC 60534 noise
 *    - Markdown and standalone HTML exports
 * 3. Master Plant Equipment List & Civil Load Schedule (equipment_list.js)
 *    - Aggregates all tagged equipment across Units 10 to 95
 *    - Dry, operating, and hydrotest weights
 *    - ACI 351.3R dynamic machine factors and civil foundation loads
 *    - Concrete foundation volumes and anchor bolt sizing
 * 4. Industrial Plant Plot Plan & Layout Engine (plot_plan.js)
 *    - Scaled site grid positioning for all 11 units
 *    - OGP 454 / CCPS / GAP 2.5.2 / NFPA 59A inter-unit separation verification
 *    - Prevailing wind alignment and downwind flare placement
 *    - Scaled SVG generation with hazardous area overlays
 * 5. Master Multi-Discipline FEED Package Compiler (feed_package_export.js)
 *    - Assembles all engineering disciplines into unified FEED dossier
 *    - Document register, revision block, and cross-references
 *    - Markdown, HTML, and file directory exports
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  MasterLineListGenerator,
  EquipmentDatasheetGenerator,
  MasterEquipmentListGenerator,
  PlantPlotPlanEngine,
  FeedPackageCompiler,
  PlantEngineeringMasterApi
} = require('../src/core/plant/plant_engineering_master_api');

describe('Phase 8 Multi-Discipline FEED Deliverables Package', () => {

  describe('1. Master Piping Line List Generator (line_list.js)', () => {
    const generator = new MasterLineListGenerator();
    const rows = generator.generateMasterLineList();

    it('generates line schedule rows covering all 11 plant process and utility units', () => {
      assert.ok(rows.length >= 50, `Expected at least 50 lines, got ${rows.length}`);

      const expectedUnits = ['U-10', 'U-20', 'U-30', 'U-35', 'U-40', 'U-50', 'U-60', 'U-70', 'U-80', 'U-90', 'U-95'];
      const foundUnits = new Set(rows.map((r) => r.unitId));

      for (const u of expectedUnits) {
        assert.ok(foundUnits.has(u), `Unit ${u} missing from master line list`);
      }
    });

    it('formats standardized line numbering: NPS"-Fluid-Seq-PipingClass-Insulation', () => {
      const linePattern = /^\d+(\.\d+)?"-[A-Z0-9]+-\d+-[A-Z0-9]+-[A-Z]$/;
      for (const r of rows) {
        assert.ok(linePattern.test(r.lineNumber), `Line number ${r.lineNumber} does not match required format`);
        assert.ok(r.fromTag.includes('/'), `From tag ${r.fromTag} should include tag and nozzle`);
        assert.ok(r.toTag.includes('/'), `To tag ${r.toTag} should include tag and nozzle`);
        assert.ok(r.pidDwgNo.startsWith('PID-'), `P&ID drawing ${r.pidDwgNo} invalid`);
      }
    });

    it('calculates ASME B31.3 §345 hydrotest pressure for standard lines', () => {
      // Find a standard process carbon steel line
      const csLine = rows.find((r) => r.testType === 'Hydrostatic' && r.pipingClass === '600S');
      assert.ok(csLine, 'Expected at least one Class 600S hydrostatic line');

      // Test pressure must be >= 1.5 * P_design per ASME B31.3 §345.4.2
      assert.ok(
        csLine.testPressureBarg >= Number((1.5 * csLine.designPressureBarg).toFixed(1)),
        `Hydrotest pressure ${csLine.testPressureBarg} below 1.5x design ${csLine.designPressureBarg}`
      );
      assert.ok(csLine.testMedium.includes('Water'));
    });

    it('calculates ASME B31.3 §345.5 pneumatic test pressure for cryogenic and dry gas lines', () => {
      // Cryogenic LNG lines cannot tolerate water due to ice blockages in MCHE
      const cryoLine = rows.find((r) => r.pipingClass === '150L' || r.pipingClass === '600L');
      assert.ok(cryoLine, 'Expected at least one cryogenic line');
      assert.equal(cryoLine.testType, 'Pneumatic');
      assert.ok(cryoLine.testMedium.includes('Nitrogen') || cryoLine.testMedium.includes('Air'));

      // Pneumatic test pressure must equal 1.1 * P_design per ASME B31.3 §345.5.4
      const expectedPt = Number((1.1 * cryoLine.designPressureBarg).toFixed(1));
      assert.ok(
        Math.abs(cryoLine.testPressureBarg - expectedPt) < 0.2,
        `Pneumatic test pressure ${cryoLine.testPressureBarg} differs from 1.1x design ${expectedPt}`
      );
    });

    it('assigns ASME B31.3 NDE radiography percentages according to service severity', () => {
      // Cryogenic & sour service lines require 100% RT
      const cryoLine = rows.find((r) => r.pipingClass === '600L' || r.pipingClass === '150L');
      assert.ok(cryoLine.ndeRadiography.includes('100% RT'), 'Cryogenic service must have 100% RT');

      const sourLine = rows.find((r) => r.pipingClass === '600S');
      assert.ok(sourLine.ndeRadiography.includes('100% RT'), 'NACE sour service must have 100% RT');

      // Utility cooling water line requires 0% RT / 100% visual per Category D
      const utilLine = rows.find((r) => r.pipingClass === '150SW');
      if (utilLine) {
        assert.ok(utilLine.ndeRadiography.includes('0% RT'), 'Utility water must specify 0% RT');
      }
    });

    it('classifies lines under EU Pressure Equipment Directive (PED 2014/68/EU)', () => {
      for (const r of rows) {
        assert.ok(['SEP', 'Category I', 'Category II', 'Category III'].includes(r.pedCategory));
      }

      // High pressure large bore gas lines must be Category III
      const hpGasLine = rows.find((r) => r.nps >= 24 && r.operatingPressureBarg > 50.0);
      assert.ok(hpGasLine);
      assert.equal(hpGasLine.pedCategory, 'Category III');
    });

    it('exports line list to tabular Markdown and RFC 4180 CSV formats', () => {
      const md = generator.toMarkdown();
      assert.ok(md.includes('# Master Piping Line List Schedule'));
      assert.ok(md.includes('| Line Number |'));
      assert.ok(md.includes('ASME B31.3'));

      const csv = generator.toCsv();
      const csvLines = csv.trim().split('\n');
      assert.ok(csvLines.length >= 51, 'CSV must contain header + all line rows');
      assert.ok(csvLines[0].includes('Line Number'));
      assert.ok(csvLines[0].includes('Test Press (barg)'));
      assert.ok(csvLines[0].includes('PED Category'));
    });

    it('computes unit-level and line class summaries', () => {
      const summary = generator.getSummary();
      assert.equal(summary.totalLineCount, rows.length);
      assert.ok(summary.testMethods.hydrostatic > 0);
      assert.ok(summary.testMethods.pneumatic > 0);
      assert.ok(summary.linesByPipingClass['600S'] > 0);
      assert.ok(summary.linesByPipingClass['150L'] > 0);
    });

    it('retrieves lines by tag using getLineByTag helper', () => {
      const line = generator.getLineByTag(rows[0].lineNumber);
      assert.ok(line);
      assert.equal(line.lineNumber, rows[0].lineNumber);
    });
  });

  describe('2. API / TEMA / ISA Equipment Datasheets (equipment_datasheets.js)', () => {
    const generator = new EquipmentDatasheetGenerator();
    const datasheets = generator.generateAllDatasheets();

    it('generates complete datasheet catalog covering 6 distinct disciplines', () => {
      assert.ok(datasheets.length >= 10, `Expected at least 10 datasheets, got ${datasheets.length}`);

      const categories = new Set(datasheets.map((d) => d.category));
      assert.ok(categories.has('Pumps'));
      assert.ok(categories.has('Compressors'));
      assert.ok(categories.has('Heat Exchangers'));
      assert.ok(categories.has('Pressure Vessels & Columns'));
      assert.ok(categories.has('Pressure Relief Valves'));
      assert.ok(categories.has('Control Valves'));
    });

    it('evaluates API 610 Centrifugal & Cryogenic VS6 Pump datasheets', () => {
      const vs6Pump = datasheets.find((d) => d.tag === 'P-7001A-C');
      assert.ok(vs6Pump);
      assert.equal(vs6Pump.standard, 'API 610 12th Edition / ISO 13709');
      assert.ok(vs6Pump.pumpType.includes('VS6'));
      assert.equal(vs6Pump.operatingConditions.pumpingTempC, -161.5);
      assert.ok(vs6Pump.operatingConditions.npshMarginM > 1.5, 'NPSH margin must exceed 1.5 m');
      assert.ok(vs6Pump.performance.driverPowerKW >= 800.0);
      assert.equal(vs6Pump.construction.casingDesignTempC, -196.0);
      assert.equal(vs6Pump.construction.hydrotestPressureBarg, 1.5 * vs6Pump.construction.casingDesignPressureBarg);
    });

    it('evaluates API 617 Centrifugal Compressor datasheets with API 684 rotordynamics', () => {
      const mrComp = datasheets.find((d) => d.tag === 'K-6002');
      assert.ok(mrComp);
      assert.equal(mrComp.standard, 'API 617 8th Edition (Axial/Centrifugal Compressors)');
      assert.equal(mrComp.stagesCount, 6);
      assert.ok(mrComp.performance.shaftPowerMW > 40.0, 'MR compressor shaft power > 40 MW');
      assert.ok(mrComp.performance.polytropicEfficiencyPercent >= 80.0);
      assert.ok(mrComp.performance.separationMarginPercent > 20.0, 'API 684 critical speed separation margin > 20%');
      assert.ok(mrComp.mechanical.impellerMaterial.includes('Titanium'));
      assert.ok(mrComp.mechanical.dryGasSealPlan.includes('Dry Gas Seals'));
    });

    it('evaluates TEMA and Brazed Aluminum Plate-Fin MCHE Exchanger datasheets', () => {
      const mche = datasheets.find((d) => d.tag === 'E-6001');
      assert.ok(mche);
      assert.ok(mche.exchangerType.includes('Plate-Fin') || mche.exchangerType.includes('BAHX'));
      assert.equal(mche.thermalRating.dutyMW, 185.0);
      assert.ok(mche.thermalRating.heatTransferAreaM2 >= 50000.0);
      assert.ok(mche.tubeSide.material.includes('Aluminum'));

      const amineExch = datasheets.find((d) => d.tag === 'E-2001');
      assert.ok(amineExch);
      assert.ok(amineExch.exchangerType.includes('AES'));
      assert.equal(amineExch.dutyMW, 42.5);
      assert.ok(amineExch.tubeSide.material.includes('TP316L'));
    });

    it('evaluates ASME Section VIII Pressure Vessel and Storage Tank datasheets', () => {
      const separator = datasheets.find((d) => d.tag === 'V-1001');
      assert.ok(separator);
      assert.ok(separator.mechanicalDesign.nominalShellThicknessMm >= separator.mechanicalDesign.minRequiredThicknessMm);
      assert.equal(separator.mechanicalDesign.pwhtRequired, true);
      assert.equal(separator.designConditions.jointEfficiency, 1.0);

      const lngTank = datasheets.find((d) => d.tag === 'TK-7001A/B');
      assert.ok(lngTank);
      assert.equal(lngTank.dimensions.totalVolumeM3, 160000.0);
      assert.equal(lngTank.designConditions.operatingTempC, -162.0);
      assert.ok(lngTank.mechanicalDesign.shellMaterial.includes('9% Nickel Steel'));
    });

    it('evaluates ASME Section VIII Catalytic Reactor datasheets', () => {
      const reactor = datasheets.find((d) => d.tag === 'R-3501');
      assert.ok(reactor);
      assert.equal(reactor.category, 'Reactors');
      assert.ok(reactor.catalystBed);
      assert.ok(reactor.catalystBed.catalystType.includes('Cobalt-Molybdenum'));
      assert.equal(reactor.catalystBed.catalystVolumeM3, 18.5);
      assert.ok(reactor.mechanicalDesign.nominalShellThicknessMm >= reactor.mechanicalDesign.minRequiredThicknessMm);
      assert.equal(reactor.mechanicalDesign.pwhtRequired, true);
    });

    it('retrieves datasheets by tag using getDatasheetByTag helper', () => {
      const ds = generator.getDatasheetByTag('R-3501');
      assert.ok(ds);
      assert.equal(ds.tag, 'R-3501');
    });

    it('evaluates API 526 Safety Relief Valve datasheets and dual flare destinations', () => {
      const cryoPsv = datasheets.find((d) => d.tag === 'PSV-6001');
      assert.ok(cryoPsv);
      assert.equal(cryoPsv.orificeSizing.selectedOrifice, 'T');
      assert.equal(cryoPsv.orificeSizing.selectedAreaMm2, 3871.0);
      assert.ok(cryoPsv.orificeSizing.areaMarginPercent > 0.0);
      assert.ok(cryoPsv.connectionsAndMaterials.flareDestination.includes('Cold Dry Flare'));

      const sourPsv = datasheets.find((d) => d.tag === 'PSV-1001');
      assert.ok(sourPsv);
      assert.ok(sourPsv.connectionsAndMaterials.flareDestination.includes('Warm Wet Flare'));
    });

    it('evaluates ISA-75.25 Control Valve datasheets and noise predictions', () => {
      const pcv = datasheets.find((d) => d.tag === 'PCV-1001');
      assert.ok(pcv);
      assert.equal(pcv.valveSizeNps, 28);
      assert.equal(pcv.rating, 'Class 600 RF');
      assert.equal(pcv.actuator.failAction, 'Fail Open (FO) to prevent pipeline overpressure');
      assert.ok(pcv.sizingCoefficients.predictedNoiseDba < 85.0, 'Noise level must remain below 85 dBA');
      assert.ok(pcv.operatingCases.norm.travelPercent >= 40.0 && pcv.operatingCases.norm.travelPercent <= 80.0);
    });

    it('exports datasheets to Markdown and HTML formats', () => {
      const ds = datasheets[0];
      const md = generator.toMarkdown(ds);
      assert.ok(md.includes(`# Engineering Equipment Datasheet: ${ds.tag}`));
      assert.ok(md.includes(ds.service));

      const html = generator.toHtml(ds);
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes(ds.tag));
      assert.ok(html.includes('datasheet-container'));
      assert.ok(!html.includes('|---|'), 'HTML should not contain unrendered markdown table delimiter');
      assert.ok(html.includes('<table>') && html.includes('<tbody>'), 'HTML must contain semantic table elements');
    });
  });

  describe('3. Master Plant Equipment List & Civil Load Schedule (equipment_list.js)', () => {
    const generator = new MasterEquipmentListGenerator();
    const eqList = generator.generateMasterEquipmentList();
    const civilSchedule = generator.generateFoundationLoadSchedule();
    const summary = generator.getPlantSummary();

    it('aggregates equipment across all 11 plant units', () => {
      assert.ok(eqList.length >= 50, `Expected at least 50 tagged units, got ${eqList.length}`);
      const units = new Set(eqList.map((e) => e.unitId));
      for (const u of ['U-10', 'U-20', 'U-30', 'U-35', 'U-40', 'U-50', 'U-60', 'U-70', 'U-80', 'U-90', 'U-95']) {
        assert.ok(units.has(u), `Unit ${u} missing from equipment list`);
      }
    });

    it('verifies weight hierarchy: hydrotest weight >= operating weight >= dry weight', () => {
      for (const eq of eqList) {
        assert.ok(
          eq.hydrotestWeightKg >= eq.operatingWeightKg,
          `Item ${eq.tag} has hydrotest weight ${eq.hydrotestWeightKg} < operating ${eq.operatingWeightKg}`
        );
        assert.ok(
          eq.operatingWeightKg >= eq.dryWeightKg,
          `Item ${eq.tag} has operating weight ${eq.operatingWeightKg} < dry ${eq.dryWeightKg}`
        );
      }
    });

    it('calculates ACI 351.3R dynamic equipment factors and vertical design loads', () => {
      const pumps = eqList.filter((e) => e.category.includes('Pump'));
      for (const p of pumps) {
        assert.ok(p.civilFoundation.dynamicFactor >= 2.0, 'Centrifugal pumps must have dynamic factor >= 2.0');
        assert.ok(p.civilFoundation.designVerticalLoadKN > p.civilFoundation.deadLoadKN);
      }

      const compressors = eqList.filter((e) => e.category.includes('Compressor'));
      for (const c of compressors) {
        assert.ok(c.civilFoundation.dynamicFactor >= 2.5, 'Compressors must have dynamic factor >= 2.5');
      }
    });

    it('estimates concrete foundation volumes and verifies soil bearing capacity', () => {
      assert.ok(summary.totalConcreteVolumeM3 > 5000.0, 'Total civil foundation concrete > 5000 m3');
      assert.ok(summary.totalFoundationMassTonnes > 12000.0);

      for (const item of civilSchedule) {
        assert.ok(item.concreteVolumeM3 > 0.0);
        assert.ok(item.soilBearingKPa <= 200.0, `Soil bearing pressure ${item.soilBearingKPa} exceeds 200 kPa limit for ${item.tag}`);
      }
    });

    it('sizes anchor bolts with appropriate diameter and embedment depth', () => {
      for (const eq of eqList) {
        const bolts = eq.civilFoundation.anchorBolts;
        assert.ok(bolts.count >= 4, `Item ${eq.tag} has fewer than 4 anchor bolts`);
        assert.ok(bolts.diameter.startsWith('M'), 'Bolt diameter must follow metric standard (e.g. M24, M36, M64)');
        assert.ok(bolts.embedmentLengthMm >= 300, 'Embedment length must be >= 300 mm');
      }
    });

    it('exports master equipment list to Markdown and CSV formats', () => {
      const md = generator.toMarkdown();
      assert.ok(md.includes('# Master Plant Equipment List & Civil Load Schedule'));
      assert.ok(md.includes('Total Tagged Units'));

      const csv = generator.toCsv();
      const lines = csv.trim().split('\n');
      assert.ok(lines.length >= 51);
      assert.ok(lines[0].includes('Equipment Tag'));
      assert.ok(lines[0].includes('Design Vertical Load (kN)'));
      assert.ok(lines[0].includes('Concrete Volume (m3)'));
    });
  });

  describe('4. Industrial Plant Plot Plan & Layout Engine (plot_plan.js)', () => {
    const engine = new PlantPlotPlanEngine();

    it('positions all 11 units, Central Control Room, and Flare Network on site grid', () => {
      assert.equal(engine.siteWidthM, 1000.0);
      assert.equal(engine.siteHeightM, 800.0);
      assert.ok(engine.units.length >= 12, 'Must include all units + CCR + Flare');

      const ids = new Set(engine.units.map((u) => u.id));
      assert.ok(ids.has('CCR'));
      assert.ok(ids.has('FLARE'));
      assert.ok(ids.has('U-10'));
      assert.ok(ids.has('U-60'));
      assert.ok(ids.has('U-70'));
    });

    it('enforces OGP 454, CCPS, and NFPA 59A inter-unit separation distances', () => {
      const audit = engine.verifySeparationDistances();
      assert.equal(audit.isCompliant, true, `Plot plan audit reported ${audit.violationsCount} violations: ${JSON.stringify(audit.violations)}`);
      assert.equal(audit.violationsCount, 0);
      assert.ok(audit.totalPairsEvaluated > 50);

      // Verify specific safety clearances
      const u60 = engine.units.find((u) => u.id === 'U-60');
      const u70 = engine.units.find((u) => u.id === 'U-70');
      const distU60U70 = engine.calculateInterUnitDistance(u60, u70);
      assert.ok(distU60U70 >= 60.0, `Liquefaction to Tank distance ${distU60U70}m must be >= 60m per NFPA 59A`);

      const ccr = engine.units.find((u) => u.id === 'CCR');
      const u10 = engine.units.find((u) => u.id === 'U-10');
      const distCcrU10 = engine.calculateInterUnitDistance(ccr, u10);
      assert.ok(distCcrU10 >= 60.0, `Control Room to Process distance ${distCcrU10}m must be >= 60m`);

      assert.ok(audit.tankBoundaryClearanceM >= 60.0, 'LNG Tank property line setback >= 60m');
    });

    it('orients flare downwind and central control room upwind relative to prevailing wind', () => {
      assert.equal(engine.prevailingWindDeg, 225.0); // South-West

      const ccr = engine.units.find((u) => u.id === 'CCR');
      const flare = engine.units.find((u) => u.id === 'FLARE');

      // CCR must be located at West/South-West boundary
      assert.ok(ccr.x < 150.0 && ccr.y < 200.0, 'Control Room must be located in upwind SW sector');

      // Flare must be located at far downwind North-East boundary
      assert.ok(flare.x > 750.0 && flare.y > 550.0, 'Flare must be located in downwind NE sector');
    });

    it('renders a scaled SVG plot plan with hazardous area zone overlays and pipe rack', () => {
      const svg = engine.generatePlotPlanSvg();
      assert.ok(svg.startsWith('<svg') || svg.includes('<svg'));
      assert.ok(svg.includes('CENTRAL PIPE RACK CORRIDOR'));
      assert.ok(svg.includes('API 521 FLARE STERILE ZONE'));
      assert.ok(svg.includes('TK-7001A'));
      assert.ok(svg.includes('MCHE E-6001'));
      assert.ok(svg.includes('WIND: 225° SW'));
      assert.ok(svg.includes('DWG NO: LNG-00-PL-DWG-001'));
      assert.ok(svg.includes('id="windArrow"'), 'SVG defs must define windArrow marker');
      assert.ok(svg.includes('marker-end="url(#windArrow)"'));
      assert.ok(svg.length > 10000, `SVG plot plan too short: ${svg.length} chars`);
    });

    it('exports plot plan coordinate schedule and markdown report', () => {
      const schedule = engine.generateCoordinateSchedule();
      assert.equal(schedule.length, engine.units.length);

      for (const item of schedule) {
        assert.ok(item.centerCoords.eastingM > 0);
        assert.ok(item.centerCoords.northingM > 0);
        assert.ok(item.areaM2 > 0);
      }

      const md = engine.toMarkdown();
      assert.ok(md.includes('# Plant Plot Plan & Site Layout Evaluation'));
      assert.ok(md.includes('100% SATISFIED'));
    });
  });

  describe('5. Master Multi-Discipline FEED Package Compiler (feed_package_export.js)', () => {
    const compiler = new FeedPackageCompiler();
    const pkg = compiler.compileFeedPackage();

    it('assembles complete cross-disciplinary FEED engineering dossier', () => {
      assert.ok(pkg.metadata);
      assert.equal(pkg.metadata.revision, '0');
      assert.ok(pkg.documentRegister.length >= 20);
      assert.ok(pkg.designBasis);
      assert.ok(pkg.heatAndMaterialBalance);
      assert.ok(pkg.equipmentList);
      assert.ok(pkg.civilFoundationLoads);
      assert.ok(pkg.equipmentDatasheets);
      assert.ok(pkg.pipingLineList);
      assert.ok(pkg.valveSchedule);
      assert.ok(pkg.valveSchedule.totalValves >= 100, `Expected >= 100 valves, got ${pkg.valveSchedule.totalValves}`);
      assert.ok(pkg.valveSchedule.summary.byType.control > 0);
      assert.ok(pkg.safetyAndRelief);
      assert.ok(pkg.utilitiesAndPower);
      assert.ok(pkg.utilitiesAndPower.coolingDutyMW > 0, 'Cooling duty MW must be defined');
      assert.ok(pkg.plotPlanAndLayout);
    });

    it('includes formal revision block and document register', () => {
      const rev = pkg.metadata.revisionBlock;
      assert.equal(rev.rev, '0');
      assert.ok(rev.preparedBy);
      assert.ok(rev.checkedBy);
      assert.ok(rev.approvedBy);

      const docs = pkg.documentRegister;
      const disciplines = new Set(docs.map((d) => d.discipline));
      assert.ok(disciplines.has('Process'));
      assert.ok(disciplines.has('Piping'));
      assert.ok(disciplines.has('Mechanical'));
      assert.ok(disciplines.has('Civil/Structural'));
      assert.ok(disciplines.has('Instrumentation'));
      assert.ok(disciplines.has('Plant Layout'));
    });

    it('exports FEED package to single comprehensive Markdown report', () => {
      const md = compiler.toMarkdown(pkg);
      assert.ok(md.includes('# Front-End Engineering Design (FEED) Deliverables Package'));
      assert.ok(md.includes('Document Revision Control Block'));
      assert.ok(md.includes('1. Deliverable Document Register'));
      assert.ok(md.includes('2. Process Basis of Design'));
      assert.ok(md.includes('3. Heat & Material Balance Executive Summary'));
      assert.ok(md.includes('4. Master Plant Equipment & Civil Foundation Summary'));
      assert.ok(md.includes('5. Master Piping Line List Summary'));
      assert.ok(md.includes('6. Safety Relief & Flare Routing Summary'));
      assert.ok(md.includes('7. Master Valve Schedule Summary'));
      assert.ok(md.includes('8. Equipment Datasheets Register'));
      assert.ok(md.includes('9. Overall Site Plot Plan & Clearances Audit'));
      assert.ok(md.includes('10. Plant Utilities & Power Summary'));
    });

    it('exports FEED package to publication-ready standalone HTML dossier', () => {
      const html = compiler.toHtml(pkg);
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes(pkg.metadata.project));
      assert.ok(html.includes('Document Revision Control'));
      assert.ok(html.includes('kpi-card'));
      assert.ok(html.includes('<svg'));
      assert.ok(html.includes('LNG-FEED-PKG-001'));
      assert.ok(html.includes('Master Control & Process Valve Schedule Summary'));
      assert.ok(html.includes('Master Plant Equipment & Civil Load Schedule'));
    });

    it('exports package files to output directory', () => {
      const testOutputDir = path.join(__dirname, '..', 'output', 'test_feed_package');
      const exportResult = compiler.exportToDirectory(testOutputDir);

      assert.equal(exportResult.success, true);
      assert.equal(exportResult.files.length, 8);

      for (const fname of exportResult.files) {
        const fpath = path.join(testOutputDir, fname);
        assert.ok(fs.existsSync(fpath), `File ${fname} was not created in output directory`);
        const stats = fs.statSync(fpath);
        assert.ok(stats.size > 100, `File ${fname} is unexpectedly small (${stats.size} bytes)`);
      }

      assert.ok(exportResult.files.includes('LNG_MASTER_VALVE_SCHEDULE.csv'));
      assert.ok(exportResult.files.includes('LNG_EQUIPMENT_DATASHEETS.md'));

      // Cleanup test output files
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    });
  });

  describe('6. PlantEngineeringMasterApi Integration', () => {
    it('exposes deliverables namespace with all 5 Phase 8 modules', () => {
      const d = PlantEngineeringMasterApi.deliverables;
      assert.ok(d);
      assert.ok(d.MasterLineListGenerator);
      assert.ok(d.EquipmentDatasheetGenerator);
      assert.ok(d.MasterEquipmentListGenerator);
      assert.ok(d.PlantPlotPlanEngine);
      assert.ok(d.FeedPackageCompiler);
    });
  });
});
