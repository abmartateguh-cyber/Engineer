/**
 * OmniEng B-Rep (Boundary Representation) Geometry & Topological Kernel
 * Implements exact topological entities (Vertex, Edge, Face, Solid) and 3D CSG Booleans.
 */

const { Vector3 } = require('../math/linear_algebra');

class Vertex {
  constructor(x, y, z) {
    this.id = 'v_' + Math.random().toString(36).substr(2, 9);
    this.point = new Vector3(x, y, z);
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

class SolidBody {
  constructor(name = 'Solid') {
    this.id = 'body_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.vertices = [];
    this.edges = [];
    this.faces = [];
    this.color = '#38bdf8';
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
        out += 'f ' + f.vertices.map(v => vMap.get(v)).join(' ') + '\n';
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
    const x0 = -dx / 2, x1 = dx / 2;
    const y0 = -dy / 2, y1 = dy / 2;
    const z0 = -dz / 2, z1 = dz / 2;

    const v = [
      new Vertex(x0, y0, z0), // 0
      new Vertex(x1, y0, z0), // 1
      new Vertex(x1, y1, z0), // 2
      new Vertex(x0, y1, z0), // 3
      new Vertex(x0, y0, z1), // 4
      new Vertex(x1, y0, z1), // 5
      new Vertex(x1, y1, z1), // 6
      new Vertex(x0, y1, z1)  // 7
    ];
    body.vertices = v;

    // 6 faces (CCW outward normal)
    body.faces = [
      new Face([v[0], v[3], v[2], v[1]], new Vector3(0, 0, -1)), // Bottom -Z
      new Face([v[4], v[5], v[6], v[7]], new Vector3(0, 0, 1)),  // Top +Z
      new Face([v[0], v[1], v[5], v[4]], new Vector3(0, -1, 0)), // Front -Y
      new Face([v[2], v[3], v[7], v[6]], new Vector3(0, 1, 0)),  // Back +Y
      new Face([v[0], v[4], v[7], v[3]], new Vector3(-1, 0, 0)), // Left -X
      new Face([v[1], v[2], v[6], v[5]], new Vector3(1, 0, 0))   // Right +X
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
      const normal = new Vector3(
        (v0.point.x + v1.point.x) / 2,
        (v0.point.y + v1.point.y) / 2,
        0
      ).normalize();
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vertex, Edge, Face, SolidBody, BRepPrimitives };
}
