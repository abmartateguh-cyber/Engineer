/**
 * OmniEng Proprietary Symbolic Multi-Physics Reasoning Engine & Dimensional Verifier
 * 
 * Experimental implementation; release maturity and provenance are not established.
 * Combines rigorous dimensional analysis ([M, L, T, Theta, I]), codified engineering laws,
 * non-linear parameter optimization (Nelder-Mead simplex), and deterministic intent compilation.
 */

'use strict';

/**
 * Physical Dimension representation: [M, L, T, Theta, I]
 * Mass (M), Length (L), Time (T), Temperature (Theta), Electric Current (I)
 */
class PhysicalDimension {
  constructor(m = 0, l = 0, t = 0, theta = 0, i = 0) {
    this.m = m;
    this.l = l;
    this.t = t;
    this.theta = theta;
    this.i = i;
  }

  static dimensionless() {
    return new PhysicalDimension(0, 0, 0, 0, 0);
  }

  static mass() {
    return new PhysicalDimension(1, 0, 0, 0, 0);
  }

  static length() {
    return new PhysicalDimension(0, 1, 0, 0, 0);
  }

  static time() {
    return new PhysicalDimension(0, 0, 1, 0, 0);
  }

  static temperature() {
    return new PhysicalDimension(0, 0, 0, 1, 0);
  }

  static current() {
    return new PhysicalDimension(0, 0, 0, 0, 1);
  }

  static force() { // M L T^-2 (Newton)
    return new PhysicalDimension(1, 1, -2, 0, 0);
  }

  static pressure() { // M L^-1 T^-2 (Pascal)
    return new PhysicalDimension(1, -1, -2, 0, 0);
  }

  static energy() { // M L^2 T^-2 (Joule)
    return new PhysicalDimension(1, 2, -2, 0, 0);
  }

  static power() { // M L^2 T^-3 (Watt)
    return new PhysicalDimension(1, 2, -3, 0, 0);
  }

  static velocity() { // L T^-1 (m/s)
    return new PhysicalDimension(0, 1, -1, 0, 0);
  }

  static acceleration() { // L T^-2 (m/s^2)
    return new PhysicalDimension(0, 1, -2, 0, 0);
  }

  static voltage() { // M L^2 T^-3 I^-1 (Volt)
    return new PhysicalDimension(1, 2, -3, 0, -1);
  }

  static resistance() { // M L^2 T^-3 I^-2 (Ohm)
    return new PhysicalDimension(1, 2, -3, 0, -2);
  }

  static capacitance() { // M^-1 L^-2 T^4 I^2 (Farad)
    return new PhysicalDimension(-1, -2, 4, 0, 2);
  }

  static dynamicViscosity() { // M L^-1 T^-1 (Pa*s)
    return new PhysicalDimension(1, -1, -1, 0, 0);
  }

  static thermalConductivity() { // M L T^-3 Theta^-1 (W/(m*K))
    return new PhysicalDimension(1, 1, -3, -1, 0);
  }

  add(other) {
    if (!this.equals(other)) {
      throw new Error(`Incompatible dimensions for addition: [${this.format()}] vs [${other.format()}]`);
    }
    return new PhysicalDimension(this.m, this.l, this.t, this.theta, this.i);
  }

  sub(other) {
    if (!this.equals(other)) {
      throw new Error(`Incompatible dimensions for subtraction: [${this.format()}] vs [${other.format()}]`);
    }
    return new PhysicalDimension(this.m, this.l, this.t, this.theta, this.i);
  }

  mul(other) {
    return new PhysicalDimension(
      this.m + other.m,
      this.l + other.l,
      this.t + other.t,
      this.theta + other.theta,
      this.i + other.i
    );
  }

  div(other) {
    return new PhysicalDimension(
      this.m - other.m,
      this.l - other.l,
      this.t - other.t,
      this.theta - other.theta,
      this.i - other.i
    );
  }

  pow(power) {
    return new PhysicalDimension(
      this.m * power,
      this.l * power,
      this.t * power,
      this.theta * power,
      this.i * power
    );
  }

  equals(other) {
    const eps = 1e-6;
    return (
      Math.abs(this.m - other.m) < eps &&
      Math.abs(this.l - other.l) < eps &&
      Math.abs(this.t - other.t) < eps &&
      Math.abs(this.theta - other.theta) < eps &&
      Math.abs(this.i - other.i) < eps
    );
  }

