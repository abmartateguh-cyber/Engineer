/**
 * OmniEng 2D EDA & Process Plant Schematic Canvas Engine
 * Supports TSMC Nanometer IC Layout, 4-Layer High-Density PCB Layout (Altium/Allegro),
 * ANSI/ISA-5.1 Refinery P&ID, Aspen HYSYS P-T Phase Envelope, and Column Tray Profiles.
 */

class SchematicLayoutUI {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'eda'; // 'eda', 'pcb', 'pid', 'vle', 'tray_profile'
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
      drc: true,
      topCopper: true,
      groundPour: true,
      silkscreen: true
    };

    // Standard CMOS Library Cells (IC Wafer)
    this.edaCells = [
      { id: 'c1', name: 'NAND2_X1', x: 80, y: 140, w: 120, h: 220, type: '2-Input NAND Gate', delay: '6.4 ps', area: '18.2 nm²' },
      { id: 'c2', name: 'INV_X1',   x: 240, y: 140, w: 80,  h: 220, type: 'Inverter Buffer', delay: '3.8 ps', area: '12.1 nm²' },
      { id: 'c3', name: 'DFF_X1',   x: 360, y: 140, w: 170, h: 220, type: 'D-Flip-Flop Register', delay: '12.1 ps', area: '34.8 nm²' },
      { id: 'c4', name: 'NOR2_X1',  x: 570, y: 140, w: 130, h: 220, type: '2-Input NOR Gate', delay: '7.1 ps', area: '19.5 nm²' },
      { id: 'c5', name: 'AOI21_X1', x: 740, y: 140, w: 140, h: 220, type: 'And-Or-Invert Complex', delay: '8.9 ps', area: '22.0 nm²' }
    ];

    // PCB Components (Altium Designer 4-Layer Board)
    this.pcbComponents = [
      { id: 'U1', name: 'U1: Apple/Qualcomm 3nm SoC', x: 260, y: 160, w: 140, h: 140, type: 'BGA-153 Package', net: 'VDD_CORE / DDR5', val: 'Octa-Core 3.4 GHz' },
      { id: 'U2', name: 'U2: Power Management PMIC', x: 460, y: 180, w: 80, h: 80, type: 'QFN-32 Exposed Pad', net: 'VBAT / BUCK1-4', val: 'TI LP8756' },
      { id: 'J1', name: 'J1: USB-C Receptacle 24P', x: 60, y: 190, w: 90, h: 80, type: 'USB-C Type-C SMD/TH', net: 'USB3.2 DP/DN / VBUS', val: '100W PD 3.1' },
      { id: 'C1', name: 'C1: Decoupling Cap', x: 220, y: 170, w: 22, h: 14, type: '0402 SMD Cap', net: 'VDD_0V75', val: '22 µF 6.3V X7R' },
      { id: 'C2', name: 'C2: Decoupling Cap', x: 220, y: 200, w: 22, h: 14, type: '0402 SMD Cap', net: 'VDD_0V75', val: '22 µF 6.3V X7R' },
      { id: 'C3', name: 'C3: Decoupling Cap', x: 220, y: 230, w: 22, h: 14, type: '0402 SMD Cap', net: 'VDD_0V75', val: '10 µF 10V X7R' },
      { id: 'L1', name: 'L1: Power Choke Inductor', x: 570, y: 185, w: 45, h: 45, type: 'SMD Molded Choke', net: 'SW_BUCK1', val: '0.47 µH 18A' },
      { id: 'ANT1', name: 'ANT1: Ceramic Wi-Fi 7 Antenna', x: 680, y: 120, w: 60, h: 25, type: 'Chip Antenna', net: 'RF_50_OHM', val: '2.4 / 5 / 6 GHz' }
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

      // Compute Nanometer / Millimeter Coordinates
      const worldX = (mouseX - this.pan.x) / this.zoom;
      const worldY = (mouseY - this.pan.y) / this.zoom;
      this.cursorCoords = {
        x: mouseX,
        y: mouseY,
        nmX: Number((worldX * 2.5).toFixed(1)),
        nmY: Number((worldY * 2.5).toFixed(1)),
        mmX: Number((worldX * 0.1).toFixed(2)),
        mmY: Number((worldY * 0.1).toFixed(2))
      };

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
    } else if (this.mode === 'pcb') {
      for (const comp of this.pcbComponents) {
        if (wx >= comp.x && wx <= comp.x + comp.w && wy >= comp.y && wy <= comp.y + comp.h) {
          hit = { type: 'pcb', data: comp };
          break;
        }
      }
    } else if (this.mode === 'pid') {
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
    ctx.fillStyle = this.mode === 'pcb' ? '#022c22' : '#070b14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Pan & Zoom Transform
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(this.zoom, this.zoom);

    if (this.mode === 'eda') {
      this.renderEdaLayout();
    } else if (this.mode === 'pcb') {
      this.renderPCBLayout();
    } else if (this.mode === 'pid') {
      this.renderPlantPID();
    } else if (this.mode === 'vle') {
      this.renderVLEPhaseEnvelope();
    } else if (this.mode === 'tray_profile') {
      this.renderColumnTrayProfile();
    }

    ctx.restore();

    // Render Foreground HUD (Nanometer coordinates, Layer Bar, Info Tooltip)
    this.renderHUD();
  }

  // =========================================================================
  // 1. Nanometer IC Wafer Layout (TSMC 3nm FinFET / GAA-FET)
  // =========================================================================

  renderEdaLayout() {
    const { ctx } = this;

    // Nanometer Fine Grid
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1 / this.zoom;
    const gridPitch = 40;
    const minX = -this.pan.x / this.zoom;
    const maxX = (this.canvas.width - this.pan.x) / this.zoom;
    const minY = -this.pan.y / this.zoom;
    const maxY = (this.canvas.height - this.pan.y) / this.zoom;

    for (let x = Math.floor(minX / gridPitch) * gridPitch; x < maxX; x += gridPitch) {
      ctx.beginPath(); ctx.moveTo(x, minY); ctx.lineTo(x, maxY); ctx.stroke();
    }
    for (let y = Math.floor(minY / gridPitch) * gridPitch; y < maxY; y += gridPitch) {
      ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke();
    }

    // Power Rails (VDD Top & VSS Bottom in Metal 1)
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

    // Standard Cells & CMOS Layers
    for (const c of this.edaCells) {
      const isSelected = this.selectedEntity && this.selectedEntity.data.id === c.id;

      if (this.layers.nwell) {
        ctx.fillStyle = 'rgba(225, 29, 72, 0.22)';
        ctx.fillRect(c.x, c.y, c.w, c.h * 0.48);
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x, c.y, c.w, c.h * 0.48);
      }

      if (this.layers.psub) {
        ctx.fillStyle = 'rgba(5, 150, 105, 0.22)';
        ctx.fillRect(c.x, c.y + c.h * 0.52, c.w, c.h * 0.48);
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x, c.y + c.h * 0.52, c.w, c.h * 0.48);
      }

      ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.strokeRect(c.x, c.y, c.w, c.h);

      if (this.layers.poly) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.85)';
        for (let gx = c.x + 20; gx < c.x + c.w - 15; gx += 24) {
          ctx.fillRect(gx, c.y + 12, 10, c.h - 24);
        }
      }

      if (this.layers.metal1) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.fillRect(c.x + 12, c.y + 50, c.w - 24, 16);
        ctx.fillRect(c.x + 12, c.y + c.h - 66, c.w - 24, 16);
      }

      if (this.layers.metal2) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.65)';
        ctx.fillRect(c.x + c.w / 2 - 8, c.y + 20, 16, c.h - 40);
      }

      if (this.layers.vias) {
        ctx.fillStyle = '#ffffff';
        const viaPoints = [
          { x: c.x + 22, y: c.y + 54 },
          { x: c.x + 46, y: c.y + 54 },
          { x: c.x + 22, y: c.y + c.h - 62 },
          { x: c.x + 46, y: c.y + c.h - 62 }
        ];
        viaPoints.forEach(p => ctx.fillRect(p.x, p.y, 8, 8));
      }

      if (this.layers.labels) {
        ctx.fillStyle = isSelected ? '#38bdf8' : '#f8fafc';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(c.name, c.x + 10, c.y + 24);
      }
    }

    // DRC Violations
    if (this.layers.drc && this.drcViolations && this.drcViolations.length > 0) {
      for (const v of this.drcViolations) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(v.location.x, v.location.y, 45, 45);
        ctx.setLineDash([]);
        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`⚠ DRC: ${v.type}`, v.location.x, v.location.y - 6);
      }
    }
  }

  // =========================================================================
  // 2. Multi-Layer PCB ECAD Mode (Altium Designer / Cadence Allegro Parity)
  // =========================================================================

  renderPCBLayout() {
    const { ctx } = this;

    // PCB Outer Edge (160mm x 100mm Board with Rounded Corners)
    const bx = 40, by = 60, bw = 800, bh = 420;
    ctx.fillStyle = '#064e3b'; // FR-4 Solder Mask Green
    ctx.strokeStyle = '#eab308'; // Gold ENIG Board Edge
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 14);
    ctx.fill();
    ctx.stroke();

    // Ground Copper Pour Hatching (GND polygon plane)
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.12)';
    ctx.lineWidth = 1;
    for (let x = bx + 20; x < bx + bw - 20; x += 15) {
      ctx.beginPath(); ctx.moveTo(x, by + 10); ctx.lineTo(x, by + bh - 10); ctx.stroke();
    }

    // High-Speed 90-Ohm Differential Pairs (USB-C to SoC) with length matching meanders
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(150, 220);
    ctx.lineTo(190, 220);
    // Serpentine meanders for impedance matching
    ctx.lineTo(195, 205); ctx.lineTo(205, 205); ctx.lineTo(210, 220);
    ctx.lineTo(260, 220);
    ctx.stroke();

    ctx.strokeStyle = '#60a5fa';
    ctx.beginPath();
    ctx.moveTo(150, 230);
    ctx.lineTo(190, 230);
    ctx.lineTo(195, 215); ctx.lineTo(205, 215); ctx.lineTo(210, 230);
    ctx.lineTo(260, 230);
    ctx.stroke();

    // High Current Power Traces (VBAT / 3.3V)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(400, 230);
    ctx.lineTo(460, 230);
    ctx.stroke();

    // Draw SMT Components
    for (const comp of this.pcbComponents) {
      const isSelected = this.selectedEntity && this.selectedEntity.data.id === comp.id;

      // Component Body
      ctx.fillStyle = comp.type.includes('BGA') ? '#1e293b' : comp.type.includes('QFN') ? '#0f172a' : '#1c1917';
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#eab308';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      ctx.beginPath();
      ctx.roundRect(comp.x, comp.y, comp.w, comp.h, 4);
      ctx.fill();
      ctx.stroke();

      // BGA Pin Array Dots
      if (comp.type.includes('BGA')) {
        ctx.fillStyle = '#eab308';
        for (let px = comp.x + 12; px < comp.x + comp.w - 10; px += 14) {
          for (let py = comp.y + 12; py < comp.y + comp.h - 10; py += 14) {
            ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 2 * Math.PI); ctx.fill();
          }
        }
      }

      // Silkscreen RefDes Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText(comp.id, comp.x + 6, comp.y - 6);
    }
  }

  // =========================================================================
  // 3. ANSI/ISA-5.1 Refinery P&ID Flowsheet
  // =========================================================================

  renderPlantPID() {
    const { ctx } = this;
    const colX = 260, colY = 90, colW = 90, colH = 340;
    ctx.fillStyle = '#162032';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(colX, colY, colW, colH, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('CRUDE TOWER', colX + colW / 2, colY + 36);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('V-101 (30 Trays)', colX + colW / 2, colY + 54);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (let y = colY + 70; y < colY + colH - 40; y += 16) {
      ctx.beginPath();
      ctx.moveTo(colX + 10, y); ctx.lineTo(colX + colW - 10, y);
      ctx.stroke();
    }

    // Crude Feed
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(40, 240); ctx.lineTo(colX, 240);
    ctx.stroke();

    // Overhead Condenser E-101
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(colX + colW / 2, colY);
    ctx.lineTo(colX + colW / 2, colY - 45);
    ctx.lineTo(colX + colW + 160, colY - 45);
    ctx.stroke();

    const condX = colX + colW + 160, condY = colY - 45;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(condX, condY, 28, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('E-101', condX, condY + 4);

    // Stream Data Callout Flags
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

  // =========================================================================
  // 4. Aspen HYSYS Peng-Robinson VLE P-T Phase Envelope
  // =========================================================================

  renderVLEPhaseEnvelope() {
    const { ctx, canvas } = this;
    const originX = 90, originY = canvas.height - 80;
    const plotW = canvas.width - 160, plotH = canvas.height - 150;

    // Coordinate Grid & Axes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(originX, originY); ctx.lineTo(originX + plotW, originY);
    ctx.moveTo(originX, originY); ctx.lineTo(originX, originY - plotH);
    ctx.stroke();

    // Axes Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Temperature T (°C)', originX + plotW / 2, originY + 40);
    ctx.save();
    ctx.translate(originX - 50, originY - plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Pressure P (bar)', 0, 0);
    ctx.restore();

    // Saturated Liquid Bubble Point Curve (Blue)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const frac = i / 30;
      const t = -20 + frac * 220;
      const p = 1.0 + Math.pow(frac, 1.8) * 45;
      const px = originX + (t + 40) / 300 * plotW;
      const py = originY - (p / 60) * plotH;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Saturated Vapor Dew Point Curve (Amber)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const frac = i / 30;
      const t = 20 + frac * 220;
      const p = 1.0 + Math.pow(frac, 1.8) * 45;
      const px = originX + (t + 40) / 300 * plotW;
      const py = originY - (p / 60) * plotH;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Cricondenbar Marker (Peak Pressure)
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(originX + 220 / 300 * plotW, originY - (46 / 60) * plotH, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('Critical Point (Pc=46.2 bar, Tc=182°C)', originX + 220 / 300 * plotW + 10, originY - (46 / 60) * plotH);

    // Two-Phase Region Label
    ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText('TWO-PHASE (V+L) COEXISTENCE ENVELOPE', originX + plotW * 0.45, originY - plotH * 0.35);
  }

  // =========================================================================
  // 5. Aspen HYSYS 30-Tray Column Thermal & Composition Profile
  // =========================================================================

  renderColumnTrayProfile() {
    const { ctx, canvas } = this;
    const originX = 90, originY = canvas.height - 80;
    const plotW = canvas.width - 160, plotH = canvas.height - 150;

    // Grid & Axes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(originX, originY); ctx.lineTo(originX + plotW, originY);
    ctx.moveTo(originX, originY); ctx.lineTo(originX, originY - plotH);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Column Tray Position (Overhead Tray 1 ──> Bottoms Tray 30)', originX + plotW / 2, originY + 40);

    // Plot Temperature S-Curve (110°C to 360°C)
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let tray = 1; tray <= 30; tray++) {
      const norm = (tray - 1) / 29;
      const tempC = 110 + (360 - 110) * Math.pow(norm, 1.4);
      const px = originX + norm * plotW;
      const py = originY - ((tempC - 80) / 320) * plotH;
      if (tray === 1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = '#f43f5e';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('Temperature Profile T(j) [110°C - 360°C]', originX + plotW * 0.3, originY - plotH * 0.85);

    // Flash Zone Marker at Tray 22
    const flashX = originX + (21 / 29) * plotW;
    ctx.strokeStyle = '#f59e0b';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(flashX, originY); ctx.lineTo(flashX, originY - plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('Tray 22: Crude Feed Flash Zone', flashX, originY - plotH + 15);
  }

  // =========================================================================
  // Foreground HUD & Tooltips
  // =========================================================================

  renderHUD() {
    const { ctx, canvas } = this;

    // Top-Left Coordinates & Mode Banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(14, 14, 320, 52, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';

    const bannerTitles = {
      eda: 'TSMC N3P Silicon Wafer Mask Layout View',
      pcb: 'Altium Designer 4-Layer High-Speed PCB Layout',
      pid: 'ANSI/ISA-5.1 Refinery P&ID Flowsheet',
      vle: 'Aspen HYSYS Peng-Robinson P-T Phase Envelope',
      tray_profile: 'Aspen HYSYS 30-Tray Column Thermal Profile'
    };

    ctx.fillText(bannerTitles[this.mode] || 'Schematic Layout View', 24, 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    if (this.mode === 'eda') {
      ctx.fillText(`Cursor: X=${this.cursorCoords.nmX}nm  Y=${this.cursorCoords.nmY}nm | Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 50);
    } else if (this.mode === 'pcb') {
      ctx.fillText(`PCB Board: X=${this.cursorCoords.mmX}mm  Y=${this.cursorCoords.mmY}mm | Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 50);
    } else {
      ctx.fillText(`Process Engineering Workspace | Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 50);
    }

    // Interactive Hover / Selection Inspector Tooltip
    const active = this.selectedEntity || this.hoveredEntity;
    if (active) {
      const cardW = 280, cardH = 95;
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
      } else if (active.type === 'pcb') {
        const p = active.data;
        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`Component: ${p.name}`, cardX + 12, cardY + 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(`Package: ${p.type}`, cardX + 12, cardY + 42);
        ctx.fillText(`Netlist: ${p.net}`, cardX + 12, cardY + 60);
        ctx.fillText(`Rating: ${p.val}`, cardX + 12, cardY + 78);
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
