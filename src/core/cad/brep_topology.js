/**
 * OmniEng B-Rep (Boundary Representation) Geometry & Topological Kernel
 * Implements exact topological entities (Vertex, Edge, Face, Solid) and 3D CSG Booleans.
 */

const { Vector3 } = require('../math/linear_algebra');

class Vertex {
  constructor(x, y, z) {
    this.id = 'v_' + Math.random().toString(36).substr(2, 9);
    if (Array.isArray(x)) {
      this.point = new Vector3(x[0], x[1], x[2]);
    } else if (x && typeof x === 'object' && 'x' in x) {
      this.point = new Vector3(x.x, x.y, x.z);
    } else {
      this.point = new Vector3(x, y, z);
    }
  }
}

class Edge {
  constructor(vStart, vEnd) {
    this.id = 'e_' + Math.random().toString(36).substr(2, 9);
    this.start = vStart;
    this.end = vEnd;
  }

  length() {
    return this.start.point.distanceTo(this.end.point);
  }
}

class Face {
  constructor(vertices = [], normal = null) {
    this.id = 'f_' + Math.random().toString(36).substr(2, 9);
    this.vertices = vertices; // Array of Vertex
    this.normal = normal || this.computeNormal();
    this.material = { color: '#00e5ff', opacity: 1.0, wireframe: false };
  }

  computeNormal() {
    if (this.vertices.length < 3) return new Vector3(0, 0, 1);
    const v0 = this.vertices[0].point;
    const v1 = this.vertices[1].point;
    const v2 = this.vertices[2].point;
    const e1 = v1.clone().sub(v0);
    const e2 = v2.clone().sub(v0);
    return e1.cross(e2).normalize();
  }

  area() {
    if (this.vertices.length < 3) return 0;
    // Triangulated polygon area
    let totalArea = 0;
    const v0 = this.vertices[0].point;
    for (let i = 1; i < this.vertices.length - 1; i++) {
      const v1 = this.vertices[i].point;
      const v2 = this.vertices[i + 1].point;
      const cross = v1.clone().sub(v0).cross(v2.clone().sub(v0));
      totalArea += 0.5 * cross.length();
    }
    return totalArea;
  }
}

const GDT_GEOMETRIC_CHARACTERISTICS = new Set([
  'FLATNESS',
  'STRAIGHTNESS',
  'CIRCULARITY',
  'PERPENDICULARITY',
  'PARALLELISM',
  'POSITION',
  'TOTAL_RUNOUT'
]);

function normalizeGdtType(type) {
  if (typeof type !== 'string') return null;
  const norm = type
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '_');
  return GDT_GEOMETRIC_CHARACTERISTICS.has(norm) ? norm : null;
}

/**
 * PMI (Product and Manufacturing Information) datum definition (AP242-style).
 * A datum labels a face/entity that serves as a reference for GD&T tolerances.
 */
class PmiDatum {
  constructor(label, entityId, opts = {}) {
    this.id = 'datum_' + Math.random().toString(36).substr(2, 9);
    this.label = String(label || '').toUpperCase();
    this.entityId = entityId; // id of the associated topological entity (face/edge/vertex/body)
    this.name = opts.name || `Datum ${this.label}`;
    this.description = opts.description || '';
  }
}

/**
 * PMI geometric tolerance definition (AP242-style subset).
 * Supported characteristics: flatness, straightness, circularity,
 * perpendicularity, parallelism, position, total-runout.
 */
class PmiGeometricTolerance {
  constructor(spec = {}) {
    this.id = 'gdt_' + Math.random().toString(36).substr(2, 9);
    this.type = spec.type; // normalized characteristic code
    this.value = spec.value; // tolerance zone value (length units)
    this.datumRefs = Array.isArray(spec.datumRefs) ? [...spec.datumRefs] : [];
    this.entityId = spec.entityId; // id of the tolerated topological entity
    this.name = spec.name || this.type;
    this.description = spec.description || '';
    // Optional companion size record (TOLERANCED_SIZE) when a nominal size is supplied
    this.nominalSize = Number.isFinite(spec.nominalSize) ? spec.nominalSize : null;
  }
}

