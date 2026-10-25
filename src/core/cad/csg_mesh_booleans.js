/**
 * OmniEng Constructive Solid Geometry (CSG) 3D Mesh Boolean Engine
 * Standard: Binary Space Partitioning (BSP) Tree Polygon Clipping
 * Experimental implementation: Boolean Union, Difference, and Intersection for CAD solids.
 */

class CSGVertex {
  constructor(pos, normal) {
    this.pos = [pos[0], pos[1], pos[2]];
    this.normal = normal ? [normal[0], normal[1], normal[2]] : [0, 0, 1];
  }

  clone() {
    return new CSGVertex(this.pos, this.normal);
  }

  flip() {
    this.normal[0] = -this.normal[0];
    this.normal[1] = -this.normal[1];
    this.normal[2] = -this.normal[2];
  }

  interpolate(other, t) {
    return new CSGVertex(
      [
        this.pos[0] + (other.pos[0] - this.pos[0]) * t,
        this.pos[1] + (other.pos[1] - this.pos[1]) * t,
        this.pos[2] + (other.pos[2] - this.pos[2]) * t
      ],
      [
        this.normal[0] + (other.normal[0] - this.normal[0]) * t,
        this.normal[1] + (other.normal[1] - this.normal[1]) * t,
        this.normal[2] + (other.normal[2] - this.normal[2]) * t
      ]
    );
  }
}

class CSGPlane {
  constructor(normal, w) {
    this.normal = normal;
    this.w = w;
  }

  static fromPoints(a, b, c) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1.0;
    n[0] /= len;
    n[1] /= len;
    n[2] /= len;
    const w = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    return new CSGPlane(n, w);
  }

  clone() {
    return new CSGPlane([...this.normal], this.w);
  }

  flip() {
    this.normal[0] = -this.normal[0];
    this.normal[1] = -this.normal[1];
    this.normal[2] = -this.normal[2];
    this.w = -this.w;
  }

  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0;
    const FRONT = 1;
    const BACK = 2;
    const SPANNING = 3;
    const EPSILON = 1e-5;

    let polygonType = 0;
    const types = [];

    for (let i = 0; i < polygon.vertices.length; i++) {
      const v = polygon.vertices[i];
      const t = this.normal[0] * v.pos[0] + this.normal[1] * v.pos[1] + this.normal[2] * v.pos[2] - this.w;
      const type = (t < -EPSILON) ? BACK : (t > EPSILON ? FRONT : COPLANAR);
      polygonType |= type;
      types.push(type);
    }

    switch (polygonType) {
      case COPLANAR: {
        const dot = this.normal[0] * polygon.plane.normal[0] + this.normal[1] * polygon.plane.normal[1] + this.normal[2] * polygon.plane.normal[2];
        (dot > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      }
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING: {
        const f = [], b = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i], tj = types[j];
          const vi = polygon.vertices[i], vj = polygon.vertices[j];

          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);

          if ((ti | tj) === SPANNING) {
            const denom = this.normal[0] * (vj.pos[0] - vi.pos[0]) + this.normal[1] * (vj.pos[1] - vi.pos[1]) + this.normal[2] * (vj.pos[2] - vi.pos[2]);
            const num = this.w - (this.normal[0] * vi.pos[0] + this.normal[1] * vi.pos[1] + this.normal[2] * vi.pos[2]);
            const t = Math.abs(denom) > 1e-8 ? num / denom : 0.5;
            const v = vi.interpolate(vj, Math.max(0, Math.min(1, t)));
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new CSGPolygon(f, polygon.plane));
        if (b.length >= 3) back.push(new CSGPolygon(b, polygon.plane));
        break;
      }
    }
  }
}

class CSGPolygon {
  constructor(vertices, plane) {
    this.vertices = vertices;
    this.plane = plane || CSGPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }

  clone() {
    return new CSGPolygon(this.vertices.map(v => v.clone()), this.plane.clone());
  }

  flip() {
    this.vertices.reverse().forEach(v => v.flip());
    this.plane.flip();
  }
}

class CSGNode {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }

  clone() {
    const node = new CSGNode();
    node.plane = this.plane && this.plane.clone();
    node.front = this.front && this.front.clone();
    node.back = this.back && this.back.clone();
    node.polygons = this.polygons.map(p => p.clone());
    return node;
  }

  invert() {
    for (let i = 0; i < this.polygons.length; i++) {
      this.polygons[i].flip();
    }
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const temp = this.front;
    this.front = this.back;
    this.back = temp;
  }

  clipPolygons(polygons) {
    if (!this.plane) return polygons.slice();
    let front = [], back = [];

    for (let i = 0; i < polygons.length; i++) {
      this.plane.splitPolygon(polygons[i], front, back, front, back);
    }

    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];

    return front.concat(back);
  }

  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  allPolygons() {
    let list = this.polygons.slice();
    if (this.front) list = list.concat(this.front.allPolygons());
    if (this.back) list = list.concat(this.back.allPolygons());
    return list;
  }

  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];

    for (let i = 0; i < polygons.length; i++) {
      this.plane.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
    }

    if (front.length) {
      if (!this.front) this.front = new CSGNode();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new CSGNode();
      this.back.build(back);
    }
  }
}

class CSGSolid {
  constructor(polygons = []) {
    this.polygons = polygons;
  }

