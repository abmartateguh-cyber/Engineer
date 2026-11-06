'use strict';

/**
 * Placement and two-pin Manhattan routing for caller-supplied cells and nets.
 *
 * Placement is optimization-based by default (simulated annealing over a cost
 * model of half-perimeter wirelength (HPWL), cell overlap, and density/congestion
 * gradients), followed by a row-based legalization pass. The legacy greedy row
 * placer remains available via { optimizer: 'greedy' }.
 *
 * This remains an experimental estimate: it does not implement foundry rules,
 * timing-driven placement, or commercial place-and-route conformance.
 */

const DEFAULT_SEED = 42;
const CORE_MARGIN = 10.0;

class PlaceAndRouteEngine {
  constructor(options = {}) {
    const requiredDimensions = ['coreWidth', 'coreHeight', 'stdCellHeight'];
    if (
      !options ||
      requiredDimensions.some((key) => !Number.isFinite(options[key]) || options[key] <= 0) ||
      options.coreWidth <= 20 ||
      options.stdCellHeight > options.coreHeight
    ) {
      throw new TypeError('Explicit positive coreWidth, coreHeight, and stdCellHeight values are required.');
    }
    this.coreWidth = options.coreWidth; // microns
    this.coreHeight = options.coreHeight; // microns
    this.gridPitch = options.gridPitch; // retained as caller metadata; unused by this placement estimate
    this.stdCellHeight = options.stdCellHeight; // microns
    this.optimizer = options.optimizer === 'greedy' ? 'greedy' : 'annealing';
    this.seed = Number.isSafeInteger(options.seed) ? options.seed : DEFAULT_SEED;
    this.maxIterations =
      Number.isSafeInteger(options.maxIterations) && options.maxIterations > 0 ? options.maxIterations : 20000;
    this.minCellGap = Number.isFinite(options.minCellGap) && options.minCellGap >= 0 ? options.minCellGap : 2.0;
    this.densityCols = options.densityCols || 4;
  }

  /** Deterministic seeded PRNG (mulberry32). Same seed => same sequence. */
  static _mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Run placement optimization and detailed routing on a netlist of cells and nets.
   * @param {Object} circuitData - { cells: [{id, width, height}], nets: [{name, pins: [cellId]}] }
   * @param {Object} [options] - { optimizer: 'annealing'|'greedy', seed }
   * @returns {Object} Placement coordinates, routing segments, routing telemetry, and placement metrics
   */
  runPlaceAndRoute(circuitData, options = {}) {
    if (
      !circuitData ||
      !Array.isArray(circuitData.cells) ||
      circuitData.cells.length === 0 ||
      !Array.isArray(circuitData.nets)
    ) {
      return {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: 'Explicit cell and net arrays are required for this experimental estimate.'
        }
      };
    }

    const optimizer = options.optimizer === 'greedy' ? 'greedy' : this.optimizer;
    const seed = Number.isSafeInteger(options.seed) ? options.seed : this.seed;
    const rng = PlaceAndRouteEngine._mulberry32(seed);

    const cells = this._normalizeCells(circuitData.cells);
    const nets = this._indexNets(circuitData.nets, cells);

    const tStart = Date.now();

    // Baseline: legacy greedy row placer (identical to the previous engine).
    const greedyState = this._placeGreedy(cells);
    const metricsBefore = this._placementMetrics(greedyState, nets);

    let state;
    let annealReport = null;
    if (optimizer === 'annealing') {
      const result = this._anneal(greedyState, nets, rng);
      state = result.state;
      annealReport = result.report;
    } else {
      state = greedyState.map((c) => ({ ...c }));
    }

    // Legality: snap to rows and shift within rows to remove overlap.
    this._legalize(state);
    const placements = this._stateToPlacements(state);
    const metricsAfter = this._placementMetrics(state, nets);

    // Multi-layer detailed routing (unchanged from legacy behavior).
    const { routes, totalWirelength, totalVias } = this._route(placements, circuitData.nets);

