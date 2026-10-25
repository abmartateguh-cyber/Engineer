/**
 * Experimental 2D block-diagram view for caller-supplied dimensionless signal graphs.
 * The canvas only displays a model and time-series samples returned by the controls engine.
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

    this.blocks = [];
    this.wires = [];
    this.simulationResult = null;

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

    this.canvas.addEventListener(
      'wheel',
      (e) => {
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
      },
      { passive: false }
    );

    this.canvas.addEventListener('dblclick', () => {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.0;
      this.selectedBlock = null;
      this.render();
    });
  }

  loadPreset() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Built-in fixed control and thermal examples were withdrawn; no source-reviewed preset model is available.'
      }
    };
  }

  clearModel() {
    this.blocks = [];
    this.wires = [];
    this.simulationResult = null;
    this.render();
  }

  loadModel(graphData) {
    if (!graphData || typeof graphData !== 'object' || Array.isArray(graphData)) {
      throw new TypeError('A caller-supplied block graph object is required.');
    }
    if (!Array.isArray(graphData.blocks) || graphData.blocks.length < 1 || graphData.blocks.length > 1000) {
      throw new TypeError('The graph must contain between 1 and 1,000 blocks.');
    }
    if (!Array.isArray(graphData.connections) || graphData.connections.length > 10000) {
      throw new TypeError('The graph must contain a connections array with at most 10,000 entries.');
    }

    const supportedTypes = new Set(['source_step', 'source_sine', 'source_constant', 'gain', 'sum', 'pid', 'scope']);
    const ids = new Set();
    const blocks = graphData.blocks.map((block, index) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        throw new TypeError(`Block ${index + 1} must be an object.`);
      }
      if (typeof block.id !== 'string' || block.id.length < 1 || block.id.length > 128 || ids.has(block.id)) {
        throw new TypeError(`Block ${index + 1} requires a unique ID of 1 to 128 characters.`);
      }
      if (typeof block.type !== 'string' || !supportedTypes.has(block.type)) {
        throw new TypeError(`Block '${block.id}' has an unsupported type.`);
      }
      if (!block.params || typeof block.params !== 'object' || Array.isArray(block.params)) {
        throw new TypeError(`Block '${block.id}' requires a parameter object.`);
      }
      if (block.name !== undefined && (typeof block.name !== 'string' || block.name.length > 160)) {
        throw new TypeError(`Block '${block.id}' name must be a string of at most 160 characters.`);
      }
      if (block.x !== undefined && !Number.isFinite(block.x)) {
        throw new TypeError(`Block '${block.id}' x position must be finite.`);
      }
      if (block.y !== undefined && !Number.isFinite(block.y)) {
        throw new TypeError(`Block '${block.id}' y position must be finite.`);
      }

      ids.add(block.id);
      const isScope = block.type === 'scope';
      // Missing positions get a deterministic canvas layout only; they do not alter the model.
      const fallbackX = 50 + (index % 4) * 190;
      const fallbackY = 100 + Math.floor(index / 4) * 120;
      return {
        id: block.id,
        type: block.type,
        name: block.name || block.type,
        x: block.x ?? fallbackX,
        y: block.y ?? fallbackY,
        w: isScope ? 200 : 150,
        h: isScope ? 130 : 75,
        params: { ...block.params }
      };
    });

    const wires = graphData.connections.map((connection, index) => {
      if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
        throw new TypeError(`Connection ${index + 1} must be an object.`);
      }
      if (!ids.has(connection.fromBlock) || !ids.has(connection.toBlock)) {
        throw new TypeError(`Connection ${index + 1} references an unknown block ID.`);
      }
      return { from: connection.fromBlock, to: connection.toBlock };
    });

    this.blocks = blocks;
    this.wires = wires;
    this.simulationResult = null;
    this.render();
  }

  setSimulationResult(result) {
    if (
      result?.units?.time?.unit !== 's' ||
      result?.units?.time?.dimension !== 'time' ||
      result?.units?.signal?.unit !== '1' ||
      result?.units?.signal?.dimension !== 'dimensionless'
    ) {
      throw new TypeError('Solver result must declare seconds for time and dimensionless signal units.');
    }
    if (!result || !Array.isArray(result.time) || result.time.length < 1 || result.time.length > 1_000_001) {
      throw new TypeError('Solver result requires between 1 and 1,000,001 time samples.');
    }
    if (!result.time.every((time, index) => Number.isFinite(time) && (index === 0 || time > result.time[index - 1]))) {
      throw new TypeError('Solver time samples must be finite and strictly increasing.');
    }
    if (!result.signals || typeof result.signals !== 'object' || Array.isArray(result.signals)) {
      throw new TypeError('Solver result requires signal histories keyed by block ID.');
    }
    for (const [id, values] of Object.entries(result.signals)) {
      if (!Array.isArray(values) || values.length !== result.time.length || !values.every(Number.isFinite)) {
        throw new TypeError(`Solver signal '${id}' must contain one finite value per time sample.`);
      }
    }
    this.simulationResult = result;
    this.render();
  }

  startOscilloscopeAnimation() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: 'Continuous scope playback is unavailable; the canvas can display returned solver samples.'
      }
    };
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
      const src = this.blocks.find((b) => b.id === wire.from);
      const dst = this.blocks.find((b) => b.id === wire.to);
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

    // Draw only caller-supplied visual blocks and returned simulation samples.
    for (const b of this.blocks) {
      const isSelected = this.selectedBlock && this.selectedBlock.id === b.id;

      // Drop Shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;

      // Block Body Fill
      ctx.fillStyle = b.type === 'scope' ? '#070c18' : '#162032';
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowColor = 'transparent';

      // Top Header Stripe
      ctx.fillStyle = b.type === 'pid' ? '#818cf8' : b.type === 'scope' ? '#10b981' : '#38bdf8';
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

      // Parameter readouts are unitless by this view's explicit signal-graph contract.
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#38bdf8';
      const numericParams = Object.entries(b.params)
        .filter(([, value]) => Number.isFinite(value))
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${value}`)
        .join('  ');
      if (b.type !== 'scope' && numericParams) {
        ctx.fillText(numericParams, b.x + b.w / 2, b.y + 58);
      }
      if (b.type === 'scope') {
        // Plot only solver samples returned for this caller-supplied scope block.
        const sx = b.x + 10,
          sy = b.y + 44,
          sw = b.w - 20,
          sh = b.h - 52;
        ctx.fillStyle = '#030712';
        ctx.fillRect(sx, sy, sw, sh);

        // Graticule Grid
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let gx = sx; gx <= sx + sw; gx += sw / 5) {
          ctx.beginPath();
          ctx.moveTo(gx, sy);
          ctx.lineTo(gx, sy + sh);
          ctx.stroke();
        }
        for (let gy = sy; gy <= sy + sh; gy += sh / 4) {
          ctx.beginPath();
          ctx.moveTo(sx, gy);
          ctx.lineTo(sx + sw, gy);
          ctx.stroke();
        }

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        const samples = this.simulationResult?.signals?.[b.id];
        if (Array.isArray(samples) && samples.length > 0) {
          let minValue = samples[0];
          let maxValue = samples[0];
          for (let i = 1; i < samples.length; i++) {
            minValue = Math.min(minValue, samples[i]);
            maxValue = Math.max(maxValue, samples[i]);
          }
          const range = maxValue - minValue || 1;
          const stride = Math.max(1, Math.ceil(samples.length / 512));
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i += stride) {
            const px = sx + (i / Math.max(1, samples.length - 1)) * sw;
            const py = sy + sh - ((samples[i] - minValue) / range) * sh;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          if ((samples.length - 1) % stride !== 0 && samples.length > 1) {
            const last = samples.length - 1;
            ctx.lineTo(sx + sw, sy + sh - ((samples[last] - minValue) / range) * sh);
          }
          ctx.stroke();
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'left';
          ctx.fillText(`Unitless • ${samples.length} returned samples`, sx, sy + sh + 1);
        } else {
          ctx.fillText('No solver result is loaded', sx + sw / 2, sy + sh / 2);
        }
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
    ctx.fillText('Experimental Block Diagram Canvas', 24, 32);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    const modelStatus =
      this.blocks.length === 0
        ? 'No caller-supplied model is loaded'
        : this.simulationResult
          ? 'Caller model • experimental result loaded'
          : 'Caller model loaded • simulation not run';
    ctx.fillText(`${modelStatus} • Zoom: ${(this.zoom * 100).toFixed(0)}%`, 24, 48);
  }
}

window.BlockDiagramUI = BlockDiagramUI;
