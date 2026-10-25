'use strict';

const MAX_GRID_CELLS = 100000;
const MAX_TIME_STEPS = 200000;
const MAX_CELL_STEP_WORK = 10000000;

class ThermalEngine {
  /**
   * Handset-specific analysis stays unavailable until its model and material
   * data have been independently reviewed.
   */
  static simulateSmartphoneThermal() {
    return {
      success: false,
      available: false,
      status: 'UNAVAILABLE',
      validationLevel: 'experimental',
      reason: 'No independently reviewed handset thermal model or material-property set is configured.'
    };
  }

  /**
   * Solve an explicitly supplied 2D transient heat-conduction problem with
   * perimeter convection. This numerical adapter does not identify a device,
   * material, or validated CHT model.
   */
  static solveTransientConduction2D(config) {
    const invalid = (message) => ({
      success: false,
      status: 'INVALID_INPUT',
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });
    const required = [
      'widthM',
      'heightM',
      'ambientTemperatureC',
      'convectionCoefficientWPerM2K',
      'timeStepSec',
      'totalTimeSec',
      'initialTemperatureC',
      'conductivityWPerMK',
      'volumetricHeatCapacityJPerM3K',
      'heatGenerationWPerM3'
    ];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return invalid(`A configuration object is required. Missing: ${required.join(', ')}.`);
    }

    const missing = required.filter(
      (key) => !Object.hasOwn(config, key) || config[key] === null || config[key] === undefined
    );
    if (missing.length > 0) return invalid(`Required inputs missing: ${missing.join(', ')}.`);

    const { widthM, heightM, ambientTemperatureC, convectionCoefficientWPerM2K, timeStepSec, totalTimeSec } = config;
    const positiveScalars = { widthM, heightM, timeStepSec, totalTimeSec };
    const invalidScalars = Object.entries(positiveScalars)
      .filter(([, value]) => !Number.isFinite(value) || value <= 0)
      .map(([key]) => key);
    if (invalidScalars.length > 0)
      return invalid(`Inputs must be finite positive numbers: ${invalidScalars.join(', ')}.`);
    if (!Number.isFinite(ambientTemperatureC) || ambientTemperatureC <= -273.15) {
      return invalid('ambientTemperatureC must be finite and above absolute zero.');
    }
    if (!Number.isFinite(convectionCoefficientWPerM2K) || convectionCoefficientWPerM2K < 0) {
      return invalid('convectionCoefficientWPerM2K must be finite and nonnegative.');
    }

    const gridFields = [
      'initialTemperatureC',
      'conductivityWPerMK',
      'volumetricHeatCapacityJPerM3K',
      'heatGenerationWPerM3'
    ];
    for (const field of gridFields) {
      if (!Array.isArray(config[field])) return invalid(`${field} must be a numeric grid.`);
    }
    const gridHeight = config.initialTemperatureC.length;
    const gridWidth = Array.isArray(config.initialTemperatureC[0]) ? config.initialTemperatureC[0].length : 0;
    if (!Number.isInteger(gridHeight) || gridHeight < 3 || !Number.isInteger(gridWidth) || gridWidth < 3) {
      return invalid('The supplied grids must contain at least 3 rows and 3 columns.');
    }
    if (gridHeight * gridWidth > MAX_GRID_CELLS) {
      return invalid(`Grid cell count exceeds the ${MAX_GRID_CELLS} cell resource limit.`);
    }

    for (const field of gridFields) {
      const grid = config[field];
      if (
        !Array.isArray(grid) ||
        grid.length !== gridHeight ||
        grid.some((row) => !Array.isArray(row) || row.length !== gridWidth)
      ) {
        return invalid(`${field} must be a ${gridHeight} by ${gridWidth} numeric grid.`);
      }
      const values = grid.flat();
      if (values.length !== gridHeight * gridWidth || values.some((value) => !Number.isFinite(value))) {
        return invalid(`${field} must contain only finite numbers.`);
      }
    }
    if (config.initialTemperatureC.flat().some((temperature) => temperature <= -273.15)) {
      return invalid('Initial temperatures must be above absolute zero.');
    }
    if (config.conductivityWPerMK.flat().some((value) => value <= 0)) {
      return invalid('conductivityWPerMK values must be positive.');
    }
    if (config.volumetricHeatCapacityJPerM3K.flat().some((value) => value <= 0)) {
      return invalid('volumetricHeatCapacityJPerM3K values must be positive.');
    }

