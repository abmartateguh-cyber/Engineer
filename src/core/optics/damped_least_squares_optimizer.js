/**
 * Experimental paraxial ray merit optimizer using damped least squares.
 *
 * A caller supplies the complete sequential system, metric sampling geometry,
 * residual targets, variable bounds, and optimizer controls. This module does
 * not supply a lens prescription or claim independent optical validation.
 */

'use strict';

const REQUIRED_OPTIONS = [
  'initialDamping',
  'minimumDamping',
  'maximumDamping',
  'dampingReductionFactor',
  'dampingIncreaseFactor',
  'maxIterations',
  'tolerance',
  'finiteDiffStep'
];

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function getSurfaceCurvature(surface, index) {
  if (Object.hasOwn(surface, 'curvature')) {
    if (!Number.isFinite(surface.curvature)) {
      throw new TypeError(`Surface ${index} curvature must be finite in 1/mm.`);
    }
    return surface.curvature;
  }

  if (!Number.isFinite(surface.radius) || surface.radius === 0) {
    throw new TypeError(`Surface ${index} requires finite curvature or a nonzero radius in mm.`);
  }
  return 1 / surface.radius;
}

function validateSystem(system, requireMetricSampling = false) {
  if (!system || typeof system !== 'object' || !Array.isArray(system.surfaces) || system.surfaces.length < 2) {
    throw new TypeError('Provide a sequential optical system with at least two surfaces.');
  }
  if (!isFinitePositive(system.initialRefractiveIndex)) {
    throw new TypeError('Provide an explicit positive initialRefractiveIndex.');
  }

  system.surfaces.forEach((surface, index) => {
    if (!surface || typeof surface !== 'object') {
      throw new TypeError(`Surface ${index} must be an object.`);
    }
    getSurfaceCurvature(surface, index);
    if (!isFinitePositive(surface.refractiveIndex)) {
      throw new TypeError(`Surface ${index} requires an explicit positive refractiveIndex.`);
    }
    if (!Number.isFinite(surface.thickness) || surface.thickness < 0) {
      throw new TypeError(`Surface ${index} requires an explicit nonnegative thickness in mm.`);
    }
  });

  if (requireMetricSampling) {
    const sampling = system.metricSampling;
    if (!sampling || typeof sampling !== 'object') {
      throw new TypeError('Provide explicit metricSampling inputs for the experimental paraxial metrics.');
    }
    if (!isFinitePositive(sampling.entrancePupilRadiusMm)) {
      throw new TypeError('metricSampling.entrancePupilRadiusMm must be explicit and positive.');
    }
    if (!isFinitePositive(sampling.paraxialRayHeightMm)) {
      throw new TypeError('metricSampling.paraxialRayHeightMm must be explicit and positive.');
    }
    if (
      !Number.isFinite(sampling.zonalRayFraction) ||
      sampling.zonalRayFraction <= 0 ||
      sampling.zonalRayFraction >= 1
    ) {
      throw new TypeError('metricSampling.zonalRayFraction must be explicit and between zero and one.');
    }
    if (!Number.isFinite(sampling.chiefRayAngleRad)) {
      throw new TypeError('metricSampling.chiefRayAngleRad must be explicit and finite in radians.');
    }
  }
}

function validateOperands(operands) {
  if (!Array.isArray(operands) || operands.length === 0) {
    throw new TypeError('Provide at least one explicit optical merit operand.');
  }

  const supportedTypes = new Set([
    'PARAXIAL_FOCAL_LENGTH',
    'TERMINAL_RAY_SPREAD',
    'MARGINAL_RAY_HEIGHT',
    'CHIEF_RAY_HEIGHT'
  ]);

  operands.forEach((operand, index) => {
    if (!operand || typeof operand !== 'object') {
      throw new TypeError(`Merit operand ${index} must be an object.`);
    }
    if (!supportedTypes.has(operand.type)) {
      throw new TypeError(`Merit operand ${index} has unsupported type '${operand.type}'.`);
    }
    if (!isFinitePositive(operand.weight)) {
      throw new TypeError(`Merit operand ${index} requires a positive residual scale in weight.`);
    }
    if (!Number.isFinite(operand.targetMm)) {
      throw new TypeError(`Merit operand ${index} requires a finite targetMm.`);
    }
  });
}

