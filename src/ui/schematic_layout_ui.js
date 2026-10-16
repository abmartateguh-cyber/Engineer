/**
 * OmniEng 2D EDA Layout & P&ID Schematic Canvas Renderer
 * Visualizes nanometer chip metal polygons, DRC error markers, and plant P&ID symbols.
 */

class SchematicLayoutUI {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'eda'; // 'eda' or 'pid'
    this.drcViolations = [];
    this.init();
  }

  init() {
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.render();
  }

  onResize() {
    this.canvas.width = this.canvas.clientWidth || 800;
    this.canvas.height = this.canvas.clientHeight || 500;
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.render();
  }

  setDRCViolations(violations) {
    this.drcViolations = violations;
    this.render();
  }

  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.mode === 'eda') {
      this.renderEdaLayout();
    } else {
      this.renderPlantPID();
    }
  }

  renderEdaLayout() {
    const { ctx, canvas } = this;

    // Background Dark Substrate
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Nanometer Coordinate Grid
    ctx.strokeStyle = '#152033';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Metal1 Power Rails (VDD & GND)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.fillRect(40, 40, canvas.width - 80, 25);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px monospace';
    ctx.fillText('VDD Power Rail (Metal 1)', 50, 56);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.fillRect(40, canvas.height - 65, canvas.width - 80, 25);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('VSS Ground Rail (Metal 1)', 50, canvas.height - 49);

    // Standard Cell Rows (CMOS Inverter / NAND Layout)
    const cells = [
      { name: 'NAND2_X1', x: 80, y: 120, w: 100, h: 180 },
      { name: 'INV_X1',   x: 210, y: 120, w: 70, h: 180 },
      { name: 'DFF_X1',   x: 310, y: 120, w: 150, h: 180 },
      { name: 'NOR2_X1',  x: 490, y: 120, w: 110, h: 180 }
    ];

    for (const c of cells) {
      // N-Well active zone
      ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
      ctx.fillRect(c.x, c.y, c.w, c.h / 2);

      // P-Substrate active zone
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fillRect(c.x, c.y + c.h / 2, c.w, c.h / 2);

      // Cell boundary
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(c.x, c.y, c.w, c.h);

      // Cell name
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(c.name, c.x + 8, c.y + 16);

      // Poly Silicon Gates (Vertical stripes)
      ctx.fillStyle = 'rgba(234, 179, 8, 0.6)';
      ctx.fillRect(c.x + 25, c.y + 10, 12, c.h - 20);
      ctx.fillRect(c.x + 60, c.y + 10, 12, c.h - 20);

      // Metal Interconnects
      ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.fillRect(c.x + 20, c.y + 40, c.w - 40, 14);

      // Contact Vias
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(c.x + 28, c.y + 44, 6, 6);
      ctx.fillRect(c.x + 63, c.y + 44, 6, 6);
    }

    // Render Calibre DRC Violation Markers
    if (this.drcViolations && this.drcViolations.length > 0) {
      for (const v of this.drcViolations) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(v.location.x, v.location.y, 40, 40);
        ctx.setLineDash([]);

        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`DRC: ${v.type}`, v.location.x, v.location.y - 6);
      }
    }
  }

  renderPlantPID() {
    const { ctx, canvas } = this;

    // Clean Dark Engineering Schematic Canvas
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;

    // Distillation Column (V-101)
    const colX = 280, colY = 80, colW = 80, colH = 260;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(colX, colY, colW, colH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('CRUDE COLUMN', colX + colW / 2, colY + 30);
    ctx.fillText('V-101 (30 Trays)', colX + colW / 2, colY + 48);

    // Draw Trays (Horizontal dashed lines)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    for (let y = colY + 65; y < colY + colH - 30; y += 15) {
      ctx.beginPath();
      ctx.moveTo(colX + 8, y); ctx.lineTo(colX + colW - 8, y);
      ctx.stroke();
    }

    // Crude Oil Feed Line
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(60, 210);
    ctx.lineTo(colX, 210);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('CRUDE FEED 50k BPD (350°C)', 140, 202);

    // Overhead Vapor to Condenser
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(colX + colW / 2, colY);
    ctx.lineTo(colX + colW / 2, colY - 40);
    ctx.lineTo(colX + colW + 120, colY - 40);
    ctx.stroke();

    // Condenser Exchanger E-101
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(colX + colW + 120, colY - 40, 24, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('E-101', colX + colW + 120, colY - 36);

    // Bottoms Reboiler Stream
    ctx.strokeStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(colX + colW / 2, colY + colH);
    ctx.lineTo(colX + colW / 2, colY + colH + 40);
    ctx.lineTo(colX + colW + 100, colY + colH + 40);
    ctx.stroke();
    ctx.fillStyle = '#f43f5e';
    ctx.fillText('BOTTOMS RESIDUE 360°C', colX + colW + 140, colY + colH + 44);
  }
}

window.SchematicLayoutUI = SchematicLayoutUI;
