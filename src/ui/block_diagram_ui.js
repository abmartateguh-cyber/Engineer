/**
 * OmniEng 2D Dynamic Simulink Block Diagram Canvas & Interactive Wire Editor
 * Supports drag-and-drop block positioning, dynamic bezier wire routing, preset architectures,
 * and high-refresh animated virtual oscilloscope scope displays.
 */

class BlockDiagramUI {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // Pan & Zoom Camera
    this.zoom = 1.0;
    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.draggedBlock = null;
    this.dragOffset = { x: 0, y: 0 };
    this.selectedBlock = null;
    this.lastMouse = { x: 0, y: 0 };

    // Oscilloscope Animation State
    this.scopeTime = 0.0;
    this.animFrameId = null;

    // Default System: Drone Flight Altitude Cascaded PID
    this.blocks = [
      { id: 'b1', type: 'Step Input', name: 'Altitude Setpoint (12m)', x: 40, y: 150, w: 110, h: 60, params: { finalValue: 12.0, stepTime: 0.5 } },
      { id: 'b2', type: 'Sum (+ -)', name: 'Error Sum Junction', x: 200, y: 160, w: 45, h: 45, params: {} },
      { id: 'b3', type: 'PID Controller', name: 'Cascaded Altitude PID', x: 290, y: 145, w: 140, h: 75, params: { Kp: 2.8, Ki: 0.6, Kd: 0.15 } },
      { id: 'b4', type: 'Actuator / ESC', name: 'Electronic Speed Controller', x: 475, y: 145, w: 130, h: 75, params: { maxRPM: 8500, tau: 0.02 } },
      { id: 'b5', type: 'Quadcopter Plant', name: '6-DOF Rigid Airframe', x: 650, y: 145, w: 135, h: 75, params: { massKg: 0.85, Izz: 0.005 } },
      { id: 'b6', type: 'Digital Scope', name: 'Real-Time Telemetry Scope', x: 830, y: 120, w: 200, h: 130, params: { vDiv: 2.0, tDiv: 0.5 } }
    ];

    this.wires = [
      { from: 'b1', to: 'b2' },
      { from: 'b2', to: 'b3' },
      { from: 'b3', to: 'b4' },
      { from: 'b4', to: 'b5' },
      { from: 'b5', to: 'b6' }
    ];