  format() {
    const parts = [];
    if (this.m !== 0) parts.push(`M^${this.m}`);
    if (this.l !== 0) parts.push(`L^${this.l}`);
    if (this.t !== 0) parts.push(`T^${this.t}`);
    if (this.theta !== 0) parts.push(`Theta^${this.theta}`);
    if (this.i !== 0) parts.push(`I^${this.i}`);
    return parts.length > 0 ? parts.join(' ') : 'Dimensionless';
  }
}

/**
 * Unit Registry with Exact Physical Conversion Factors to SI Base Units
 */
const UNIT_REGISTRY = {
  // Length (L) -> Base: meter (m)
  m: { dimension: PhysicalDimension.length(), factor: 1.0 },
  mm: { dimension: PhysicalDimension.length(), factor: 1e-3 },
  cm: { dimension: PhysicalDimension.length(), factor: 1e-2 },
  km: { dimension: PhysicalDimension.length(), factor: 1e3 },
  in: { dimension: PhysicalDimension.length(), factor: 0.0254 },
  ft: { dimension: PhysicalDimension.length(), factor: 0.3048 },
  nm: { dimension: PhysicalDimension.length(), factor: 1e-9 },
  um: { dimension: PhysicalDimension.length(), factor: 1e-6 },

  // Mass (M) -> Base: kilogram (kg)
  kg: { dimension: PhysicalDimension.mass(), factor: 1.0 },
  g: { dimension: PhysicalDimension.mass(), factor: 1e-3 },
  mg: { dimension: PhysicalDimension.mass(), factor: 1e-6 },
  lb: { dimension: PhysicalDimension.mass(), factor: 0.45359237 },
  oz: { dimension: PhysicalDimension.mass(), factor: 0.028349523125 },

  // Time (T) -> Base: second (s)
  s: { dimension: PhysicalDimension.time(), factor: 1.0 },
  ms: { dimension: PhysicalDimension.time(), factor: 1e-3 },
  us: { dimension: PhysicalDimension.time(), factor: 1e-6 },
  min: { dimension: PhysicalDimension.time(), factor: 60.0 },
  hr: { dimension: PhysicalDimension.time(), factor: 3600.0 },

  // Force (M L T^-2) -> Base: Newton (N)
  N: { dimension: PhysicalDimension.force(), factor: 1.0 },
  kN: { dimension: PhysicalDimension.force(), factor: 1e3 },
  mN: { dimension: PhysicalDimension.force(), factor: 1e-3 },
  lbf: { dimension: PhysicalDimension.force(), factor: 4.4482216152605 },

  // Pressure & Stress (M L^-1 T^-2) -> Base: Pascal (Pa)
  Pa: { dimension: PhysicalDimension.pressure(), factor: 1.0 },
  kPa: { dimension: PhysicalDimension.pressure(), factor: 1e3 },
  MPa: { dimension: PhysicalDimension.pressure(), factor: 1e6 },
  GPa: { dimension: PhysicalDimension.pressure(), factor: 1e9 },
  bar: { dimension: PhysicalDimension.pressure(), factor: 1e5 },
  psi: { dimension: PhysicalDimension.pressure(), factor: 6894.757293168 },

  // Velocity (L T^-1) -> Base: m/s
  'm/s': { dimension: PhysicalDimension.velocity(), factor: 1.0 },
  'km/h': { dimension: PhysicalDimension.velocity(), factor: 1.0 / 3.6 },
  'ft/s': { dimension: PhysicalDimension.velocity(), factor: 0.3048 },
  knot: { dimension: PhysicalDimension.velocity(), factor: 0.514444 },

  // Acceleration (L T^-2) -> Base: m/s^2
  'm/s^2': { dimension: PhysicalDimension.acceleration(), factor: 1.0 },
  g_accel: { dimension: PhysicalDimension.acceleration(), factor: 9.80665 },

  // Energy (M L^2 T^-2) -> Base: Joule (J)
  J: { dimension: PhysicalDimension.energy(), factor: 1.0 },
  kJ: { dimension: PhysicalDimension.energy(), factor: 1e3 },
  Wh: { dimension: PhysicalDimension.energy(), factor: 3600.0 },
  kWh: { dimension: PhysicalDimension.energy(), factor: 3.6e6 },

  // Power (M L^2 T^-3) -> Base: Watt (W)
  W: { dimension: PhysicalDimension.power(), factor: 1.0 },
  kW: { dimension: PhysicalDimension.power(), factor: 1e3 },
  mW: { dimension: PhysicalDimension.power(), factor: 1e-3 },
  hp: { dimension: PhysicalDimension.power(), factor: 745.699872 },

  // Electrical (V, Ohm, F, A)
  A: { dimension: PhysicalDimension.current(), factor: 1.0 },
  mA: { dimension: PhysicalDimension.current(), factor: 1e-3 },
  uA: { dimension: PhysicalDimension.current(), factor: 1e-6 },
  V: { dimension: PhysicalDimension.voltage(), factor: 1.0 },
  mV: { dimension: PhysicalDimension.voltage(), factor: 1e-3 },
  kV: { dimension: PhysicalDimension.voltage(), factor: 1e3 },
  ohm: { dimension: PhysicalDimension.resistance(), factor: 1.0 },
  kohm: { dimension: PhysicalDimension.resistance(), factor: 1e3 },
  Mohm: { dimension: PhysicalDimension.resistance(), factor: 1e6 },
  F: { dimension: PhysicalDimension.capacitance(), factor: 1.0 },
  uF: { dimension: PhysicalDimension.capacitance(), factor: 1e-6 },
  nF: { dimension: PhysicalDimension.capacitance(), factor: 1e-9 },
  pF: { dimension: PhysicalDimension.capacitance(), factor: 1e-12 },

  // Dimensionless
  rad: { dimension: PhysicalDimension.dimensionless(), factor: 1.0 },
  deg: { dimension: PhysicalDimension.dimensionless(), factor: Math.PI / 180.0 },
  ratio: { dimension: PhysicalDimension.dimensionless(), factor: 1.0 }
};

