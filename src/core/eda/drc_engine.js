/**
 * Experimental 2D rectangle-rule screening helper.
 * This does not implement foundry DRC or establish tape-out readiness.
 */

class DRCEngine {
  /**
   * Run Design Rule Checking on layout geometries
   * @param {Array<Object>} shapes Array of 2D axis-aligned rectangles {id, layer, x, y, w, h}
   * @param {Object} rules Explicit rectangular screening limits; geometry and rule units must match
   */
  static runDRC(shapes, rules) {
    const invalidInput = (message) => ({
      success: false,
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });
    if (!Array.isArray(shapes) || shapes.length === 0) {
      return invalidInput('A non-empty array of rectangle shapes is required.');
    }
    if (shapes.length > 2000) {
      return invalidInput('At most 2,000 rectangle shapes can be checked by this pairwise screen.');
    }
    if (
      !rules ||
      typeof rules !== 'object' ||
      Array.isArray(rules) ||
      !['minWidth', 'minSpacing', 'minArea'].every((key) => Number.isFinite(rules[key]) && rules[key] > 0)
    ) {
      return invalidInput('Explicit positive minWidth, minSpacing, and minArea screening limits are required.');
    }

    const seenShapeIds = new Set();
    for (const shape of shapes) {
      if (
        !shape ||
        typeof shape !== 'object' ||
        Array.isArray(shape) ||
        typeof shape.id !== 'string' ||
        shape.id.trim() === '' ||
        seenShapeIds.has(shape.id) ||
        typeof shape.layer !== 'string' ||
        shape.layer.trim() === '' ||
        !Number.isFinite(shape.x) ||
        !Number.isFinite(shape.y) ||
        !Number.isFinite(shape.w) ||
        shape.w <= 0 ||
        !Number.isFinite(shape.h) ||
        shape.h <= 0 ||
        !Number.isFinite(shape.x + shape.w) ||
        !Number.isFinite(shape.y + shape.h) ||
        !Number.isFinite(shape.w * shape.h)
      ) {
        return invalidInput(
          'Each rectangle requires a unique id, layer, finite origin, and positive finite width and height.'
        );
      }
      seenShapeIds.add(shape.id);
    }
    const { minWidth, minSpacing, minArea } = rules;

    const violations = [];

    // 1. Minimum Width & Area Checks
    for (const shape of shapes) {
      const w = shape.w;
      const h = shape.h;
      const area = w * h;

      if (w < minWidth || h < minWidth) {
        violations.push({
          type: 'MIN_WIDTH_VIOLATION',
          layer: shape.layer,
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: Math.min(w, h),
          ruleLimit: minWidth,
          severity: 'ERROR',
          message: `Shape ${shape.id} on ${shape.layer} width ${Math.min(w, h)} is below supplied minWidth ${minWidth}`
        });
      }

      if (area < minArea) {
        violations.push({
          type: 'MIN_AREA_VIOLATION',
          layer: shape.layer,
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: area,
          ruleLimit: minArea,
          severity: 'WARNING',
          message: `Shape ${shape.id} area ${area} is below supplied minArea ${minArea}`
        });
      }
    }

    // 2. Minimum spacing checks by pairwise rectangle bounds.
    const n = shapes.length;
    for (let i = 0; i < n; i++) {
      const s1 = shapes[i];
      for (let j = i + 1; j < n; j++) {
        const s2 = shapes[j];
        if (s1.layer !== s2.layer) continue; // Same-layer spacing only

        // Compute edge-to-edge distance between axis-aligned rectangles
        const dx = Math.max(0, Math.max(s1.x - (s2.x + s2.w), s2.x - (s1.x + s1.w)));
        const dy = Math.max(0, Math.max(s1.y - (s2.y + s2.h), s2.y - (s1.y + s1.h)));
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if shapes overlap or are closer than minSpacing
        const overlaps = s1.x < s2.x + s2.w && s1.x + s1.w > s2.x && s1.y < s2.y + s2.h && s1.y + s1.h > s2.y;

        if (overlaps) {
          violations.push({
            type: 'SHORT_CIRCUIT_OVERLAP',
            layer: s1.layer,
            shapeIds: [s1.id, s2.id],
            location: { x: Math.max(s1.x, s2.x), y: Math.max(s1.y, s2.y) },
            severity: 'CRITICAL',
            message: `Short circuit detected between ${s1.id} and ${s2.id} on layer ${s1.layer}`
          });
        } else if (dist < minSpacing) {
          violations.push({
            type: 'MIN_SPACING_VIOLATION',
            layer: s1.layer,
            shapeIds: [s1.id, s2.id],
            location: { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 },
            foundValue: +dist.toFixed(1),
            ruleLimit: minSpacing,
            severity: 'ERROR',
            message: `Spacing ${dist.toFixed(1)} between ${s1.id} and ${s2.id} is below supplied minSpacing ${minSpacing}`
          });
        }
      }
    }

    const isClean = violations.length === 0;
    return {
      totalShapesChecked: shapes.length,
      violationCount: violations.length,
      clean: isClean,
      isClean,
      success: true,
      validationLevel: 'experimental',
      scope: 'axis-aligned rectangle width-area-spacing screen',
      units: 'caller-defined; shape and rule units must match',
      verdict: isClean ? 'EXPERIMENTAL_RECTANGLE_SCREENING_CLEAR' : 'EXPERIMENTAL_RECTANGLE_SCREENING_FLAGS',
      violations
    };
  }

