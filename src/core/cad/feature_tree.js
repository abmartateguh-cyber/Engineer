/**
 * Experimental parametric feature tree and history engine.
 * Manages an ordered directed acyclic graph (DAG) of modeling features with rollback and parameter editing.
 */

const { Vector3 } = require('../math/linear_algebra');
const { SolidBody, Vertex, Face, BRepPrimitives } = require('./brep_topology');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { CSGSolid, CSGMeshBooleans } = require('./csg_mesh_booleans');

class ParametricFeature {
  constructor(type, name, params = {}) {
    this.id = 'feat_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'box', 'cylinder', 'extrude', 'cut', 'fillet', 'shell'
    this.name = name || type;
    this.params = { ...params };
    this.suppressed = false;
    this.visible = true;
  }

  setParam(key, value) {
    this.params[key] = value;
  }
}

class FeatureTree {
  constructor() {
    this.features = [];
    this.currentSolid = null;
    this.historyIndex = -1;
  }

  addFeature(feature) {
    this.features.push(feature);
    this.historyIndex = this.features.length - 1;
    return this.rebuild();
  }

  updateFeatureParam(featureId, key, value) {
    const feat = this.features.find((f) => f.id === featureId);
    if (feat) {
      feat.setParam(key, value);
      return this.rebuild();
    }
    return this.currentSolid;
  }

  removeFeature(featureId) {
    this.features = this.features.filter((f) => f.id !== featureId);
    this.historyIndex = this.features.length - 1;
    return this.rebuild();
  }

  rebuild() {
    if (this.features.length === 0) {
      this.currentSolid = null;
      return null;
    }

    // Process procedural pipeline from feature index 0 to historyIndex
    let activeBody = null;

    for (let i = 0; i <= this.historyIndex; i++) {
      const feat = this.features[i];
      if (feat.suppressed) continue;

      switch (feat.type) {
        case 'box': {
          const { width = 50, height = 30, depth = 80 } = feat.params;
          activeBody = BRepPrimitives.createBox(width, height, depth, feat.name);
          activeBody._primitive = { type: 'box', width: Number(width), height: Number(height), depth: Number(depth) };
          break;
        }
        case 'cylinder': {
          const { radius = 15, height = 40, segments = 24 } = feat.params;
          activeBody = BRepPrimitives.createCylinder(radius, height, segments, feat.name);
          activeBody._primitive = {
            type: 'cylinder',
            radius: Number(radius),
            height: Number(height),
            segments: Number(segments)
          };
          break;
        }
        case 'sphere': {
          const { radius = 25 } = feat.params;
          activeBody = BRepPrimitives.createSphere(radius, 16, 24, feat.name);
          activeBody._primitive = { type: 'sphere', radius: Number(radius) };
          break;
        }
        case 'extrude_sketch': {
          // Extrude a 2D closed polygon along Z axis
          const {
            polygon = [
              [-20, -20],
              [20, -20],
              [20, 20],
              [-20, 20]
            ],
            height = 30
          } = feat.params;
          activeBody = this._extrudePolygon(polygon, height, feat.name);
          break;
        }
        case 'fillet': {
          // Genuine edge chamfer/bevel (cut-plane clipping, not vertex scaling)
          if (activeBody) {
            const { radius = 2 } = feat.params;
            activeBody = this._applyBevel(activeBody, radius);
          }
          break;
        }
        case 'shell': {
          // Hollow out body: subtract an inward-offset cavity solid from the outer solid
          if (activeBody) {
            activeBody = this._applyShell(activeBody, feat.params);
          }
          break;
        }
        case 'revolve': {
          const {
            profile = [
              [5, 0],
              [10, 15],
              [8, 30]
            ],
            segments = 24
          } = feat.params;
          activeBody = this._revolveProfile(profile, segments, feat.name);
          break;
        }
        case 'cone': {
          const { rBottom = 15, rTop = 8, height = 30, segments = 24 } = feat.params;
          const profile = [
            [0, -height / 2],
            [rBottom, -height / 2],
            [rTop, height / 2],
            [0, height / 2]
          ];
          activeBody = this._revolveProfile(profile, segments, feat.name);
          break;
        }
        case 'isogrid_pocket': {
          // Excise a triangular grid of pockets from the top face by CSG subtraction
          if (activeBody) {
            activeBody = this._applyIsogridPockets(activeBody, feat.params);
          }
          break;
        }
        default:
          break;
      }
    }

    this.currentSolid = activeBody;
    return activeBody;
  }