class SolidBody {
  constructor(name = 'Solid') {
    this.id = 'body_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.vertices = [];
    this.edges = [];
    this.faces = [];
    this.color = '#38bdf8';
    this.datums = [];
    this.geometricTolerances = [];
  }

  /**
   * Resolves a topological entity id (face/edge/vertex/body id or name).
   * @param {string|Object} entityId
   * @returns {Object|null} the entity, or null when unknown
   */
  findEntity(entityId) {
    if (entityId === null || entityId === undefined) return null;
    if (typeof entityId === 'object') return entityId;
    const id = String(entityId);
    for (const face of this.faces) {
      if (face.id === id || face.name === id) return face;
    }
    for (const edge of this.edges) {
      if (edge.id === id) return edge;
    }
    for (const v of this.vertices) {
      if (v.id === id) return v;
    }
    if (this.id === id || this.name === id) return this;
    return null;
  }

  /**
   * Registers a datum label on an existing topological entity (face/edge/vertex/body).
   * @param {string} label Datum label (e.g. 'A')
   * @param {string|Object} entityId
   * @param {Object} [opts] { name, description }
   * @returns {PmiDatum}
   */
  addDatum(label, entityId, opts = {}) {
    if (!label || typeof label !== 'string') {
      throw new Error(`Datum label must be a non-empty string, got ${JSON.stringify(label)}`);
    }
    if (!this.findEntity(entityId)) {
      throw new Error(`Datum '${label}' references unknown entity ${JSON.stringify(entityId)}`);
    }
    for (const d of this.datums) {
      if (d.label === String(label).toUpperCase()) {
        throw new Error(`Datum '${String(label).toUpperCase()}' already exists on this solid`);
      }
    }
    const datum = new PmiDatum(label, entityId instanceof Object && entityId.id ? entityId.id : entityId, opts);
    this.datums.push(datum);
    return datum;
  }

  /**
   * Resolves a datum reference (label or datum id) to a registered PmiDatum.
   * @param {string|Object} ref
   * @returns {PmiDatum|null}
   */
  findDatum(ref) {
    if (ref === null || ref === undefined) return null;
    if (typeof ref === 'object') {
      const key = ref.label !== undefined ? String(ref.label).toUpperCase() : ref.id;
      return this.findDatum(key);
    }
    const key = String(ref);
    return this.datums.find((d) => d.label === key || d.id === key) || null;
  }

