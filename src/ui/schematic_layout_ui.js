/**
 * OmniEng 2D EDA Nanometer Layout & ANSI/ISA-5.1 P&ID Schematic Canvas Engine
 * High-performance pan/zoom canvas supporting multi-layer IC layout, DRC inspection,
 * and comprehensive refinery process flowsheet with instrument control loops.
 */

class SchematicLayoutUI {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'eda'; // 'eda' or 'pid'
    this.drcViolations = [];

    // Pan & Zoom Camera State
    this.zoom = 1.0;
    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.lastMouse = { x: 0, y: 0 };
    this.cursorCoords = { x: 0, y: 0, nmX: 0, nmY: 0 };
    this.hoveredEntity = null;
    this.selectedEntity = null;

    // Layer Visibility
    this.layers = {
      nwell: true,
      psub: true,
      poly: true,
      metal1: true,
      metal2: true,
      vias: true,
      labels: true,
      drc: true
    };

    // Standard CMOS Library Cells
    this.edaCells = [
      { id: 'c1', name: 'NAND2_X1', x: 80, y: 140, w: 120, h: 220, type: '2-Input NAND Gate', delay: '6.4 ps', area: '18.2 nm²' },
      { id: 'c2', name: 'INV_X1',   x: 240, y: 140, w: 80,  h: 220, type: 'Inverter Buffer', delay: '3.8 ps', area: '12.1 nm²' },
      { id: 'c3', name: 'DFF_X1',   x: 360, y: 140, w: 170, h: 220, type: 'D-Flip-Flop Register', delay: '12.1 ps', area: '34.8 nm²' },
      { id: 'c4', name: 'NOR2_X1',  x: 570, y: 140, w: 130, h: 220, type: '2-Input NOR Gate', delay: '7.1 ps', area: '19.5 nm²' },
      { id: 'c5', name: 'AOI21_X1', x: 740, y: 140, w: 140, h: 220, type: 'And-Or-Invert Complex', delay: '8.9 ps', area: '22.0 nm²' }
    ];

    // P&ID Process Stream Data Tags (ANSI/ISA-5.1)
    this.pidStreams = [
      { id: 'ST-101', name: 'Crude Feed', x: 60, y: 240, temp: '350.0 °C', press: '3.50 bar', flow: '50,000 BPD', phase: 'Liquid/Vapor' },
      { id: 'ST-102', name: 'Overhead Naphtha', x: 450, y: 100, temp: '110.0 °C', press: '1.80 bar', flow: '12,500 BPD', phase: 'Vapor' },
      { id: 'ST-103', name: 'Reflux Return', x: 420, y: 190, temp: '95.0 °C', press: '2.40 bar', flow: '15,200 BPD', phase: 'Liquid' },
      { id: 'ST-104', name: 'Kerosene Side-Cut', x: 440, y: 275, temp: '185.0 °C', press: '2.10 bar', flow: '8,200 BPD', phase: 'Liquid' },
      { id: 'ST-105', name: 'Diesel Fuel Cut', x: 440, y: 355, temp: '260.0 °C', press: '2.60 bar', flow: '14,300 BPD', phase: 'Liquid' },
      { id: 'ST-106', name: 'Atmospheric Residue', x: 440, y: 440, temp: '360.0 °C', press: '3.20 bar', flow: '15,000 BPD', phase: 'Heavy Liquid' }
    ];