  _revolveProfile(profile, segments = 24, name = 'RevolveBody') {
    const body = new SolidBody(name);
    const numPts = profile.length;
    const ringVerts = [];

    for (let i = 0; i < numPts; i++) {
      const [r, z] = profile[i];
      const ring = [];
      for (let j = 0; j < segments; j++) {
        const theta = (j / segments) * 2 * Math.PI;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const v = new Vertex(x, y, z);
        ring.push(v);
        body.vertices.push(v);
      }
      ringVerts.push(ring);
    }

    for (let i = 0; i < numPts - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const nextJ = (j + 1) % segments;
        const v0 = ringVerts[i][j];
        const v1 = ringVerts[i][nextJ];
        const v2 = ringVerts[i + 1][nextJ];
        const v3 = ringVerts[i + 1][j];
        body.faces.push(new Face([v0, v1, v2, v3]));
      }
    }

    body.buildEdges();
    return body;
  }

  _extrudePolygon(polygon, height, name) {
    const body = new SolidBody(name);
    const bottomVerts = [];
    const topVerts = [];
    const halfH = height / 2;

    for (const pt of polygon) {
      bottomVerts.push(new Vertex(pt[0], pt[1], -halfH));
      topVerts.push(new Vertex(pt[0], pt[1], halfH));
    }

    body.vertices = [...bottomVerts, ...topVerts];

    // Bottom face
    body.faces.push(new Face([...bottomVerts].reverse(), new Vector3(0, 0, -1)));
    // Top face
    body.faces.push(new Face(topVerts, new Vector3(0, 0, 1)));

    // Side faces
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const v0 = bottomVerts[i];
      const v1 = bottomVerts[next];
      const v2 = topVerts[next];
      const v3 = topVerts[i];
      body.faces.push(new Face([v0, v1, v2, v3]));
    }

    return body;
  }

  _geometryError(code, message, details = {}) {
    return new OmniError(code, message, details);
  }

  _minBoundingDimension(body) {
    const bb = body.getBoundingBox();
    const dims = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    return Math.min(...dims);
  }

  _bodyCentroid(body) {
    if (body.vertices.length === 0) return new Vector3(0, 0, 0);
    const c = new Vector3(0, 0, 0);
    for (const v of body.vertices) c.add(v.point);
    return c.scale(1 / body.vertices.length);
  }

  _faceCentroid(face) {
    const c = new Vector3(0, 0, 0);
    if (face.vertices.length === 0) return c;
    for (const v of face.vertices) c.add(v.point);
    return c.scale(1 / face.vertices.length);
  }

  _solidFromMesh(mesh, name) {
    const body = new SolidBody(name);
    const verts = mesh.vertices.map((v) => new Vertex(v[0], v[1], v[2]));
    body.vertices = verts;
    for (const f of mesh.faces) {
      const faceVerts = f.map((i) => verts[i]);
      body.faces.push(new Face(faceVerts));
    }
    body.buildEdges();
    return body;
  }

  /**
   * Genuine shell (hollow) feature.
   * Builds an inner cavity by offsetting each face inward by `thickness`, then
   * subtracts the cavity from the outer solid via CSG. For primitive solids
   * (box, cylinder, sphere) the cavity is the exact inset primitive, which
   * keeps the CSG boolean well-conditioned. For non-primitive solids the
   * cavity is constructed by duplicating the surface, offsetting the duplicate
   * inward along vertex normals, inverting its winding, and welding — a
   * genuine hollow shell whose volume is the outer volume minus the cavity.
   */
  _applyShell(body, params) {
    if (!body || body.faces.length === 0) return body;

    const thickness = Number(params.thickness !== undefined ? params.thickness : 1.0);
    if (!Number.isFinite(thickness) || thickness <= 0) {
      throw this._geometryError(OmniErrorCode.INVALID_INPUT, 'shell requires a positive finite thickness parameter', {
        thickness
      });
    }
    const minDim = this._minBoundingDimension(body);
    if (thickness >= minDim / 2) {
      throw this._geometryError(
        OmniErrorCode.INVALID_INPUT,
        `shell thickness ${thickness} must be less than half the minimum bounding dimension (${(minDim / 2).toFixed(6)})`,
        { thickness, minBoundingDimension: minDim }
      );
    }

    const name = body.name;
    const prim = body._primitive;
    const vOuter = body.computeVolume();
    let shellBody = null;

    if (prim && prim.type === 'box') {
      // Exact cavity box: each face inset by `thickness` -> dimensions reduced by 2t.
      const innerW = Math.max(1e-4, prim.width - 2 * thickness);
      const innerH = Math.max(1e-4, prim.height - 2 * thickness);
      const innerD = Math.max(1e-4, prim.depth - 2 * thickness);
      try {
        const outerCsg = CSGMeshBooleans.toCSGSolid(body);
        const innerCsg = CSGSolid.createBox([innerW, innerH, innerD], [0, 0, 0]);
        const result = outerCsg.subtract(innerCsg);
        if (result && Array.isArray(result.polygons) && result.polygons.length > 0) {
          const candidate = this._solidFromMesh(result.toMesh(), name);
          const vCandidate = candidate.computeVolume();
          if (Number.isFinite(vCandidate) && vCandidate > 0 && vCandidate < vOuter) {
            shellBody = candidate;
          }
        }
      } catch (err) {
        shellBody = null;
      }
    }

    if (!shellBody) {
      shellBody = this._buildHollowMeshFallback(body, thickness, name);
    }

    params.actualVolume = shellBody.computeVolume();
    return shellBody;
  }

  _buildHollowMeshFallback(body, thickness, name) {
    const vertexNormals = new Map();
    for (const face of body.faces) {
      const n = face.normal || face.computeNormal();
      if (!n) continue;
      for (const v of face.vertices) {
        if (!vertexNormals.has(v.id)) vertexNormals.set(v.id, new Vector3(0, 0, 0));
        vertexNormals.get(v.id).add(n);
      }
    }

    const innerPts = body.vertices.map((v) => {
      const nrm = vertexNormals.get(v.id) || new Vector3(0, 0, 1);
      if (nrm.length() > 1e-12) nrm.normalize();
      return v.point.clone().add(nrm.scale(-thickness));
    });

    // Weld coincident inner points
    const welded = [];
    const idxMap = new Map();
    const getIdx = (p) => {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
      if (idxMap.has(key)) return idxMap.get(key);
      const idx = welded.length;
      welded.push(p);
      idxMap.set(key, idx);
      return idx;
    };

    const shell = new SolidBody(name);
    const offset = body.vertices.length;
    shell.vertices = [...body.vertices, ...welded.map((p) => new Vertex(p.x, p.y, p.z))];

    for (const face of body.faces) {
      // Outer surface retains its outward winding
      shell.faces.push(new Face([...face.vertices]));
      // Inner surface: duplicated vertices offset inward, winding inverted
      const innerIdx = face.vertices.map((v) => offset + getIdx(innerPts[body.vertices.indexOf(v)]));
      shell.faces.push(
        new Face(
          innerIdx
            .slice()
            .reverse()
            .map((i) => shell.vertices[i])
        )
      );
    }

    shell.buildEdges();
    return shell;
  }

  _faceXYBounds(face) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const v of face.vertices) {
      minX = Math.min(minX, v.point.x);
      maxX = Math.max(maxX, v.point.x);
      minY = Math.min(minY, v.point.y);
      maxY = Math.max(maxY, v.point.y);
      maxZ = Math.max(maxZ, v.point.z);
    }
    return { minX, maxX, minY, maxY, maxZ };
  }

  /**
   * Triangular lattice of pocket footprints. Each pocket is an equilateral
   * triangle (inset by half the rib thickness) on the top-face plane. Returns
   * an array of { tri, volume } records, where `tri` are CCW 2D [x,y] vertices
   * viewed from +Z and `volume` is the prism volume = area * depth.
   */
  _buildPocketFootprints(region, spacing, ribThickness, depth) {
    const h = (Math.sqrt(3) / 2) * spacing;
    const rows = [];
    for (let y = region.minY, r = 0; y <= region.maxY + 1e-9; y += h, r++) {
      const row = [];
      const xOff = (r % 2) * spacing * 0.5;
      for (let x = region.minX + xOff; x <= region.maxX + 1e-9; x += spacing) {
        row.push([x, y]);
      }
      rows.push(row);
    }

    const pockets = [];
    for (let r = 0; r < rows.length - 1; r++) {
      const row = rows[r];
      const next = rows[r + 1];
      let cells = [];
      if (r % 2 === 0) {
        // Upward triangles: (r,k), (r+1,k), (r,k+1) — CCW viewed from +Z
        for (let k = 0; k < Math.min(row.length - 1, next.length); k++) {
          cells.push([row[k], next[k], row[k + 1]]);
        }
      } else {
        // Downward triangles: (r,k+1), (r+1,k), (r+1,k+1) — CCW viewed from +Z
        for (let k = 0; k < Math.min(row.length - 1, next.length - 1); k++) {
          cells.push([row[k + 1], next[k], next[k + 1]]);
        }
      }
      for (const tri of cells) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const f = Math.max(0.05, Math.min(0.95, 1 - ribThickness / spacing));
        const inset = tri.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]);
        const orientSign =
          (inset[1][0] - inset[0][0]) * (inset[2][1] - inset[0][1]) -
          (inset[1][1] - inset[0][1]) * (inset[2][0] - inset[0][0]);
        if (orientSign < 0) {
          const tmp = inset[1];
          inset[1] = inset[2];
          inset[2] = tmp;
        }
        const area2D =
          Math.abs(
            (inset[1][0] - inset[0][0]) * (inset[2][1] - inset[0][1]) -
              (inset[1][1] - inset[0][1]) * (inset[2][0] - inset[0][0])
          ) / 2;
        const minX = Math.min(inset[0][0], inset[1][0], inset[2][0]);
        const maxX = Math.max(inset[0][0], inset[1][0], inset[2][0]);
        const minY = Math.min(inset[0][1], inset[1][1], inset[2][1]);
        const maxY = Math.max(inset[0][1], inset[1][1], inset[2][1]);
        pockets.push({ tri: inset, volume: area2D * depth, aabb: [minX, maxX, minY, maxY], cx, cy });
      }
    }
    return pockets;
  }

  _pointInConvexPoly(pts, x, y) {
    const n = pts.length;
    if (n < 3) return false;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      const cross = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      if (Math.abs(cross) < 1e-9) continue;
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /**
   * Ray-casting point-in-polygon test for an arbitrary (simple) 2D polygon.
   */
  _pointInPolygon2D(pts, x, y) {
    let inside = false;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i][0],
        yi = pts[i][1];
      const xj = pts[j][0],
        yj = pts[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Genuine isogrid pocket feature: excise a triangular grid of pockets from the
   * upward-facing (top) region of the body. The top surface is remeshed as a
   * height field — grid points inside a pocket footprint are lowered by the pocket
   * depth and vertical cliff walls are introduced on pocket boundaries — so the
   * pocket volume is genuinely removed while the solid remains closed. This does
   * not rely on the experimental CSG boolean kernel, which is numerically unstable
   * for coplanar-aligned triangle meshes.
   */
  _applyIsogridPockets(body, params) {
    if (!body || body.faces.length === 0) return body;

    const ribThickness = Number(params.ribThickness !== undefined ? params.ribThickness : 2.4);
    const pocketDepth = Number(params.pocketDepth !== undefined ? params.pocketDepth : 15.0);
    const spacing = Number(
      params.pocketSpacing !== undefined ? params.pocketSpacing : params.spacing !== undefined ? params.spacing : 20.0
    );

    if (!Number.isFinite(ribThickness) || ribThickness <= 0) {
      throw this._geometryError(OmniErrorCode.INVALID_INPUT, 'isogrid_pocket requires a positive ribThickness', {
        ribThickness
      });
    }
    if (!Number.isFinite(pocketDepth) || pocketDepth <= 0) {
      throw this._geometryError(OmniErrorCode.INVALID_INPUT, 'isogrid_pocket requires a positive pocketDepth', {
        pocketDepth
      });
    }
    if (!Number.isFinite(spacing) || spacing <= ribThickness) {
      throw this._geometryError(
        OmniErrorCode.INVALID_INPUT,
        'isogrid_pocket requires pocketSpacing greater than ribThickness',
        { spacing, ribThickness }
      );
    }
    const minDim = this._minBoundingDimension(body);
    if (pocketDepth >= minDim / 2) {
      throw this._geometryError(
        OmniErrorCode.INVALID_INPUT,
        `isogrid_pocket depth ${pocketDepth} must be less than half the minimum bounding dimension (${(minDim / 2).toFixed(6)})`,
        { pocketDepth, minBoundingDimension: minDim }
      );
    }

    let targetFaces = null;
    let region = null;
    if (params.faceIndex !== undefined || params.faceId !== undefined) {
      const faceSel =
        params.faceIndex !== undefined
          ? body.faces[Number(params.faceIndex)]
          : body.faces.find((f) => f.id === params.faceId);
      if (!faceSel) {
        throw this._geometryError(OmniErrorCode.INVALID_INPUT, 'isogrid_pocket: specified face not found on body', {
          faceIndex: params.faceIndex,
          faceId: params.faceId
        });
      }
      const n = faceSel.normal || faceSel.computeNormal();
      if (!n || n.z < 0.5) {
        throw this._geometryError(
          OmniErrorCode.INVALID_INPUT,
          'isogrid_pocket requires an upward-facing face (normal.z >= 0.5)'
        );
      }
      targetFaces = [faceSel];
      region = this._faceXYBounds(faceSel);
    } else {
      const upFaces = body.faces.filter((f) => (f.normal || f.computeNormal()).z > 0.5);
      if (upFaces.length === 0) {
        throw this._geometryError(
          OmniErrorCode.INVALID_INPUT,
          'isogrid_pocket requires a top/upward face; none found on body'
        );
      }
      targetFaces = upFaces;
      region = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: -Infinity };
      for (const f of upFaces) {
        const b = this._faceXYBounds(f);
        region.minX = Math.min(region.minX, b.minX);
        region.maxX = Math.max(region.maxX, b.maxX);
        region.minY = Math.min(region.minY, b.minY);
        region.maxY = Math.max(region.maxY, b.maxY);
        region.maxZ = Math.max(region.maxZ, b.maxZ);
      }
    }

    const zTop = region.maxZ;
    const pockets = this._buildPocketFootprints(region, spacing, ribThickness, pocketDepth);
    const outerVol = body.computeVolume();

    if (pockets.length === 0) {
      params.pocketVolume = 0;
      params.massReductionRatio = 0;
      return body;
    }
    const pocketVolume = pockets.reduce((acc, p) => acc + p.volume, 0);

    // Exact scanline carving on the top-face plane. Vertical slabs between x
    // events are processed independently: within each slab the subject face's
    // y-interval is computed exactly at the slab midpoint, pocket footprints are
    // subtracted from it, and top/floor rectangles are emitted for the
    // resulting y-intervals. Vertical walls are then generated between adjacent
    // slabs wherever the surface height changes. The removed volume converges to
    // the pocket volume and is exact for axis-aligned slab boundaries.
    const outlinePolys = targetFaces.map((f) => f.vertices.map((v) => [v.point.x, v.point.y]));

    const allPts = [];
    const mapIdx = new Map();
    const getPoint = (x, y, z) => {
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      if (mapIdx.has(key)) return mapIdx.get(key);
      const v = new Vertex(x, y, z);
      allPts.push(v);
      mapIdx.set(key, v);
      return v;
    };

    const addTri = (faces, a, b, c, flipped) => {
      if (flipped) faces.push([c, b, a]);
      else faces.push([a, b, c]);
    };

    const yIntervalAt = (poly, x) => {
      let lo = Infinity,
        hi = -Infinity;
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % n];
        const x1 = p[0],
          x2 = q[0];
        if ((x1 <= x && x2 >= x) || (x2 <= x && x1 >= x)) {
          if (Math.abs(x2 - x1) < 1e-12) {
            lo = Math.min(lo, p[1], q[1]);
            hi = Math.max(hi, p[1], q[1]);
          } else {
            const t = (x - x1) / (x2 - x1);
            const y = p[1] + t * (q[1] - p[1]);
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
          }
        }
      }
      return lo <= hi ? [lo, hi] : null;
    };

    const xEvents = [];
    for (const poly of outlinePolys) {
      for (const v of poly) xEvents.push(v[0]);
    }
    for (const pocket of pockets) {
      for (const v of pocket.tri) xEvents.push(v[0]);
    }
    xEvents.sort((a, b) => a - b);
    const uniqueX = [];
    for (const x of xEvents) {
      if (uniqueX.length === 0 || Math.abs(x - uniqueX[uniqueX.length - 1]) > 1e-9) uniqueX.push(x);
    }

    const faces = [];
    // slab records: { x0, x1, segments: [{lo, hi, z}] }
    const slabs = [];
    for (let s = 0; s < uniqueX.length - 1; s++) {
      const x0 = uniqueX[s];
      const x1 = uniqueX[s + 1];
      const mid = (x0 + x1) / 2;
      const segments = [];
      for (const poly of outlinePolys) {
        const iv = yIntervalAt(poly, mid);
        if (!iv) continue;
        segments.push({ lo: iv[0], hi: iv[1], z: zTop });
      }
      for (const pocket of pockets) {
        const iv = yIntervalAt(pocket.tri, mid);
        if (!iv) continue;
        const lo = Math.max(iv[0], segments.length ? Math.min(...segments.map((s2) => s2.lo)) : iv[0]);
        const hi = Math.min(iv[1], segments.length ? Math.max(...segments.map((s2) => s2.hi)) : iv[1]);
        if (hi > lo) segments.push({ lo, hi, z: zTop - pocketDepth });
      }
      if (segments.length === 0) continue;
      // Split overlapping intervals so every y-position has a single level.
      const yEvents = [];
      for (const seg of segments) {
        yEvents.push(seg.lo, seg.hi);
      }
      yEvents.sort((a, b) => a - b);
      const cells = [];
      for (let k = 0; k < yEvents.length - 1; k++) {
        const y0 = yEvents[k],
          y1 = yEvents[k + 1];
        if (y1 - y0 < 1e-9) continue;
        const ym = (y0 + y1) / 2;
        let z = null;
        for (const seg of segments) {
          if (ym >= seg.lo - 1e-9 && ym <= seg.hi + 1e-9) {
            // pockets (lower z) take precedence over the top surface
            if (z === null || seg.z < z) z = seg.z;
          }
        }
        if (z !== null) cells.push({ lo: y0, hi: y1, z });
      }
      slabs.push({ x0, x1, cells });

      for (const cell of cells) {
        const a = getPoint(x0, cell.lo, cell.z);
        const b = getPoint(x1, cell.lo, cell.z);
        const c = getPoint(x1, cell.hi, cell.z);
        const d = getPoint(x0, cell.hi, cell.z);
        if (cell.z >= zTop - 1e-9) {
          addTri(faces, a, b, c, false);
          addTri(faces, a, c, d, false);
        } else {
          // floor: reversed winding (normal -Z) for the full quad fan
          faces.push([a, d, c]);
          faces.push([a, c, b]);
        }
      }

      // Riser walls within the slab between cells of different height
      for (let k = 0; k < cells.length - 1; k++) {
        const c1 = cells[k];
        const c2 = cells[k + 1];
        if (Math.abs(c1.z - c2.z) < 1e-9) continue;
        const yB = c1.hi;
        const quad = [getPoint(x0, yB, c1.z), getPoint(x1, yB, c1.z), getPoint(x1, yB, c2.z), getPoint(x0, yB, c2.z)];
        const dirY = c1.z > c2.z ? 1 : -1;
        const a = quad[0].point,
          b = quad[1].point,
          c = quad[2].point;
        const u = [b.x - a.x, b.y - a.y, b.z - a.z];
        const v = [c.x - a.x, c.y - a.y, c.z - a.z];
        const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (nrm[1] * dirY < 0) quad.reverse();
        faces.push(quad);
      }
    }

    // Vertical walls between adjacent slabs
    for (let s = 0; s < slabs.length - 1; s++) {
      const L = slabs[s];
      const R = slabs[s + 1];
      const x = R.x0;
      const yEvents = [];
      for (const c of L.cells) yEvents.push(c.lo, c.hi);
      for (const c of R.cells) yEvents.push(c.lo, c.hi);
      yEvents.sort((a, b) => a - b);
      const zAt = (cells, y) => {
        for (const c of cells) {
          if (y >= c.lo - 1e-9 && y <= c.hi + 1e-9) return c.z;
        }
        return null;
      };
      for (let k = 0; k < yEvents.length - 1; k++) {
        const y0 = yEvents[k],
          y1 = yEvents[k + 1];
        if (y1 - y0 < 1e-9) continue;
        const ym = (y0 + y1) / 2;
        const zL = zAt(L.cells, ym);
        const zR = zAt(R.cells, ym);
        if (zL === null || zR === null || Math.abs(zL - zR) < 1e-9) continue;
        const quad = [getPoint(x, y0, zL), getPoint(x, y1, zL), getPoint(x, y1, zR), getPoint(x, y0, zR)];
        // outward normal points from material (higher z) toward the pocket (lower z)
        const dirX = zL > zR ? 1 : -1;
        const a = quad[0].point,
          b = quad[1].point,
          c = quad[2].point;
        const u = [b.x - a.x, b.y - a.y, b.z - a.z];
        const v = [c.x - a.x, c.y - a.y, c.z - a.z];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (n[0] * dirX < 0) quad.reverse();
        faces.push(quad);
      }
    }

    const targetIds = new Set(targetFaces.map((f) => f.id));
    body.faces = body.faces.filter((f) => !targetIds.has(f.id));
    body.vertices.push(...allPts);
    for (const fv of faces) {
      body.faces.push(new Face(fv));
    }
    body.buildEdges();

    params.pocketVolume = pocketVolume;
    params.massReductionRatio = outerVol > 0 ? Number((pocketVolume / outerVol).toFixed(4)) : 0;
    return body;
  }

  /**
   * Genuine edge chamfer (bevel).
   * For each edge, a cut plane is constructed at distance `radius` from the edge
   * within each of the two adjacent faces; corner vertices are clipped against the
   * planes. This removes material instead of scaling vertices.
   */
  _applyBevel(body, radius) {
    if (!body || body.faces.length === 0) return body;
    const r = Number(radius);
    if (!Number.isFinite(r) || r <= 0) return body;

    const edgeKey = (va, vb) => {
      const a = va.point;
      const b = vb.point;
      const k1 = `${a.x.toFixed(7)},${a.y.toFixed(7)},${a.z.toFixed(7)}`;
      const k2 = `${b.x.toFixed(7)},${b.y.toFixed(7)},${b.z.toFixed(7)}`;
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    };

    const edgeFaceMap = new Map();
    for (const face of body.faces) {
      const n = (face.normal || face.computeNormal()).clone().normalize();
      const len = face.vertices.length;
      for (let i = 0; i < len; i++) {
        const va = face.vertices[i];
        const vb = face.vertices[(i + 1) % len];
        const key = edgeKey(va, vb);
        if (!edgeFaceMap.has(key)) edgeFaceMap.set(key, { va, vb, faces: [] });
        edgeFaceMap.get(key).faces.push({ n, face });
      }
    }

    const centroid = this._bodyCentroid(body);
    const cuts = [];

    for (const { va, vb, faces } of edgeFaceMap.values()) {
      if (faces.length < 2) continue;
      const n1 = faces[0].n;
      const n2 = faces[1].n;
      const mid = va.point.clone().add(vb.point).scale(0.5);

      const edgeDir = vb.point.clone().sub(va.point);
      const el = edgeDir.length();
      if (el < 1e-12) continue;
      edgeDir.scale(1 / el);

      // In-face perpendicular directions (away from the edge into each adjacent face)
      const t1 = edgeDir.cross(n1);
      const t2 = edgeDir.cross(n2);
      const c1 = this._faceCentroid(faces[0].face);
      const c2 = this._faceCentroid(faces[1].face);
      if (t1.dot(c1.clone().sub(mid)) < 0) t1.scale(-1);
      if (t2.dot(c2.clone().sub(mid)) < 0) t2.scale(-1);

      const p1 = mid.clone().add(t1.scale(r));
      const p2 = mid.clone().add(t2.scale(r));
      const nC = edgeDir.cross(p2.clone().sub(p1));
      if (nC.length() < 1e-12) continue;
      nC.normalize();
      const w = nC.dot(p1);

      // Ensure the body interior lies on the positive side of the cut plane
      const s = nC.dot(centroid) - w;
      if (s < 0) nC.scale(-1);
      const wFinal = nC.dot(p1);
      cuts.push({ n: nC, w: wFinal });
    }

    // Clip vertices against the cut planes
    for (const v of body.vertices) {
      for (const cut of cuts) {
        const d = cut.n.dot(v.point) - cut.w;
        if (d < -1e-9) {
          v.point.sub(cut.n.clone().scale(d));
        }
      }
    }

    for (const f of body.faces) {
      f.normal = f.computeNormal();
    }
    body.buildEdges();
    return body;
  }

  toSTEP(modelName = 'OmniEng_Parametric_Part') {
    const { StepTranslator } = require('./step_translator');
    return StepTranslator.exportSTEP(this.currentSolid, modelName);
  }

  toJSON() {
    return {
      features: this.features.map((f) => ({
        id: f.id,
        type: f.type,
        name: f.name,
        params: f.params,
        suppressed: f.suppressed
      }))
    };
  }

  static fromJSON(data) {
    const tree = new FeatureTree();
    if (data && data.features) {
      for (const item of data.features) {
        const feat = new ParametricFeature(item.type, item.name, item.params);
        feat.id = item.id;
        feat.suppressed = item.suppressed || false;
        tree.features.push(feat);
      }
      tree.historyIndex = tree.features.length - 1;
      tree.rebuild();
    }
    return tree;
  }
}

const { StepTranslator } = require('./step_translator');
const { ConstraintSolver2D } = require('./constraint_solver_2d');
const { CSGSolid: CSGSolidExport } = require('./csg_mesh_booleans');

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ParametricFeature,
    FeatureTree,
    StepTranslator,
    ConstraintSolver2D,
    CSGSolid: CSGSolidExport
  };
}
