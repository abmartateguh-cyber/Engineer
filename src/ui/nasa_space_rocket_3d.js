/**
 * OmniEng 3D Aerospace Visualization
 * ============================================================================
 * Illustrative Launch Vehicle & Rocket Engine 3D Geometry
 * Synthetic interface demonstration only; no NASA hardware, standards
 * conformance, or approved aerospace design is represented.
 * ============================================================================
 */

'use strict';

class NasaSpaceRocket3D {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Builds a 3D visualization of an illustrative launch vehicle concept.
   * Supports 'full_stack' and 'engine_macro' modes.
   *
   * @param {string} mode - 'full_stack' | 'engine_macro'
   * @param {THREE.Group} targetGroup - Three.js group to populate
   * @param {Object} context - Optional references (ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders)
   * @returns {Object} Metadata containing entity counts, part list, and bounding stats
   */
  buildAssembly(mode = 'full_stack', targetGroup, context = {}) {
    const group = targetGroup || new THREE.Group();
    const partsList = [];

    // Keep selectable part metadata generic because the former callouts were unsourced.
    const addPart = (mesh) => {
      const componentNumber = partsList.length + 1;
      mesh.userData = {
        isSyntheticExample: true,
        isNasaEntity: false,
        componentId: `SYNTH-AERO-${componentNumber}`,
        entityName: 'Synthetic aerospace geometry',
        partName: `Illustrative component ${componentNumber}`,
        materialName: 'Illustrative material assignment',
        specStandard: 'No standards assessment'
      };
      group.add(mesh);
      partsList.push(mesh.userData);
      return mesh;
    };

    if (mode === 'engine_macro') {
      this.buildMacroRocketEngine(group, addPart, context);
    } else if (mode === 'spacecraft_interior' || mode === 'spaceship_interior') {
      this.buildSpacecraftInterior(group, addPart, context);
    } else {
      this.buildFullStackLaunchVehicle(group, addPart, context);
    }

    return {
      mode,
      totalPartsCount: partsList.length,
      partsList,
      group
    };
  }

  // =========================================================================
  // 1. Illustrative Launch Vehicle Geometry
  // =========================================================================

