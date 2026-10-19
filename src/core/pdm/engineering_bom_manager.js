/**
 * OmniEng Hierarchical Engineering Bill of Materials (eBOM) Manager
 * 
 * Provides automated multi-level indented BOM generation, material mass roll-up,
 * manufacturing and vendor procurement cost estimation, and flattened part consolidation.
 * 
 * Parity standard: Siemens Teamcenter eBOM / PTC Windchill / Dassault ENOVIA BOM.
 * 
 * 100% In-House Sovereign Implementation. Zero Cloud Dependencies.
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
    this.rootAssembly = this._normalizeItem(rootItem, 0);
    return this;
  }

  _normalizeItem(item, level = 0) {
    const norm = {
      partNumber: item.partNumber || `PRT-${Math.floor(Math.random() * 10000)}`,
      name: item.name || 'Unnamed Component',
      revision: item.revision || 'A',
      level,
      quantity: item.quantity !== undefined ? item.quantity : 1,
      unitMassKg: item.unitMassKg !== undefined ? item.unitMassKg : 0.0,
      unitCostUsd: item.unitCostUsd !== undefined ? item.unitCostUsd : 0.0,
      material: item.material || 'Standard',
      supplier: item.supplier || 'In-House',
      children: []
    };

    if (item.children && Array.isArray(item.children)) {
      norm.children = item.children.map(child => this._normalizeItem(child, level + 1));
    }

    return norm;
  }

  /**
   * Recursively computes mass and cost roll-ups across all hierarchy levels.
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
   * Generates a consolidated flattened single-level BOM (all identical parts combined).
   * 
   * @returns {Array<Object>} Sorted list of unique parts with aggregated quantities
   */
  generateFlattenedBOM() {
    const partMap = new Map();

    const traverse = (item, parentMultiplier = 1) => {
      const currentMultiplier = parentMultiplier * item.quantity;

      if (!item.children || item.children.length === 0) {
        // Leaf part
        const key = item.partNumber;
        if (partMap.has(key)) {
          const entry = partMap.get(key);
          entry.totalQuantity += currentMultiplier;
          entry.extendedCostUsd += item.unitCostUsd * currentMultiplier;
          entry.extendedMassKg += item.unitMassKg * currentMultiplier;
        } else {
          partMap.set(key, {
            partNumber: item.partNumber,
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
    const headers = ['Part Number', 'Description', 'Material', 'Supplier', 'Qty', 'Unit Cost ($)', 'Ext Cost ($)', 'Unit Mass (kg)', 'Ext Mass (kg)'];
    const lines = [headers.join(',')];

    for (const r of flat) {
      lines.push([
        `"${r.partNumber}"`,
        `"${r.name}"`,
        `"${r.material}"`,
        `"${r.supplier}"`,
        r.totalQuantity,
        r.unitCostUsd.toFixed(2),
        r.extendedCostUsd.toFixed(2),
        r.unitMassKg.toFixed(4),
        r.extendedMassKg.toFixed(4)
      ].join(','));
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