  /**
   * Attaches a GD&T geometric tolerance to an existing entity.
   * @param {string|Object} entityId Face/edge/vertex/body id (or entity object)
   * @param {Object} gdtSpec
   *   - type: 'flatness' | 'straightness' | 'circularity' | 'perpendicularity'
   *     | 'parallelism' | 'position' | 'total-runout'
   *   - value: finite non-negative number (tolerance zone)
   *   - datumRefs: array of datum labels / datum ids, each must exist
   *   - nominalSize (optional): number -> also emits TOLERANCED_SIZE record
   * @returns {PmiGeometricTolerance}
   */
  attachGdtToEntity(entityId, gdtSpec) {
    if (!gdtSpec || typeof gdtSpec !== 'object') {
      throw new Error('attachGdtToEntity requires a gdtSpec object');
    }
    const type = normalizeGdtType(gdtSpec.type);
    if (!type) {
      throw new Error(
        `Unsupported GD&T characteristic ${JSON.stringify(gdtSpec.type)}; supported: ${[...GDT_GEOMETRIC_CHARACTERISTICS].join(', ')}`
      );
    }
    const value = gdtSpec.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`GD&T value must be a finite non-negative number, got ${value}`);
    }
    const entity = this.findEntity(entityId);
    if (!entity) {
      throw new Error(`GD&T ${type} references unknown entity ${JSON.stringify(entityId)}`);
    }
    const datumRefs = [];
    for (const ref of gdtSpec.datumRefs || []) {
      const datum = this.findDatum(ref);
      if (!datum) {
        throw new Error(`GD&T ${type} references unknown datum ${JSON.stringify(ref)}; register it first via addDatum`);
      }
      datumRefs.push(datum);
    }
    const tolerance = new PmiGeometricTolerance({
      type,
      value,
      datumRefs: datumRefs.map((d) => d.label),
      entityId: entity.id || entityId,
      name: gdtSpec.name,
      description: gdtSpec.description,
      nominalSize: gdtSpec.nominalSize
    });
    this.geometricTolerances.push(tolerance);
    return tolerance;
  }

  computeVolume() {
    // Divergence theorem on closed polyhedron
    let vol = 0;
    for (const face of this.faces) {
      if (face.vertices.length >= 3) {
        const v0 = face.vertices[0].point;
        for (let i = 1; i < face.vertices.length - 1; i++) {
          const v1 = face.vertices[i].point;
          const v2 = face.vertices[i + 1].point;
          // Triple product
          vol += v0.dot(v1.cross(v2)) / 6.0;
        }
      }
    }
    return Math.round(Math.abs(vol) * 1e6) / 1e6;
  }

  getBoundingBox() {
    if (this.vertices.length === 0) {
      return { min: new Vector3(0, 0, 0), max: new Vector3(0, 0, 0) };
    }
    const min = this.vertices[0].point.clone();
    const max = this.vertices[0].point.clone();
    for (const v of this.vertices) {
      min.x = Math.min(min.x, v.point.x);
      min.y = Math.min(min.y, v.point.y);
      min.z = Math.min(min.z, v.point.z);
      max.x = Math.max(max.x, v.point.x);
      max.y = Math.max(max.y, v.point.y);
      max.z = Math.max(max.z, v.point.z);
    }
    return { min, max };
  }

  toTriangles() {
    // Decompose all n-gon faces into triangle arrays [p0, p1, p2, normal]
    const triangles = [];
    for (const face of this.faces) {
      if (face.vertices.length < 3) continue;
      const normal = face.normal || face.computeNormal();
      const v0 = face.vertices[0].point;
      for (let i = 1; i < face.vertices.length - 1; i++) {
        triangles.push({
          a: v0,
          b: face.vertices[i].point,
          c: face.vertices[i + 1].point,
          normal
        });
      }
    }
    return triangles;
  }

  toOBJ() {
    let out = `# OmniEng Parametric B-Rep OBJ Export\no ${this.name}\n`;
    for (const v of this.vertices) {
      out += `v ${v.point.x.toFixed(4)} ${v.point.y.toFixed(4)} ${v.point.z.toFixed(4)}\n`;
    }
    const vMap = new Map();
    this.vertices.forEach((v, idx) => vMap.set(v, idx + 1));

    for (const f of this.faces) {
      if (f.vertices.length >= 3) {
        out += 'f ' + f.vertices.map((v) => vMap.get(v)).join(' ') + '\n';
      }
    }
    return out;
  }

  buildEdges() {
    const edgeMap = new Map();
    this.edges = [];
    for (const face of this.faces) {
      const len = face.vertices.length;
      for (let i = 0; i < len; i++) {
        const v1 = face.vertices[i];
        const v2 = face.vertices[(i + 1) % len];
        const k1 = `${v1.point.x.toFixed(4)},${v1.point.y.toFixed(4)},${v1.point.z.toFixed(4)}`;
        const k2 = `${v2.point.x.toFixed(4)},${v2.point.y.toFixed(4)},${v2.point.z.toFixed(4)}`;
        const key = k1 < k2 ? `${k1}_${k2}` : `${k2}_${k1}`;
        if (!edgeMap.has(key)) {
          const edge = new Edge(v1, v2);
          edgeMap.set(key, edge);
          this.edges.push(edge);
        }
      }
    }
    return this.edges;
  }
}

/**
 * Procedural B-Rep Geometry Primitives Generator
 */
