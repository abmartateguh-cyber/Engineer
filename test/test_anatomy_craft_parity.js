/**
 * Experimental UI integration smoke checks for animation helpers, procedural
 * geometry, shaders, Viewport3D, schematic layout, and presentation overlays.
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
    if (
      id === 'anatomy-fig-title' ||
      id === 'anatomy-telemetry-badge' ||
      id === 'anatomy-footer-left' ||
      id === 'anatomy-footer-right'
    ) {
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
const {
  TactileSpring1D,
  TactileSpringFollower3D,
  exponentialFollow3D
} = require('../src/ui/tactile_spring_physics.js');
const ProceduralHardware = require('../src/ui/procedural_hardware.js');
const PhenomenaShaders = require('../src/ui/phenomena_shaders.js');
const { Viewport3D } = require('../src/ui/viewport3d.js');
const { HighCapacityWebGPUViewport } = require('../src/ui/viewport3d_webgpu.js');
const { SchematicLayoutUI } = require('../src/ui/schematic_layout_ui.js');
const ProceduralPbrMaterials = require('../src/ui/procedural_pbr_materials.js');
const StorytellingRails = require('../src/ui/storytelling_rails.js');
const { NasaSpaceRocket3D } = require('../src/ui/nasa_space_rocket_3d.js');

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
  console.log('   RUNNING EXPERIMENTAL UI INTEGRATION SMOKE CHECKS              ');
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
    assert(Math.abs(vals.y - -0.8) < 0.05, `Y should converge to -0.8, got ${vals.y}`);
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
  console.log('\n[SUITE 2] Synthetic Procedural Hardware Geometry');

  it('ProceduralHardware.createKnurledCylinder generates diamond textured grips', () => {
    const knurl = ProceduralHardware.createKnurledCylinder(6, 15, 0x64748b, 24);
    assert(knurl instanceof THREE.Group, 'Expected knurl to be a THREE.Group');
    assert(knurl.children.length >= 2, 'Expected core cylinder and diamond knurl ridges');
    assert(knurl.userData.isProceduralKnurl === true, 'userData.isProceduralKnurl flag required');
  });

  it('ProceduralHardware.createIsoCapScrew generates an illustrative socket-head screw form', () => {
    const screw = ProceduralHardware.createIsoCapScrew(2.5, 12, 0x94a3b8);
    assert(screw instanceof THREE.Group, 'Expected screw to be a THREE.Group');
    assert.strictEqual(screw.userData.standard, undefined);
    assert.strictEqual(screw.userData.isSyntheticExample, true);
    assert(screw.userData.nominalDiameterMm === 2.5, 'Expected nominal diameter 2.5mm');
    assert(screw.children.length >= 3, 'Expected head, hex socket recess, and threaded shank');
  });

  it('ProceduralHardware.createFlangeAssembly generates illustrative flange geometry', () => {
    const flangeAssy = ProceduralHardware.createFlangeAssembly(12, 26, 6, 8);
    assert(flangeAssy instanceof THREE.Group, 'Expected flange to be a THREE.Group');
    assert.strictEqual(flangeAssy.userData.standard, undefined);
    assert.strictEqual(flangeAssy.userData.isSyntheticExample, true);
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

  it('ProceduralHardware.createDialGauge generates an illustrative dial with animated needle', () => {
    const gauge = ProceduralHardware.createDialGauge(10, 0, 100, 45, 'BAR');
    assert(gauge instanceof THREE.Group, 'Expected dial gauge to be a THREE.Group');
    assert.strictEqual(gauge.userData.type, 'IllustrativeDialGauge');
    assert.strictEqual(gauge.userData.isSyntheticExample, true);
    assert.strictEqual(gauge.userData.currentValue, 45, 'Expected needle set to 45 BAR');
    assert.strictEqual(gauge.userData.readingAvailable, true);
    assert.strictEqual(typeof gauge.userData.setNeedleValue, 'function', 'setNeedleValue function required');

    // Test dynamic needle update
    gauge.userData.setNeedleValue(80);
    assert.strictEqual(gauge.userData.currentValue, 80);
  });

  it('ProceduralHardware.createDialGauge hides readings when no scale or value is supplied', () => {
    const gauge = ProceduralHardware.createDialGauge(10, null, null, null, 'Illustrative');
    const needle = gauge.children.find((child) => child.geometry?.type === 'ConeGeometry');
    assert(needle, 'Expected decorative dial to retain its needle mesh');
    assert.strictEqual(needle.visible, false);
    assert.strictEqual(gauge.userData.minVal, null);
    assert.strictEqual(gauge.userData.maxVal, null);
    assert.strictEqual(gauge.userData.currentValue, null);
    assert.strictEqual(gauge.userData.readingAvailable, false);

    gauge.userData.setNeedleValue(0.5);
    assert.strictEqual(needle.visible, false, 'A dial without a scale must not display an assigned value');
    assert.strictEqual(gauge.userData.currentValue, null);
  });

  it('ProceduralHardware.createRulerStrip generates a ruler-like visual tick strip', () => {
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

  it('ProceduralHardware.createBallBearingAssembly generates illustrative bearing geometry', () => {
    const bearing = ProceduralHardware.createBallBearingAssembly(10, 30, 9, 8);
    assert(bearing instanceof THREE.Group, 'Expected bearing to be a THREE.Group');
    assert.strictEqual(bearing.userData.standard, undefined);
    assert.strictEqual(bearing.userData.isSyntheticExample, true);
    assert.strictEqual(bearing.userData.ballCount, 8, 'Expected 8 bearing balls');
    // Must include outer ring, inner ring, cage separator, and 8 balls
    assert(bearing.children.length >= 11, `Expected at least 11 parts, got ${bearing.children.length}`);
  });

  it('ProceduralHardware.createRetainingRing generates an illustrative external retaining ring', () => {
    const circlip = ProceduralHardware.createRetainingRing(12, 'DIN 471');
    assert(circlip instanceof THREE.Group, 'Expected circlip to be a THREE.Group');
    assert.strictEqual(circlip.userData.standard, undefined);
    assert.strictEqual(circlip.userData.isSyntheticExample, true);
    assert.strictEqual(circlip.userData.shaftR, 12, 'Expected 12mm shaft radius');
    assert(circlip.children.length >= 3, 'Expected slit ring body and 2 lug ears');
  });

  it('ProceduralHardware.createCotterPin generates an illustrative split cotter pin', () => {
    const pin = ProceduralHardware.createCotterPin(2.5, 20);
    assert(pin instanceof THREE.Group, 'Expected cotter pin to be a THREE.Group');
    assert.strictEqual(pin.userData.standard, undefined);
    assert.strictEqual(pin.userData.isSyntheticExample, true);
    assert.strictEqual(pin.userData.nominalD, 2.5, 'Expected 2.5mm pin diameter');
    assert(pin.children.length >= 3, 'Expected eyelet loop, straight prong, and extended bent prong');
  });

  // -----------------------------------------------------------------------------
  // 3. Phenomena WebGL Shaders Verification
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 3] Phenomena WebGL Shaders (Supersonic Plumes & Optical Caustics)');

  it('PhenomenaShaders creates a decorative plume effect without physical output fields', () => {
    assert.strictEqual(PhenomenaShaders.createSupersonicPlume, PhenomenaShaders.createIllustrativePlume);
    const plume = PhenomenaShaders.createIllustrativePlume({
      visualFrequency: 4,
      plumeLength: 120,
      coreRadius: 18,
      accentColor: 0x38bdf8
    });
    assert(plume instanceof THREE.Mesh, 'Expected plume to be a THREE.Mesh');
    assert(plume.material instanceof THREE.ShaderMaterial, 'Expected ShaderMaterial');
    assert.strictEqual(plume.material.uniforms.u_visualFrequency.value, 4);
    assert.strictEqual(plume.userData.isSyntheticExample, true);
    assert.strictEqual(plume.userData.physicsSimulation, false);
    assert.strictEqual('machNumber' in plume.userData, false);
    assert.strictEqual('shockCount' in plume.userData, false);
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
  console.log('\n[SUITE 4] Viewport illustrative geometry integration');

  it('Experimental GPU viewport reports unavailable rendering telemetry and culling', () => {
    const viewport = new HighCapacityWebGPUViewport();
    viewport.createInstancedPartMesh(
      'example-part',
      {
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2]
      },
      [{ x: 0, y: 0, z: 0 }]
    );

    const telemetry = viewport.getTelemetry();
    assert.strictEqual(telemetry.fps, null);
    assert.strictEqual(telemetry.renderedPolygonsCount, null);
    assert.strictEqual(telemetry.descriptorPolygonCount, 1);
    assert.strictEqual(telemetry.maxPolygonsEnforced, false);

    const culling = viewport.performFrustumCulling([]);
    assert.strictEqual(culling.status, 'UNAVAILABLE');
    assert.strictEqual(culling.performed, false);
    assert.strictEqual(culling.visibleInstances, null);

    const htmlSource = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    assert.doesNotMatch(htmlSource, /FPS:\s*60|status-fps-val/);
    assert.match(htmlSource, /render telemetry unavailable/i);

    const webgpuSource = fs.readFileSync(path.join(__dirname, '../src/ui/viewport3d_webgpu.js'), 'utf8');
    assert.doesNotMatch(webgpuSource, /5,000,000|100,000|Class-A|production-scale|60 FPS/i);
    const opticsSource = fs.readFileSync(path.join(__dirname, '../src/ui/optical_inspector_ui.js'), 'utf8');
    assert.doesNotMatch(opticsSource, /Zemax Lens Data Editor/i);
    const blockUiSource = fs.readFileSync(path.join(__dirname, '../src/ui/block_diagram_ui.js'), 'utf8');
    assert.match(blockUiSource, /No solver result is loaded/);
    assert.doesNotMatch(blockUiSource, /Dynamic Simulink Block Diagram Simulator|Mp: 8\.2%/);
  });

  it('Viewport3D initializes with spring followers and shader tracker', () => {
    const vp = new Viewport3D('viewport-canvas');
    assert(vp.cameraFollower !== null, 'cameraFollower TactileSpringFollower3D required');
    assert(vp.gizmoFollower !== null, 'gizmoFollower TactileSpringFollower3D required');
    assert(Array.isArray(vp.activeShaderMaterials), 'activeShaderMaterials array required');
  });

  it('3D inspector retains the material label and legacy alias without changing material properties', () => {
    const visualMaterial = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), visualMaterial);
    part.userData = { materialName: 'Unspecified illustrative material' };
    const viewport = Object.create(Viewport3D.prototype);
    viewport.selectedPart = part;
    viewport.gizmoGroup = null;
    viewport.gizmos = null;

    viewport.updateSelectedPart({ material: '  user supplied label  ' });
    assert.strictEqual(part.userData.materialName, 'user supplied label');
    assert.strictEqual(viewport.getPartProperties(part).material, 'user supplied label');
    assert.strictEqual(viewport.getPartProperties(part).materialName, 'user supplied label');
    assert.strictEqual(
      part.material,
      visualMaterial,
      'Changing the label must not change visual or solver material properties'
    );

    viewport.updateSelectedPart({ materialName: 'second label' });
    assert.strictEqual(part.userData.materialName, 'second label');

    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const propertyGridSource = fs.readFileSync(path.join(__dirname, '../src/ui/property_grid_view.js'), 'utf8');
    assert.match(propertyGridSource, /Material label \(display only\)/);
    assert.match(propertyGridSource, /no material properties or source verification are attached/i);
    assert.match(appSource, /OmniPropertyGridView\?\.createPropertyGridElements/);
  });

  it('Transient playback sends the complete explicit-input request and rejects missing values', () => {
    const viewportSource = fs.readFileSync(path.join(__dirname, '../src/ui/viewport3d.js'), 'utf8');
    const playbackStart = viewportSource.indexOf('async playTransient()');
    const playbackEnd = viewportSource.indexOf('  pauseTransient()', playbackStart);
    assert(playbackStart >= 0 && playbackEnd > playbackStart, 'Expected the viewport playback method');
    const playbackSource = viewportSource.slice(playbackStart, playbackEnd);

    for (const field of [
      'slider-drop-h',
      'input-drop-mass',
      'select-drop-angle',
      'input-drop-duration-ms',
      'input-drop-step-count'
    ]) {
      assert(playbackSource.includes(field), `Playback must read ${field}`);
    }
    assert.match(playbackSource, /totalDurationMs,\s*stepCount/);
    assert.match(playbackSource, /stepCount <= 10000/);
    assert.doesNotMatch(playbackSource, /\.value\s*\|\|\s*(?:1\.5|'corner')/);

    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    assert.match(appSource, /id="input-drop-step-count"[^>]*max="10000"/);
    assert.match(appSource, /dropHeight:\s*null/);
    assert.match(appSource, /impactAngle:\s*null/);
    assert.match(appSource, /impactAnimationDurationMs:\s*null/);
    assert.match(appSource, /impactAnimationStepCount:\s*null/);
    assert.match(appSource, /id="slider-drop-h"[^>]*type="number"[^>]*required/);
    assert.match(appSource, /id="select-drop-angle"[^>]*required/);
    assert.doesNotMatch(appSource, /id="slider-drop-h"[^>]*type="range"/);
    assert.doesNotMatch(appSource, /boundedUiNumber\(state\.manualParams\.dropHeight, 0\.5, 2\.5, 1\.5\)/);
    const caeIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/cae_ipc.js'), 'utf8');
    assert.match(caeIpc, /stepCount: \{ type: 'number', integer: true, min: 1, max: 10000 \}/);
  });

  it('Viewport3D.renderSmartphoneCad populates illustrative fastener and control shapes', () => {
    const vp = new Viewport3D('viewport-canvas');
    vp.renderSmartphoneCad(75, 8.2, 160);
    assert(vp.currentMesh !== null, 'currentMesh required');

    let hasIllustrativeFastener = false;
    let hasIllustrativeControl = false;
    let hasRuler = false;

    vp.currentMesh.traverse((child) => {
      if (child.userData && child.userData.partName) {
        if (child.userData.partName.includes('Illustrative fastener')) hasIllustrativeFastener = true;
        if (child.userData.partName.includes('Illustrative power button')) hasIllustrativeControl = true;
        if (child.userData.partName.includes('Illustrative ruler strip')) hasRuler = true;
      }
    });

    assert(hasIllustrativeFastener, 'Example assembly must contain illustrative fastener geometry');
    assert(hasIllustrativeControl, 'Example assembly must contain illustrative control geometry');
    assert(hasRuler, 'Example assembly must contain a visual ruler-like shape');
  });

  it('Viewport3D.renderPipingLoop3D creates synthetic process geometry without a stress verdict', () => {
    const vp = new Viewport3D('viewport-canvas');
    vp.renderPipingLoop3D(40, 10, 6);
    assert(vp.currentMesh !== null, 'currentMesh required');

    let hasFlangeAssy = false;
    let illustrativeDial = null;
    let hasSyntheticPart = false;
    let hasStressClassification = false;
    let meshCount = 0;

    vp.currentMesh.traverse((child) => {
      if (child.userData?.partName === 'Illustrative flange assembly') hasFlangeAssy = true;
      if (child.userData?.partName === 'Illustrative dial indicator') illustrativeDial = child;
      if (child.userData?.isSyntheticExample === true) hasSyntheticPart = true;
      if ('stressRatio' in (child.userData || {}) || 'codeStatus' in (child.userData || {}))
        hasStressClassification = true;
      if (child.isMesh) meshCount++;
    });

    assert(hasFlangeAssy, 'Illustrative loop must contain generic flange geometry');
    assert(illustrativeDial, 'Illustrative loop must retain its detailed dial geometry');
    assert.strictEqual(illustrativeDial.userData.type, 'IllustrativeDialGauge');
    assert.strictEqual(illustrativeDial.userData.readingAvailable, false);
    assert.strictEqual(illustrativeDial.userData.currentValue, null);
    assert.strictEqual(meshCount, 224, 'Illustrative loop should retain its original visual mesh count');
    assert(hasSyntheticPart, 'Piping geometry must identify synthetic parts');
    assert.strictEqual(hasStressClassification, false, 'Visualization must not embed a stress or code verdict');
  });

  it('Viewport3D.renderDrone3D exposes synthetic drone geometry without vendor or material claims', () => {
    const vp = new Viewport3D('viewport-canvas');
    vp.renderDrone3D(85, 8000);
    assert(vp.currentMesh !== null, 'currentMesh required');
    assert.strictEqual(vp.currentMesh.userData.isSyntheticExample, true);
    assert.strictEqual(vp.currentMesh.userData.validationLevel, 'experimental');
    assert.strictEqual(vp.currentMesh.userData.physicsSimulation, false);

    let hasStandoff = false;
    let hasMotor = false;
    let hasSpring = false;
    let hasSyntheticMetadata = false;
    let hasUnsupportedMetadata = false;
    let hasDecorativeParticleMetadata = false;

    vp.currentMesh.traverse((child) => {
      if (child.userData && child.userData.partName) {
        if (child.userData.partName.includes('standoff')) hasStandoff = true;
        if (child.userData.partName.includes('motor shape')) hasMotor = true;
        if (child.userData.partName.includes('spring')) hasSpring = true;
        if (child.userData.partName === 'Decorative particle effect' && child.userData.physicsSimulation === false) {
          hasDecorativeParticleMetadata = true;
        }
        if (child.userData.isSyntheticExample === true) hasSyntheticMetadata = true;
        if (
          /Toray|STM32|Betaflight|BLHeli|ASTM|7075-T6|1950KV|1400mAh|1200TVL|carbon composite/i.test(
            JSON.stringify(child.userData)
          )
        ) {
          hasUnsupportedMetadata = true;
        }
      }
    });

    assert(hasStandoff, 'Illustrative drone scene must contain a standoff-like form');
    assert(hasMotor, 'Illustrative drone scene must contain a motor-like form');
    assert(hasSpring, 'Illustrative drone scene must contain coil-spring forms');
    assert(hasSyntheticMetadata, 'Drone scene parts must identify synthetic provenance');
    assert(hasDecorativeParticleMetadata, 'Particle effect must identify decorative, non-simulation provenance');
    assert.strictEqual(
      hasUnsupportedMetadata,
      false,
      'Scene metadata must not imply vendor components or material records'
    );
  });

  it('Aerospace UI and legacy routes expose scene availability without unsourced engineering outputs', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const inspectorStart = appSource.indexOf('function renderAerospaceInspector()');
    const inspectorEnd = appSource.indexOf('function renderOilGasInspector()', inspectorStart);
    assert(inspectorStart >= 0 && inspectorEnd > inspectorStart, 'Expected aerospace inspector implementation');
    const inspectorSource = appSource.slice(inspectorStart, inspectorEnd);
    assert.match(inspectorSource, /calculations are unavailable/i);
    assert.doesNotMatch(
      inspectorSource,
      /Chamber Pressure|Mixture Ratio|Target Altitude|Wind Gust|Rotor RPM|Compute Rotor Thrust|Simulate 6-DOF|solveNasaRocket|simulateDrone|solvePropellerThrust/
    );
    assert.match(
      appSource,
      /No source-verified or caller-supplied feature history is loaded\. The viewport shows illustrative geometry only\./
    );
    assert.doesNotMatch(appSource, /getRocketFeatureTree/);

    const cadIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/cad_ipc.js'), 'utf8');
    const featureTreeRouteStart = cadIpc.indexOf("'omni:get-rocket-feature-tree'");
    const featureTreeRouteEnd = cadIpc.indexOf('\n  );', featureTreeRouteStart);
    assert(featureTreeRouteStart >= 0 && featureTreeRouteEnd > featureTreeRouteStart);
    const featureTreeRoute = cadIpc.slice(featureTreeRouteStart, featureTreeRouteEnd);
    assert.match(featureTreeRoute, /status: 'unavailable'/);
    assert.match(featureTreeRoute, /No source-verified or caller-supplied vehicle definition/);
    assert.doesNotMatch(
      featureTreeRoute,
      /createRocketAssemblyTree|createStagedCombustionEngineTree|createSpacecraftInteriorTree/
    );

    const controlsSource = fs.readFileSync(path.join(__dirname, '../src/main/ipc/controls_ipc.js'), 'utf8');
    const propellerStart = controlsSource.indexOf("'omni:solve-propeller'");
    const blockDiagramStart = controlsSource.indexOf("'omni:simulate-block-diagram'");
    const droneStart = controlsSource.indexOf("'omni:simulate-drone'");
    const bodeStart = controlsSource.indexOf("'omni:solve-bode'");
    assert(propellerStart >= 0 && blockDiagramStart > propellerStart, 'Expected propeller availability route');
    assert(droneStart >= 0 && bodeStart > droneStart, 'Expected drone availability route');
    assert.match(controlsSource.slice(propellerStart, blockDiagramStart), /status: 'unavailable'/);
    assert.match(controlsSource.slice(droneStart, bodeStart), /status: 'unavailable'/);
    assert.doesNotMatch(controlsSource, /CFDSolver2D\.solvePropellerThrust|QuadcopterDynamics\.simulateFlightMission/);

    const systemIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/system_ipc.js'), 'utf8');
    const wizardStart = systemIpc.indexOf("'omni:run-design-wizard'");
    const selfHealStart = systemIpc.indexOf("'omni:self-heal-design'", wizardStart);
    const asmeStart = systemIpc.indexOf("'omni:evaluate-asme-viii-div2'", selfHealStart);
    assert(wizardStart >= 0 && selfHealStart > wizardStart, 'Expected guided wizard availability route');
    assert(asmeStart > selfHealStart, 'Expected legacy structural remediation route');
    assert.match(systemIpc.slice(wizardStart, selfHealStart), /wizardType === 'drone'[\s\S]*?status: 'unavailable'/);
    assert.doesNotMatch(systemIpc.slice(wizardStart, selfHealStart), /drone\.runWizard/);
    const selfHealRoute = systemIpc.slice(selfHealStart, asmeStart);
    assert.match(selfHealRoute, /getStructuralRemediationUnavailableResult/);
    assert.doesNotMatch(selfHealRoute, /symbolicReasoner\.selfHealStructuralYield|safetyFactor\s*=\s*1\.5/);

    const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    assert.doesNotMatch(html, /core\/aerospace\/nasa_rocket_propulsion\.js/);
    assert.doesNotMatch(
      appSource,
      /entity\.specStandards|entity\.criticalTelemetry|Valid B-Rep Topology|BaseChassis_Extrude|Sapphire\)/
    );
    const bomStart = html.indexOf('<!-- Modal: eBOM Manager -->');
    const bomEnd = html.indexOf('<!-- Modal: Experimental Primitive Geometry Metrics -->', bomStart);
    assert(bomStart >= 0 && bomEnd > bomStart, 'Expected explicit-input eBOM panel');
    const bomSource = html.slice(bomStart, bomEnd);
    assert.match(bomSource, /id="ebom-input-json"/);
    assert.match(bomSource, /No sample records are inserted/i);
    assert.match(bomSource, /Root quantity is the requested assembly count/);
    assert.match(bomSource, /Leaf parts requested/);
    assert.match(bomSource, /Per-item rolled mass/);
    assert.match(bomSource, /ebom-quantity-header/);
    assert.match(bomSource, /ebom-mass-header/);
    assert.match(bomSource, /ebom-cost-header/);
    assert.doesNotMatch(bomSource, /ASM-DRONE|Toray|Ti-6Al-4V|7075-T6|\$\d+\.\d{2}/);
    assert.match(appSource, /rollupEBOM\(\{ rootAssembly \}\)/);
    assert.match(appSource, /result\.requestedTotals\.rolledUpMassKg/);
    assert.match(appSource, /revision: item\.revision/);
    assert.match(appSource, /ebomInput\.addEventListener\('input'/);
    assert.match(appSource, /requestSequence !== ebomRequestSequence/);
    assert.match(appSource, /btn-consolidate-hardware/);

    const diffStart = html.indexOf('<!-- Modal: caller-input CAD centroid comparison -->');
    const diffEnd = html.indexOf('<!-- Modal: eBOM Manager -->', diffStart);
    assert(diffStart >= 0 && diffEnd > diffStart, 'Expected caller-input CAD comparison panel');
    const diffHtml = html.slice(diffStart, diffEnd);
    assert.match(diffHtml, /id="diff-rev-a-input"/);
    assert.match(diffHtml, /id="diff-rev-b-input"/);
    assert.match(diffHtml, /id="diff-tolerance-mm"/);
    assert.match(diffHtml, /id="diff-modification-threshold-mm"/);
    assert.match(diffHtml, /length: "mm", volume: "mm3"/);
    assert.doesNotMatch(diffHtml, /Synthetic sample|<option/i);
    const diffHandlerStart = appSource.indexOf('const btnRunVisualDiff');
    const diffHandlerEnd = appSource.indexOf('// 6. eBOM Manager Modal', diffHandlerStart);
    assert(diffHandlerStart >= 0 && diffHandlerEnd > diffHandlerStart, 'Expected CAD comparison event handlers');
    const diffHandler = appSource.slice(diffHandlerStart, diffHandlerEnd);
    assert.doesNotMatch(diffHandler, /cadDiffModels|synthetic-sample|innerHTML/);
    assert.match(diffHandler, /visualDiffCAD\(\{ modelA, modelB, options \}\)/);
    assert.match(diffHandler, /requestSequence !== visualDiffRequestSequence/);
    assert.match(diffHandler, /invalidateVisualDiff\('Input changed/);

    const sampleSource = fs.readFileSync(path.join(__dirname, '../src/samples/community_samples.js'), 'utf8');
    assert.doesNotMatch(
      sampleSource,
      /vehicleHeightM|coreDiameterM|seaLevelIsp|vacuumIsp|liftoffThrustKn|grossLiftoffMassKg|payloadToLeoKg|shockDiamonds|gimbalAngleDeg|Toray T700/
    );
    assert.match(sampleSource, /Synthetic Quadcopter Geometry Template/);

    const droneWizardStart = appSource.indexOf('<!-- Wizard 2: Drone Design -->');
    const lensWizardStart = appSource.indexOf('<!-- Wizard 3: Lens Optics -->', droneWizardStart);
    assert(droneWizardStart >= 0 && lensWizardStart > droneWizardStart, 'Expected drone wizard status card');
    const wizardSource = appSource.slice(droneWizardStart, lensWizardStart);
    assert.match(wizardSource, /unavailable/i);
    assert.match(wizardSource, /disabled aria-disabled="true"/);
    assert.doesNotMatch(wizardSource, /runDesignWizard\('drone'/);
    assert.doesNotMatch(html, /6-DOF Drone Autopilot|Simulate 12m quadcopter altitude climb/);
  });

  it('User-controlled chat and command-palette text is rendered without HTML interpretation', () => {
    const previousDocument = global.document;
    const fakeDocument = {
      createTextNode: (textContent) => ({ nodeType: 'text', textContent, childNodes: [] }),
      createElement: (tagName) => ({
        nodeType: 'element',
        tagName: tagName.toUpperCase(),
        childNodes: [],
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        }
      })
    };
    global.document = fakeDocument;
    try {
      const { appendSafeInlineMarkup } = require('../src/ui/safe_dom.js');
      const root = fakeDocument.createElement('div');
      appendSafeInlineMarkup(
        root,
        '<strong>safe</strong><img src=x onerror=alert(1)><script>alert(2)</script><em>formatted</em>'
      );

      assert.deepStrictEqual(
        root.childNodes.map((node) => (node.nodeType === 'element' ? node.tagName : node.textContent)),
        ['STRONG', '<img src=x onerror=alert(1)><script>alert(2)</script>', 'EM']
      );
      assert.strictEqual(root.childNodes[0].childNodes[0].textContent, 'safe');
      assert.strictEqual(root.childNodes[2].childNodes[0].textContent, 'formatted');

      const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
      const propertyGridStart = appSource.indexOf('function renderPropertyGrid(');
      const propertyGridEnd = appSource.indexOf('  function ', propertyGridStart + 1);
      assert(propertyGridStart >= 0 && propertyGridEnd > propertyGridStart, 'Expected the viewport property renderer');
      const propertyGrid = appSource.slice(propertyGridStart, propertyGridEnd);
      assert.match(propertyGrid, /OmniPropertyGridView\?\.createPropertyGridElements/);
      assert.match(propertyGrid, /propertyGridContent\.replaceChildren\(\.\.\.propertyGridElements\)/);
      assert.doesNotMatch(propertyGrid, /innerHTML/);
      const consumerStart = appSource.indexOf('function renderConsumerInspector()');
      const consumerEnd = appSource.indexOf('inspectorContainer.innerHTML = html;', consumerStart);
      assert(consumerStart >= 0 && consumerEnd > consumerStart, 'Expected the consumer control renderer');
      const consumerRenderer = appSource.slice(consumerStart, consumerEnd);
      assert.doesNotMatch(consumerRenderer, /\$\{state\.manualParams\.[A-Za-z]/);

      const chatStart = appSource.indexOf('function addAiMessage(');
      const chatEnd = appSource.indexOf('window.omniAutoRemediate =', chatStart);
      assert(chatStart >= 0 && chatEnd > chatStart, 'Expected the chat renderer implementation');
      const chatRenderer = appSource.slice(chatStart, chatEnd);
      assert.doesNotMatch(chatRenderer, /innerHTML|onclick=/);
      assert.match(chatRenderer, /textContent = String\(text/);
      assert.match(chatRenderer, /addEventListener\('click'/);
      assert.match(appSource, /if \(!plan\?\.success\)/);
      assert.match(appSource, /applySuggestedManualEdit\(paramKey, paramVal\)/);
      assert.match(appSource, /MANUAL_PARAMETER_EDIT_VALIDATORS/);
      assert.match(appSource, /phoneMassKg: \(value\) => Number\.isFinite\(value\)/);
      const dropStart = appSource.indexOf("document.getElementById('btn-run-drop')");
      const dropEnd = appSource.indexOf('function renderEdaInspector()', dropStart);
      assert(dropStart >= 0 && dropEnd > dropStart, 'Expected the impact estimate renderer');
      const dropRenderer = appSource.slice(dropStart, dropEnd);
      assert.match(dropRenderer, /curDrop\.replaceChildren\(\)/);
      assert.match(dropRenderer, /pre\.textContent = JSON\.stringify/);
      assert.doesNotMatch(dropRenderer, /innerHTML/);
      const wizardStart = appSource.indexOf('const showWizardOutput =');
      const wizardEnd = appSource.indexOf('const readPositiveInput', wizardStart);
      assert(wizardStart >= 0 && wizardEnd > wizardStart, 'Expected the guided estimate renderer');
      const wizardRenderer = appSource.slice(wizardStart, wizardEnd);
      assert.match(wizardRenderer, /summary\.textContent/);
      assert.match(wizardRenderer, /detailBlock\.textContent/);
      assert.doesNotMatch(wizardRenderer, /innerHTML/);
      assert.doesNotMatch(appSource, /submitHPCJob\(/);
      const hpcStart = appSource.indexOf('async function refreshHpcTelemetry()');
      const hpcEnd = appSource.indexOf('if (btnOpenHpc', hpcStart);
      assert(hpcStart >= 0 && hpcEnd > hpcStart, 'Expected the provider telemetry renderer');
      const hpcRenderer = appSource.slice(hpcStart, hpcEnd);
      assert.match(hpcRenderer, /replaceChildren\(\)/);
      assert.doesNotMatch(hpcRenderer, /innerHTML/);

      const draftingStart = appSource.indexOf('const btnOpenDrafting =');
      const draftingEnd = appSource.indexOf('if (btnCloseDrafting', draftingStart);
      assert(draftingStart >= 0 && draftingEnd > draftingStart, 'Expected the sample drawing workflow');
      const draftingRenderer = appSource.slice(draftingStart, draftingEnd);
      assert.match(draftingRenderer, /scale: '1:1'/);
      assert.match(draftingRenderer, /units: 'mm'/);
      assert.match(draftingRenderer, /res\.svg\.length <= 1000000/);
      assert.match(draftingRenderer, /drawingImage\.src = `data:image\/svg\+xml;charset=utf-8,/);
      assert.match(draftingRenderer, /draftingSheetBody\.replaceChildren\(header, drawingFrame\)/);
      assert.doesNotMatch(draftingRenderer, /draftingSheetBody\.innerHTML/);

      const healerStart = appSource.indexOf('if (btnRunHeal && logHealOutput)');
      const healerEnd = appSource.indexOf('if (btnOpenHealer && modalHealer)', healerStart);
      assert(healerStart >= 0 && healerEnd > healerStart, 'Expected the geometry healing output renderer');
      const healerRenderer = appSource.slice(healerStart, healerEnd);
      assert.match(healerRenderer, /line\.textContent = text/);
      assert.match(healerRenderer, /logHealOutput\.replaceChildren\(output\)/);
      assert.doesNotMatch(healerRenderer, /logHealOutput\.innerHTML/);

      const viewportSource = fs.readFileSync(path.join(__dirname, '../src/ui/viewport3d.js'), 'utf8');
      const hoverStart = viewportSource.indexOf('checkRaycastHover() {');
      const hoverEnd = viewportSource.indexOf('\n  onResize()', hoverStart);
      assert(hoverStart >= 0 && hoverEnd > hoverStart, 'Expected the viewport metadata probe');
      const hoverRenderer = viewportSource.slice(hoverStart, hoverEnd);
      assert.match(hoverRenderer, /statsEl\.replaceChildren\(\)/);
      assert.match(hoverRenderer, /part\.textContent/);
      assert.doesNotMatch(hoverRenderer, /innerHTML/);

      const samplesStart = appSource.indexOf('function renderSampleCatalog()');
      const samplesEnd = appSource.indexOf('function loadSampleProject(', samplesStart);
      assert(samplesStart >= 0 && samplesEnd > samplesStart, 'Expected the synthetic sample catalog renderer');
      const samplesRenderer = appSource.slice(samplesStart, samplesEnd);
      assert.match(samplesRenderer, /title\.textContent/);
      assert.match(samplesRenderer, /description\.textContent/);
      assert.doesNotMatch(samplesRenderer, /innerHTML/);

      const paletteStart = appSource.indexOf('if (filtered.length === 0)');
      const paletteEnd = appSource.indexOf('selectedPaletteIndex = Math.max', paletteStart);
      assert(paletteStart >= 0 && paletteEnd > paletteStart, 'Expected command-palette empty state');
      const paletteEmptyState = appSource.slice(paletteStart, paletteEnd);
      assert.match(paletteEmptyState, /emptyState\.textContent/);
      assert.doesNotMatch(paletteEmptyState, /innerHTML/);

      const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
      assert.match(html, /<iframe\b(?=[^>]*id="report-iframe")(?=[^>]*sandbox="")[^>]*>/s);
      assert.match(html, /<script src="ui\/safe_dom\.js"><\/script>/);
      assert.match(html, /A job request\s+form is not available in this build/);
      assert.match(html, /Job submission unavailable/);
    } finally {
      global.document = previousDocument;
    }
  });

  it('Keeps the material catalog unavailable and restores explicit cuboid mass properties', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    assert.match(appSource, /No reviewed material catalog is bundled/i);
    assert.match(appSource, /solid cuboid/i);
    assert.match(appSource, /input-mass-density-source/);
    assert.match(appSource, /computeCuboidMassProperties/);
    assert.doesNotMatch(appSource, /select-material|material-inertia-telemetry|computeInertia\(/);
    assert.match(appSource, /Handset Thermal Analysis[\s\S]*?Unavailable/);
    assert.doesNotMatch(appSource, /btn-run-thermal|slider-soc-pwr|chk-vapor-chamber|solveThermal\(/);
    assert.match(appSource, /id="input-drop-mass"[^>]*required/);
    assert.match(appSource, /id="input-drop-duration-ms"[^>]*required/);
    assert.match(appSource, /id="input-drop-step-count"[^>]*required/);
    assert.match(appSource, /id="slider-drop-h"[^>]*required/);
    assert.match(appSource, /id="select-drop-angle"[^>]*required/);
    assert.match(appSource, /Enter a drop height from 0\.5 to 2\.5 m/);
    assert.match(appSource, /phoneMass:\s*phoneMassKg/);
    assert.doesNotMatch(appSource, /phoneMass:\s*0\.205|phoneMassKg:\s*0\.205/);

    const caeIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/cae_ipc.js'), 'utf8');
    const inertiaStart = caeIpc.indexOf('omni:compute-inertia');
    const explicitMassPropertiesStart = caeIpc.indexOf('omni:compute-cuboid-mass-properties', inertiaStart);
    const transientStart = caeIpc.indexOf('omni:solve-transient-drop', inertiaStart);
    assert(
      inertiaStart >= 0 && explicitMassPropertiesStart > inertiaStart,
      'Expected material inertia availability route'
    );
    assert(transientStart > explicitMassPropertiesStart, 'Expected explicit cuboid mass properties route');
    const inertiaRoute = caeIpc.slice(inertiaStart, explicitMassPropertiesStart);
    assert.match(inertiaRoute, /required: \['matKey', 'widthM', 'heightM', 'depthM'\]/);
    assert.match(inertiaRoute, /status: 'UNAVAILABLE'/);
    assert.doesNotMatch(inertiaRoute, /MaterialManager|= 0\.1|= 0\.05|= 0\.02/);
    const massPropertiesRoute = caeIpc.slice(explicitMassPropertiesStart, transientStart);
    assert.match(massPropertiesRoute, /required: \['widthM', 'heightM', 'depthM', 'densityKgM3', 'densitySource'\]/);
    assert.match(massPropertiesRoute, /MaterialManager\.computeCuboidMassProperties\(params\)/);

    const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    assert.match(preload, /computeCuboidMassProperties:.*omni:compute-cuboid-mass-properties/);

    const dropStart = caeIpc.indexOf('omni:solve-drop-test');
    const thermalStart = caeIpc.indexOf('omni:solve-thermal', dropStart);
    const transientDropStart = caeIpc.indexOf('omni:solve-transient-drop');
    const mesherStart = caeIpc.indexOf('omni:mesh-delaunay-3d', transientDropStart);
    assert(dropStart >= 0 && thermalStart > dropStart, 'Expected handset drop route');
    assert(transientDropStart >= 0 && mesherStart > transientDropStart, 'Expected transient drop route');
    const dropRoute = caeIpc.slice(dropStart, thermalStart);
    const transientDropRoute = caeIpc.slice(transientDropStart, mesherStart);
    assert.match(dropRoute, /required: \['dropHeight', 'phoneMass', 'impactAngle'\]/);
    assert.match(
      transientDropRoute,
      /required: \['dropHeightM', 'phoneMassKg', 'impactAngle', 'totalDurationMs', 'stepCount'\]/
    );

    const systemIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/system_ipc.js'), 'utf8');
    const materialStart = systemIpc.indexOf("'omni:get-materials-list'");
    const archiveStart = systemIpc.indexOf("'omni:package-omni-archive'", materialStart);
    assert(materialStart >= 0 && archiveStart > materialStart, 'Expected material catalog availability route');
    const materialRoute = systemIpc.slice(materialStart, archiveStart);
    assert.match(materialRoute, /status: 'UNAVAILABLE'/);
    assert.match(materialRoute, /materials: \[\]/);
    assert.doesNotMatch(materialRoute, /MaterialManager/);

    const thermalCore = fs.readFileSync(path.join(__dirname, '../src/core/cae/thermal_cht.js'), 'utf8');
    const handsetThermalStart = thermalCore.indexOf('static simulateSmartphoneThermal()');
    const explicitSolverStart = thermalCore.indexOf('static solveTransientConduction2D', handsetThermalStart);
    assert(handsetThermalStart >= 0 && explicitSolverStart > handsetThermalStart);
    const handsetThermal = thermalCore.slice(handsetThermalStart, explicitSolverStart);
    assert.match(handsetThermal, /status: 'UNAVAILABLE'/);
    assert.doesNotMatch(handsetThermal, /kChassis|maxSocTempC|temperatureMap|verdict/);
    assert.doesNotMatch(thermalCore, /kChassis|maxSocTempC|verdict/);
    assert.match(thermalCore, /temperatureMap: this\.exportSampledHeatmap/);
  });

  it('Contact mechanics command palette does not inject engineering defaults or claim a discrete solve', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const commandStart = appSource.indexOf("id: 'tool-contact-fea'");
    const followingCommandStart = appSource.indexOf("id: 'tool-zmx-import'", commandStart);
    assert(commandStart >= 0 && followingCommandStart > commandStart, 'Expected contact mechanics palette entry');
    const commandSource = appSource.slice(commandStart, followingCommandStart);

    assert.match(commandSource, /Unavailable: Experimental Hertz Formula Estimate/);
    assert.match(commandSource, /No calculation was run/);
    assert.match(commandSource, /contact radius \(m\)/);
    assert.match(commandSource, /normal load \(N\)/);
    assert.match(commandSource, /Young’s modulus for both bodies \(Pa\)/);
    assert.match(commandSource, /Poisson ratios \(dimensionless\)/);
    assert.doesNotMatch(
      commandSource,
      /solveContactMechanics3D|radius:\s*\d|load:\s*\d|E1:\s*\d|E2:\s*\d|nu1:\s*\d|nu2:\s*\d/
    );
    assert.doesNotMatch(commandSource, /augmented Lagrangian|penalty contact pairs|stick-slip/i);
  });

  it('CAD command palette examples provide explicit millimetre inputs to strict IPC routes', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const extrudeStart = appSource.indexOf("id: 'tool-cad-extrude'");
    const revolveStart = appSource.indexOf("id: 'tool-cad-revolve'", extrudeStart);
    const shellStart = appSource.indexOf("id: 'tool-cad-shell'", revolveStart);
    const camStart = appSource.indexOf("id: 'tool-cam-gcode'", shellStart);
    assert(extrudeStart >= 0 && revolveStart > extrudeStart && shellStart > revolveStart && camStart > shellStart);

    const extrudeCommand = appSource.slice(extrudeStart, revolveStart);
    const revolveCommand = appSource.slice(revolveStart, shellStart);
    const shellCommand = appSource.slice(shellStart, camStart);
    for (const command of [extrudeCommand, revolveCommand, shellCommand]) {
      assert.match(command, /Experimental .* Example/);
      assert.match(command, /lengthUnit: 'mm'/);
      assert.match(command, /bundled/i);
    }
    assert.match(extrudeCommand, /profile:\s*\[\s*\{\s*x:/);
    assert.match(extrudeCommand, /draftAngleDeg:/);
    assert.match(revolveCommand, /profile:\s*\[\s*\{\s*x:/);
    assert.match(revolveCommand, /angleDeg:/);
    assert.match(revolveCommand, /axis:/);
    assert.match(shellCommand, /width:/);
    assert.match(shellCommand, /height:/);
    assert.match(shellCommand, /depth:/);
    assert.match(shellCommand, /wallThickness:/);
  });

  it('Cantilever palette actions identify the formula example and include units', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const entryStart = appSource.indexOf("id: 'tool-cae-nonlinear'");
    const nextEntryStart = appSource.indexOf("id: 'tool-eda-pnr'", entryStart);
    assert(entryStart >= 0 && nextEntryStart > entryStart, 'Expected cantilever example palette entry');
    const entry = appSource.slice(entryStart, nextEntryStart);
    assert.match(entry, /Experimental Cantilever Formula Example/);
    assert.match(entry, /not finite-element analysis/i);
    assert.match(entry, /lengthUnit: 'mm'/);
    assert.match(entry, /modulusUnit: 'MPa'/);
    assert.match(entry, /forceUnit: 'N'/);
    assert.doesNotMatch(entry, /numElements|Newton-Raphson|converg/i);

    const contextActionStart = appSource.indexOf("case 'nonlinear-fea':");
    const contextActionEnd = appSource.indexOf("case 'measure-caliper':", contextActionStart);
    assert(contextActionStart >= 0 && contextActionEnd > contextActionStart, 'Expected cantilever context action');
    const contextAction = appSource.slice(contextActionStart, contextActionEnd);
    assert.match(contextAction, /lengthUnit: 'mm'/);
    assert.match(contextAction, /modulusUnit: 'MPa'/);
    assert.match(contextAction, /forceUnit: 'N'/);
    assert.doesNotMatch(contextAction, /numElements|Newton-Raphson|converg/i);

    const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    const contextLabelStart = html.indexOf('data-action="nonlinear-fea"');
    assert(contextLabelStart >= 0, 'Expected cantilever context-menu label');
    assert.match(html.slice(contextLabelStart, contextLabelStart + 220), /Experimental Cantilever Formula Example/);
  });

  it('Viewport3D legacy engine-stand route returns synthetic geometry and decorative effects only', () => {
    const vp = new Viewport3D('viewport-canvas');
    vp.renderRaptorTestStand3D();
    assert(vp.currentMesh !== null, 'currentMesh required');
    assert.strictEqual(vp.currentMesh.userData.isSyntheticExample, true);
    assert.strictEqual(vp.currentMesh.userData.validationLevel, 'experimental');
    assert.strictEqual(vp.currentMesh.userData.physicsSimulation, false);

    let hasPlume = false;
    let hasNozzle = false;
    let hasGimbal = false;
    let hasSyntheticPart = false;
    let hasUnsupportedMetadata = false;

    vp.currentMesh.traverse((child) => {
      if (child.userData) {
        if (child.userData.type === 'Illustrative Plume Visual Effect') hasPlume = true;
        if (child.userData.partName?.includes('Illustrative nozzle')) hasNozzle = true;
        if (child.userData.partName?.includes('Illustrative joint ring')) hasGimbal = true;
        if (child.userData.isSyntheticExample === true) hasSyntheticPart = true;
        const metadataText = JSON.stringify(child.userData);
        if (/NASA|SpaceX|ASTM|ASME|Inconel|GRCop|machNumber|shockCount|pressure|thrust/i.test(metadataText)) {
          hasUnsupportedMetadata = true;
        }
      }
    });

    assert(hasPlume, 'Illustrative stand must contain its decorative plume effect');
    assert(hasNozzle, 'Illustrative stand must contain nozzle-like geometry');
    assert(hasGimbal, 'Illustrative stand must contain joint-ring geometry');
    assert(hasSyntheticPart, 'Illustrative stand parts must identify synthetic provenance');
    assert.strictEqual(hasUnsupportedMetadata, false, 'Scene metadata must not claim physical properties or standards');
    assert(vp.activeShaderMaterials.length > 0, 'activeShaderMaterials must track plume material');

    const source = fs.readFileSync(path.join(__dirname, '../src/ui/viewport3d.js'), 'utf8');
    const methodStart = source.indexOf('renderRaptorTestStand3D()');
    const methodEnd = source.indexOf('renderNasaSpaceRocket3D(', methodStart);
    assert(methodStart >= 0 && methodEnd > methodStart, 'Expected the compatibility route implementation');
    const methodSource = source.slice(methodStart, methodEnd);
    assert.doesNotMatch(
      methodSource,
      /SpaceX|NASA|ASTM|ASME|GRCop|Inconel|machNumber|shockCount|350 bar|320, 'BAR|280, 'BAR/i
    );
  });

  it('aerospace visualization emits generic synthetic metadata without standard or flight claims', () => {
    for (const mode of ['full_stack', 'engine_macro', 'spacecraft_interior']) {
      const assembly = new NasaSpaceRocket3D().buildAssembly(mode, undefined, { ProceduralHardware, PhenomenaShaders });
      assert(assembly.partsList.length > 0, `Expected illustrative geometry for ${mode}`);
      let meshCount = 0;
      assembly.group.traverse((child) => {
        if (child.isMesh) meshCount++;
      });
      if (mode === 'engine_macro') {
        assert.strictEqual(meshCount, 357, 'Expected the original engine scene geometry to remain available');
        const decorativeDials = [];
        assembly.group.traverse((child) => {
          if (child.userData?.type === 'IllustrativeDialGauge') decorativeDials.push(child);
        });
        assert.strictEqual(decorativeDials.length, 2);
        decorativeDials.forEach((dial) => {
          assert.strictEqual(dial.userData.readingAvailable, false);
          assert.strictEqual(dial.userData.currentValue, null);
        });
      }
      assembly.partsList.forEach((part, index) => {
        assert.strictEqual(part.isSyntheticExample, true);
        assert.strictEqual(part.isNasaEntity, false);
        assert.strictEqual(part.componentId, `SYNTH-AERO-${index + 1}`);
        assert.strictEqual(part.specStandard, 'No standards assessment');
      });

      const sceneMetadata = [];
      assembly.group.traverse((child) => {
        if (child.userData && Object.keys(child.userData).length > 0)
          sceneMetadata.push(JSON.stringify(child.userData));
      });
      assert.doesNotMatch(
        sceneMetadata.join(' '),
        /NASA-STD|NASA SP-|MIL-STD|AIAA S-|DO-178C|Narloy|Inconel|Ti-6Al-4V|Al-Li|machNumber|shockCount|BAR \(LOX\)|BAR \(CH4\)/i
      );
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/ui/nasa_space_rocket_3d.js'), 'utf8');
    assert.doesNotMatch(
      source,
      /NASA-STD-|NASA SP-|MIL-STD-|AIAA S-|DO-178C|Narloy|Inconel|Ti-6Al-4V|Al-Li|42,000 RPM|28,000 RPM/
    );
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
    assert(appContent.includes('btn-cad-raptor'), 'app.js must wire btn-cad-raptor');
    assert(appContent.includes('renderRaptorTestStand3D'), 'app.js must invoke renderRaptorTestStand3D');
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

  it('StorytellingRails labels the aerospace tour as synthetic and omits unsupported source claims', () => {
    const stages = [...StorytellingRails.DEFAULT_STAGES, ...StorytellingRails.NASA_ROCKET_STAGES];
    const visibleText = stages.map((stage) => `${stage.title} ${stage.subtitle}`).join(' ');
    const ctrl = StorytellingRails.createController();
    assert.deepStrictEqual(ctrl.loadStagePreset('nasa_rocket'), StorytellingRails.NASA_ROCKET_STAGES);

    assert(
      StorytellingRails.NASA_ROCKET_STAGES.every((stage) =>
        /illustrative|synthetic/i.test(`${stage.title} ${stage.subtitle}`)
      ),
      'Every aerospace tour stage must identify itself as illustrative or synthetic'
    );
    assert.doesNotMatch(
      visibleText,
      /NASA|SLS|WBS|ISO|NASA-STD|NASA SP-|AIAA|MIL-STD|DO-178C|Narloy|38\.5\s*kPa|42,000\s*RPM|complete 2-stage|thermal telemetry|telemetry\s*:/i,
      'Tour copy must not imply NASA provenance, standards conformance, specific operating data, or real telemetry'
    );
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

  it('Optics and guided design routes reject omitted lens and PCB inputs', () => {
    const opticsIpc = fs.readFileSync(path.join(__dirname, '../src/main/ipc/optics_ipc.js'), 'utf8');
    const opticsStart = opticsIpc.indexOf("'omni:solve-optics'");
    const raysStart = opticsIpc.indexOf("'omni:trace-rays'", opticsStart);
    assert(opticsStart >= 0 && raysStart > opticsStart, 'Expected scalar optics IPC route');
    const opticsRoute = opticsIpc.slice(opticsStart, raysStart);
    assert.match(
      opticsRoute,
      /required: \['focalLengthMm', 'fStop', 'subjectDistM', 'wavelengthNm', 'circleOfConfusionMm'\]/
    );
    assert.doesNotMatch(opticsRoute, /focalLengthMm\s*=\s*50|fStop\s*=\s*1\.4|subjectDistM\s*=\s*2/);

    const wizardSource = fs.readFileSync(path.join(__dirname, '../src/ui/wizards/design_wizards.js'), 'utf8');
    assert.match(
      wizardSource,
      /CameraLensWizard requires positive focalLengthMm, fStop, subjectDistM, wavelengthNm, and circleOfConfusionMm inputs/
    );
    assert.match(
      wizardSource,
      /PCBDesignWizard requires positive layerCount, dielectricHeightMm, targetImpedanceOhm, er, and copperThicknessMm inputs/
    );
    assert.doesNotMatch(
      wizardSource,
      /inputs\.focalLengthMm\s*\|\|\s*50|inputs\.fStop\s*\|\|\s*1\.4|inputs\.targetImpedanceOhm\s*\|\|\s*50/
    );
  });

  it('Control routes do not synthesize model data or silently select solver inputs', () => {
    const controlsSource = fs.readFileSync(path.join(__dirname, '../src/main/ipc/controls_ipc.js'), 'utf8');
    const blockStart = controlsSource.indexOf("'omni:simulate-block-diagram'");
    const bodeStart = controlsSource.indexOf("'omni:solve-bode'");
    const lqrStart = controlsSource.indexOf("'omni:synthesize-lqr'");
    const mpcStart = controlsSource.indexOf("'omni:solve-mpc'");
    const daeStart = controlsSource.indexOf("'omni:simulate-simscape-dae'");
    assert(
      blockStart >= 0 && bodeStart > blockStart && lqrStart > bodeStart && mpcStart > lqrStart && daeStart > mpcStart
    );
    assert.match(controlsSource.slice(blockStart, bodeStart), /BLOCK_DIAGRAM_REQUEST_SCHEMA/);
    assert.match(controlsSource, /required: \['graphData', 'tEnd', 'dt', 'units'\]/);
    assert.match(
      controlsSource.slice(bodeStart, lqrStart),
      /required: \['numCoeffs', 'denCoeffs', 'omegaMin', 'omegaMax', 'points'\]/
    );
    assert.match(controlsSource.slice(lqrStart, mpcStart), /required: \['A', 'B', 'Q', 'R', 'maxIter', 'tolerance'\]/);
    assert.match(controlsSource.slice(mpcStart, daeStart), /predictionHorizon[\s\S]*initialControl/);
    assert.match(controlsSource.slice(daeStart), /initialCurrentAmps[\s\S]*initialAngularVelocityRadS/);
    assert.doesNotMatch(controlsSource, /task_fast|A\s*=\s*params\.A\s*\|\||params\.modelSpec\s*\|\|/);
    assert.match(controlsSource, /Caller-supplied FMU artifacts[\s\S]*does not create placeholder FMUs/);

    const blockGraphSource = fs.readFileSync(
      path.join(__dirname, '../src/core/dynamic_simulink/block_graph.js'),
      'utf8'
    );
    assert.match(blockGraphSource, /requires positive finite tEnd and dt inputs/);
    assert.match(blockGraphSource, /requires a finite/);
    assert.match(blockGraphSource, /1,000,000-step work limit/);
  });

  it('Block diagram UI does not preload a synthetic control model or fabricated scope trace', () => {
    const blockUiSource = fs.readFileSync(path.join(__dirname, '../src/ui/block_diagram_ui.js'), 'utf8');
    assert.match(blockUiSource, /this\.blocks\s*=\s*\[\]/);
    assert.match(blockUiSource, /this\.wires\s*=\s*\[\]/);
    assert.match(blockUiSource, /No caller-supplied model is loaded/);
    assert.match(blockUiSource, /No solver result is loaded/);
    assert.doesNotMatch(blockUiSource, /Altitude Setpoint \(12m\)|Cascaded Altitude PID|Synthetic Trace Preview/);
    assert.doesNotMatch(blockUiSource, /Math\.cos\(t \* 3\.8\)|Math\.sin\(t \* 18/);

    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    const start = appSource.indexOf('function renderSimulinkInspector()');
    const end = appSource.indexOf('function renderCadInspector()', start);
    assert(start >= 0 && end > start, 'Expected the controls inspector implementation');
    const inspectorSource = appSource.slice(start, end);
    assert.match(inspectorSource, /No caller-supplied block model is loaded/);
    assert.doesNotMatch(inspectorSource, /value="2\.5"|value="0\.5"|Solve Dynamic Continuous Loop/);
    assert.match(inspectorSource, /simulink-model-json/);
    assert.match(inspectorSource, /simulink-t-end-seconds/);
    assert.match(inspectorSource, /simulink-dt-seconds/);
    assert.match(inspectorSource, /simulateBlockDiagram/);
    assert.match(inspectorSource, /dimensionless signals[\s\S]*seconds/i);
    assert.match(inspectorSource, /sine frequency is Hz[\s\S]*integrator is withheld/i);

    const controlsSource = fs.readFileSync(path.join(__dirname, '../src/main/ipc/controls_ipc.js'), 'utf8');
    const blockStart = controlsSource.indexOf("'omni:simulate-block-diagram'");
    const bodeStart = controlsSource.indexOf("'omni:solve-bode'", blockStart);
    assert(blockStart >= 0 && bodeStart > blockStart);
    assert.match(controlsSource.slice(blockStart, bodeStart), /BLOCK_DIAGRAM_REQUEST_SCHEMA/);
    assert.match(controlsSource, /required: \['graphData', 'tEnd', 'dt', 'units'\]/);
    assert.match(controlsSource, /dimensionless/);
    assert.match(controlsSource, /fixedUnitSchema\('s', 'time'\)/);
    assert.match(controlsSource, /fixedUnitSchema\('Hz', 'frequency'\)/);
    const { validateSchema } = require('../src/main/ipc/define_handler');
    const {
      BLOCK_DIAGRAM_REQUEST_SCHEMA,
      validateBlockDiagramGraph,
      runBlockDiagramSimulation
    } = require('../src/main/ipc/controls_ipc');
    const graphData = {
      blocks: [{ id: 'input', type: 'source_constant', params: { value: 1 } }],
      connections: []
    };
    const explicitUnitPayload = {
      graphData,
      tEnd: 1,
      dt: 0.01,
      units: {
        tEnd: { unit: 's', dimension: 'time' },
        dt: { unit: 's', dimension: 'time' },
        signal: { unit: '1', dimension: 'dimensionless' },
        stepTime: { unit: 's', dimension: 'time' },
        sourceFrequency: { unit: 'Hz', dimension: 'frequency' },
        gain: { unit: '1', dimension: 'dimensionless' },
        pid: {
          kp: { unit: '1', dimension: 'dimensionless' },
          ki: { unit: 's^-1', dimension: 'frequency' },
          kd: { unit: 's', dimension: 'time' },
          initialState: { unit: 's', dimension: 'time' },
          limits: { unit: '1', dimension: 'dimensionless' }
        },
        layout: { unit: 'px', dimension: 'display-coordinate' }
      }
    };
    assert.doesNotThrow(() => validateSchema(explicitUnitPayload, BLOCK_DIAGRAM_REQUEST_SCHEMA));
    assert.strictEqual(validateBlockDiagramGraph(graphData), true);
    assert.throws(
      () =>
        validateSchema(
          {
            ...explicitUnitPayload,
            units: { ...explicitUnitPayload.units, sourceFrequency: { unit: 'rad/s', dimension: 'frequency' } }
          },
          BLOCK_DIAGRAM_REQUEST_SCHEMA
        ),
      /must be one of Hz/
    );
    assert.throws(
      () =>
        validateBlockDiagramGraph({
          ...graphData,
          blocks: [{ id: 'state', type: 'integrator', params: { initialState: 0 } }]
        }),
      /unsupported shape or type/
    );
    assert.throws(
      () =>
        validateBlockDiagramGraph({
          ...graphData,
          blocks: [{ id: 'input', type: 'source_constant', params: { value: 1, units: 'kg' } }]
        }),
      /unsupported parameter/
    );
    const routeGraph = {
      blocks: [
        { id: 'source', type: 'source_constant', params: { value: 1 } },
        { id: 'gain', type: 'gain', params: { k: 2 } },
        { id: 'scope', type: 'scope', params: {} }
      ],
      connections: [
        { id: 'source-gain', fromBlock: 'source', toBlock: 'gain' },
        { id: 'gain-scope', fromBlock: 'gain', toBlock: 'scope' }
      ]
    };
    const routeResult = runBlockDiagramSimulation({ graphData: routeGraph, tEnd: 0.2, dt: 0.1 });
    assert.deepStrictEqual(routeResult.units, {
      time: { unit: 's', dimension: 'time' },
      signal: { unit: '1', dimension: 'dimensionless' }
    });
    assert.deepStrictEqual(routeResult.signals.scope, [2, 2, 2]);
    assert.throws(
      () => validateSchema({ graphData, tEnd: 1, dt: 0.01 }, BLOCK_DIAGRAM_REQUEST_SCHEMA),
      /Missing required object property 'units'/
    );

    const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    assert.match(preloadSource, /simulateBlockDiagram:[\s\S]*?units:[\s\S]*?dimensionless/);

    const previousDocument = global.document;
    const previousRequestAnimationFrame = global.requestAnimationFrame;
    const context = new Proxy(
      {},
      {
        get: () => () => {},
        set: () => true
      }
    );
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 800,
      clientHeight: 500,
      parentElement: null,
      closest: () => null,
      getContext: () => context,
      addEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 })
    };
    global.document = { getElementById: () => canvas };
    global.requestAnimationFrame = () => {
      throw new Error('The empty block diagram must not schedule a synthetic scope animation.');
    };
    try {
      require('../src/ui/block_diagram_ui.js');
      const diagram = new global.BlockDiagramUI('block-diagram-safety-test');
      assert.deepStrictEqual(diagram.blocks, []);
      assert.deepStrictEqual(diagram.wires, []);
      assert.strictEqual(diagram.loadPreset('drone').status, 'unavailable');
      assert.strictEqual(diagram.startOscilloscopeAnimation().status, 'unavailable');
      assert.match(diagram.startOscilloscopeAnimation().error.message, /returned solver samples/);
      assert.deepStrictEqual(diagram.blocks, []);
    } finally {
      global.document = previousDocument;
      global.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it('Block diagram accepts an explicit graph and displays only returned solver samples', () => {
    const previousDocument = global.document;
    const context = new Proxy(
      {},
      {
        get: () => () => {},
        set: () => true
      }
    );
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 800,
      clientHeight: 500,
      parentElement: null,
      closest: () => null,
      getContext: () => context,
      addEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 })
    };
    global.document = { getElementById: () => canvas };
    try {
      require('../src/ui/block_diagram_ui.js');
      const diagram = new global.BlockDiagramUI('block-diagram-explicit-model-test');
      const graphData = {
        blocks: [
          { id: 'source', type: 'source_constant', name: 'Input', params: { value: 1 } },
          { id: 'gain', type: 'gain', name: 'Gain', params: { k: 2 } },
          { id: 'scope', type: 'scope', name: 'Output', params: {} }
        ],
        connections: [
          { id: 'wire-source-gain', fromBlock: 'source', toBlock: 'gain', fromPort: 0, toPort: 0 },
          { id: 'wire-gain-scope', fromBlock: 'gain', toBlock: 'scope', fromPort: 0, toPort: 0 }
        ]
      };
      diagram.loadModel(graphData);
      assert.deepStrictEqual(
        diagram.blocks.map((block) => block.id),
        ['source', 'gain', 'scope']
      );
      assert.strictEqual(diagram.simulationResult, null);
      assert.strictEqual(diagram.wires.length, 2);

      const result = {
        units: {
          time: { unit: 's', dimension: 'time' },
          signal: { unit: '1', dimension: 'dimensionless' }
        },
        time: [0, 0.1, 0.2],
        signals: { source: [1, 1, 1], gain: [2, 2, 2], scope: [2, 2, 2] }
      };
      diagram.setSimulationResult(result);
      assert.strictEqual(diagram.simulationResult, result);
      assert.throws(
        () => diagram.setSimulationResult({ ...result, time: [0, Number.NaN], signals: { scope: [0, 1] } }),
        /finite and strictly increasing/
      );
    } finally {
      global.document = previousDocument;
    }
  });

  it('Optical ray tracing accepts an explicit surface system and marks results experimental', () => {
    const { validateSchema } = require('../src/main/ipc/define_handler');
    const { SKEW_OPTICS_SCHEMA, runSkewOptics } = require('../src/main/ipc/optics_ipc');
    assert.throws(() => validateSchema({}, SKEW_OPTICS_SCHEMA), /Missing required object property/);

    const input = {
      surfaces: [
        {
          radius: 0,
          zVertex: 0,
          clearRadius: 2,
          nIncident: 1,
          nTransmitted: 1.5,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        },
        {
          radius: 0,
          zVertex: 5,
          clearRadius: 2,
          nIncident: 1.5,
          nTransmitted: 1,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        }
      ],
      entrancePupilRadiusMm: 1,
      pupilPlaneZMm: -10,
      wavelengthUm: 0.55,
      numRings: 1,
      raysPerRing: 4,
      fieldAngleDeg: 0,
      sensorZMm: 10,
      fStop: 2,
      maxFrequencyLpMm: 100
    };
    validateSchema(input, SKEW_OPTICS_SCHEMA);
    const result = runSkewOptics(input);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.requestedRayCount, 5);
    assert.strictEqual(result.spotData.count, 5);
    assert.strictEqual(result.wavelengthNm, 550);
    assert(result.warnings.some((warning) => warning.includes('RMS-spot approximation')));
  });

  it('Optical inspector displays unavailable state without invented metrics or plot points', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/ui/optical_inspector_ui.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
    assert.doesNotMatch(source, /11\.6 µm|24\.2 µm|48\.5 lp\/mm|62\.0 lp\/mm|1300 lp\/mm|samplePoints/);
    assert.doesNotMatch(source, /entrancePupilRadius:\s*10\.0|fStop:\s*state\.manualParams\.lensFStop\s*\|\|\s*1\.4/);
    assert.match(source, /readInputRequest\(\)/);
    assert.match(appSource, /solveSkewOptics\(request\)/);
    assert.match(appSource, /Open the caller-input optical inspector/);
    assert.doesNotMatch(appSource, /Display sample ray-tracing and image-quality estimates/);

    const previousDocument = global.document;
    const container = { innerHTML: '' };
    global.document = { getElementById: (id) => (id === 'optical-inspector-contract-test' ? container : null) };
    try {
      const { OpticalInspectorUI } = require('../src/ui/optical_inspector_ui');
      const inspector = new OpticalInspectorUI('optical-inspector-contract-test');
      inspector.render({ success: false, error: { message: 'No source-reviewed prescription.' } });
      assert.match(container.innerHTML, /Experimental optical analysis unavailable/);
      assert.match(container.innerHTML, /No source-reviewed prescription/);
      assert.match(container.innerHTML, /optical-surfaces-input/);
      assert.match(container.innerHTML, /btn-run-optical-inspection/);
      assert.doesNotMatch(container.innerHTML, /RMS Spot Radius|MTF50 Frequency Estimate|<canvas/);

      const hostileMarkup = '</textarea><img src=x onerror=alert(1)>';
      inspector.setInputRequest({ surfaces: [{ note: hostileMarkup }] });
      const hostileInputForm = inspector._renderInputForm();
      assert.match(hostileInputForm, /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.doesNotMatch(hostileInputForm, /<img src=x onerror=/);

      inspector.render({ success: false, error: { message: hostileMarkup } });
      assert.match(container.innerHTML, /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.doesNotMatch(container.innerHTML, /<img src=x onerror=/);

      const { runSkewOptics } = require('../src/main/ipc/optics_ipc');
      const input = {
        surfaces: [
          {
            radius: 0,
            zVertex: 0,
            clearRadius: 2,
            nIncident: 1,
            nTransmitted: 1.5,
            conic: 0,
            asphericCoeffs: [0, 0, 0, 0]
          },
          {
            radius: 0,
            zVertex: 5,
            clearRadius: 2,
            nIncident: 1.5,
            nTransmitted: 1,
            conic: 0,
            asphericCoeffs: [0, 0, 0, 0]
          }
        ],
        entrancePupilRadiusMm: 1,
        pupilPlaneZMm: -10,
        wavelengthUm: 0.55,
        numRings: 1,
        raysPerRing: 4,
        fieldAngleDeg: 0,
        sensorZMm: 10,
        fStop: 2,
        maxFrequencyLpMm: 100
      };
      const formValues = {
        'optical-surfaces-input': JSON.stringify(input.surfaces),
        'optical-pupil-radius': String(input.entrancePupilRadiusMm),
        'optical-pupil-plane': String(input.pupilPlaneZMm),
        'optical-wavelength': String(input.wavelengthUm),
        'optical-ring-count': String(input.numRings),
        'optical-rays-per-ring': String(input.raysPerRing),
        'optical-field-angle': String(input.fieldAngleDeg),
        'optical-sensor-position': String(input.sensorZMm),
        'optical-f-number': String(input.fStop),
        'optical-max-frequency': String(input.maxFrequencyLpMm)
      };
      const containerDocument = global.document;
      global.document = {
        getElementById: (id) => (Object.hasOwn(formValues, id) ? { value: formValues[id] } : null)
      };
      assert.deepStrictEqual(inspector.readInputRequest(), input);
      global.document = containerDocument;
      inspector.setInputRequest(input);
      const opticalResult = runSkewOptics(input);
      inspector.render(opticalResult);
      assert.match(container.innerHTML, /RMS Spot Radius/);
      assert.match(container.innerHTML, /Experimental MTF Estimate/);
      assert.match(container.innerHTML, /User-Supplied Optical Surface Table/);
      assert.match(container.innerHTML, /&quot;zVertex&quot;: 0/);

      inspector.render({ ...opticalResult, warnings: [hostileMarkup] });
      assert.match(container.innerHTML, /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.doesNotMatch(container.innerHTML, /<img src=x onerror=/);
    } finally {
      global.document = previousDocument;
    }
  });

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passedTests} / ${totalTests} experimental UI smoke assertions passed`);
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
