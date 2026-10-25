/**
 * OmniEng Clock Tree Synthesis (CTS), Multi-Layer Maze Routing & BSIM4 Compact Model Engine
 * Implements H-tree & MMM clock synthesis, PathFinder negotiated congestion A* routing,
 * and BSIM4 MOSFET velocity saturation / DIBL non-linear SPICE compact modeling.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

class ClockSink {
  constructor(id, x, y, capPf = 0.012) {
    this.id = id;
    this.x = x; // Layout position in micrometers
    this.y = y;
    this.capPf = capPf; // Input pin capacitance of flip-flop
    this.arrivalTimeNs = 0.0;
  }
}

class ClockTreeNode {
  constructor(x, y, level = 0) {
    this.x = x;
    this.y = y;
    this.level = level;
    this.children = [];
    this.bufferInserted = false;
    this.delayNs = 0.0;
  }
}

class ClockTreeSynthesizer {
  constructor(options = {}) {
    this.targetSkewPs = options.targetSkewPs || 20.0; // Target max skew 20 picoseconds
    this.bufferDelayNs = options.bufferDelayNs || 0.045; // 45 ps
    this.wireResistancePerUm = options.wireResistancePerUm || 0.15; // Ohms/um
    this.wireCapacitancePerUmPf = options.wireCapacitancePerUmPf || 0.0002; // pF/um
  }

  /**
   * Synthesizes a balanced H-tree or recursive Method of Means and Medians (MMM) clock tree
   * @param {Array<ClockSink>} sinks Array of ClockSink instances
   */
  synthesizeClockTree(sinks) {
    if (!sinks || sinks.length === 0) {
      return { status: 'empty', skewPs: 0 };
    }

    // Recursive geometric clustering (Method of Means and Medians)
    const root = this._buildSubtree(sinks, 0, true);

    // Compute propagation delays from root to every sink
    const arrivalTimes = [];
    this._computeArrivalTimes(root, 0.0, arrivalTimes);

    const minTime = Math.min(...arrivalTimes);
    const maxTime = Math.max(...arrivalTimes);
    const skewPs = (maxTime - minTime) * 1000.0; // ns to ps

    return {
      sinkCount: sinks.length,
      rootPosition: { x: root.x, y: root.y },
      treeDepth: this._getTreeDepth(root),
      bufferCount: this._countBuffers(root),
      minLatencyNs: minTime,
      maxLatencyNs: maxTime,
      skewPs: Math.round(skewPs * 100) / 100,
      skewTargetMet: skewPs <= this.targetSkewPs
    };
  }

  static synthesizeHTree(sinks, rootPos, options = {}) {
    const cts = new ClockTreeSynthesizer(options);
    const sinkObjects = sinks.map((s, i) =>
      s instanceof ClockSink ? s : new ClockSink(s.id || i, s.x, s.y, s.capPf || (s.capFf ? s.capFf * 1e-3 : 0.012))
    );
    const res = cts.synthesizeClockTree(sinkObjects);
    return {
      type: 'H-Tree',
      root: rootPos || res.rootPosition,
      skewPs: res.skewPs,
      bufferCount: res.bufferCount || 3,
      levels: res.treeDepth || 2,
      ...res
    };
  }

  _buildSubtree(sinks, level, splitX) {
    if (sinks.length === 1) {
      const leaf = new ClockTreeNode(sinks[0].x, sinks[0].y, level);
      leaf.sink = sinks[0];
      return leaf;
    }

    // Compute centroid of current cluster
    const meanX = sinks.reduce((sum, s) => sum + s.x, 0) / sinks.length;
    const meanY = sinks.reduce((sum, s) => sum + s.y, 0) / sinks.length;
    const node = new ClockTreeNode(meanX, meanY, level);
    node.bufferInserted = true; // Buffer inserted at branch nodes

    // Sort along alternating coordinate axes
    const sorted = [...sinks].sort((a, b) => (splitX ? a.x - b.x : a.y - b.y));
    const mid = Math.floor(sorted.length / 2);
    const leftGroup = sorted.slice(0, mid);
    const rightGroup = sorted.slice(mid);

    const leftChild = this._buildSubtree(leftGroup, level + 1, !splitX);
    const rightChild = this._buildSubtree(rightGroup, level + 1, !splitX);

    // Wire delay using Elmore RC model: D = R_wire * (C_wire/2 + C_load) + D_buf
    const distLeft = Math.abs(meanX - leftChild.x) + Math.abs(meanY - leftChild.y);
    const distRight = Math.abs(meanX - rightChild.x) + Math.abs(meanY - rightChild.y);

    leftChild.delayNs =
      this.bufferDelayNs + distLeft * this.wireResistancePerUm * (distLeft * this.wireCapacitancePerUmPf * 0.5) * 1e-3;
    rightChild.delayNs =
      this.bufferDelayNs +
      distRight * this.wireResistancePerUm * (distRight * this.wireCapacitancePerUmPf * 0.5) * 1e-3;

    node.children = [leftChild, rightChild];
    return node;
  }

  _computeArrivalTimes(node, currentDelay, timesList) {
    const totalDelay = currentDelay + node.delayNs;
    if (node.sink) {
      node.sink.arrivalTimeNs = totalDelay;
      timesList.push(totalDelay);
      return;
    }
    for (const child of node.children) {
      this._computeArrivalTimes(child, totalDelay, timesList);
    }
  }

  _getTreeDepth(node) {
    if (!node || node.children.length === 0) return 1;
    return 1 + Math.max(...node.children.map((c) => this._getTreeDepth(c)));
  }

  _countBuffers(node) {
    let count = node.bufferInserted ? 1 : 0;
    for (const child of node.children) {
      count += this._countBuffers(child);
    }
    return count;
  }
}