    const steps = Math.ceil(totalTimeSec / timeStepSec);
    if (!Number.isSafeInteger(steps) || steps > MAX_TIME_STEPS) {
      return invalid(`Requested step count exceeds the ${MAX_TIME_STEPS} step resource limit.`);
    }
    if (steps * gridHeight * gridWidth > MAX_CELL_STEP_WORK) {
      return invalid(`Requested cell-step work exceeds the ${MAX_CELL_STEP_WORK} operation resource limit.`);
    }

    const dx = widthM / (gridWidth - 1);
    const dy = heightM / (gridHeight - 1);
    const maxRate = this._maximumExplicitRate(config, dx, dy, gridWidth, gridHeight);
    const stableTimeStepSec = maxRate > 0 ? 1 / maxRate : Infinity;
    if (timeStepSec > stableTimeStepSec) {
      return invalid(
        `timeStepSec exceeds the explicit stability limit (${stableTimeStepSec.toExponential(6)} s); supply a smaller time step.`
      );
    }

    const inputSnapshot = {
      widthM,
      heightM,
      ambientTemperatureC,
      convectionCoefficientWPerM2K,
      timeStepSec,
      totalTimeSec,
      initialTemperatureC: config.initialTemperatureC.map((row) => Array.from(row)),
      conductivityWPerMK: config.conductivityWPerMK.map((row) => Array.from(row)),
      volumetricHeatCapacityJPerM3K: config.volumetricHeatCapacityJPerM3K.map((row) => Array.from(row)),
      heatGenerationWPerM3: config.heatGenerationWPerM3.map((row) => Array.from(row))
    };

    let temperature = config.initialTemperatureC.map((row) => Float64Array.from(row));
    let elapsedSec = 0;
    for (let step = 0; step < steps; step += 1) {
      const dt = Math.min(timeStepSec, totalTimeSec - elapsedSec);
      if (dt <= 0) break;
      const next = temperature.map((row) => new Float64Array(row.length));
      for (let row = 0; row < gridHeight; row += 1) {
        for (let col = 0; col < gridWidth; col += 1) {
          const conductivity = config.conductivityWPerMK[row][col];
          const capacity = config.volumetricHeatCapacityJPerM3K[row][col];
          const current = temperature[row][col];
          let rate = config.heatGenerationWPerM3[row][col] / capacity;
          if (col > 0) {
            rate +=
              (this._harmonicMean(conductivity, config.conductivityWPerMK[row][col - 1]) *
                (temperature[row][col - 1] - current)) /
              (capacity * dx * dx);
          }
          if (col + 1 < gridWidth) {
            rate +=
              (this._harmonicMean(conductivity, config.conductivityWPerMK[row][col + 1]) *
                (temperature[row][col + 1] - current)) /
              (capacity * dx * dx);
          }
          if (row > 0) {
            rate +=
              (this._harmonicMean(conductivity, config.conductivityWPerMK[row - 1][col]) *
                (temperature[row - 1][col] - current)) /
              (capacity * dy * dy);
          }
          if (row + 1 < gridHeight) {
            rate +=
              (this._harmonicMean(conductivity, config.conductivityWPerMK[row + 1][col]) *
                (temperature[row + 1][col] - current)) /
              (capacity * dy * dy);
          }

          const exposedWidth =
            (col === 0 || col === gridWidth - 1 ? 1 / dx : 0) + (row === 0 || row === gridHeight - 1 ? 1 / dy : 0);
          rate += (convectionCoefficientWPerM2K * exposedWidth * (ambientTemperatureC - current)) / capacity;
          next[row][col] = current + dt * rate;
        }
      }
      if (next.some((row) => Array.from(row).some((value) => !Number.isFinite(value) || value <= -273.15))) {
        return {
          success: false,
          status: 'NUMERICAL_FAILURE',
          validationLevel: 'experimental',
          error: { code: 'NUMERICAL_FAILURE', message: `Invalid temperature state after step ${step + 1}.` }
        };
      }
      temperature = next;
      elapsedSec += dt;
    }

