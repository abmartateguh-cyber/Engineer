/**
 * OmniEng Hierarchical Engineering Bill of Materials (eBOM) Manager
 *
 * Provides automated multi-level indented BOM generation, material mass roll-up,
 * manufacturing and vendor procurement cost estimation, and flattened part consolidation.
 *
 * Unverified comparison target: Siemens Teamcenter eBOM / PTC Windchill / Dassault ENOVIA BOM.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

class EngineeringBOMManager {
  constructor() {
    this.rootAssembly = null;
  }

  /**
   * Sets or creates the root assembly of the engineering hierarchy.
   *
   * @param {Object} rootItem - Top level assembly item
   */
  setRootAssembly(rootItem) {
    this.rootAssembly = this._normalizeItem(rootItem, 0, new Set(), { count: 0 });
    return this;
  }

  _normalizeItem(item, level, activeItems, nodeCount) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Every eBOM node must be an object.');
    }
    if (activeItems.has(item)) throw new TypeError('Cyclic eBOM hierarchies are not supported.');
    if (level > 64) throw new RangeError('eBOM hierarchy depth cannot exceed 64 levels.');
    nodeCount.count++;
    if (nodeCount.count > 10000) throw new RangeError('eBOM hierarchies cannot exceed 10,000 nodes.');

    const allowedKeys = new Set([
      'partNumber',
      'name',
      'revision',
      'quantity',
      'unitMassKg',
      'unitCostUsd',
      'material',
      'supplier',
      'children'
    ]);
    const unexpectedKeys = Object.keys(item).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      throw new TypeError(`Unexpected eBOM node properties: ${unexpectedKeys.join(', ')}.`);
    }

    if (typeof item.partNumber !== 'string' || !item.partNumber.trim() || item.partNumber.length > 200) {
      throw new TypeError('Every eBOM node requires an explicit partNumber.');
    }
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 500) {
      throw new TypeError('Every eBOM node requires an explicit name.');
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new TypeError('Every eBOM node requires a finite positive quantity.');
    }
    if (!Number.isFinite(item.unitMassKg) || item.unitMassKg < 0) {
      throw new TypeError('Every eBOM node requires an explicit finite nonnegative unitMassKg.');
    }
    if (!Number.isFinite(item.unitCostUsd) || item.unitCostUsd < 0) {
      throw new TypeError('Every eBOM node requires an explicit finite nonnegative unitCostUsd.');
    }
    for (const field of ['revision', 'material', 'supplier']) {
      const maxLength = field === 'revision' ? 100 : 200;
      if (
        item[field] !== undefined &&
        item[field] !== null &&
        (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > maxLength)
      ) {
        throw new TypeError(`Optional eBOM ${field} must be a nonempty string when supplied.`);
      }
    }
    if (item.children !== undefined && !Array.isArray(item.children)) {
      throw new TypeError('eBOM children must be an array when supplied.');
    }

    activeItems.add(item);
    const norm = {
      partNumber: item.partNumber,
      name: item.name,
      revision: item.revision ?? null,
      level,
      quantity: item.quantity,
      unitMassKg: item.unitMassKg,
      unitCostUsd: item.unitCostUsd,
      material: item.material ?? null,
      supplier: item.supplier ?? null,
      children: []
    };

    norm.children = (item.children || []).map((child) => this._normalizeItem(child, level + 1, activeItems, nodeCount));
    activeItems.delete(item);

    return norm;
  }

  /**
   * Recursively computes mass and cost roll-ups for one instance of a node.
   * A parent's quantity multiplies its child; the route applies the root
   * quantity to its requested-order summary.
   *
   * @param {Object} [node=this.rootAssembly]
   * @returns {Object} Rolled up item with totalMassKg and totalCostUsd
   */
  computeRollUp(node = this.rootAssembly) {
    if (!node) return null;

    let subMass = 0.0;
    let subCost = 0.0;
    let totalPartCount = 0;

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childRoll = this.computeRollUp(child);
        subMass += childRoll.rolledUpMassKg * child.quantity;
        subCost += childRoll.rolledUpCostUsd * child.quantity;
        totalPartCount += childRoll.totalPartCount * child.quantity;
      }
    } else {
      // Leaf part
      totalPartCount = 1;
    }

    const rolledUpMassKg = node.unitMassKg + subMass;
    const rolledUpCostUsd = node.unitCostUsd + subCost;
    if (![rolledUpMassKg, rolledUpCostUsd, totalPartCount].every(Number.isFinite)) {
      throw new RangeError('eBOM roll-up exceeded the finite numeric range for supplied quantities, masses, or costs.');
    }

    node.rolledUpMassKg = rolledUpMassKg;
    node.rolledUpCostUsd = rolledUpCostUsd;
    node.totalPartCount = totalPartCount;

    return {
      partNumber: node.partNumber,
      name: node.name,
      level: node.level,
      quantity: node.quantity,
      rolledUpMassKg,
      rolledUpCostUsd,
      totalPartCount
    };
  }

  /**
   * Generates a multi-level indented eBOM table.
   *
   * @returns {Array<Object>} Linearized array of indented BOM rows
   */
  generateIndentedBOM() {
    this.computeRollUp(this.rootAssembly);
    const rows = [];

    const traverse = (item, prefix = '') => {
      const indentStr = '. '.repeat(item.level);
      rows.push({
        level: item.level,
        indentDisplay: `${indentStr}${item.name}`,
        partNumber: item.partNumber,
        name: item.name,
        revision: item.revision,
        quantity: item.quantity,
        material: item.material,
        supplier: item.supplier,
        unitMassKg: item.unitMassKg,
        totalMassKg: item.rolledUpMassKg,
        unitCostUsd: item.unitCostUsd,
        totalCostUsd: item.rolledUpCostUsd
      });

      if (item.children) {
        for (const child of item.children) {
          traverse(child);
        }
      }
    };

    if (this.rootAssembly) {
      traverse(this.rootAssembly);
    }

    return rows;
  }

  /**
   * Generates a consolidated flattened leaf-part BOM.
   * Lines combine only when all caller-supplied identity and property fields match.
   *
   * @returns {Array<Object>} Sorted list of unique parts with aggregated quantities
   */
  generateFlattenedBOM() {
    const partMap = new Map();

    const traverse = (item, parentMultiplier = 1) => {
      const currentMultiplier = parentMultiplier * item.quantity;

      if (!item.children || item.children.length === 0) {
        // Leaf part
        const key = JSON.stringify([
          item.partNumber,
          item.revision,
          item.name,
          item.material,
          item.supplier,
          item.unitMassKg,
          item.unitCostUsd
        ]);
        if (partMap.has(key)) {
          const entry = partMap.get(key);
          entry.totalQuantity += currentMultiplier;
          entry.extendedCostUsd += item.unitCostUsd * currentMultiplier;
          entry.extendedMassKg += item.unitMassKg * currentMultiplier;
        } else {
          partMap.set(key, {
            partNumber: item.partNumber,
            revision: item.revision,
            name: item.name,
            material: item.material,
            supplier: item.supplier,
            totalQuantity: currentMultiplier,
            unitCostUsd: item.unitCostUsd,
            extendedCostUsd: item.unitCostUsd * currentMultiplier,
            unitMassKg: item.unitMassKg,
            extendedMassKg: item.unitMassKg * currentMultiplier
          });
        }
      } else {
        for (const child of item.children) {
          traverse(child, currentMultiplier);
        }
      }
    };

    if (this.rootAssembly) {
      traverse(this.rootAssembly, 1);
    }

    const flatList = Array.from(partMap.values());
    flatList.sort((a, b) => b.extendedCostUsd - a.extendedCostUsd); // Most expensive parts first
    return flatList;
  }

  /**
   * Exports BOM to CSV string format.
   */
  exportToCSV() {
    const flat = this.generateFlattenedBOM();
    const headers = [
      'Part Number',
      'Description',
      'Material',
      'Supplier',
      'Qty',
      'Unit Cost ($)',
      'Ext Cost ($)',
      'Unit Mass (kg)',
      'Ext Mass (kg)',
      'Revision'
    ];
    const lines = [headers.join(',')];
    const escapeText = (value) => {
      let text = String(value ?? '');
      if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };

    for (const r of flat) {
      lines.push(
        [
          escapeText(r.partNumber),
          escapeText(r.name),
          escapeText(r.material),
          escapeText(r.supplier),
          r.totalQuantity,
          r.unitCostUsd.toFixed(2),
          r.extendedCostUsd.toFixed(2),
          r.unitMassKg.toFixed(4),
          r.extendedMassKg.toFixed(4),
          escapeText(r.revision)
        ].join(',')
      );
    }

    return lines.join('\n');
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EngineeringBOMManager };
}
if (typeof window !== 'undefined') {
  window.EngineeringBOMManager = EngineeringBOMManager;
}