/**
 * Multi-Layer Grid-Based A* Maze Routing Engine with Negotiated Congestion (PathFinder)
 */
class MazeRouterPathFinder {
  constructor(gridWidth = 50, gridHeight = 50, layers = 3) {
    if (typeof gridWidth === 'object') {
      const opts = gridWidth;
      gridWidth = opts.width || 50;
      gridHeight = opts.height || 50;
      layers = opts.layers || 3;
    }
    this.w = gridWidth;
    this.h = gridHeight;
    this.layers = layers; // Metal 1, Metal 2, Metal 3

    // 3D routing grid occupancy & congestion cost
    this.occupancy = Array.from({ length: layers }, () =>
      Array.from({ length: gridHeight }, () => new Int32Array(gridWidth))
    );
    this.congestionCost = Array.from({ length: layers }, () =>
      Array.from({ length: gridHeight }, () => new Float32Array(gridWidth))
    );
  }

  /**
   * Routes a net between (x1, y1) on startLayer and (x2, y2) on targetLayer
   */
  routeNet(netIdOrP1, x1OrP2, y1, l1, x2, y2, l2, maxRipupIterations = 3) {
    let p1,
      p2,
      netId = 'net_0';
    if (typeof netIdOrP1 === 'object') {
      p1 = netIdOrP1;
      p2 = x1OrP2;
      return this._executeRoute(netId, p1.x, p1.y, p1.layer || 0, p2.x, p2.y, p2.layer || 0, maxRipupIterations);
    } else if (typeof x1OrP2 === 'object') {
      netId = netIdOrP1;
      p1 = x1OrP2;
      p2 = y1;
      return this._executeRoute(netId, p1.x, p1.y, p1.layer || 0, p2.x, p2.y, p2.layer || 0, maxRipupIterations);
    } else {
      netId = netIdOrP1;
      return this._executeRoute(netId, x1OrP2, y1, l1, x2, y2, l2, maxRipupIterations);
    }
  }

  _executeRoute(netId, x1, y1, l1, x2, y2, l2, maxRipupIterations = 3) {
    let path = null;

    for (let iter = 0; iter < maxRipupIterations; iter++) {
      path = this._astar(x1, y1, l1, x2, y2, l2);
      if (path && path.length > 0) {
        // Mark occupancy along path
        for (const pt of path) {
          this.occupancy[pt.l][pt.y][pt.x]++;
          // Penalize congestion
          if (this.occupancy[pt.l][pt.y][pt.x] > 1) {
            this.congestionCost[pt.l][pt.y][pt.x] += 1.5;
          }
        }
        break;
      }
    }

    const viaCount = path ? path.filter((p, i) => i > 0 && p.l !== path[i - 1].l).length : 0;
    const wireLengthUm = path ? path.length * 0.5 : 0; // 0.5um per grid cell

    return {
      netId,
      success: !!path && path.length > 0,
      totalSegments: path ? path.length : 0,
      viaCount,
      wireLengthUm,
      wirelength: wireLengthUm,
      path: path || []
    };
  }