  buildFullStackLaunchVehicle(group, addPart, context) {
    const { ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders } = context;

    // Materials Palette
    const lightSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Illustrative exterior surface
      metalness: 0.25,
      roughness: 0.25
    });

    const cutawaySurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Illustrative cutaway surface
      metalness: 0.85,
      roughness: 0.35,
      wireframe: false
    });

    const darkInterstageSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Illustrative dark surface
      metalness: 0.6,
      roughness: 0.4
    });

    const mutedMetalSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Illustrative metallic surface
      metalness: 0.95,
      roughness: 0.2
    });

    const goldToneSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24, // Illustrative gold surface
      metalness: 0.98,
      roughness: 0.15
    });

    const copperToneSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Illustrative copper-colored surface
      metalness: 0.95,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    const deepBlueSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // Illustrative dark metallic surface
      metalness: 0.8,
      roughness: 0.4,
      side: THREE.DoubleSide
    });

    // -----------------------------------------------------------------------
    // A. Illustrative lower-stage body
    // -----------------------------------------------------------------------
    const boosterRadius = 14.0;
    const boosterHeight = 110.0;
    const boosterBaseY = -20.0;

    // Main Cylindrical Booster Body
    const boosterGeom = new THREE.CylinderGeometry(boosterRadius, boosterRadius, boosterHeight, 48, 8, true);
    const boosterMesh = new THREE.Mesh(boosterGeom, lightSurfaceMat);
    boosterMesh.position.set(0, boosterBaseY + boosterHeight / 2, 0);
    addPart(boosterMesh);

    // Illustrative internal lattice tank form (section cutaway)
    const tankGeom = new THREE.CylinderGeometry(
      boosterRadius - 0.6,
      boosterRadius - 0.6,
      boosterHeight * 0.75,
      36,
      12,
      true
    );
    const tankMesh = new THREE.Mesh(tankGeom, cutawaySurfaceMat);
    tankMesh.position.set(0, boosterBaseY + boosterHeight / 2 - 10, 0);
    addPart(tankMesh);

    // Longitudinal Systems Conduit Raceways (Left & Right)
    [-boosterRadius - 0.6, boosterRadius + 0.6].forEach((rx, idx) => {
      const racewayGeom = new THREE.BoxGeometry(1.6, boosterHeight, 1.2);
      const raceway = new THREE.Mesh(racewayGeom, new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5 }));
      raceway.position.set(rx, boosterBaseY + boosterHeight / 2, 0);
      addPart(raceway);
    });

    // Circumferential Stiffener Bands & Friction Stir Weld Seams
    for (let wy = boosterBaseY + 15; wy < boosterBaseY + boosterHeight; wy += 22) {
      const weldRing = new THREE.Mesh(
        new THREE.TorusGeometry(boosterRadius + 0.15, 0.25, 8, 48),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
      );
      weldRing.rotation.x = Math.PI / 2;
      weldRing.position.set(0, wy, 0);
      addPart(weldRing);
    }

    // -----------------------------------------------------------------------
    // B. Illustrative exterior lattice forms
    // -----------------------------------------------------------------------
    const gridAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    gridAngles.forEach((angle, idx) => {
      const finGroup = new THREE.Group();

      // Aerodynamic Planar Grid Lattice Frame
      const frameGeom = new THREE.BoxGeometry(7.0, 10.0, 1.2);
      const frameMesh = new THREE.Mesh(frameGeom, mutedMetalSurfaceMat);
      frameMesh.position.set(0, 5.0, 0);
      finGroup.add(frameMesh);

      // Internal Waffle Grids
      for (let gx = -2.5; gx <= 2.5; gx += 1.25) {
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 9.6, 1.0), mutedMetalSurfaceMat);
        vBar.position.set(gx, 5.0, 0);
        finGroup.add(vBar);
      }
      for (let gy = 1.5; gy <= 8.5; gy += 1.75) {
        const hBar = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 1.0), mutedMetalSurfaceMat);
        hBar.position.set(0, gy, 0);
        finGroup.add(hBar);
      }

      // Hydraulic Rotary Actuator Housing
      const actuatorGeom = new THREE.CylinderGeometry(1.6, 1.8, 4.0, 16);
      const actuator = new THREE.Mesh(
        actuatorGeom,
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 })
      );
      actuator.rotation.z = Math.PI / 2;
      actuator.position.set(0, 0, 0);
      finGroup.add(actuator);

      const finR = boosterRadius + 4.5;
      finGroup.position.set(Math.cos(angle) * finR, boosterBaseY + boosterHeight - 8.0, Math.sin(angle) * finR);
      finGroup.rotation.y = -angle + Math.PI / 2;

      addPart(finGroup);
    });

    // -----------------------------------------------------------------------
    // C. Illustrative lower-stage engine cluster geometry
    // -----------------------------------------------------------------------
    const lowerStageSupportPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(boosterRadius - 1.0, boosterRadius + 0.5, 8.0, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.92 })
    );
    lowerStageSupportPlate.position.set(0, boosterBaseY - 4.0, 0);
    addPart(lowerStageSupportPlate);

    // 9 Engines: 1 Center Engine + 8 Outer Engines
    const enginePositions = [{ x: 0, z: 0, isCenter: true }];
    const outerR = 8.5;
    for (let i = 0; i < 8; i++) {
      const theta = (i * Math.PI) / 4;
      enginePositions.push({
        x: Math.cos(theta) * outerR,
        z: Math.sin(theta) * outerR,
        isCenter: false
      });
    }

    enginePositions.forEach((pos, idx) => {
      const eGroup = new THREE.Group();

      // Powerhead Gimbal Joint
      const gimbal = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.95 })
      );
      gimbal.position.set(0, 0, 0);
      eGroup.add(gimbal);

      // Combustion Chamber
      const chamber = new THREE.Mesh(
        new THREE.CylinderGeometry(2.0, 1.6, 4.5, 24),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 })
      );
      chamber.position.set(0, -2.5, 0);
      eGroup.add(chamber);

      // Illustrative bell-shaped nozzle
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 4.2, 10.0, 32, 4, true), copperToneSurfaceMat);
      nozzle.position.set(0, -9.0, 0);
      eGroup.add(nozzle);

      // Stiffener Rings
      for (let s = -6.0; s >= -12.0; s -= 2.5) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.5 + (-s - 4.0) * 0.28, 0.15, 8, 24),
          new THREE.MeshStandardMaterial({ color: 0x78350f, metalness: 0.9 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, s, 0);
        eGroup.add(ring);
      }

      eGroup.position.set(pos.x, boosterBaseY - 8.0, pos.z);
      addPart(eGroup);
    });

    // Decorative plume-like shader effect; no flow calculation is performed.
    if (PhenomenaShaders && PhenomenaShaders.createIllustrativePlume) {
      const plume = PhenomenaShaders.createIllustrativePlume({
        visualFrequency: 5,
        plumeLength: 90,
        coreRadius: 18,
        accentColor: 0x38bdf8
      });
      plume.position.set(0, boosterBaseY - 60.0, 0);
      group.add(plume);
    }

    // -----------------------------------------------------------------------
    // D. Illustrative interstage and separation geometry
    // -----------------------------------------------------------------------
    const interstageY = boosterBaseY + boosterHeight;
    const interstageH = 22.0;

    const interstageGeom = new THREE.CylinderGeometry(boosterRadius, boosterRadius, interstageH, 36, 4, true);
    const interstage = new THREE.Mesh(interstageGeom, darkInterstageSurfaceMat);
    interstage.position.set(0, interstageY + interstageH / 2, 0);
    addPart(interstage);

    // Interstage Pyrotechnic Separation Ring & Retro-Rockets
    const pyroRing = new THREE.Mesh(
      new THREE.TorusGeometry(boosterRadius + 0.25, 0.4, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.8 })
    );
    pyroRing.rotation.x = Math.PI / 2;
    pyroRing.position.set(0, interstageY + interstageH, 0);
    addPart(pyroRing);

    // -----------------------------------------------------------------------
    // E. Illustrative upper-stage and engine geometry
    // -----------------------------------------------------------------------
    const stage2Y = interstageY + interstageH;
    const stage2H = 45.0;

    // Stage 2 Tank Body
    const stage2Body = new THREE.Mesh(
      new THREE.CylinderGeometry(boosterRadius, boosterRadius, stage2H, 48, 6, true),
      lightSurfaceMat
    );
    stage2Body.position.set(0, stage2Y + stage2H / 2, 0);
    addPart(stage2Body);

    // Illustrative upper-stage engine form inside the interstage
    const vacEngine = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 8.5, 18.0, 36, 6, true), deepBlueSurfaceMat);
    vacEngine.position.set(0, stage2Y - 9.0, 0);
    addPart(vacEngine);

    // Illustrative upper-stage exterior components
    gridAngles.forEach((ang, idx) => {
      const rcsGroup = new THREE.Group();
      for (let r = 0; r < 4; r++) {
        const noz = new THREE.Mesh(
          new THREE.ConeGeometry(0.4, 1.2, 12),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
        );
        noz.rotation.z = (r * Math.PI) / 2;
        noz.position.set(Math.cos((r * Math.PI) / 2) * 0.8, Math.sin((r * Math.PI) / 2) * 0.8, 0);
        rcsGroup.add(noz);
      }
      rcsGroup.position.set(
        Math.cos(ang) * (boosterRadius + 0.5),
        stage2Y + stage2H - 4.0,
        Math.sin(ang) * (boosterRadius + 0.5)
      );
      addPart(rcsGroup);
    });

    // -----------------------------------------------------------------------
    // F. Illustrative payload interface and bus geometry
    // -----------------------------------------------------------------------
    const payloadY = stage2Y + stage2H;

    // Payload Attach Fitting (Conical PAF)
    const paf = new THREE.Mesh(
      new THREE.CylinderGeometry(9.0, boosterRadius, 10.0, 36),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85 })
    );
    paf.position.set(0, payloadY + 5.0, 0);
    addPart(paf);

    // Satellite Bus with Deployed Solar Arrays
    const satBus = new THREE.Mesh(new THREE.BoxGeometry(7.0, 12.0, 7.0), goldToneSurfaceMat);
    satBus.position.set(0, payloadY + 16.0, 0);
    addPart(satBus);

    // Solar Panel Arrays (Wings Extended)
    [-12.0, 12.0].forEach((sx, sidx) => {
      const solarPanel = new THREE.Mesh(
        new THREE.BoxGeometry(14.0, 6.0, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.9, roughness: 0.1 })
      );
      solarPanel.position.set(sx + (sidx === 0 ? -2.0 : 2.0), payloadY + 16.0, 0);
      addPart(solarPanel);
    });

    // -----------------------------------------------------------------------
    // G. Illustrative fairing and nose geometry
    // -----------------------------------------------------------------------
    const fairingH = 38.0;
    const fairingGeom = new THREE.CylinderGeometry(0.5, boosterRadius, fairingH, 48, 12, true);
    const fairingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.2,
      transparent: true,
      opacity: 0.55 // Translucent so satellite and PAF are beautifully visible
    });
    const fairing = new THREE.Mesh(fairingGeom, fairingMat);
    fairing.position.set(0, payloadY + 5.0 + fairingH / 2, 0);
    addPart(fairing);

    // Aerodynamic Nose Cap & Pitot Static Mast
    const noseMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.4, 8.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95 })
    );
    noseMast.position.set(0, payloadY + 5.0 + fairingH + 4.0, 0);
    addPart(noseMast);
  }

  // =========================================================================
  // 2. MACRO ROCKET ENGINE DEEP-DIVE (TURBOPUMP, INJECTOR, NOZZLE CHANNELS)
  // =========================================================================

  buildMacroRocketEngine(group, addPart, context) {
    const { ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders } = context;

    // Materials Palette
    const copperToneLinerMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Illustrative copper-colored surface
      metalness: 0.95,
      roughness: 0.15,
      side: THREE.DoubleSide
    });

    const lightMetalJacketMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Illustrative light-metal appearance
      metalness: 0.9,
      roughness: 0.25
    });

    const darkMetalSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Illustrative dark metallic surface
      metalness: 0.92,
      roughness: 0.3
    });

    const mutedMetalSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Illustrative muted-metal appearance
      metalness: 0.95,
      roughness: 0.18
    });

    // -----------------------------------------------------------------------
    // A. Illustrative chamber and nozzle geometry
    // -----------------------------------------------------------------------
    const chamberH = 32.0;
    const throatY = 0.0;

    // Combustion Chamber Body
    const chamberBody = new THREE.Mesh(
      new THREE.CylinderGeometry(14.0, 9.2, chamberH, 48, 12, false),
      copperToneLinerMat
    );
    chamberBody.position.set(0, throatY + chamberH / 2, 0);
    addPart(chamberBody);

    // Illustrative nozzle-like surface geometry
    const nozzleH = 65.0;
    const nozzleGeom = new THREE.CylinderGeometry(9.2, 34.0, nozzleH, 48, 16, true);
    const nozzleMesh = new THREE.Mesh(nozzleGeom, copperToneLinerMat);
    nozzleMesh.position.set(0, throatY - nozzleH / 2, 0);
    addPart(nozzleMesh);

    // Circumferential Stiffener Rings (Hatbands)
    for (let ny = throatY - 8.0; ny >= throatY - nozzleH + 5.0; ny -= 10.0) {
      const radiusAtY = 9.2 + (34.0 - 9.2) * (-ny / nozzleH);
      const hatband = new THREE.Mesh(new THREE.TorusGeometry(radiusAtY + 0.6, 0.65, 8, 36), lightMetalJacketMat);
      hatband.rotation.x = Math.PI / 2;
      hatband.position.set(0, ny, 0);
      addPart(hatband);
    }

    // -----------------------------------------------------------------------
    // B. Illustrative injector and ignition-feature geometry
    // -----------------------------------------------------------------------
    const domeY = throatY + chamberH;
    const injectorDome = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 14.2, 8.0, 36), darkMetalSurfaceMat);
    injectorDome.position.set(0, domeY + 4.0, 0);
    addPart(injectorDome);

    // Array of Coaxial Swirl Injector Elements on Faceplate
    for (let ring = 1; ring <= 3; ring++) {
      const ringRadius = ring * 3.8;
      const count = ring * 8;
      for (let i = 0; i < count; i++) {
        const theta = (i * 2 * Math.PI) / count;
        const elem = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 12), mutedMetalSurfaceMat);
        elem.position.set(Math.cos(theta) * ringRadius, domeY, Math.sin(theta) * ringRadius);
        addPart(elem);
      }
    }

    // Central Augmented Spark Torch Igniter (ASI)
    const asi = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 6.0, 16),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.85 })
    );
    asi.position.set(0, domeY + 1.0, 0);
    addPart(asi);

    // -----------------------------------------------------------------------
    // C. Illustrative rotating-component housings
    // -----------------------------------------------------------------------

    // 1. Illustrative rotating assembly A
    const fuelPumpGroup = new THREE.Group();
    const fuelPumpCasing = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 12.0, 24), darkMetalSurfaceMat);
    fuelPumpCasing.rotation.z = Math.PI / 2;
    fuelPumpGroup.add(fuelPumpCasing);

    // Fuel Impeller (Inside / Visible Cutaway)
    const fuelImpeller = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 2.5, 24), mutedMetalSurfaceMat);
    fuelImpeller.rotation.z = Math.PI / 2;
    fuelPumpGroup.add(fuelImpeller);

    // Inducer Screw
    const fuelInducer = new THREE.Mesh(
      new THREE.CylinderGeometry(3.0, 4.0, 4.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95 })
    );
    fuelInducer.rotation.z = Math.PI / 2;
    fuelInducer.position.set(-6.5, 0, 0);
    fuelPumpGroup.add(fuelInducer);

    fuelPumpGroup.position.set(-22.0, domeY + 14.0, 4.0);
    addPart(fuelPumpGroup);

    // 2. Illustrative rotating assembly B
    const oxPumpGroup = new THREE.Group();
    const oxPumpCasing = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.5, 13.0, 24), darkMetalSurfaceMat);
    oxPumpCasing.rotation.z = Math.PI / 2;
    oxPumpGroup.add(oxPumpCasing);

    // Illustrative rotating component B
    const oxImpeller = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.8, 3.0, 24),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.92 }) // Illustrative blue surface
    );
    oxImpeller.rotation.z = Math.PI / 2;
    oxPumpGroup.add(oxImpeller);

    oxPumpGroup.position.set(22.0, domeY + 14.0, -4.0);
    addPart(oxPumpGroup);

    // -----------------------------------------------------------------------
    // D. Illustrative movable support geometry
    // -----------------------------------------------------------------------
    const gimbalRingY = domeY + 12.0;
    const gimbalRing = new THREE.Mesh(new THREE.TorusGeometry(18.0, 2.4, 16, 36), darkMetalSurfaceMat);
    gimbalRing.rotation.x = Math.PI / 2;
    gimbalRing.position.set(0, gimbalRingY, 0);
    addPart(gimbalRing);

    // Dual Electro-Hydraulic Linear Actuator Pistons (Pitch & Yaw)
    [
      [-14.0, 0],
      [0, 14.0]
    ].forEach(([ax, az], aidx) => {
      const actGroup = new THREE.Group();
      // Outer Cylinder
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 18.0, 16), mutedMetalSurfaceMat);
      cyl.position.set(0, 9.0, 0);
      actGroup.add(cyl);

      // Piston Rod
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 14.0, 16),
        new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.98, roughness: 0.05 })
      );
      rod.position.set(0, 20.0, 0);
      actGroup.add(rod);

      // Clevis Joint
      if (ProceduralHardware) {
        const pin = ProceduralHardware.createIsoCapScrew(0.8, 3.5, 0x64748b);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(0, 27.0, 0);
        actGroup.add(pin);
      }

      actGroup.position.set(ax, gimbalRingY - 8.0, az);
      addPart(actGroup);
    });

    // -----------------------------------------------------------------------
    // E. Illustrative spherical tanks and connecting geometry
    // -----------------------------------------------------------------------
    [-15.0, 15.0].forEach((hx, hidx) => {
      const copv = new THREE.Mesh(
        new THREE.SphereGeometry(4.5, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7, metalness: 0.3 }) // Illustrative dark appearance
      );
      copv.position.set(hx, domeY + 28.0, hidx === 0 ? -12.0 : 12.0);
      addPart(copv);
    });

    // Decorative connection and dial shapes with no scale or pressure reading.
    if (ProceduralHardware) {
      [-16.0, 16.0].forEach((x, index) => {
        const connection = ProceduralHardware.createFlangeAssembly(4.5, 9.0, 3.0, 8);
        connection.position.set(x, domeY + 8.0, 0);
        connection.rotation.z = x > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(connection);

        const indicator = ProceduralHardware.createDialGauge(5.0, null, null, null, 'Illustrative');
        indicator.position.set(x, domeY + 16.0, 0);
        indicator.userData = {
          ...indicator.userData,
          isSyntheticExample: true,
          partName: `Illustrative dial ${index + 1}`,
          materialName: 'Unspecified illustrative material',
          readingAvailable: false
        };
        group.add(indicator);
      });
    }

    // Decorative plume-like shader effect; no flow calculation is performed.
    if (PhenomenaShaders && PhenomenaShaders.createIllustrativePlume) {
      const plume = PhenomenaShaders.createIllustrativePlume({
        visualFrequency: 6,
        plumeLength: 140,
        coreRadius: 32,
        accentColor: 0x38bdf8
      });
      plume.position.set(0, throatY - nozzleH - 65.0, 0);
      group.add(plume);
    }
  }

  // =========================================================================
  // 3. Illustrative Spacecraft Interior Geometry
  // =========================================================================

  buildSpacecraftInterior(group, addPart, context) {
    const { ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders } = context;

    // Materials Palette
    const translucentHullMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.15,
      roughness: 0.15,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide
    });

    const isogridFrameMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Illustrative cutaway surface
      metalness: 0.85,
      roughness: 0.35,
      wireframe: false
    });

    const darkDeckSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Carbon-composite honeycomb deck
      metalness: 0.7,
      roughness: 0.4
    });

    const crewCouchMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // High-strength carbon-fiber seat shell
      metalness: 0.8,
      roughness: 0.25
    });

    const couchCushionMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // Ergonomic viscoelastic memory foam
      metalness: 0.2,
      roughness: 0.8
    });

    const displayConsoleMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Active AMLCD illuminated cyan display
      emissive: 0x0369a1,
      emissiveIntensity: 0.6,
      metalness: 0.9,
      roughness: 0.1
    });

    const avionicsGoldMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Illustrative warm metallic electronics appearance
      metalness: 0.95,
      roughness: 0.18
    });

    const waterBladderMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // Illustrative blue surface
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.65
    });

    const eclssModuleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Illustrative muted-metal appearance
      metalness: 0.88,
      roughness: 0.22
    });

    const containerSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Illustrative container appearance
      metalness: 0.92,
      roughness: 0.25
    });

    const darkCompositeAppearanceMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Illustrative dark surface
      metalness: 0.4,
      roughness: 0.65
    });

    const copperToneSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Illustrative copper-colored surface
      metalness: 0.95,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    // -----------------------------------------------------------------------
    // A. Illustrative outer shell geometry
    // -----------------------------------------------------------------------
    const capsuleBaseR = 21.0;
    const capsuleTopR = 10.0;
    const capsuleH = 34.0;
    const capsuleCenterY = 2.0;

    // Translucent illustrative outer shell
    const hullGeom = new THREE.CylinderGeometry(capsuleTopR, capsuleBaseR, capsuleH, 48, 12, true);
    const hullMesh = new THREE.Mesh(hullGeom, translucentHullMat);
    hullMesh.position.set(0, capsuleCenterY, 0);
    addPart(hullMesh);

    // Avcoat Base Heat Shield & Carrier Structure
    const heatShieldGeom = new THREE.CylinderGeometry(capsuleBaseR, capsuleBaseR + 1.2, 3.5, 48);
    const heatShield = new THREE.Mesh(
      heatShieldGeom,
      new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85, metalness: 0.1 })
    );
    heatShield.position.set(0, capsuleCenterY - capsuleH / 2 - 1.75, 0);
    addPart(heatShield);

    // Internal Triangular Isogrid Stiffener Rings
    [-10.0, 0.0, 10.0].forEach((ry, idx) => {
      const ringR = capsuleBaseR - (idx + 1) * 3.2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.45, 8, 48), isogridFrameMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, capsuleCenterY + ry, 0);
      addPart(ring);
    });

    // -----------------------------------------------------------------------
    // B. Illustrative deck and hatch geometry
    // -----------------------------------------------------------------------
    const flightDeckY = capsuleCenterY + 4.0;
    const habitatDeckY = capsuleCenterY - 10.0;

    // Upper Flight Deck Floor
    const flightFloor = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 1.2, 36), darkDeckSurfaceMat);
    flightFloor.position.set(0, flightDeckY, 0);
    addPart(flightFloor);

    // Lower Habitation Deck Floor
    const habFloor = new THREE.Mesh(new THREE.CylinderGeometry(19.2, 19.2, 1.2, 36), darkDeckSurfaceMat);
    habFloor.position.set(0, habitatDeckY, 0);
    addPart(habFloor);

    // Illustrative central support and inter-deck opening
    const centralCol = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, capsuleH - 8.0, 24, 4, true),
      isogridFrameMat
    );
    centralCol.position.set(0, capsuleCenterY - 1.0, 0);
    addPart(centralCol);

    // Inter-Deck Ladder Rungs
    for (let lz = habitatDeckY + 2.0; lz < flightDeckY + 8.0; lz += 2.2) {
      const rung = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 2.2, 12),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
      );
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, lz, 2.5);
      group.add(rung);
    }

    // -----------------------------------------------------------------------
    // C. Illustrative upper-deck furniture and console geometry
    // -----------------------------------------------------------------------
    const couchLocations = [
      { name: 'Commander Couch (CDR)', x: -5.8, z: 5.5, angle: 0 },
      { name: 'Pilot Couch (PLT)', x: 5.8, z: 5.5, angle: 0 },
      { name: 'Mission Specialist 1 (MS-1)', x: -5.8, z: -5.5, angle: Math.PI },
      { name: 'Mission Specialist 2 (MS-2)', x: 5.8, z: -5.5, angle: Math.PI }
    ];

    couchLocations.forEach((cLoc, cIdx) => {
      const cGroup = new THREE.Group();

      // Recumbent Seat Pan & Backrest
      const seatPan = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.6, 3.8), crewCouchMat);
      seatPan.position.set(0, 0.3, 0);
      cGroup.add(seatPan);

      const cushion = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 3.4), couchCushionMat);
      cushion.position.set(0, 0.6, 0);
      cGroup.add(cushion);

      // Angled Backrest (30 deg launch/entry recline)
      const backrest = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.8, 0.5), crewCouchMat);
      backrest.rotation.x = -Math.PI / 6;
      backrest.position.set(0, 2.4, -1.8);
      cGroup.add(backrest);

      // Headrest with Dynamic Impact Attenuator
      const headrest = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 0.6), couchCushionMat);
      headrest.rotation.x = -Math.PI / 6;
      headrest.position.set(0, 4.8, -2.8);
      cGroup.add(headrest);

      // 3-Axis Progressive Stroke Dynamic Crash Attenuator Cylinder (15g rated)
      const shockPiston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 2.4, 16),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.95 })
      );
      shockPiston.position.set(0, -1.2, 0);
      cGroup.add(shockPiston);

      cGroup.position.set(cLoc.x, flightDeckY + 1.2, cLoc.z);
      cGroup.rotation.y = cLoc.angle;

      addPart(cGroup);
    });

    // Glass Cockpit Main Console with 3x Ruggedized AMLCD Displays
    const consoleGroup = new THREE.Group();
    const dashBase = new THREE.Mesh(
      new THREE.BoxGeometry(16.0, 4.5, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8 })
    );
    dashBase.rotation.x = Math.PI / 8;
    consoleGroup.add(dashBase);

    // Illustrative display panels
    [-5.0, 0, 5.0].forEach((sx, sidx) => {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), displayConsoleMat);
      screen.rotation.x = Math.PI / 8;
      screen.position.set(sx, 0.2, 1.05);
      consoleGroup.add(screen);
    });

    // Flight Controllers: Dual Rotational & Translational Hand Controllers (RHC/THC)
    [-3.5, 3.5].forEach((hx) => {
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 1.2, 12),
        new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.5 })
      );
      stick.position.set(hx, 1.8, 0.8);
      consoleGroup.add(stick);
    });

    consoleGroup.position.set(0, flightDeckY + 6.0, 8.5);
    addPart(consoleGroup);

    // Direct-View Forward Docking Windows & Lateral Ports
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.9,
      roughness: 0.05,
      transparent: true,
      opacity: 0.65
    });
    [-4.5, 4.5].forEach((wx, widx) => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.5, 0.4), windowMat);
      win.rotation.x = -Math.PI / 5;
      win.position.set(wx, flightDeckY + 9.5, 8.8);
      addPart(win);
    });

    // -----------------------------------------------------------------------
    // D. Illustrative lower-deck interior geometry
    // -----------------------------------------------------------------------

    // Illustrative cabin furniture
    const berthAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    berthAngles.forEach((bAng, bIdx) => {
      const bGroup = new THREE.Group();
      // Sleep Cabin Box
      const bBox = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 8.5, 3.2),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7 })
      );
      bGroup.add(bBox);

      // Nomex Sleep Restraint Bag
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 7.0, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 })
      );
      bag.position.set(0, 0, 0.4);
      bGroup.add(bag);

      const bRadius = 14.2;
      bGroup.position.set(Math.cos(bAng) * bRadius, habitatDeckY + 4.8, Math.sin(bAng) * bRadius);
      bGroup.rotation.y = -bAng + Math.PI / 2;

      addPart(bGroup);
    });

    // Galley Station: Food Rehydration Oven & Dual Hot/Chilled Water Dispensers
    const galleyGroup = new THREE.Group();
    const galleyCabinet = new THREE.Mesh(new THREE.BoxGeometry(5.5, 7.5, 3.0), eclssModuleMat);
    galleyGroup.add(galleyCabinet);

    const ovenDoor = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 })
    );
    ovenDoor.position.set(-1.2, 1.2, 1.55);
    galleyGroup.add(ovenDoor);

    const waterSpigot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.95 })
    );
    waterSpigot.position.set(1.4, 1.2, 1.6);
    galleyGroup.add(waterSpigot);

    galleyGroup.position.set(-12.5, habitatDeckY + 4.5, 0);
    galleyGroup.rotation.y = Math.PI / 2;
    addPart(galleyGroup);

    // Illustrative restroom fixture forms
    const uwmsGroup = new THREE.Group();
    const commodeCabinet = new THREE.Mesh(new THREE.BoxGeometry(4.5, 7.5, 3.5), eclssModuleMat);
    uwmsGroup.add(commodeCabinet);

    const commodeSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 1.4, 24),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 })
    );
    commodeSeat.position.set(0, 0.7, 0.9);
    uwmsGroup.add(commodeSeat);

    const urineFunnel = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.8, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8 })
    );
    urineFunnel.position.set(1.3, 1.8, 0.9);
    uwmsGroup.add(urineFunnel);

    uwmsGroup.position.set(12.5, habitatDeckY + 4.5, 0);
    uwmsGroup.rotation.y = -Math.PI / 2;
    addPart(uwmsGroup);

    // Exercise & Physical Countermeasures Station (ARED-mini & Cycle Ergometer)
    const exerciseGroup = new THREE.Group();
    const exFrame = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 6.5, 3.5),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 })
    );
    exerciseGroup.add(exFrame);

    const ergometerFlywheel = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 0.6, 24),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 })
    );
    ergometerFlywheel.rotation.z = Math.PI / 2;
    ergometerFlywheel.position.set(0, 1.2, 0);
    exerciseGroup.add(ergometerFlywheel);

    // Vibration Isolation Springs
    if (ProceduralHardware) {
      const spring1 = ProceduralHardware.createCoilSpring(0.5, 1.4, 6, 0.08);
      spring1.position.set(-1.2, -3.0, 0);
      exerciseGroup.add(spring1);
      const spring2 = ProceduralHardware.createCoilSpring(0.5, 1.4, 6, 0.08);
      spring2.position.set(1.2, -3.0, 0);
      exerciseGroup.add(spring2);
    }

    exerciseGroup.position.set(0, habitatDeckY + 4.5, -12.5);
    addPart(exerciseGroup);

    // Central Radiation Storm Shelter (Solar Particle Event Safe Haven)
    [-4.5, 4.5].forEach((wx, widx) => {
      const waterBladder = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 7.2, 24), waterBladderMat);
      waterBladder.position.set(wx, habitatDeckY + 4.2, 0);
      addPart(waterBladder);
    });

    // Illustrative storage and equipment forms
    const medicalLocker = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 3.8, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.6 })
    );
    medicalLocker.position.set(4.5, habitatDeckY + 2.5, -7.5);
    addPart(medicalLocker);

    // -----------------------------------------------------------------------
    // E. Illustrative equipment-rack geometry
    // -----------------------------------------------------------------------

    // Illustrative cabin equipment-rack geometry
    const eclssRack = new THREE.Group();
    const rackCabinet = new THREE.Mesh(new THREE.BoxGeometry(7.0, 7.5, 3.0), eclssModuleMat);
    eclssRack.add(rackCabinet);

    // Illustrative cylindrical equipment forms
    [-1.6, 1.6].forEach((cx, cidx) => {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 5.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.9 })
      );
      col.position.set(cx, 0.4, 1.2);
      eclssRack.add(col);
    });

    // Illustrative equipment-container forms
    const sabatier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 4.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.85 })
    );
    sabatier.position.set(0, 0.4, 1.2);
    eclssRack.add(sabatier);

    eclssRack.position.set(0, habitatDeckY + 4.5, 12.5);
    eclssRack.rotation.y = Math.PI;
    addPart(eclssRack);

    // Illustrative equipment-bay geometry
    const avionicsBay = new THREE.Group();
    const avionicsRack = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 4.5, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 })
    );
    avionicsBay.add(avionicsRack);

    // Three illustrative avionics enclosure shapes
    [-1.6, 0, 1.6].forEach((ax, aidx) => {
      const comp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 2.0), avionicsGoldMat);
      comp.position.set(ax, 0.2, 0.4);
      avionicsBay.add(comp);
    });

    avionicsBay.position.set(-6.5, habitatDeckY + 2.8, -7.5);
    addPart(avionicsBay);

    // Illustrative equipment-locker geometry
    const lockerGroup = new THREE.Group();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const locker = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 1.1, 1.8),
          new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.75 })
        );
        locker.position.set((c - 1.5) * 1.8, (r - 1.0) * 1.3, 0);
        lockerGroup.add(locker);
      }
    }
    lockerGroup.position.set(0, habitatDeckY - 2.5, 7.5);
    addPart(lockerGroup);

    // -----------------------------------------------------------------------
    // F. Illustrative forward tunnel and suit-form geometry
    // -----------------------------------------------------------------------
    const dockingY = capsuleCenterY + capsuleH / 2;

    // Illustrative docking-interface geometry
    const ndsRing = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 3.0, 36, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.2 })
    );
    ndsRing.position.set(0, dockingY + 1.5, 0);
    addPart(ndsRing);

    const hatchDoor = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 0.6, 32),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85 })
    );
    hatchDoor.position.set(0, dockingY + 0.3, 0);
    addPart(hatchDoor);

    // Illustrative equipment forms
    [-4.5, 4.5].forEach((sx, sidx) => {
      const suit = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.4, 5.5, 16),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }) // Illustrative light surface
      );
      suit.position.set(sx, flightDeckY + 4.5, -6.5);
      addPart(suit);
    });

    // -----------------------------------------------------------------------
    // G. Illustrative rear-module geometry
    // -----------------------------------------------------------------------
    const smY = capsuleCenterY - capsuleH / 2 - 18.0;
    const smRadius = capsuleBaseR;
    const smHeight = 24.0;

    // Service Module Outer Cylindrical Structure
    const smHull = new THREE.Mesh(
      new THREE.CylinderGeometry(smRadius, smRadius, smHeight, 48, 8, true),
      translucentHullMat
    );
    smHull.position.set(0, smY, 0);
    addPart(smHull);

    // Illustrative rear engine geometry
    const smEngineGroup = new THREE.Group();
    const smGimbal = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.95 })
    );
    smEngineGroup.add(smGimbal);

    const smChamber = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 1.8, 4.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 })
    );
    smChamber.position.set(0, -2.5, 0);
    smEngineGroup.add(smChamber);

    const smNozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 6.2, 12.0, 32, 4, true), copperToneSurfaceMat);
    smNozzle.position.set(0, -9.5, 0);
    smEngineGroup.add(smNozzle);

    // Illustrative movable support geometry
    [
      [-2.2, 0],
      [0, 2.2]
    ].forEach(([ax, az]) => {
      const act = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 4.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95 })
      );
      act.position.set(ax, -1.5, az);
      smEngineGroup.add(act);
    });

    smEngineGroup.position.set(0, smY - smHeight / 2, 0);
    addPart(smEngineGroup);

    // Illustrative container geometry
    const tankOffsets = [
      { x: -7.5, z: 0, color: 0x38bdf8 },
      { x: 7.5, z: 0, color: 0x38bdf8 },
      { x: 0, z: -7.5, color: 0xf59e0b },
      { x: 0, z: 7.5, color: 0xf59e0b }
    ];
    tankOffsets.forEach((tData) => {
      const pTank = new THREE.Mesh(new THREE.SphereGeometry(5.2, 24, 24), containerSurfaceMat);
      pTank.position.set(tData.x, smY + 1.5, tData.z);
      addPart(pTank);
    });

    // Illustrative spherical containers
    [-11.5, 11.5].forEach((hx, hidx) => {
      const copv = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 20), darkCompositeAppearanceMat);
      copv.position.set(hx, smY + 5.0, 0);
      addPart(copv);
    });

    // Illustrative small external shapes
    const rcsAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    rcsAngles.forEach((rAng, rIdx) => {
      const rcsGroup = new THREE.Group();
      for (let n = 0; n < 4; n++) {
        const noz = new THREE.Mesh(
          new THREE.ConeGeometry(0.35, 1.0, 12),
          new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 })
        );
        noz.rotation.z = (n * Math.PI) / 2;
        noz.position.set(Math.cos((n * Math.PI) / 2) * 0.7, Math.sin((n * Math.PI) / 2) * 0.7, 0);
        rcsGroup.add(noz);
      }
      rcsGroup.position.set(Math.cos(rAng) * (smRadius + 0.5), smY + 6.0, Math.sin(rAng) * (smRadius + 0.5));
      rcsGroup.rotation.y = -rAng;
      addPart(rcsGroup);
    });

    // 4x Deployable UltraFlex Solar Array Wings (11.2 kW Generation)
    rcsAngles.forEach((sAng, sIdx) => {
      const solarGroup = new THREE.Group();
      // Solar Wing Disk
      const solarDisk = new THREE.Mesh(
        new THREE.CylinderGeometry(7.0, 7.0, 0.35, 24),
        new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.95, roughness: 0.15 })
      );
      solarDisk.rotation.x = Math.PI / 2;
      solarGroup.add(solarDisk);

      // Articulating SADM Boom Arm
      const boom = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 6.0, 12),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
      );
      boom.position.set(0, -6.0, 0);
      solarGroup.add(boom);

      const solarDist = smRadius + 11.0;
      solarGroup.position.set(Math.cos(sAng) * solarDist, smY, Math.sin(sAng) * solarDist);
      solarGroup.rotation.y = -sAng + Math.PI / 2;
      addPart(solarGroup);
    });

    // Gimballed 1.2m Deep Space High-Gain Antenna (Ka/X-band DSN Link)
    const hgaGroup = new THREE.Group();
    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 0.4, 1.2, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.85, roughness: 0.2, side: THREE.DoubleSide })
    );
    dish.rotation.x = Math.PI / 3;
    hgaGroup.add(dish);

    const feed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1.8, 12),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.95 })
    );
    feed.rotation.x = Math.PI / 3;
    feed.position.set(0, 0.6, 0.8);
    hgaGroup.add(feed);

    hgaGroup.position.set(0, smY + 8.5, smRadius + 4.5);
    addPart(hgaGroup);
  }
}

// Module export for Node.js test environment and browser window globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NasaSpaceRocket3D };
}
if (typeof window !== 'undefined') {
  window.NasaSpaceRocket3D = NasaSpaceRocket3D;
}
