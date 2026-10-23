/**
 * OmniEng 3D Aerospace Visualization
 * ============================================================================
 * NASA Space Launch Vehicle & Rocket Engine 3D Hierarchical Assembly
 * Conforming to:
 *  - NASA Systems Engineering Handbook NASA/SP-2016-6105 Rev 2 (WBS 06.01 - 06.08)
 *  - High-Fidelity B-Rep Geometry & Procedural PBR Anisotropic Shaders
 *  - Full Launch Vehicle Stack & Macro Rocket Engine Deep-Dive Anatomy
 * ============================================================================
 */

'use strict';

class NasaSpaceRocket3D {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Builds the complete 3D scene graph for the NASA Space Launch Vehicle.
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

    // Helper to register parts with NASA WBS metadata
    const addPart = (mesh, meta = {}) => {
      mesh.userData = Object.assign({
        isNasaEntity: true,
        wbsId: meta.wbsId || '06.01',
        entityName: meta.entityName || 'Propulsion Systems',
        partName: meta.partName || 'Aerospace Component',
        materialName: meta.materialName || 'Aerospace Alloy',
        specStandard: meta.specStandard || 'NASA-STD-5001'
      }, meta);
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
  // 1. FULL ORBITAL LAUNCH VEHICLE STACK (WBS 06.01 - 06.08)
  // =========================================================================

  buildFullStackLaunchVehicle(group, addPart, context) {
    const { ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders } = context;

    // Materials Palette
    const boosterSkinMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // High-gloss aerospace white
      metalness: 0.25,
      roughness: 0.25
    });

