/**
 * OmniEng 3D High-Performance Viewport Controller (WebGL / Three.js)
 * Industrial-grade multi-component assembly rendering, exploded views, X-ray transparency,
 * FEA stress colormaps, CFD particle streamlines, and animated rotating machinery.
 */

class Viewport3D {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.currentMesh = null;
    this.gridHelper = null;
    this.axesHelper = null;

    // View Modes: 'shaded', 'wireframe', 'xray', 'stress', 'exploded'
    this.viewMode = 'shaded';
    this.explodeFactor = 0.0; // 0.0 (assembled) to 1.0 (fully exploded)
    this.deformedScale = 1.0;

    // Machinery animation state
    this.isSpinning = true;
    this.rotorRPM = 8000;
    this.propellerMeshes = [];
    this.streamlineParticles = null;

    // Camera control state
    this.isDragging = false;
    this.isPanning = false;
    this.previousMousePosition = { x: 0, y: 0 };
    this.cameraDistance = 220;
    this.cameraAngle = { theta: 0.65, phi: 0.85 }; // Spherical coordinates
    this.target = new THREE.Vector3(0, 0, 0);

    // Raycaster for interactive component probing
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredObject = null;

    // Clipping plane for cross-section analysis
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    this.isClipping = false;
    this.clipAxis = 'y';
    this.clipOffset = 0;

    // 3D Caliper Measurement Tool
    this.isMeasuring = false;
    this.measurePoints = [];
    this.measureLine = null;

    // Transient Drop Dynamic Animation
    this.transientData = null;
    this.currentFrameIdx = 0;
    this.isTransientPlaying = false;
    this.transientTimer = null;

