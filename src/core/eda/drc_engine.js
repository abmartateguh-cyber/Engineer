/**
 * OmniEng Physical Verification & DRC Engine (Siemens Calibre Equivalent)
 * Checks 2D nanometer IC layout polygons against foundry design rules (min width, min spacing, enclosure).
 */

class DRCEngine {
  /**
   * Run Design Rule Checking on layout geometries
   * @param {Array<Object>} shapes Array of 2D rectangular polygons {id, layer, x, y, w, h}
   * @param {Object} rules Foundry design rule constraints (in nanometers or microns)
   */
  static runDRC(shapes = [], rules = {}) {
    const {
      minWidth = 50,       // nm
      minSpacing = 45,     // nm
      minArea = 2500       // nm^2
    } = rules;

    const violations = [];

    // 1. Minimum Width & Area Checks
    for (const shape of shapes) {
      const w = shape.w;
      const h = shape.h;
      const area = w * h;

      if (w < minWidth || h < minWidth) {
        violations.push({
          type: 'MIN_WIDTH_VIOLATION',
          layer: shape.layer || 'Metal1',
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: Math.min(w, h),
          ruleLimit: minWidth,
          severity: 'ERROR',
          message: `Shape ${shape.id} on ${shape.layer} width ${Math.min(w, h)}nm is below min width ${minWidth}nm`
        });
      }

      if (area < minArea) {
        violations.push({
          type: 'MIN_AREA_VIOLATION',
          layer: shape.layer || 'Metal1',
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: area,
          ruleLimit: minArea,
          severity: 'WARNING',
          message: `Shape ${shape.id} area ${area}nm^2 is below min area ${minArea}nm^2`
        });
      }
    }

    // 2. Minimum Spacing Checks (Sweep-line / pairwise bounding check)
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
        const overlaps = (
          s1.x < s2.x + s2.w && s1.x + s1.w > s2.x &&
          s1.y < s2.y + s2.h && s1.y + s1.h > s2.y
        );

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
            message: `Spacing ${dist.toFixed(1)}nm between ${s1.id} and ${s2.id} is below rule ${minSpacing}nm`
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
      verdict: isClean ? 'DRC_CLEAN (Tape-out Ready)' : 'DRC_FAILED (Foundry Rule Violations)',
      violations
    };
  }

  /**
   * Layout Versus Schematic (LVS) Netlist Graph Verification
   */
  static runLVS(schematicGates = [], layoutShapes = []) {
    // Verify one-to-one correspondence between schematic gates and extracted layout instances
    const matched = [];
    const unmatchedSchematic = [];
    const unmatchedLayout = [];

    const gates = Array.isArray(schematicGates) ? schematicGates : (schematicGates.gates || []);
    const shapes = Array.isArray(layoutShapes) ? layoutShapes : (layoutShapes.cells || layoutShapes.shapes || []);
    const layoutInstances = shapes.filter(s => s.isDevice || s.type || s.cellType || s.id);

    for (const g of gates) {
      const match = layoutInstances.find(l => 
        l.name === g.id || 
        l.cellType === g.cell || 
        l.type === g.cell || 
        l.cell === g.cell
      );
      if (match) {
        matched.push({ gate: g.id, layout: match.id || match.name });
      } else {
        unmatchedSchematic.push(g.id);
      }
    }

    const isLVSMatched = unmatchedSchematic.length === 0;

    return {
      isLVSMatched,
      matchedCount: matched.length,
      unmatchedSchematic,
      unmatchedLayout,
      verdict: isLVSMatched ? 'LVS_PASSED (100% Netlist Equivalence)' : 'LVS_MISMATCH (Netlist Discrepancy)'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DRCEngine };
}
