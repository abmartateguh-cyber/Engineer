/**
 * periodic_table_engine.js
 * Programmatic access and engineering evaluation for all 118 IUPAC periodic table elements.
 * Provides atomic, physical, thermodynamic, and electronic properties.
 */

const fs = require('fs');
const path = require('path');

class PeriodicTableEngine {
  constructor() {
    this.elementsByZ = new Map();
    this.elementsBySymbol = new Map();
    this.elementsByName = new Map();
    this._load();
  }

  _load() {
    const dataPath = path.join(__dirname, 'data/periodic_table_118_elements.json');
    if (!fs.existsSync(dataPath)) {
      throw new Error(`Periodic table database not found at: ${dataPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    this.metadata = raw.metadata;
    for (const el of raw.elements) {
      this.elementsByZ.set(el.atomic_number, el);
      this.elementsBySymbol.set(el.symbol.toUpperCase(), el);
      this.elementsByName.set(el.name.toLowerCase(), el);
    }
  }

  /**
   * Get element by atomic number Z (1 to 118)
   */
  getElementByZ(z) {
    const num = parseInt(z, 10);
    return this.elementsByZ.get(num) || null;
  }

  /**
   * Get element by chemical symbol (e.g. 'Fe', 'Au', 'U', 'OG')
   */
  getElementBySymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') return null;
    return this.elementsBySymbol.get(symbol.trim().toUpperCase()) || null;
  }

  /**
   * Get element by full English name (e.g. 'Titanium', 'carbon')
   */
  getElementByName(name) {
    if (!name || typeof name !== 'string') return null;
    return this.elementsByName.get(name.trim().toLowerCase()) || null;
  }

  /**
   * Return all 118 element records
   */
  getAllElements() {
    return Array.from(this.elementsByZ.values());
  }

  /**
   * Filter elements by group (1 to 18)
   */
  getElementsInGroup(group) {
    const g = parseInt(group, 10);
    return this.getAllElements().filter(el => el.group === g);
  }

  /**
   * Filter elements by period (1 to 7)
   */
  getElementsInPeriod(period) {
    const p = parseInt(period, 10);
    return this.getAllElements().filter(el => el.period === p);
  }

  /**
   * Filter elements by electron block ('s', 'p', 'd', 'f')
   */
  getElementsInBlock(block) {
    if (!block || typeof block !== 'string') return [];
    const b = block.trim().toLowerCase();
    return this.getAllElements().filter(el => el.block === b);
  }

  /**
   * Computes thermal diffusivity alpha = k / (rho * Cp) in m^2/s
   */
  getThermalDiffusivity(zOrSymbol) {
    const el = typeof zOrSymbol === 'number' ? this.getElementByZ(zOrSymbol) : this.getElementBySymbol(zOrSymbol);
    if (!el || !el.thermal_conductivity_w_m_k || !el.density_kg_m3 || !el.specific_heat_j_kg_k) {
      return null;
    }
    const k = el.thermal_conductivity_w_m_k;
    const rho = el.density_kg_m3;
    const cp = el.specific_heat_j_kg_k;
    return k / (rho * cp);
  }

  /**
   * General keyword search across symbol, name, and atomic number
   */
  search(query) {
    if (!query) return [];
    const q = String(query).trim().toLowerCase();
    return this.getAllElements().filter(el =>
      el.symbol.toLowerCase() === q ||
      el.name.toLowerCase().includes(q) ||
      String(el.atomic_number) === q ||
      el.category.toLowerCase().includes(q)
    );
  }
}

let instance = null;
function getPeriodicTable() {
  if (!instance) {
    instance = new PeriodicTableEngine();
  }
  return instance;
}

module.exports = {
  PeriodicTableEngine,
  getPeriodicTable
};