    this.init();
  }

  init() {
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 500;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060911);

    // 2. Camera setup
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 3000);
    this.updateCameraPosition();

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;

    // 4. Lighting (Studio Key + Fill + Rim + Ground Bounce)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
    keyLight.position.set(120, 200, 120);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
    fillLight.position.set(-150, -80, -120);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x818cf8, 1.2);
    rimLight.position.set(0, 150, -180);
    this.scene.add(rimLight);

    // 5. Engineering Ground Grid & Coordinate Triad
    this.gridHelper = new THREE.GridHelper(400, 40, 0x1e293b, 0x0f172a);
    this.gridHelper.position.y = -35;
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(45);
    this.axesHelper.position.set(-150, -34, -150);
    this.scene.add(this.axesHelper);

    // 6. Bind Mouse Orbit / Pan / Zoom Events
    this.setupInteractions();

    // 7. Window resize observer
    window.addEventListener('resize', () => this.onResize());

    // 8. Start Animation Loop
    this.animate();

    // Default CAD Model: Smartphone Enclosure
    this.renderSmartphoneCad(75, 8.2, 160);
  }

  updateCameraPosition() {
    const x = this.target.x + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.sin(this.cameraAngle.theta);
    const y = this.target.y + this.cameraDistance * Math.cos(this.cameraAngle.phi);
    const z = this.target.z + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.cos(this.cameraAngle.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  setupInteractions() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = e.button === 0;
      this.isPanning = e.button === 2;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!this.isDragging && !this.isPanning) {
        this.checkRaycastHover();
        return;
      }

      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      if (this.isDragging) {
        // Orbit rotation
        this.cameraAngle.theta -= deltaX * 0.008;
        this.cameraAngle.phi = Math.max(0.08, Math.min(Math.PI - 0.08, this.cameraAngle.phi - deltaY * 0.008));
        this.updateCameraPosition();
      } else if (this.isPanning) {
        // Pan target
        const panSpeed = 0.25;
        this.target.x -= deltaX * panSpeed;
        this.target.y += deltaY * panSpeed;
        this.updateCameraPosition();
      }

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isPanning = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance = Math.max(25, Math.min(1000, this.cameraDistance + e.deltaY * 0.22));
      this.updateCameraPosition();
    });

    this.canvas.addEventListener('click', () => {
      if (this.isMeasuring && this.currentMesh && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.currentMesh.children, true);
        if (intersects.length > 0) {
          this.addMeasurePoint(intersects[0].point);
        }
      }
    });
  }

  checkRaycastHover() {
    if (!this.currentMesh || !this.camera) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.currentMesh.children, true);
    
    const statsEl = document.getElementById('viewport-stats');
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const partName = obj.userData.partName || obj.name || 'Component';
      const materialName = obj.userData.materialName || 'Metal/Alloy';
      if (statsEl) {
        statsEl.innerHTML = `<span style="color: var(--accent-cyan); font-weight:600;">[Probe]</span> Part: <strong>${partName}</strong> | Mat: ${materialName} | P(${intersects[0].point.x.toFixed(1)}, ${intersects[0].point.y.toFixed(1)}, ${intersects[0].point.z.toFixed(1)})`;
      }
    } else if (statsEl && statsEl.dataset.defaultStats) {
      statsEl.innerHTML = statsEl.dataset.defaultStats;
    }
  }

  onResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width && height && this.renderer) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Spin Propellers if machinery is active
    if (this.isSpinning && this.propellerMeshes.length > 0) {
      const deltaAngle = (this.rotorRPM / 60) * 0.05;
      this.propellerMeshes.forEach((prop, idx) => {
        prop.rotation.y += (idx % 2 === 0 ? 1 : -1) * deltaAngle;
      });
    }

    // Animate Streamlines Particles if present
    if (this.streamlineParticles) {
      const positions = this.streamlineParticles.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += 1.8; // move in X direction (flow)
        if (positions[i] > 120) {
          positions[i] = -120;
        }
      }
      this.streamlineParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  clearMesh() {
    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentMesh = null;
    }
    this.propellerMeshes = [];
    this.streamlineParticles = null;
  }

  setExplodeFactor(val) {
    this.explodeFactor = Math.max(0.0, Math.min(1.0, Number(val)));
    if (this.currentMesh && this.currentMesh.userData.updateExplode) {
      this.currentMesh.userData.updateExplode(this.explodeFactor);
    }
  }

  setViewMode(mode) {
    this.viewMode = mode; // 'shaded', 'wireframe', 'xray', 'stress', 'exploded'
    if (!this.currentMesh) return;

    this.currentMesh.traverse((child) => {
      if (child.isMesh) {
        if (mode === 'wireframe') {
          child.material.wireframe = true;
          child.material.transparent = false;
          child.material.opacity = 1.0;
        } else if (mode === 'xray') {
          child.material.wireframe = false;
          child.material.transparent = true;
          child.material.opacity = 0.35;
        } else {
          child.material.wireframe = false;
          child.material.transparent = child.userData.defaultTransparent || false;
          child.material.opacity = child.userData.defaultOpacity || 1.0;
        }
      }
    });

    if (mode === 'exploded') {
      this.setExplodeFactor(0.8);
    } else {
      this.setExplodeFactor(0.0);
    }
  }

  setCameraPreset(preset) {
    if (preset === 'iso') {
      this.cameraAngle = { theta: 0.65, phi: 0.85 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'top') {
      this.cameraAngle = { theta: 0.0, phi: 0.05 };
      this.cameraDistance = 240;
      this.target.set(0, 0, 0);
    } else if (preset === 'front') {
      this.cameraAngle = { theta: 0.0, phi: Math.PI / 2 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'reset') {
      this.cameraAngle = { theta: 0.65, phi: 0.85 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    }
    this.updateCameraPosition();
  }

  // =========================================================================
  // Cross-Section Clipping Plane Tool (Creo / NX / SolidWorks)
  // =========================================================================

  setClippingPlane(enabled, axis = 'y', offset = 0) {
    this.isClipping = !!enabled;
    this.clipAxis = axis;
    this.clipOffset = offset;

    const normal = axis === 'x' ? new THREE.Vector3(-1, 0, 0)
                 : axis === 'z' ? new THREE.Vector3(0, 0, -1)
                 : new THREE.Vector3(0, -1, 0);

    this.clipPlane.set(normal, offset);

    if (this.currentMesh) {
      this.currentMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.clippingPlanes = this.isClipping ? [this.clipPlane] : [];
          child.material.clipShadows = true;
          child.material.needsUpdate = true;
        }
      });
    }
  }

  // =========================================================================
  // 3D Point-to-Point Caliper Measurement Tool
  // =========================================================================

  toggleMeasureTool(active) {
    this.isMeasuring = (active !== undefined) ? active : !this.isMeasuring;
    this.measurePoints = [];
    if (this.measureLine) {
      this.scene.remove(this.measureLine);
      this.measureLine = null;
    }
    const hud = document.getElementById('measurement-hud');
    if (hud) {
      hud.style.display = this.isMeasuring ? 'block' : 'none';
      if (this.isMeasuring) {
        hud.innerHTML = `
          <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px;">📏 3D Caliper Measurement Active</div>
          <div style="color: var(--text-muted); font-size: 10px;">Click first 3D vertex or component face to anchor...</div>
        `;
      }
    }
  }

  addMeasurePoint(point3D) {
    if (!this.isMeasuring) return;
    this.measurePoints.push(point3D.clone());

    const hud = document.getElementById('measurement-hud');
    if (this.measurePoints.length === 1 && hud) {
      hud.innerHTML = `
        <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px;">📏 Point 1 Anchored</div>
        <div style="color: var(--text-muted); font-size: 10px;">P1(${point3D.x.toFixed(1)}, ${point3D.y.toFixed(1)}, ${point3D.z.toFixed(1)}) — Click second point...</div>
      `;
    } else if (this.measurePoints.length === 2) {
      const p1 = this.measurePoints[0];
      const p2 = this.measurePoints[1];
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const dz = Math.abs(p2.z - p1.z);
      const dist = p1.distanceTo(p2);

      // Render 3D Dimension Line
      if (this.measureLine) this.scene.remove(this.measureLine);

      const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 });
      this.measureLine = new THREE.Line(geom, mat);
      this.scene.add(this.measureLine);

      if (hud) {
        hud.innerHTML = `
          <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px;">📏 3D Caliper Result</div>
          <div style="font-size: 13px; font-weight: 700; color: #fff;">Length: ${dist.toFixed(2)} mm</div>
          <div style="color: var(--text-dim); font-size: 9px; font-family: var(--font-mono); margin-top: 2px;">
            ΔX: ${dx.toFixed(2)}mm | ΔY: ${dy.toFixed(2)}mm | ΔZ: ${dz.toFixed(2)}mm
          </div>
        `;
      }
      this.measurePoints = [];
    }
  }

  // =========================================================================
  // Transient Dynamic Drop Animation Player (Ansys Mechanical Parity)
  // =========================================================================

  loadTransientDropData(data) {
    this.transientData = data;
    this.currentFrameIdx = 0;
    this.renderTransientFrame(0);
  }

  renderTransientFrame(frameIdx) {
    if (!this.transientData || !this.transientData.frames) return;
    this.currentFrameIdx = Math.max(0, Math.min(this.transientData.frames.length - 1, frameIdx));
    const frame = this.transientData.frames[this.currentFrameIdx];

    if (this.currentMesh) {
      // Dynamic vertical motion during drop impact and rebound
      this.currentMesh.position.y = frame.positionZ_mm;

      // When impact shock hits, update FEA von Mises stress heatmap live
      if (frame.inContact && frame.chassisStress_MPa > 25) {
        this.renderFEAStressHeatmap('transient', frame.chassisStress_MPa);
        this.currentMesh.position.y = frame.positionZ_mm;
      }
    }

    // Update transient playback scrubber controls
    const timeSlider = document.getElementById('transient-time-slider');
    const timeReadout = document.getElementById('transient-time-readout');
    const stressReadout = document.getElementById('transient-stress-readout');
    const accelReadout = document.getElementById('transient-accel-readout');

    if (timeSlider) timeSlider.value = this.currentFrameIdx;
    if (timeReadout) timeReadout.textContent = `${frame.timeMs.toFixed(2)} ms`;
    if (stressReadout) stressReadout.textContent = `${frame.chassisStress_MPa.toFixed(1)} MPa`;
    if (accelReadout) accelReadout.textContent = `${frame.acceleration_G.toFixed(1)} G`;
  }

  playTransient() {
    if (this.isTransientPlaying || !this.transientData) return;
    this.isTransientPlaying = true;
    const playNext = () => {
      if (!this.isTransientPlaying) return;
      let nextIdx = this.currentFrameIdx + 1;
      if (nextIdx >= this.transientData.frames.length) nextIdx = 0;
      this.renderTransientFrame(nextIdx);
      this.transientTimer = setTimeout(playNext, 60);
    };
    playNext();
  }

  pauseTransient() {
    this.isTransientPlaying = false;
    if (this.transientTimer) clearTimeout(this.transientTimer);
  }

  // =========================================================================
  // 1. Consumer Electronics: Full 6-Layer Smartphone Assembly (Creo / NX)
  // =========================================================================

  renderSmartphoneCad(w = 75, h = 8.2, d = 160) {
    this.clearMesh();
    const group = new THREE.Group();
    const explodedParts = [];

    // Layer 1: Titanium Unibody Chassis Back/Sides (Bottom)
    const chassisGeom = new THREE.BoxGeometry(w, h * 0.7, d);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.9,
      roughness: 0.22
    });
    const chassis = new THREE.Mesh(chassisGeom, chassisMat);
    chassis.position.y = -h * 0.15;
    chassis.userData = { partName: 'Titanium Grade 5 Unibody Enclosure', materialName: 'Ti-6Al-4V', basePosY: chassis.position.y, explodeY: -35 };
    group.add(chassis);
    explodedParts.push(chassis);

    // Layer 2: Li-Ion Battery Pouch with Ribbon Cable
    const batGeom = new THREE.BoxGeometry(w * 0.75, 4.2, d * 0.52);
    const batMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.7,
      roughness: 0.35
    });
    const battery = new THREE.Mesh(batGeom, batMat);
    battery.position.set(0, 0, d * 0.12);
    battery.userData = { partName: 'Li-Ion Polymer 4500mAh Battery Pouch', materialName: 'Lithium Cobalt Oxide', basePosY: 0, explodeY: -15 };
    group.add(battery);
    explodedParts.push(battery);

    // Layer 3: Copper Vapor Chamber with Laser-Sintered Micro-Wicks
    const vcGeom = new THREE.BoxGeometry(w * 0.82, 0.45, d * 0.72);
    const vcMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Rich copper luster
      metalness: 0.95,
      roughness: 0.2
    });
    const vaporChamber = new THREE.Mesh(vcGeom, vcMat);
    vaporChamber.position.set(0, 2.5, 0);
    vaporChamber.userData = { partName: 'Two-Phase Copper Vapor Chamber Heat Spreader', materialName: 'Pure Oxygen-Free Copper (OFHC)', basePosY: 2.5, explodeY: 8 };
    group.add(vaporChamber);
    explodedParts.push(vaporChamber);

    // Layer 4: High-Density Multilayer Logic Board (PCB) with BGA Processors
    const pcbGeom = new THREE.BoxGeometry(w * 0.88, 1.2, d * 0.38);
    const pcbMat = new THREE.MeshStandardMaterial({
      color: 0x065f46, // Industrial FR4 Green Solder Mask
      roughness: 0.5,
      metalness: 0.3
    });
    const pcb = new THREE.Mesh(pcbGeom, pcbMat);
    pcb.position.set(0, 4.2, -d * 0.25);
    pcb.userData = { partName: '14-Layer High-Density Interconnect (HDI) Main Logic Board', materialName: 'FR4 + Copper Microvias', basePosY: 4.2, explodeY: 25 };

    // Add SoC Silicon Package & RAM on top of PCB
    const socGeom = new THREE.BoxGeometry(16, 1.2, 16);
    const socMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.85, roughness: 0.15 });
    const soc = new THREE.Mesh(socGeom, socMat);
    soc.position.set(0, 1.2, 0);
    soc.userData = { partName: '3nm FinFET Application Processor (SoC + DRAM)', materialName: 'Monolithic Silicon' };
    pcb.add(soc);

    group.add(pcb);
    explodedParts.push(pcb);

    // Layer 5: Triple Camera Optomechanical Module & Sapphire Glass Bump
    const camGeom = new THREE.BoxGeometry(32, 4.5, 36);
    const camMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.92 });
    const camModule = new THREE.Mesh(camGeom, camMat);
    camModule.position.set(-w * 0.25, -h * 0.5 - 2.5, -d * 0.3);
    camModule.userData = { partName: 'Triple Lens Optomechanical Camera Assembly', materialName: 'Sapphire Glass & Ceramic', basePosY: camModule.position.y, explodeY: -55 };

    for (let i = 0; i < 3; i++) {
      const ringGeom = new THREE.CylinderGeometry(5.2, 5.2, 4.8, 32);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.95 });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.set(-w * 0.25 + (i === 2 ? 7 : -7), -h * 0.5 - 3.0, -d * 0.3 + (i % 2 === 0 ? -7 : 7));
      group.add(ring);

      const lensGeom = new THREE.CylinderGeometry(3.6, 3.6, 4.9, 32);
      const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.85 });
      const lens = new THREE.Mesh(lensGeom, lensMat);
      lens.position.copy(ring.position);
      group.add(lens);
    }
    group.add(camModule);
    explodedParts.push(camModule);

    // Layer 6: Front Corning Gorilla Glass Victus Cover Screen (Top)
    const screenGeom = new THREE.BoxGeometry(w - 2, 0.8, d - 4);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.02,
      metalness: 0.96,
      transparent: true,
      opacity: 0.92
    });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.y = h * 0.5 + 0.4;
    screen.userData = {
      partName: 'Corning Gorilla Glass Victus Front Panel & AMOLED Display',
      materialName: 'Aluminosilicate Glass',
      basePosY: screen.position.y,
      explodeY: 55,
      defaultTransparent: true,
      defaultOpacity: 0.92
    };
    group.add(screen);
    explodedParts.push(screen);

    // Assembly Explode Dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach(p => {
        p.position.y = p.userData.basePosY + (p.userData.explodeY - p.userData.basePosY) * factor;
      });
    };

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(3480, 'Solid CAD Assembly (Creo / NX)');
  }

  // =========================================================================
  // 1B. Precision Optomechanical Camera Lens Assembly (PTC Creo / Siemens NX)
  // Shows full internal cross-section: 8 glass elements in 6 groups, 9-blade iris,
  // copper voice coil motor (VCM), internal light baffles, and ray tracing cone.
  // =========================================================================

  renderCameraLens3D(cutaway = true, cutawayAngle = Math.PI / 2, explodeFactor = 0, fStop = 1.4, showRays = true) {
    this.clearMesh();
    const group = new THREE.Group();
    const explodedParts = [];

    // Outer barrel dimensions
    const barrelRadius = 32.0; // mm
    const barrelLength = 88.0; // mm
    const thetaStart = cutaway ? cutawayAngle * 0.5 : 0;
    const thetaLength = cutaway ? Math.PI * 2 - cutawayAngle : Math.PI * 2;

    // Common Materials
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x111827, // Matte Hard-Anodized Aircraft Aluminum 6061-T6
      metalness: 0.88,
      roughness: 0.28,
      side: THREE.DoubleSide
    });

    const rubberRingMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.92,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const baffleMat = new THREE.MeshStandardMaterial({
      color: 0x050811, // Anti-Reflective Matte Flocked Black
      roughness: 0.98,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    const brassCamMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Precision Brass Helical Cam Collar
      metalness: 0.92,
      roughness: 0.35,
      side: THREE.DoubleSide
    });

    const copperVcmMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Pure Copper Electromagnetic Voice Coil Windings
      metalness: 0.96,
      roughness: 0.22,
      side: THREE.DoubleSide
    });

    const magnetMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // NdFeB Neodymium Stator Magnet
      metalness: 0.95,
      roughness: 0.18,
      side: THREE.DoubleSide
    });

    const bayonetMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0, // Precision CNC Stainless Steel 316L Bayonet Flange
      metalness: 0.98,
      roughness: 0.15,
      side: THREE.DoubleSide
    });

    const goldPinMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Hard Gold-Plated CPU Telemetry Contact Pins
      metalness: 0.98,
      roughness: 0.1
    });

    // Optical Glass Materials (Schott Crown N-BK7, Dense Flint N-SF11, CaF2 Fluorite)
    const glassCrownMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.15,
      roughness: 0.03,
      transparent: true,
      opacity: 0.72,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    const glassFlintMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      metalness: 0.20,
      roughness: 0.02,
      transparent: true,
      opacity: 0.75,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    const glassFluoriteMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf,
      metalness: 0.10,
      roughness: 0.02,
      transparent: true,
      opacity: 0.68,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    // -----------------------------------------------------------------------
    // 1. Outer Aluminum Lens Barrel with Cross-Section Cutaway Window
    // -----------------------------------------------------------------------
    const barrelGeom = new THREE.CylinderGeometry(barrelRadius, barrelRadius * 0.96, barrelLength, 48, 1, true, thetaStart, thetaLength);
    const barrelMesh = new THREE.Mesh(barrelGeom, barrelMat);
    barrelMesh.rotation.x = Math.PI / 2;
    barrelMesh.position.z = 10.0;
    barrelMesh.userData = {
      partName: 'Anodized 6061-T6 Aluminum Lens Barrel with Cutaway Section',
      materialName: 'Aluminum 6061-T6 Hard Anodized',
      basePosZ: 10.0,
      explodeZ: 10.0
    };
    group.add(barrelMesh);

    // Front Filter Ring & Thread (58mm thread)
    const filterRingGeom = new THREE.CylinderGeometry(barrelRadius + 0.8, barrelRadius, 8.0, 48, 1, false, thetaStart, thetaLength);
    const filterRing = new THREE.Mesh(filterRingGeom, barrelMat);
    filterRing.rotation.x = Math.PI / 2;
    filterRing.position.z = -32.0;
    filterRing.userData = {
      partName: 'Front Filter Thread Collar (Ø58mm Standard Thread)',
      materialName: 'Aluminum 6061-T6',
      basePosZ: -32.0,
      explodeZ: -65.0
    };
    group.add(filterRing);
    explodedParts.push(filterRing);

    // Knurled Rubber Manual Focus Ring (Middle)
    const focusRingGeom = new THREE.CylinderGeometry(barrelRadius + 1.6, barrelRadius + 1.6, 22.0, 48, 1, false, thetaStart, thetaLength);
    const focusRing = new THREE.Mesh(focusRingGeom, rubberRingMat);
    focusRing.rotation.x = Math.PI / 2;
    focusRing.position.z = -6.0;
    focusRing.userData = {
      partName: 'Manual Focus Ring with Diamond Knurled Grip Pattern',
      materialName: 'High-Friction EPDM Synthetic Rubber',
      basePosZ: -6.0,
      explodeZ: -25.0
    };
    group.add(focusRing);
    explodedParts.push(focusRing);

    // Aperture Control Ring with f-stop Index Marks
    const apertureRingGeom = new THREE.CylinderGeometry(barrelRadius + 1.0, barrelRadius + 1.0, 14.0, 48, 1, false, thetaStart, thetaLength);
    const apertureRing = new THREE.Mesh(apertureRingGeom, barrelMat);
    apertureRing.rotation.x = Math.PI / 2;
    apertureRing.position.z = 24.0;
    apertureRing.userData = {
      partName: 'Mechanical Aperture Selector Ring (f/1.4 - f/16 Click Steps)',
      materialName: 'Aluminum 6061-T6 Engraved',
      basePosZ: 24.0,
      explodeZ: 40.0
    };
    group.add(apertureRing);
    explodedParts.push(apertureRing);

    // -----------------------------------------------------------------------
    // 2. Internal Anti-Reflective Stepped Baffles & Lens Group Spacers
    // -----------------------------------------------------------------------
    [-22, -10, 8, 28, 42].forEach((zPos, idx) => {
      const baffleGeom = new THREE.RingGeometry(barrelRadius * 0.72, barrelRadius * 0.94, 32, 1, thetaStart, thetaLength);
      const baffle = new THREE.Mesh(baffleGeom, baffleMat);
      baffle.position.z = zPos;
      baffle.userData = {
        partName: `Anti-Glare Serrated Light Baffle Collar #${idx + 1}`,
        materialName: 'Matte Anti-Reflective Coating'
      };
      group.add(baffle);
    });

    // Internal Brass Dual-Helicoid Cam Barrel (Focus mechanism guide)
    const helicoidGeom = new THREE.CylinderGeometry(barrelRadius * 0.82, barrelRadius * 0.82, 34.0, 32, 1, true, thetaStart, thetaLength);
    const helicoidMesh = new THREE.Mesh(helicoidGeom, brassCamMat);
    helicoidMesh.rotation.x = Math.PI / 2;
    helicoidMesh.position.z = 4.0;
    helicoidMesh.userData = {
      partName: 'Precision CNC Dual-Helicoid Linear Cam Track (Autofocus Guide)',
      materialName: 'Free-Cutting Brass C36000'
    };
    group.add(helicoidMesh);

    // -----------------------------------------------------------------------
    // 3. Voice Coil Motor (VCM) Electromagnetic Autofocus Linear Actuator
    // -----------------------------------------------------------------------
    // Outer Neodymium Magnetic Stator Ring
    const magnetGeom = new THREE.CylinderGeometry(barrelRadius * 0.90, barrelRadius * 0.90, 16.0, 32, 1, true, thetaStart, thetaLength);
    const magnetMesh = new THREE.Mesh(magnetGeom, magnetMat);
    magnetMesh.rotation.x = Math.PI / 2;
    magnetMesh.position.z = 0.0;
    magnetMesh.userData = {
      partName: 'VCM Permanent Magnetic Stator Ring (Sintered NdFeB N52)',
      materialName: 'Neodymium-Iron-Boron (N52 Magnet)'
    };
    group.add(magnetMesh);

    // Inner Copper Electromagnetic Voice Coil
    const vcmCoilGeom = new THREE.CylinderGeometry(barrelRadius * 0.86, barrelRadius * 0.86, 12.0, 32, 1, true, thetaStart, thetaLength);
    const vcmCoil = new THREE.Mesh(vcmCoilGeom, copperVcmMat);
    vcmCoil.rotation.x = Math.PI / 2;
    vcmCoil.position.z = 0.0;
    vcmCoil.userData = {
      partName: 'High-Density OFHC Copper Voice Coil Windings (Autofocus Motor)',
      materialName: 'Pure Oxygen-Free Copper (99.99%)',
      basePosZ: 0.0,
      explodeZ: 12.0
    };
    group.add(vcmCoil);
    explodedParts.push(vcmCoil);

    // -----------------------------------------------------------------------
    // 4. Optical Lens Elements (8 Elements in 6 Groups)
    // -----------------------------------------------------------------------
    // Helper to create spherical meniscus / curved lens element
    const createLensMesh = (radiusFront, radiusRear, thickness, diameter, zPos, material, partName, matName, explodeDist) => {
      // Create thick spherical lens using double dome geometries
      const lensGroup = new THREE.Group();
      const lensR = diameter / 2;

      // Front convex dome
      const frontGeom = new THREE.CylinderGeometry(lensR, lensR * 0.94, thickness * 0.5, 36);
      const frontMesh = new THREE.Mesh(frontGeom, material);
      frontMesh.rotation.x = Math.PI / 2;
      lensGroup.add(frontMesh);

      // Spherical convex front cap
      const capGeom = new THREE.SphereGeometry(lensR * 1.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
      const capMesh = new THREE.Mesh(capGeom, material);
      capMesh.position.z = -thickness * 0.25;
      lensGroup.add(capMesh);

      // Aluminum mounting retaining cell ring
      const cellGeom = new THREE.CylinderGeometry(lensR + 1.2, lensR + 1.2, thickness * 0.6, 36, 1, true);
      const cellMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
      const cellMesh = new THREE.Mesh(cellGeom, cellMat);
      cellMesh.rotation.x = Math.PI / 2;
      lensGroup.add(cellMesh);

      lensGroup.position.z = zPos;
      lensGroup.userData = {
        partName,
        materialName: matName,
        basePosZ: zPos,
        explodeZ: zPos + explodeDist,
        defaultTransparent: true,
        defaultOpacity: 0.72
      };
      group.add(lensGroup);
      explodedParts.push(lensGroup);
      return lensGroup;
    };

    // E1: Front Large Aspherical Meniscus (Schott N-BK7 Crown Glass)
    createLensMesh(42.5, 110.0, 7.8, 48.0, -28.0, glassCrownMat,
      'Group 1: Front Aspherical Meniscus Element (High AR Coating)', 'Schott N-BK7 Crown Glass (nd=1.5168)', -55.0);

    // E2: Positive Meniscus Crown Element (Schott N-BK7)
    createLensMesh(28.0, 54.0, 6.2, 42.0, -16.0, glassCrownMat,
      'Group 2: Positive Meniscus Crown Element', 'Schott N-BK7 Crown Glass', -35.0);

    // E3 + E4: Cemented Achromatic Doublet (Fluorite Crown + Dense Flint N-SF11)
    createLensMesh(48.0, -24.5, 4.8, 36.0, -6.0, glassFluoriteMat,
      'Group 3A: Cemented Fluorite Achromat Crown (Ultra-Low Dispersion CaF2)', 'Optical Fluorite (CaF2)', -15.0);
    createLensMesh(-24.5, 32.0, 3.2, 36.0, -1.8, glassFlintMat,
      'Group 3B: Cemented Dense Flint Element (Chromatic Correction)', 'Schott N-SF11 Dense Flint Glass (nd=1.7847)', -12.0);

    // -----------------------------------------------------------------------
    // 5. Variable Iris Diaphragm Aperture Stop (9 Curved Overlapping Blades)
    // -----------------------------------------------------------------------
    const irisGroup = new THREE.Group();
    const irisOuterRadius = 18.0;
    // Calculate iris opening radius based on f-stop (f/1.4 -> ~14mm, f/16 -> ~2.5mm)
    const irisInnerRadius = Math.max(2.2, Math.min(14.0, 18.0 / Math.max(1.0, fStop)));

    // Outer aperture mounting collar
    const irisRingGeom = new THREE.RingGeometry(irisInnerRadius, irisOuterRadius, 36);
    const irisMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.65,
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    const irisDisc = new THREE.Mesh(irisRingGeom, irisMat);
    irisGroup.add(irisDisc);

    // Render 9 radially distributed overlapping iris blades
    for (let b = 0; b < 9; b++) {
      const angle = (b / 9) * Math.PI * 2;
      const bladeGeom = new THREE.PlaneGeometry(irisOuterRadius * 0.8, irisOuterRadius * 0.4);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.75,
        roughness: 0.4,
        side: THREE.DoubleSide
      });
      const bladeMesh = new THREE.Mesh(bladeGeom, bladeMat);
      bladeMesh.position.set(
        Math.cos(angle) * (irisInnerRadius + 3.0),
        Math.sin(angle) * (irisInnerRadius + 3.0),
        0.05 * b
      );
      bladeMesh.rotation.z = angle + 0.45;
      irisGroup.add(bladeMesh);
    }

    irisGroup.position.z = 4.0;
    irisGroup.userData = {
      partName: `9-Blade Circular Iris Diaphragm Aperture Mechanism (Active: f/${fStop})`,
      materialName: 'High-Carbon Matte Spring Steel (Anti-Glare)',
      basePosZ: 4.0,
      explodeZ: 4.0
    };
    group.add(irisGroup);
    explodedParts.push(irisGroup);

    // E5: Autofocus Variator Biconcave Group (Negative Dispersive)
    createLensMesh(-35.0, 28.0, 4.2, 32.0, 12.0, glassFlintMat,
      'Group 4: Autofocus Variator Biconcave Diverging Element', 'Schott N-SF11 Dense Flint Glass', 8.0);

    // E6: Biconvex Rear Master Lens Group
    createLensMesh(36.0, -42.0, 5.6, 34.0, 22.0, glassCrownMat,
      'Group 5: Biconvex Rear Master Element (Spherical Aberration Correction)', 'Schott N-BK7 Crown Glass', 22.0);

    // E7 + E8: Rear Field Flattener & Relay Doublet
    createLensMesh(55.0, -30.0, 4.5, 34.0, 32.0, glassCrownMat,
      'Group 6A: Rear Field Flattener Crown Element', 'Schott N-BK7 Crown Glass', 38.0);
    createLensMesh(-30.0, -85.0, 3.2, 34.0, 37.0, glassFluoriteMat,
      'Group 6B: Rear Aspheric Fluorite Relay Element', 'Optical Fluorite (CaF2 ED)', 44.0);

    // -----------------------------------------------------------------------
    // 6. Stainless Steel Bayonet Mount & Gold Contact Pins
    // -----------------------------------------------------------------------
    const bayonetFlangeGeom = new THREE.CylinderGeometry(barrelRadius * 0.95, barrelRadius * 0.95, 5.0, 48, 1, false, thetaStart, thetaLength);
    const bayonetFlange = new THREE.Mesh(bayonetFlangeGeom, bayonetMat);
    bayonetFlange.rotation.x = Math.PI / 2;
    bayonetFlange.position.z = 48.0;
    bayonetFlange.userData = {
      partName: 'Precision CNC Machined Stainless Steel Lens Bayonet Flange',
      materialName: 'AISI 316L Stainless Steel',
      basePosZ: 48.0,
      explodeZ: 70.0
    };
    group.add(bayonetFlange);
    explodedParts.push(bayonetFlange);

    // 3 Bayonet Locking Lugs
    for (let lug = 0; lug < 3; lug++) {
      const lugGeom = new THREE.BoxGeometry(4.5, 2.0, 3.5);
      const lugMesh = new THREE.Mesh(lugGeom, bayonetMat);
      const lugAngle = (lug / 3) * Math.PI * 2;
      lugMesh.position.set(Math.cos(lugAngle) * (barrelRadius * 0.78), Math.sin(lugAngle) * (barrelRadius * 0.78), 50.5);
      lugMesh.rotation.z = lugAngle;
      group.add(lugMesh);
    }

    // Gold Electrical CPU Contact Pins (8 Contacts for high-speed autofocus)
    for (let p = 0; p < 8; p++) {
      const pinGeom = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16);
      const pinMesh = new THREE.Mesh(pinGeom, goldPinMat);
      pinMesh.rotation.x = Math.PI / 2;
      const pinAngle = -Math.PI / 2 + (p - 3.5) * 0.12;
      pinMesh.position.set(Math.cos(pinAngle) * (barrelRadius * 0.65), Math.sin(pinAngle) * (barrelRadius * 0.65), 50.0);
      pinMesh.userData = { partName: `CPU Telemetry Spring Contact Pin #${p + 1}`, materialName: 'Electroless Nickel / Immersion Gold' };
      group.add(pinMesh);
    }

    // -----------------------------------------------------------------------
    // 7. Full-Frame CMOS Sensor Plane & Optical Low-Pass Filter (OLPF)
    // -----------------------------------------------------------------------
    const sensorPackageGeom = new THREE.BoxGeometry(42.0, 30.0, 3.0);
    const sensorPackageMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.85, roughness: 0.3 });
    const sensorPackage = new THREE.Mesh(sensorPackageGeom, sensorPackageMat);
    sensorPackage.position.z = 68.0;
    sensorPackage.userData = {
      partName: 'Full-Frame 35mm (36x24mm) CMOS Sensor Package',
      materialName: 'High-Thermal Ceramic Substrate with Gold Bonding Wire',
      basePosZ: 68.0,
      explodeZ: 95.0
    };
    group.add(sensorPackage);
    explodedParts.push(sensorPackage);

    // Active Silicon Die with Micro-Lens Array
    const sensorDieGeom = new THREE.BoxGeometry(36.0, 24.0, 0.8);
    const sensorDieMat = new THREE.MeshStandardMaterial({
      color: 0x064e3b, // Iridescent Silicon Green/Blue CFA
      metalness: 0.95,
      roughness: 0.1
    });
    const sensorDie = new THREE.Mesh(sensorDieGeom, sensorDieMat);
    sensorDie.position.set(0, 0, -1.2);
    sensorPackage.add(sensorDie);

    // Optical Low-Pass Filter (OLPF / IR Cut Filter Glass)
    const olpfGeom = new THREE.BoxGeometry(37.0, 25.0, 0.6);
    const olpfMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.65,
      roughness: 0.05,
      metalness: 0.3
    });
    const olpfMesh = new THREE.Mesh(olpfGeom, olpfMat);
    olpfMesh.position.set(0, 0, -1.8);
    olpfMesh.userData = { partName: 'Optical Low-Pass IR-Cut Filter Glass (OLPF)', materialName: 'Niobium Dichroic Coated Glass' };
    sensorPackage.add(olpfMesh);

    // -----------------------------------------------------------------------
    // 8. Simulated Optical Light Ray Tracing Cone (Ray Path through Assembly)
    // -----------------------------------------------------------------------
    if (showRays) {
      const rayGroup = new THREE.Group();
      const rayPointsCount = 9;
      const rayRadius = Math.min(22.0, 25.0 / Math.max(1.0, fStop));

      for (let r = 0; r < rayPointsCount; r++) {
        const phi = (r / rayPointsCount) * Math.PI * 2;
        const curR = (r === 0) ? 0 : rayRadius; // Center ray + peripheral cone rays
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);

        const curvePoints = [
          new THREE.Vector3(cosP * curR, sinP * curR, -45.0),  // Entrance pupil
          new THREE.Vector3(cosP * curR, sinP * curR, -28.0),  // Front element
          new THREE.Vector3(cosP * curR * 0.88, sinP * curR * 0.88, -16.0), // Crown refraction
          new THREE.Vector3(cosP * curR * 0.72, sinP * curR * 0.72, -6.0),  // Doublet
          new THREE.Vector3(cosP * curR * 0.52, sinP * curR * 0.52, 4.0),   // Iris aperture waist
          new THREE.Vector3(cosP * curR * 0.40, sinP * curR * 0.40, 16.0),  // Variator
          new THREE.Vector3(cosP * curR * 0.28, sinP * curR * 0.28, 34.0),  // Master
          new THREE.Vector3(0, 0, 68.0) // Focal convergence point on sensor plane
        ];

        const rayGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const rayColor = (r === 0) ? 0xf59e0b : 0x38bdf8; // Golden axial ray + cyan marginal rays
        const rayMat = new THREE.LineBasicMaterial({
          color: rayColor,
          linewidth: (r === 0) ? 2 : 1,
          transparent: true,
          opacity: 0.75
        });
        const rayLine = new THREE.Line(rayGeom, rayMat);
        rayGroup.add(rayLine);
      }

      // Add soft glowing transparent cone envelope
      const coneGeom = new THREE.ConeGeometry(rayRadius * 0.52, 64.0, 24, 1, true);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const coneMesh = new THREE.Mesh(coneGeom, coneMat);
      coneMesh.rotation.x = -Math.PI / 2;
      coneMesh.position.z = 36.0;
      rayGroup.add(coneMesh);

      rayGroup.userData = { partName: 'Diffraction-Limited Optical Light Ray Cone', materialName: 'Coherent 550nm Laser Wavefront' };
      group.add(rayGroup);
    }

    // Assembly Explode Dispatcher (Smooth separation along optical Z-axis)
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach(p => {
        p.position.z = p.userData.basePosZ + (p.userData.explodeZ - p.userData.basePosZ) * factor;
      });
    };

    // Apply initial explode factor if specified
    if (explodeFactor > 0) {
      group.userData.updateExplode(explodeFactor);
    }

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(8920, 'Optomechanical 50mm f/1.4 Lens Assembly (PTC Creo / Siemens NX / Zemax)');
  }

  // =========================================================================
  // 2. Drone & Aerospace: Carbon Fiber FPV / VTOL Quadcopter (CATIA / Fusion)
  // =========================================================================

  renderDrone3D(armLength = 85, rpm = 8000) {
    this.clearMesh();
    this.rotorRPM = rpm;
    const group = new THREE.Group();
    const explodedParts = [];

    // Central Carbon Fiber Lower Deck (Toray T700 3K Twill)
    const deckGeom = new THREE.BoxGeometry(50, 2.5, 95);
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.35,
      metalness: 0.85
    });
    const lowerDeck = new THREE.Mesh(deckGeom, carbonMat);
    lowerDeck.userData = { partName: 'Lower 3K Carbon Fiber Chassis Plate', materialName: 'Toray T700 Carbon Fiber', basePosY: -4, explodeY: -25 };
    group.add(lowerDeck);
    explodedParts.push(lowerDeck);

    // Upper Carbon Fiber Deck
    const upperDeck = new THREE.Mesh(deckGeom, carbonMat);
    upperDeck.position.y = 18;
    upperDeck.userData = { partName: 'Upper Structural Deck Plate', materialName: 'Toray T700 Carbon Fiber', basePosY: 18, explodeY: 35 };
    group.add(upperDeck);
    explodedParts.push(upperDeck);

    // Electronics Flight Stack (STM32 Betaflight FC + 4-in-1 50A BLHeli ESC)
    const fcGeom = new THREE.BoxGeometry(30.5, 3.0, 30.5);
    const fcMat = new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.6, roughness: 0.4 });
    const fcStack = new THREE.Mesh(fcGeom, fcMat);
    fcStack.position.set(0, 7, 0);
    fcStack.userData = { partName: 'F7 Flight Controller & 4-in-1 ESC Stack', materialName: 'FR4 & MOSFETs', basePosY: 7, explodeY: 10 };
    group.add(fcStack);
    explodedParts.push(fcStack);

    // 4 Carbon Fiber Tubular Arms with CNC Motor Mounts
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const x = armLength * Math.cos(angle);
      const z = armLength * Math.sin(angle);

      // Hollow Carbon Arm Tube (300mm wheelbase)
      const armGeom = new THREE.CylinderGeometry(3.5, 3.5, armLength, 16);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.85, roughness: 0.3 });
      const arm = new THREE.Mesh(armGeom, armMat);
      arm.position.set(x / 2, 7, z / 2);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0, z).normalize());
      arm.userData = { partName: `Carbon Fiber Arm #${i + 1}`, materialName: 'Structural Carbon Composite', basePosY: 7, explodeY: 7 };
      group.add(arm);

      // 2207 Brushless Outrunner Motor (Blue Anodized CNC Bell)
      const motorGeom = new THREE.CylinderGeometry(7, 7, 12, 24);
      const motorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.95, roughness: 0.2 });
      const motor = new THREE.Mesh(motorGeom, motorMat);
      motor.position.set(x, 13, z);
      motor.userData = { partName: `2207 1950KV Brushless Motor #${i + 1}`, materialName: '7075-T6 CNC Aluminum & Neodymium' };
      group.add(motor);

      // Aerodynamic 5-inch 3-Blade Propeller (Tri-blade with aerofoil camber)
      const propGroup = new THREE.Group();
      propGroup.position.set(x, 19.5, z);

      for (let b = 0; b < 3; b++) {
        const bladeAngle = (b * 2 * Math.PI) / 3;
        const bladeGeom = new THREE.BoxGeometry(26, 0.9, 5.5);
        const bladeMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.85,
          metalness: 0.3,
          roughness: 0.2
        });
        const blade = new THREE.Mesh(bladeGeom, bladeMat);
        blade.position.set(13 * Math.cos(bladeAngle), 0, 13 * Math.sin(bladeAngle));
        blade.rotation.y = -bladeAngle;
        blade.rotation.z = 0.18; // Pitch angle camber
        propGroup.add(blade);
      }
      propGroup.userData = { partName: `5045 Tri-Blade Aerodynamic Propeller #${i + 1}`, materialName: 'Polycarbonate Composite' };
      group.add(propGroup);
      this.propellerMeshes.push(propGroup);
    }

    // LiPo 6S 1400mAh Battery Pack on Top
    const lipoGeom = new THREE.BoxGeometry(36, 32, 75);
    const lipoMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.5 });
    const lipo = new THREE.Mesh(lipoGeom, lipoMat);
    lipo.position.set(0, 34, -5);
    lipo.userData = { partName: '6S 1400mAh 130C Graphene LiPo Battery', materialName: 'Lithium Polymer Pouch Cells', basePosY: 34, explodeY: 65 };
    group.add(lipo);
    explodedParts.push(lipo);

    // FPV Camera & Mount Bracket
    const camGeom = new THREE.BoxGeometry(19, 19, 20);
    const camMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9 });
    const fpvCam = new THREE.Mesh(camGeom, camMat);
    fpvCam.position.set(0, 18, 48);
    fpvCam.rotation.x = -0.35; // 20 deg camera uptilt
    fpvCam.userData = { partName: '1200TVL Low-Latency FPV Camera (20° Uptilt)', materialName: 'Magnesium Alloy Enclosure', basePosY: 18, explodeY: 35 };
    group.add(fpvCam);
    explodedParts.push(fpvCam);

    // CFD Streamline Particles
    this.createCfdStreamlines(group);

    // Explode Dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach(p => {
        p.position.y = p.userData.basePosY + (p.userData.explodeY - p.userData.basePosY) * factor;
      });
    };

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(4620, 'Aerodynamic Airframe Assembly (CATIA / Fusion 360)');
  }

  createCfdStreamlines(parentGroup) {
    const particleCount = 200;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 240;
      positions[i * 3 + 1] = Math.random() * 60 + 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 240;

      // Color from cyan (inflow) to blue/purple (downwash vortex)
      colors[i * 3] = 0.22;
      colors[i * 3 + 1] = 0.74;
      colors[i * 3 + 2] = 0.97;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.75
    });

    this.streamlineParticles = new THREE.Points(geom, mat);
    parentGroup.add(this.streamlineParticles);
  }

  // =========================================================================
  // 3. Oil & Gas Process: 3D Plant Model & Expansion Loop (AutoCAD Plant / Aveva)
  // =========================================================================

  renderPipingLoop3D(straightLength = 40, loopWidth = 10, pipeDiameter = 6, stressRatio = 0.65) {
    this.clearMesh();
    const group = new THREE.Group();

    // 1. Atmospheric Crude Distillation Column Shell (Tower)
    const towerH = 140;
    const towerR = 18;
    const towerGeom = new THREE.CylinderGeometry(towerR, towerR, towerH, 32);
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.85,
      roughness: 0.35
    });
    const tower = new THREE.Mesh(towerGeom, towerMat);
    tower.position.set(-60, towerH / 2 - 25, -25);
    tower.userData = { partName: 'Atmospheric Crude Fractionation Column (30 Trays)', materialName: 'ASTM A516 Gr. 70 Carbon Steel' };
    group.add(tower);

    // Tower Hemispherical Top & Bottom Heads
    const headGeom = new THREE.SphereGeometry(towerR, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const topHead = new THREE.Mesh(headGeom, towerMat);
    topHead.position.set(-60, towerH - 25, -25);
    group.add(topHead);

    // Column Circumferential Stiffener Rings & Platforms
    for (let h = 0; h < towerH; h += 25) {
      const ringGeom = new THREE.TorusGeometry(towerR + 1.2, 0.8, 8, 32);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-60, h - 20, -25);
      group.add(ring);
    }

    // 2. High-Pressure 3D ASME B31.3 Piping with Expansion U-Loop
    const path = new THREE.CurvePath();
    const halfL = straightLength / 2;
    const loopH = loopWidth * 1.3;

    path.add(new THREE.LineCurve3(new THREE.Vector3(-halfL, 0, 0), new THREE.Vector3(-loopWidth / 2, 0, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, 0, 0), new THREE.Vector3(-loopWidth / 2, loopH, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, loopH, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, 0, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, 0, 0), new THREE.Vector3(halfL, 0, 0)));

    const tubeGeom = new THREE.TubeGeometry(path, 80, pipeDiameter / 2, 20, false);
    
    // Color-code pipe by stress ratio: Blue (low stress) -> Green -> Yellow -> Red (overstressed)
    let pipeColor = 0x0284c7; // Normal safe blue
    if (stressRatio > 1.0) pipeColor = 0xef4444; // Code violation red!
    else if (stressRatio > 0.8) pipeColor = 0xf59e0b; // High stress warning yellow

    const tubeMat = new THREE.MeshStandardMaterial({
      color: pipeColor,
      metalness: 0.8,
      roughness: 0.25
    });
    const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
    tubeMesh.userData = { partName: '8" Schedule 40 ASME B31.3 Process Pipeline', materialName: 'ASTM A106 Grade B Carbon Steel' };
    group.add(tubeMesh);

    // 3. Heavy ANSI 300# Flanged Connections & Control Valves
    const flangeGeom = new THREE.CylinderGeometry(pipeDiameter * 0.95, pipeDiameter * 0.95, 3.2, 24);
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9 });
    
    [-halfL, halfL].forEach(posX => {
      const fl = new THREE.Mesh(flangeGeom, flangeMat);
      fl.rotation.z = Math.PI / 2;
      fl.position.set(posX, 0, 0);
      fl.userData = { partName: 'Class 300 Raised-Face Weld Neck Flange', materialName: 'ASTM A105 Forged Steel' };
      group.add(fl);
    });

    // Control Valve Body at inlet
    const valveGeom = new THREE.SphereGeometry(pipeDiameter * 0.85, 16, 16);
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.7 });
    const valve = new THREE.Mesh(valveGeom, valveMat);
    valve.position.set(-halfL + 6, 0, 0);
    valve.userData = { partName: 'Pneumatic Diaphragm Globe Control Valve (FCV-101)', materialName: 'WCB Cast Steel' };
    group.add(valve);

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(5180, 'Process Plant & Piping Infrastructure (AutoCAD Plant 3D / Caesar II)');
  }

  // =========================================================================
  // 4. Structural FEA von Mises Stress Colormap (Ansys Mechanical)
  // =========================================================================

  renderFEAStressHeatmap(stressLevel = 'normal', maxStressVal = 145) {
    this.clearMesh();
    const group = new THREE.Group();

    // Create discretized phone chassis mesh with vertex colors representing von Mises stress
    const geom = new THREE.BoxGeometry(75, 8.2, 160, 24, 6, 48);
    const count = geom.attributes.position.count;
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const z = geom.attributes.position.getZ(i);
      const y = geom.attributes.position.getY(i);
      const x = geom.attributes.position.getX(i);

      // High stress concentrated at impact corner
      const distFromCorner = Math.sqrt((z - 80)**2 + (y + 4.1)**2 + (x - 37.5)**2);
      const normalizedStress = Math.max(0, 1.0 - distFromCorner / 85.0);

      // Rainbow / Turbo Colormap: Blue (0) -> Cyan (0.25) -> Green (0.5) -> Yellow (0.75) -> Red (1.0)
      let r = 0, g = 0, b = 0;
      if (normalizedStress < 0.25) {
        r = 0; g = normalizedStress * 4; b = 1;
      } else if (normalizedStress < 0.5) {
        r = 0; g = 1; b = 1 - (normalizedStress - 0.25) * 4;
      } else if (normalizedStress < 0.75) {
        r = (normalizedStress - 0.5) * 4; g = 1; b = 0;
      } else {
        r = 1; g = 1 - (normalizedStress - 0.75) * 4; b = 0;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.4
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { partName: 'Discretized 3D FEA Volume Mesh', materialName: 'Titanium Grade 5' };
    group.add(mesh);

    // Subtle element edge wireframe overlay
    const wireGeom = new THREE.WireframeGeometry(geom);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.25 });
    group.add(new THREE.LineSegments(wireGeom, wireMat));

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(count * 2, `Explicit FEA von Mises Stress (Peak: ${maxStressVal} MPa)`);
  }

  setViewportStats(triangles, statusText) {
    const statsEl = document.getElementById('viewport-stats');
    if (statsEl) {
      const text = `Triangles: ${triangles.toLocaleString()} | 60 FPS | ${statusText}`;
      statsEl.innerHTML = text;
      statsEl.dataset.defaultStats = text;
    }
  }
}

window.Viewport3D = Viewport3D;