class BRepPrimitives {
  /**
   * Create parametric box solid
   */
  static createBox(dx = 10, dy = 10, dz = 10, name = 'Box') {
    const body = new SolidBody(name);
    const x0 = -dx / 2,
      x1 = dx / 2;
    const y0 = -dy / 2,
      y1 = dy / 2;
    const z0 = -dz / 2,
      z1 = dz / 2;

    const v = [
      new Vertex(x0, y0, z0), // 0
      new Vertex(x1, y0, z0), // 1
      new Vertex(x1, y1, z0), // 2
      new Vertex(x0, y1, z0), // 3
      new Vertex(x0, y0, z1), // 4
      new Vertex(x1, y0, z1), // 5
      new Vertex(x1, y1, z1), // 6
      new Vertex(x0, y1, z1) // 7
    ];
    body.vertices = v;

    // 6 faces (CCW outward normal)
    body.faces = [
      new Face([v[0], v[3], v[2], v[1]], new Vector3(0, 0, -1)), // Bottom -Z
      new Face([v[4], v[5], v[6], v[7]], new Vector3(0, 0, 1)), // Top +Z
      new Face([v[0], v[1], v[5], v[4]], new Vector3(0, -1, 0)), // Front -Y
      new Face([v[2], v[3], v[7], v[6]], new Vector3(0, 1, 0)), // Back +Y
      new Face([v[0], v[4], v[7], v[3]], new Vector3(-1, 0, 0)), // Left -X
      new Face([v[1], v[2], v[6], v[5]], new Vector3(1, 0, 0)) // Right +X
    ];

    body.buildEdges();
    return body;
  }

  /**
   * Create parametric cylinder solid
   */
  static createCylinder(radius = 5, height = 20, segments = 24, name = 'Cylinder') {
    const body = new SolidBody(name);
    const halfH = height / 2;
    const bottomVerts = [];
    const topVerts = [];

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * 2 * Math.PI;
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta);
      bottomVerts.push(new Vertex(x, y, -halfH));
      topVerts.push(new Vertex(x, y, halfH));
    }

    body.vertices = [...bottomVerts, ...topVerts];

    // Bottom face (reversed for downward normal)
    const bottomReversed = [...bottomVerts].reverse();
    body.faces.push(new Face(bottomReversed, new Vector3(0, 0, -1)));

    // Top face (upward normal)
    body.faces.push(new Face(topVerts, new Vector3(0, 0, 1)));

    // Side quad faces
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const v0 = bottomVerts[i];
      const v1 = bottomVerts[next];
      const v2 = topVerts[next];
      const v3 = topVerts[i];
      const normal = new Vector3((v0.point.x + v1.point.x) / 2, (v0.point.y + v1.point.y) / 2, 0).normalize();
      body.faces.push(new Face([v0, v1, v2, v3], normal));
    }

    body.buildEdges();
    return body;
  }

  /**
   * Create parametric sphere solid
   */
  static createSphere(radius = 10, latSegments = 16, lonSegments = 24, name = 'Sphere') {
    const body = new SolidBody(name);
    const grid = [];

    for (let i = 0; i <= latSegments; i++) {
      const theta = (i / latSegments) * Math.PI; // 0 to PI
      const row = [];
      for (let j = 0; j <= lonSegments; j++) {
        const phi = (j / lonSegments) * 2 * Math.PI; // 0 to 2*PI
        const x = radius * Math.sin(theta) * Math.cos(phi);
        const y = radius * Math.sin(theta) * Math.sin(phi);
        const z = radius * Math.cos(theta);
        const v = new Vertex(x, y, z);
        body.vertices.push(v);
        row.push(v);
      }
      grid.push(row);
    }

    for (let i = 0; i < latSegments; i++) {
      for (let j = 0; j < lonSegments; j++) {
        const v0 = grid[i][j];
        const v1 = grid[i + 1][j];
        const v2 = grid[i + 1][j + 1];
        const v3 = grid[i][j + 1];

        if (i === 0) {
          // Top pole triangle
          body.faces.push(new Face([v0, v1, v2]));
        } else if (i === latSegments - 1) {
          // Bottom pole triangle
          body.faces.push(new Face([v0, v1, v3]));
        } else {
          // Quad face
          body.faces.push(new Face([v0, v1, v2, v3]));
        }
      }
    }

    body.buildEdges();
    return body;
  }
}

SolidBody.createBox = BRepPrimitives.createBox;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Vertex,
    Edge,
    Face,
    SolidBody,
    BRepPrimitives,
    PmiDatum,
    PmiGeometricTolerance,
    normalizeGdtType,
    GDT_GEOMETRIC_CHARACTERISTICS
  };
}
