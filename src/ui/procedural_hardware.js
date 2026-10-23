/**
 * OmniEng Procedural Mechanical Hardware Engine
 * Inspired by wheresryan22/anatomy "The object is the explanation" rules.
 * 
 * Generates true precision physical components:
 * - Diamond and straight knurled thumb screws & focus rings
 * - ISO 4762 socket head cap screws with hex recesses
 * - ASME B16.5 high-pressure pipe flanges with bolt circles
 * - Helical coil springs with compression support
 * - Dial indicator gauges with live moving needles
 * - Calibrated linear ruler strips
 * - Continuous scalloped weld beads
 */

(function (root, factory) {
  const THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : ((typeof global !== 'undefined' && global.THREE) ? global.THREE : (typeof require !== 'undefined' ? (function () { try { return require('three'); } catch (e) { return null; } })() : null));
  const instance = factory(THREE);
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.ProceduralHardware = instance;
  }
  if (typeof window !== 'undefined') {
    window.ProceduralHardware = instance;
  }
}(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  if (!THREE) {
    console.warn('ProceduralHardware requires Three.js');
  }

  /**
   * Default high-grade industrial materials
   */
  function getDefaultMaterials() {
    return {
      steel: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.3 }),
      blackOxide: new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.45 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.88, roughness: 0.28 }),
      needleLit: new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.6 }),
      dialFace: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9, metalness: 0.05 }),
      gasket: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95, metalness: 0.1 })
    };
  }

  /**
   * 1. Knurled Cylinder / Thumb Screw / Lens Ring
   */
  function createKnurledCylinder(radius = 10, height = 8, opt1 = 32, opt2 = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    let knurlCount = 32;
    let mat = mats.steel;

    if (typeof opt1 === 'number') {
      if (opt1 > 1000) {
        // Hex color passed as 3rd arg (e.g. 0x64748b)
        mat = new THREE.MeshStandardMaterial({ color: opt1, metalness: 0.85, roughness: 0.25 });
        if (typeof opt2 === 'number') knurlCount = opt2;
      } else {
        knurlCount = opt1;
        if (opt2 && opt2.isMaterial) mat = opt2;
        else if (typeof opt2 === 'number') mat = new THREE.MeshStandardMaterial({ color: opt2, metalness: 0.85, roughness: 0.25 });
      }
    } else if (opt1 && opt1.isMaterial) {
      mat = opt1;
      if (typeof opt2 === 'number') knurlCount = opt2;
    }

    // Safety clamp knurl count to prevent excessive geometry
    knurlCount = Math.min(Math.max(knurlCount, 4), 64);

    // Base core
    const coreGeom = new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, height, 32);
    const core = new THREE.Mesh(coreGeom, mat);
    group.add(core);

    // Procedural knurl ribs around perimeter
    const ribGeom = new THREE.BoxGeometry(radius * 0.1, height * 0.96, radius * 0.06);
    const ribGroup = new THREE.Group();
    for (let i = 0; i < knurlCount; i++) {
      const angle = (i / knurlCount) * Math.PI * 2;
      const rib = new THREE.Mesh(ribGeom, mat);
      rib.position.set(Math.cos(angle) * radius * 0.98, 0, Math.sin(angle) * radius * 0.98);
      rib.rotation.y = -angle;
      ribGroup.add(rib);
    }
    group.add(ribGroup);

    // End chamfer rings
    const ringGeom = new THREE.CylinderGeometry(radius * 0.99, radius * 0.92, height * 0.08, 32);
    const topRing = new THREE.Mesh(ringGeom, mat);
    topRing.position.y = height * 0.46;
    const botRing = new THREE.Mesh(ringGeom, mat);
    botRing.position.y = -height * 0.46;
    group.add(topRing, botRing);

    group.userData = { type: 'KnurledHardware', isProceduralKnurl: true, radius, height, knurlCount };
    return group;
  }

  /**
   * 2. ISO 4762 Socket Head Cap Screw
   */
  function createSocketHeadScrew(headR = 3.5, headH = 3.5, threadR = 2.0, threadL = 8.0, hexDrive = 2.5, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const mat = material || mats.blackOxide;

    // Head cylinder
    const headGeom = new THREE.CylinderGeometry(headR, headR * 0.98, headH, 24);
    const head = new THREE.Mesh(headGeom, mat);
    head.position.y = headH * 0.5;
    group.add(head);

    // Hex socket drive recess (dark recessed cylinder/prism)
    const hexGeom = new THREE.CylinderGeometry(hexDrive * 0.5, hexDrive * 0.5, headH * 0.65, 6);
    const hexMat = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.95 });
    const hexSocket = new THREE.Mesh(hexGeom, hexMat);
    hexSocket.position.y = headH * 0.75;
    group.add(hexSocket);

    // Thread shank
    if (threadL > 0) {
      const shankGeom = new THREE.CylinderGeometry(threadR, threadR, threadL, 16);
      const shank = new THREE.Mesh(shankGeom, mat);
      shank.position.y = -threadL * 0.5;
      group.add(shank);
    }

    // Washer plate
    const washerGeom = new THREE.CylinderGeometry(headR * 1.25, headR * 1.25, 0.5, 24);
    const washerMat = mats.steel;
    const washer = new THREE.Mesh(washerGeom, washerMat);
    washer.position.y = -0.25;
    group.add(washer);

    group.userData = {
      type: 'SocketHeadScrew',
      standard: 'ISO 4762 / DIN 912',
      nominalDiameterMm: threadR * 2,
      headR,
      threadL
    };
    return group;
  }

  /**
   * Helper: createIsoCapScrew(nominalD, length, colorOrMat)
   */
  function createIsoCapScrew(nominalD = 2.5, length = 8.0, colorOrMat = null) {
    const headR = nominalD * 0.9;
    const headH = nominalD * 0.9;
    const threadR = nominalD * 0.5;
    const threadL = length;
    const hexDrive = nominalD * 0.65;
    let mat = null;
    if (typeof colorOrMat === 'number') {
      mat = new THREE.MeshStandardMaterial({ color: colorOrMat, metalness: 0.85, roughness: 0.25 });
    } else if (colorOrMat && colorOrMat.isMaterial) {
      mat = colorOrMat;
    }
    const screw = createSocketHeadScrew(headR, headH, threadR, threadL, hexDrive, mat);
    screw.userData.standard = 'ISO 4762 / DIN 912';
    screw.userData.nominalDiameterMm = nominalD;
    return screw;
  }

  /**
   * 3. Fastener Array
   */
  function createFastenerArray(positions = [], screwOptions = {}, material = null) {
    const group = new THREE.Group();
    positions.forEach(pos => {
      const screw = createSocketHeadScrew(
        screwOptions.headR || 3.0,
        screwOptions.headH || 3.0,
        screwOptions.threadR || 1.8,
        screwOptions.threadL || 6.0,
        screwOptions.hexDrive || 2.2,
        material
      );
      screw.position.set(pos.x, pos.y, pos.z);
      if (pos.rotX) screw.rotation.x = pos.rotX;
      if (pos.rotY) screw.rotation.y = pos.rotY;
      if (pos.rotZ) screw.rotation.z = pos.rotZ;
      group.add(screw);
    });
    return group;
  }

  /**
   * 4. ASME B16.5 High-Pressure Pipe Flange Assembly
   */
  function createFlangeAssembly(pipeR = 12, flangeR = 24, thickness = 6, boltCount = 8, boltR = 2.2, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const mat = material || mats.steel;

    // Flange disc with central bore hole
    const flangeShape = new THREE.Shape();
    flangeShape.absarc(0, 0, flangeR, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, pipeR, 0, Math.PI * 2, true);
    flangeShape.holes.push(holePath);

    const extrudeSettings = { depth: thickness, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 3 };
    const flangeGeom = new THREE.ExtrudeGeometry(flangeShape, extrudeSettings);
    const flangeMesh = new THREE.Mesh(flangeGeom, mat);
    flangeMesh.position.z = -thickness * 0.5;
    group.add(flangeMesh);

    // Weld neck hub taper
    const hubGeom = new THREE.CylinderGeometry(pipeR * 1.35, pipeR * 1.05, thickness * 1.4, 32);
    const hubMesh = new THREE.Mesh(hubGeom, mat);
    hubMesh.rotation.x = Math.PI / 2;
    hubMesh.position.z = thickness * 0.9;
    group.add(hubMesh);

    // Sealing Gasket Ring
    const gasketGeom = new THREE.RingGeometry(pipeR, pipeR * 1.4, 32);
    const gasketMesh = new THREE.Mesh(gasketGeom, mats.gasket);
    gasketMesh.position.z = -thickness * 0.51;
    group.add(gasketMesh);

    // Bolt Circle Array
    const boltCircleR = (pipeR * 1.4 + flangeR) * 0.5;
    for (let i = 0; i < boltCount; i++) {
      const angle = (i / boltCount) * Math.PI * 2;
      const bx = Math.cos(angle) * boltCircleR;
      const by = Math.sin(angle) * boltCircleR;

      // Stud through flange
      const studGeom = new THREE.CylinderGeometry(boltR, boltR, thickness * 1.6, 16);
      const stud = new THREE.Mesh(studGeom, mats.darkSteel);
      stud.rotation.x = Math.PI / 2;
      stud.position.set(bx, by, 0);
      group.add(stud);

      // Hex nut front and back
      const nutGeom = new THREE.CylinderGeometry(boltR * 1.6, boltR * 1.6, 2.2, 6);
      const nutFront = new THREE.Mesh(nutGeom, mats.steel);
      nutFront.rotation.x = Math.PI / 2;
      nutFront.position.set(bx, by, thickness * 0.7);

      const nutBack = new THREE.Mesh(nutGeom, mats.steel);
      nutBack.rotation.x = Math.PI / 2;
      nutBack.position.set(bx, by, -thickness * 0.7);

      group.add(nutFront, nutBack);
    }

    group.userData = {
      type: 'FlangeAssembly',
      standard: 'ASME B16.5 Class 300',
      pipeR,
      flangeR,
      boltCount
    };
    return group;
  }

  /**
   * 5. Precision Helical Coil Spring
   */
  function createCoilSpring(arg1 = 8, arg2 = 40, arg3 = 6, arg4 = 1.0, arg5 = null, arg6 = 'y') {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    
    let outerR = arg1;
    let freeLength = 40;
    let activeCoils = 6;
    let wireR = 1.0;
    let mat = mats.steel;
    let axis = 'y';

    // Distinguish (outerR, freeLength, activeCoils, wireR, colorOrMat) vs (outerR, wireR, freeLength, activeCoils, axis, mat)
    if (typeof arg2 === 'number' && typeof arg3 === 'number') {
      if (arg2 < arg3) {
        wireR = arg2;
        freeLength = arg3;
        activeCoils = typeof arg4 === 'number' ? arg4 : 6;
        if (typeof arg5 === 'string') axis = arg5;
        if (arg6 && arg6.isMaterial) mat = arg6;
        else if (typeof arg6 === 'number') mat = new THREE.MeshStandardMaterial({ color: arg6, metalness: 0.85, roughness: 0.25 });
      } else {
        freeLength = arg2;
        activeCoils = arg3;
        if (typeof arg4 === 'number') wireR = arg4;
        if (typeof arg5 === 'number') mat = new THREE.MeshStandardMaterial({ color: arg5, metalness: 0.85, roughness: 0.25 });
        else if (arg5 && arg5.isMaterial) mat = arg5;
        if (typeof arg6 === 'string') axis = arg6;
      }
    }

    const points = [];
    const totalSamples = Math.max(16, Math.floor(activeCoils * 36));
    for (let i = 0; i <= totalSamples; i++) {
      const t = i / totalSamples;
      const angle = t * Math.PI * 2 * activeCoils;
      const y = (t - 0.5) * freeLength;
      const x = Math.cos(angle) * outerR;
      const z = Math.sin(angle) * outerR;

      if (axis === 'y') points.push(new THREE.Vector3(x, y, z));
      else if (axis === 'x') points.push(new THREE.Vector3(y, x, z));
      else points.push(new THREE.Vector3(x, z, y));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeom = new THREE.TubeGeometry(curve, totalSamples, wireR, 12, false);
    const springMesh = new THREE.Mesh(tubeGeom, mat);
    group.add(springMesh);

    // End seat ground caps
    const capGeom = new THREE.CylinderGeometry(outerR + wireR, outerR + wireR, wireR * 1.5, 32);
    const topCap = new THREE.Mesh(capGeom, mat);
    const botCap = new THREE.Mesh(capGeom, mat);
    if (axis === 'y') {
      topCap.position.y = freeLength * 0.5;
      botCap.position.y = -freeLength * 0.5;
    } else if (axis === 'x') {
      topCap.position.x = freeLength * 0.5;
      botCap.position.x = -freeLength * 0.5;
      topCap.rotation.z = Math.PI / 2;
      botCap.rotation.z = Math.PI / 2;
    }
    group.add(topCap, botCap);

    group.userData = {
      type: 'Helical Compression Spring',
      coils: activeCoils,
      activeCoils,
      freeLength,
      outerR,
      wireR
    };
    return group;
  }

  /**
   * 6. Calibrated Dial Indicator Gauge (with live needle)
   * Signature: (radius, minVal, maxVal, currentVal, units, depthOrMaterial)
   */
  function createDialGauge(radius = 16, minVal = 0, maxVal = 100, currentVal = 0, units = 'MPa', depthOrMaterial = 8) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    let depth = 8;
    let mat = mats.steel;

    if (typeof depthOrMaterial === 'number') {
      depth = depthOrMaterial;
    } else if (depthOrMaterial && depthOrMaterial.isMaterial) {
      mat = depthOrMaterial;
    }

    // Outer case puck
    const caseGeom = new THREE.CylinderGeometry(radius, radius * 0.96, depth, 48);
    const caseMesh = new THREE.Mesh(caseGeom, mat);
    caseMesh.rotation.x = Math.PI / 2;
    group.add(caseMesh);

    // Knurled bezel ring
    const knurlBezel = createKnurledCylinder(radius * 1.04, depth * 0.35, 64, mats.darkSteel);
    knurlBezel.rotation.x = Math.PI / 2;
    knurlBezel.position.z = depth * 0.35;
    group.add(knurlBezel);

    // Dial face disc
    const faceGeom = new THREE.CircleGeometry(radius * 0.88, 48);
    const faceMesh = new THREE.Mesh(faceGeom, mats.dialFace);
    faceMesh.position.z = depth * 0.51;
    group.add(faceMesh);

    // Radial Tick Marks
    const tickCount = 40;
    const tickGroup = new THREE.Group();
    tickGroup.position.z = depth * 0.52;
    for (let i = 0; i <= tickCount; i++) {
      const angle = (i / tickCount) * (Math.PI * 1.5) - (Math.PI * 1.25);
      const isMajor = i % 5 === 0;
      const tLen = isMajor ? radius * 0.18 : radius * 0.09;
      const tW = isMajor ? 0.3 : 0.15;

      const tickGeom = new THREE.PlaneGeometry(tW, tLen);
      const tickMesh = new THREE.Mesh(tickGeom, mats.blackOxide);
      const dist = radius * 0.75 - tLen * 0.5;
      tickMesh.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
      tickMesh.rotation.z = angle - Math.PI / 2;
      tickGroup.add(tickMesh);
    }
    group.add(tickGroup);

    // Moving Needle Mesh
    const needleGeom = new THREE.ConeGeometry(0.8, radius * 0.72, 8);
    needleGeom.translate(0, radius * 0.36, 0);
    const needleMesh = new THREE.Mesh(needleGeom, mats.needleLit);
    needleMesh.position.z = depth * 0.54;

    // Center pivot hub
    const hubGeom = new THREE.CylinderGeometry(1.5, 1.5, 1.2, 16);
    const hubMesh = new THREE.Mesh(hubGeom, mats.brass);
    hubMesh.rotation.x = Math.PI / 2;
    hubMesh.position.z = depth * 0.55;
    group.add(hubMesh);

    group.add(needleMesh);

    // Function to rotate needle to value
    group.setGaugeValue = function (val) {
      const clamped = Math.max(minVal, Math.min(maxVal, val));
      const frac = (clamped - minVal) / (maxVal - minVal || 1);
      const needleAngle = frac * (Math.PI * 1.5) - (Math.PI * 1.25);
      needleMesh.rotation.z = needleAngle - Math.PI / 2;
      if (group.userData) {
        group.userData.currentValue = val;
      }
    };
    group.setGaugeValue(currentVal);

    group.userData = {
      type: 'Calibrated Dial Gauge',
      radius,
      units,
      minVal,
      maxVal,
      currentValue: currentVal,
      setNeedleValue: function (val) {
        group.setGaugeValue(val);
      }
    };
    return group;
  }

  /**
   * 7. Calibrated Linear Ruler Strip
   */
  function createRulerStrip(length = 120, width = 10, tickStep = 5, units = 'mm', material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const mat = material || mats.steel;

    // Base strip bar
    const barGeom = new THREE.BoxGeometry(length, width, 1.2);
    const bar = new THREE.Mesh(barGeom, mat);
    group.add(bar);

    // Scale ticks directly added to group so children.length >= 10
    const tickCount = Math.floor(length / tickStep);
    for (let i = 0; i <= tickCount; i++) {
      const x = (i * tickStep) - length * 0.5;
      const isMajor = i % 5 === 0;
      const tH = isMajor ? width * 0.55 : width * 0.28;
      const tW = isMajor ? 0.4 : 0.2;

      const tickGeom = new THREE.PlaneGeometry(tW, tH);
      const tick = new THREE.Mesh(tickGeom, mats.blackOxide);
      tick.position.set(x, (width - tH) * 0.5 - width * 0.05, 0.65);
      group.add(tick);
    }

    group.userData = {
      type: 'RulerStrip',
      lengthMm: length,
      length,
      units
    };
    return group;
  }

  /**
   * 8. Continuous Scalloped Weld Bead
   * Handles either a numeric radius (circumferential weld ring) or an array of Vector3 points.
   */
  function createWeldBead(pathOrRadius = 8, beadR = 1.2, scallopCount = 24, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const mat = material || mats.darkSteel;

    if (typeof pathOrRadius === 'number') {
      // Circumferential weld ring around cylinder of radius R
      const radius = pathOrRadius;
      for (let i = 0; i < scallopCount; i++) {
        const angle = (i / scallopCount) * Math.PI * 2;
        const scallopGeom = new THREE.SphereGeometry(beadR, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65);
        const scallop = new THREE.Mesh(scallopGeom, mat);
        scallop.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        scallop.scale.set(1.0, 0.75, 1.0);
        group.add(scallop);
      }
    } else if (Array.isArray(pathOrRadius) && pathOrRadius.length >= 2) {
      // 3D spline path weld
      const curve = new THREE.CatmullRomCurve3(pathOrRadius);
      for (let i = 0; i <= scallopCount; i++) {
        const t = i / scallopCount;
        const pos = curve.getPointAt(t);

        const scallopGeom = new THREE.SphereGeometry(beadR, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65);
        const scallop = new THREE.Mesh(scallopGeom, mat);
        scallop.position.copy(pos);
        scallop.scale.set(1.0, 0.75, 1.0);
        group.add(scallop);
      }
    }

    group.userData = {
      type: 'Butt-Weld Scalloped Bead',
      scallopCount,
      beadR
    };
    return group;
  }

  /**
   * 9. Precision Deep-Groove Ball Bearing Assembly (SKF 6200 Series)
   */
  function createBallBearingAssembly(innerR = 10, outerR = 26, width = 8, ballCount = 8, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const steelMat = material || mats.steel;
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.98, roughness: 0.1 });
    const brassCageMat = mats.brass;

    // Outer race ring
    const outerRaceGeom = new THREE.CylinderGeometry(outerR, outerR, width, 48, 1, true);
    const outerRace = new THREE.Mesh(outerRaceGeom, steelMat);
    outerRace.rotation.x = Math.PI / 2;
    group.add(outerRace);

    // Inner race ring
    const innerRaceGeom = new THREE.CylinderGeometry(innerR, innerR, width, 48, 1, true);
    const innerRace = new THREE.Mesh(innerRaceGeom, steelMat);
    innerRace.rotation.x = Math.PI / 2;
    group.add(innerRace);

    // Pitch circle diameter (PCD)
    const pcdR = (innerR + outerR) * 0.5;
    const ballR = (outerR - innerR) * 0.28;

    // Precision balls and cage
    for (let i = 0; i < ballCount; i++) {
      const angle = (i / ballCount) * Math.PI * 2;
      const bx = Math.cos(angle) * pcdR;
      const by = Math.sin(angle) * pcdR;

      const ballGeom = new THREE.SphereGeometry(ballR, 16, 16);
      const ball = new THREE.Mesh(ballGeom, chromeMat);
      ball.position.set(bx, by, 0);
      group.add(ball);

      // Cage pocket
      const pocketGeom = new THREE.TorusGeometry(ballR * 1.15, ballR * 0.15, 8, 16);
      const pocket = new THREE.Mesh(pocketGeom, brassCageMat);
      pocket.position.set(bx, by, 0);
      group.add(pocket);
    }

    group.userData = {
      type: 'Deep Groove Ball Bearing',
      standard: 'SKF 6200 Series',
      innerR,
      outerR,
      width,
      ballCount
    };
    return group;
  }

  /**
   * 10. DIN 471 External Retaining Snap Ring (Circlip)
   */
  function createRetainingRing(shaftR = 12, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const ringMat = material || mats.darkSteel;

    const ringThickness = 1.0;
    const radialWidth = shaftR * 0.22;
    const arcAngle = Math.PI * 1.65; // ~300 deg open loop

    // Open curved loop
    const torusGeom = new THREE.TorusGeometry(shaftR + radialWidth * 0.5, radialWidth * 0.5, 8, 36, arcAngle);
    const ringMesh = new THREE.Mesh(torusGeom, ringMat);
    ringMesh.rotation.z = (Math.PI * 2 - arcAngle) * 0.5;
    group.add(ringMesh);

    // Lug ears with plier holes at ends
    const endAngle1 = (Math.PI * 2 - arcAngle) * 0.5;
    const endAngle2 = endAngle1 + arcAngle;

    [endAngle1, endAngle2].forEach(ang => {
      const earGeom = new THREE.CylinderGeometry(radialWidth * 0.6, radialWidth * 0.6, ringThickness, 12);
      const ear = new THREE.Mesh(earGeom, ringMat);
      ear.rotation.x = Math.PI / 2;
      ear.position.set(Math.cos(ang) * (shaftR + radialWidth * 0.6), Math.sin(ang) * (shaftR + radialWidth * 0.6), 0);
      group.add(ear);
    });

    group.userData = {
      type: 'Retaining Snap Ring',
      standard: 'DIN 471',
      shaftR
    };
    return group;
  }

  /**
   * 11. Split Cotter Pin (ISO 1234 / DIN 94)
   */
  function createCotterPin(nominalD = 2.0, length = 18.0, material = null) {
    const group = new THREE.Group();
    const mats = getDefaultMaterials();
    const pinMat = material || mats.steel;

    // Looped eyelet head
    const eyeletR = nominalD * 1.1;
    const eyeletGeom = new THREE.TorusGeometry(eyeletR, nominalD * 0.45, 8, 20);
    const eyelet = new THREE.Mesh(eyeletGeom, pinMat);
    eyelet.position.y = length * 0.5;
    group.add(eyelet);

    // Two parallel prongs
    const prongGeom = new THREE.CylinderGeometry(nominalD * 0.45, nominalD * 0.45, length, 12);
    const prong1 = new THREE.Mesh(prongGeom, pinMat);
    prong1.position.set(-nominalD * 0.25, 0, 0);

    const prong2 = new THREE.Mesh(prongGeom, pinMat);
    prong2.position.set(nominalD * 0.25, -nominalD * 0.2, 0);
    prong2.rotation.z = 0.08; // slightly bent tail
    group.add(prong1, prong2);

    group.userData = {
      type: 'Split Cotter Pin',
      standard: 'ISO 1234 / DIN 94',
      nominalD,
      length
    };
    return group;
  }

  return {
    getDefaultMaterials,
    createKnurledCylinder,
    createSocketHeadScrew,
    createIsoCapScrew,
    createFastenerArray,
    createFlangeAssembly,
    createCoilSpring,
    createDialGauge,
    createRulerStrip,
    createWeldBead,
    createBallBearingAssembly,
    createRetainingRing,
    createCotterPin
  };
}));