/**
 * Dimensional Value: Combines numerical magnitude, unit string, and physical dimension
 */
class DimensionalQuantity {
  constructor(magnitude, unit) {
    this.magnitude = Number(magnitude);
    this.unit = unit;

    const unitInfo = UNIT_REGISTRY[unit];
    if (!unitInfo) {
      throw new Error(`Unknown physical unit: '${unit}'`);
    }
    this.dimension = unitInfo.dimension;
    this.factor = unitInfo.factor;
  }

  toBase() {
    return this.magnitude * this.factor;
  }

  convertTo(targetUnit) {
    const targetInfo = UNIT_REGISTRY[targetUnit];
    if (!targetInfo) {
      throw new Error(`Unknown target unit: '${targetUnit}'`);
    }
    if (!this.dimension.equals(targetInfo.dimension)) {
      throw new Error(`Dimension mismatch: cannot convert ${this.unit} [${this.dimension.format()}] to ${targetUnit} [${targetInfo.dimension.format()}]`);
    }
    const baseVal = this.toBase();
    return new DimensionalQuantity(baseVal / targetInfo.factor, targetUnit);
  }

  static verifyHomogeneity(qtyA, qtyB, operationName) {
    if (!qtyA.dimension.equals(qtyB.dimension)) {
      throw new Error(
        `Dimensional Inconsistency in ${operationName}: [${qtyA.dimension.format()}] (${qtyA.unit}) is incompatible with [${qtyB.dimension.format()}] (${qtyB.unit})`
      );
    }
    return true;
  }
}

/**
 * Codified Multi-Physics Knowledge Graph (SMP-KG)
 * Encapsulates closed-form fundamental engineering relations with dimensional validation
 */
class SymbolicPhysicsKnowledgeGraph {
  constructor() {
    this.constants = {
      g: 9.80665, // m/s^2 (Standard gravitational acceleration)
      rhoAir: 1.225, // kg/m^3 (Sea-level air density at 15°C)
      rhoWater: 1000.0, // kg/m^3
      cLight: 299792458, // m/s (Speed of light in vacuum)
      R_universal: 8.314462618 // J/(mol*K) (Universal gas constant)
    };
  }

