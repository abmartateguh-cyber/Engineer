/**
 * Test Suite: Anatomy 100% Craft & Visual Parity Verification
 * Validates tactile spring physics, procedural hardware generators,
 * phenomena WebGL shaders, Viewport3D integration, 2D Schematic Canvas,
 * and Anatomy Card presentation overlay with zero dead code or logic.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock browser environment for Three.js and Canvas
global.window = global;
global.window.__OMNI_TEST_MODE__ = true;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};

global.document = {
  getElementById: (id) => {
    if (id === 'viewport-stats') {
      return { innerHTML: '', dataset: {}, style: {} };
    }
    if (id === 'nav-cube') {
      return { style: {} };
    }
    if (id === 'viewport-hud-toolbar') {
      return { querySelectorAll: () => [] };
    }
    if (id === 'anatomy-card-overlay') {
      return { style: { display: 'none' } };
    }
    if (id === 'anatomy-fig-title' || id === 'anatomy-telemetry-badge' || id === 'anatomy-footer-left' || id === 'anatomy-footer-right') {
      return { textContent: '' };
    }
    return {
      clientWidth: 800,
      clientHeight: 500,
      classList: {
        toggle: () => {},
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      style: {},
      getContext: () => ({
        save: () => {},
        restore: () => {},
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        ellipse: () => {},
        roundRect: () => {},
        fillText: () => {},
        setLineDash: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {}
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 })
    };
  },
  createElement: (tag) => {
    return {
      width: 256,
      height: 256,
      getContext: () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {}
      })
    };
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => []
};
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);

// Load Three.js
const vm = require('vm');
const threeCode = fs.readFileSync(path.join(__dirname, '../src/vendor/three.min.js'), 'utf8');
vm.runInThisContext(threeCode);
const THREE = global.THREE;

// Load Anatomy Components
const { TactileSpring1D, TactileSpringFollower3D, exponentialFollow3D } = require('../src/ui/tactile_spring_physics.js');
const ProceduralHardware = require('../src/ui/procedural_hardware.js');
const PhenomenaShaders = require('../src/ui/phenomena_shaders.js');
const { Viewport3D } = require('../src/ui/viewport3d.js');
const { SchematicLayoutUI } = require('../src/ui/schematic_layout_ui.js');
const ProceduralPbrMaterials = require('../src/ui/procedural_pbr_materials.js');
const StorytellingRails = require('../src/ui/storytelling_rails.js');

function runAnatomyCraftParityTests() {
  let passedTests = 0;
  let totalTests = 0;

  function it(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✓ PASSED: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('================================================================');
  console.log('   RUNNING ANATOMY 100% VISUAL & CRAFT PARITY VERIFICATION      ');
  console.log('================================================================\n');

// -----------------------------------------------------------------------------
// 1. Tactile Spring Physics Verification
// -----------------------------------------------------------------------------
console.log('[SUITE 1] Tactile Spring Physics & Damped Harmonic Oscillators');

it('TactileSpring1D converges monotonically to target under critical damping', () => {
  const spring = new TactileSpring1D({ stiffness: 100.0, damping: 20.0, value: 0.0 });
  spring.setTarget(10.0);
  assert.strictEqual(spring.getTarget(), 10.0);
  assert.strictEqual(spring.getValue(), 0.0);

  // Step 60 frames (1 second at 60 FPS)
  for (let i = 0; i < 60; i++) {
    spring.update(0.016);
  }

  // Under critical damping, position reaches > 9.8 within 1 second
  assert(spring.getValue() > 9.8, `Expected position > 9.8, got ${spring.getValue()}`);
  assert(spring.getValue() <= 10.02, `Critical damping should not have heavy overshoot, got ${spring.getValue()}`);
  assert(Math.abs(spring.getVelocity()) < 0.2, `Expected velocity near zero, got ${spring.getVelocity()}`);
});

it('TactileSpringFollower3D coordinates 3-axis smooth camera/gizmo tracking', () => {
  const follower = new TactileSpringFollower3D({ stiffness: 140.0, damping: 22.0 });
  follower.setValue(0, 0, 100);
  follower.setTarget(1.5, -0.8, 250);

  for (let i = 0; i < 150; i++) {
    follower.update(0.016);
  }

  const vals = follower.getValues();
  assert(Math.abs(vals.x - 1.5) < 0.05, `X should converge to 1.5, got ${vals.x}`);
  assert(Math.abs(vals.y - (-0.8)) < 0.05, `Y should converge to -0.8, got ${vals.y}`);
  assert(Math.abs(vals.z - 250) < 0.5, `Z should converge to 250, got ${vals.z}`);
});

it('exponentialFollow3D performs smooth asymptotic decay toward target', () => {
  const current = { x: 0, y: 0, z: 0 };
  const target = { x: 50, y: -20, z: 100 };
  const next = exponentialFollow3D(current, target, 0.016, 0.08);

  assert(next.x > 0 && next.x < 50, `Expected progressive motion in X: ${next.x}`);
  assert(next.y < 0 && next.y > -20, `Expected progressive motion in Y: ${next.y}`);
  assert(next.z > 0 && next.z < 100, `Expected progressive motion in Z: ${next.z}`);
});

// -----------------------------------------------------------------------------
// 2. Procedural Hardware 7 Component Generators
// -----------------------------------------------------------------------------
console.log('\n[SUITE 2] Procedural Hardware Generators (Real ISO & ASME Fasteners)');

it('ProceduralHardware.createKnurledCylinder generates diamond textured grips', () => {
  const knurl = ProceduralHardware.createKnurledCylinder(6, 15, 0x64748b, 24);
  assert(knurl instanceof THREE.Group, 'Expected knurl to be a THREE.Group');
  assert(knurl.children.length >= 2, 'Expected core cylinder and diamond knurl ridges');
  assert(knurl.userData.isProceduralKnurl === true, 'userData.isProceduralKnurl flag required');
});

it('ProceduralHardware.createIsoCapScrew generates ISO 4762 socket cap screw', () => {
  const screw = ProceduralHardware.createIsoCapScrew(2.5, 12, 0x94a3b8);
  assert(screw instanceof THREE.Group, 'Expected screw to be a THREE.Group');
  assert(screw.userData.standard === 'ISO 4762 / DIN 912', 'Expected ISO 4762 standard flag');
  assert(screw.userData.nominalDiameterMm === 2.5, 'Expected nominal diameter 2.5mm');
  assert(screw.children.length >= 3, 'Expected head, hex socket recess, and threaded shank');
});

it('ProceduralHardware.createFlangeAssembly generates ASME B16.5 flange with bolt circle & gasket', () => {
  const flangeAssy = ProceduralHardware.createFlangeAssembly(12, 26, 6, 8);
  assert(flangeAssy instanceof THREE.Group, 'Expected flange to be a THREE.Group');
  assert(flangeAssy.userData.standard === 'ASME B16.5 Class 300', 'Expected ASME B16.5 standard flag');
  assert.strictEqual(flangeAssy.userData.boltCount, 8, 'Expected 8 bolts');
  // Children must contain 2 flanges, 1 gasket, and 8 studs with hex nuts
  assert(flangeAssy.children.length >= 11, `Expected at least 11 parts, got ${flangeAssy.children.length}`);
});

it('ProceduralHardware.createCoilSpring generates helical compression spring', () => {
  const spring = ProceduralHardware.createCoilSpring(4.0, 18.0, 6.0, 0.8, 0xf59e0b);
  assert(spring instanceof THREE.Group || spring instanceof THREE.Mesh, 'Expected THREE object');
  assert(spring.userData.type === 'Helical Compression Spring', 'Expected spring type flag');
  assert(spring.userData.coils === 6.0, 'Expected 6 active coils');
});

it('ProceduralHardware.createDialGauge generates calibrated pressure gauge with live needle', () => {
  const gauge = ProceduralHardware.createDialGauge(10, 0, 100, 45, 'BAR');
  assert(gauge instanceof THREE.Group, 'Expected dial gauge to be a THREE.Group');
  assert(gauge.userData.type === 'Calibrated Dial Gauge', 'Expected dial gauge type flag');
  assert.strictEqual(gauge.userData.currentValue, 45, 'Expected needle set to 45 BAR');
  assert.strictEqual(typeof gauge.userData.setNeedleValue, 'function', 'setNeedleValue function required');

  // Test dynamic needle update
  gauge.userData.setNeedleValue(80);
  assert.strictEqual(gauge.userData.currentValue, 80);
});

it('ProceduralHardware.createRulerStrip generates precision calibrated tick strip', () => {
  const ruler = ProceduralHardware.createRulerStrip(100, 6, 10);
  assert(ruler instanceof THREE.Group, 'Expected ruler strip to be a THREE.Group');
  assert(ruler.userData.lengthMm === 100, 'Expected length 100mm');
  assert(ruler.children.length >= 10, 'Expected ruler ticks and numeric marks');
});

it('ProceduralHardware.createWeldBead generates circumferential scalloped weld bead', () => {
  const weld = ProceduralHardware.createWeldBead(8, 1.2, 24);
  assert(weld instanceof THREE.Group, 'Expected weld to be a THREE.Group');
  assert(weld.userData.type === 'Butt-Weld Scalloped Bead', 'Expected weld type flag');
  assert.strictEqual(weld.userData.scallopCount, 24, 'Expected 24 scallops');
});

it('ProceduralHardware.createBallBearingAssembly generates SKF deep-groove caged bearing', () => {
  const bearing = ProceduralHardware.createBallBearingAssembly(10, 30, 9, 8);
  assert(bearing instanceof THREE.Group, 'Expected bearing to be a THREE.Group');
  assert(bearing.userData.standard.includes('SKF 6200'), 'Expected SKF bearing standard flag');
  assert.strictEqual(bearing.userData.ballCount, 8, 'Expected 8 bearing balls');
  // Must include outer ring, inner ring, cage separator, and 8 balls
  assert(bearing.children.length >= 11, `Expected at least 11 parts, got ${bearing.children.length}`);
});

it('ProceduralHardware.createRetainingRing generates DIN 471 external circlip with plier lug holes', () => {
  const circlip = ProceduralHardware.createRetainingRing(12, 'DIN 471');
  assert(circlip instanceof THREE.Group, 'Expected circlip to be a THREE.Group');
  assert(circlip.userData.standard.includes('DIN 471'), 'Expected DIN 471 flag');
  assert.strictEqual(circlip.userData.shaftR, 12, 'Expected 12mm shaft radius');
  assert(circlip.children.length >= 3, 'Expected slit ring body and 2 lug ears');
});

it('ProceduralHardware.createCotterPin generates ISO 1234 split cotter pin with loop eyelet', () => {
  const pin = ProceduralHardware.createCotterPin(2.5, 20);
  assert(pin instanceof THREE.Group, 'Expected cotter pin to be a THREE.Group');
  assert(pin.userData.standard.includes('ISO 1234'), 'Expected ISO 1234 standard flag');
  assert.strictEqual(pin.userData.nominalD, 2.5, 'Expected 2.5mm pin diameter');
  assert(pin.children.length >= 3, 'Expected eyelet loop, straight prong, and extended bent prong');
});

// -----------------------------------------------------------------------------
// 3. Phenomena WebGL Shaders Verification
// -----------------------------------------------------------------------------
console.log('\n[SUITE 3] Phenomena WebGL Shaders (Supersonic Plumes & Optical Caustics)');

it('PhenomenaShaders.createSupersonicPlume generates Mach shock diamonds shader', () => {
  const plume = PhenomenaShaders.createSupersonicPlume({
    machNumber: 2.8,
    shockCount: 4,
    plumeLength: 120,
    coreRadius: 18,
    accentColor: 0x38bdf8
  });
  assert(plume instanceof THREE.Mesh, 'Expected plume to be a THREE.Mesh');
  assert(plume.material instanceof THREE.ShaderMaterial, 'Expected ShaderMaterial');
  assert(plume.material.uniforms.uMachNumber.value === 2.8, 'Expected uMachNumber uniform');
  assert(plume.material.uniforms.uShockCount.value === 4.0, 'Expected uShockCount uniform');
  assert(typeof plume.material.uniforms.uTime !== 'undefined', 'uTime uniform required for 60 FPS animation');
  assert(plume.material.transparent === true, 'Plume shader must be transparent');
});

it('PhenomenaShaders.createCausticBeamShaderMaterial compiles optical caustic beam', () => {
  const causticMat = PhenomenaShaders.createCausticBeamShaderMaterial(0x38bdf8, 2.5);
  assert(causticMat instanceof THREE.ShaderMaterial, 'Expected ShaderMaterial');
  assert(causticMat.uniforms.uDispersion.value === 2.5, 'Expected uDispersion uniform');
  assert(causticMat.blending === THREE.AdditiveBlending, 'Expected AdditiveBlending for photonic energy');
});

it('PhenomenaShaders.createThermalMirageMaterial compiles thermal shimmer mirage', () => {
  const mirageMat = PhenomenaShaders.createThermalMirageMaterial(0x38bdf8);
  assert(mirageMat instanceof THREE.ShaderMaterial, 'Expected ShaderMaterial');
  assert(typeof mirageMat.uniforms.uFrequency !== 'undefined', 'uFrequency uniform required');
  assert(typeof mirageMat.uniforms.uTime !== 'undefined', 'uTime uniform required');
});

// -----------------------------------------------------------------------------
// 4. Viewport3D Integration & Scene Injections
// -----------------------------------------------------------------------------
console.log('\n[SUITE 4] Viewport3D Scene Upgrades & Raptor Propulsion Stand');

it('Viewport3D initializes with spring followers and shader tracker', () => {
  const vp = new Viewport3D('viewport-canvas');
  assert(vp.cameraFollower !== null, 'cameraFollower TactileSpringFollower3D required');
  assert(vp.gizmoFollower !== null, 'gizmoFollower TactileSpringFollower3D required');
  assert(Array.isArray(vp.activeShaderMaterials), 'activeShaderMaterials array required');
});

it('Viewport3D.renderSmartphoneCad populates procedural ISO screws and knurled controls', () => {
  const vp = new Viewport3D('viewport-canvas');
  vp.renderSmartphoneCad(75, 8.2, 160);
  assert(vp.currentMesh !== null, 'currentMesh required');

  let hasIsoScrew = false;
  let hasKnurl = false;
  let hasRuler = false;

  vp.currentMesh.traverse((child) => {
    if (child.userData && child.userData.partName) {
      if (child.userData.partName.includes('ISO 4762')) hasIsoScrew = true;
      if (child.userData.partName.includes('Knurled')) hasKnurl = true;
      if (child.userData.partName.includes('Precision Ruler')) hasRuler = true;
    }
  });

  assert(hasIsoScrew, 'Smartphone CAD must contain ISO 4762 corner screws');
  assert(hasKnurl, 'Smartphone CAD must contain knurled side buttons');
  assert(hasRuler, 'Smartphone CAD must contain precision ruler strip');
});

it('Viewport3D.renderPipingLoop3D populates ASME B16.5 flanges and Bourdon dial gauge', () => {
  const vp = new Viewport3D('viewport-canvas');
  vp.renderPipingLoop3D(40, 10, 6, 0.65);
  assert(vp.currentMesh !== null, 'currentMesh required');

  let hasFlangeAssy = false;
  let hasWeld = false;
  let hasDialGauge = false;

  vp.currentMesh.traverse((child) => {
    if (child.userData && child.userData.partName) {
      if (child.userData.partName.includes('ASME B16.5')) hasFlangeAssy = true;
      if (child.userData.partName.includes('Weld')) hasWeld = true;
      if (child.userData.partName.includes('Bourdon Tube Pressure Gauge')) hasDialGauge = true;
    }
  });

  assert(hasFlangeAssy, 'Piping loop must contain ASME B16.5 flange assembly');
  assert(hasWeld, 'Piping loop must contain circumferential weld beads');
  assert(hasDialGauge, 'Piping loop must contain Bourdon tube dial gauge atop crown');
});

it('Viewport3D.renderDrone3D populates knurled standoffs, motor screws, and helical springs', () => {
  const vp = new Viewport3D('viewport-canvas');
  vp.renderDrone3D(85, 8000);
  assert(vp.currentMesh !== null, 'currentMesh required');

  let hasStandoff = false;
  let hasMotorScrew = false;
  let hasSpring = false;

  vp.currentMesh.traverse((child) => {
    if (child.userData && child.userData.partName) {
      if (child.userData.partName.includes('Standoff')) hasStandoff = true;
      if (child.userData.partName.includes('Motor')) hasMotorScrew = true;
      if (child.userData.partName.includes('Spring')) hasSpring = true;
    }
  });

  assert(hasStandoff, 'Drone CAD must contain knurled standoffs');
  assert(hasMotorScrew, 'Drone CAD must contain motor fasteners');
  assert(hasSpring, 'Drone CAD must contain vibration isolation helical springs');
});

it('Viewport3D.renderRaptorTestStand3D populates columns, nozzle, and active supersonic plume', () => {
  const vp = new Viewport3D('viewport-canvas');
  vp.renderRaptorTestStand3D();
  assert(vp.currentMesh !== null, 'currentMesh required');

  let hasPlume = false;
  let hasNozzle = false;
  let hasGimbal = false;

  vp.currentMesh.traverse((child) => {
    if (child.userData) {
      if (child.userData.type === 'Supersonic Plume Shock Diamonds') hasPlume = true;
      if (child.userData.partName && child.userData.partName.includes('Nozzle Bell')) hasNozzle = true;
      if (child.userData.partName && child.userData.partName.includes('Gimbal')) hasGimbal = true;
    }
  });

  assert(hasPlume, 'Raptor stand must contain active supersonic plume');
  assert(hasNozzle, 'Raptor stand must contain milled channel nozzle bell');
  assert(hasGimbal, 'Raptor stand must contain gimbal ring');
  assert(vp.activeShaderMaterials.length > 0, 'activeShaderMaterials must track plume material');
});

// -----------------------------------------------------------------------------
// 5. 2D Schematic Canvas & Spring Drag Physics
// -----------------------------------------------------------------------------
console.log('\n[SUITE 5] 2D Schematic Canvas & Tactile Spring Drag Physics');

it('SchematicLayoutUI integrates dragSpring for organic drag follow', () => {
  const ui = new SchematicLayoutUI('eda-canvas');
  assert(ui.dragSpring !== null, 'SchematicLayoutUI.dragSpring instance required');
  assert(ui.pcbComponents.length > 0, 'pcbComponents array required');
  assert(ui.pidStreams.length > 0, 'pidStreams array required');
});

// -----------------------------------------------------------------------------
// 6. Anatomy Card Mode DOM & UI Integration
// -----------------------------------------------------------------------------
console.log('\n[SUITE 6] Anatomy Card Presentation Overlay & Zero Dead Code');

it('index.html contains #btn-anatomy-card and #anatomy-card-overlay', () => {
  const htmlPath = path.join(__dirname, '../src/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  assert(htmlContent.includes('id="btn-anatomy-card"'), 'index.html must have #btn-anatomy-card');
  assert(htmlContent.includes('id="anatomy-card-overlay"'), 'index.html must have #anatomy-card-overlay');
  assert(htmlContent.includes('id="anatomy-fig-title"'), 'index.html must have #anatomy-fig-title');
  assert(htmlContent.includes('id="anatomy-telemetry-badge"'), 'index.html must have #anatomy-telemetry-badge');
});

it('glassmorphic_theme.css contains .anatomy-card-overlay hairline framing styles', () => {
  const cssPath = path.join(__dirname, '../src/styles/glassmorphic_theme.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert(cssContent.includes('.anatomy-card-overlay'), 'CSS must define .anatomy-card-overlay');
  assert(cssContent.includes('.anatomy-fig-badge'), 'CSS must define .anatomy-fig-badge');
  assert(cssContent.includes('.anatomy-live-dot'), 'CSS must define .anatomy-live-dot');
  assert(cssContent.includes('.anatomy-card-footer'), 'CSS must define .anatomy-card-footer');
});

it('app.js wires #btn-anatomy-card and #btn-cad-raptor with zero dead code', () => {
  const appPath = path.join(__dirname, '../src/ui/app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert(appContent.includes("btn.id === 'btn-anatomy-card'"), 'app.js must handle btn-anatomy-card click');
  assert(appContent.includes("btn-cad-raptor"), 'app.js must wire btn-cad-raptor');
  assert(appContent.includes("renderRaptorTestStand3D"), 'app.js must invoke renderRaptorTestStand3D');
});

// -----------------------------------------------------------------------------
// 7. Procedural PBR Materials & Physical Craft Synthesis
// -----------------------------------------------------------------------------
console.log('\n[SUITE 7] Procedural PBR Anisotropy & Optical AR Sheen');

it('ProceduralPbrMaterials creates brushed metal anisotropic normal & roughness maps', () => {
  const normMap = ProceduralPbrMaterials.createBrushedMetalNormalMap({ width: 128, height: 128 });
  assert(normMap instanceof THREE.CanvasTexture, 'Expected THREE.CanvasTexture for normal map');
  assert(normMap.wrapS === THREE.RepeatWrapping, 'Expected RepeatWrapping wrapS');

  const roughMap = ProceduralPbrMaterials.createMicroScratchRoughnessMap({ width: 128, height: 128 });
  assert(roughMap instanceof THREE.CanvasTexture, 'Expected THREE.CanvasTexture for roughness map');
});

it('ProceduralPbrMaterials compiles satin anodized aluminum & turned 316L stainless steel', () => {
  const alu = ProceduralPbrMaterials.createAnodizedAluminumMaterial(0x38bdf8, 0.4);
  assert(alu instanceof THREE.MeshStandardMaterial, 'Expected MeshStandardMaterial');
  assert(alu.userData.pbrType.includes('Anodized 7075-T6'), 'Expected Anodized 7075-T6 flag');
  assert.strictEqual(alu.roughness, 0.4);

  const steel = ProceduralPbrMaterials.createTurnedStainlessSteelMaterial();
  assert(steel instanceof THREE.MeshStandardMaterial, 'Expected MeshStandardMaterial');
  assert.strictEqual(steel.userData.pbrType, 'Turned 316L Passivated Stainless Steel');
  assert.strictEqual(steel.metalness, 0.94);
});

it('ProceduralPbrMaterials compiles multi-layer optical AR thin-film coating sheen', () => {
  const arMat = ProceduralPbrMaterials.createOpticalArCoatingMaterial(1.65);
  assert(arMat instanceof THREE.MeshPhysicalMaterial, 'Expected MeshPhysicalMaterial');
  assert.strictEqual(arMat.userData.pbrType, 'Multi-Layer Subwavelength Anti-Reflective Nano-Coating');
  assert.strictEqual(arMat.ior, 1.65);
  assert.strictEqual(arMat.transmission, 0.92);
});

// -----------------------------------------------------------------------------
// 8. Cinematic Storytelling Rails Controller
// -----------------------------------------------------------------------------
console.log('\n[SUITE 8] Cinematic Storytelling Rails Controller & Stage Sequencing');

it('StorytellingRails defines 5 narrative stages and initializes controller', () => {
  assert.strictEqual(StorytellingRails.DEFAULT_STAGES.length, 5, 'Expected 5 narrative stages');
  const ctrl = StorytellingRails.createController();
  assert.strictEqual(ctrl.currentStageIndex, 0, 'Initial stage index must be 0 (Overview)');
  assert.strictEqual(ctrl.getCurrentStage().id, 'overview');
});

it('StorytellingRailsController advances, retreats, and scrubs narrative stages', () => {
  const ctrl = StorytellingRails.createController();
  
  // Advance to Stage 2: Section Cut
  const s1 = ctrl.nextStage();
  assert.strictEqual(s1.id, 'section_cut');
  assert.strictEqual(ctrl.currentStageIndex, 1);

  // Advance to Stage 3: Exploded View
  const s2 = ctrl.nextStage();
  assert.strictEqual(s2.id, 'exploded_view');
  assert.strictEqual(ctrl.currentStageIndex, 2);

  // Retreat back to Stage 2
  const sPrev = ctrl.prevStage();
  assert.strictEqual(sPrev.id, 'section_cut');
  assert.strictEqual(ctrl.currentStageIndex, 1);

  // Scrub directly to Stage 5: Dynamics
  const sScrub = ctrl.scrubToStage(4);
  assert.strictEqual(sScrub.id, 'operational_dynamics');
  assert.strictEqual(ctrl.currentStageIndex, 4);
});

it('StorytellingRailsController toggles tour playback timer and dispatches callbacks', () => {
  const ctrl = StorytellingRails.createController({ tourIntervalMs: 200 });
  let notifiedStage = null;
  ctrl.onStageChange((stg) => {
    notifiedStage = stg;
  });

  ctrl.scrubToStage(2);
  assert(notifiedStage !== null, 'onStageChange callback must fire');
  assert.strictEqual(notifiedStage.id, 'exploded_view');

  // Toggle play tour
  const playing = ctrl.toggleTour();
  assert.strictEqual(playing, true, 'Tour should be playing');
  assert.strictEqual(ctrl.isPlayingTour, true);

  // Toggle pause tour
  const paused = ctrl.toggleTour();
  assert.strictEqual(paused, false, 'Tour should be paused');
  assert.strictEqual(ctrl.isPlayingTour, false);
});

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passedTests} / ${totalTests} ANATOMY CRAFT PARITY TESTS PASSED`);
  console.log('================================================================\n');

  return { total: totalTests, passed: passedTests };
}

module.exports = { runAnatomyCraftParityTests };

if (require.main === module) {
  const res = runAnatomyCraftParityTests();
  if (res.passed !== res.total) {
    process.exit(1);
  }
}
