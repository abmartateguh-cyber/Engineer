/**
 * OmniEng 3D High-Performance Viewport Controller (WebGL / Three.js)
 * Visualizes parametric CAD geometries, FEA von Mises stress contours, CFD streamlines, and plant piping loops.
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

    // Camera control state
    this.isDragging = false;
    this.isPanning = false;
    this.previousMousePosition = { x: 0, y: 0 };
    this.cameraDistance = 180;
    this.cameraAngle = { theta: 0.6, phi: 0.8 }; // Spherical coordinates
    this.target = new THREE.Vector3(0, 0, 0);

    this.init();
  }

  init() {
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 500;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060911);

    // 2. Camera setup
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    this.updateCameraPosition();

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 4. Lighting (Studio Key + Fill + Rim lighting)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 1.5);
    dirLight1.position.set(100, 150, 100);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight2.position.set(-100, -50, -100);
    this.scene.add(dirLight2);

    // 5. Engineering Ground Grid & Coordinate Triad
    this.gridHelper = new THREE.GridHelper(300, 30, 0x1e293b, 0x0f172a);
    this.gridHelper.position.y = -30;
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(40);
    this.axesHelper.position.set(-120, -29, -120);
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
      if (!this.isDragging && !this.isPanning) return;

      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      if (this.isDragging) {
        // Orbit rotation
        this.cameraAngle.theta -= deltaX * 0.008;
        this.cameraAngle.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.cameraAngle.phi - deltaY * 0.008));
        this.updateCameraPosition();
      } else if (this.isPanning) {
        // Pan target
        const panSpeed = 0.2;
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
      this.cameraDistance = Math.max(20, Math.min(800, this.cameraDistance + e.deltaY * 0.2));
      this.updateCameraPosition();
    });
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
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  clearMesh() {
    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentMesh = null;
    }
  }

  // --- Specialized Engineering Renderers ---

  renderSmartphoneCad(w = 75, h = 8.2, d = 160) {
    this.clearMesh();
    const group = new THREE.Group();

    // Chassis Body (Rounded box)
    const geom = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.25
    });
    const chassis = new THREE.Mesh(geom, mat);
    group.add(chassis);

    // Screen Glass
    const screenGeom = new THREE.BoxGeometry(w - 4, 0.4, d - 8);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.05,
      metalness: 0.95
    });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.y = h / 2 + 0.2;
    group.add(screen);

    // Triple Camera Lens Barrel Bump (Creo/NX Optomechanics)
    const bumpGeom = new THREE.BoxGeometry(28, 3.5, 32);
    const bumpMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
    const bump = new THREE.Mesh(bumpGeom, bumpMat);
    bump.position.set(-w / 4, -h / 2 - 1.75, -d / 3);
    group.add(bump);

    for (let i = 0; i < 3; i++) {
      const lensGeom = new THREE.CylinderGeometry(4.5, 4.5, 4.2, 24);
      const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.95 });
      const lens = new THREE.Mesh(lensGeom, lensMat);
      lens.position.set(-w / 4 + (i === 2 ? 6 : -6), -h / 2 - 2.5, -d / 3 + (i % 2 === 0 ? -6 : 6));
      group.add(lens);
    }

    // Edge wireframe highlight
    const wireGeom = new THREE.EdgesGeometry(geom);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1 });
    const wire = new THREE.LineSegments(wireGeom, wireMat);
    group.add(wire);

    this.currentMesh = group;
    this.scene.add(group);
  }

  renderFEAStressHeatmap(stressLevel = 'normal') {
    this.clearMesh();
    const group = new THREE.Group();

    // Create discretized phone mesh with vertex colors representing von Mises stress
    const geom = new THREE.BoxGeometry(75, 8.2, 160, 16, 4, 32);
    const count = geom.attributes.position.count;
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const z = geom.attributes.position.getZ(i);
      const y = geom.attributes.position.getY(i);
      // High stress concentrated at bottom corner (drop impact zone)
      const distFromCorner = Math.sqrt((z - 80)**2 + (y + 4.1)**2);
      const normalizedStress = Math.max(0, 1.0 - distFromCorner / 90.0);

      // Colormap from Blue (low stress) -> Cyan -> Yellow -> Red (critical stress)
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
      roughness: 0.3,
      metalness: 0.4
    });

    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);

    // Wireframe overlay
    const wireGeom = new THREE.WireframeGeometry(geom);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.25 });
    group.add(new THREE.LineSegments(wireGeom, wireMat));

    this.currentMesh = group;
    this.scene.add(group);
  }

  renderDrone3D(armLength = 80) {
    this.clearMesh();
    const group = new THREE.Group();

    // Central Carbon Fiber Pod
    const podGeom = new THREE.CylinderGeometry(15, 18, 12, 16);
    const podMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.8 });
    group.add(new THREE.Mesh(podGeom, podMat));

    // 4 Carbon Fiber Arms (X-layout)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const x = armLength * Math.cos(angle);
      const z = armLength * Math.sin(angle);

      // Arm Tube
      const armGeom = new THREE.CylinderGeometry(2.5, 2.5, armLength, 12);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
      const arm = new THREE.Mesh(armGeom, armMat);
      arm.position.set(x / 2, 0, z / 2);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0, z).normalize());
      group.add(arm);

      // Brushless Motor
      const motorGeom = new THREE.CylinderGeometry(5, 5, 8, 16);
      const motorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.95 });
      const motor = new THREE.Mesh(motorGeom, motorMat);
      motor.position.set(x, 4, z);
      group.add(motor);

      // Propeller (2-blade)
      const propGeom = new THREE.BoxGeometry(38, 0.8, 4);
      const propMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
      const prop = new THREE.Mesh(propGeom, propMat);
      prop.position.set(x, 8.5, z);
      group.add(prop);
    }

    this.currentMesh = group;
    this.scene.add(group);
  }

  renderPipingLoop3D(straightLength = 40, loopWidth = 10, pipeDiameter = 6) {
    this.clearMesh();
    const group = new THREE.Group();

    const path = new THREE.CurvePath();
    const halfL = straightLength / 2;
    const loopH = loopWidth * 1.2;

    // Build 3D expansion loop path
    path.add(new THREE.LineCurve3(new THREE.Vector3(-halfL, 0, 0), new THREE.Vector3(-loopWidth / 2, 0, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, 0, 0), new THREE.Vector3(-loopWidth / 2, loopH, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(-loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, loopH, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, loopH, 0), new THREE.Vector3(loopWidth / 2, 0, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(loopWidth / 2, 0, 0), new THREE.Vector3(halfL, 0, 0)));

    const tubeGeom = new THREE.TubeGeometry(path, 64, pipeDiameter / 2, 16, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.7,
      roughness: 0.3
    });
    group.add(new THREE.Mesh(tubeGeom, tubeMat));

    // Flange Anchors at ends
    const flangeGeom = new THREE.CylinderGeometry(pipeDiameter * 0.9, pipeDiameter * 0.9, 2.5, 16);
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9 });
    const f1 = new THREE.Mesh(flangeGeom, flangeMat);
    f1.rotation.z = Math.PI / 2;
    f1.position.set(-halfL, 0, 0);
    group.add(f1);

    const f2 = new THREE.Mesh(flangeGeom, flangeMat);
    f2.rotation.z = Math.PI / 2;
    f2.position.set(halfL, 0, 0);
    group.add(f2);

    this.currentMesh = group;
    this.scene.add(group);
  }
}

window.Viewport3D = Viewport3D;