  // 1. Hooke's Law: Stress & Axial Elongation (Mechanics)
  calculateAxialElongation(forceN, lengthM, areaM2, youngsModulusPa) {
    // delta = (F * L) / (A * E)
    if (areaM2 <= 0 || youngsModulusPa <= 0) {
      throw new Error('Area and Youngs Modulus must be positive');
    }
    const stressPa = forceN / areaM2;
    const strain = stressPa / youngsModulusPa;
    const elongationM = strain * lengthM;
    return {
      stressPa,
      stressMPa: stressPa / 1e6,
      strain,
      elongationM,
      elongationMm: elongationM * 1e3
    };
  }

  // 2. Thin-Walled Pressure Vessel Hoop Stress (Plant & Piping)
  calculatePressureVesselStress(pressurePa, innerDiameterM, wallThicknessM, jointEfficiency = 1.0) {
    // sigma_hoop = (P * D) / (2 * t * E)
    // sigma_longitudinal = (P * D) / (4 * t * E)
    if (wallThicknessM <= 0) throw new Error('Wall thickness must be positive');
    const hoopStressPa = (pressurePa * innerDiameterM) / (2 * wallThicknessM * jointEfficiency);
    const longitudinalStressPa = (pressurePa * innerDiameterM) / (4 * wallThicknessM * jointEfficiency);
    const vonMisesPa = Math.sqrt(
      Math.pow(hoopStressPa, 2) - hoopStressPa * longitudinalStressPa + Math.pow(longitudinalStressPa, 2)
    );
    return {
      hoopStressPa,
      hoopStressMPa: hoopStressPa / 1e6,
      longitudinalStressPa,
      longitudinalStressMPa: longitudinalStressPa / 1e6,
      vonMisesPa,
      vonMisesMPa: vonMisesPa / 1e6
    };
  }

  // 3. Euler-Bernoulli Beam Bending Stress & Deflection (Structures)
  calculateCantileverBeamBending(loadN, lengthM, widthM, heightM, youngsModulusPa) {
    // I = (w * h^3) / 12
    // M_max = F * L
    // sigma_max = (M * c) / I
    // delta_max = (F * L^3) / (3 * E * I)
    const momentOfInertia = (widthM * Math.pow(heightM, 3)) / 12.0;
    const momentMax = loadN * lengthM;
    const c = heightM / 2.0;
    const maxStressPa = (momentMax * c) / momentOfInertia;
    const maxDeflectionM = (loadN * Math.pow(lengthM, 3)) / (3.0 * youngsModulusPa * momentOfInertia);
    return {
      momentOfInertiaM4: momentOfInertia,
      maxMomentNm: momentMax,
      maxStressPa,
      maxStressMPa: maxStressPa / 1e6,
      maxDeflectionM,
      maxDeflectionMm: maxDeflectionM * 1e3
    };
  }

  // 4. Darcy-Weisbach Pipe Flow Friction & Pressure Drop (Fluids)
  calculatePipePressureDrop(flowRateM3s, pipeLengthM, innerDiameterM, roughnessM, fluidDensityKgM3, dynamicViscosityPaS) {
    const area = Math.PI * Math.pow(innerDiameterM / 2.0, 2);
    const velocity = flowRateM3s / area;
    const reynolds = (fluidDensityKgM3 * velocity * innerDiameterM) / dynamicViscosityPaS;

    let frictionFactor;
    if (reynolds < 2300) {
      frictionFactor = 64.0 / reynolds; // Laminar flow
    } else {
      // Swamee-Jain explicit approximation of Colebrook equation
      const relativeRoughness = roughnessM / innerDiameterM;
      const term1 = relativeRoughness / 3.7;
      const term2 = 5.74 / Math.pow(reynolds, 0.9);
      frictionFactor = 0.25 / Math.pow(Math.log10(term1 + term2), 2);
    }

    const pressureDropPa = frictionFactor * (pipeLengthM / innerDiameterM) * (fluidDensityKgM3 * Math.pow(velocity, 2) / 2.0);
    return {
      velocityMs: velocity,
      reynoldsNumber: reynolds,
      flowRegime: reynolds < 2300 ? 'Laminar' : reynolds < 4000 ? 'Transitional' : 'Turbulent',
      frictionFactor,
      pressureDropPa,
      pressureDropKPa: pressureDropPa / 1e3,
      pressureDropBar: pressureDropPa / 1e5
    };
  }