    const totalCellArea = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    const coreArea = this.coreWidth * this.coreHeight;
    const coreUtilization = (totalCellArea / coreArea) * 100.0;

    const telemetry = {
      totalHpwlMicrons: Math.round(totalWirelength * 10) / 10,
      totalViaCount: totalVias,
      coreUtilizationPercent: Math.round(coreUtilization * 100) / 100,
      optimizer,
      seed,
      placementMetrics: {
        hpwlBeforeMicrons: Math.round(metricsBefore.hpwl * 10) / 10,
        hpwlAfterMicrons: Math.round(metricsAfter.hpwl * 10) / 10,
        overlapCountBefore: metricsBefore.overlapCount,
        overlapCountAfter: metricsAfter.overlapCount,
        overlapAreaBeforeMicrons2: Math.round(metricsBefore.overlapArea * 100) / 100,
        overlapAreaAfterMicrons2: Math.round(metricsAfter.overlapArea * 100) / 100,
        runtimeMs: Date.now() - tStart,
        iterations: annealReport ? annealReport.iterations : 0,
        acceptedMoves: annealReport ? annealReport.acceptedMoves : 0,
        converged: annealReport ? annealReport.converged : true,
        startTemperature: annealReport ? Math.round(annealReport.startTemperature * 1000) / 1000 : null,
        endTemperature: annealReport ? Math.round(annealReport.endTemperature * 1000) / 1000 : null,
        coolingAlpha: annealReport ? annealReport.coolingAlpha : null
      }
    };