    const isogridCutawayMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Al-Li cryogenic blue tint
      metalness: 0.85,
      roughness: 0.35,
      wireframe: false
    });

    const carbonInterstageMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Carbon-fiber dark weave
      metalness: 0.6,
      roughness: 0.4
    });

    const titaniumGridFinMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Forged titanium
      metalness: 0.95,
      roughness: 0.2
    });

    const goldMliMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24, // Thermal MLI gold foil
      metalness: 0.98,
      roughness: 0.15
    });

    const copperNozzleMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Narloy-Z copper alloy
      metalness: 0.95,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    const niobiumVacMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // Coated niobium C-103
      metalness: 0.8,
      roughness: 0.4,
      side: THREE.DoubleSide
    });

    // -----------------------------------------------------------------------
    // A. STAGE 1 BOOSTER CORE (WBS 06.02: Structures)
    // -----------------------------------------------------------------------
    const boosterRadius = 14.0;
    const boosterHeight = 110.0;
    const boosterBaseY = -20.0;

    // Main Cylindrical Booster Body
    const boosterGeom = new THREE.CylinderGeometry(boosterRadius, boosterRadius, boosterHeight, 48, 8, true);
    const boosterMesh = new THREE.Mesh(boosterGeom, boosterSkinMat);
    boosterMesh.position.set(0, boosterBaseY + boosterHeight / 2, 0);
    addPart(boosterMesh, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Stage 1 Booster Al-Li 2195 Cryogenic Barrel',
      materialName: 'Al-Li 2195-T8 Friction-Stir Welded',
      specStandard: 'NASA SP-8007'
    });

    // Internal Isogrid Cryogenic Tank Section (Exposed Section Cutaway Effect)
    const tankGeom = new THREE.CylinderGeometry(boosterRadius - 0.6, boosterRadius - 0.6, boosterHeight * 0.75, 36, 12, true);
    const tankMesh = new THREE.Mesh(tankGeom, isogridCutawayMat);
    tankMesh.position.set(0, boosterBaseY + boosterHeight / 2 - 10, 0);
    addPart(tankMesh, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'CNC Milled Triangular Isogrid Liquid Oxygen Tank',
      materialName: 'Al-Li 2195 Cryogenic Pressure Hull',
      specStandard: 'NASA SP-8007 / SP-8032'
    });

    // Longitudinal Systems Conduit Raceways (Left & Right)
    [-boosterRadius - 0.6, boosterRadius + 0.6].forEach((rx, idx) => {
      const racewayGeom = new THREE.BoxGeometry(1.6, boosterHeight, 1.2);
      const raceway = new THREE.Mesh(racewayGeom, new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5 }));
      raceway.position.set(rx, boosterBaseY + boosterHeight / 2, 0);
      addPart(raceway, {
        wbsId: '06.07',
        entityName: 'Electrical Power & Data Distribution',
        partName: `Avionics & Cryo Pressurization Raceway #${idx + 1}`,
        materialName: 'Extruded Al 6061-T6 Conduit Cover',
        specStandard: 'MIL-STD-1553B'
      });
    });

    // Circumferential Stiffener Bands & Friction Stir Weld Seams
    for (let wy = boosterBaseY + 15; wy < boosterBaseY + boosterHeight; wy += 22) {
      const weldRing = new THREE.Mesh(
        new THREE.TorusGeometry(boosterRadius + 0.15, 0.25, 8, 48),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
      );
      weldRing.rotation.x = Math.PI / 2;
      weldRing.position.set(0, wy, 0);
      addPart(weldRing, {
        wbsId: '06.02',
        entityName: 'Structures & Mechanisms',
        partName: 'Friction Stir Circumferential Girth Weld Bead',
        materialName: 'Al-Li 2195 Weld Joint',
        specStandard: 'AWS D17.1'
      });
    }

    // -----------------------------------------------------------------------
    // B. FOUR TITANIUM GRID FINS (WBS 06.03: GNC)
    // -----------------------------------------------------------------------
    const gridAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    gridAngles.forEach((angle, idx) => {
      const finGroup = new THREE.Group();
      
      // Aerodynamic Planar Grid Lattice Frame
      const frameGeom = new THREE.BoxGeometry(7.0, 10.0, 1.2);
      const frameMesh = new THREE.Mesh(frameGeom, titaniumGridFinMat);
      frameMesh.position.set(0, 5.0, 0);
      finGroup.add(frameMesh);

      // Internal Waffle Grids
      for (let gx = -2.5; gx <= 2.5; gx += 1.25) {
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 9.6, 1.0), titaniumGridFinMat);
        vBar.position.set(gx, 5.0, 0);
        finGroup.add(vBar);
      }
      for (let gy = 1.5; gy <= 8.5; gy += 1.75) {
        const hBar = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 1.0), titaniumGridFinMat);
        hBar.position.set(0, gy, 0);
        finGroup.add(hBar);
      }

      // Hydraulic Rotary Actuator Housing
      const actuatorGeom = new THREE.CylinderGeometry(1.6, 1.8, 4.0, 16);
      const actuator = new THREE.Mesh(actuatorGeom, new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 }));
      actuator.rotation.z = Math.PI / 2;
      actuator.position.set(0, 0, 0);
      finGroup.add(actuator);

      const finR = boosterRadius + 4.5;
      finGroup.position.set(Math.cos(angle) * finR, boosterBaseY + boosterHeight - 8.0, Math.sin(angle) * finR);
      finGroup.rotation.y = -angle + Math.PI / 2;
      
      addPart(finGroup, {
        wbsId: '06.03',
        entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
        partName: `Hypersonic Titanium Waffle Grid Fin #${idx + 1}`,
        materialName: 'Ti-6Al-4V Cast & CNC Milled',
        specStandard: 'NASA-STD-5001'
      });
    });

    // -----------------------------------------------------------------------
    // C. STAGE 1 BOOSTER 9-ENGINE CLUSTER & THRUST PUCK (WBS 06.01)
    // -----------------------------------------------------------------------
    const thrustPuck = new THREE.Mesh(
      new THREE.CylinderGeometry(boosterRadius - 1.0, boosterRadius + 0.5, 8.0, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.92 })
    );
    thrustPuck.position.set(0, boosterBaseY - 4.0, 0);
    addPart(thrustPuck, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Octaweb Thrust Structure & Hold-Down Ring',
      materialName: 'Inconel 718 Forged Truss',
      specStandard: 'NASA SP-125'
    });

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

      // Regeneratively Cooled Bell Nozzle
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 4.2, 10.0, 32, 4, true),
        copperNozzleMat
      );
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
      addPart(eGroup, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: pos.isCenter
          ? 'Center Gimballed Staged Combustion Engine (Primary TVC)'
          : `Outer Fixed Staged Combustion Booster Engine #${idx}`,
        materialName: 'Narloy-Z Milled Copper Liner / Inconel 718 Jacket',
        specStandard: 'NASA SP-125'
      });
    });

    // Active Supersonic Exhaust Plume on Center Engine
    if (PhenomenaShaders && PhenomenaShaders.createSupersonicPlume) {
      const plume = PhenomenaShaders.createSupersonicPlume({
        machNumber: 3.5,
        shockCount: 5,
        plumeLength: 90,
        coreRadius: 18,
        accentColor: 0x38bdf8
      });
      plume.position.set(0, boosterBaseY - 60.0, 0);
      group.add(plume);
    }

    // -----------------------------------------------------------------------
    // D. VENTED INTERSTAGE & STAGING PYROTECHNICS (WBS 06.02)
    // -----------------------------------------------------------------------
    const interstageY = boosterBaseY + boosterHeight;
    const interstageH = 22.0;

    const interstageGeom = new THREE.CylinderGeometry(boosterRadius, boosterRadius, interstageH, 36, 4, true);
    const interstage = new THREE.Mesh(interstageGeom, carbonInterstageMat);
    interstage.position.set(0, interstageY + interstageH / 2, 0);
    addPart(interstage, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Carbon-Composite Vented Interstage Frustum',
      materialName: 'High-Modulus Carbon Fiber / Bismaleimide (BMI)',
      specStandard: 'NASA-STD-5020'
    });

    // Interstage Pyrotechnic Separation Ring & Retro-Rockets
    const pyroRing = new THREE.Mesh(
      new THREE.TorusGeometry(boosterRadius + 0.25, 0.4, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.8 })
    );
    pyroRing.rotation.x = Math.PI / 2;
    pyroRing.position.set(0, interstageY + interstageH, 0);
    addPart(pyroRing, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Linear Shaped Pyrotechnic Staging Frangible Joint',
      materialName: 'Mild Detonating Fuse (MDF) / RDX Pyrotechnic Core',
      specStandard: 'NASA-STD-5009'
    });

    // -----------------------------------------------------------------------
    // E. STAGE 2 VACUUM VEHICLE & VACUUM ENGINE (WBS 06.01 & 06.03)
    // -----------------------------------------------------------------------
    const stage2Y = interstageY + interstageH;
    const stage2H = 45.0;

    // Stage 2 Tank Body
    const stage2Body = new THREE.Mesh(
      new THREE.CylinderGeometry(boosterRadius, boosterRadius, stage2H, 48, 6, true),
      boosterSkinMat
    );
    stage2Body.position.set(0, stage2Y + stage2H / 2, 0);
    addPart(stage2Body, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Stage 2 Vacuum Cryogenic Tank (LOX & LCH4 Tandem)',
      materialName: 'Al-Li 2195 Common Bulkhead Tank',
      specStandard: 'NASA SP-8007'
    });

    // Stage 2 Vacuum Engine inside Interstage
    const vacEngine = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 8.5, 18.0, 36, 6, true),
      niobiumVacMat
    );
    vacEngine.position.set(0, stage2Y - 9.0, 0);
    addPart(vacEngine, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Stage 2 Vacuum Engine with High-Expansion Niobium Skirt (eps=180)',
      materialName: 'C-103 Niobium Alloy with Disilicide Oxidation Coating',
      specStandard: 'NASA SP-125'
    });

    // Cold-Gas RCS Thruster Quads (4 locations around Stage 2)
    gridAngles.forEach((ang, idx) => {
      const rcsGroup = new THREE.Group();
      for (let r = 0; r < 4; r++) {
        const noz = new THREE.Mesh(
          new THREE.ConeGeometry(0.4, 1.2, 12),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 })
        );
        noz.rotation.z = (r * Math.PI) / 2;
        noz.position.set(Math.cos(r * Math.PI / 2) * 0.8, Math.sin(r * Math.PI / 2) * 0.8, 0);
        rcsGroup.add(noz);
      }
      rcsGroup.position.set(Math.cos(ang) * (boosterRadius + 0.5), stage2Y + stage2H - 4.0, Math.sin(ang) * (boosterRadius + 0.5));
      addPart(rcsGroup, {
        wbsId: '06.03',
        entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
        partName: `Reaction Control System (RCS) Cold-Gas Thruster Quad #${idx + 1}`,
        materialName: 'Inconel 625 Nozzle / Solenoid Pulse Valves',
        specStandard: 'AIAA S-080'
      });
    });

    // -----------------------------------------------------------------------
    // F. PAYLOAD ATTACH FITTING & SATELLITE BUS (WBS 06.06)
    // -----------------------------------------------------------------------
    const payloadY = stage2Y + stage2H;

    // Payload Attach Fitting (Conical PAF)
    const paf = new THREE.Mesh(
      new THREE.CylinderGeometry(9.0, boosterRadius, 10.0, 36),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85 })
    );
    paf.position.set(0, payloadY + 5.0, 0);
    addPart(paf, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'Payload Attach Fitting (PAF) & Low-Shock Marmon Clampband',
      materialName: 'High-Modulus Carbon Fiber Conical Adapter',
      specStandard: 'NASA-STD-7001'
    });

    // Satellite Bus with Deployed Solar Arrays
    const satBus = new THREE.Mesh(
      new THREE.BoxGeometry(7.0, 12.0, 7.0),
      goldMliMat
    );
    satBus.position.set(0, payloadY + 16.0, 0);
    addPart(satBus, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'NASA Deep Space Exploration / Comms Satellite Bus',
      materialName: 'Multi-Layer Insulation (MLI) / Honeycomb Core',
      specStandard: 'NASA-STD-7001'
    });

    // Solar Panel Arrays (Wings Extended)
    [-12.0, 12.0].forEach((sx, sidx) => {
      const solarPanel = new THREE.Mesh(
        new THREE.BoxGeometry(14.0, 6.0, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.9, roughness: 0.1 })
      );
      solarPanel.position.set(sx + (sidx === 0 ? -2.0 : 2.0), payloadY + 16.0, 0);
      addPart(solarPanel, {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        partName: `Gallium Arsenide Triple-Junction Solar Array Wing #${sidx + 1}`,
        materialName: 'GaAs Solar Cells / Carbon Fiber Substrate',
        specStandard: 'AIAA S-111'
      });
    });

    // -----------------------------------------------------------------------
    // G. BISECTOR PAYLOAD FAIRING & NOSE CAP (WBS 06.02 & 06.04)
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
    addPart(fairing, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Composite Bisector Payload Fairing with Acoustic Blankets',
      materialName: 'Carbon-Epoxy Facesheets with Aluminum Honeycomb Core',
      specStandard: 'NASA-STD-5020'
    });

    // Aerodynamic Nose Cap & Pitot Static Mast
    const noseMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.4, 8.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95 })
    );
    noseMast.position.set(0, payloadY + 5.0 + fairingH + 4.0, 0);
    addPart(noseMast, {
      wbsId: '06.04',
      entityName: 'Thermal Protection System (TPS) & Aerodynamics',
      partName: 'Aerodynamic Air-Data Pitot Probe & Lightning Protection Mast',
      materialName: 'Inconel 600 Aerodynamic Tip',
      specStandard: 'MIL-HDBK-310'
    });
  }

  // =========================================================================
  // 2. MACRO ROCKET ENGINE DEEP-DIVE (TURBOPUMP, INJECTOR, NOZZLE CHANNELS)
  // =========================================================================

  buildMacroRocketEngine(group, addPart, context) {
    const { ProceduralHardware, ProceduralPbrMaterials, PhenomenaShaders } = context;

    // Materials Palette
    const copperLinerMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Narloy-Z copper sheen
      metalness: 0.95,
      roughness: 0.15,
      side: THREE.DoubleSide
    });

    const nickelJacketMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Electroformed Nickel
      metalness: 0.90,
      roughness: 0.25
    });

    const inconelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Cast Inconel 718
      metalness: 0.92,
      roughness: 0.3
    });

    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Machined Ti-6Al-4V
      metalness: 0.95,
      roughness: 0.18
    });

    // -----------------------------------------------------------------------
    // A. COMBUSTION CHAMBER & REGENERATIVE COOLING NOZZLE (WBS 06.01)
    // -----------------------------------------------------------------------
    const chamberH = 32.0;
    const throatY = 0.0;

    // Combustion Chamber Body
    const chamberBody = new THREE.Mesh(
      new THREE.CylinderGeometry(14.0, 9.2, chamberH, 48, 12, false),
      copperLinerMat
    );
    chamberBody.position.set(0, throatY + chamberH / 2, 0);
    addPart(chamberBody, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Narloy-Z Milled Channel Combustion Chamber (GRCop-42)',
      materialName: 'High-Conductivity Copper-Silver Alloy (k=325 W/mK)',
      specStandard: 'NASA SP-125'
    });

    // Bell Nozzle with Milled Coolant Channels Visible on Liner
    const nozzleH = 65.0;
    const nozzleGeom = new THREE.CylinderGeometry(9.2, 34.0, nozzleH, 48, 16, true);
    const nozzleMesh = new THREE.Mesh(nozzleGeom, copperLinerMat);
    nozzleMesh.position.set(0, throatY - nozzleH / 2, 0);
    addPart(nozzleMesh, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Regeneratively Cooled Bell Nozzle with 180 Milled Axial Channels',
      materialName: 'Narloy-Z Liner with Electroformed Structural Nickel Jacket',
      specStandard: 'NASA SP-125'
    });

    // Circumferential Stiffener Rings (Hatbands)
    for (let ny = throatY - 8.0; ny >= throatY - nozzleH + 5.0; ny -= 10.0) {
      const radiusAtY = 9.2 + (34.0 - 9.2) * ((-ny) / nozzleH);
      const hatband = new THREE.Mesh(
        new THREE.TorusGeometry(radiusAtY + 0.6, 0.65, 8, 36),
        nickelJacketMat
      );
      hatband.rotation.x = Math.PI / 2;
      hatband.position.set(0, ny, 0);
      addPart(hatband, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: 'Nozzle Structural Stiffener Ring (Hatband)',
        materialName: 'Inconel 718 Hoop Reinforcement',
        specStandard: 'NASA SP-125'
      });
    }

    // -----------------------------------------------------------------------
    // B. COAXIAL INJECTOR DOME & SPARK TORCH IGNITERS (WBS 06.01)
    // -----------------------------------------------------------------------
    const domeY = throatY + chamberH;
    const injectorDome = new THREE.Mesh(
      new THREE.CylinderGeometry(15.5, 14.2, 8.0, 36),
      inconelMat
    );
    injectorDome.position.set(0, domeY + 4.0, 0);
    addPart(injectorDome, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Coaxial Injector Dome & Propellant Distribution Manifold',
      materialName: 'SX500 Single-Crystal Superalloy',
      specStandard: 'NASA SP-125'
    });

    // Array of Coaxial Swirl Injector Elements on Faceplate
    for (let ring = 1; ring <= 3; ring++) {
      const ringRadius = ring * 3.8;
      const count = ring * 8;
      for (let i = 0; i < count; i++) {
        const theta = (i * 2 * Math.PI) / count;
        const elem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.45, 2.2, 12),
          titaniumMat
        );
        elem.position.set(Math.cos(theta) * ringRadius, domeY, Math.sin(theta) * ringRadius);
        addPart(elem, {
          wbsId: '06.01',
          entityName: 'Propulsion Systems',
          partName: 'Coaxial Swirl Injector Element (Outer CH4 / Inner LOX Post)',
          materialName: 'Haynes 230 High-Temperature Alloy',
          specStandard: 'NASA SP-125'
        });
      }
    }

    // Central Augmented Spark Torch Igniter (ASI)
    const asi = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 6.0, 16),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.85 })
    );
    asi.position.set(0, domeY + 1.0, 0);
    addPart(asi, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Dual Augmented Spark Igniter (ASI) Chamber',
      materialName: 'High-Energy Plasma Discharge Core',
      specStandard: 'NASA SP-125'
    });

    // -----------------------------------------------------------------------
    // C. DUAL-SPOOL HIGH-PRESSURE TURBOPUMPS (WBS 06.01)
    // -----------------------------------------------------------------------
    
    // 1. Methane Fuel Turbopump (Left) - 42,000 RPM
    const fuelPumpGroup = new THREE.Group();
    const fuelPumpCasing = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.5, 12.0, 24),
      inconelMat
    );
    fuelPumpCasing.rotation.z = Math.PI / 2;
    fuelPumpGroup.add(fuelPumpCasing);

    // Fuel Impeller (Inside / Visible Cutaway)
    const fuelImpeller = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.8, 2.5, 24),
      titaniumMat
    );
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
    addPart(fuelPumpGroup, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Liquid Methane High-Pressure Turbopump (42,000 RPM, 385 bar)',
      materialName: 'Ti-5Al-2.5Sn Inducer / Inconel 718 Shrouded Impeller',
      specStandard: 'NASA SP-125'
    });

    // 2. Liquid Oxygen Turbopump (Right) - 28,000 RPM
    const oxPumpGroup = new THREE.Group();
    const oxPumpCasing = new THREE.Mesh(
      new THREE.CylinderGeometry(6.5, 7.5, 13.0, 24),
      inconelMat
    );
    oxPumpCasing.rotation.z = Math.PI / 2;
    oxPumpGroup.add(oxPumpCasing);

    // LOX Impeller
    const oxImpeller = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.8, 3.0, 24),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.92 }) // LOX Blue Tint
    );
    oxImpeller.rotation.z = Math.PI / 2;
    oxPumpGroup.add(oxImpeller);

    oxPumpGroup.position.set(22.0, domeY + 14.0, -4.0);
    addPart(oxPumpGroup, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Liquid Oxygen High-Pressure Turbopump (28,000 RPM, 360 bar)',
      materialName: 'Monel K-500 Shaft / Inconel 718 Dual Volute Casing',
      specStandard: 'NASA SP-125'
    });

    // -----------------------------------------------------------------------
    // D. GIMBAL RING & DUAL HYDRAULIC TVC ACTUATORS (WBS 06.01 & 06.03)
    // -----------------------------------------------------------------------
    const gimbalRingY = domeY + 12.0;
    const gimbalRing = new THREE.Mesh(
      new THREE.TorusGeometry(18.0, 2.4, 16, 36),
      inconelMat
    );
    gimbalRing.rotation.x = Math.PI / 2;
    gimbalRing.position.set(0, gimbalRingY, 0);
    addPart(gimbalRing, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'High-Load Gimbal Ring Bearing (+/- 8 deg Vectoring)',
      materialName: 'Maraging 300 High-Strength Steel',
      specStandard: 'NASA-STD-5001'
    });

    // Dual Electro-Hydraulic Linear Actuator Pistons (Pitch & Yaw)
    [[-14.0, 0], [0, 14.0]].forEach(([ax, az], aidx) => {
      const actGroup = new THREE.Group();
      // Outer Cylinder
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, 18.0, 16),
        titaniumMat
      );
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
      addPart(actGroup, {
        wbsId: '06.03',
        entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
        partName: `Electro-Hydraulic TVC Linear Actuator Piston #${aidx + 1}`,
        materialName: '17-4PH Hardened Stainless Steel / AerMet 100 Rod',
        specStandard: 'NASA-STD-5001'
      });
    });

    // -----------------------------------------------------------------------
    // E. HELIUM COPV PRESSURIZATION SPHERES & FLANGES (WBS 06.01 & 06.07)
    // -----------------------------------------------------------------------
    [-15.0, 15.0].forEach((hx, hidx) => {
      const copv = new THREE.Mesh(
        new THREE.SphereGeometry(4.5, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7, metalness: 0.3 }) // Carbon fiber weave
      );
      copv.position.set(hx, domeY + 28.0, hidx === 0 ? -12.0 : 12.0);
      addPart(copv, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: `Helium Carbon Overwrapped Pressure Vessel (COPV) #${hidx + 1} (450 bar)`,
        materialName: 'T1000 Carbon Filament / Seamless Aluminum 6061 Liner',
        specStandard: 'AIAA S-080'
      });
    });

    // Propellant Manifold Flanges & Dial Gauges
    if (ProceduralHardware) {
      // Oxygen Feed Flange & Gauge
      const loxFlange = ProceduralHardware.createFlangeAssembly(4.5, 9.0, 3.0, 8);
      loxFlange.position.set(16.0, domeY + 8.0, 0);
      loxFlange.rotation.z = Math.PI / 2;
      group.add(loxFlange);

      const loxGauge = ProceduralHardware.createDialGauge(5.0, 0, 500, 360, 'BAR (LOX)');
      loxGauge.position.set(16.0, domeY + 16.0, 0);
      group.add(loxGauge);

      // Methane Feed Flange & Gauge
      const ch4Flange = ProceduralHardware.createFlangeAssembly(4.5, 9.0, 3.0, 8);
      ch4Flange.position.set(-16.0, domeY + 8.0, 0);
      ch4Flange.rotation.z = -Math.PI / 2;
      group.add(ch4Flange);

      const ch4Gauge = ProceduralHardware.createDialGauge(5.0, 0, 500, 385, 'BAR (CH4)');
      ch4Gauge.position.set(-16.0, domeY + 16.0, 0);
      group.add(ch4Gauge);
    }

    // Active Supersonic Exhaust Plume on Engine
    if (PhenomenaShaders && PhenomenaShaders.createSupersonicPlume) {
      const plume = PhenomenaShaders.createSupersonicPlume({
        machNumber: 3.6,
        shockCount: 6,
        plumeLength: 140,
        coreRadius: 32,
        accentColor: 0x38bdf8
      });
      plume.position.set(0, throatY - nozzleH - 65.0, 0);
      group.add(plume);
    }
  }

  // =========================================================================
  // 3. COMPLETE NASA SPACECRAFT INTERIOR (CREW CABIN, ECLSS, AVIONICS, SM)
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
      color: 0x38bdf8, // Al-Li 2195 cryogenic anodized blue
      metalness: 0.85,
      roughness: 0.35,
      wireframe: false
    });

    const carbonDeckMat = new THREE.MeshStandardMaterial({
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
      color: 0xf59e0b, // Rad-hard gold plated electronics chassis
      metalness: 0.95,
      roughness: 0.18
    });

    const waterBladderMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // Potable water radiation shield bladder
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.65
    });

    const eclssModuleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Brushed aerospace aluminum
      metalness: 0.88,
      roughness: 0.22
    });

    const titaniumTankMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Ti-6Al-4V Grade 5 propellant tank
      metalness: 0.92,
      roughness: 0.25
    });

    const copvCarbonMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Carbon fiber composite overwrapped pressure vessel
      metalness: 0.4,
      roughness: 0.65
    });

    const copperNozzleMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Narloy-Z regeneratively cooled copper nozzle
      metalness: 0.95,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    // -----------------------------------------------------------------------
    // A. TRANSLUCENT OUTER PRESSURE HULL & MMOD SHIELD (WBS 06.02)
    // -----------------------------------------------------------------------
    const capsuleBaseR = 21.0;
    const capsuleTopR = 10.0;
    const capsuleH = 34.0;
    const capsuleCenterY = 2.0;

    // Translucent Conical Crew Module Pressure Hull
    const hullGeom = new THREE.CylinderGeometry(capsuleTopR, capsuleBaseR, capsuleH, 48, 12, true);
    const hullMesh = new THREE.Mesh(hullGeom, translucentHullMat);
    hullMesh.position.set(0, capsuleCenterY, 0);
    addPart(hullMesh, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Crew Module Translucent Cutaway Pressure Vessel & MMOD Shield',
      materialName: 'Al-Li 2195 Welded Isogrid with Nextel/Kevlar MMOD Bumper',
      specStandard: 'NASA-STD-5001'
    });

    // Avcoat Base Heat Shield & Carrier Structure
    const heatShieldGeom = new THREE.CylinderGeometry(capsuleBaseR, capsuleBaseR + 1.2, 3.5, 48);
    const heatShield = new THREE.Mesh(heatShieldGeom, new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85, metalness: 0.1 }));
    heatShield.position.set(0, capsuleCenterY - capsuleH / 2 - 1.75, 0);
    addPart(heatShield, {
      wbsId: '06.04',
      entityName: 'Thermal Protection System (TPS) & Aerodynamics',
      partName: 'Aft Ablative Avcoat Re-entry Heat Shield (>1,200 W/cm2)',
      materialName: 'Fiberglass Honeycomb Filled with Avcoat 5026-39 Modified Epoxy Novolac',
      specStandard: 'NASA SP-8032'
    });

    // Internal Triangular Isogrid Stiffener Rings
    [-10.0, 0.0, 10.0].forEach((ry, idx) => {
      const ringR = capsuleBaseR - (idx + 1) * 3.2;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(ringR, 0.45, 8, 48),
        isogridFrameMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, capsuleCenterY + ry, 0);
      addPart(ring, {
        wbsId: '06.02',
        entityName: 'Structures & Mechanisms',
        partName: `Circumferential Isogrid Rib Frame Ring #${idx + 1}`,
        materialName: 'Al-Li 2195-T8 CNC Milled Ribbing',
        specStandard: 'NASA SP-8007'
      });
    });

    // -----------------------------------------------------------------------
    // B. TWO-DECK STRUCTURAL ARCHITECTURE & CREW HATCH (WBS 06.02)
    // -----------------------------------------------------------------------
    const flightDeckY = capsuleCenterY + 4.0;
    const habitatDeckY = capsuleCenterY - 10.0;

    // Upper Flight Deck Floor
    const flightFloor = new THREE.Mesh(
      new THREE.CylinderGeometry(15.5, 15.5, 1.2, 36),
      carbonDeckMat
    );
    flightFloor.position.set(0, flightDeckY, 0);
    addPart(flightFloor, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Upper Flight Deck Carbon-Composite Honeycomb Floor',
      materialName: 'Carbon Fiber Facesheets with Al Honeycomb Core',
      specStandard: 'NASA-STD-5020'
    });

    // Lower Habitation Deck Floor
    const habFloor = new THREE.Mesh(
      new THREE.CylinderGeometry(19.2, 19.2, 1.2, 36),
      carbonDeckMat
    );
    habFloor.position.set(0, habitatDeckY, 0);
    addPart(habFloor, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Lower Habitation & ECLSS Equipment Deck Floor',
      materialName: 'Al-Li 2195 Reinforced Inter-Deck Web Plate',
      specStandard: 'NASA-STD-5020'
    });

    // Central Structural Column with Vertical Crew Transit Inter-Deck Hatchway
    const centralCol = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, capsuleH - 8.0, 24, 4, true),
      isogridFrameMat
    );
    centralCol.position.set(0, capsuleCenterY - 1.0, 0);
    addPart(centralCol, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Central Structural Tie-Column & Inter-Deck Ladder Way',
      materialName: 'Extruded Al-Li 2195 Spine with Titanium Fasteners',
      specStandard: 'NASA-STD-5001'
    });

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
    // C. UPPER FLIGHT DECK: 4x CREW COUCHES & COCKPIT CONSOLES (WBS 06.03 & 06.06)
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

      addPart(cGroup, {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        partName: `Articulating Carbon-Composite Couch #${cIdx + 1} (${cLoc.name})`,
        materialName: 'Toray T1000 Carbon-Composite with 15g Shock Attenuators',
        specStandard: 'NASA-STD-3001 Vol 2'
      });
    });

    // Glass Cockpit Main Console with 3x Ruggedized AMLCD Displays
    const consoleGroup = new THREE.Group();
    const dashBase = new THREE.Mesh(
      new THREE.BoxGeometry(16.0, 4.5, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8 })
    );
    dashBase.rotation.x = Math.PI / 8;
    consoleGroup.add(dashBase);

    // 3 Active Display Screens (CDR, Central GNC, PLT)
    [-5.0, 0, 5.0].forEach((sx, sidx) => {
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, 2.8),
        displayConsoleMat
      );
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
    addPart(consoleGroup, {
      wbsId: '06.03',
      entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
      partName: 'Glass Cockpit Primary Flight Display (PFD) Console & Hand Controllers',
      materialName: 'Triple AMLCD Displays (1920x1200) with ARINC 661 Server',
      specStandard: 'NASA-STD-3001 Vol 2'
    });

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
      addPart(win, {
        wbsId: '06.02',
        entityName: 'Structures & Mechanisms',
        partName: `Fused Silica Optical Docking Window #${widx + 1}`,
        materialName: 'Triple-Pane Fused Silica / Aluminosilicate Pressure Glass',
        specStandard: 'NASA-STD-5001'
      });
    });

    // -----------------------------------------------------------------------
    // D. LOWER HABITATION DECK: CREW LIVING, GALLEY & HYGIENE (WBS 06.06)
    // -----------------------------------------------------------------------

    // 4x Private Microgravity Crew Sleep Berths
    const berthAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
    berthAngles.forEach((bAng, bIdx) => {
      const bGroup = new THREE.Group();
      // Sleep Cabin Box
      const bBox = new THREE.Mesh(new THREE.BoxGeometry(4.2, 8.5, 3.2), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7 }));
      bGroup.add(bBox);

      // Nomex Sleep Restraint Bag
      const bag = new THREE.Mesh(new THREE.BoxGeometry(3.2, 7.0, 1.8), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 }));
      bag.position.set(0, 0, 0.4);
      bGroup.add(bag);

      const bRadius = 14.2;
      bGroup.position.set(Math.cos(bAng) * bRadius, habitatDeckY + 4.8, Math.sin(bAng) * bRadius);
      bGroup.rotation.y = -bAng + Math.PI / 2;

      addPart(bGroup, {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        partName: `Private Acoustic-Damped Sleep Berth #${bIdx + 1} (<48 dBA)`,
        materialName: 'Acoustic Sound-Dampening Honeycomb with Nomex Restraints',
        specStandard: 'NASA-STD-3001 Vol 1'
      });
    });

    // Galley Station: Food Rehydration Oven & Dual Hot/Chilled Water Dispensers
    const galleyGroup = new THREE.Group();
    const galleyCabinet = new THREE.Mesh(new THREE.BoxGeometry(5.5, 7.5, 3.0), eclssModuleMat);
    galleyGroup.add(galleyCabinet);

    const ovenDoor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 }));
    ovenDoor.position.set(-1.2, 1.2, 1.55);
    galleyGroup.add(ovenDoor);

    const waterSpigot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.95 }));
    waterSpigot.position.set(1.4, 1.2, 1.6);
    galleyGroup.add(waterSpigot);

    galleyGroup.position.set(-12.5, habitatDeckY + 4.5, 0);
    galleyGroup.rotation.y = Math.PI / 2;
    addPart(galleyGroup, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'Galley Nutrition Station (Hot Food Oven & 70C/18C Water Dispenser)',
      materialName: 'Sealed Al 6061 Enclosure with Stainless Steel Fluid Manifolds',
      specStandard: 'NASA-STD-3001 Vol 2'
    });

    // Universal Waste Management System (UWMS) Microgravity Vacuum Commode & Hygiene Bay
    const uwmsGroup = new THREE.Group();
    const commodeCabinet = new THREE.Mesh(new THREE.BoxGeometry(4.5, 7.5, 3.5), eclssModuleMat);
    uwmsGroup.add(commodeCabinet);

    const commodeSeat = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 24), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 }));
    commodeSeat.position.set(0, 0.7, 0.9);
    uwmsGroup.add(commodeSeat);

    const urineFunnel = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 16), new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8 }));
    urineFunnel.position.set(1.3, 1.8, 0.9);
    uwmsGroup.add(urineFunnel);

    uwmsGroup.position.set(12.5, habitatDeckY + 4.5, 0);
    uwmsGroup.rotation.y = -Math.PI / 2;
    addPart(uwmsGroup, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'Universal Waste Management System (UWMS Dual-Airflow Vacuum Commode)',
      materialName: 'Titanium Fan Separator & Dual HEPA/Charcoal Odor Scrubbers',
      specStandard: 'NASA-STD-3001 Vol 2'
    });

    // Exercise & Physical Countermeasures Station (ARED-mini & Cycle Ergometer)
    const exerciseGroup = new THREE.Group();
    const exFrame = new THREE.Mesh(new THREE.BoxGeometry(3.5, 6.5, 3.5), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 }));
    exerciseGroup.add(exFrame);

    const ergometerFlywheel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 24), new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 }));
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
    addPart(exerciseGroup, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'ARED-mini Exercise Ergometer with Vibration Isolation (VIS >98% Isolation)',
      materialName: 'Magnetic Resistance Flywheel with Spring-Damper Suspension',
      specStandard: 'NASA-STD-3001 Vol 1'
    });

    // Central Radiation Storm Shelter (Solar Particle Event Safe Haven)
    [-4.5, 4.5].forEach((wx, widx) => {
      const waterBladder = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 2.4, 7.2, 24),
        waterBladderMat
      );
      waterBladder.position.set(wx, habitatDeckY + 4.2, 0);
      addPart(waterBladder, {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        partName: `SPE Storm Shelter 250L Potable Water Radiation Shield Tank #${widx + 1}`,
        materialName: 'Flexible Polyurethane Bladder with Borated Polyethylene Liners',
        specStandard: 'NASA-STD-3001 Vol 2'
      });
    });

    // Crew Medical System (CEMS) & Diagnostic Ultrasound Locker
    const medicalLocker = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 3.8, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.6 })
    );
    medicalLocker.position.set(4.5, habitatDeckY + 2.5, -7.5);
    addPart(medicalLocker, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'Crew Medical System (CEMS Diagnostic Ultrasound, AED & Trauma Kit)',
      materialName: 'Ruggedized Mil-Spec Enclosure with Parenteral Drug Dispensers',
      specStandard: 'NASA-STD-3001 Vol 1'
    });

    // -----------------------------------------------------------------------
    // E. LIFE SUPPORT (ECLSS) & AVIONICS COMPUTING EQUIPMENT RACKS (WBS 06.06 & 06.03)
    // -----------------------------------------------------------------------

    // Atmosphere Revitalization System (ARS): Dual Solid-Amine CO2 Scrubbers & OGA
    const eclssRack = new THREE.Group();
    const rackCabinet = new THREE.Mesh(new THREE.BoxGeometry(7.0, 7.5, 3.0), eclssModuleMat);
    eclssRack.add(rackCabinet);

    // Dual Amine Thermal Desorption (ATD) Columns
    [-1.6, 1.6].forEach((cx, cidx) => {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 5.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.9 })
      );
      col.position.set(cx, 0.4, 1.2);
      eclssRack.add(col);
    });

    // Sabatier Reactor & Oxygen Generation Assembly (OGA) Canisters
    const sabatier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 4.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.85 })
    );
    sabatier.position.set(0, 0.4, 1.2);
    eclssRack.add(sabatier);

    eclssRack.position.set(0, habitatDeckY + 4.5, 12.5);
    eclssRack.rotation.y = Math.PI;
    addPart(eclssRack, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: 'Atmosphere Revitalization (ARS Dual Solid-Amine CO2 Scrubbers & OGA)',
      materialName: 'Thermally Regenerable Solid Amine (ATD) with Sabatier Reactor',
      specStandard: 'NASA-STD-3001 Vol 2'
    });

    // Avionics Equipment Bay: Triple Redundant BAE RAD750 Flight Computers & Cold Plates
    const avionicsBay = new THREE.Group();
    const avionicsRack = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4.5, 2.5), new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 }));
    avionicsBay.add(avionicsRack);

    // 3 Gold-Anodized Rad-Hard Computers (TMR Architecture)
    [-1.6, 0, 1.6].forEach((ax, aidx) => {
      const comp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 2.0), avionicsGoldMat);
      comp.position.set(ax, 0.2, 0.4);
      avionicsBay.add(comp);
    });

    avionicsBay.position.set(-6.5, habitatDeckY + 2.8, -7.5);
    addPart(avionicsBay, {
      wbsId: '06.03',
      entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
      partName: 'Triple Modular Redundant (TMR) RAD750 Flight Computers & Cold Plates',
      materialName: 'Radiation-Hardened PowerPC (100 krad TID) with Brazed Liquid Cold Plates',
      specStandard: 'DO-178C DAL-A / MIL-STD-1553B'
    });

    // 12x Standardized NASA Middeck Science Experiment & Cargo Lockers (MDL)
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
    addPart(lockerGroup, {
      wbsId: '06.06',
      entityName: 'Payload Accommodations & Mission ECLSS',
      partName: '12x Standardized NASA Middeck Lockers (MDL 0.057 m3 Science & Cargo)',
      materialName: 'Precision CNC Al 6061-T6 Lockers with 28VDC/120VDC Powered Links',
      specStandard: 'NASA-STD-7001'
    });

    // -----------------------------------------------------------------------
    // F. FORWARD DOCKING TUNNEL & xEMU SPACEWALK SUIT STATIONS (WBS 06.02 & 06.06)
    // -----------------------------------------------------------------------
    const dockingY = capsuleCenterY + capsuleH / 2;

    // NASA Docking System (NDS Block 2 / IDSS) Peripheral Ring & Hatch
    const ndsRing = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 3.0, 36, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.2 })
    );
    ndsRing.position.set(0, dockingY + 1.5, 0);
    addPart(ndsRing, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'NASA Docking System (NDS Block 2) Peripheral Soft-Capture Ring (IDSS)',
      materialName: 'High-Strength Ti-6Al-4V Ring with 12 Structural Hard Latch Hooks',
      specStandard: 'IDSS / NASA-STD-5001'
    });

    const hatchDoor = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 0.6, 32),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85 })
    );
    hatchDoor.position.set(0, dockingY + 0.3, 0);
    addPart(hatchDoor, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: '0.80m Clear Crew Transfer Pressure Hatch with Equalization Valve',
      materialName: 'Al-Li 2195 Forged Hatch with Dual Silicone O-Ring Pressure Seals',
      specStandard: 'NASA-STD-5001'
    });

    // 2x xEMU Spacewalk Spacesuit Servicing & Donning Stations
    [-4.5, 4.5].forEach((sx, sidx) => {
      const suit = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.4, 5.5, 16),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }) // Orthofabric suit white
      );
      suit.position.set(sx, flightDeckY + 4.5, -6.5);
      addPart(suit, {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        partName: `Exploration Extravehicular Mobility Unit (xEMU) Spacesuit Station #${sidx + 1}`,
        materialName: 'Multi-Layer Orthofabric Suit with 200-bar O2 Recharge Umbilical',
        specStandard: 'NASA-STD-3001 Vol 1'
      });
    });

    // -----------------------------------------------------------------------
    // G. AFT SERVICE MODULE: PROPULSION, TANKS & ULTRA-FLEX ARRAYS (WBS 06.01 & 06.07)
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
    addPart(smHull, {
      wbsId: '06.02',
      entityName: 'Structures & Mechanisms',
      partName: 'Service Module (SM) Cutaway Cylindrical Structure',
      materialName: 'Carbon Fiber Skin with Composite Unpressurized Radiator Panels',
      specStandard: 'NASA-STD-5020'
    });

    // Deep Space Maneuvering Main Engine (AJ10-190 derivative / Methalox)
    const smEngineGroup = new THREE.Group();
    const smGimbal = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 16), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.95 }));
    smEngineGroup.add(smGimbal);

    const smChamber = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.8, 4.5, 24), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 }));
    smChamber.position.set(0, -2.5, 0);
    smEngineGroup.add(smChamber);

    const smNozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 6.2, 12.0, 32, 4, true), copperNozzleMat);
    smNozzle.position.set(0, -9.5, 0);
    smEngineGroup.add(smNozzle);

    // Dual Linear TVC Gimbal Actuators (+/- 8 deg)
    [[-2.2, 0], [0, 2.2]].forEach(([ax, az]) => {
      const act = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4.5, 12), new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95 }));
      act.position.set(ax, -1.5, az);
      smEngineGroup.add(act);
    });

    smEngineGroup.position.set(0, smY - smHeight / 2, 0);
    addPart(smEngineGroup, {
      wbsId: '06.01',
      entityName: 'Propulsion Systems',
      partName: 'Deep Space Maneuvering Main Engine (26.7 kN Vacuum Thrust, Isp 316.5s)',
      materialName: 'Niobium C-103 High-Expansion Nozzle with Inconel 718 Powerhead',
      specStandard: 'NASA SP-125'
    });

    // 4x Titanium Propellant Tanks (2 MMH Fuel + 2 NTO Oxidizer) with Capillary Vanes
    const tankOffsets = [
      { name: 'MMH Fuel Tank 1', x: -7.5, z: 0, color: 0x38bdf8 },
      { name: 'MMH Fuel Tank 2', x: 7.5, z: 0, color: 0x38bdf8 },
      { name: 'NTO Oxidizer Tank 1', x: 0, z: -7.5, color: 0xf59e0b },
      { name: 'NTO Oxidizer Tank 2', x: 0, z: 7.5, color: 0xf59e0b }
    ];
    tankOffsets.forEach((tData) => {
      const pTank = new THREE.Mesh(
        new THREE.SphereGeometry(5.2, 24, 24),
        titaniumTankMat
      );
      pTank.position.set(tData.x, smY + 1.5, tData.z);
      addPart(pTank, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: `Titanium Grade 5 Propellant Tank (${tData.name}) with PMD Vanes`,
        materialName: 'Ti-6Al-4V Forged Spherical Vessel with Internal Capillary Traps',
        specStandard: 'AIAA S-080'
      });
    });

    // 2x High-Pressure Helium COPV Pressurization Bottles (350 bar)
    [-11.5, 11.5].forEach((hx, hidx) => {
      const copv = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 20, 20),
        copvCarbonMat
      );
      copv.position.set(hx, smY + 5.0, 0);
      addPart(copv, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: `Helium Pressurization COPV Bottle #${hidx + 1} (350 bar)`,
        materialName: 'Carbon Fiber Overwrapped Vessel with Aluminum 6061-T6 Liner',
        specStandard: 'AIAA S-080'
      });
    });

    // 4x RCS Quad Thruster Pods (24 total pulse thrusters for 6-DOF control)
    const rcsAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    rcsAngles.forEach((rAng, rIdx) => {
      const rcsGroup = new THREE.Group();
      for (let n = 0; n < 4; n++) {
        const noz = new THREE.Mesh(
          new THREE.ConeGeometry(0.35, 1.0, 12),
          new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 })
        );
        noz.rotation.z = (n * Math.PI) / 2;
        noz.position.set(Math.cos(n * Math.PI / 2) * 0.7, Math.sin(n * Math.PI / 2) * 0.7, 0);
        rcsGroup.add(noz);
      }
      rcsGroup.position.set(Math.cos(rAng) * (smRadius + 0.5), smY + 6.0, Math.sin(rAng) * (smRadius + 0.5));
      rcsGroup.rotation.y = -rAng;
      addPart(rcsGroup, {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        partName: `Reaction Control System (RCS) Quad Thruster Pod #${rIdx + 1} (440 N per nozzle)`,
        materialName: 'Niobium Coated Nozzles with Solenoid Pulse Pilot Valves',
        specStandard: 'NASA SP-125'
      });
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
      addPart(solarGroup, {
        wbsId: '06.07',
        entityName: 'Electrical Power & Data Distribution',
        partName: `Deployable UltraFlex Circular Solar Array Wing #${sIdx + 1} (11.2 kW Total)`,
        materialName: 'InGaP/InGaAs/Ge Triple-Junction Solar Cells on Carbon Mesh',
        specStandard: 'AIAA S-111'
      });
    });

    // Gimballed 1.2m Deep Space High-Gain Antenna (Ka/X-band DSN Link)
    const hgaGroup = new THREE.Group();
    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 0.4, 1.2, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.85, roughness: 0.2, side: THREE.DoubleSide })
    );
    dish.rotation.x = Math.PI / 3;
    hgaGroup.add(dish);

    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 12), new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.95 }));
    feed.rotation.x = Math.PI / 3;
    feed.position.set(0, 0.6, 0.8);
    hgaGroup.add(feed);

    hgaGroup.position.set(0, smY + 8.5, smRadius + 4.5);
    addPart(hgaGroup, {
      wbsId: '06.08',
      entityName: 'Ground Support, Test & Deep Space Network (DSN)',
      partName: '1.2m Gimballed Deep Space High-Gain Antenna (Ka/X-band DSN Link >50 Mbps)',
      materialName: 'Carbon-Composite Reflector with Dual-Axis Rotary Gimbal',
      specStandard: 'NASA-STD-7001'
    });
  }
}

// Module export for Node.js test environment and browser window globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NasaSpaceRocket3D };
}
if (typeof window !== 'undefined') {
  window.NasaSpaceRocket3D = NasaSpaceRocket3D;
}