  // 5. Fourier Thermal Conduction & Convection (Thermal/Heat Transfer)
  calculateHeatFlux(thicknessM, thermalConductivityW_mK, areaM2, tempHotK, tempColdK) {
    // q = -k * A * (dT / dx)
    const deltaT = tempHotK - tempColdK;
    const thermalResistance = thicknessM / (thermalConductivityW_mK * areaM2);
    const heatFlowWatts = deltaT / thermalResistance;
    const heatFluxWattsM2 = heatFlowWatts / areaM2;
    return {
      deltaTK: deltaT,
      thermalResistanceK_W: thermalResistance,
      heatFlowWatts,
      heatFluxWattsM2
    };
  }

  // 6. Drone Hover Thrust & Actuator Disk Power (Aerospace & Robotics)
  calculateDroneHoverAerodynamics(
    allUpMassKg,
    rotorCount,
    propellerDiameterInches,
    figureOfMerit,
    airDensityKgM3,
    gravityMPerS2
  ) {
    const validInputs = [allUpMassKg, propellerDiameterInches, figureOfMerit, airDensityKgM3, gravityMPerS2].every(
      (value) => Number.isFinite(value) && value > 0
    );
    if (!validInputs || !Number.isInteger(rotorCount) || rotorCount < 1 || figureOfMerit > 1) {
      throw new TypeError(
        'Hover estimate requires positive mass, propeller diameter, figure of merit, air density, gravity, and a positive integer rotorCount.'
      );
    }

    const diameterM = propellerDiameterInches * 0.0254;
    const diskAreaSingleM2 = Math.PI * Math.pow(diameterM / 2.0, 2);
    const totalDiskAreaM2 = rotorCount * diskAreaSingleM2;
    const totalThrustN = allUpMassKg * gravityMPerS2;
    const thrustPerRotorN = totalThrustN / rotorCount;

    // Momentum theory ideal hover power: P_ideal = T^(3/2) / sqrt(2 * rho * A)
    const idealPowerWatts = Math.pow(totalThrustN, 1.5) / Math.sqrt(2.0 * airDensityKgM3 * totalDiskAreaM2);
    const actualHoverPowerWatts = idealPowerWatts / figureOfMerit;
    const powerPerRotorWatts = actualHoverPowerWatts / rotorCount;
    const finiteResults = [
      totalThrustN,
      thrustPerRotorN,
      totalDiskAreaM2,
      idealPowerWatts,
      actualHoverPowerWatts,
      powerPerRotorWatts
    ];
    if (finiteResults.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new RangeError('The supplied hover inputs exceed the finite numeric range.');
    }

    return {
      totalWeightN: totalThrustN,
      thrustPerRotorN,
      thrustPerRotorGrams: (thrustPerRotorN / gravityMPerS2) * 1e3,
      totalDiskAreaM2,
      inducedVelocityMs: Math.sqrt(totalThrustN / (2.0 * airDensityKgM3 * totalDiskAreaM2)),
      figureOfMerit,
      airDensityKgM3,
      gravityMPerS2,
      idealHoverPowerWatts: idealPowerWatts,
      actualHoverPowerWatts,
      powerPerRotorWatts
    };
  }

  // 7. Lensmaker's Equation & Focal Length (Optics)
  calculateLensmakerFocalLength(nGlass, r1M, r2M, centerThicknessM) {
    // 1/f = (n - 1) * [ 1/R1 - 1/R2 + ((n - 1) * d) / (n * R1 * R2) ]
    const term1 = (nGlass - 1.0);
    const term2 = (1.0 / r1M) - (1.0 / r2M) + ((nGlass - 1.0) * centerThicknessM) / (nGlass * r1M * r2M);
    const powerDiopters = term1 * term2;
    const focalLengthM = 1.0 / powerDiopters;
    return {
      powerDiopters,
      focalLengthM,
      focalLengthMm: focalLengthM * 1e3
    };
  }
}

/**
 * Autonomous Nelder-Mead Simplex Optimizer
 * Built from scratch for multidimensional non-linear engineering parameter optimization
 */