class DampedLeastSquaresOptimizer {
  /**
   * Optimizer controls are required by optimize(). An empty options object is
   * allowed for callers that only use traceMeridionalRay().
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Optimizer options must be an object.');
    }
    this.options = { ...options };
  }

  _validatedOptions() {
    for (const key of REQUIRED_OPTIONS) {
      if (!Object.hasOwn(this.options, key)) {
        throw new TypeError(`Provide the optimizer option '${key}'.`);
      }
      if (!Number.isFinite(this.options[key])) {
        throw new TypeError(`Optimizer option '${key}' must be finite.`);
      }
    }

    const {
      initialDamping,
      minimumDamping,
      maximumDamping,
      dampingReductionFactor,
      dampingIncreaseFactor,
      maxIterations,
      tolerance,
      finiteDiffStep
    } = this.options;

    if (!isFinitePositive(minimumDamping) || !isFinitePositive(maximumDamping) || minimumDamping >= maximumDamping) {
      throw new TypeError('Optimizer damping bounds must be positive and minimumDamping must be below maximumDamping.');
    }
    if (!isFinitePositive(initialDamping) || initialDamping < minimumDamping || initialDamping > maximumDamping) {
      throw new TypeError('initialDamping must lie within the explicit positive damping bounds.');
    }
    if (!isFinitePositive(dampingReductionFactor) || dampingReductionFactor <= 1) {
      throw new TypeError('dampingReductionFactor must be greater than one.');
    }
    if (!isFinitePositive(dampingIncreaseFactor) || dampingIncreaseFactor <= 1) {
      throw new TypeError('dampingIncreaseFactor must be greater than one.');
    }
    if (!Number.isInteger(maxIterations) || maxIterations < 1) {
      throw new TypeError('maxIterations must be an explicit positive integer.');
    }
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new TypeError('tolerance must be an explicit nonnegative merit tolerance.');
    }
    if (!isFinitePositive(finiteDiffStep) || finiteDiffStep >= 1) {
      throw new TypeError('finiteDiffStep must be an explicit fraction greater than zero and less than one.');
    }

    return this.options;
  }

  /**
   * Trace a caller-specified paraxial meridional ray.
   * Surface refractive indices are the indices after their respective surfaces.
   */
  traceMeridionalRay(system, rayHeightMm, rayAngleRad) {
    validateSystem(system);
    if (!Number.isFinite(rayHeightMm) || !Number.isFinite(rayAngleRad)) {
      throw new TypeError('rayHeightMm and rayAngleRad must be explicit finite values in mm and radians.');
    }

    let y = rayHeightMm;
    let u = rayAngleRad;
    let zMm = 0;
    const history = [{ surface: 0, zMm, yMm: y, angleRad: u }];

    for (let index = 0; index < system.surfaces.length; index += 1) {
      const surface = system.surfaces[index];
      const curvature = getSurfaceCurvature(surface, index);
      const n1 = index === 0 ? system.initialRefractiveIndex : system.surfaces[index - 1].refractiveIndex;
      const n2 = surface.refractiveIndex;

      u = (n1 * u - y * curvature * (n2 - n1)) / n2;
      history.push({ surface: index + 1, zMm, yMm: y, angleRad: u });

      if (index < system.surfaces.length - 1) {
        y += surface.thickness * u;
        zMm += surface.thickness;
      }
    }

    if (![y, u, zMm].every(Number.isFinite)) {
      throw new RangeError('The paraxial ray trace produced a non-finite value.');
    }

    return {
      finalY: y,
      finalAngle: u,
      rayHistory: history,
      validationLevel: 'experimental',
      assumptions: [
        'First-order paraxial refraction is applied at each caller-supplied surface.',
        'Each surface refractiveIndex describes the medium after that surface.',
        'Independent optical validation is unavailable.'
      ]
    };
  }

