/**
 * OmniEng 2D Dynamic Simulink Block Diagram Canvas Editor
 * Visualizes visual blocks, signal flow wires, and live scope waveform plots.
 */

class BlockDiagramUI {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.blocks = [
      { id: 'b1', type: 'Step Input', x: 50, y: 140, w: 90, h: 50, params: { finalValue: 10.0 } },
      { id: 'b2', type: 'Sum (+ -)', x: 190, y: 145, w: 40, h: 40, params: {} },
      { id: 'b3', type: 'PID Controller', x: 280, y: 135, w: 120, h: 60, params: { Kp: 2.5, Ki: 0.5, Kd: 0.1 } },
      { id: 'b4', type: 'Plant (1/s)', x: 450, y: 135, w: 100, h: 60, params: { gain: 1.0 } },
      { id: 'b5', type: 'Scope View', x: 600, y: 120, w: 140, h: 90, params: { signal: [] } }
    ];
    this.wires = [
      { from: 'b1', to: 'b2' },
      { from: 'b2', to: 'b3' },
      { from: 'b3', to: 'b4' },
      { from: 'b4', to: 'b5' }
    ];

    this.simData = null;
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

  updateSimulationData(timeSeries) {
    this.simData = timeSeries;
    this.render();
  }

  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Engineering Dot Grid
    ctx.fillStyle = '#1e293b';
    const gridSize = 25;
    for (let x = 0; x < canvas.width; x += gridSize) {
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    // Draw Wires (Bezier Curves)
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
        const dx = (x2 - x1) * 0.5;
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
        ctx.stroke();

        // Arrow head
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 7, y2 - 4);
        ctx.lineTo(x2 - 7, y2 + 4);
        ctx.fill();
      }
    }

    // Feedback loop from Plant back to Sum
    ctx.beginPath();
    ctx.strokeStyle = '#94a3b8';
    ctx.moveTo(550, 165);
    ctx.lineTo(570, 165);
    ctx.lineTo(570, 240);
    ctx.lineTo(210, 240);
    ctx.lineTo(210, 185);
    ctx.stroke();

    // Draw Blocks
    for (const b of this.blocks) {
      // Drop shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;

      // Card Body
      ctx.fillStyle = b.type.startsWith('Scope') ? '#0b1329' : '#1e293b';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';

      // Header stripe
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(b.x, b.y, b.w, 4);

      // Block Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(b.type, b.x + b.w / 2, b.y + 22);

      // Subtitle / Params
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      if (b.type.includes('PID')) {
        ctx.fillText(`P:${b.params.Kp} I:${b.params.Ki} D:${b.params.Kd}`, b.x + b.w / 2, b.y + 42);
      } else if (b.type.includes('Step')) {
        ctx.fillText(`Target: ${b.params.finalValue}m`, b.x + b.w / 2, b.y + 38);
      } else if (b.type.includes('Plant')) {
        ctx.fillText(`G(s) = 1/s`, b.x + b.w / 2, b.y + 40);
      } else if (b.type.includes('Scope')) {
        // Draw miniature live waveform inside Scope
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const pts = 30;
        for (let i = 0; i < pts; i++) {
          const px = b.x + 10 + (i / pts) * (b.w - 20);
          // Simulated step response with damping
          const tNorm = i / 10;
          const py = b.y + b.h - 15 - Math.max(0, (1 - Math.exp(-tNorm * 1.5) * Math.cos(tNorm * 3))) * 45;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
}

window.BlockDiagramUI = BlockDiagramUI;