class NelderMeadOptimizer {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 150;
    this.tolerance = options.tolerance || 1e-5;
    this.alpha = options.alpha || 1.0; // Reflection
    this.gamma = options.gamma || 2.0; // Expansion
    this.rho = options.rho || 0.5;   // Contraction
    this.sigma = options.sigma || 0.5; // Shrink
  }

  /**
   * Minimize objectiveFunction(params) subject to bounds
   * @param {Function} objectiveFunc - Returns scalar cost to minimize
   * @param {Array<number>} initialGuess - Initial parameter array [x1, x2, ...]
   * @param {Array<{min: number, max: number}>} bounds - Bounds per parameter
   */
  minimize(objectiveFunc, initialGuess, bounds = []) {
    const n = initialGuess.length;
    const simplex = [];

    // Helper: Enforce box bounds via penalty
    const boundedObjective = (params) => {
      let penalty = 0;
      for (let i = 0; i < n; i++) {
        if (bounds[i]) {
          if (params[i] < bounds[i].min) {
            penalty += 1e6 * Math.pow(bounds[i].min - params[i], 2);
          } else if (params[i] > bounds[i].max) {
            penalty += 1e6 * Math.pow(params[i] - bounds[i].max, 2);
          }
        }
      }
      return objectiveFunc(params) + penalty;
    };

    // Step 1: Initialize Simplex (n + 1 vertices)
    const p0 = initialGuess.slice();
    simplex.push({ point: p0, cost: boundedObjective(p0) });

    for (let i = 0; i < n; i++) {
      const p = p0.slice();
      const step = Math.abs(p[i]) > 1e-4 ? 0.05 * p[i] : 0.001;
      p[i] += step;
      simplex.push({ point: p, cost: boundedObjective(p) });
    }

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      // Sort simplex by cost: simplex[0] is best, simplex[n] is worst
      simplex.sort((a, b) => a.cost - b.cost);

      // Check termination criterion (variance of costs)
      let costMean = 0;
      for (let i = 0; i <= n; i++) costMean += simplex[i].cost;
      costMean /= (n + 1);

      let variance = 0;
      for (let i = 0; i <= n; i++) variance += Math.pow(simplex[i].cost - costMean, 2);
      variance /= (n + 1);

      if (Math.sqrt(variance) < this.tolerance) {
        break;
      }

      // Compute centroid of all points except the worst
      const centroid = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          centroid[j] += simplex[i].point[j];
        }
      }
      for (let j = 0; j < n; j++) centroid[j] /= n;

      const worst = simplex[n];
      const secondWorst = simplex[n - 1];
      const best = simplex[0];

      // Step 2: Reflection
      const reflected = new Array(n);
      for (let j = 0; j < n; j++) {
        reflected[j] = centroid[j] + this.alpha * (centroid[j] - worst.point[j]);
      }
      const reflectedCost = boundedObjective(reflected);

      if (reflectedCost < secondWorst.cost && reflectedCost >= best.cost) {
        simplex[n] = { point: reflected, cost: reflectedCost };
        continue;
      }

      // Step 3: Expansion
      if (reflectedCost < best.cost) {
        const expanded = new Array(n);
        for (let j = 0; j < n; j++) {
          expanded[j] = centroid[j] + this.gamma * (reflected[j] - centroid[j]);
        }
        const expandedCost = boundedObjective(expanded);
        if (expandedCost < reflectedCost) {
          simplex[n] = { point: expanded, cost: expandedCost };
        } else {
          simplex[n] = { point: reflected, cost: reflectedCost };
        }
        continue;
      }

      // Step 4: Contraction
      const contracted = new Array(n);
      for (let j = 0; j < n; j++) {
        contracted[j] = centroid[j] + this.rho * (worst.point[j] - centroid[j]);
      }
      const contractedCost = boundedObjective(contracted);

      if (contractedCost < worst.cost) {
        simplex[n] = { point: contracted, cost: contractedCost };
        continue;
      }

      // Step 5: Shrink
      for (let i = 1; i <= n; i++) {
        for (let j = 0; j < n; j++) {
          simplex[i].point[j] = best.point[j] + this.sigma * (simplex[i].point[j] - best.point[j]);
        }
        simplex[i].cost = boundedObjective(simplex[i].point);
      }
    }

    simplex.sort((a, b) => a.cost - b.cost);
    return {
      optimalParams: simplex[0].point,
      optimalCost: simplex[0].cost,
      iterations,
      converged: iterations < this.maxIterations
    };
  }
}