  /**
   * Calculate screening metrics from the caller's explicitly supplied ray
   * sampling geometry. Terminal ray spread is not a focal-plane spot size.
   */
  evaluateSystemMetrics(system) {
    validateSystem(system, true);
    const sampling = system.metricSampling;
    const marginal = this.traceMeridionalRay(system, sampling.entrancePupilRadiusMm, 0);
    const paraxial = this.traceMeridionalRay(system, sampling.paraxialRayHeightMm, 0);
    const zonal = this.traceMeridionalRay(system, sampling.entrancePupilRadiusMm * sampling.zonalRayFraction, 0);
    const chief = this.traceMeridionalRay(system, 0, sampling.chiefRayAngleRad);
    const outputIndex = system.surfaces[system.surfaces.length - 1].refractiveIndex;

    if (Math.abs(paraxial.finalAngle) <= Number.EPSILON) {
      throw new RangeError('The supplied paraxial ray does not define a finite focal-length estimate.');
    }

    const paraxialFocalLengthMm =
      -(system.initialRefractiveIndex * sampling.paraxialRayHeightMm) / (outputIndex * paraxial.finalAngle);
    const terminalRaySpreadMm = Math.sqrt((marginal.finalY ** 2 + zonal.finalY ** 2) / 2);
    const metrics = {
      paraxialFocalLengthMm,
      terminalRaySpreadMm,
      marginalRayHeightMm: marginal.finalY,
      chiefRayHeightMm: chief.finalY
    };

    if (!Object.values(metrics).every(Number.isFinite)) {
      throw new RangeError('The optical screening metrics contain a non-finite value.');
    }

    return metrics;
  }

  evaluateMeritFunction(system, operands) {
    validateOperands(operands);
    const metrics = this.evaluateSystemMetrics(system);
    const metricByType = {
      PARAXIAL_FOCAL_LENGTH: metrics.paraxialFocalLengthMm,
      TERMINAL_RAY_SPREAD: metrics.terminalRaySpreadMm,
      MARGINAL_RAY_HEIGHT: metrics.marginalRayHeightMm,
      CHIEF_RAY_HEIGHT: metrics.chiefRayHeightMm
    };
    let sumSquaredResiduals = 0;
    const operandResiduals = [];

    for (const operand of operands) {
      const residual = operand.weight * (metricByType[operand.type] - operand.targetMm);
      if (!Number.isFinite(residual)) {
        throw new RangeError(`Merit operand '${operand.type}' produced a non-finite residual.`);
      }
      operandResiduals.push(residual);
      sumSquaredResiduals += residual * residual;
    }

    const merit = Math.sqrt(sumSquaredResiduals);
    if (!Number.isFinite(merit)) {
      throw new RangeError('The optical merit value is non-finite.');
    }
    return { merit, operandResiduals, metrics };
  }

  _validateVariables(system, variables) {
    if (!Array.isArray(variables) || variables.length === 0) {
      throw new TypeError('Provide at least one bounded optimization variable.');
    }
    const seen = new Set();
    for (const [index, variable] of variables.entries()) {
      if (!variable || typeof variable !== 'object' || !Number.isInteger(variable.surfaceIndex)) {
        throw new TypeError(`Optimization variable ${index} requires an integer surfaceIndex.`);
      }
      if (variable.surfaceIndex < 0 || variable.surfaceIndex >= system.surfaces.length) {
        throw new RangeError(`Optimization variable ${index} references a surface outside the system.`);
      }
      if (!['radius', 'curvature', 'thickness', 'refractiveIndex'].includes(variable.param)) {
        throw new TypeError(`Optimization variable ${index} has an unsupported parameter.`);
      }
      if (!Number.isFinite(variable.min) || !Number.isFinite(variable.max) || variable.min >= variable.max) {
        throw new TypeError(`Optimization variable ${index} requires explicit finite min and max bounds.`);
      }
      const surface = system.surfaces[variable.surfaceIndex];
      if (variable.param === 'radius' && Object.hasOwn(surface, 'curvature')) {
        throw new TypeError(`Optimization variable ${index} cannot vary radius while curvature is supplied.`);
      }
      const value = surface[variable.param];
      if (!Number.isFinite(value) || value < variable.min || value > variable.max) {
        throw new RangeError(`Optimization variable ${index} must start within its explicit bounds.`);
      }
      if (
        variable.param === 'radius' &&
        (variable.min === 0 || variable.max === 0 || variable.min * variable.max < 0)
      ) {
        throw new RangeError(`Optimization variable ${index} radius bounds cannot include or cross zero.`);
      }
      if (variable.param === 'thickness' && variable.min < 0) {
        throw new RangeError(`Optimization variable ${index} thickness bounds must be nonnegative.`);
      }
      if (variable.param === 'refractiveIndex' && variable.min <= 0) {
        throw new RangeError(`Optimization variable ${index} refractive-index bounds must be positive.`);
      }
      const key = `${variable.surfaceIndex}:${variable.param}`;
      if (seen.has(key)) throw new TypeError(`Optimization variable '${key}' is listed more than once.`);
      seen.add(key);
    }
  }

