/**
 * OmniEng 3D WebGL Viewport Controller (Three.js)
 * experimental multi-component assembly rendering, exploded views, X-ray transparency,
 * Illustrative stress color maps, decorative particle effects, and animated machinery examples.
 */

var TactileSpringPhysics =
  typeof window !== 'undefined' && window.TactileSpringPhysics
    ? window.TactileSpringPhysics
    : typeof require !== 'undefined'
      ? (() => {
          try {
            return require('./tactile_spring_physics');
          } catch (e) {
            return null;
          }
        })()
      : null;

var ProceduralHardware =
  typeof window !== 'undefined' && window.ProceduralHardware
    ? window.ProceduralHardware
    : typeof require !== 'undefined'
      ? (() => {
          try {
            return require('./procedural_hardware');
          } catch (e) {
            return null;
          }
        })()
      : null;

var PhenomenaShaders =
  typeof window !== 'undefined' && window.PhenomenaShaders
    ? window.PhenomenaShaders
    : typeof require !== 'undefined'
      ? (() => {
          try {
            return require('./phenomena_shaders');
          } catch (e) {
            return null;
          }
        })()
      : null;

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
    this.propellerAnimationRate = 1;
    this.propellerMeshes = [];
    this.decorativeFlowParticles = null;

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

    // Transient experimental impact animation; populated only by solver output.
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
    const aspectQuad = Math.max(0.5, width / 2 / (height / 2));
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

    const makeMat = (color) =>
      new THREE.MeshBasicMaterial({
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
      this.selectedPart.traverse((child) => {
        if (child.isMesh) highlightMesh(child);
      });
    }

    this.gizmoGroup.position.copy(this.selectedPart.position);
    this.gizmoGroup.visible = true;
    if (this.gizmos) {
      this.gizmos.setPosition([
        this.selectedPart.position.x,
        this.selectedPart.position.y,
        this.selectedPart.position.z
      ]);
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
        this.selectedPart.traverse((child) => {
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
      material: mesh.userData.materialName || '',
      materialName: mesh.userData.materialName || '',
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
        x: Number(((mesh.rotation.x * 180) / Math.PI).toFixed(1)),
        y: Number(((mesh.rotation.y * 180) / Math.PI).toFixed(1)),
        z: Number(((mesh.rotation.z * 180) / Math.PI).toFixed(1))
      },
      scale: {
        x: Number(mesh.scale.x.toFixed(3)),
        y: Number(mesh.scale.y.toFixed(3)),
        z: Number(mesh.scale.z.toFixed(3))
      },
      dimensions: {
        width: Number(size.x.toFixed(1)),
        height: Number(size.y.toFixed(1)),
        depth: Number(size.z.toFixed(1))
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
      if (properties.rotation.x !== undefined)
        this.selectedPart.rotation.x = (Number(properties.rotation.x) * Math.PI) / 180;
      if (properties.rotation.y !== undefined)
        this.selectedPart.rotation.y = (Number(properties.rotation.y) * Math.PI) / 180;
      if (properties.rotation.z !== undefined)
        this.selectedPart.rotation.z = (Number(properties.rotation.z) * Math.PI) / 180;
    }
    if (properties.scale) {
      if (properties.scale.x !== undefined) this.selectedPart.scale.x = Number(properties.scale.x);
      if (properties.scale.y !== undefined) this.selectedPart.scale.y = Number(properties.scale.y);
      if (properties.scale.z !== undefined) this.selectedPart.scale.z = Number(properties.scale.z);
    }
    const materialLabel = properties.materialName ?? properties.material;
    if (materialLabel !== undefined) {
      this.selectedPart.userData.materialName = String(materialLabel).trim().slice(0, 120);
    }
    if (properties.name) {
      this.selectedPart.userData.partName = properties.name;
      this.selectedPart.name = properties.name;
    }
    if (this.gizmoGroup) {
      this.gizmoGroup.position.copy(this.selectedPart.position);
    }
    if (this.gizmos) {
      this.gizmos.setPosition([
        this.selectedPart.position.x,
        this.selectedPart.position.y,
        this.selectedPart.position.z
      ]);
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
        const hitHandle = gizmoHits.find(
          (h) => h.object.userData && h.object.userData.isGizmoHandle && h.object.visible
        );
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

      const dragDist = Math.hypot(
        e.clientX - (this.previousMouseDownPos?.x || 0),
        e.clientY - (this.previousMouseDownPos?.y || 0)
      );
      if (dragDist < 6 && this.currentMesh && this.camera) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.currentMesh.children, true);
        const hit = intersects.find(
          (i) => i.object.isMesh && !i.object.userData.isGizmoHandle && !i.object.userData.isHelper
        );
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
      if (statsEl) {
        statsEl.replaceChildren();
        const probe = document.createElement('span');
        probe.style.cssText = 'color:var(--accent-cyan);font-weight:600;';
        probe.textContent = '[Probe]';
        statsEl.appendChild(probe);

        if (obj.userData.wbsId !== undefined && obj.userData.wbsId !== null && obj.userData.wbsId !== '') {
          const badge = document.createElement('span');
          badge.style.cssText =
            'background:rgba(249,115,22,0.22);color:var(--accent-orange);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:5px;border:1px solid rgba(249,115,22,0.35);';
          badge.textContent = `WBS ${String(obj.userData.wbsId).slice(0, 200)}`;
          statsEl.appendChild(badge);
        }
        if (
          obj.userData.entityName !== undefined &&
          obj.userData.entityName !== null &&
          obj.userData.entityName !== ''
        ) {
          const entity = document.createElement('span');
          entity.style.cssText = 'color:var(--text-muted);font-size:10px;margin-right:5px;';
          entity.textContent = `(${String(obj.userData.entityName).slice(0, 200)})`;
          statsEl.appendChild(entity);
        }

        const part = document.createElement('strong');
        part.textContent = String(obj.userData.partName || obj.name || 'Component').slice(0, 200);
        statsEl.append(' Part: ', part, ' | Material data unavailable | ');

        const point = intersects[0].point;
        const formatCoordinate = (coordinate) => (Number.isFinite(coordinate) ? coordinate.toFixed(1) : 'unavailable');
        statsEl.appendChild(
          document.createTextNode(
            `P(${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}, ${formatCoordinate(point.z)})`
          )
        );
      }
    } else if (statsEl && statsEl.dataset.defaultStats) {
      statsEl.textContent = statsEl.dataset.defaultStats;
    }
  }

  onResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width && height && this.renderer) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      if (this.topCamera && this.frontCamera && this.rightCamera) {
        const aspectQuad = Math.max(0.5, width / 2 / (height / 2));
        const fovH = 150;
        [this.topCamera, this.frontCamera, this.rightCamera].forEach((cam) => {
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
      statsEl.title = this.isQuadView
        ? 'Viewport: Quad View (Top, Front, Right, Isometric)'
        : 'Viewport: Single Perspective';
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

    const dt = 0.016; // Fixed animation step; this is not measured render cadence.

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
      this.activeShaderMaterials.forEach((m) => {
        if (m && m.uniforms && m.uniforms.u_time) {
          m.uniforms.u_time.value += dt;
        }
      });
    }

    // Spin Propellers if machinery is active
    if (this.isSpinning && this.propellerMeshes.length > 0) {
      const deltaAngle = this.propellerAnimationRate * 0.05;
      this.propellerMeshes.forEach((prop, idx) => {
        prop.rotation.y += (idx % 2 === 0 ? 1 : -1) * deltaAngle;
      });
    }

    // Animate decorative particles if present; this is not a flow solution.
    if (this.decorativeFlowParticles) {
      const positions = this.decorativeFlowParticles.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += 1.8;
        if (positions[i] > 120) {
          positions[i] = -120;
        }
      }
      this.decorativeFlowParticles.geometry.attributes.position.needsUpdate = true;
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
    this.decorativeFlowParticles = null;
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
  // Experimental cross-section clipping helper
  // =========================================================================

  setClippingPlane(enabled, axis = 'y', offset = 0) {
    this.isClipping = !!enabled;
    this.clipAxis = axis;
    this.clipOffset = offset;

    const normal =
      axis === 'x'
        ? new THREE.Vector3(-1, 0, 0)
        : axis === 'z'
          ? new THREE.Vector3(0, 0, -1)
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
    this.isMeasuring = active !== undefined ? active : !this.isMeasuring;
    this.measurePoints = [];
    if (this.measureLine) {
      this.scene.remove(this.measureLine);
      this.measureLine = null;
    }
    const hud = document.getElementById('measurement-hud');
    if (hud) {
      hud.style.display = this.isMeasuring ? 'block' : 'none';
      if (this.isMeasuring) {
        window.OmniMeasurementHudView.renderMeasurementHud(hud, document, { phase: 'active' });
        if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
      }
    }
  }

  addMeasurePoint(point3D) {
    if (!this.isMeasuring) return;
    const hud = document.getElementById('measurement-hud');
    if (!point3D || ![point3D.x, point3D.y, point3D.z].every(Number.isFinite)) {
      this.measurePoints = [];
      if (hud) {
        window.OmniMeasurementHudView.renderMeasurementHud(hud, document, { phase: 'unavailable' });
        if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
      }
      return;
    }
    this.measurePoints.push(point3D.clone());

    if (this.measurePoints.length === 1 && hud) {
      window.OmniMeasurementHudView.renderMeasurementHud(hud, document, {
        phase: 'anchored',
        point: point3D
      });
      if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
    } else if (this.measurePoints.length === 2) {
      const p1 = this.measurePoints[0];
      const p2 = this.measurePoints[1];
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const dz = Math.abs(p2.z - p1.z);
      const dist = p1.distanceTo(p2);

      if (![dx, dy, dz, dist].every(Number.isFinite)) {
        this.measurePoints = [];
        if (hud) {
          window.OmniMeasurementHudView.renderMeasurementHud(hud, document, { phase: 'unavailable' });
          if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
        }
        return;
      }

      // Render 3D Dimension Line
      if (this.measureLine) this.scene.remove(this.measureLine);

      const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 });
      this.measureLine = new THREE.Line(geom, mat);
      this.scene.add(this.measureLine);

      if (hud) {
        window.OmniMeasurementHudView.renderMeasurementHud(hud, document, {
          phase: 'result',
          distance: dist,
          delta: { x: dx, y: dy, z: dz }
        });
        if (typeof window !== 'undefined' && window.OmniIcons) window.OmniIcons.hydrateAll(hud);
      }
      this.measurePoints = [];
    }
  }

  // =========================================================================
  // Transient experimental impact estimate player
  // =========================================================================

  loadTransientDropData(data) {
    const frames = Array.isArray(data?.frames) ? data.frames : [];
    this.transientData = frames.length ? data : null;
    this.currentFrameIdx = 0;
    const status = document.getElementById('transient-estimate-status');
    const bar = document.getElementById('transient-playback-bar');
    if (bar) bar.style.display = 'flex';
    if (!this.transientData) {
      this.pauseTransient();
      if (this.currentMesh) this.currentMesh.position.y = 0;
      if (this.explodedParts?.[0]?.material) this.explodedParts[0].material.color.setHex(0x334155);
      const timeSlider = document.getElementById('transient-time-slider');
      const timeReadout = document.getElementById('transient-time-readout');
      const responseReadout = document.getElementById('transient-stress-readout');
      const accelerationReadout = document.getElementById('transient-accel-readout');
      if (timeSlider) timeSlider.value = '0';
      if (timeReadout) timeReadout.textContent = '0.00 ms';
      if (responseReadout) responseReadout.textContent = '0%';
      if (accelerationReadout) accelerationReadout.textContent = '0.0 G';
      if (status)
        status.textContent = 'No transient frames are available. The impact example above remains an estimate only.';
      return false;
    }
    const timeSlider = document.getElementById('transient-time-slider');
    if (timeSlider) timeSlider.max = String(frames.length - 1);
    if (status)
      status.textContent =
        'Experimental animation estimate only; not a validated drop test or material failure assessment.';
    this.renderTransientFrame(0);
    return true;
  }

  renderTransientFrame(frameIdx) {
    if (!this.transientData || !Array.isArray(this.transientData.frames) || !this.transientData.frames.length) return;
    this.currentFrameIdx = Math.max(0, Math.min(this.transientData.frames.length - 1, frameIdx));
    const frame = this.transientData.frames[this.currentFrameIdx];

    if (this.currentMesh) {
      // Dynamic vertical motion during drop impact and rebound
      this.currentMesh.position.y = frame.positionZ_mm ?? 0;

      // Dimensionless contact response color for the illustrative animation.
      if (this.explodedParts && this.explodedParts[0] && this.explodedParts[0].material) {
        if (frame.inContact && frame.contactResponseIndex > 0.05) {
          const t = Math.min(1.0, frame.contactResponseIndex);
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
    if (timeReadout) timeReadout.textContent = `${Number(frame.timeMs || 0).toFixed(2)} ms`;
    if (stressReadout) stressReadout.textContent = `${(Number(frame.contactResponseIndex || 0) * 100).toFixed(0)}%`;
    if (accelReadout) accelReadout.textContent = `${Number(frame.acceleration_G || 0).toFixed(1)} G`;
  }

  async playTransient() {
    if (this.isTransientPlaying) {
      this.pauseTransient();
      return;
    }
    if (!this.transientData) {
      if (typeof window !== 'undefined' && window.omniEngAPI && window.omniEngAPI.solveTransientDrop) {
        try {
          const dropHeightM = Number(document.getElementById('slider-drop-h')?.value);
          const phoneMassKg = Number(document.getElementById('input-drop-mass')?.value);
          const impactAngle = document.getElementById('select-drop-angle')?.value;
          const totalDurationMs = Number(document.getElementById('input-drop-duration-ms')?.value);
          const stepCount = Number(document.getElementById('input-drop-step-count')?.value);
          const inputsValid =
            Number.isFinite(dropHeightM) &&
            dropHeightM >= 0.5 &&
            dropHeightM <= 2.5 &&
            Number.isFinite(phoneMassKg) &&
            phoneMassKg > 0 &&
            ['corner', 'edge', 'face'].includes(impactAngle) &&
            Number.isFinite(totalDurationMs) &&
            totalDurationMs > 0 &&
            Number.isSafeInteger(stepCount) &&
            stepCount > 0 &&
            stepCount <= 10000;

          if (!inputsValid) {
            this.loadTransientDropData(null);
            const status = document.getElementById('transient-estimate-status');
            if (status) {
              status.textContent =
                'No animation generated. Provide a positive drop height and mass, an impact orientation, a positive duration, and 1–10,000 frames.';
            }
            return;
          }

          const res = await window.omniEngAPI.solveTransientDrop({
            dropHeightM,
            phoneMassKg,
            impactAngle,
            totalDurationMs,
            stepCount
          });
          if (!this.loadTransientDropData(res)) return;
        } catch (_) {
          this.loadTransientDropData(null);
          return;
        }
      }
      if (!this.transientData) {
        this.loadTransientDropData(null);
        return;
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
  // 1. Consumer electronics illustrative device assembly
  // =========================================================================

  renderSmartphoneCad(w = 75, h = 8.2, d = 160) {
    this.clearMesh();
    const group = new THREE.Group();
    const explodedParts = [];

    // Synthetic outer enclosure geometry
    const chassisGeom = new THREE.BoxGeometry(w, h * 0.7, d);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.9,
      roughness: 0.22
    });
    const chassis = new THREE.Mesh(chassisGeom, chassisMat);
    chassis.position.y = -h * 0.15;
    chassis.userData = {
      partName: 'Illustrative outer enclosure',
      materialName: 'Illustrative material (unsourced)',
      basePosY: chassis.position.y,
      explodeY: -35
    };
    group.add(chassis);
    explodedParts.push(chassis);

    // Synthetic battery block geometry
    const batGeom = new THREE.BoxGeometry(w * 0.75, 4.2, d * 0.52);
    const batMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.7,
      roughness: 0.35
    });
    const battery = new THREE.Mesh(batGeom, batMat);
    battery.position.set(0, 0, d * 0.12);
    battery.userData = {
      partName: 'Illustrative battery block',
      materialName: 'Illustrative material (unsourced)',
      basePosY: 0,
      explodeY: -15
    };
    group.add(battery);
    explodedParts.push(battery);

    // Synthetic heat spreader geometry
    const vcGeom = new THREE.BoxGeometry(w * 0.82, 0.45, d * 0.72);
    const vcMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Rich copper luster
      metalness: 0.95,
      roughness: 0.2
    });
    const vaporChamber = new THREE.Mesh(vcGeom, vcMat);
    vaporChamber.position.set(0, 2.5, 0);
    vaporChamber.userData = {
      partName: 'Illustrative heat spreader',
      materialName: 'Illustrative material (unsourced)',
      basePosY: 2.5,
      explodeY: 8
    };
    group.add(vaporChamber);
    explodedParts.push(vaporChamber);

    // Synthetic board and package geometry
    const pcbGeom = new THREE.BoxGeometry(w * 0.88, 1.2, d * 0.38);
    const pcbMat = new THREE.MeshStandardMaterial({
      color: 0x065f46, // Green PCB display color
      roughness: 0.5,
      metalness: 0.3
    });
    const pcb = new THREE.Mesh(pcbGeom, pcbMat);
    pcb.position.set(0, 4.2, -d * 0.25);
    pcb.userData = {
      partName: 'Illustrative circuit board',
      materialName: 'Illustrative material (unsourced)',
      basePosY: 4.2,
      explodeY: 25
    };

    // Add SoC Silicon Package & RAM on top of PCB
    const socGeom = new THREE.BoxGeometry(16, 1.2, 16);
    const socMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.85, roughness: 0.15 });
    const soc = new THREE.Mesh(socGeom, socMat);
    soc.position.set(0, 1.2, 0);
    soc.userData = { partName: 'Illustrative package block', materialName: 'Illustrative material (unsourced)' };
    pcb.add(soc);

    group.add(pcb);
    explodedParts.push(pcb);

    // Synthetic camera block geometry
    const camGeom = new THREE.BoxGeometry(32, 4.5, 36);
    const camMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.92 });
    const camModule = new THREE.Mesh(camGeom, camMat);
    camModule.position.set(-w * 0.25, -h * 0.5 - 2.5, -d * 0.3);
    camModule.userData = {
      partName: 'Illustrative camera block',
      materialName: 'Illustrative material (unsourced)',
      basePosY: camModule.position.y,
      explodeY: -55
    };

    for (let i = 0; i < 3; i++) {
      const ringGeom = new THREE.CylinderGeometry(5.2, 5.2, 4.8, 32);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.95 });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.set(-w * 0.25 + (i === 2 ? 7 : -7), -h * 0.5 - 3.0, -d * 0.3 + (i % 2 === 0 ? -7 : 7));
      group.add(ring);

      const lensGeom = new THREE.CylinderGeometry(3.6, 3.6, 4.9, 32);
      const lensMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.9,
        roughness: 0.05,
        transparent: true,
        opacity: 0.85
      });
      const lens = new THREE.Mesh(lensGeom, lensMat);
      lens.position.copy(ring.position);
      group.add(lens);
    }
    group.add(camModule);
    explodedParts.push(camModule);

    // Synthetic display panel geometry
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
      partName: 'Illustrative display panel',
      materialName: 'Illustrative material (unsourced)',
      basePosY: screen.position.y,
      explodeY: 55,
      defaultTransparent: true,
      defaultOpacity: 0.92
    };
    group.add(screen);
    explodedParts.push(screen);

    // Procedural fastener and control examples
    if (ProceduralHardware) {
      // Four synthetic fastener shapes
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
          partName: `Illustrative fastener #${idx + 1}`,
          materialName: 'Illustrative material (unsourced)',
          basePosY: screw.position.y,
          explodeY: 65
        };
        group.add(screw);
        explodedParts.push(screw);
      });

      // Side control shapes
      const powerBtn = ProceduralHardware.createKnurledCylinder(2.2, 8.5, 0x64748b, 20);
      powerBtn.rotation.z = Math.PI / 2;
      powerBtn.position.set(w * 0.5 + 1.2, 0, -d * 0.15);
      powerBtn.userData = { partName: 'Illustrative power button', materialName: 'Illustrative material (unsourced)' };
      group.add(powerBtn);

      const volRocker = ProceduralHardware.createKnurledCylinder(2.2, 14.0, 0x64748b, 24);
      volRocker.rotation.z = Math.PI / 2;
      volRocker.position.set(-w * 0.5 - 1.2, 0, -d * 0.12);
      volRocker.userData = {
        partName: 'Illustrative volume control',
        materialName: 'Illustrative material (unsourced)'
      };
      group.add(volRocker);

      // Ruler-like visual reference; not a calibrated measuring tool
      const ruler = ProceduralHardware.createRulerStrip(140, 4.0, 10);
      ruler.position.set(w * 0.5 + 6.0, -h * 0.5, 0);
      ruler.rotation.y = -Math.PI / 2;
      ruler.userData.partName = 'Illustrative ruler strip';
      ruler.userData.materialName = 'Illustrative material (unsourced)';
      group.add(ruler);

      // Generic connector block
      const portGeom = new THREE.BoxGeometry(9.0, 3.2, 4.0);
      const portMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.95 });
      const usbPort = new THREE.Mesh(portGeom, portMat);
      usbPort.position.set(0, -h * 0.15, d * 0.5);
      usbPort.userData = {
        partName: 'Illustrative connector block',
        materialName: 'Illustrative material (unsourced)'
      };
      group.add(usbPort);
    }

    // Assembly Explode Dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach((p) => {
        p.position.y = p.userData.basePosY + (p.userData.explodeY - p.userData.basePosY) * factor;
      });
    };

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Synthetic device example geometry; no product provenance');
  }

  // =========================================================================
  // 1B. Illustrative optomechanical camera lens assembly
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
      color: 0x111827, // Matte Hard-Anodized Aircraft Unspecified structural material
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

    // Illustrative translucent optical-material colors
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
      metalness: 0.2,
      roughness: 0.02,
      transparent: true,
      opacity: 0.75,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    const glassFluoriteMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf,
      metalness: 0.1,
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
    const barrelGeom = new THREE.CylinderGeometry(
      barrelRadius,
      barrelRadius * 0.96,
      barrelLength,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const barrelMesh = new THREE.Mesh(barrelGeom, barrelMat);
    barrelMesh.rotation.x = -Math.PI / 2;
    barrelMesh.position.z = 10.0;
    barrelMesh.userData = {
      partName: 'Illustrative lens barrel',
      materialName: 'Unspecified appearance material',
      basePosZ: 10.0,
      explodeZ: 10.0
    };
    group.add(barrelMesh);

    // Front Filter Ring & Thread (58mm thread)
    const filterRingGeom = new THREE.CylinderGeometry(
      barrelRadius + 0.8,
      barrelRadius,
      8.0,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const filterRing = new THREE.Mesh(filterRingGeom, barrelMat);
    filterRing.rotation.x = -Math.PI / 2;
    filterRing.position.z = -32.0;
    filterRing.userData = {
      partName: 'Front collar (sample geometry)',
      materialName: 'Unspecified structural material',
      basePosZ: -32.0,
      explodeZ: -65.0
    };
    group.add(filterRing);
    explodedParts.push(filterRing);

    // Knurled Rubber Manual Focus Ring (Middle)
    const focusRingGeom = new THREE.CylinderGeometry(
      barrelRadius + 1.6,
      barrelRadius + 1.6,
      22.0,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const focusRing = new THREE.Mesh(focusRingGeom, rubberRingMat);
    focusRing.rotation.x = -Math.PI / 2;
    focusRing.position.z = -6.0;
    focusRing.userData = {
      partName: 'Manual focus ring (sample geometry)',
      materialName: 'Unspecified dark appearance material',
      basePosZ: -6.0,
      explodeZ: -25.0
    };
    group.add(focusRing);
    explodedParts.push(focusRing);

    // Aperture Control Ring with f-stop Index Marks
    const apertureRingGeom = new THREE.CylinderGeometry(
      barrelRadius + 1.0,
      barrelRadius + 1.0,
      14.0,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const apertureRing = new THREE.Mesh(apertureRingGeom, barrelMat);
    apertureRing.rotation.x = -Math.PI / 2;
    apertureRing.position.z = 24.0;
    apertureRing.userData = {
      partName: 'Aperture selector ring (sample geometry)',
      materialName: 'Unspecified surface appearance',
      basePosZ: 24.0,
      explodeZ: 40.0
    };
    group.add(apertureRing);
    explodedParts.push(apertureRing);

    // -----------------------------------------------------------------------
    // 2. Internal Anti-Reflective Stepped Baffles & Lens Group Spacers
    // -----------------------------------------------------------------------
    [-22, -10, 8, 28, 42].forEach((zPos, idx) => {
      const baffleGeom = new THREE.RingGeometry(
        barrelRadius * 0.72,
        barrelRadius * 0.94,
        32,
        1,
        thetaStart + Math.PI * 0.5,
        thetaLength
      );
      const baffle = new THREE.Mesh(baffleGeom, baffleMat);
      baffle.position.z = zPos;
      baffle.userData = {
        partName: `Visual baffle #${idx + 1}`,
        materialName: 'Unspecified dark appearance material'
      };
      group.add(baffle);
    });

    // Internal Brass Dual-Helicoid Cam Barrel (Focus mechanism guide)
    const helicoidGeom = new THREE.CylinderGeometry(
      barrelRadius * 0.82,
      barrelRadius * 0.82,
      34.0,
      32,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const helicoidMesh = new THREE.Mesh(helicoidGeom, brassCamMat);
    helicoidMesh.rotation.x = -Math.PI / 2;
    helicoidMesh.position.z = 4.0;
    helicoidMesh.userData = {
      partName: 'Illustrative guide track',
      materialName: 'Unspecified metal appearance'
    };
    group.add(helicoidMesh);

    // -----------------------------------------------------------------------
    // 3. Voice Coil Motor (VCM) Electromagnetic Autofocus Linear Actuator
    // -----------------------------------------------------------------------
    // Outer Neodymium Magnetic Stator Ring
    const magnetGeom = new THREE.CylinderGeometry(
      barrelRadius * 0.9,
      barrelRadius * 0.9,
      16.0,
      32,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const magnetMesh = new THREE.Mesh(magnetGeom, magnetMat);
    magnetMesh.rotation.x = -Math.PI / 2;
    magnetMesh.position.z = 0.0;
    magnetMesh.userData = {
      partName: 'Illustrative actuator ring',
      materialName: 'Unspecified magnet appearance'
    };
    group.add(magnetMesh);

    // Inner Copper Electromagnetic Voice Coil
    const vcmCoilGeom = new THREE.CylinderGeometry(
      barrelRadius * 0.86,
      barrelRadius * 0.86,
      12.0,
      32,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const vcmCoil = new THREE.Mesh(vcmCoilGeom, copperVcmMat);
    vcmCoil.rotation.x = -Math.PI / 2;
    vcmCoil.position.z = 0.0;
    vcmCoil.userData = {
      partName: 'Illustrative coil assembly',
      materialName: 'Unspecified conductor appearance',
      basePosZ: 0.0,
      explodeZ: 12.0
    };
    group.add(vcmCoil);
    explodedParts.push(vcmCoil);

    // -----------------------------------------------------------------------
    // 4. Optical Lens Elements (8 Elements in 6 Groups)
    // -----------------------------------------------------------------------
    // Helper to create spherical meniscus / curved lens element
    const createLensMesh = (
      radiusFront,
      radiusRear,
      thickness,
      diameter,
      zPos,
      material,
      partName,
      matName,
      explodeDist
    ) => {
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

    // E1: Front Large Aspherical Meniscus (Illustrative optical material A)
    createLensMesh(
      42.5,
      110.0,
      7.8,
      48.0,
      -28.0,
      glassCrownMat,
      'Example optical element 1',
      'Illustrative optical material A',
      -55.0
    );

    // E2: Illustrative optical element
    createLensMesh(
      28.0,
      54.0,
      6.2,
      42.0,
      -16.0,
      glassCrownMat,
      'Group 2: Positive Meniscus Crown Element',
      'Illustrative optical material A',
      -35.0
    );

    // E3 + E4: Illustrative paired optical elements
    createLensMesh(
      48.0,
      -24.5,
      4.8,
      36.0,
      -6.0,
      glassFluoriteMat,
      'Example optical element 3',
      'Illustrative optical material C',
      -15.0
    );
    createLensMesh(
      -24.5,
      32.0,
      3.2,
      36.0,
      -1.8,
      glassFlintMat,
      'Example optical element 4',
      'Illustrative optical material B',
      -12.0
    );

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
      partName: `Illustrative iris mechanism (f/${fStop})`,
      materialName: 'Unspecified dark appearance material',
      basePosZ: 4.0,
      explodeZ: 4.0
    };
    group.add(irisGroup);
    explodedParts.push(irisGroup);

    // E5: Autofocus Variator Biconcave Group (Negative Dispersive)
    createLensMesh(
      -35.0,
      28.0,
      4.2,
      32.0,
      12.0,
      glassFlintMat,
      'Example optical element 5',
      'Illustrative optical material B',
      8.0
    );

    // E6: Biconvex Rear Master Lens Group
    createLensMesh(
      36.0,
      -42.0,
      5.6,
      34.0,
      22.0,
      glassCrownMat,
      'Example optical element 6',
      'Illustrative optical material A',
      22.0
    );

    // E7 + E8: Rear Field Flattener & Relay Doublet
    createLensMesh(
      55.0,
      -30.0,
      4.5,
      34.0,
      32.0,
      glassCrownMat,
      'Example optical element 7',
      'Illustrative optical material A',
      38.0
    );
    createLensMesh(
      -30.0,
      -85.0,
      3.2,
      34.0,
      37.0,
      glassFluoriteMat,
      'Example optical element 8',
      'Illustrative optical material C',
      44.0
    );

    // -----------------------------------------------------------------------
    // 6. Stainless Steel Bayonet Mount & Gold Contact Pins
    // -----------------------------------------------------------------------
    const bayonetFlangeGeom = new THREE.CylinderGeometry(
      barrelRadius * 0.95,
      barrelRadius * 0.95,
      5.0,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const bayonetFlange = new THREE.Mesh(bayonetFlangeGeom, bayonetMat);
    bayonetFlange.rotation.x = -Math.PI / 2;
    bayonetFlange.position.z = 48.0;
    bayonetFlange.userData = {
      partName: 'Rear mount flange (sample geometry)',
      materialName: 'Unspecified metal appearance',
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
      lugMesh.position.set(
        Math.cos(lugAngle) * (barrelRadius * 0.78),
        Math.sin(lugAngle) * (barrelRadius * 0.78),
        50.5
      );
      lugMesh.rotation.z = lugAngle;
      group.add(lugMesh);
    }

    // Gold Electrical CPU Contact Pins (8 Contacts for high-speed autofocus)
    for (let p = 0; p < 8; p++) {
      const pinGeom = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16);
      const pinMesh = new THREE.Mesh(pinGeom, goldPinMat);
      pinMesh.rotation.x = Math.PI / 2;
      const pinAngle = -Math.PI / 2 + (p - 3.5) * 0.12;
      pinMesh.position.set(
        Math.cos(pinAngle) * (barrelRadius * 0.65),
        Math.sin(pinAngle) * (barrelRadius * 0.65),
        50.0
      );
      pinMesh.userData = {
        partName: `Contact pin #${p + 1}`,
        materialName: 'Unspecified contact appearance'
      };
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
      partName: 'Image plane (sample geometry)',
      materialName: 'Unspecified image-plane appearance',
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
    olpfMesh.userData = {
      partName: 'Filter element (sample geometry)',
      materialName: 'Unspecified filter appearance'
    };
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
        const curR = r === 0 ? 0 : rayRadius; // Center ray + peripheral cone rays
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);

        const curvePoints = [
          new THREE.Vector3(cosP * curR, sinP * curR, -45.0), // Entrance pupil
          new THREE.Vector3(cosP * curR, sinP * curR, -28.0), // Front element
          new THREE.Vector3(cosP * curR * 0.88, sinP * curR * 0.88, -16.0), // Crown refraction
          new THREE.Vector3(cosP * curR * 0.72, sinP * curR * 0.72, -6.0), // Doublet
          new THREE.Vector3(cosP * curR * 0.52, sinP * curR * 0.52, 4.0), // Iris aperture waist
          new THREE.Vector3(cosP * curR * 0.4, sinP * curR * 0.4, 16.0), // Variator
          new THREE.Vector3(cosP * curR * 0.28, sinP * curR * 0.28, 34.0), // Master
          new THREE.Vector3(0, 0, 68.0) // Focal convergence point on sensor plane
        ];

        const rayGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const rayColor = r === 0 ? 0xf59e0b : 0x38bdf8; // Golden axial ray + cyan marginal rays
        const rayMat = new THREE.LineBasicMaterial({
          color: rayColor,
          linewidth: r === 0 ? 2 : 1,
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

      rayGroup.userData = {
        partName: 'Illustrative ray paths (not computed)',
        materialName: 'Visual-only ray geometry'
      };
      group.add(rayGroup);
    }

    // Assembly Explode Dispatcher (Smooth separation along optical Z-axis)
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach((p) => {
        p.position.z = p.userData.basePosZ + (p.userData.explodeZ - p.userData.basePosZ) * factor;
      });
    };

    // Apply initial explode factor if specified
    if (explodeFactor > 0) {
      group.userData.updateExplode(explodeFactor);
    }

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Synthetic lens assembly visualization; no sourced optical prescription');
  }

  // =========================================================================
  // 1C. Synthetic camera-lens assembly visualization. Geometry and material labels are
  // illustrative; no optical prescription, sourced component data, or validation is attached.
  // =========================================================================

  renderCameraLensMaster3D(
    cutaway = true,
    cutawayAngle = Math.PI / 2,
    explodeFactor = 0,
    fStop = 1.0,
    showRays = true
  ) {
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
      color: 0x64748b, // Illustrative material appearance
      metalness: 0.85,
      roughness: 0.25,
      side: THREE.DoubleSide
    });

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // C36000 Optical Retaining Rings
      metalness: 0.9,
      roughness: 0.3,
      side: THREE.DoubleSide
    });

    const vcmCopperMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Pure OFC Dual-VCM Copper Coils
      metalness: 0.95,
      roughness: 0.2,
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
      metalness: 0.1,
      roughness: 0.05
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.95,
      metalness: 0.02
    });

    // Optical Glass Materials
    const glassAsphereMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Illustrative translucent material
      metalness: 0.2,
      roughness: 0.02,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });

    const glassFluoriteMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf, // Illustrative translucent material
      metalness: 0.1,
      roughness: 0.01,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide
    });

    const glassSuperEDMat = new THREE.MeshStandardMaterial({
      color: 0x818cf8, // Illustrative translucent material
      metalness: 0.12,
      roughness: 0.02,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });

    const glassFlintMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc, // Illustrative translucent material
      metalness: 0.22,
      roughness: 0.02,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    });

    const glassBRXMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6, // Illustrative translucent material
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.25,
      metalness: 0.28,
      roughness: 0.01,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    });

    const glassHighIndexMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e, // Illustrative translucent material
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
    const barrelGeom = new THREE.CylinderGeometry(
      barrelRadius,
      barrelRadius * 0.97,
      barrelLength,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const barrelMesh = new THREE.Mesh(barrelGeom, cfrpBarrelMat);
    barrelMesh.rotation.x = Math.PI / 2;
    barrelMesh.position.z = 0;
    barrelMesh.userData = {
      partNumber: 'SAMPLE-050-040',
      partName: 'Illustrative outer housing',
      materialName: 'Unspecified housing appearance',
      function: 'Sample housing geometry',
      basePosZ: 0,
      explodeZ: 0
    };
    group.add(barrelMesh);
    explodedParts.push(barrelMesh);

    // 2. Titanium Grade 5 Coaxial Internal Sleeves
    const tiSleeveGeom = new THREE.CylinderGeometry(
      barrelRadius - 2.5,
      barrelRadius - 2.5,
      barrelLength * 0.85,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const tiSleeveMesh = new THREE.Mesh(tiSleeveGeom, titaniumMat);
    tiSleeveMesh.rotation.x = Math.PI / 2;
    tiSleeveMesh.position.z = 2.0;
    tiSleeveMesh.userData = {
      partNumber: 'SAMPLE-050-013',
      partName: 'Illustrative internal guide sleeve',
      materialName: 'Unspecified metal appearance',
      function: 'Sample component geometry',
      basePosZ: 2.0,
      explodeZ: 2.0
    };
    group.add(tiSleeveMesh);
    explodedParts.push(tiSleeveMesh);

    // 3. Manual Focus & Control Rings
    const focusRingGeom = new THREE.CylinderGeometry(
      barrelRadius + 1.2,
      barrelRadius + 1.2,
      24.0,
      48,
      1,
      false,
      thetaStart,
      thetaLength
    );
    const focusRing = new THREE.Mesh(focusRingGeom, rubberMat);
    focusRing.rotation.x = Math.PI / 2;
    focusRing.position.z = -18.0;
    focusRing.userData = {
      partNumber: 'SAMPLE-050-041',
      partName: 'Manual focus ring (sample geometry)',
      materialName: 'Unspecified dark appearance material',
      function: 'Sample component geometry',
      basePosZ: -18.0,
      explodeZ: -18.0
    };
    group.add(focusRing);

    // Helper to add illustrative optical elements
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
        materialName: mat.name || 'Illustrative optical material',
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
    addElementMesh(
      'E1',
      'Example lens element E1',
      glassAsphereMat,
      72.0,
      12.2,
      -45.0,
      'SAMPLE-050-003',
      -65.0,
      'Illustrative element placement'
    );

    // E2: Illustrative lens element
    addElementMesh(
      'E2',
      'Example lens element E2',
      glassFluoriteMat,
      66.0,
      8.6,
      -34.0,
      'SAMPLE-050-006',
      -45.0,
      'Illustrative element placement'
    );

    // E3 + E4: Cemented Hyper-Achromat Doublet
    addElementMesh(
      'E3',
      'Example lens element E3',
      glassSuperEDMat,
      58.0,
      7.8,
      -24.0,
      'SAMPLE-050-008',
      -30.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E4',
      'Example lens element E4',
      glassFlintMat,
      58.0,
      3.4,
      -18.0,
      'SAMPLE-050-010',
      -25.0,
      'Illustrative element placement'
    );

    // E5: Illustrative lens element
    addElementMesh(
      'E5',
      'Example lens element E5',
      glassBRXMat,
      52.0,
      4.2,
      -11.0,
      'SAMPLE-050-011',
      -18.0,
      'Illustrative element placement'
    );

    // E6 + E7: Floating Autofocus Group 1 (Dual-VCM Carriage)
    addElementMesh(
      'E6',
      'Example lens element E6',
      glassFlintMat,
      46.0,
      3.6,
      -4.0,
      'SAMPLE-050-015',
      -10.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E7',
      'Example lens element E7',
      glassAsphereMat,
      46.0,
      5.1,
      0.5,
      'SAMPLE-050-016',
      -5.0,
      'Illustrative element placement'
    );

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
      partNumber: 'SAMPLE-050-019',
      partName: 'Illustrative actuator assembly',
      materialName: 'Unspecified conductor and guide appearance',
      function: 'Sample component geometry',
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
    const irisMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.8,
      roughness: 0.35,
      side: THREE.DoubleSide
    });
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
      partNumber: 'SAMPLE-050-023',
      partName: `Illustrative iris mechanism (f/${fStop})`,
      materialName: 'Unspecified dark appearance material',
      function: 'Sample component geometry',
      basePosZ: 7.0,
      explodeZ: 7.0
    };
    group.add(irisGroup);
    explodedParts.push(irisGroup);

    // 7. Active 2-Axis OIS Voice-Coil Floating Group (E8 + E9)
    addElementMesh(
      'E8',
      'Example lens element E8',
      glassSuperEDMat,
      44.0,
      4.6,
      14.0,
      'SAMPLE-050-027',
      8.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E9',
      'Example lens element E9',
      glassFlintMat,
      44.0,
      3.8,
      19.5,
      'SAMPLE-050-028',
      12.0,
      'Illustrative element placement'
    );

    // 8. Master Center High-Refraction Biconvex (E10)
    addElementMesh(
      'E10',
      'Example lens element E10',
      glassHighIndexMat,
      48.0,
      8.2,
      28.0,
      'SAMPLE-050-034',
      22.0,
      'Illustrative element placement'
    );

    // 9. Telecentric Relay Doublet (E11 + E12)
    addElementMesh(
      'E11',
      'Example lens element E11',
      glassSuperEDMat,
      46.0,
      6.4,
      37.0,
      'SAMPLE-050-035',
      30.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E12',
      'Example lens element E12',
      glassFlintMat,
      46.0,
      3.8,
      43.0,
      'SAMPLE-050-036',
      36.0,
      'Illustrative element placement'
    );

    // 10. Rear Telecentric Field Flattener Triplet (E13, E14, E15)
    addElementMesh(
      'E13',
      'Example lens element E13',
      glassAsphereMat,
      44.0,
      5.2,
      50.0,
      'SAMPLE-050-037',
      45.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E14',
      'Example lens element E14',
      glassAsphereMat,
      42.0,
      4.8,
      56.5,
      'SAMPLE-050-038',
      52.0,
      'Illustrative element placement'
    );
    addElementMesh(
      'E15',
      'Example lens element E15',
      glassFluoriteMat,
      40.0,
      4.0,
      62.0,
      'SAMPLE-050-039',
      60.0,
      'Illustrative element placement'
    );

    // 11. Stainless Steel 316L Mount Bayonet & 12 Gold Pins
    const bayonetMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.98,
      roughness: 0.12,
      side: THREE.DoubleSide
    });
    const bayonetGeom = new THREE.CylinderGeometry(
      barrelRadius * 0.92,
      barrelRadius * 0.92,
      6.0,
      48,
      1,
      true,
      thetaStart,
      thetaLength
    );
    const bayonetMesh = new THREE.Mesh(bayonetGeom, bayonetMat);
    bayonetMesh.rotation.x = Math.PI / 2;
    bayonetMesh.position.z = 66.0;
    bayonetMesh.userData = {
      partNumber: 'SAMPLE-050-045',
      partName: 'Rear mount flange (sample geometry)',
      materialName: 'Unspecified metal appearance',
      function: 'Sample component geometry',
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
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.6, Math.sin(offsetAngle) * curR * 0.6, 28.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.45, Math.sin(offsetAngle) * curR * 0.45, 50.0),
            new THREE.Vector3(Math.cos(offsetAngle) * curR * 0.3, Math.sin(offsetAngle) * curR * 0.3, 62.0),
            new THREE.Vector3(0, 0, 86.86) // Common focal point (BFL = 24.86mm past E15)
          ];
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const lineMat = new THREE.LineBasicMaterial({
            color: wl.color,
            transparent: true,
            opacity: ring === 0 ? 0.9 : 0.6
          });
          const line = new THREE.Line(lineGeom, lineMat);
          rayGroup.add(line);
        }
      });

      rayGroup.userData = {
        partName: 'Illustrative polychromatic ray paths (not computed)',
        materialName: 'Visual-only ray geometry',
        function: 'Ray paths are drawn for illustration and do not reflect an optical calculation.'
      };
      group.add(rayGroup);
    }

    // Explode dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach((p) => {
        p.position.z = p.userData.basePosZ + (p.userData.explodeZ - p.userData.basePosZ) * factor;
      });
    };

    if (explodeFactor > 0) {
      group.userData.updateExplode(explodeFactor);
    }

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Synthetic lens visualization; no measured optical performance');
  }

  // =========================================================================
  // 2. Drone & Aerospace: Carbon Fiber FPV / VTOL Quadcopter (CATIA / Fusion)
  // =========================================================================

  renderDrone3D(armLength = 85, rpm = 8000) {
    this.clearMesh();
    // The legacy second argument only scales decorative blade animation; it is not RPM telemetry.
    this.propellerAnimationRate = Number.isFinite(rpm) ? Math.max(0, rpm / 8000) : 1;
    const group = new THREE.Group();
    group.userData = {
      isSyntheticExample: true,
      validationLevel: 'experimental',
      physicsSimulation: false
    };
    const explodedParts = [];

    // Illustrative lower deck form
    const deckGeom = new THREE.BoxGeometry(50, 2.5, 95);
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.35,
      metalness: 0.85
    });
    const lowerDeck = new THREE.Mesh(deckGeom, carbonMat);
    lowerDeck.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative lower deck shape',
      materialName: 'Unspecified illustrative material',
      basePosY: -4,
      explodeY: -25
    };
    group.add(lowerDeck);
    explodedParts.push(lowerDeck);

    // Illustrative upper deck form
    const upperDeck = new THREE.Mesh(deckGeom, carbonMat);
    upperDeck.position.y = 18;
    upperDeck.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative upper deck shape',
      materialName: 'Unspecified illustrative material',
      basePosY: 18,
      explodeY: 35
    };
    group.add(upperDeck);
    explodedParts.push(upperDeck);

    // Illustrative electronics-stack form
    const fcGeom = new THREE.BoxGeometry(30.5, 3.0, 30.5);
    const fcMat = new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.6, roughness: 0.4 });
    const fcStack = new THREE.Mesh(fcGeom, fcMat);
    fcStack.position.set(0, 7, 0);
    fcStack.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative electronics-stack shape',
      materialName: 'Unspecified illustrative material',
      basePosY: 7,
      explodeY: 10
    };
    group.add(fcStack);
    explodedParts.push(fcStack);

    // Four illustrative arm-like forms
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const x = armLength * Math.cos(angle);
      const z = armLength * Math.sin(angle);

      // Illustrative arm shape
      const armGeom = new THREE.CylinderGeometry(3.5, 3.5, armLength, 16);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.85, roughness: 0.3 });
      const arm = new THREE.Mesh(armGeom, armMat);
      arm.position.set(x / 2, 7, z / 2);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0, z).normalize());
      arm.userData = {
        isSyntheticExample: true,
        partName: `Illustrative arm shape #${i + 1}`,
        materialName: 'Unspecified illustrative material',
        basePosY: 7,
        explodeY: 7
      };
      group.add(arm);

      // Illustrative motor-shaped component
      const motorGeom = new THREE.CylinderGeometry(7, 7, 12, 24);
      const motorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.95, roughness: 0.2 });
      const motor = new THREE.Mesh(motorGeom, motorMat);
      motor.position.set(x, 13, z);
      motor.userData = {
        isSyntheticExample: true,
        partName: `Illustrative motor shape #${i + 1}`,
        materialName: 'Unspecified illustrative material'
      };
      group.add(motor);

      // Three illustrative blade shapes.
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
        blade.rotation.z = 0.18; // Decorative blade tilt.
        propGroup.add(blade);
      }
      propGroup.userData = {
        isSyntheticExample: true,
        partName: `Illustrative propeller shape #${i + 1}`,
        materialName: 'Unspecified illustrative material'
      };
      group.add(propGroup);
      this.propellerMeshes.push(propGroup);
    }

    // Illustrative battery-shaped form
    const lipoGeom = new THREE.BoxGeometry(36, 32, 75);
    const lipoMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.5 });
    const lipo = new THREE.Mesh(lipoGeom, lipoMat);
    lipo.position.set(0, 34, -5);
    lipo.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative battery shape',
      materialName: 'Unspecified illustrative material',
      basePosY: 34,
      explodeY: 65
    };
    group.add(lipo);
    explodedParts.push(lipo);

    // Illustrative camera-shaped form and mount
    const camGeom = new THREE.BoxGeometry(19, 19, 20);
    const camMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9 });
    const fpvCam = new THREE.Mesh(camGeom, camMat);
    fpvCam.position.set(0, 18, 48);
    fpvCam.rotation.x = -0.35; // 20 deg camera uptilt
    fpvCam.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative camera shape',
      materialName: 'Unspecified illustrative material',
      basePosY: 18,
      explodeY: 35
    };
    group.add(fpvCam);
    explodedParts.push(fpvCam);

    // Illustrative hardware forms
    if (ProceduralHardware) {
      // Four standoff-like shapes between the example chassis decks
      const standoffPositions = [
        [-18, -32],
        [18, -32],
        [-18, 32],
        [18, 32]
      ];
      standoffPositions.forEach(([sx, sz], sIdx) => {
        const standoff = ProceduralHardware.createKnurledCylinder(2.0, 18.0, 0x64748b, 16);
        standoff.position.set(sx, 7.0, sz);
        standoff.userData = {
          isSyntheticExample: true,
          partName: `Illustrative standoff #${sIdx + 1}`,
          materialName: 'Unspecified illustrative material'
        };
        group.add(standoff);

        // Top deck securing screw
        const topScrew = ProceduralHardware.createIsoCapScrew(1.2, 4.0, 0x94a3b8);
        topScrew.position.set(sx, 19.5, sz);
        topScrew.userData = {
          partName: `Illustrative screw-like standoff #${sIdx + 1}`,
          isSyntheticExample: true,
          basePosY: 19.5,
          explodeY: 42
        };
        group.add(topScrew);
        explodedParts.push(topScrew);
      });

      // Four illustrative coil-spring shapes under the example stack
      const fcSpringPositions = [
        [-11, -11],
        [11, -11],
        [-11, 11],
        [11, 11]
      ];
      fcSpringPositions.forEach(([fx, fz], fIdx) => {
        const spring = ProceduralHardware.createCoilSpring(1.4, 5.0, 4.0, 0.35, 0xf59e0b);
        spring.position.set(fx, 2.0, fz);
        spring.userData = {
          isSyntheticExample: true,
          partName: `Illustrative coil spring #${fIdx + 1}`,
          materialName: 'Unspecified illustrative material'
        };
        group.add(spring);
      });

      // Four fastener-like shapes per motor
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const mx = armLength * Math.cos(angle);
        const mz = armLength * Math.sin(angle);
        const boltD = 4.2;
        [
          [-boltD, 0],
          [boltD, 0],
          [0, -boltD],
          [0, boltD]
        ].forEach(([bx, bz], bIdx) => {
          const motorScrew = ProceduralHardware.createIsoCapScrew(0.8, 3.0, 0x38bdf8);
          motorScrew.position.set(mx + bx, 6.0, mz + bz);
          motorScrew.rotation.x = Math.PI; // Secures from bottom of motor plate
          group.add(motorScrew);
        });
      }
    }

    // Decorative particles only; no CFD calculation is run.
    this.createDecorativeFlowParticles(group);

    // Explode Dispatcher
    group.userData.updateExplode = (factor) => {
      explodedParts.forEach((p) => {
        p.position.y = p.userData.basePosY + (p.userData.explodeY - p.userData.basePosY) * factor;
      });
    };

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Synthetic airframe geometry and decorative particles; no aerodynamic, CFD, or flight model');
  }

  createDecorativeFlowParticles(parentGroup) {
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

    this.decorativeFlowParticles = new THREE.Points(geom, mat);
    this.decorativeFlowParticles.userData = {
      isSyntheticExample: true,
      partName: 'Decorative particle effect',
      physicsSimulation: false
    };
    parentGroup.add(this.decorativeFlowParticles);
  }

  // Backward-compatible name for integrations that still call the old helper.
  // The returned particles are decorative and do not represent CFD streamlines.
  createCfdStreamlines(parentGroup) {
    return this.createDecorativeFlowParticles(parentGroup);
  }

  // =========================================================================
  // 3. Illustrative process-plant geometry
  // =========================================================================

  renderPipingLoop3D(straightLength = 40, loopWidth = 10, pipeDiameter = 6) {
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
    tower.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative process column',
      materialName: 'Unspecified illustrative material'
    };
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

    // 2. Illustrative piping geometry with an expansion-loop shape
    const path = new THREE.CurvePath();
    const halfL = straightLength / 2;
    const loopH = loopWidth * 1.3;

    path.add(new THREE.LineCurve3(new THREE.Vector3(-halfL, 0, 0), new THREE.Vector3(-loopWidth / 2, 0, 0)));
    path.add(
      new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, 0, 0), new THREE.Vector3(-loopWidth / 2, loopH, 0))
    );
    path.add(
      new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, loopH, 0))
    );
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, 0, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, 0, 0), new THREE.Vector3(halfL, 0, 0)));

    const tubeGeom = new THREE.TubeGeometry(path, 80, pipeDiameter / 2, 20, false);

    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.8,
      roughness: 0.25
    });
    const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
    tubeMesh.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative pipe segment',
      materialName: 'Unspecified illustrative material'
    };
    group.add(tubeMesh);

    // 3. Illustrative connection and valve geometry
    if (ProceduralHardware) {
      [-halfL, halfL].forEach((posX) => {
        const flangeAssy = ProceduralHardware.createFlangeAssembly(pipeDiameter / 2, pipeDiameter * 1.1, 3.4, 8);
        flangeAssy.rotation.z = Math.PI / 2;
        flangeAssy.position.set(posX, 0, 0);
        flangeAssy.userData = {
          isSyntheticExample: true,
          partName: 'Illustrative flange assembly',
          materialName: 'Unspecified illustrative material'
        };
        group.add(flangeAssy);

        // Circumferential Butt-Weld Bead at neck
        const weld = ProceduralHardware.createWeldBead(pipeDiameter / 2, 0.8, 24);
        weld.rotation.z = Math.PI / 2;
        weld.position.set(posX + (posX < 0 ? 3.0 : -3.0), 0, 0);
        group.add(weld);
      });

      // Preserve the detailed dial visual without a calibrated scale or pressure reading.
      const indicator = ProceduralHardware.createDialGauge(5.5, null, null, null, 'Illustrative');
      indicator.position.set(0, loopH + 6.0, 0);
      indicator.userData = {
        ...indicator.userData,
        isSyntheticExample: true,
        partName: 'Illustrative dial indicator',
        materialName: 'Unspecified illustrative material',
        readingAvailable: false
      };
      group.add(indicator);
    } else {
      const flangeGeom = new THREE.CylinderGeometry(pipeDiameter * 0.95, pipeDiameter * 0.95, 3.2, 24);
      const flangeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9 });
      [-halfL, halfL].forEach((posX) => {
        const fl = new THREE.Mesh(flangeGeom, flangeMat);
        fl.rotation.z = Math.PI / 2;
        fl.position.set(posX, 0, 0);
        fl.userData = {
          isSyntheticExample: true,
          partName: 'Illustrative flange shape',
          materialName: 'Unspecified illustrative material'
        };
        group.add(fl);
      });
    }

    // Control Valve Body at inlet
    const valveGeom = new THREE.SphereGeometry(pipeDiameter * 0.85, 16, 16);
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.7 });
    const valve = new THREE.Mesh(valveGeom, valveMat);
    valve.position.set(-halfL + 6, 0, 0);
    valve.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative valve shape',
      materialName: 'Unspecified illustrative material'
    };
    group.add(valve);

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Synthetic example geometry; no process state, material, or stress assessment');
  }

  // =========================================================================
  // 3B. Illustrative Engine-Stand Geometry
  // This legacy method name remains for compatibility. Its scene is decorative
  // and does not represent a real engine, test stand, instrumentation, or analysis.
  // =========================================================================

  renderRaptorTestStand3D() {
    this.clearMesh();
    const group = new THREE.Group();
    group.userData = {
      isSyntheticExample: true,
      validationLevel: 'experimental',
      physicsSimulation: false
    };

    // 1. Illustrative support frame geometry
    const columnH = 160;
    const standSpan = 45;
    const supportSurfaceMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });

    const columnCoords = [
      [-standSpan, -standSpan],
      [standSpan, -standSpan],
      [-standSpan, standSpan],
      [standSpan, standSpan]
    ];

    columnCoords.forEach(([cx, cz], idx) => {
      const colGeom = new THREE.BoxGeometry(4.5, columnH, 4.5);
      const col = new THREE.Mesh(colGeom, supportSurfaceMat);
      col.position.set(cx, columnH / 2 - 40, cz);
      col.userData = {
        isSyntheticExample: true,
        partName: `Illustrative support column #${idx + 1}`,
        materialName: 'Unspecified illustrative material'
      };
      group.add(col);

      // Illustrative base forms and fastener-like shapes
      if (ProceduralHardware) {
        const baseplate = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 10), supportSurfaceMat);
        baseplate.position.set(cx, -40, cz);
        group.add(baseplate);

        [
          [-3, -3],
          [3, -3],
          [-3, 3],
          [3, 3]
        ].forEach(([bx, bz]) => {
          const bolt = ProceduralHardware.createIsoCapScrew(0.8, 3.5, 0x94a3b8);
          bolt.position.set(cx + bx, -39, cz + bz);
          group.add(bolt);
        });
      }
    });

    // Horizontal illustrative cross pieces
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

    // 2. Illustrative support plate and joint geometry
    const supportPlateGeom = new THREE.CylinderGeometry(14, 16, 8, 32);
    const supportPlateMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.95 });
    const supportPlate = new THREE.Mesh(supportPlateGeom, supportPlateMat);
    supportPlate.position.set(0, 75, 0);
    supportPlate.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative support plate',
      materialName: 'Unspecified illustrative material'
    };
    group.add(supportPlate);

    // Gimbal Ring
    const gimbalGeom = new THREE.TorusGeometry(18, 2.2, 16, 32);
    const gimbalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9 });
    const gimbalRing = new THREE.Mesh(gimbalGeom, gimbalMat);
    gimbalRing.rotation.x = Math.PI / 2;
    gimbalRing.position.set(0, 68, 0);
    gimbalRing.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative joint ring',
      materialName: 'Unspecified illustrative material'
    };
    group.add(gimbalRing);

    // 3. Illustrative central component
    const centralComponentGeom = new THREE.CylinderGeometry(11, 13, 16, 32);
    const centralComponentMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.92, roughness: 0.2 });
    const centralComponent = new THREE.Mesh(centralComponentGeom, centralComponentMat);
    centralComponent.position.set(0, 56, 0);
    centralComponent.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative central component',
      materialName: 'Unspecified illustrative material'
    };
    group.add(centralComponent);

    // Illustrative connection and indicator shapes; no readings are simulated.
    if (ProceduralHardware) {
      [-18, 18].forEach((x, index) => {
        const connection = ProceduralHardware.createFlangeAssembly(3.5, 7.5, 2.5, 6);
        connection.rotation.z = Math.PI / 2;
        connection.position.set(x, 62, 0);
        connection.userData = {
          isSyntheticExample: true,
          partName: `Illustrative connection shape ${index + 1}`,
          materialName: 'Unspecified illustrative material'
        };
        group.add(connection);

        const indicator = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 3.2, 1.0, 20),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.4, roughness: 0.5 })
        );
        indicator.position.set(x, 68, 0);
        indicator.userData = {
          isSyntheticExample: true,
          partName: `Illustrative indicator shape ${index + 1}`,
          materialName: 'Unspecified illustrative material'
        };
        group.add(indicator);
      });
    }

    // 4. Illustrative nozzle-like form with decorative ribs
    const nozzleH = 46;
    const nozzleGeom = new THREE.CylinderGeometry(8.5, 24.0, nozzleH, 48, 16, true);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04, // Illustrative copper-colored surface
      metalness: 0.95,
      roughness: 0.18,
      side: THREE.DoubleSide
    });
    const nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
    nozzle.position.set(0, 25, 0);
    nozzle.userData = {
      isSyntheticExample: true,
      partName: 'Illustrative nozzle shape',
      materialName: 'Unspecified illustrative material'
    };
    group.add(nozzle);

    // Stiffener Rings on Nozzle
    for (let ny = 10; ny <= 40; ny += 10) {
      const radiusAtY = 8.5 + (24.0 - 8.5) * ((46 - (ny - 2)) / 46);
      const nRing = new THREE.Mesh(
        new THREE.TorusGeometry(radiusAtY + 0.3, 0.45, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x713f12, metalness: 0.9 })
      );
      nRing.rotation.x = Math.PI / 2;
      nRing.position.set(0, ny, 0);
      group.add(nRing);
    }

    // 5. Decorative animated plume-like effect; not a flow solution.
    if (PhenomenaShaders && PhenomenaShaders.createIllustrativePlume) {
      const plume = PhenomenaShaders.createIllustrativePlume({
        visualFrequency: 4,
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
    this.setViewportStats('Synthetic scene geometry only; no engine, materials, instrumentation, or performance model');
  }

  // =========================================================================
  // 3C. Illustrative Aerospace Geometry
  // The legacy method name is retained as an API alias. All scene dimensions,
  // materials, and configurations are synthetic and are not design inputs.
  // =========================================================================

  renderNasaSpaceRocket3D(mode = 'full_stack') {
    this.clearMesh();
    const group = new THREE.Group();

    const BuilderClass =
      typeof NasaSpaceRocket3D !== 'undefined'
        ? NasaSpaceRocket3D
        : typeof window !== 'undefined' && window.NasaSpaceRocket3D
          ? window.NasaSpaceRocket3D
          : null;

    if (BuilderClass) {
      const builder = new BuilderClass();
      builder.buildAssembly(mode, group, {
        ProceduralHardware:
          typeof ProceduralHardware !== 'undefined'
            ? ProceduralHardware
            : typeof window !== 'undefined'
              ? window.ProceduralHardware
              : null,
        ProceduralPbrMaterials:
          typeof ProceduralPbrMaterials !== 'undefined'
            ? ProceduralPbrMaterials
            : typeof window !== 'undefined'
              ? window.ProceduralPbrMaterials
              : null,
        PhenomenaShaders:
          typeof PhenomenaShaders !== 'undefined'
            ? PhenomenaShaders
            : typeof window !== 'undefined'
              ? window.PhenomenaShaders
              : null
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
      this.setViewportStats('Illustrative liquid-propellant engine visualization; no performance model');
    } else if (mode === 'spacecraft_interior' || mode === 'spaceship_interior') {
      if (this.camera && this.controls) {
        this.camera.position.set(0, 20, 48);
        this.controls.target.set(0, 16, 0);
        this.controls.update();
      }
      this.setViewportStats('Illustrative spacecraft interior visualization');
    } else {
      if (this.camera && this.controls) {
        this.camera.position.set(0, 75, 220);
        this.controls.target.set(0, 60, 0);
        this.controls.update();
      }
      this.setViewportStats('Illustrative two-stage launch vehicle visualization; no flight validation');
    }
  }

  // =========================================================================
  // 4. Illustrative stress color map (no solver output)
  // =========================================================================

  renderFEAStressHeatmap(stressLevel = 'normal', maxStressVal = 145) {
    this.clearMesh();
    const group = new THREE.Group();

    // Create synthetic geometry with a decorative color gradient.
    const geom = new THREE.BoxGeometry(75, 8.2, 160, 24, 6, 48);
    const count = geom.attributes.position.count;
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const z = geom.attributes.position.getZ(i);
      const y = geom.attributes.position.getY(i);
      const x = geom.attributes.position.getX(i);

      // Color gradient positioned near one corner for visualization.
      const distFromCorner = Math.sqrt((z - 80) ** 2 + (y + 4.1) ** 2 + (x - 37.5) ** 2);
      const normalizedStress = Math.max(0, 1.0 - distFromCorner / 85.0);

      // Rainbow / Turbo Colormap: Blue (0) -> Cyan (0.25) -> Green (0.5) -> Yellow (0.75) -> Red (1.0)
      let r = 0,
        g = 0,
        b = 0;
      if (normalizedStress < 0.25) {
        r = 0;
        g = normalizedStress * 4;
        b = 1;
      } else if (normalizedStress < 0.5) {
        r = 0;
        g = 1;
        b = 1 - (normalizedStress - 0.25) * 4;
      } else if (normalizedStress < 0.75) {
        r = (normalizedStress - 0.5) * 4;
        g = 1;
        b = 0;
      } else {
        r = 1;
        g = 1 - (normalizedStress - 0.75) * 4;
        b = 0;
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
    mesh.userData = {
      partName: 'Illustrative stress color map geometry',
      materialName: 'Illustrative material (unsourced)'
    };
    group.add(mesh);

    // Subtle element edge wireframe overlay
    const wireGeom = new THREE.WireframeGeometry(geom);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.25 });
    group.add(new THREE.LineSegments(wireGeom, wireMat));

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats('Illustrative stress color map; no solver result is loaded');
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
    mesh.userData = { partName: name, materialName: 'Unspecified illustrative material' };
    group.add(mesh);

    // Precise feature edge outlines
    const edgesGeom = new THREE.EdgesGeometry(geom, 25);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.85 });
    group.add(new THREE.LineSegments(edgesGeom, edgeMat));

    this.currentMesh = group;
    this.scene.add(group);
    this.setViewportStats(`Experimental geometry visualization: ${name}`);
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
    this.setViewportStats('Toolpath preview; no posted machine code or verification');
  }

  setViewportStats(statusText) {
    const statsEl = document.getElementById('viewport-stats');
    if (statsEl) {
      const text = statusText || 'Geometry visualization; render telemetry unavailable';
      statsEl.textContent = text;
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