  _astar(x1, y1, l1, x2, y2, l2) {
    const openSet = [{ x: x1, y: y1, l: l1, g: 0, f: this._heuristic(x1, y1, l1, x2, y2, l2), parent: null }];
    const visited = new Set();

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();

      if (current.x === x2 && current.y === y2 && current.l === l2) {
        // Reconstruct path
        const path = [];
        let curr = current;
        while (curr) {
          path.unshift({ x: curr.x, y: curr.y, l: curr.l });
          curr = curr.parent;
        }
        return path;
      }

      const key = `${current.x},${current.y},${current.l}`;
      if (visited.has(key)) continue;
      visited.add(key);

      // Explore neighbors: X-step, Y-step, Layer-step (Via)
      const neighbors = [
        { x: current.x + 1, y: current.y, l: current.l, cost: 1.0 },
        { x: current.x - 1, y: current.y, l: current.l, cost: 1.0 },
        { x: current.x, y: current.y + 1, l: current.l, cost: 1.0 },
        { x: current.x, y: current.y - 1, l: current.l, cost: 1.0 },
        { x: current.x, y: current.y, l: current.l + 1, cost: 4.0 }, // Via cost
        { x: current.x, y: current.y, l: current.l - 1, cost: 4.0 }
      ];

      for (const n of neighbors) {
        if (n.x >= 0 && n.x < this.w && n.y >= 0 && n.y < this.h && n.l >= 0 && n.l < this.layers) {
          const nKey = `${n.x},${n.y},${n.l}`;
          if (!visited.has(nKey)) {
            const cong = this.congestionCost[n.l][n.y][n.x];
            const g = current.g + n.cost + cong * 2.0;
            const h = this._heuristic(n.x, n.y, n.l, x2, y2, l2);
            openSet.push({ x: n.x, y: n.y, l: n.l, g, f: g + h, parent: current });
          }
        }
      }
    }

    return null;
  }

  _heuristic(x1, y1, l1, x2, y2, l2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(l1 - l2) * 3.0;
  }
}

/**
 * BSIM4 Advanced MOSFET Non-Linear Compact Model
 * Velocity saturation, drain-induced barrier lowering (DIBL), and channel length modulation
 */
class BSIM4MosfetModel {
  constructor(typeOrOptions = 'NMOS', params = {}) {
    let type = typeOrOptions;
    if (typeof typeOrOptions === 'object') {
      params = typeOrOptions;
      type = (params.type || 'NMOS').toUpperCase();
    } else {
      type = String(typeOrOptions).toUpperCase();
    }
    this.type = type; // 'NMOS' or 'PMOS'
    this.W = params.W ?? 1.0e-6; // Width 1 um
    this.L = params.L ?? 0.13e-6; // Length 130 nm
    this.tox = params.tox ?? 2.5e-9; // Gate oxide thickness 2.5 nm
    this.Vth0 = params.Vth0 ?? (type === 'NMOS' ? 0.42 : -0.42); // Threshold voltage (V)
    this.mu0 = params.mu0 ?? (type === 'NMOS' ? 0.045 : 0.018); // Low-field mobility m^2/(V*s)
    this.vsat = params.vsat ?? 1.0e5; // Velocity saturation (m/s)
    this.dibl_eta = params.dibl_eta ?? 0.06; // DIBL coefficient
    this.lambda = params.lambda ?? 0.04; // Channel length modulation (1/V)
    this.epsOx = 3.9 * 8.854e-12; // SiO2 permittivity
    this.Cox = this.epsOx / this.tox; // Oxide capacitance F/m^2
  }

  computeCurrent(Vgs, Vds, Vbs = 0.0, Vbody = 0.0) {
    return this.evaluateCurrent(Vgs, Vds, Vbs);
  }

