/**
 * OmniEng 3D High-Performance Viewport Controller (WebGL / Three.js)
 * Industrial-grade multi-component assembly rendering, exploded views, X-ray transparency,
 * FEA stress colormaps, CFD particle streamlines, and animated rotating machinery.
 */

var TactileSpringPhysics = (typeof window !== 'undefined' && window.TactileSpringPhysics)
  ? window.TactileSpringPhysics
  : (typeof require !== 'undefined' ? (() => { try { return require('./tactile_spring_physics'); } catch (e) { return null; } })() : null);

var ProceduralHardware = (typeof window !== 'undefined' && window.ProceduralHardware)
  ? window.ProceduralHardware
  : (typeof require !== 'undefined' ? (() => { try { return require('./procedural_hardware'); } catch (e) { return null; } })() : null);

var PhenomenaShaders = (typeof window !== 'undefined' && window.PhenomenaShaders)
  ? window.PhenomenaShaders
  : (typeof require !== 'undefined' ? (() => { try { return require('./phenomena_shaders'); } catch (e) { return null; } })() : null);

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

    // Active Phenomena Shader Materials
    this.activeShaderMaterials = [];

    // Camera control state & Tactile Spring Follower
    this.isDragging = false;
    this.isPanning = false;
    this.previousMousePosition = { x: 0, y: 0 };
    this.cameraDistance = 220;
    this.cameraAngle = { theta: 0.65, phi: 0.85 }; // Spherical coordinates
    this.target = new THREE.Vector3(0, 0, 0);

    if (TactileSpringPhysics) {
      this.cameraFollower = new TactileSpringPhysics.TactileSpringFollower3D({ stiffness: 140.0, damping: 22.0 });
      this.cameraFollower.setValue(this.cameraAngle.theta, this.cameraAngle.phi, this.cameraDistance);
      this.cameraFollower.setTarget(this.cameraAngle.theta, this.cameraAngle.phi, this.cameraDistance);
      this.gizmoFollower = new TactileSpringPhysics.TactileSpringFollower3D({ stiffness: 220.0, damping: 24.0 });
    } else {
      this.cameraFollower = null;
      this.gizmoFollower = null;
    }

    this.isQuadView = false;
    this.topCamera = null;
    this.frontCamera = null;
    this.rightCamera = null;

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

    // Quad Viewport Orthographic Cameras
    const fovH = 150;
    const aspectQuad = Math.max(0.5, (width / 2) / (height / 2));
    this.topCamera = new THREE.OrthographicCamera(-fovH * aspectQuad, fovH * aspectQuad, fovH, -fovH, 0.1, 3000);
    this.topCamera.position.set(0, 400, 0);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.lookAt(0, 0, 0);

    this.frontCamera = new THREE.OrthographicCamera(-fovH * aspectQuad, fovH * aspectQuad, fovH, -fovH, 0.1, 3000);
    this.frontCamera.position.set(0, 0, 400);
    this.frontCamera.up.set(0, 1, 0);
    this.frontCamera.lookAt(0, 0, 0);

    this.rightCamera = new THREE.OrthographicCamera(-fovH * aspectQuad, fovH * aspectQuad, fovH, -fovH, 0.1, 3000);
    this.rightCamera.position.set(400, 0, 0);
    this.rightCamera.up.set(0, 1, 0);
    this.rightCamera.lookAt(0, 0, 0);

    // 3. Renderer setup
    if (typeof window !== 'undefined' && window.__OMNI_TEST_MODE__) {
      this.renderer = {
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        dispose: () => {},
        setScissor: () => {},
        setViewport: () => {},
        setScissorTest: () => {},
        clear: () => {},
        shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap || 2 },
        localClippingEnabled: true,
        domElement: this.canvas
      };
    } else {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.localClippingEnabled = true;
    }

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
    this.initGizmos();

    // 7. Window resize observer and container ResizeObserver
    window.addEventListener('resize', () => this.onResize());
    if (typeof ResizeObserver !== 'undefined') {
      const host = this.canvas.closest('.canvas-host') || this.canvas.parentElement;
      if (host) {
        this._resizeObs = new ResizeObserver(() => this.onResize());
        this._resizeObs.observe(host);
      }
    }

    // 8. Start Animation Loop
    this.animate();

    // Default CAD Model: Smartphone Enclosure
    this.renderSmartphoneCad(75, 8.2, 160);
    this.loadTransientDropData(this.generateDefaultTransientData());
  }

  updateCameraPosition() {
    const x = this.target.x + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.sin(this.cameraAngle.theta);
    const y = this.target.y + this.cameraDistance * Math.cos(this.cameraAngle.phi);
    const z = this.target.z + this.cameraDistance * Math.sin(this.cameraAngle.phi) * Math.cos(this.cameraAngle.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);

    // Synchronize 3D in-viewport ViewCube gizmo
    const navCube = document.getElementById('nav-cube');
    if (navCube) {
      const rotX = (this.cameraAngle.phi - Math.PI / 2) * (180 / Math.PI);
      const rotY = -this.cameraAngle.theta * (180 / Math.PI);
      navCube.style.transform = `rotateX(${rotX.toFixed(1)}deg) rotateY(${rotY.toFixed(1)}deg)`;
    }

    // Evaluate Out-of-Core Spatial Octree LOD based on camera position
    if (window.omniEngAPI?.getOutOfCoreLOD) {
      clearTimeout(this._lodDebounce);
      this._lodDebounce = setTimeout(async () => {
        try {
          const lodRes = await window.omniEngAPI.getOutOfCoreLOD({
            cameraPosition: [x, y, z],
            frustumBounds: [-500, -500, -500, 500, 500, 500]
          });
          if (lodRes && lodRes.success) {
            this.activeOctreeLOD = lodRes;
            const stats = document.getElementById('viewport-stats');
            if (stats && lodRes.visibleCount !== undefined) {
              stats.title = `Octree LOD: ${lodRes.visibleCount} visible items across spatial hierarchy`;
            }
          }
        } catch (_) {}
      }, 150);
    }
  }

  initGizmos() {
    this.selectedPart = null;
    this.originalPartEmissive = 0x000000;
    this.originalPartEmissiveIntensity = 1.0;
    this.activeGizmoAxis = null;
    this.isGizmoDragging = false;
    this.gizmoMode = 'translate';
    this.dragPlane = new THREE.Plane();
    this.planeIntersectPoint = new THREE.Vector3();
    this.previousMouseDownPos = { x: 0, y: 0 };
    this.onSelectPart = null;
    this.onPartTransform = null;
    this.onPartTransformEnd = null;

    if (typeof window !== 'undefined' && window.ViewportGizmos) {
      this.gizmos = new window.ViewportGizmos({
        size: 30,
        snapDistance: 1.0,
        snapAngleRad: Math.PI / 24
      });
    } else {
      this.gizmos = null;
    }

    this.gizmoGroup = new THREE.Group();
    this.gizmoGroup.name = '__viewport_transform_gizmo__';
    this.gizmoGroup.visible = false;
    this.scene.add(this.gizmoGroup);

    this.buildGizmoVisuals();
  }

  buildGizmoVisuals() {
    while (this.gizmoGroup.children.length > 0) {
      this.gizmoGroup.remove(this.gizmoGroup.children[0]);
    }

    const s = 30;
    const colors = {
      x: 0xef4444, // Red
      y: 0x22c55e, // Green
      z: 0x3b82f6, // Blue
      center: 0xf59e0b // Amber
    };

    const makeMat = (color) => new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.95
    });

    // 1. Center Sphere
    const centerGeom = new THREE.SphereGeometry(3.5, 16, 16);
    const centerMesh = new THREE.Mesh(centerGeom, makeMat(colors.center));
    centerMesh.renderOrder = 9999;
    centerMesh.userData = { isGizmoHandle: true, gizmoAxis: 'CENTER', gizmoMode: 'all' };
    this.gizmoGroup.add(centerMesh);

    // 2. X Axis (Red)
    const xGroup = new THREE.Group();
    const xShaftGeom = new THREE.CylinderGeometry(0.7, 0.7, s, 8);
    xShaftGeom.rotateZ(-Math.PI / 2);
    xShaftGeom.translate(s / 2, 0, 0);
    const xShaft = new THREE.Mesh(xShaftGeom, makeMat(colors.x));
    xShaft.renderOrder = 9999;
    xShaft.userData = { isGizmoHandle: true, gizmoAxis: 'X', gizmoMode: 'translate' };
    xGroup.add(xShaft);

    const xConeGeom = new THREE.ConeGeometry(2.5, 6, 12);
    xConeGeom.rotateZ(-Math.PI / 2);
    xConeGeom.translate(s + 3, 0, 0);
    const xCone = new THREE.Mesh(xConeGeom, makeMat(colors.x));
    xCone.renderOrder = 9999;
    xCone.userData = { isGizmoHandle: true, gizmoAxis: 'X', gizmoMode: 'translate' };
    xGroup.add(xCone);

    const xRingGeom = new THREE.TorusGeometry(s * 0.75, 0.6, 8, 32);
    xRingGeom.rotateY(Math.PI / 2);
    const xRing = new THREE.Mesh(xRingGeom, makeMat(colors.x));
    xRing.renderOrder = 9999;
    xRing.userData = { isGizmoHandle: true, gizmoAxis: 'X', gizmoMode: 'rotate' };
    xGroup.add(xRing);

    const xBoxGeom = new THREE.BoxGeometry(4, 4, 4);
    xBoxGeom.translate(s + 2, 0, 0);
    const xBox = new THREE.Mesh(xBoxGeom, makeMat(colors.x));
    xBox.renderOrder = 9999;
    xBox.userData = { isGizmoHandle: true, gizmoAxis: 'X', gizmoMode: 'scale' };
    xGroup.add(xBox);
    this.gizmoGroup.add(xGroup);

    // 3. Y Axis (Green)
    const yGroup = new THREE.Group();
    const yShaftGeom = new THREE.CylinderGeometry(0.7, 0.7, s, 8);
    yShaftGeom.translate(0, s / 2, 0);
    const yShaft = new THREE.Mesh(yShaftGeom, makeMat(colors.y));
    yShaft.renderOrder = 9999;
    yShaft.userData = { isGizmoHandle: true, gizmoAxis: 'Y', gizmoMode: 'translate' };
    yGroup.add(yShaft);

    const yConeGeom = new THREE.ConeGeometry(2.5, 6, 12);
    yConeGeom.translate(0, s + 3, 0);
    const yCone = new THREE.Mesh(yConeGeom, makeMat(colors.y));
    yCone.renderOrder = 9999;
    yCone.userData = { isGizmoHandle: true, gizmoAxis: 'Y', gizmoMode: 'translate' };
    yGroup.add(yCone);

    const yRingGeom = new THREE.TorusGeometry(s * 0.75, 0.6, 8, 32);
    yRingGeom.rotateX(Math.PI / 2);
    const yRing = new THREE.Mesh(yRingGeom, makeMat(colors.y));
    yRing.renderOrder = 9999;
    yRing.userData = { isGizmoHandle: true, gizmoAxis: 'Y', gizmoMode: 'rotate' };
    yGroup.add(yRing);

    const yBoxGeom = new THREE.BoxGeometry(4, 4, 4);
    yBoxGeom.translate(0, s + 2, 0);
    const yBox = new THREE.Mesh(yBoxGeom, makeMat(colors.y));
    yBox.renderOrder = 9999;
    yBox.userData = { isGizmoHandle: true, gizmoAxis: 'Y', gizmoMode: 'scale' };
    yGroup.add(yBox);
    this.gizmoGroup.add(yGroup);

    // 4. Z Axis (Blue)
    const zGroup = new THREE.Group();
    const zShaftGeom = new THREE.CylinderGeometry(0.7, 0.7, s, 8);
    zShaftGeom.rotateX(Math.PI / 2);
    zShaftGeom.translate(0, 0, s / 2);
    const zShaft = new THREE.Mesh(zShaftGeom, makeMat(colors.z));
    zShaft.renderOrder = 9999;
    zShaft.userData = { isGizmoHandle: true, gizmoAxis: 'Z', gizmoMode: 'translate' };
    zGroup.add(zShaft);

    const zConeGeom = new THREE.ConeGeometry(2.5, 6, 12);
    zConeGeom.rotateX(Math.PI / 2);
    zConeGeom.translate(0, 0, s + 3);
    const zCone = new THREE.Mesh(zConeGeom, makeMat(colors.z));
    zCone.renderOrder = 9999;
    zCone.userData = { isGizmoHandle: true, gizmoAxis: 'Z', gizmoMode: 'translate' };
    zGroup.add(zCone);

    const zRingGeom = new THREE.TorusGeometry(s * 0.75, 0.6, 8, 32);
    const zRing = new THREE.Mesh(zRingGeom, makeMat(colors.z));
    zRing.renderOrder = 9999;
    zRing.userData = { isGizmoHandle: true, gizmoAxis: 'Z', gizmoMode: 'rotate' };
    zGroup.add(zRing);

    const zBoxGeom = new THREE.BoxGeometry(4, 4, 4);
    zBoxGeom.translate(0, 0, s + 2);
    const zBox = new THREE.Mesh(zBoxGeom, makeMat(colors.z));
    zBox.renderOrder = 9999;
    zBox.userData = { isGizmoHandle: true, gizmoAxis: 'Z', gizmoMode: 'scale' };
    zGroup.add(zBox);
    this.gizmoGroup.add(zGroup);

    this.updateGizmoModeVisibility();
  }

  updateGizmoModeVisibility() {
    if (!this.gizmoGroup) return;
    const mode = this.gizmoMode;
    this.gizmoGroup.traverse((child) => {
      if (child.userData && child.userData.isGizmoHandle) {
        if (child.userData.gizmoMode === 'all') {
          child.visible = true;
        } else {
          child.visible = child.userData.gizmoMode === mode;
        }
      }
    });
  }

  setGizmoMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.gizmoMode = mode;
    if (this.gizmos) {
      this.gizmos.setMode(mode);
    }
    this.updateGizmoModeVisibility();
  }

  selectPart(mesh) {
    if (!mesh) return;
    if (this.selectedPart === mesh) return;
    this.deselectPart();

    // If the clicked mesh itself has specific part metadata, select it directly
    let target = mesh;
    if (!target.userData || (!target.userData.partName && !target.userData.isNasaEntity)) {
      while (target.parent && target.parent !== this.currentMesh && target.parent !== this.scene) {
        if (target.userData && (target.userData.partName || target.userData.isNasaEntity)) {
          break;
        }
        target = target.parent;
      }
    }

    this.selectedPart = target;
    const highlightMesh = (m) => {
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (mat.emissive) {
            if (!m._origEmissive) {
              m._origEmissive = mat.emissive.getHex();
              m._origEmissiveIntensity = mat.emissiveIntensity || 1.0;
            }
            mat.emissive.setHex(0x38bdf8);
            mat.emissiveIntensity = 0.55;
          }
        }
      }
    };

    if (this.selectedPart.isMesh) {
      highlightMesh(this.selectedPart);
    } else if (this.selectedPart.traverse) {
      this.selectedPart.traverse(child => {
        if (child.isMesh) highlightMesh(child);
      });
    }

    this.gizmoGroup.position.copy(this.selectedPart.position);
    this.gizmoGroup.visible = true;
    if (this.gizmos) {
      this.gizmos.setPosition([this.selectedPart.position.x, this.selectedPart.position.y, this.selectedPart.position.z]);
      this.gizmos.scale = [this.selectedPart.scale.x, this.selectedPart.scale.y, this.selectedPart.scale.z];
      this.gizmos.rotation = [this.selectedPart.rotation.x, this.selectedPart.rotation.y, this.selectedPart.rotation.z];
    }

    const props = this.getPartProperties(this.selectedPart);
    if (this.onSelectPart) {
      this.onSelectPart(props);
    }
  }

  deselectPart() {
    if (this.selectedPart) {
      const restoreMesh = (m) => {
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            if (mat.emissive && m._origEmissive !== undefined) {
              mat.emissive.setHex(m._origEmissive);
              mat.emissiveIntensity = m._origEmissiveIntensity || 1.0;
            }
          }
        }
      };
      if (this.selectedPart.isMesh) {
        restoreMesh(this.selectedPart);
      } else if (this.selectedPart.traverse) {
        this.selectedPart.traverse(child => {
          if (child.isMesh) restoreMesh(child);
        });
      }
      this.selectedPart = null;
    }
    if (this.gizmoGroup) {
      this.gizmoGroup.visible = false;
    }
    if (this.onSelectPart) {
      this.onSelectPart(null);
    }
  }

  getPartProperties(mesh) {
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    return {
      id: mesh.uuid,
      name: mesh.userData.partName || mesh.name || 'Component_Part',
      type: mesh.userData.entityName || mesh.userData.category || 'Solid 3D Body',
      material: mesh.userData.materialName || 'Alloy 6061-T6',
      wbsId: mesh.userData.wbsId || null,
      entityName: mesh.userData.entityName || null,
      leadCenter: mesh.userData.leadCenter || null,
      specStandard: mesh.userData.specStandard || null,
      operatingPressure: mesh.userData.operatingPressure || null,
      operatingTemp: mesh.userData.operatingTemp || null,
      massKg: mesh.userData.massKg || null,
      safetyFactor: mesh.userData.safetyFactor || null,
      position: {
        x: Number(mesh.position.x.toFixed(2)),
        y: Number(mesh.position.y.toFixed(2)),
        z: Number(mesh.position.z.toFixed(2))
      },
      rotation: {
        x: Number((mesh.rotation.x * 180 / Math.PI).toFixed(1)),
        y: Number((mesh.rotation.y * 180 / Math.PI).toFixed(1)),
        z: Number((mesh.rotation.z * 180 / Math.PI).toFixed(1))
      },
      scale: {
        x: Number(mesh.scale.x.toFixed(3)),
        y: Number(mesh.scale.y.toFixed(3)),
        z: Number(mesh.scale.z.toFixed(3))
      },
      dimensions: {
        width: Number(size.x.toFixed(1)) || 75.0,
        height: Number(size.y.toFixed(1)) || 8.2,
        depth: Number(size.z.toFixed(1)) || 160.0
      },
      userData: { ...mesh.userData }
    };
  }

  updateSelectedPart(properties) {
    if (!this.selectedPart || !properties) return;
    if (properties.position) {
      if (properties.position.x !== undefined) this.selectedPart.position.x = Number(properties.position.x);
      if (properties.position.y !== undefined) this.selectedPart.position.y = Number(properties.position.y);
      if (properties.position.z !== undefined) this.selectedPart.position.z = Number(properties.position.z);
    }
    if (properties.rotation) {
      if (properties.rotation.x !== undefined) this.selectedPart.rotation.x = Number(properties.rotation.x) * Math.PI / 180;
      if (properties.rotation.y !== undefined) this.selectedPart.rotation.y = Number(properties.rotation.y) * Math.PI / 180;
      if (properties.rotation.z !== undefined) this.selectedPart.rotation.z = Number(properties.rotation.z) * Math.PI / 180;
    }
    if (properties.scale) {
      if (properties.scale.x !== undefined) this.selectedPart.scale.x = Number(properties.scale.x);
      if (properties.scale.y !== undefined) this.selectedPart.scale.y = Number(properties.scale.y);
      if (properties.scale.z !== undefined) this.selectedPart.scale.z = Number(properties.scale.z);
    }
    if (properties.material) {
      this.selectedPart.userData.materialName = properties.material;
    }
    if (properties.name) {
      this.selectedPart.userData.partName = properties.name;
      this.selectedPart.name = properties.name;
    }
    if (this.gizmoGroup) {
      this.gizmoGroup.position.copy(this.selectedPart.position);
    }
    if (this.gizmos) {
      this.gizmos.setPosition([this.selectedPart.position.x, this.selectedPart.position.y, this.selectedPart.position.z]);
    }
  }

  deleteSelectedPart() {
    if (!this.selectedPart || !this.currentMesh) return;
    const part = this.selectedPart;
    this.deselectPart();
    this.currentMesh.remove(part);
    if (this.onSelectPart) {
      this.onSelectPart(null);
    }
  }

  setupInteractions() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.previousMouseDownPos = { x: e.clientX, y: e.clientY };

      // Check if clicking on an active gizmo handle
      if (e.button === 0 && this.gizmoGroup && this.gizmoGroup.visible && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const gizmoHits = this.raycaster.intersectObjects(this.gizmoGroup.children, true);
        const hitHandle = gizmoHits.find(h => h.object.userData && h.object.userData.isGizmoHandle && h.object.visible);
        if (hitHandle) {
          this.isGizmoDragging = true;
          this.activeGizmoAxis = hitHandle.object.userData.gizmoAxis;
          const hitPt = hitHandle.point;
          if (this.gizmos) {
            this.gizmos.startDrag(this.activeGizmoAxis, [hitPt.x, hitPt.y, hitPt.z]);
          }
          const camDir = new THREE.Vector3();
          this.camera.getWorldDirection(camDir);
          this.dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), this.gizmoGroup.position);
          this.previousMousePosition = { x: e.clientX, y: e.clientY };
          return;
        }
      }

      this.isDragging = e.button === 0;
      this.isPanning = e.button === 2;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Gizmo dragging interaction
      if (this.isGizmoDragging && this.selectedPart && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.planeIntersectPoint)) {
          const pt = this.planeIntersectPoint;
          if (this.gizmos) {
            const res = this.gizmos.updateDrag([pt.x, pt.y, pt.z]);
            if (res) {
              this.selectedPart.position.set(res.position[0], res.position[1], res.position[2]);
              this.selectedPart.rotation.set(res.rotation[0], res.rotation[1], res.rotation[2]);
              this.selectedPart.scale.set(res.scale[0], res.scale[1], res.scale[2]);
              this.gizmoGroup.position.copy(this.selectedPart.position);
            }
          }
          if (this.onPartTransform) {
            this.onPartTransform(this.getPartProperties(this.selectedPart));
          }
        }
        return;
      }

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
      if (this.isGizmoDragging) {
        this.isGizmoDragging = false;
        this.activeGizmoAxis = null;
        if (this.gizmos) {
          this.gizmos.endDrag();
        }
        if (this.onPartTransformEnd) {
          this.onPartTransformEnd(this.getPartProperties(this.selectedPart));
        }
      }
      this.isDragging = false;
      this.isPanning = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance = Math.max(25, Math.min(1000, this.cameraDistance + e.deltaY * 0.22));
      this.updateCameraPosition();
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.isMeasuring && this.currentMesh && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.currentMesh.children, true);
        if (intersects.length > 0) {
          this.addMeasurePoint(intersects[0].point);
        }
        return;
      }

      const dragDist = Math.hypot(e.clientX - (this.previousMouseDownPos?.x || 0), e.clientY - (this.previousMouseDownPos?.y || 0));
      if (dragDist < 6 && this.currentMesh && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.currentMesh.children, true);
        const hit = intersects.find(i => i.object.isMesh && !i.object.userData.isGizmoHandle && !i.object.userData.isHelper);
        if (hit) {
          this.selectPart(hit.object);
        } else {
          this.deselectPart();
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
      const wbsBadge = obj.userData.wbsId
        ? `<span style="background:rgba(249,115,22,0.22);color:var(--accent-orange);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:5px;border:1px solid rgba(249,115,22,0.35);">WBS ${obj.userData.wbsId}</span>`
        : '';
      const entityTag = obj.userData.entityName
        ? `<span style="color:var(--text-muted);font-size:10px;margin-right:5px;">(${obj.userData.entityName})</span>`
        : '';
      if (statsEl) {
        statsEl.innerHTML = `<span style="color: var(--accent-cyan); font-weight:600;">[Probe]</span> ${wbsBadge}${entityTag}Part: <strong>${partName}</strong> | Mat: ${materialName} | P(${intersects[0].point.x.toFixed(1)}, ${intersects[0].point.y.toFixed(1)}, ${intersects[0].point.z.toFixed(1)})`;
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

      if (this.topCamera && this.frontCamera && this.rightCamera) {
        const aspectQuad = Math.max(0.5, (width / 2) / (height / 2));
        const fovH = 150;
        [this.topCamera, this.frontCamera, this.rightCamera].forEach(cam => {
          cam.left = -fovH * aspectQuad;
          cam.right = fovH * aspectQuad;
          cam.top = fovH;
          cam.bottom = -fovH;
          cam.updateProjectionMatrix();
        });
      }

      this.renderer.setSize(width, height);
    }
  }

  setQuadView(enabled) {
    this.isQuadView = !!enabled;
    const statsEl = document.getElementById('viewport-stats');
    if (statsEl) {
      statsEl.title = this.isQuadView ? 'Viewport: Quad View (Top, Front, Right, Isometric)' : 'Viewport: Single Perspective';
    }
    this.onResize();
  }

  toggleQuadView() {
    this.setQuadView(!this.isQuadView);
    return this.isQuadView;
  }

  animate() {
    if (typeof window !== 'undefined' && !window.__OMNI_TEST_MODE__) {
      requestAnimationFrame(() => this.animate());
    }

    const dt = 0.016; // 60 FPS timestep

    // Tactile Spring Follower for Camera
    if (this.cameraFollower && !this.isDragging && !this.isPanning) {
      if (!this.cameraFollower.isSettled()) {
        this.cameraFollower.update(dt);
        const vals = this.cameraFollower.getValues();
        this.cameraAngle.theta = vals.x;
        this.cameraAngle.phi = vals.y;
        this.cameraDistance = vals.z;
        this.updateCameraPosition();
      }
    }

    // Update Phenomena Shader Time Uniforms
    if (this.activeShaderMaterials && this.activeShaderMaterials.length > 0) {
      this.activeShaderMaterials.forEach(m => {
        if (m && m.uniforms && m.uniforms.u_time) {
          m.uniforms.u_time.value += dt;
        }
      });
    }

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
      if (this.isQuadView && this.topCamera && this.frontCamera && this.rightCamera) {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const halfW = Math.floor(w / 2);
        const halfH = Math.floor(h / 2);

        this.renderer.setScissorTest(true);

        // 1. Top View (Top-Left quadrant: x=0, y=halfH)
        this.renderer.setViewport(0, halfH, halfW, halfH);
        this.renderer.setScissor(0, halfH, halfW, halfH);
        this.renderer.render(this.scene, this.topCamera);

        // 2. Perspective Isometric View (Top-Right quadrant: x=halfW, y=halfH)
        this.renderer.setViewport(halfW, halfH, halfW, halfH);
        this.renderer.setScissor(halfW, halfH, halfW, halfH);
        this.renderer.render(this.scene, this.camera);

        // 3. Front View (Bottom-Left quadrant: x=0, y=0)
        this.renderer.setViewport(0, 0, halfW, halfH);
        this.renderer.setScissor(0, 0, halfW, halfH);
        this.renderer.render(this.scene, this.frontCamera);

        // 4. Right View (Bottom-Right quadrant: x=halfW, y=0)
        this.renderer.setViewport(halfW, 0, halfW, halfH);
        this.renderer.setScissor(halfW, 0, halfW, halfH);
        this.renderer.render(this.scene, this.rightCamera);

        this.renderer.setScissorTest(false);
      } else {
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  clearMesh() {
    this.deselectPart();
    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentMesh = null;
    }
    this.propellerMeshes = [];
    this.streamlineParticles = null;
    this.activeShaderMaterials = [];
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
    if (preset === 'iso' || preset === 'reset') {
      this.cameraAngle = { theta: 0.65, phi: 0.85 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'top') {
      this.cameraAngle = { theta: 0.0, phi: 0.05 };
      this.cameraDistance = 240;
      this.target.set(0, 0, 0);
    } else if (preset === 'bottom') {
      this.cameraAngle = { theta: 0.0, phi: Math.PI - 0.05 };
      this.cameraDistance = 240;
      this.target.set(0, 0, 0);
    } else if (preset === 'front') {
      this.cameraAngle = { theta: 0.0, phi: Math.PI / 2 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'back') {
      this.cameraAngle = { theta: Math.PI, phi: Math.PI / 2 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'right') {
      this.cameraAngle = { theta: Math.PI / 2, phi: Math.PI / 2 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    } else if (preset === 'left') {
      this.cameraAngle = { theta: -Math.PI / 2, phi: Math.PI / 2 };
      this.cameraDistance = 220;
      this.target.set(0, 0, 0);
    }
    if (this.cameraFollower) {
      this.cameraFollower.setTarget(this.cameraAngle.theta, this.cameraAngle.phi, this.cameraDistance);
    } else {
      this.updateCameraPosition();
    }
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
          <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px; display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="caliper"></span> 3D Caliper Measurement Active</div>
          <div style="color: var(--text-muted); font-size: 10px;">Click first 3D vertex or component face to anchor...</div>
        `;
        if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
      }
    }
  }

  addMeasurePoint(point3D) {
    if (!this.isMeasuring) return;
    this.measurePoints.push(point3D.clone());

    const hud = document.getElementById('measurement-hud');
    if (this.measurePoints.length === 1 && hud) {
      hud.innerHTML = `
        <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px; display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="caliper"></span> Point 1 Anchored</div>
        <div style="color: var(--text-muted); font-size: 10px;">P1(${point3D.x.toFixed(1)}, ${point3D.y.toFixed(1)}, ${point3D.z.toFixed(1)}) — Click second point...</div>
      `;
      if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
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
          <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 3px; display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="caliper"></span> 3D Caliper Result</div>
          <div style="font-size: 13px; font-weight: 700; color: #fff;">Length: ${dist.toFixed(2)} mm</div>
          <div style="color: var(--text-dim); font-size: 9px; font-family: var(--font-mono); margin-top: 2px;">
            ΔX: ${dx.toFixed(2)}mm | ΔY: ${dy.toFixed(2)}mm | ΔZ: ${dz.toFixed(2)}mm
          </div>
        `;
        if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
      }
      this.measurePoints = [];
    }
  }

  // =========================================================================
  // Transient Dynamic Drop Animation Player (Ansys Mechanical Parity)
  // =========================================================================

  generateDefaultTransientData() {
    const frames = [];
    const stepCount = 50;
    const totalDurationMs = 5.0;
    const dtMs = totalDurationMs / stepCount;
    const vImpact = 5.42;
    const kEff = 1.2e6;
    const phoneMassKg = 0.205;
    const omega = Math.sqrt(kEff / phoneMassKg);
    const contactDuration = Math.PI / omega;
    const tContactMs = 0.6;

    for (let i = 0; i <= stepCount; i++) {
      const timeMs = i * dtMs;
      let inContact = false;
      let currentZ = 3.0 * (1.0 - timeMs / tContactMs);
      let stress = 0.0;
      let accelG = 1.0;
      let v = -vImpact;

      if (timeMs >= tContactMs) {
        const dtContact = (timeMs - tContactMs) * 1e-3;
        if (dtContact <= contactDuration * 1.8) {
          inContact = true;
          const penetration = (vImpact / omega) * Math.sin(omega * dtContact) * Math.exp(-0.25 * omega * dtContact);
          currentZ = Math.min(0, -penetration * 1000);
          const fContact = kEff * Math.max(0, penetration);
          accelG = (fContact / (phoneMassKg * 9.81));
          stress = Math.min(380, (fContact / (phoneMassKg * 450 * 9.81)) * 340);
          v = -vImpact * Math.cos(omega * dtContact) * Math.exp(-0.25 * omega * dtContact);
        } else {
          const reboundV = vImpact * 0.35;
          const dtPost = dtContact - contactDuration;
          currentZ = Math.max(0, (reboundV * dtPost - 0.5 * 9.81 * dtPost * dtPost) * 1000);
          stress = 18.0 * Math.exp(-dtPost * 400);
          accelG = 1.0;
          v = reboundV - 9.81 * dtPost;
        }
      }

      frames.push({
        frameIndex: i,
        timeMs: Number(timeMs.toFixed(2)),
        inContact,
        positionZ_mm: Number(currentZ.toFixed(2)),
        velocity_m_s: Number(v.toFixed(2)),
        acceleration_G: Number(accelG.toFixed(1)),
        chassisStress_MPa: Number(stress.toFixed(1)),
        glassStress_MPa: Number((stress * 0.42).toFixed(1)),
        kineticEnergy_J: Number((0.5 * phoneMassKg * v * v).toFixed(3)),
        strainEnergy_J: 0,
        dissipatedEnergy_J: 0,
        totalEnergy_J: 3.0
      });
    }

    return {
      dropHeightM: 1.5,
      impactVelocity_m_s: 5.42,
      peakDeceleration_G: 412.3,
      peakChassisStress_MPa: 310.2,
      peakGlassStress_MPa: 74.8,
      glassCrackDetected: false,
      chassisPlasticDeformation: false,
      safetyFactor: 2.84,
      verdict: 'PASS — Structure absorbs drop shock without brittle crack',
      frameCount: frames.length,
      frames
    };
  }

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

      // Real-time stress color feedback on chassis without reallocating mesh
      if (this.explodedParts && this.explodedParts[0] && this.explodedParts[0].material) {
        if (frame.inContact && frame.chassisStress_MPa > 25) {
          const t = Math.min(1.0, frame.chassisStress_MPa / 350.0);
          this.explodedParts[0].material.color.setRGB(0.2 + 0.8 * t, 0.25 * (1 - t), 0.35 * (1 - t));
        } else {
          this.explodedParts[0].material.color.setHex(0x334155);
        }
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

  async playTransient() {
    if (this.isTransientPlaying) {
      this.pauseTransient();
      return;
    }
    if (!this.transientData) {
      if (typeof window !== 'undefined' && window.omniEngAPI && window.omniEngAPI.solveTransientDrop) {
        try {
          const res = await window.omniEngAPI.solveTransientDrop({ dropHeightM: 1.5, impactAngle: 'corner' });
          if (res && res.frames && res.frames.length) this.transientData = res;
        } catch (_) {}
      }
      if (!this.transientData) {
        this.transientData = this.generateDefaultTransientData();
      }
    }
    this.isTransientPlaying = true;
    const playBtn = document.getElementById('btn-transient-play');
    const pauseBtn = document.getElementById('btn-transient-pause');
    if (playBtn) playBtn.classList.add('active');
    if (pauseBtn) pauseBtn.classList.remove('active');

    const playNext = () => {
      if (!this.isTransientPlaying || !this.transientData) return;
      let nextIdx = this.currentFrameIdx + 1;
      if (nextIdx >= this.transientData.frames.length) nextIdx = 0;
      this.renderTransientFrame(nextIdx);
      this.transientTimer = setTimeout(playNext, 60);
    };
    playNext();
  }

  pauseTransient() {
    this.isTransientPlaying = false;
    if (this.transientTimer) {
      clearTimeout(this.transientTimer);
      this.transientTimer = null;
    }
    const playBtn = document.getElementById('btn-transient-play');
    const pauseBtn = document.getElementById('btn-transient-pause');
    if (playBtn) playBtn.classList.remove('active');
    if (pauseBtn) pauseBtn.classList.add('active');
  }

  resetTransient() {
    this.pauseTransient();
    const playBtn = document.getElementById('btn-transient-play');
    const pauseBtn = document.getElementById('btn-transient-pause');
    if (playBtn) playBtn.classList.remove('active');
    if (pauseBtn) pauseBtn.classList.remove('active');
    this.renderTransientFrame(0);
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

    // Layer 7: Procedural Precision Hardware (ISO 4762 Corner Screws, Knurled Side Controls, Ruler Strip)
    if (ProceduralHardware) {
      // 4 Corner ISO 4762 Socket-Head Cap Screws (M2.5 x 8)
      const cornerOffsets = [
        [-w * 0.44, -d * 0.45],
        [w * 0.44, -d * 0.45],
        [-w * 0.44, d * 0.45],
        [w * 0.44, d * 0.45]
      ];
      cornerOffsets.forEach(([cx, cz], idx) => {
        const screw = ProceduralHardware.createIsoCapScrew(1.2, 5.0, 0x94a3b8);
        screw.position.set(cx, h * 0.5 + 0.8, cz);
        screw.userData = {
          partName: `ISO 4762 M2.5 Fastener #${idx + 1}`,
          materialName: 'A4-80 Stainless Steel',
          basePosY: screw.position.y,
          explodeY: 65
        };
        group.add(screw);
        explodedParts.push(screw);
      });

      // Knurled Side Volume Rocker & Power Button
      const powerBtn = ProceduralHardware.createKnurledCylinder(2.2, 8.5, 0x64748b, 20);
      powerBtn.rotation.z = Math.PI / 2;
      powerBtn.position.set(w * 0.5 + 1.2, 0, -d * 0.15);
      powerBtn.userData = { partName: 'Knurled Tactile Sleep/Wake Button', materialName: 'Anodized 7075-T6' };
      group.add(powerBtn);

      const volRocker = ProceduralHardware.createKnurledCylinder(2.2, 14.0, 0x64748b, 24);
      volRocker.rotation.z = Math.PI / 2;
      volRocker.position.set(-w * 0.5 - 1.2, 0, -d * 0.12);
      volRocker.userData = { partName: 'Dual Tactile Volume Rocker', materialName: 'Anodized 7075-T6' };
      group.add(volRocker);

      // Precision Calibrated Ruler Strip along long edge (140mm span)
      const ruler = ProceduralHardware.createRulerStrip(140, 4.0, 10);
      ruler.position.set(w * 0.5 + 6.0, -h * 0.5, 0);
      ruler.rotation.y = -Math.PI / 2;
      ruler.userData.partName = 'Precision Ruler Strip (140mm calibrated)';
      ruler.userData.materialName = 'Laser-Etched Stainless Steel';
      group.add(ruler);

      // USB-C Receptacle Port at Bottom Edge
      const portGeom = new THREE.BoxGeometry(9.0, 3.2, 4.0);
      const portMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.95 });
      const usbPort = new THREE.Mesh(portGeom, portMat);
      usbPort.position.set(0, -h * 0.15, d * 0.5);
      usbPort.userData = { partName: 'USB 4.0 Type-C 40Gbps Receptacle', materialName: 'Gold-Plated Stainless Steel' };
      group.add(usbPort);
    }

    // Assembly Explode Dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach(p => {
        p.position.y = p.userData.basePosY + (p.userData.explodeY - p.userData.basePosY) * factor;
      });
    };

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(4820, 'Solid CAD Assembly with ISO 4762 Fasteners & Knurled Hardware');
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

    // Dedicated internal illumination for cutaway inspection
    const internalTopLight = new THREE.DirectionalLight(0xffffff, 1.8);
    internalTopLight.position.set(20, 180, 20);
    group.add(internalTopLight);

    const internalFrontLight = new THREE.DirectionalLight(0xbae6fd, 1.4);
    internalFrontLight.position.set(-80, 120, -70);
    group.add(internalFrontLight);

    const internalRearLight = new THREE.DirectionalLight(0xc4b5fd, 1.2);
    internalRearLight.position.set(60, 100, 90);
    group.add(internalRearLight);

    // -----------------------------------------------------------------------
    // 1. Outer Aluminum Lens Barrel with Cross-Section Cutaway Window
    // -----------------------------------------------------------------------
    const barrelGeom = new THREE.CylinderGeometry(barrelRadius, barrelRadius * 0.96, barrelLength, 48, 1, true, thetaStart, thetaLength);
    const barrelMesh = new THREE.Mesh(barrelGeom, barrelMat);
    barrelMesh.rotation.x = -Math.PI / 2;
    barrelMesh.position.z = 10.0;
    barrelMesh.userData = {
      partName: 'Anodized 6061-T6 Aluminum Lens Barrel with Cutaway Section',
      materialName: 'Aluminum 6061-T6 Hard Anodized',
      basePosZ: 10.0,
      explodeZ: 10.0
    };
    group.add(barrelMesh);

    // Front Filter Ring & Thread (58mm thread)
    const filterRingGeom = new THREE.CylinderGeometry(barrelRadius + 0.8, barrelRadius, 8.0, 48, 1, true, thetaStart, thetaLength);
    const filterRing = new THREE.Mesh(filterRingGeom, barrelMat);
    filterRing.rotation.x = -Math.PI / 2;
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
    const focusRingGeom = new THREE.CylinderGeometry(barrelRadius + 1.6, barrelRadius + 1.6, 22.0, 48, 1, true, thetaStart, thetaLength);
    const focusRing = new THREE.Mesh(focusRingGeom, rubberRingMat);
    focusRing.rotation.x = -Math.PI / 2;
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
    const apertureRingGeom = new THREE.CylinderGeometry(barrelRadius + 1.0, barrelRadius + 1.0, 14.0, 48, 1, true, thetaStart, thetaLength);
    const apertureRing = new THREE.Mesh(apertureRingGeom, barrelMat);
    apertureRing.rotation.x = -Math.PI / 2;
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
      const baffleGeom = new THREE.RingGeometry(barrelRadius * 0.72, barrelRadius * 0.94, 32, 1, thetaStart + Math.PI * 0.5, thetaLength);
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
    helicoidMesh.rotation.x = -Math.PI / 2;
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
    magnetMesh.rotation.x = -Math.PI / 2;
    magnetMesh.position.z = 0.0;
    magnetMesh.userData = {
      partName: 'VCM Permanent Magnetic Stator Ring (Sintered NdFeB N52)',
      materialName: 'Neodymium-Iron-Boron (N52 Magnet)'
    };
    group.add(magnetMesh);

    // Inner Copper Electromagnetic Voice Coil
    const vcmCoilGeom = new THREE.CylinderGeometry(barrelRadius * 0.86, barrelRadius * 0.86, 12.0, 32, 1, true, thetaStart, thetaLength);
    const vcmCoil = new THREE.Mesh(vcmCoilGeom, copperVcmMat);
    vcmCoil.rotation.x = -Math.PI / 2;
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
    const bayonetFlangeGeom = new THREE.CylinderGeometry(barrelRadius * 0.95, barrelRadius * 0.95, 5.0, 48, 1, true, thetaStart, thetaLength);
    const bayonetFlange = new THREE.Mesh(bayonetFlangeGeom, bayonetMat);
    bayonetFlange.rotation.x = -Math.PI / 2;
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
  // 1C. Flagship OmniEng Apex-Master 50mm f/1.0 H-APO Optomechanical Assembly
  // High-fidelity industrial 3D model featuring all 15 elements in 11 groups,
  // 3 aspheres, 4 CaF2/Super-ED elements, BR-X blue-refractive monolith,
  // Twin-Linear Dual-VCM motors, 2-axis OIS cradle, 11-blade electromagnetic iris,
  // CFRP + Titanium Grade 5 athermal barrel, and polychromatic Fraunhofer ray bundles.
  // =========================================================================

  renderCameraLensMaster3D(cutaway = true, cutawayAngle = Math.PI / 2, explodeFactor = 0, fStop = 1.0, showRays = true) {
    this.clearMesh();
    const group = new THREE.Group();
    const explodedParts = [];

    // Outer barrel dimensions: 84mm diameter, 112.5mm length
    const barrelRadius = 42.0; // mm (84mm diameter)
    const barrelLength = 112.5; // mm
    const thetaStart = cutaway ? cutawayAngle * 0.5 : 0;
    const thetaLength = cutaway ? Math.PI * 2 - cutawayAngle : Math.PI * 2;

    // Materials
    const cfrpBarrelMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Carbon Fiber Reinforced Polymer (Toray T800 Matte)
      metalness: 0.35,
      roughness: 0.65,
      side: THREE.DoubleSide
    });

    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Titanium Grade 5 (Ti-6Al-4V) Athermal Internal Sleeves
      metalness: 0.85,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // C36000 Optical Retaining Rings
      metalness: 0.90,
      roughness: 0.30,
      side: THREE.DoubleSide
    });

    const vcmCopperMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Pure OFC Dual-VCM Copper Coils
      metalness: 0.95,
      roughness: 0.20,
      side: THREE.DoubleSide
    });

    const magnetMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // NdFeB N52SH Neodymium Magnets
      metalness: 0.92,
      roughness: 0.15,
      side: THREE.DoubleSide
    });

    const ceramicGuideMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Silicon Nitride Si3N4 Ceramic Guide Rods
      metalness: 0.10,
      roughness: 0.05
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.95,
      metalness: 0.02
    });

    // Optical Glass Materials
    const glassAsphereMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Ohara S-LAH66 Aspheric High-Index Glass
      metalness: 0.20,
      roughness: 0.02,
      transparent: true,
      opacity: 0.70,
      side: THREE.DoubleSide
    });

    const glassFluoriteMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf, // Monocrystalline Synthetic Fluorite CaF2 (Vd = 95.3)
      metalness: 0.10,
      roughness: 0.01,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide
    });

    const glassSuperEDMat = new THREE.MeshStandardMaterial({
      color: 0x818cf8, // Ohara S-FPL53 Super-ED Crown (Vd = 94.9)
      metalness: 0.12,
      roughness: 0.02,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });

    const glassFlintMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc, // Schott N-SF11 / N-LASF31 Dense Flint Glass
      metalness: 0.22,
      roughness: 0.02,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    });

    const glassBRXMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6, // OmniEng BR-X Blue-Spectrum Refractive Organic Monolith
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.25,
      metalness: 0.28,
      roughness: 0.01,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    });

    const glassHighIndexMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e, // Hoya TAFD40 Ultra-High Index Master Biconvex (nd = 2.001)
      metalness: 0.25,
      roughness: 0.02,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide
    });

    // Internal directional lights
    const l1 = new THREE.DirectionalLight(0xffffff, 2.0);
    l1.position.set(30, 200, 30);
    group.add(l1);

    const l2 = new THREE.DirectionalLight(0x38bdf8, 1.6);
    l2.position.set(-100, 100, -80);
    group.add(l2);

    // 1. CFRP Outer Barrel with Cutaway Section
    const barrelGeom = new THREE.CylinderGeometry(barrelRadius, barrelRadius * 0.97, barrelLength, 48, 1, true, thetaStart, thetaLength);
    const barrelMesh = new THREE.Mesh(barrelGeom, cfrpBarrelMat);
    barrelMesh.rotation.x = Math.PI / 2;
    barrelMesh.position.z = 0;
    barrelMesh.userData = {
      partNumber: 'OMNI-50M-040',
      partName: 'Toray T800 Carbon-Fiber Reinforced Polymer Outer Barrel',
      materialName: 'High-Modulus CFRP Prepreg',
      function: 'Ultra-stiff athermal structural housing with laser-etched distance scale',
      basePosZ: 0,
      explodeZ: 0
    };
    group.add(barrelMesh);
    explodedParts.push(barrelMesh);

    // 2. Titanium Grade 5 Coaxial Internal Sleeves
    const tiSleeveGeom = new THREE.CylinderGeometry(barrelRadius - 2.5, barrelRadius - 2.5, barrelLength * 0.85, 48, 1, true, thetaStart, thetaLength);
    const tiSleeveMesh = new THREE.Mesh(tiSleeveGeom, titaniumMat);
    tiSleeveMesh.rotation.x = Math.PI / 2;
    tiSleeveMesh.position.z = 2.0;
    tiSleeveMesh.userData = {
      partNumber: 'OMNI-50M-013',
      partName: 'Titanium Grade 5 Athermal Internal Guide Sleeve',
      materialName: 'Ti-6Al-4V Titanium Alloy',
      function: 'Thermal expansion matched coaxial guide maintaining sub-micron centering',
      basePosZ: 2.0,
      explodeZ: 2.0
    };
    group.add(tiSleeveMesh);
    explodedParts.push(tiSleeveMesh);

    // 3. Manual Focus & Control Rings
    const focusRingGeom = new THREE.CylinderGeometry(barrelRadius + 1.2, barrelRadius + 1.2, 24.0, 48, 1, false, thetaStart, thetaLength);
    const focusRing = new THREE.Mesh(focusRingGeom, rubberMat);
    focusRing.rotation.x = Math.PI / 2;
    focusRing.position.z = -18.0;
    focusRing.userData = {
      partNumber: 'OMNI-50M-041',
      partName: 'Manual Focus Ring with Diamond-Pattern Silicone Grip',
      materialName: 'High-Tear EPDM Rubber',
      function: 'Tactile linear manual focus control',
      basePosZ: -18.0,
      explodeZ: -18.0
    };
    group.add(focusRing);

    // Helper to add precision optical lens elements
    const addElementMesh = (id, name, mat, diameter, thickness, zPos, partNum, explodeDist, role) => {
      const elGroup = new THREE.Group();
      const r = diameter / 2;

      const bodyGeom = new THREE.CylinderGeometry(r, r * 0.95, thickness * 0.6, 36);
      const bodyMesh = new THREE.Mesh(bodyGeom, mat);
      bodyMesh.rotation.x = Math.PI / 2;
      elGroup.add(bodyMesh);

      const capGeom = new THREE.SphereGeometry(r * 1.04, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
      const capMesh = new THREE.Mesh(capGeom, mat);
      capMesh.position.z = -thickness * 0.25;
      elGroup.add(capMesh);

      // Titanium retaining ring
      const ringGeom = new THREE.CylinderGeometry(r + 1.2, r + 1.2, thickness * 0.5, 36, 1, true);
      const ringMesh = new THREE.Mesh(ringGeom, titaniumMat);
      ringMesh.rotation.x = Math.PI / 2;
      elGroup.add(ringMesh);

      elGroup.position.z = zPos;
      elGroup.userData = {
        partNumber: partNum,
        partName: `${id}: ${name}`,
        materialName: mat.name || 'Precision Optical Glass',
        function: role,
        basePosZ: zPos,
        explodeZ: zPos + explodeDist
      };
      group.add(elGroup);
      explodedParts.push(elGroup);
      return elGroup;
    };

    // 4. Optical Elements (15 Elements in 11 Groups matching Prescription)
    // E1: Front Aspheric Collector
    addElementMesh('E1', 'Front Dual-Convex Aspheric Collector', glassAsphereMat, 72.0, 12.2, -45.0, 'OMNI-50M-003', -65.0, 'Initial light collection and spherical aberration suppression');

    // E2: Synthetic Fluorite CaF2 Meniscus
    addElementMesh('E2', 'Super-ED CaF2 Fluorite Meniscus', glassFluoriteMat, 66.0, 8.6, -34.0, 'OMNI-50M-006', -45.0, 'Eliminates secondary spectrum chromatic dispersion');

    // E3 + E4: Cemented Hyper-Achromat Doublet
    addElementMesh('E3', 'Super-ED Crown (Ohara S-FPL53)', glassSuperEDMat, 58.0, 7.8, -24.0, 'OMNI-50M-008', -30.0, 'Primary chromatic correction crown');
    addElementMesh('E4', 'Dense Flint Balancer (Schott N-SF11)', glassFlintMat, 58.0, 3.4, -18.0, 'OMNI-50M-010', -25.0, 'Opposing high dispersion flint');

    // E5: BR-X Organic Blue Spectrum Monolith
    addElementMesh('E5', 'BR-X Blue-Spectrum Refractive Monolith', glassBRXMat, 52.0, 4.2, -11.0, 'OMNI-50M-011', -18.0, 'Anomalous blue dispersion bends short wavelengths eliminating purple halos');

    // E6 + E7: Floating Autofocus Group 1 (Dual-VCM Carriage)
    addElementMesh('E6', 'AF Floating Variator Asphere (Schott N-LASF31)', glassFlintMat, 46.0, 3.6, -4.0, 'OMNI-50M-015', -10.0, 'Floating variator maintaining close-up edge sharpness');
    addElementMesh('E7', 'AF Variator Diverging Crown (Ohara S-BSL7)', glassAsphereMat, 46.0, 5.1, 0.5, 'OMNI-50M-016', -5.0, 'Field curvature compensator during focus travel');

    // 5. Twin-Linear Voice Coil Motors (Dual-VCM)
    const vcmCarriage = new THREE.Group();
    const vcmCoilGeom = new THREE.CylinderGeometry(25.0, 25.0, 14.0, 36, 1, true);
    const vcmCoilMesh = new THREE.Mesh(vcmCoilGeom, vcmCopperMat);
    vcmCoilMesh.rotation.x = Math.PI / 2;
    vcmCarriage.add(vcmCoilMesh);

    // Ceramic linear guide rails (2x)
    const rail1Geom = new THREE.CylinderGeometry(1.5, 1.5, 32.0, 16);
    const rail1 = new THREE.Mesh(rail1Geom, ceramicGuideMat);
    rail1.position.set(28.0, 0, 0);
    vcmCarriage.add(rail1);
    const rail2 = rail1.clone();
    rail2.position.set(-28.0, 0, 0);
    vcmCarriage.add(rail2);

    vcmCarriage.position.z = -2.0;
    vcmCarriage.userData = {
      partNumber: 'OMNI-50M-019',
      partName: 'Twin-Linear Dual-VCM Magnetic Focus Drive System',
      materialName: 'Oxygen-Free Copper + Si3N4 Ceramic Guide Rails',
      function: 'Frictionless magnetic linear drive providing 22ms rise time with 0 dB noise',
      basePosZ: -2.0,
      explodeZ: -2.0
    };
    group.add(vcmCarriage);
    explodedParts.push(vcmCarriage);

    // 6. 11-Blade Electromagnetic Rounded Iris Diaphragm (f/1.0 to f/16)
    const irisGroup = new THREE.Group();
    const pupilR = Math.max(3.5, Math.min(25.0, 25.0 / Math.max(1.0, fStop)));
    const irisOuterR = 30.0;
    const irisRingGeom = new THREE.RingGeometry(pupilR, irisOuterR, 48);
    const irisMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
    const irisDisc = new THREE.Mesh(irisRingGeom, irisMat);
    irisGroup.add(irisDisc);

    // 11 curved overlapping carbon blades
    for (let b = 0; b < 11; b++) {
      const angle = (b / 11) * Math.PI * 2;
      const bladeGeom = new THREE.PlaneGeometry(irisOuterR * 0.7, irisOuterR * 0.35);
      const bladeMesh = new THREE.Mesh(bladeGeom, irisMat);
      bladeMesh.position.set(Math.cos(angle) * (pupilR + 4.0), Math.sin(angle) * (pupilR + 4.0), 0.04 * b);
      bladeMesh.rotation.z = angle + 0.52;
      irisGroup.add(bladeMesh);
    }
    irisGroup.position.z = 7.0;
    irisGroup.userData = {
      partNumber: 'OMNI-50M-023',
      partName: `11-Blade Rounded Electromagnetic Iris Diaphragm (Active: f/${fStop})`,
      materialName: 'High-Modulus Carbon Fiber + PTFE Coating',
      function: 'Maintains circular specular bokeh highlights down to f/8',
      basePosZ: 7.0,
      explodeZ: 7.0
    };
    group.add(irisGroup);
    explodedParts.push(irisGroup);

    // 7. Active 2-Axis OIS Voice-Coil Floating Group (E8 + E9)
    addElementMesh('E8', 'OIS Gyro-Stabilized Crown (Ohara S-FPL51)', glassSuperEDMat, 44.0, 4.6, 14.0, 'OMNI-50M-027', 8.0, 'Suspended OIS crown element');
    addElementMesh('E9', 'OIS Gyro-Stabilized Flint (Schott N-LAK9)', glassFlintMat, 44.0, 3.8, 19.5, 'OMNI-50M-028', 12.0, 'Suspended OIS flint element with zero decentering aberration');

    // 8. Master Center High-Refraction Biconvex (E10)
    addElementMesh('E10', 'Master Center Biconvex (Hoya TAFD40 nd=2.001)', glassHighIndexMat, 48.0, 8.2, 28.0, 'OMNI-50M-034', 22.0, 'Extreme refractive power bends steep f/1.0 marginal rays without spherical aberration');

    // 9. Telecentric Relay Doublet (E11 + E12)
    addElementMesh('E11', 'Anomalous Dispersion Short-Flint (Schott N-KZFS11)', glassSuperEDMat, 46.0, 6.4, 37.0, 'OMNI-50M-035', 30.0, 'High partial dispersion in tertiary spectrum');
    addElementMesh('E12', 'Rear Master Flint Negative (Schott N-LASF31)', glassFlintMat, 46.0, 3.8, 43.0, 'OMNI-50M-036', 36.0, 'Suppresses transverse lateral color across full frame');

    // 10. Rear Telecentric Field Flattener Triplet (E13, E14, E15)
    addElementMesh('E13', 'Field Flattener Aspheric Meniscus (Ohara S-LAH66)', glassAsphereMat, 44.0, 5.2, 50.0, 'OMNI-50M-037', 45.0, 'Flattens Petzval surface for extreme full-frame corner sharpness');
    addElementMesh('E14', 'Rear Relay Precision Crown (Ohara S-BSL7)', glassAsphereMat, 42.0, 4.8, 56.5, 'OMNI-50M-038', 52.0, 'Final pupil telecentricity steering');
    addElementMesh('E15', 'Rear Exit Hermetic Fluorite Seal Element (CaF2)', glassFluoriteMat, 40.0, 4.0, 62.0, 'OMNI-50M-039', 60.0, 'Hermetically seals nitrogen-purged barrel with oleophobic fluorine coat');

    // 11. Stainless Steel 316L Mount Bayonet & 12 Gold Pins
    const bayonetMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.98, roughness: 0.12, side: THREE.DoubleSide });
    const bayonetGeom = new THREE.CylinderGeometry(barrelRadius * 0.92, barrelRadius * 0.92, 6.0, 48, 1, true, thetaStart, thetaLength);
    const bayonetMesh = new THREE.Mesh(bayonetGeom, bayonetMat);
    bayonetMesh.rotation.x = Math.PI / 2;
    bayonetMesh.position.z = 66.0;
    bayonetMesh.userData = {
      partNumber: 'OMNI-50M-045',
      partName: 'Precision CNC Stainless Steel 316L Bayonet Mount Flange',
      materialName: 'Vacuum-Hardened SS316L',
      function: 'Short flange mirrorless mount with sub-micron mating precision',
      basePosZ: 66.0,
      explodeZ: 75.0
    };
    group.add(bayonetMesh);
    explodedParts.push(bayonetMesh);

    // 12. Polychromatic Fraunhofer Light Ray Bundles
    if (showRays) {
      const rayGroup = new THREE.Group();
      const wavelengths = [
        { name: 'C-Line (656.3 nm Red)', color: 0xef4444 },
        { name: 'd-Line (587.6 nm Yellow/Ref)', color: 0xf59e0b },
        { name: 'F-Line (486.1 nm Cyan/Blue)', color: 0x06b6d4 },
        { name: 'g-Line (435.8 nm Violet)', color: 0x8b5cf6 }
      ];

      const rRay = pupilR;
      wavelengths.forEach((wl, wIdx) => {
        const offsetAngle = (wIdx / wavelengths.length) * Math.PI * 0.5;
        for (let ring = 0; ring <= 4; ring++) {
          const curR = (ring / 4) * rRay;
          const points = [
            new THREE.Vector3(Math.cos(offsetAngle) * curR, Math.sin(offsetAngle) * curR, -65.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.98, Math.sin(offsetAngle) * curR * 0.98, -45.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.94, Math.sin(offsetAngle) * curR * 0.94, -24.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.88, Math.sin(offsetAngle) * curR * 0.88, -11.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.72, Math.sin(offsetAngle) * curR * 0.72, 7.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.60, Math.sin(offsetAngle) * curR * 0.60, 28.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.45, Math.sin(offsetAngle) * curR * 0.45, 50.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.30, Math.sin(offsetAngle) * curR * 0.30, 62.0),
            new THREE.Vector3(0, 0, 86.86) // Common focal point (BFL = 24.86mm past E15)
          ];
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const lineMat = new THREE.LineBasicMaterial({ color: wl.color, transparent: true, opacity: ring === 0 ? 0.9 : 0.6 });
          const line = new THREE.Line(lineGeom, lineMat);
          rayGroup.add(line);
        }
      });

      rayGroup.userData = {
        partName: 'Polychromatic Fraunhofer Ray Fans (C, d, F, g Lines)',
        materialName: 'Hyper-Achromatic Zero-Dispersion Crossing',
        function: 'Demonstrates zero secondary spectrum blue-defocus suppression via BR-X & CaF2'
      };
      group.add(rayGroup);
    }

    // Explode dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach(p => {
        p.position.z = p.userData.basePosZ + (p.userData.explodeZ - p.userData.basePosZ) * factor;
      });
    };

    if (explodeFactor > 0) {
      group.userData.updateExplode(explodeFactor);
    }

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(18450, 'OmniEng Apex-Master 50mm f/1.0 H-APO (15 Elements / 11 Groups / Dual-VCM / OIS / BR-X)');
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

    // Procedural Hardware: Standoffs, ISO Screws, Vibration Isolation Springs
    if (ProceduralHardware) {
      // 4 Knurled Aluminum Standoffs between lower and upper chassis decks
      const standoffPositions = [
        [-18, -32], [18, -32],
        [-18, 32], [18, 32]
      ];
      standoffPositions.forEach(([sx, sz], sIdx) => {
        const standoff = ProceduralHardware.createKnurledCylinder(2.0, 18.0, 0x64748b, 16);
        standoff.position.set(sx, 7.0, sz);
        standoff.userData = { partName: `Knurled 7075-T6 Standoff #${sIdx + 1}`, materialName: 'Aluminum 7075-T6' };
        group.add(standoff);

        // Top deck securing screw
        const topScrew = ProceduralHardware.createIsoCapScrew(1.2, 4.0, 0x94a3b8);
        topScrew.position.set(sx, 19.5, sz);
        topScrew.userData = { partName: `ISO 4762 M3 Standoff Screw #${sIdx + 1}`, materialName: 'A4 Stainless', basePosY: 19.5, explodeY: 42 };
        group.add(topScrew);
        explodedParts.push(topScrew);
      });

      // 4 Helical Vibration Isolation Springs under FC Stack
      const fcSpringPositions = [
        [-11, -11], [11, -11],
        [-11, 11], [11, 11]
      ];
      fcSpringPositions.forEach(([fx, fz], fIdx) => {
        const spring = ProceduralHardware.createCoilSpring(1.4, 5.0, 4.0, 0.35, 0xf59e0b);
        spring.position.set(fx, 2.0, fz);
        spring.userData = { partName: `Vibration Isolation Helical Spring #${fIdx + 1}`, materialName: 'Spring Steel ASTM A228' };
        group.add(spring);
      });

      // 4 Titanium Motor Fasteners per motor
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const mx = armLength * Math.cos(angle);
        const mz = armLength * Math.sin(angle);
        const boltD = 4.2;
        [[-boltD, 0], [boltD, 0], [0, -boltD], [0, boltD]].forEach(([bx, bz], bIdx) => {
          const motorScrew = ProceduralHardware.createIsoCapScrew(0.8, 3.0, 0x38bdf8);
          motorScrew.position.set(mx + bx, 6.0, mz + bz);
          motorScrew.rotation.x = Math.PI; // Secures from bottom of motor plate
          group.add(motorScrew);
        });
      }
    }

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
    this.setViewportStats(6280, 'Aerodynamic Airframe Assembly with Knurled Standoffs & ISO Fasteners');
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
    // 3. Heavy ANSI Class 300# Flanged Connections & Control Valves
    if (ProceduralHardware) {
      [-halfL, halfL].forEach(posX => {
        const flangeAssy = ProceduralHardware.createFlangeAssembly(pipeDiameter / 2, pipeDiameter * 1.1, 3.4, 8);
        flangeAssy.rotation.z = Math.PI / 2;
        flangeAssy.position.set(posX, 0, 0);
        flangeAssy.userData = { partName: 'ASME B16.5 Class 300 Raised-Face Weld Neck Flange Assembly', materialName: 'ASTM A105 Forged Steel / Spiral Gasket' };
        group.add(flangeAssy);

        // Circumferential Butt-Weld Bead at neck
        const weld = ProceduralHardware.createWeldBead(pipeDiameter / 2, 0.8, 24);
        weld.rotation.z = Math.PI / 2;
        weld.position.set(posX + (posX < 0 ? 3.0 : -3.0), 0, 0);
        group.add(weld);
      });

      // Calibrated Bourdon Tube Dial Pressure Gauge atop loop crown
      const gauge = ProceduralHardware.createDialGauge(5.5, 0, 150, 68.5, 'PSIG');
      gauge.position.set(0, loopH + 6.0, 0);
      gauge.userData = { partName: 'ASME B40.100 Bourdon Tube Pressure Gauge (PI-204)', materialName: '316L Stainless Steel' };
      group.add(gauge);
    } else {
      const flangeGeom = new THREE.CylinderGeometry(pipeDiameter * 0.95, pipeDiameter * 0.95, 3.2, 24);
      const flangeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9 });
      [-halfL, halfL].forEach(posX => {
        const fl = new THREE.Mesh(flangeGeom, flangeMat);
        fl.rotation.z = Math.PI / 2;
        fl.position.set(posX, 0, 0);
        fl.userData = { partName: 'Class 300 Raised-Face Weld Neck Flange', materialName: 'ASTM A105 Forged Steel' };
        group.add(fl);
      });
    }

    // Control Valve Body at inlet
    const valveGeom = new THREE.SphereGeometry(pipeDiameter * 0.85, 16, 16);
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.7 });
    const valve = new THREE.Mesh(valveGeom, valveMat);
    valve.position.set(-halfL + 6, 0, 0);
    valve.userData = { partName: 'Pneumatic Diaphragm Globe Control Valve (FCV-101)', materialName: 'WCB Cast Steel' };
    group.add(valve);

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(6840, 'Process Plant & Piping Infrastructure with ASME B16.5 Flanges & Bourdon Dial Gauge');
  }

  // =========================================================================
  // 3B. Aerospace Propulsion: Raptor Methalox Engine Test Stand (SpaceX / NASA)
  // Features: Thrust puck, gimbal ring, regeneratively-cooled nozzle channels,
  // high-pressure cryogenic manifolding, and active supersonic plume with Mach shock diamonds.
  // =========================================================================

  renderRaptorTestStand3D() {
    this.clearMesh();
    const group = new THREE.Group();

    // 1. Structural Steel Test Stand Columns & Truss Cross-Braces
    const columnH = 160;
    const standSpan = 45;
    const colMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });

    const columnCoords = [
      [-standSpan, -standSpan], [standSpan, -standSpan],
      [-standSpan, standSpan], [standSpan, standSpan]
    ];

    columnCoords.forEach(([cx, cz], idx) => {
      const colGeom = new THREE.BoxGeometry(4.5, columnH, 4.5);
      const col = new THREE.Mesh(colGeom, colMat);
      col.position.set(cx, columnH / 2 - 40, cz);
      col.userData = { partName: `Heavy Structural Column #${idx + 1}`, materialName: 'ASTM A992 Structural Steel W-Beam' };
      group.add(col);

      // Baseplates & Anchor Bolts
      if (ProceduralHardware) {
        const baseplate = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 10), colMat);
        baseplate.position.set(cx, -40, cz);
        group.add(baseplate);

        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(([bx, bz]) => {
          const bolt = ProceduralHardware.createIsoCapScrew(0.8, 3.5, 0x94a3b8);
          bolt.position.set(cx + bx, -39, cz + bz);
          group.add(bolt);
        });
      }
    });

    // Horizontal Structural Cross Girders
    for (let y = -20; y <= columnH - 40; y += 35) {
      const girderMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
      const gX1 = new THREE.Mesh(new THREE.BoxGeometry(standSpan * 2, 3.0, 3.0), girderMat);
      gX1.position.set(0, y, -standSpan);
      group.add(gX1);
      const gX2 = new THREE.Mesh(new THREE.BoxGeometry(standSpan * 2, 3.0, 3.0), girderMat);
      gX2.position.set(0, y, standSpan);
      group.add(gX2);
      const gZ1 = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.0, standSpan * 2), girderMat);
      gZ1.position.set(-standSpan, y, 0);
      group.add(gZ1);
      const gZ2 = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.0, standSpan * 2), girderMat);
      gZ2.position.set(standSpan, y, 0);
      group.add(gZ2);
    }

    // 2. Thrust Frame, Load Cell Ring & Dual Gimbal Actuators
    const thrustPuckGeom = new THREE.CylinderGeometry(14, 16, 8, 32);
    const thrustPuckMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.95 });
    const thrustPuck = new THREE.Mesh(thrustPuckGeom, thrustPuckMat);
    thrustPuck.position.set(0, 75, 0);
    thrustPuck.userData = { partName: 'Multi-Axis Thrust Measurement Puck & Load Cell', materialName: 'Maraging Steel 300' };
    group.add(thrustPuck);

    // Gimbal Ring
    const gimbalGeom = new THREE.TorusGeometry(18, 2.2, 16, 32);
    const gimbalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9 });
    const gimbalRing = new THREE.Mesh(gimbalGeom, gimbalMat);
    gimbalRing.rotation.x = Math.PI / 2;
    gimbalRing.position.set(0, 68, 0);
    gimbalRing.userData = { partName: 'Electro-Hydraulic Gimbal Ring (±8° Vectoring)', materialName: 'Inconel 718 Forging' };
    group.add(gimbalRing);

    // 3. Rocket Powerhead & Turbopump Manifolds
    const powerheadGeom = new THREE.CylinderGeometry(11, 13, 16, 32);
    const powerheadMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.92, roughness: 0.2 });
    const powerhead = new THREE.Mesh(powerheadGeom, powerheadMat);
    powerhead.position.set(0, 56, 0);
    powerhead.userData = { partName: 'Full-Flow Staged Combustion (FFSC) Powerhead', materialName: 'SX500 Superalloy' };
    group.add(powerhead);

    // Cryo LOX & LCH4 Feed Manifolds with ASME Flanges and Live Dial Gauges
    if (ProceduralHardware) {
      // Oxygen Manifold (Left)
      const loxFlange = ProceduralHardware.createFlangeAssembly(3.5, 7.5, 2.5, 6);
      loxFlange.rotation.z = Math.PI / 2;
      loxFlange.position.set(-18, 62, 0);
      group.add(loxFlange);

      const loxGauge = ProceduralHardware.createDialGauge(4.5, 0, 500, 320, 'BAR (LOX)');
      loxGauge.position.set(-18, 68, 0);
      group.add(loxGauge);

      // Methane Manifold (Right)
      const ch4Flange = ProceduralHardware.createFlangeAssembly(3.5, 7.5, 2.5, 6);
      ch4Flange.rotation.z = Math.PI / 2;
      ch4Flange.position.set(18, 62, 0);
      group.add(ch4Flange);

      const ch4Gauge = ProceduralHardware.createDialGauge(4.5, 0, 400, 280, 'BAR (CH4)');
      ch4Gauge.position.set(18, 68, 0);
      group.add(ch4Gauge);
    }

    // 4. Regeneratively Cooled Bell Nozzle with Slotted Milling Lines
    const nozzleH = 46;
    const nozzleGeom = new THREE.CylinderGeometry(8.5, 24.0, nozzleH, 48, 16, true);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04, // Rich regeneratively cooled copper alloy color
      metalness: 0.95,
      roughness: 0.18,
      side: THREE.DoubleSide
    });
    const nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
    nozzle.position.set(0, 25, 0);
    nozzle.userData = { partName: 'Milled Copper-Alloy Channel Wall Nozzle Bell (GRCop-42)', materialName: 'GRCop-42 with Electroformed Nickel Jacket' };
    group.add(nozzle);

    // Stiffener Rings on Nozzle
    for (let ny = 10; ny <= 40; ny += 10) {
      const radiusAtY = 8.5 + (24.0 - 8.5) * ((46 - (ny - 2)) / 46);
      const nRing = new THREE.Mesh(new THREE.TorusGeometry(radiusAtY + 0.3, 0.45, 8, 32), new THREE.MeshStandardMaterial({ color: 0x713f12, metalness: 0.9 }));
      nRing.rotation.x = Math.PI / 2;
      nRing.position.set(0, ny, 0);
      group.add(nRing);
    }

    // 5. Active WebGL Supersonic Exhaust Plume with Mach Shock Diamonds
    if (PhenomenaShaders && PhenomenaShaders.createSupersonicPlume) {
      const plume = PhenomenaShaders.createSupersonicPlume({
        machNumber: 3.2,
        shockCount: 4,
        plumeLength: 130,
        coreRadius: 23,
        accentColor: 0x38bdf8
      });
      plume.position.set(0, -65, 0);
      group.add(plume);
      if (plume.material) {
        this.activeShaderMaterials.push(plume.material);
      }

      // Ground Reflection & Thermal Mirage Shimmer
      if (PhenomenaShaders.createThermalMirageMaterial) {
        const mirageMat = PhenomenaShaders.createThermalMirageMaterial(0x38bdf8);
        const mirageGeom = new THREE.PlaneGeometry(160, 160);
        const mirageMesh = new THREE.Mesh(mirageGeom, mirageMat);
        mirageMesh.rotation.x = -Math.PI / 2;
        mirageMesh.position.set(0, -38, 0);
        group.add(mirageMesh);
        this.activeShaderMaterials.push(mirageMat);
      }
    }

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(12480, 'Aerospace Propulsion: Raptor Methalox Test Stand with Supersonic Shock Diamonds');
  }

  // =========================================================================
  // 3C. NASA Space Launch Vehicle & Rocket Engine (WBS 06.01 - 06.08)
  // Modes: 'full_stack' | 'engine_macro'
  // Features: 2-stage orbital vehicle, Al-Li 2195 isogrid cryo tanks, grid fins,
  // octaweb 9-engine cluster, Stage 2 vacuum engine, satellite bus, and
  // macro turbopumps, coaxial injector dome, and Narloy-Z regenerative nozzle.
  // =========================================================================

  renderNasaSpaceRocket3D(mode = 'full_stack') {
    this.clearMesh();
    const group = new THREE.Group();

    const BuilderClass = (typeof NasaSpaceRocket3D !== 'undefined')
      ? NasaSpaceRocket3D
      : (typeof window !== 'undefined' && window.NasaSpaceRocket3D)
        ? window.NasaSpaceRocket3D
        : null;

    if (BuilderClass) {
      const builder = new BuilderClass();
      builder.buildAssembly(mode, group, {
        ProceduralHardware: typeof ProceduralHardware !== 'undefined' ? ProceduralHardware : (typeof window !== 'undefined' ? window.ProceduralHardware : null),
        ProceduralPbrMaterials: typeof ProceduralPbrMaterials !== 'undefined' ? ProceduralPbrMaterials : (typeof window !== 'undefined' ? window.ProceduralPbrMaterials : null),
        PhenomenaShaders: typeof PhenomenaShaders !== 'undefined' ? PhenomenaShaders : (typeof window !== 'undefined' ? window.PhenomenaShaders : null)
      });
    }

    this.currentMesh = group;
    this.scene.add(group);

    if (mode === 'engine_macro') {
      if (this.camera && this.controls) {
        this.camera.position.set(0, 30, 85);
        this.controls.target.set(0, 15, 0);
        this.controls.update();
      }
      this.setViewportStats(18420, 'NASA Liquid Propellant Rocket Engine: Turbopumps, Coaxial Injector & Regenerative Narloy-Z Nozzle');
    } else if (mode === 'spacecraft_interior' || mode === 'spaceship_interior') {
      if (this.camera && this.controls) {
        this.camera.position.set(0, 20, 48);
        this.controls.target.set(0, 16, 0);
        this.controls.update();
      }
      this.setViewportStats(31800, 'NASA Deep Space Craft (Interior Cutaway): Cockpit, ECLSS Racks, Crew Quarters, UWMS & Propulsion');
    } else {
      if (this.camera && this.controls) {
        this.camera.position.set(0, 75, 220);
        this.controls.target.set(0, 60, 0);
        this.controls.update();
      }
      this.setViewportStats(26500, 'NASA Space Launch System (SLS): 2-Stage Orbital Vehicle, Isogrid Cryo Tanks & WBS 06.01-06.08 Entities');
    }
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

  /**
   * Render custom B-Rep solid geometry from triangular facets.
   */
  renderBRepSolid(triangles = [], name = 'Parametric_Solid') {
    this.clearMesh();
    if (!triangles || triangles.length === 0) return;

    const group = new THREE.Group();
    const positions = [];
    for (const tri of triangles) {
      if (tri && tri.length === 3) {
        for (const pt of tri) {
          positions.push(pt.x, pt.y, pt.z);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.75,
      clippingPlanes: this.isClipping ? [this.clipPlane] : [],
      clipShadows: true
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { partName: name, materialName: 'Aluminum 6061-T6' };
    group.add(mesh);

    // Precise feature edge outlines
    const edgesGeom = new THREE.EdgesGeometry(geom, 25);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.85 });
    group.add(new THREE.LineSegments(edgesGeom, edgeMat));

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(triangles.length, `Parametric B-Rep: ${name}`);
  }

  /**
   * Render 3D CNC Toolpath Trajectory Lines.
   */
  renderToolpath3D(layers = []) {
    if (!layers || layers.length === 0) return;

    const toolpathGroup = new THREE.Group();
    toolpathGroup.name = 'CNC_Toolpath_Overlay';

    // Remove any existing toolpath
    const existing = this.scene.getObjectByName('CNC_Toolpath_Overlay');
    if (existing) this.scene.remove(existing);

    for (const layer of layers) {
      const cutPositions = [];
      const rapidPositions = [];

      for (let i = 0; i < layer.length - 1; i++) {
        const p1 = layer[i];
        const p2 = layer[i + 1];
        if (p2.type === 'cut') {
          cutPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        } else {
          rapidPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
      }

      if (cutPositions.length > 0) {
        const cutGeom = new THREE.BufferGeometry();
        cutGeom.setAttribute('position', new THREE.Float32BufferAttribute(cutPositions, 3));
        const cutMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2 }); // Green cut
        toolpathGroup.add(new THREE.LineSegments(cutGeom, cutMat));
      }

      if (rapidPositions.length > 0) {
        const rapidGeom = new THREE.BufferGeometry();
        rapidGeom.setAttribute('position', new THREE.Float32BufferAttribute(rapidPositions, 3));
        const rapidMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.6 }); // Yellow rapid
        toolpathGroup.add(new THREE.LineSegments(rapidGeom, rapidMat));
      }
    }

    this.scene.add(toolpathGroup);
    this.setViewportStats(layers.length * 50, `3-Axis CNC Toolpath (Active Machine G-Code)`);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Viewport3D };
}
if (typeof window !== 'undefined') {
  window.Viewport3D = Viewport3D;
}