  /** Experimental one-to-one instance matching; this does not compare pins or nets. */
  static runLVS(schematicGates, layoutShapes) {
    const invalidInput = (message) => ({
      success: false,
      isLVSMatched: false,
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });
    const readList = (value, fields) => {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== 'object') return null;
      for (const field of fields) {
        if (Object.hasOwn(value, field)) return Array.isArray(value[field]) ? value[field] : null;
      }
      return null;
    };

    const gates = readList(schematicGates, ['gates'], 'schematic gates');
    const shapes = readList(layoutShapes, ['cells', 'shapes'], 'layout instances');
    if (!gates || gates.length === 0) {
      return invalidInput('Provide at least one schematic gate with an instance id and cell type.');
    }
    if (!shapes || shapes.length === 0) {
      return invalidInput('Provide at least one extracted layout instance with an instance id and cell type.');
    }

    if (gates.length > 10000) {
      return invalidInput('At most 10,000 schematic gates are supported by this experimental matcher.');
    }
    if (shapes.length > 10000) {
      return invalidInput('At most 10,000 layout instances are supported by this experimental matcher.');
    }

    const seenGateIds = new Set();
    for (const gate of gates) {
      if (
        !gate ||
        typeof gate !== 'object' ||
        typeof gate.id !== 'string' ||
        gate.id.trim() === '' ||
        typeof gate.cell !== 'string' ||
        gate.cell.trim() === '' ||
        seenGateIds.has(gate.id)
      ) {
        return invalidInput('Each schematic gate must have a unique non-empty id and cell type.');
      }
      seenGateIds.add(gate.id);
    }

    const layoutInstances = [];
    const seenLayoutIds = new Set();
    for (const shape of shapes) {
      if (!shape || typeof shape !== 'object') {
        return invalidInput('Each layout instance must be an object with an id and cell type.');
      }
      const id = shape.id ?? shape.name;
      const cell = shape.cellType ?? shape.type ?? shape.cell;
      if (
        typeof id !== 'string' ||
        id.trim() === '' ||
        typeof cell !== 'string' ||
        cell.trim() === '' ||
        seenLayoutIds.has(id)
      ) {
        return invalidInput('Each layout instance must have a unique non-empty id and cell type.');
      }
      seenLayoutIds.add(id);
      layoutInstances.push({ id, cell });
    }

    // This remains a simple name/type heuristic, but each extracted instance can match once only.
    const matched = [];
    const unmatchedSchematic = [];
    const consumedLayout = new Set();
    const layoutByNameAndCell = new Map();
    const layoutIndicesByCell = new Map();
    for (let index = 0; index < layoutInstances.length; index++) {
      const instance = layoutInstances[index];
      layoutByNameAndCell.set(JSON.stringify([instance.id, instance.cell]), index);
      if (!layoutIndicesByCell.has(instance.cell)) layoutIndicesByCell.set(instance.cell, { indices: [], cursor: 0 });
      layoutIndicesByCell.get(instance.cell).indices.push(index);
    }

    for (const gate of gates) {
      const exactIndex = layoutByNameAndCell.get(JSON.stringify([gate.id, gate.cell]));
      let matchIndex = exactIndex !== undefined && !consumedLayout.has(exactIndex) ? exactIndex : -1;
      const compatible = layoutIndicesByCell.get(gate.cell);
      if (matchIndex < 0 && compatible) {
        while (
          compatible.cursor < compatible.indices.length &&
          consumedLayout.has(compatible.indices[compatible.cursor])
        ) {
          compatible.cursor++;
        }
        if (compatible.cursor < compatible.indices.length) matchIndex = compatible.indices[compatible.cursor++];
      }
      if (matchIndex >= 0) {
        const match = layoutInstances[matchIndex];
        consumedLayout.add(matchIndex);
        matched.push({ gate: gate.id, layout: match.id });
      } else {
        unmatchedSchematic.push(gate.id);
      }
    }

    const unmatchedLayout = layoutInstances
      .filter((_, index) => !consumedLayout.has(index))
      .map((instance) => instance.id);
    const isLVSMatched = unmatchedSchematic.length === 0 && unmatchedLayout.length === 0;

    return {
      isLVSMatched,
      success: true,
      validationLevel: 'experimental',
      matchScope: 'simple-name-and-cell-type-heuristic',
      matchedCount: matched.length,
      matched,
      unmatchedSchematic,
      unmatchedLayout,
      verdict: isLVSMatched ? 'EXPERIMENTAL_HEURISTIC_MATCH' : 'EXPERIMENTAL_HEURISTIC_MISMATCH'
    };
  }
}

const { SpiceEngine } = require('./spice_engine');
const { GerberExporter } = require('./gerber_exporter');
const { StaticTimingAnalysis } = require('./static_timing_analysis');

DRCEngine.Spice = SpiceEngine;
DRCEngine.Gerber = GerberExporter;
DRCEngine.STA = StaticTimingAnalysis;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DRCEngine,
    SpiceEngine,
    GerberExporter,
    StaticTimingAnalysis
  };
}