    this.init();
  }

  init() {
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    if (typeof ResizeObserver !== 'undefined') {
      const host = this.canvas.closest('.canvas-host') || this.canvas.parentElement;
      if (host) {
        this._resizeObs = new ResizeObserver(() => this.onResize());
        this._resizeObs.observe(host);
      }
    }
    this.setupInteractions();
    this.startOscilloscopeAnimation();
    this.render();
  }

  onResize() {
    this.canvas.width = this.canvas.clientWidth || 800;
    this.canvas.height = this.canvas.clientHeight || 500;
    this.render();
  }

  setupInteractions() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldX = (mouseX - this.pan.x) / this.zoom;
      const worldY = (mouseY - this.pan.y) / this.zoom;

      // Check if clicking inside a block for dragging
      let hit = null;
      for (let i = this.blocks.length - 1; i >= 0; i--) {
        const b = this.blocks[i];
        if (worldX >= b.x && worldX <= b.x + b.w && worldY >= b.y && worldY <= b.y + b.h) {
          hit = b;
          break;
        }
      }

      if (hit) {
        this.draggedBlock = hit;
        this.selectedBlock = hit;
        this.dragOffset = { x: worldX - hit.x, y: worldY - hit.y };
      } else {
        this.isPanning = true;
        this.selectedBlock = null;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
      this.render();
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.draggedBlock) {
        const worldX = (mouseX - this.pan.x) / this.zoom;
        const worldY = (mouseY - this.pan.y) / this.zoom;
        // Snap to 5px grid for clean alignment
        this.draggedBlock.x = Math.round((worldX - this.dragOffset.x) / 5) * 5;
        this.draggedBlock.y = Math.round((worldY - this.dragOffset.y) / 5) * 5;
        this.render();
      } else if (this.isPanning) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.pan.x += dx;
        this.pan.y += dy;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      this.draggedBlock = null;
      this.isPanning = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newZoom = Math.max(0.4, Math.min(3.0, this.zoom * zoomFactor));

      this.pan.x = mouseX - (mouseX - this.pan.x) * (newZoom / this.zoom);
      this.pan.y = mouseY - (mouseY - this.pan.y) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.render();
    }, { passive: false });

    this.canvas.addEventListener('dblclick', () => {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.0;
      this.selectedBlock = null;
      this.render();
    });
  }

  loadPreset(presetName) {
    if (presetName === 'drone') {
      this.blocks = [
        { id: 'b1', type: 'Step Input', name: 'Altitude Setpoint (12m)', x: 40, y: 150, w: 110, h: 60, params: { finalValue: 12.0 } },
        { id: 'b2', type: 'Sum (+ -)', name: 'Error Sum Junction', x: 200, y: 160, w: 45, h: 45, params: {} },
        { id: 'b3', type: 'PID Controller', name: 'Cascaded Altitude PID', x: 290, y: 145, w: 140, h: 75, params: { Kp: 2.8, Ki: 0.6, Kd: 0.15 } },
        { id: 'b4', type: 'Actuator / ESC', name: 'Electronic Speed Controller', x: 475, y: 145, w: 130, h: 75, params: { maxRPM: 8500 } },
        { id: 'b5', type: 'Quadcopter Plant', name: '6-DOF Rigid Airframe', x: 650, y: 145, w: 135, h: 75, params: { massKg: 0.85 } },
        { id: 'b6', type: 'Digital Scope', name: 'Real-Time Telemetry Scope', x: 830, y: 120, w: 200, h: 130, params: {} }
      ];
    } else if (presetName === 'thermal') {
      this.blocks = [
        { id: 'b1', type: 'Step Input', name: 'Gaming Workload (8.5W)', x: 40, y: 150, w: 120, h: 60, params: { finalValue: 8.5 } },
        { id: 'b2', type: 'Sum (+ -)', name: 'Sum Junction', x: 210, y: 160, w: 45, h: 45, params: {} },
        { id: 'b3', type: 'PID Controller', name: 'PMIC DVFS Thermal Governor', x: 300, y: 145, w: 150, h: 75, params: { Kp: 1.2, Ki: 0.05, Kd: 0.0 } },
        { id: 'b4', type: 'Thermal Plant', name: 'Vapor Chamber CHT Model', x: 495, y: 145, w: 145, h: 75, params: { Rth: 2.1, Cth: 15.0 } },
        { id: 'b5', type: 'Digital Scope', name: 'SoC Temperature Scope', x: 685, y: 120, w: 200, h: 130, params: {} }
      ];
      this.wires = [
        { from: 'b1', to: 'b2' },
        { from: 'b2', to: 'b3' },
        { from: 'b3', to: 'b4' },
        { from: 'b4', to: 'b5' }
      ];
    }
    this.render();
  }

  startOscilloscopeAnimation() {
    const loop = () => {
      this.scopeTime += 0.04;
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark Substrate Background
    ctx.fillStyle = '#090e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Pan & Zoom Transform
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(this.zoom, this.zoom);

    // 1. Engineering Dot Grid
    ctx.fillStyle = '#1e293b';
    const gridSize = 25;
    const minX = -this.pan.x / this.zoom;
    const maxX = (canvas.width - this.pan.x) / this.zoom;
    const minY = -this.pan.y / this.zoom;
    const maxY = (canvas.height - this.pan.y) / this.zoom;

    for (let x = Math.floor(minX / gridSize) * gridSize; x < maxX; x += gridSize) {
      for (let y = Math.floor(minY / gridSize) * gridSize; y < maxY; y += gridSize) {
        ctx.fillRect(x, y, 1.8, 1.8);
      }
    }

    // 2. Draw Bezier Signal Wires
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#38bdf8';

    for (const wire of this.wires) {
      const src = this.blocks.find(b => b.id === wire.from);
      const dst = this.blocks.find(b => b.id === wire.to);
      if (src && dst) {
        const x1 = src.x + src.w;
        const y1 = src.y + src.h / 2;
        const x2 = dst.x;
        const y2 = dst.y + dst.h / 2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const dx = Math.abs(x2 - x1) * 0.5;
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
        ctx.stroke();

        // Arrow head indicator
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 8, y2 - 4.5);
        ctx.lineTo(x2 - 8, y2 + 4.5);
        ctx.fill();
      }
    }

    // Negative Feedback Loop wire (Plant -> Sum)
    const plant = this.blocks.find(b => b.type.includes('Plant'));
    const sum = this.blocks.find(b => b.type.includes('Sum'));
    if (plant && sum) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const fbStartX = plant.x + plant.w;
      const fbStartY = plant.y + plant.h * 0.6;
      ctx.moveTo(fbStartX, fbStartY);
      ctx.lineTo(fbStartX + 20, fbStartY);
      ctx.lineTo(fbStartX + 20, plant.y + plant.h + 50);
      ctx.lineTo(sum.x + sum.w / 2, plant.y + plant.h + 50);
      ctx.lineTo(sum.x + sum.w / 2, sum.y + sum.h);
      ctx.stroke();

      // Negative feedback symbol '-'
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('−', sum.x + sum.w / 2 + 6, sum.y + sum.h + 16);
    }

    // 3. Draw Functional Simulation Blocks
    for (const b of this.blocks) {
      const isSelected = this.selectedBlock && this.selectedBlock.id === b.id;

      // Drop Shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;

      // Block Body Fill
      ctx.fillStyle = b.type.startsWith('Digital Scope') ? '#070c18' : '#162032';
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';

      // Top Header Stripe
      ctx.fillStyle = b.type.includes('PID') ? '#818cf8' : b.type.includes('Scope') ? '#10b981' : '#38bdf8';
      ctx.fillRect(b.x, b.y, b.w, 4);

      // Connection Port Dots (Inputs on left, Outputs on right)
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(b.x, b.y + b.h / 2, 4.5, 0, 2 * Math.PI);
      ctx.arc(b.x + b.w, b.y + b.h / 2, 4.5, 0, 2 * Math.PI);
      ctx.fill();

      // Block Type Name
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(b.type, b.x + b.w / 2, b.y + 20);

      // Block Instance Label / Subtitle
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px system-ui';
      ctx.fillText(b.name, b.x + b.w / 2, b.y + 36);

      // Parameter Readouts
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#38bdf8';
      if (b.type.includes('PID')) {
        ctx.fillText(`Kp: ${b.params.Kp}  Ki: ${b.params.Ki}  Kd: ${b.params.Kd}`, b.x + b.w / 2, b.y + 58);
      } else if (b.type.includes('Step')) {
        ctx.fillText(`Target: ${b.params.finalValue}m`, b.x + b.w / 2, b.y + 52);
      } else if (b.type.includes('Actuator')) {
        ctx.fillText(`Max: ${b.params.maxRPM} RPM`, b.x + b.w / 2, b.y + 56);
      } else if (b.type.includes('Quadcopter')) {
        ctx.fillText(`Mass: ${b.params.massKg} kg`, b.x + b.w / 2, b.y + 56);
      } else if (b.type.includes('Digital Scope')) {
        // High-Refresh Virtual Oscilloscope CRT View
        const sx = b.x + 10, sy = b.y + 44, sw = b.w - 20, sh = b.h - 52;
        ctx.fillStyle = '#030712';
        ctx.fillRect(sx, sy, sw, sh);

        // Graticule Grid
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let gx = sx; gx <= sx + sw; gx += sw / 5) {
          ctx.beginPath(); ctx.moveTo(gx, sy); ctx.lineTo(gx, sy + sh); ctx.stroke();
        }
        for (let gy = sy; gy <= sy + sh; gy += sh / 4) {
          ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx + sw, gy); ctx.stroke();
        }

        // Live Animated Closed-Loop Step Response Signal Trace
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const pts = 40;
        const targetLevel = sy + sh * 0.25;

        // Draw setpoint dashed line
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, targetLevel); ctx.lineTo(sx + sw, targetLevel);
        ctx.stroke();
        ctx.setLineDash([]);

        // Phosphor Trace with slight decay glow
        ctx.strokeStyle = '#10b981';
        ctx.beginPath();
        for (let i = 0; i < pts; i++) {
          const px = sx + (i / pts) * sw;
          const t = (i / pts) * 3.5;
          // Step response with second-order damped overshoot
          const damping = Math.exp(-t * 1.4);
          const response = 1.0 - damping * Math.cos(t * 3.8);
          // Add slight high-frequency sensor noise & time sweep
          const noise = Math.sin(t * 18 + this.scopeTime) * 0.03;
          const py = sy + sh - ((response + noise) * (sh * 0.65));

          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Scope Telemetry HUD
        ctx.fillStyle = '#10b981';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('CH1: 2V/div  T: 0.5s/div  Mp: 8.2%', sx + 4, sy + sh - 4);
      }
    }

    ctx.restore();

    // Top-Left Header Badge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(14, 14, 300, 48, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Dynamic Simulink Block Diagram Simulator', 24, 32);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('Drag blocks to route wires • Click to inspect • Zoom: ' + (this.zoom * 100).toFixed(0) + '%', 24, 48);
  }
}

window.BlockDiagramUI = BlockDiagramUI;