    this.init();
  }

  init() {
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.setupInteractions();
    this.render();
  }

  onResize() {
    this.canvas.width = this.canvas.clientWidth || 800;
    this.canvas.height = this.canvas.clientHeight || 500;
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.pan = { x: 0, y: 0 };
    this.zoom = 1.0;
    this.selectedEntity = null;
    this.render();
  }

  toggleLayer(layerName) {
    if (this.layers[layerName] !== undefined) {
      this.layers[layerName] = !this.layers[layerName];
      this.render();
    }
  }

  setDRCViolations(violations) {
    this.drcViolations = violations || [];
    this.render();
  }

  setupInteractions() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isPanning = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isPanning) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.pan.x += dx;
        this.pan.y += dy;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.render();
      }

      // Compute Nanometer Coordinates
      const worldX = (mouseX - this.pan.x) / this.zoom;
      const worldY = (mouseY - this.pan.y) / this.zoom;
      this.cursorCoords = {
        x: mouseX,
        y: mouseY,
        nmX: Number((worldX * 2.5).toFixed(1)), // Scale 1px = 2.5 nm
        nmY: Number((worldY * 2.5).toFixed(1))
      };

      // Hover Hit Testing
      this.checkHover(worldX, worldY);
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newZoom = Math.max(0.3, Math.min(6.0, this.zoom * zoomFactor));

      // Zoom towards mouse pointer
      this.pan.x = mouseX - (mouseX - this.pan.x) * (newZoom / this.zoom);
      this.pan.y = mouseY - (mouseY - this.pan.y) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.render();
    }, { passive: false });

    this.canvas.addEventListener('dblclick', () => {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.0;
      this.selectedEntity = null;
      this.render();
    });

    this.canvas.addEventListener('click', () => {
      if (this.hoveredEntity) {
        this.selectedEntity = this.hoveredEntity;
        this.render();
      } else {
        this.selectedEntity = null;
        this.render();
      }
    });
  }

  checkHover(wx, wy) {
    let hit = null;

    if (this.mode === 'eda') {
      for (const cell of this.edaCells) {
        if (wx >= cell.x && wx <= cell.x + cell.w && wy >= cell.y && wy <= cell.y + cell.h) {
          hit = { type: 'cell', data: cell };
          break;
        }
      }
      if (!hit && this.layers.drc && this.drcViolations) {
        for (const v of this.drcViolations) {
          if (wx >= v.location.x && wx <= v.location.x + 40 && wy >= v.location.y && wy <= v.location.y + 40) {
            hit = { type: 'drc', data: v };
            break;
          }
        }
      }
    } else {
      for (const stream of this.pidStreams) {
        if (Math.abs(wx - stream.x) < 45 && Math.abs(wy - stream.y) < 20) {
          hit = { type: 'stream', data: stream };
          break;
        }
      }
    }

    if (this.hoveredEntity !== hit) {
      this.hoveredEntity = hit;
      this.render();
    }
  }

  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark Substrate Background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Pan & Zoom Transform
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(this.zoom, this.zoom);

    if (this.mode === 'eda') {
      this.renderEdaLayout();
    } else {
      this.renderPlantPID();
    }

    ctx.restore();

    // Render Foreground HUD (Nanometer coordinates, Layer Bar, Info Tooltip)
    this.renderHUD();
  }

  renderEdaLayout() {
    const { ctx } = this;

    // 1. Nanometer Fine Grid
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1 / this.zoom;
    const gridPitch = 40;
    const minX = -this.pan.x / this.zoom;
    const maxX = (this.canvas.width - this.pan.x) / this.zoom;
    const minY = -this.pan.y / this.zoom;
    const maxY = (this.canvas.height - this.pan.y) / this.zoom;

    for (let x = Math.floor(minX / gridPitch) * gridPitch; x < maxX; x += gridPitch) {
      ctx.beginPath();
      ctx.moveTo(x, minY); ctx.lineTo(x, maxY);
      ctx.stroke();
    }
    for (let y = Math.floor(minY / gridPitch) * gridPitch; y < maxY; y += gridPitch) {
      ctx.beginPath();
      ctx.moveTo(minX, y); ctx.lineTo(maxX, y);
      ctx.stroke();
    }

    // 2. Continuous Power Rails (VDD Top & VSS Bottom in Metal 1)
    if (this.layers.metal1) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.fillRect(40, 60, 900, 36);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('VDD Core Power Grid (Metal 1 • 0.75V VDD)', 60, 82);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.fillRect(40, 420, 900, 36);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('VSS Ground Return Grid (Metal 1 • 0.0V GND)', 60, 442);
    }

    // 3. Render Standard Cells & CMOS Layers
    for (const c of this.edaCells) {
      const isSelected = this.selectedEntity && this.selectedEntity.data.id === c.id;

      // N-Well Layer (PMOS Active Region)
      if (this.layers.nwell) {
        ctx.fillStyle = 'rgba(225, 29, 72, 0.22)';
        ctx.fillRect(c.x, c.y, c.w, c.h * 0.48);
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x, c.y, c.w, c.h * 0.48);
      }

      // P-Substrate Layer (NMOS Active Region)
      if (this.layers.psub) {
        ctx.fillStyle = 'rgba(5, 150, 105, 0.22)';
        ctx.fillRect(c.x, c.y + c.h * 0.52, c.w, c.h * 0.48);
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x, c.y + c.h * 0.52, c.w, c.h * 0.48);
      }

      // Standard Cell Boundary
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.strokeRect(c.x, c.y, c.w, c.h);

      // Poly Silicon Gates (Vertical 3nm Fins / Gates)
      if (this.layers.poly) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.85)';
        const gatePitch = 24;
        for (let gx = c.x + 20; gx < c.x + c.w - 15; gx += gatePitch) {
          ctx.fillRect(gx, c.y + 12, 10, c.h - 24);
        }
      }

      // Metal 1 Local Routing
      if (this.layers.metal1) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.fillRect(c.x + 12, c.y + 50, c.w - 24, 16);
        ctx.fillRect(c.x + 12, c.y + c.h - 66, c.w - 24, 16);
      }

      // Metal 2 Vertical Signal Routing
      if (this.layers.metal2) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.65)';
        ctx.fillRect(c.x + c.w / 2 - 8, c.y + 20, 16, c.h - 40);
      }

      // Contact Vias
      if (this.layers.vias) {
        ctx.fillStyle = '#ffffff';
        const viaPoints = [
          { x: c.x + 22, y: c.y + 54 },
          { x: c.x + 46, y: c.y + 54 },
          { x: c.x + 22, y: c.y + c.h - 62 },
          { x: c.x + 46, y: c.y + c.h - 62 },
          { x: c.x + c.w / 2 - 4, y: c.y + 100 }
        ];
        viaPoints.forEach(p => ctx.fillRect(p.x, p.y, 8, 8));
      }

      // Cell Label
      if (this.layers.labels) {
        ctx.fillStyle = isSelected ? '#38bdf8' : '#f8fafc';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(c.name, c.x + 10, c.y + 24);
      }
    }

    // 4. Calibre DRC Violation Error Markers
    if (this.layers.drc && this.drcViolations && this.drcViolations.length > 0) {
      for (const v of this.drcViolations) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(v.location.x, v.location.y, 45, 45);
        ctx.setLineDash([]);

        // Violation Marker Icon & Text
        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`⚠ DRC: ${v.type}`, v.location.x, v.location.y - 6);
      }
    }
  }

  renderPlantPID() {
    const { ctx } = this;

    // Atmospheric Distillation Column V-101
    const colX = 260, colY = 90, colW = 90, colH = 340;
    ctx.fillStyle = '#162032';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;

    // Column Vessel Shell
    ctx.beginPath();
    ctx.roundRect(colX, colY, colW, colH, 24);
    ctx.fill();
    ctx.stroke();

    // Column Identification
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('CRUDE TOWER', colX + colW / 2, colY + 36);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('V-101 (30 Sieve Trays)', colX + colW / 2, colY + 54);

    // Trays Internal Representation
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (let y = colY + 70; y < colY + colH - 40; y += 16) {
      ctx.beginPath();
      ctx.moveTo(colX + 10, y); ctx.lineTo(colX + colW - 10, y);
      ctx.stroke();
    }

    // 1. Crude Feed Stream Line (ST-101)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(40, 240);
    ctx.lineTo(colX, 240);
    ctx.stroke();

    // 2. Overhead Vapor Line & Condenser E-101
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(colX + colW / 2, colY);
    ctx.lineTo(colX + colW / 2, colY - 45);
    ctx.lineTo(colX + colW + 160, colY - 45);
    ctx.stroke();

    // Overhead Condenser Heat Exchanger E-101 (Circle with inner shell tubes)
    const condX = colX + colW + 160, condY = colY - 45;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(condX, condY, 28, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('E-101', condX, condY + 4);

    // Condenser to Reflux Drum V-102
    const drumX = condX + 90, drumY = condY + 90;
    ctx.beginPath();
    ctx.moveTo(condX + 28, condY);
    ctx.lineTo(drumX, condY);
    ctx.lineTo(drumX, drumY - 25);
    ctx.stroke();

    // Horizontal Reflux Drum Vessel V-102
    ctx.fillStyle = '#162032';
    ctx.beginPath();
    ctx.roundRect(drumX - 35, drumY - 20, 70, 40, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('V-102', drumX, drumY + 4);

    // Reflux Pump P-101A/B (Centrifugal Pump Symbol)
    const pumpX = drumX, pumpY = drumY + 70;
    ctx.beginPath();
    ctx.moveTo(drumX, drumY + 20);
    ctx.lineTo(pumpX, pumpY - 18);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(pumpX, pumpY, 18, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#10b981';
    ctx.fillText('P-101', pumpX, pumpY + 4);

    // Reflux return to column top
    ctx.beginPath();
    ctx.moveTo(pumpX - 18, pumpY);
    ctx.lineTo(colX + colW, pumpY);
    ctx.stroke();

    // ANSI Control Valve on Reflux Line (FCV-101)
    const vX = colX + colW + 70, vY = pumpY;
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(vX - 10, vY - 8); ctx.lineTo(vX + 10, vY + 8);
    ctx.lineTo(vX + 10, vY - 8); ctx.lineTo(vX - 10, vY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Diaphragm Actuator Symbol
    ctx.beginPath();
    ctx.moveTo(vX, vY - 8); ctx.lineTo(vX, vY - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(vX, vY - 24, 9, Math.PI, 0);
    ctx.fill();
    ctx.stroke();

    // ISA Instrument Bubble: FIC-101 (Flow Indicator Controller)
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(vX, vY - 48, 16, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vX - 16, vY - 48); ctx.lineTo(vX + 16, vY - 48);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('FIC', vX, vY - 51);
    ctx.fillText('101', vX, vY - 40);

    // Draw Process Stream Data Callout Flags
    for (const stream of this.pidStreams) {
      const isHovered = this.hoveredEntity && this.hoveredEntity.data.id === stream.id;
      ctx.fillStyle = isHovered ? '#38bdf8' : '#1e293b';
      ctx.strokeStyle = isHovered ? '#38bdf8' : '#64748b';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.roundRect(stream.x - 35, stream.y - 12, 70, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isHovered ? '#090d16' : '#f8fafc';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(stream.id, stream.x, stream.y + 4);
    }
  }

  renderHUD() {
    const { ctx, canvas } = this;

    // Top-Left Coordinates & Mode Banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(14, 14, 280, 52, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(this.mode === 'eda' ? 'TSMC N3P Silicon Wafer Layout View' : 'ANSI/ISA-5.1 Refinery P&ID Flowsheet', 24, 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    if (this.mode === 'eda') {
      ctx.fillText(`Cursor: X=${this.cursorCoords.nmX}nm  Y=${this.cursorCoords.nmY}nm | Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 50);
    } else {
      ctx.fillText(`Crude Tower V-101 | 50k BPD | Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 50);
    }

    // Interactive Hover / Selection Inspector Tooltip
    const active = this.selectedEntity || this.hoveredEntity;
    if (active) {
      const cardW = 260, cardH = 90;
      const cardX = canvas.width - cardW - 14;
      const cardY = 14;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 6);
      ctx.fill();
      ctx.stroke();

      if (active.type === 'cell') {
        const c = active.data;
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`Cell: ${c.name} (${c.type})`, cardX + 12, cardY + 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(`Propagation Delay: ${c.delay}`, cardX + 12, cardY + 42);
        ctx.fillText(`Silicon Footprint: ${c.area}`, cardX + 12, cardY + 60);
        ctx.fillText(`Drive Strength: 1X • Fin Count: 4`, cardX + 12, cardY + 78);
      } else if (active.type === 'drc') {
        const d = active.data;
        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`⚠ DRC Violation: ${d.type}`, cardX + 12, cardY + 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(`Measured: ${d.measured}nm < Limit: ${d.rule}nm`, cardX + 12, cardY + 42);
        ctx.fillText(`Layer: Metal 1 Signal Track`, cardX + 12, cardY + 60);
        ctx.fillText(`Status: Foundry Rule Error`, cardX + 12, cardY + 78);
      } else if (active.type === 'stream') {
        const s = active.data;
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`Stream: ${s.id} (${s.name})`, cardX + 12, cardY + 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(`Temperature: ${s.temp}`, cardX + 12, cardY + 42);
        ctx.fillText(`Operating Pressure: ${s.press}`, cardX + 12, cardY + 60);
        ctx.fillText(`Mass Flow Rate: ${s.flow}`, cardX + 12, cardY + 78);
      }
    }
  }
}

window.SchematicLayoutUI = SchematicLayoutUI;