  /**
   * Execute the experimental Levenberg-Marquardt calculation. Operand weights
   * scale residuals; every target, bound, and solver control is caller supplied.
   */
  optimize(system, variables, operands) {
    const options = this._validatedOptions();
    validateSystem(system, true);
    validateOperands(operands);
    this._validateVariables(system, variables);

    const optimizedSystem = JSON.parse(JSON.stringify(system));
    let damping = options.initialDamping;
    let currentEvaluation = this.evaluateMeritFunction(optimizedSystem, operands);
    const initialMerit = currentEvaluation.merit;
    const history = [{ iteration: 0, merit: initialMerit, damping, status: 'INITIAL' }];
    let terminationReason = 'iteration-limit';

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      const operandCount = currentEvaluation.operandResiduals.length;
      const variableCount = variables.length;
      const jacobian = new Float64Array(operandCount * variableCount);

      for (let variableIndex = 0; variableIndex < variableCount; variableIndex += 1) {
        const variable = variables[variableIndex];
        const surface = optimizedSystem.surfaces[variable.surfaceIndex];
        const originalValue = surface[variable.param];
        const delta = options.finiteDiffStep * (variable.max - variable.min);
        const plusValue = Math.min(variable.max, originalValue + delta);
        const minusValue = Math.max(variable.min, originalValue - delta);
        if (plusValue === minusValue) {
          throw new RangeError(`Optimization variable ${variableIndex} has no finite-difference interval.`);
        }

        const plusSystem = JSON.parse(JSON.stringify(optimizedSystem));
        plusSystem.surfaces[variable.surfaceIndex][variable.param] = plusValue;
        const plusEvaluation = this.evaluateMeritFunction(plusSystem, operands);

        const minusSystem = JSON.parse(JSON.stringify(optimizedSystem));
        minusSystem.surfaces[variable.surfaceIndex][variable.param] = minusValue;
        const minusEvaluation = this.evaluateMeritFunction(minusSystem, operands);

        const interval = plusValue - minusValue;
        for (let operandIndex = 0; operandIndex < operandCount; operandIndex += 1) {
          jacobian[operandIndex * variableCount + variableIndex] =
            (plusEvaluation.operandResiduals[operandIndex] - minusEvaluation.operandResiduals[operandIndex]) / interval;
        }
      }

      const normalMatrix = new Float64Array(variableCount * variableCount);
      const gradient = new Float64Array(variableCount);
      for (let row = 0; row < variableCount; row += 1) {
        for (let operandIndex = 0; operandIndex < operandCount; operandIndex += 1) {
          gradient[row] +=
            jacobian[operandIndex * variableCount + row] * currentEvaluation.operandResiduals[operandIndex];
        }
        for (let column = 0; column < variableCount; column += 1) {
          let sum = 0;
          for (let operandIndex = 0; operandIndex < operandCount; operandIndex += 1) {
            sum += jacobian[operandIndex * variableCount + row] * jacobian[operandIndex * variableCount + column];
          }
          normalMatrix[row * variableCount + column] = sum;
        }
        normalMatrix[row * variableCount + row] += damping * (Math.abs(normalMatrix[row * variableCount + row]) + 1);
      }

      const rhs = Float64Array.from(gradient, (value) => -value);
      const deltaX = this._solveSmallSystem(normalMatrix, rhs, variableCount);
      const trialSystem = JSON.parse(JSON.stringify(optimizedSystem));
      for (let variableIndex = 0; variableIndex < variableCount; variableIndex += 1) {
        const variable = variables[variableIndex];
        const surface = trialSystem.surfaces[variable.surfaceIndex];
        const candidate = surface[variable.param] + deltaX[variableIndex];
        surface[variable.param] = Math.max(variable.min, Math.min(variable.max, candidate));
      }

      const trialEvaluation = this.evaluateMeritFunction(trialSystem, operands);
      if (trialEvaluation.merit < currentEvaluation.merit) {
        const deltaMerit = currentEvaluation.merit - trialEvaluation.merit;
        for (const variable of variables) {
          optimizedSystem.surfaces[variable.surfaceIndex][variable.param] =
            trialSystem.surfaces[variable.surfaceIndex][variable.param];
        }
        currentEvaluation = trialEvaluation;
        damping = Math.max(options.minimumDamping, damping / options.dampingReductionFactor);
        history.push({ iteration, merit: currentEvaluation.merit, damping, status: 'ACCEPTED' });
        if (deltaMerit <= options.tolerance) {
          terminationReason = 'objective-tolerance';
          break;
        }
      } else {
        history.push({ iteration, merit: currentEvaluation.merit, damping, status: 'REJECTED' });
        if (damping >= options.maximumDamping / options.dampingIncreaseFactor) {
          damping = options.maximumDamping;
          terminationReason = 'maximum-damping';
          break;
        }
        damping = Math.min(options.maximumDamping, damping * options.dampingIncreaseFactor);
      }
    }