    const temperatureC = temperature.map((row) => Array.from(row));
    const values = temperature.flatMap((row) => Array.from(row));
    return {
      success: true,
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      validationLevel: 'experimental',
      model: '2D explicit finite-difference transient heat conduction with perimeter convection',
      inputs: { ...inputSnapshot, steps, maximumTimeStepSec: timeStepSec, stableTimeStepSec },
      results: {
        finalTimeSec: elapsedSec,
        minimumTemperatureC: values.reduce((minimum, value) => Math.min(minimum, value), Infinity),
        maximumTemperatureC: values.reduce((maximum, value) => Math.max(maximum, value), -Infinity),
        temperatureC,
        temperatureMap: this.exportSampledHeatmap(temperatureC, gridWidth, gridHeight)
      },
      assumptions: [
        'Cell properties are uniform within each supplied grid cell.',
        'Perimeter cells lose heat by the supplied convection coefficient to a uniform ambient temperature.',
        'No radiation, fluid flow, phase change, contact resistance, or 3D heat transfer is modeled.',
        'The result is an experimental numerical estimate and has no independent validation.'
      ]
    };
  }

  /**
   * Downsample a caller-provided finite temperature grid for visualization.
   * This compatibility utility performs no thermal calculation or validation.
   */
  static exportSampledHeatmap(temperatureGrid, gridWidth, gridHeight, stepX = 2, stepY = 3) {
    if (
      !Array.isArray(temperatureGrid) ||
      !Number.isSafeInteger(gridWidth) ||
      !Number.isSafeInteger(gridHeight) ||
      gridWidth < 1 ||
      gridHeight < 1 ||
      gridWidth * gridHeight > MAX_GRID_CELLS
    ) {
      throw new TypeError('A bounded temperature grid and explicit positive width and height are required.');
    }
    if (!Number.isSafeInteger(stepX) || stepX < 1 || !Number.isSafeInteger(stepY) || stepY < 1) {
      throw new TypeError('Heatmap sampling steps must be positive integers.');
    }
    if (
      temperatureGrid.length !== gridHeight ||
      temperatureGrid.some(
        (row) =>
          (!Array.isArray(row) && !ArrayBuffer.isView(row)) ||
          row.length !== gridWidth ||
          Array.from(row).some((temperature) => !Number.isFinite(temperature))
      )
    ) {
      throw new TypeError('The supplied temperature grid must be rectangular and contain only finite values.');
    }

    const map = [];
    for (let row = 0; row < gridHeight; row += stepY) {
      const sampledRow = [];
      for (let column = 0; column < gridWidth; column += stepX) {
        sampledRow.push(Number(temperatureGrid[row][column].toFixed(1)));
      }
      map.push(sampledRow);
    }
    return map;
  }

  static _maximumExplicitRate(config, dx, dy, gridWidth, gridHeight) {
    let maximumRate = 0;
    for (let row = 0; row < gridHeight; row += 1) {
      for (let col = 0; col < gridWidth; col += 1) {
        const conductivity = config.conductivityWPerMK[row][col];
        const capacity = config.volumetricHeatCapacityJPerM3K[row][col];
        let rate = 0;
        if (col > 0)
          rate += this._harmonicMean(conductivity, config.conductivityWPerMK[row][col - 1]) / (capacity * dx * dx);
        if (col + 1 < gridWidth)
          rate += this._harmonicMean(conductivity, config.conductivityWPerMK[row][col + 1]) / (capacity * dx * dx);
        if (row > 0)
          rate += this._harmonicMean(conductivity, config.conductivityWPerMK[row - 1][col]) / (capacity * dy * dy);
        if (row + 1 < gridHeight)
          rate += this._harmonicMean(conductivity, config.conductivityWPerMK[row + 1][col]) / (capacity * dy * dy);
        const exposedWidth =
          (col === 0 || col === gridWidth - 1 ? 1 / dx : 0) + (row === 0 || row === gridHeight - 1 ? 1 / dy : 0);
        rate += (config.convectionCoefficientWPerM2K * exposedWidth) / capacity;
        maximumRate = Math.max(maximumRate, rate);
      }
    }
    return maximumRate;
  }

  static _harmonicMean(first, second) {
    return (2 * first * second) / (first + second);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ThermalEngine };
