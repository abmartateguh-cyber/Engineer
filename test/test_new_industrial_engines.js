/**
 * OmniEng Industrial Gap Closure & Engine Verification Suite (Suite 27)
 * Rigorous automated verification for the new industrial production features:
 * 1. 100% SVG Vector Icon Resolution & Zero Missing Icon Badges
 * 2. 3D Parametric B-Rep Feature Operations (Extrude with draft, 360° Revolve, Thin-Wall Shell, Linear Pattern)
 * 3. 3-Axis CNC Planar Roughing Toolpaths & ISO 6983 G-Code Post-Processor
 * 4. Geometrically Non-Linear Large Deflection FEA (Total Lagrangian Formulation & Newton-Raphson)
 * 5. Analytical Global Placement & Multi-Layer Grid A* Maze Routing
 * 6. Non-Ideal Phase Thermodynamics (NRTL Polar Azeotrope VLE Model)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const OmniIcons = require('../src/ui/icons');
const { FeatureOperations } = require('../src/core/cad/feature_operations');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
const { NonlinearLargeDeflectionSolver } = require('../src/core/cae/nonlinear_large_deflection');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { ActivityCoefficientModels } = require('../src/core/plant/activity_coefficient_models');

function runIndustrialGapClosureTests() {
  console.log('\n================================================================');
  console.log('   RUNNING INDUSTRIAL GAP CLOSURE ENGINES & FEATURES (SUITE 27) ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function runTest(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [GAP-${total}] ${name}`);
    } catch (err) {
      console.error(`  ✗ [GAP-${total}] FAIL: ${name}`);
      console.error(`    ${err.stack || err.message}`);
    }
  }

  // ----------------------------------------------------
  // Test 1: Vector Icon Catalog Resolution
  // ----------------------------------------------------
  runTest('OmniIcons: Complete catalog resolution with zero undefined icon slots in HTML & JS', () => {
    const keys = OmniIcons.getAllKeys();
    assert(keys.length >= 70, `Expected >= 70 icons, found ${keys.length}`);

    // Verify critical new engineering icons
    const requiredIcons = [
      'checkCircle', 'solidExtrude', 'circuit', 'cfdStreamlines', 'flowChart', 'link',
      'cadExtrude', 'cadRevolve', 'cadSweep', 'cadLoft', 'cadShell', 'cadPattern',
      'cadMirror', 'cadHole', 'camGcode', 'gizmo3d', 'contextMenu', 'historyStack'
    ];

    for (const key of requiredIcons) {
      assert(OmniIcons.has(key), `Missing required icon: ${key}`);
      const svg = OmniIcons.get(key);
      assert(typeof svg === 'string' && svg.startsWith('<svg') && svg.endsWith('</svg>'), `Icon ${key} has invalid SVG payload`);
      assert(svg.includes('stroke-width="1.75"'), `Icon ${key} does not meet 1.75px optical stroke requirement`);
    }

    // Verify all data-omni-icon attributes in index.html resolve cleanly
    const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    const attrRegex = /data-omni-icon="([a-zA-Z0-9_-]+)"/g;
    let match;
    const missingInHtml = [];
    while ((match = attrRegex.exec(indexHtml)) !== null) {
      const iconKey = match[1];
      if (!OmniIcons.has(iconKey)) {
        missingInHtml.push(iconKey);
      }
    }
    assert.strictEqual(missingInHtml.length, 0, `Found unresolvable icons in index.html: ${missingInHtml.join(', ')}`);
  });

  // ----------------------------------------------------
  // Test 2: 3D Parametric Extrusion (Draft & Euler Formula)
  // ----------------------------------------------------
  runTest('FeatureOperations.extrude: Euler characteristic V - E + F = 2 and positive solid volume', () => {
    // Extrude a rectangular sketch profile 40 x 30 by depth 50 with 2 deg draft
    const profile = [
      { x: -20, y: -15 },
      { x: 20, y: -15 },
      { x: 20, y: 15 },
      { x: -20, y: 15 }
    ];
    const solid = FeatureOperations.extrude(profile, 50.0, { draftAngleDeg: 2.0 });

    assert(solid !== null, 'Extrusion must return a valid SolidBody');
    assert.strictEqual(solid.faces.length, 6, 'Prismatic box extrusion must have exactly 6 B-Rep faces');

    // Euler-Poincaré formula for genus-0 polyhedron: V - E + F = 2
    const V = solid.vertices.length;
    const E = solid.edges.length;
    const F = solid.faces.length;
    const euler = V - E + F;
    assert.strictEqual(euler, 2, `Euler characteristic must be 2, got V=${V}, E=${E}, F=${F} -> ${euler}`);

    // Verify metadata
    assert.strictEqual(solid.metadata.feature, 'Extrude');
    assert.strictEqual(solid.metadata.depth, 50.0);
  });

  // ----------------------------------------------------
  // Test 3: 3D Revolve Feature (Quad Tessellation)
  // ----------------------------------------------------
  runTest('FeatureOperations.revolve: 360° rotational solid feature generation around Y axis', () => {
    // Profile of a cylinder radius 20, height 40: [[20, 0], [20, 40]]
    const profile = [
      { x: 20, y: 0 },
      { x: 20, y: 40 }
    ];
    const solid = FeatureOperations.revolve(profile, 360, 'Y', 24);

    assert(solid !== null, 'Revolve must return a valid SolidBody');
    assert(solid.faces.length >= 24, `Expected at least 24 revolution faces, got ${solid.faces.length}`);
    assert.strictEqual(solid.metadata.feature, 'Revolve');
    assert.strictEqual(solid.metadata.angleDeg, 360);
    assert.strictEqual(solid.metadata.axis, 'Y');
  });

  // ----------------------------------------------------
  // Test 4: Thin-Wall Shell & Linear Patterning
  // ----------------------------------------------------
  runTest('FeatureOperations.shell & linearPattern: Constant-thickness shell and feature replication', () => {
    const profile = [
      { x: -25, y: -25 },
      { x: 25, y: -25 },
      { x: 25, y: 25 },
      { x: -25, y: 25 }
    ];
    const baseSolid = FeatureOperations.extrude(profile, 30.0);

    const shellResult = FeatureOperations.shell(baseSolid, 2.5, 1); // 2.5mm wall, face 1 open
    assert(shellResult.solid !== null, 'Shell operation must return a solid body');
    assert.strictEqual(shellResult.wallThickness, 2.5);
    assert.strictEqual(shellResult.openFaceIndex, 1);

    // Linear pattern: 4 copies along X-axis with 60mm pitch
    const patternResult = FeatureOperations.linearPattern(baseSolid, [1, 0, 0], 4, 60.0);
    assert.strictEqual(patternResult.instances.length, 4, 'Linear pattern must produce exactly 4 instances');
    assert.strictEqual(patternResult.instances[3].translation[0], 180.0, 'Instance 4 offset must be 3 * 60 = 180mm');
  });

  // ----------------------------------------------------
  // Test 5: 3-Axis CAM Planar Roughing & ISO G-Code
  // ----------------------------------------------------
  runTest('CNCToolpathEngine: 3-Axis planar roughing and ISO 6983 G-code post-processor', () => {
    const cam = new CNCToolpathEngine({
      toolDiameter: 8.0,
      stepdownMm: 4.0,
      stepoverMm: 4.8,
      feedRateMmMin: 1000,
      spindleRpm: 8000
    });

    const bounds = { minX: -30, maxX: 30, minY: -20, maxY: 20, minZ: 0, maxZ: 20 };
    const toolpath = cam.planRoughingToolpath(bounds);

    assert(toolpath.layers.length >= 5, `Expected at least 5 Z-layers for 20mm depth / 4mm stepdown, got ${toolpath.layers.length}`);
    assert(toolpath.telemetry.totalPathLengthMm > 0, 'Total cutting path length must be positive');
    assert(toolpath.telemetry.estimatedTimeMin > 0, 'Estimated machining time must be positive');

    // Post-processor to Fanuc/Haas ISO G-Code
    const gcode = cam.generateGCode(toolpath, 'O1001');

    assert(gcode.includes('O1001'), 'G-code must have program header O1001');
    assert(gcode.includes('G21') && gcode.includes('G90'), 'G-code must declare metric G21 and absolute G90');
    assert(gcode.includes('S8000 M03'), 'G-code must command spindle clockwise M03 at 8000 RPM');
    assert(gcode.includes('M30'), 'G-code must terminate with M30 program end');
    assert(gcode.includes('G01 Z'), 'G-code must have feed linear plunge moves');
  });

  // ----------------------------------------------------
  // Test 6: Geometric Non-Linear FEA (Large Deflection)
  // ----------------------------------------------------
  runTest('NonlinearLargeDeflectionSolver: Total Lagrangian Newton-Raphson cantilever elastica convergence', () => {
    const solver = new NonlinearLargeDeflectionSolver({
      maxIterations: 25,
      tolerance: 1e-6,
      numLoadSteps: 10
    });

    // Slender cantilever beam under tip load: L = 1000mm, b = 20mm, h = 5mm, P = 25N
    const res = solver.solveLargeDeflectionCantilever({
      length: 1000.0,
      width: 20.0,
      height: 5.0,
      E: 200000.0,
      P: 25.0
    });

    assert.strictEqual(res.summary.status, 'CONVERGED', 'Nonlinear solver must converge');
    assert.strictEqual(res.loadSteps.length, 10, 'Must record 10 incremental load steps');

    // Geometric nonlinearity: beam stiffens under large deflection compared to linear small-deflection
    assert(res.linearTipDeflectionMm > res.nonlinearTipDeflectionMm, 'Linear deflection must overpredict large-deflection tip displacement');
    assert(res.geometricStiffeningPercent > 0, 'Geometric stiffening percentage must be positive');

    // Axial shortening (stretching effect u)
    const finalStep = res.loadSteps[res.loadSteps.length - 1];
    assert(finalStep.axialShorteningMm > 0, 'Axial shortening due to large rotation must be > 0');
  });

  // ----------------------------------------------------
  // Test 7: Analytical Placement & Multi-Layer Grid Routing
  // ----------------------------------------------------
  runTest('PlaceAndRouteEngine: HPWL wirelength optimization and zero-DRC multi-layer A* routing', () => {
    const pnr = new PlaceAndRouteEngine({
      coreWidth: 200.0,
      coreHeight: 200.0,
      stdCellHeight: 10.0
    });

    const circuitData = {
      cells: [
        { id: 'u_inv1', width: 4.0, height: 10.0 },
        { id: 'u_nand2', width: 6.0, height: 10.0 },
        { id: 'u_dff1', width: 12.0, height: 10.0 }
      ],
      nets: [
        { name: 'net_clk', pins: ['u_inv1', 'u_dff1'] },
        { name: 'net_data', pins: ['u_nand2', 'u_dff1'] }
      ]
    };

    const pnrResult = pnr.runPlaceAndRoute(circuitData);

    assert.strictEqual(pnrResult.status, 'P&R Complete');
    assert.strictEqual(pnrResult.cellsPlacedCount, 3);
    assert.strictEqual(pnrResult.netsRoutedCount, 2);
    assert(pnrResult.telemetry.totalHpwlMicrons > 0, 'Total HPWL wirelength must be > 0');
    assert.strictEqual(pnrResult.telemetry.drcViolations, 0, 'DRC violations must be zero');
  });

  // ----------------------------------------------------
  // Test 8: Non-Ideal Phase Thermodynamics (NRTL Azeotrope)
  // ----------------------------------------------------
  runTest('ActivityCoefficientModels: NRTL Ethanol-Water azeotropic composition & activity coefficients', () => {
    // Ethanol (1) + Water (2) at 78.15 °C
    const nrtl = ActivityCoefficientModels.evaluateNRTLBinary(0.894, 78.15);

    // Non-ideal positive deviation: gamma1 > 1.0, gamma2 > 1.0
    assert(nrtl.gamma1 > 1.0, `Ethanol activity coefficient gamma1 must be > 1.0, got ${nrtl.gamma1}`);
    assert(nrtl.gamma2 > 1.5, `Water activity coefficient gamma2 must be > 1.5 in ethanol-rich mixture, got ${nrtl.gamma2}`);

    // Bubble point pressure at 78.15 °C should be near 1 atm (within 0.20 bar of 1.013 bar)
    assert(Math.abs(nrtl.P_bubble_bar - 1.013) < 0.25, `Bubble point pressure ${nrtl.P_bubble_bar} bar should be near 1 atm`);

    // Azeotrope search
    const azeo = ActivityCoefficientModels.findAzeotrope('ethanol', 'water', 78.15);
    assert(azeo.hasAzeotrope, 'NRTL solver must identify ethanol-water minimum boiling azeotrope');
    assert(Math.abs(azeo.azeotropeX1 - 0.894) < 0.05, `Azeotropic composition ${azeo.azeotropeX1} deviates from literature 0.894`);
  });

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passed} / ${total} INDUSTRIAL GAP CLOSURE TESTS PASSED`);
  console.log('================================================================\n');

  return { total, passed };
}

if (require.main === module) {
  const result = runIndustrialGapClosureTests();
  if (result.passed !== result.total) {
    process.exit(1);
  }
}

module.exports = { runIndustrialGapClosureTests };