    const finalEvaluation = this.evaluateMeritFunction(optimizedSystem, operands);
    return {
      validationLevel: 'experimental',
      terminationReason,
      optimizedSystem,
      initialMerit,
      finalMerit: finalEvaluation.merit,
      improvementPercent: initialMerit > 0 ? ((initialMerit - finalEvaluation.merit) / initialMerit) * 100 : null,
      finalMetrics: finalEvaluation.metrics,
      iterations: history.length - 1,
      history,
      inputs: { system, variables, operands, options },
      assumptions: [
        'The optimizer minimizes caller-defined scaled residuals using first-order paraxial ray calculations.',
        'Terminal ray spread is a screening proxy and is not a focal-plane RMS spot size.',
        'No independent optical accuracy or design validation is available.'
      ]
    };
  }

  _solveSmallSystem(matrix, rhs, size) {
    const augmented = new Float64Array(size * (size + 1));
    let matrixScale = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const value = matrix[row * size + column];
        if (!Number.isFinite(value)) throw new RangeError('DLS normal matrix contains a non-finite value.');
        augmented[row * (size + 1) + column] = value;
        matrixScale = Math.max(matrixScale, Math.abs(value));
      }
      if (!Number.isFinite(rhs[row])) throw new RangeError('DLS right-hand side contains a non-finite value.');
      augmented[row * (size + 1) + size] = rhs[row];
    }
    if (matrixScale === 0) throw new RangeError('DLS normal matrix is singular.');

    for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
      let pivotRow = pivotIndex;
      let pivotMagnitude = Math.abs(augmented[pivotIndex * (size + 1) + pivotIndex]);
      for (let row = pivotIndex + 1; row < size; row += 1) {
        const magnitude = Math.abs(augmented[row * (size + 1) + pivotIndex]);
        if (magnitude > pivotMagnitude) {
          pivotMagnitude = magnitude;
          pivotRow = row;
        }
      }

      if (pivotMagnitude <= Number.EPSILON * matrixScale * size) {
        throw new RangeError('DLS normal matrix is singular at the configured numerical precision.');
      }
      if (pivotRow !== pivotIndex) {
        for (let column = 0; column <= size; column += 1) {
          const a = pivotIndex * (size + 1) + column;
          const b = pivotRow * (size + 1) + column;
          [augmented[a], augmented[b]] = [augmented[b], augmented[a]];
        }
      }

      const pivot = augmented[pivotIndex * (size + 1) + pivotIndex];
      for (let column = pivotIndex; column <= size; column += 1) {
        augmented[pivotIndex * (size + 1) + column] /= pivot;
      }
      for (let row = 0; row < size; row += 1) {
        if (row === pivotIndex) continue;
        const factor = augmented[row * (size + 1) + pivotIndex];
        for (let column = pivotIndex; column <= size; column += 1) {
          augmented[row * (size + 1) + column] -= factor * augmented[pivotIndex * (size + 1) + column];
        }
      }
    }

    const solution = new Float64Array(size);
    for (let row = 0; row < size; row += 1) {
      solution[row] = augmented[row * (size + 1) + size];
      if (!Number.isFinite(solution[row])) throw new RangeError('DLS linear solve produced a non-finite step.');
    }
    return solution;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DampedLeastSquaresOptimizer };
}
if (typeof window !== 'undefined') {
  window.DampedLeastSquaresOptimizer = DampedLeastSquaresOptimizer;
}