/**
 * Deterministic Engineering Intent Lexer & Slot-Filler
 * Parses plain-language requests into structured engineering AST commands without neural models
 */
class DeterministicIntentLexer {
  constructor() {
    this.intentPatterns = [
      {
        action: 'DROP_TEST',
        trigger: /(?:drop\s*test|drop|impact|durability)/i,
        extract: (prompt) => {
          const numMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(m|mm|cm|ft|meter)/i);
          const heightM = numMatch ? new DimensionalQuantity(parseFloat(numMatch[1]), numMatch[2] === 'meter' ? 'm' : numMatch[2]).toBase() : 1.5;
          return {
            type: 'SIMULATION',
            domain: 'cae',
            task: 'drop_test',
            heightM
          };
        }
      },
      {
        action: 'OPTIMIZE_WALL',
        trigger: /(?:thicken|increase|reduce|adjust)\s*(?:wall|casing|thickness)/i,
        extract: (prompt) => {
          const numMatch = prompt.match(/(?:to\s*)?(\d+(?:\.\d+)?)\s*(mm|m|in)/i);
          return {
            type: 'OPTIMIZATION',
            domain: 'cad',
            targetParameter: 'wallThickness',
            targetValue: numMatch ? new DimensionalQuantity(parseFloat(numMatch[1]), numMatch[2]).toBase() : null
          };
        }
      },
      {
        action: 'DESIGN_LENS',
        trigger: /(?:lens|camera|optics)/i,
        extract: (prompt) => {
          const focalMatch = prompt.match(/(\d+(?:\.\d+)?)\s*mm/i);
          const fStopMatch = prompt.match(/f\/?(\d+(?:\.\d+)?)/i);
          return {
            type: 'DESIGN',
            domain: 'optics',
            focalLengthMm: focalMatch ? parseFloat(focalMatch[1]) : 50.0,
            fStop: fStopMatch ? parseFloat(fStopMatch[1]) : 1.4
          };
        }
      },
      {
        action: 'DRONE_TUNE',
        trigger: /(?:drone|quadcopter|flight|uav)/i,
        extract: (prompt) => {
          const payloadMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(g|kg)/i);
          return {
            type: 'CONTROL_TUNING',
            domain: 'gnc',
            payloadKg: payloadMatch ? new DimensionalQuantity(parseFloat(payloadMatch[1]), payloadMatch[2]).toBase() : 0.25
          };
        }
      },
      {
        action: 'PIPING_STRESS',
        trigger: /(?:pipe|piping|asme|flange)/i,
        extract: (prompt) => {
          const pressMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mpa|kpa|pa)/i);
          return {
            type: 'COMPLIANCE',
            domain: 'plant',
            designPressurePa: pressMatch ? new DimensionalQuantity(parseFloat(pressMatch[1]), pressMatch[2]).toBase() : 2.0e6
          };
        }
      }
    ];
  }

  parse(promptText) {
    if (!promptText || typeof promptText !== 'string') {
      return { action: 'UNKNOWN', confidence: 0, params: {} };
    }

    for (const pattern of this.intentPatterns) {
      if (pattern.trigger.test(promptText)) {
        return {
          action: pattern.action,
          confidence: 0.95,
          rawPrompt: promptText,
          params: pattern.extract(promptText)
        };
      }
    }

    return {
      action: 'GENERAL_QUERY',
      confidence: 0.5,
      rawPrompt: promptText,
      params: {}
    };
  }
}

/**
 * Top-Level Symbolic Reasoner: Unifies Dimensional Analysis, Knowledge Graph, Optimization and Intent
 */
class SymbolicReasoner {
  constructor() {
    this.dimensions = PhysicalDimension;
    this.units = UNIT_REGISTRY;
    this.knowledgeGraph = new SymbolicPhysicsKnowledgeGraph();
    this.optimizer = new NelderMeadOptimizer();
    this.lexer = new DeterministicIntentLexer();
  }

  createQuantity(magnitude, unit) {
    return new DimensionalQuantity(magnitude, unit);
  }

  verifyEquation(qtyA, qtyB, equationName) {
    return DimensionalQuantity.verifyHomogeneity(qtyA, qtyB, equationName);
  }