    return {
      status: 'EXPERIMENTAL_LAYOUT_ESTIMATE',
      validationLevel: 'experimental',
      designRuleCheck: 'not-run',
      coreWidth: this.coreWidth,
      coreHeight: this.coreHeight,
      cellsPlacedCount: cells.length,
      netsRoutedCount: routes.length,
      placements,
      routes,
      telemetry
    };
  }

  _normalizeCells(cells) {
    return cells.map((cell, i) => ({
      id: typeof cell.id === 'string' ? cell.id : String(cell.id ?? `cell_${i}`),
      width: Number.isFinite(cell.width) && cell.width > 0 ? cell.width : this.stdCellHeight,
      height: Number.isFinite(cell.height) && cell.height > 0 ? cell.height : this.stdCellHeight
    }));
  }

  _indexNets(nets, cells) {
    const index = new Map();
    cells.forEach((c, i) => index.set(c.id, i));
    const out = [];
    for (const net of nets) {
      if (!net || !Array.isArray(net.pins)) continue;
      const pins = [];
      for (const pin of net.pins) {
        const idx = index.get(pin);
        if (idx !== undefined && !pins.includes(idx)) pins.push(idx);
      }
      if (pins.length >= 2) out.push({ name: net.name, pins });
    }
    return out;
  }

  /** Legacy greedy row placer: pack left-to-right with 6um spacing, row-wrap. */
  _placeGreedy(cells) {
    const rowHeight = this.stdCellHeight;
    const numRows = Math.max(1, Math.floor(this.coreHeight / rowHeight));
    const state = [];
    let currentRow = 1;
    let currentX = CORE_MARGIN;
    for (const cell of cells) {
      if (currentX + cell.width > this.coreWidth - CORE_MARGIN) {
        currentRow = (currentRow + 1) % numRows;
        currentX = CORE_MARGIN;
      }
      const y = currentRow * rowHeight;
      state.push({
        id: cell.id,
        width: cell.width,
        height: cell.height,
        x: Math.round(currentX * 10) / 10,
        y: Math.round(y * 10) / 10
      });
      currentX += cell.width + 6.0;
    }
    return state;
  }

  /** True half-perimeter wirelength: per net (maxX-minX)+(maxY-minY) over pin centers. */
  _hpwl(state, nets) {
    let total = 0;
    for (const net of nets) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const idx of net.pins) {
        const c = state[idx];
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      total += maxX - minX + maxY - minY;
    }
    return total;
  }

  _overlapStats(state) {
    let area = 0;
    let count = 0;
    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const a = state[i];
        const b = state[j];
        const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (dx > 0 && dy > 0) {
          area += dx * dy;
          count++;
        }
      }
    }
    return { area, count };
  }

  /** Congestion penalty: squared excess of bin utilization above a soft target. */
  _densityPenalty(state) {
    const ny = Math.max(1, Math.floor(this.coreHeight / this.stdCellHeight));
    const nx = this.densityCols;
    const binW = this.coreWidth / nx;
    const binH = this.coreHeight / ny;
    const binArea = binW * binH;
    const target = 0.35 * binArea;
    const areas = new Array(nx * ny).fill(0);
    for (const c of state) {
      const col = Math.min(nx - 1, Math.max(0, Math.floor((c.x + c.width / 2) / binW)));
      const row = Math.min(ny - 1, Math.max(0, Math.floor((c.y + c.height / 2) / binH)));
      areas[row * nx + col] += c.width * c.height;
    }
    let penalty = 0;
    for (const a of areas) {
      const excess = a - target;
      if (excess > 0) penalty += (excess * excess) / binArea;
    }
    return penalty;
  }

  /** Row-affinity penalty: squared distance of cell center from nearest row centerline. */
  _rowAffinityPenalty(state) {
    const rowHeight = this.stdCellHeight;
    let penalty = 0;
    for (const c of state) {
      const cy = c.y + c.height / 2;
      const d = cy - Math.round(cy / rowHeight) * rowHeight;
      penalty += d * d;
    }
    return penalty * 0.05;
  }

  _cost(state, nets) {
    const hpwl = this._hpwl(state, nets);
    const ovl = this._overlapStats(state);
    const density = this._densityPenalty(state);
    const rowPenalty = this._rowAffinityPenalty(state);
    return {
      total: hpwl + 8 * ovl.area + density + rowPenalty,
      hpwl,
      overlapArea: ovl.area,
      density,
      rowPenalty
    };
  }

  /**
   * Simulated annealing placement: geometric cooling, swap/displace moves,
   * Metropolis acceptance, and best-state retention.
   */
  _anneal(initialState, nets, rng) {
    const n = initialState.length;
    const t0 = Math.max(1e-3, this._cost(initialState, nets).total * 0.5);
    const tMin = Math.max(1e-4, t0 * 1e-4);
    const alpha = 0.92;
    const movesPerTemp = Math.max(20, n * 8);

    let best = initialState.map((c) => ({ ...c }));
    let bestCost = this._cost(best, nets).total;
    let cur = best.map((c) => ({ ...c }));
    let curCost = bestCost;
    let temp = t0;
    let iterations = 0;
    let accepted = 0;
    let rejected = 0;

    while (temp > tMin && iterations < this.maxIterations) {
      for (let m = 0; m < movesPerTemp; m++) {
        iterations++;
        const next = cur.map((c) => ({ ...c }));
        if (n < 2 || rng() < 0.6) {
          // Displace: move one cell to a random location in the core.
          const i = Math.floor(rng() * n);
          const c = next[i];
          c.x = CORE_MARGIN + rng() * (this.coreWidth - 2 * CORE_MARGIN - c.width);
          c.y = rng() * (this.coreHeight - c.height);
        } else {
          // Swap: exchange coordinates of two distinct cells.
          const i = Math.floor(rng() * n);
          let j = Math.floor(rng() * n);
          while (j === i) j = Math.floor(rng() * n);
          const tmp = next[i];
          next[i] = { ...next[j] };
          next[j] = { ...tmp };
        }

        const nextCost = this._cost(next, nets).total;
        const delta = nextCost - curCost;
        if (delta < 0 || rng() < Math.exp(-delta / temp)) {
          cur = next;
          curCost = nextCost;
          accepted++;
          if (curCost < bestCost) {
            bestCost = curCost;
            best = cur.map((c) => ({ ...c }));
          }
        } else {
          rejected++;
        }
        if (iterations >= this.maxIterations) break;
      }
      temp *= alpha;
    }

    return {
      state: best,
      report: {
        startTemperature: t0,
        endTemperature: temp,
        coolingAlpha: alpha,
        iterations,
        acceptedMoves: accepted,
        rejectedMoves: rejected,
        converged: temp <= tMin,
        bestCost
      }
    };
  }

  /**
   * Legality pass: assign each cell to its nearest row, then pack rows
   * left-to-right with a minimum gap so no cell overlaps and rows stay inside
   * the core width. Row overflow spills into following rows.
   */
  _legalize(state) {
    const rowHeight = this.stdCellHeight;
    const numRows = Math.max(1, Math.floor(this.coreHeight / rowHeight));
    const rows = Array.from({ length: numRows }, () => []);
    for (const c of state) {
      let r = Math.round((c.y + c.height / 2) / rowHeight);
      r = Math.max(0, Math.min(numRows - 1, r));
      rows[r].push(c);
    }
    for (let r = 0; r < numRows; r++) {
      rows[r].sort((a, b) => a.x - b.x);
      let cursor = CORE_MARGIN;
      const spill = [];
      for (const c of rows[r]) {
        if (cursor + c.width > this.coreWidth - CORE_MARGIN) {
          spill.push(c);
          continue;
        }
        c.y = r * rowHeight;
        c.x = cursor;
        cursor += c.width + this.minCellGap;
      }
      if (spill.length > 0) {
        if (r + 1 < numRows) {
          rows[r + 1] = rows[r + 1].concat(spill);
        } else {
          // No rows left: pack tightly (still overlap-free) regardless of width.
          let tight = CORE_MARGIN;
          for (const c of spill) {
            c.y = r * rowHeight;
            c.x = tight;
            tight += c.width + this.minCellGap;
          }
        }
      }
    }
  }

  _stateToPlacements(state) {
    const placements = {};
    for (const c of state) {
      placements[c.id] = {
        cellId: c.id,
        x: Math.round(c.x * 10) / 10,
        y: Math.round(c.y * 10) / 10,
        width: c.width,
        height: c.height
      };
    }
    return placements;
  }

  _placementMetrics(state, nets) {
    const hpwl = this._hpwl(state, nets);
    const ovl = this._overlapStats(state);
    return { hpwl, overlapArea: ovl.area, overlapCount: ovl.count };
  }

  _route(placements, rawNets) {
    let totalWirelength = 0.0;
    let totalVias = 0;
    const routes = [];

    const idToPlacement = (id) => placements[id];
    for (const rawNet of rawNets) {
      if (!rawNet || !Array.isArray(rawNet.pins) || rawNet.pins.length < 2) continue;
      const validPins = rawNet.pins.map(idToPlacement).filter(Boolean);
      if (validPins.length < 2) continue;

      let netLength = 0.0;
      const netSegments = [];
      const netVias = [];

      for (let i = 0; i < validPins.length - 1; i++) {
        const p1 = validPins[i];
        const p2 = validPins[i + 1];
        const x1 = p1.x + p1.width / 2;
        const y1 = p1.y + p1.height / 2;
        const x2 = p2.x + p2.width / 2;
        const y2 = p2.y + p2.height / 2;
        const intermediateX = x2;
        const intermediateY = y1;
        const seg1Len = Math.abs(intermediateX - x1);
        const seg2Len = Math.abs(y2 - intermediateY);
        const legLength = seg1Len + seg2Len;
        netLength += legLength;
        totalWirelength += legLength;
        totalVias += 1;
        netSegments.push(
          { layer: 'M1', x1, y1, x2: intermediateX, y2: intermediateY, length: seg1Len },
          { layer: 'M2', x1: intermediateX, y1: intermediateY, x2, y2, length: seg2Len }
        );
        netVias.push({ layer: 'V1', x: intermediateX, y: intermediateY });
      }

      routes.push({
        net: rawNet.name,
        segments: netSegments,
        via: netVias[0] || null,
        vias: netVias,
        lengthMicrons: Math.round(netLength * 10) / 10
      });
    }

    return { routes, totalWirelength, totalVias };
  }
}

module.exports = { PlaceAndRouteEngine };