  static fromMesh(vertices, faces) {
    const polygons = [];
    for (let i = 0; i < faces.length; i++) {
      const idx = faces[i];
      const polyVerts = [];
      for (let j = 0; j < idx.length; j++) {
        const v = vertices[idx[j]];
        polyVerts.push(new CSGVertex(v));
      }
      if (polyVerts.length >= 3) {
        polygons.push(new CSGPolygon(polyVerts));
      }
    }
    return new CSGSolid(polygons);
  }

  static createBox(size = [20, 20, 20], center = [0, 0, 0]) {
    const sx = size[0] / 2, sy = size[1] / 2, sz = size[2] / 2;
    const cx = center[0], cy = center[1], cz = center[2];

    const verts = [
      [cx - sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz - sz],
      [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz],
      [cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz],
      [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz]
    ];

    const faces = [
      [0, 3, 2, 1], [4, 5, 6, 7], // Bottom, Top
      [0, 1, 5, 4], [2, 3, 7, 6], // Front, Back
      [1, 2, 6, 5], [0, 4, 7, 3]  // Right, Left
    ];

    return this.fromMesh(verts, faces);
  }

  static createCylinder(radius = 10, height = 20, segments = 16, center = [0, 0, 0]) {
    const halfH = height / 2;
    const cx = center[0], cy = center[1], cz = center[2];
    const verts = [];
    const faces = [];

    // Bottom and top centers
    const bCenterIdx = verts.push([cx, cy, cz - halfH]) - 1;
    const tCenterIdx = verts.push([cx, cy, cz + halfH]) - 1;

    const bRing = [];
    const tRing = [];

    for (let i = 0; i < segments; i++) {
      const theta = (2 * Math.PI * i) / segments;
      const x = cx + radius * Math.cos(theta);
      const y = cy + radius * Math.sin(theta);
      bRing.push(verts.push([x, y, cz - halfH]) - 1);
      tRing.push(verts.push([x, y, cz + halfH]) - 1);
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      // Bottom fan
      faces.push([bCenterIdx, bRing[next], bRing[i]]);
      // Top fan
      faces.push([tCenterIdx, tRing[i], tRing[next]]);
      // Quad side
      faces.push([bRing[i], bRing[next], tRing[next], tRing[i]]);
    }

    return this.fromMesh(verts, faces);
  }

  union(other) {
    const a = new CSGNode(this.polygons.map(p => p.clone()));
    const b = new CSGNode(other.polygons.map(p => p.clone()));
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    return new CSGSolid(a.allPolygons());
  }

  subtract(other) {
    const a = new CSGNode(this.polygons.map(p => p.clone()));
    const b = new CSGNode(other.polygons.map(p => p.clone()));
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
    return new CSGSolid(a.allPolygons());
  }

  intersect(other) {
    const a = new CSGNode(this.polygons.map(p => p.clone()));
    const b = new CSGNode(other.polygons.map(p => p.clone()));
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();
    return new CSGSolid(a.allPolygons());
  }

  toMesh() {
    const vertices = [];
    const faces = [];
    const vertMap = new Map();

    const getVertIndex = (pos) => {
      const key = `${pos[0].toFixed(5)},${pos[1].toFixed(5)},${pos[2].toFixed(5)}`;
      if (vertMap.has(key)) return vertMap.get(key);
      const idx = vertices.push([pos[0], pos[1], pos[2]]) - 1;
      vertMap.set(key, idx);
      return idx;
    };

    for (let i = 0; i < this.polygons.length; i++) {
      const p = this.polygons[i];
      const fIndices = p.vertices.map(v => getVertIndex(v.pos));
      // Triangulate if polygon has > 3 vertices
      for (let j = 1; j < fIndices.length - 1; j++) {
        faces.push([fIndices[0], fIndices[j], fIndices[j + 1]]);
      }
    }

    return { vertices, faces };
  }

  toTriangles() {
    const triangles = [];
    for (let i = 0; i < this.polygons.length; i++) {
      const p = this.polygons[i];
      const norm = p.plane ? p.plane.normal : [0, 0, 1];
      const nVec = { x: norm[0], y: norm[1], z: norm[2] };
      for (let j = 1; j < p.vertices.length - 1; j++) {
        const v0 = p.vertices[0].pos;
        const v1 = p.vertices[j].pos;
        const v2 = p.vertices[j + 1].pos;
        triangles.push({
          a: { x: v0[0], y: v0[1], z: v0[2] },
          b: { x: v1[0], y: v1[1], z: v1[2] },
          c: { x: v2[0], y: v2[1], z: v2[2] },
          normal: nVec
        });
      }
    }
    return triangles;
  }

  static fromBRep(brep) {
    if (!brep) return new CSGSolid([]);
    const tris = typeof brep.toTriangles === 'function' ? brep.toTriangles() : [];
    const polys = tris.map(t => {
      const n = t.normal ? [t.normal.x, t.normal.y, t.normal.z] : [0, 0, 1];
      const v1 = new CSGVertex([t.a.x, t.a.y, t.a.z], n);
      const v2 = new CSGVertex([t.b.x, t.b.y, t.b.z], n);
      const v3 = new CSGVertex([t.c.x, t.c.y, t.c.z], n);
      return new CSGPolygon([v1, v2, v3]);
    });
    return new CSGSolid(polys);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CSGSolid, CSGNode, CSGPolygon, CSGPlane, CSGVertex };
}