  parseIntent(promptText) {
    return this.lexer.parse(promptText);
  }

  /**
   * Experimental Euler-Bernoulli cantilever thickness estimate. This is a
   * formula screen, not an FEA result, safety-factor verification, or design edit.
   * @param {Object} currentDesign Explicit dimensions, load, modulus, strength, and search bounds
   * @param {number} safetyFactor User-supplied target used only to derive a comparison stress
   */
  estimateCantileverThickness(currentDesign, safetyFactor) {
    const required = [
      'wallThicknessMm',
      'loadN',
      'lengthMm',
      'widthMm',
      'yieldStrengthMPa',
      'youngsModulusGPa',
      'minThicknessMm',
      'maxThicknessMm'
    ];
    if (!currentDesign || typeof currentDesign !== 'object' || Array.isArray(currentDesign)) {
      throw new TypeError('An explicit cantilever design object is required.');
    }
    const missing = required.filter((key) => !Number.isFinite(currentDesign[key]));
    if (missing.length > 0 || !Number.isFinite(safetyFactor)) {
      throw new TypeError(`Explicit finite design inputs and safetyFactor are required; missing or invalid: ${[...missing, ...(!Number.isFinite(safetyFactor) ? ['safetyFactor'] : [])].join(', ')}.`);
    }
    if (
      required.some((key) => currentDesign[key] <= 0) ||
      safetyFactor <= 0 ||
      currentDesign.minThicknessMm >= currentDesign.maxThicknessMm ||
      currentDesign.wallThicknessMm < currentDesign.minThicknessMm ||
      currentDesign.wallThicknessMm > currentDesign.maxThicknessMm
    ) {
      throw new RangeError('Cantilever inputs and thickness bounds must be positive, ordered, and include the current wall thickness.');
    }

    const targetStressPa = (currentDesign.yieldStrengthMPa * 1e6) / safetyFactor;
    const lengthM = currentDesign.lengthMm * 1e-3;
    const widthM = currentDesign.widthMm * 1e-3;
    const loadN = currentDesign.loadN;
    const youngsModulusPa = currentDesign.youngsModulusGPa * 1e9;
    const objective = ([thicknessM]) => {
      const response = this.knowledgeGraph.calculateCantileverBeamBending(
        loadN,
        lengthM,
        widthM,
        thicknessM,
        youngsModulusPa
      );
      const excessStressPa = Math.max(0, response.maxStressPa - targetStressPa);
      return thicknessM * 100 + (excessStressPa / targetStressPa) * 1000;
    };

    const bounds = [{ min: currentDesign.minThicknessMm * 1e-3, max: currentDesign.maxThicknessMm * 1e-3 }];
    const result = this.optimizer.minimize(objective, [currentDesign.wallThicknessMm * 1e-3], bounds);
    const candidateThicknessM = result.optimalParams[0];
    const predictedResponse = this.knowledgeGraph.calculateCantileverBeamBending(
      loadN,
      lengthM,
      widthM,
      candidateThicknessM,
      youngsModulusPa
    );

    return {
      status: 'ESTIMATE_ONLY',
      validationLevel: 'experimental',
      model: 'bounded Euler-Bernoulli cantilever formula with Nelder-Mead thickness search',
      inputs: { ...currentDesign, safetyFactor },
      estimate: {
        candidateThicknessMm: Math.round(candidateThicknessM * 1e5) / 100,
        predictedBendingStressMPa: Math.round(predictedResponse.maxStressMPa * 10) / 10,
        targetStressMPa: Math.round(targetStressPa / 1e5) / 10
      },
      warning: 'No finite-element solve, material validation, safety-factor verification, failure assessment, or design change was performed.'
    };
  }

  /** @deprecated Compatibility alias; this method returns an estimate only and never heals or edits a design. */
  selfHealStructuralYield(currentDesign, safetyFactor) {
    return this.estimateCantileverThickness(currentDesign, safetyFactor);
  }
}

module.exports = {
  PhysicalDimension,
  UNIT_REGISTRY,
  DimensionalQuantity,
  SymbolicPhysicsKnowledgeGraph,
  NelderMeadOptimizer,
  DeterministicIntentLexer,
  SymbolicReasoner
};