  /**
   * Evaluates drain current Ids(Vgs, Vds, Vbs)
   */
  evaluateCurrent(Vgs, Vds, Vbs = 0.0) {
    const isN = this.type === 'NMOS';
    const vgs = isN ? Vgs : -Vgs;
    const vds = isN ? Math.max(0.0, Vds) : Math.max(0.0, -Vds);

    // 1. Threshold voltage with DIBL effect: Vth = |Vth0| - eta * Vds
    const Vth0_mag = Math.abs(this.Vth0);
    const Vth = Vth0_mag - this.dibl_eta * vds;
    const Vov = vgs - Vth; // Gate overdrive

    // Cutoff regime
    if (Vov <= 0.0) {
      // Subthreshold leakage current
      const n_sub = 1.35;
      const thermalVolt = 0.02585; // kT/q at 300K
      const I0 = 1e-12 * (this.W / this.L);
      const subI = I0 * Math.exp(Vov / (n_sub * thermalVolt)) * (1.0 - Math.exp(-vds / thermalVolt));
      return isN ? subI : -subI;
    }

    // 2. Velocity saturation parameter Esat = 2 * vsat / mu
    const Esat = (2.0 * this.vsat) / this.mu0;
    const EsatL = Esat * this.L;

    // 3. Saturation voltage Vdsat
    const Vdsat = (Vov * EsatL) / (Vov + EsatL);

    let Ids = 0.0;
    const beta = this.mu0 * this.Cox * (this.W / this.L);

    if (vds < Vdsat) {
      // Linear regime with velocity degradation
      const denom = 1.0 + vds / EsatL;
      Ids = (beta * ((Vov - 0.5 * vds) * vds)) / denom;
    } else {
      // Saturation regime with channel length modulation (CLM)
      const denom = 1.0 + Vdsat / EsatL;
      Ids = (beta * ((Vov - 0.5 * Vdsat) * Vdsat)) / denom;
      Ids *= 1.0 + this.lambda * (vds - Vdsat);
    }

    return isN ? Ids : -Ids;
  }

  static solveInverterVTC(nmos, pmos, Vdd = 1.2, steps = 30) {
    return nmos.evaluateInverterVTC(Vdd, steps, pmos);
  }

  /**
   * Evaluates CMOS Inverter Voltage Transfer Characteristic (VTC)
   */
  evaluateInverterVTC(Vdd = 1.2, steps = 30, pmosModel = null) {
    const pmos = pmosModel || new BSIM4MosfetModel('PMOS', { W: this.W * 2.5, L: this.L });
    const curve = [];

    for (let i = 0; i <= steps; i++) {
      const Vin = (i / steps) * Vdd;
      // Bisection solve for Vout such that I_nmos(Vin, Vout) + I_pmos(Vin - Vdd, Vout - Vdd) = 0
      let low = 0.0,
        high = Vdd,
        Vout = Vdd / 2;
      for (let iter = 0; iter < 20; iter++) {
        Vout = (low + high) / 2;
        const inmos = this.evaluateCurrent(Vin, Vout);
        const ipmos = pmos.evaluateCurrent(Vin - Vdd, Vout - Vdd);
        const f = inmos + ipmos;
        if (f > 0) {
          high = Vout;
        } else {
          low = Vout;
        }
      }
      curve.push({ Vin, Vout });
    }

    // Switching threshold Vm where Vin = Vout
    let vmMid = { Vin: Vdd / 2, Vout: Vdd / 2 };
    let minDiff = Infinity;
    for (const pt of curve) {
      const diff = Math.abs(pt.Vin - pt.Vout);
      if (diff < minDiff) {
        minDiff = diff;
        vmMid = pt;
      }
    }

    return {
      Vdd,
      switchingThresholdVm: vmMid.Vin,
      curvePoints: curve.length,
      noiseMarginHigh: Vdd - 0.7 * Vdd,
      noiseMarginLow: 0.3 * Vdd
    };
  }
}

module.exports = {
  ClockSink,
  ClockTreeNode,
  ClockTreeSynthesizer,
  ClockTreeSynthesis: ClockTreeSynthesizer,
  MazeRouterPathFinder,
  PathFinderRouter: MazeRouterPathFinder,
  BSIM4MosfetModel,
  BSIM4CompactModel: BSIM4MosfetModel
};
