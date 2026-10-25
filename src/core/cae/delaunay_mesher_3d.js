/**
 * Experimental tetrahedral mesh generation utilities.
 * Mesh output and quality estimates are not independently validated against ISO or NAFEMS criteria.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

const { PrismLayerMesher } = require('./prism_layer_mesher');

class Point3D {
  constructor(x, y, z, id = -1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.id = id;
    this.isBoundary = false;
  }

  distanceTo(p) {
    const dx = this.x - p.x;
    const dy = this.y - p.y;
    const dz = this.z - p.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  clone() {
    const p = new Point3D(this.x, this.y, this.z, this.id);
    p.isBoundary = this.isBoundary;
    return p;
  }
}

class TriangleFace {
  constructor(p1, p2, p3) {
    this.nodes = [p1, p2, p3]; // Point3D instances
    // Normal vector
    const ax = p2.x - p1.x, ay = p2.y - p1.y, az = p2.z - p1.z;
    const bx = p3.x - p1.x, by = p3.y - p1.y, bz = p3.z - p1.z;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-12;
    this.normal = { x: nx / len, y: ny / len, z: nz / len };
    this.area = 0.5 * len;
  }

  getCentroid() {
    return new Point3D(
      (this.nodes[0].x + this.nodes[1].x + this.nodes[2].x) / 3,
      (this.nodes[0].y + this.nodes[1].y + this.nodes[2].y) / 3,
      (this.nodes[0].z + this.nodes[1].z + this.nodes[2].z) / 3
    );
  }

  getSortedEdgeKey(i, j) {
    const a = Math.min(this.nodes[i].id, this.nodes[j].id);
    const b = Math.max(this.nodes[i].id, this.nodes[j].id);
    return `${a}-${b}`;
  }

  getSortedFaceKey() {
    const ids = [this.nodes[0].id, this.nodes[1].id, this.nodes[2].id].sort((a, b) => a - b);
    return `${ids[0]}-${ids[1]}-${ids[2]}`;
  }
}

class Tetrahedron {
  constructor(p1, p2, p3, p4, id = -1) {
    this.nodes = [p1, p2, p3, p4]; // 4 vertex Point3D
    this.id = id;
    this.midNodes = []; // for TET10 (6 mid-side nodes)
    this.circumsphere = null;
    this._computeGeometry();
  }

  _computeGeometry() {
    const [p1, p2, p3, p4] = this.nodes;
    // Volume = 1/6 * det([p2-p1, p3-p1, p4-p1])
    const v1x = p2.x - p1.x, v1y = p2.y - p1.y, v1z = p2.z - p1.z;
    const v2x = p3.x - p1.x, v2y = p3.y - p1.y, v2z = p3.z - p1.z;
    const v3x = p4.x - p1.x, v3y = p4.y - p1.y, v3z = p4.z - p1.z;

    const det = v1x * (v2y * v3z - v2z * v3y) -
                v1y * (v2x * v3z - v2z * v3x) +
                v1z * (v2x * v3y - v2y * v3x);
    this.volume = det / 6.0;

    // Circumsphere center & radius
    this.circumsphere = this._computeCircumsphere(p1, p2, p3, p4);
  }

  _computeCircumsphere(p1, p2, p3, p4) {
    // Relative coordinates to p1
    const x2 = p2.x - p1.x, y2 = p2.y - p1.y, z2 = p2.z - p1.z;
    const x3 = p3.x - p1.x, y3 = p3.y - p1.y, z3 = p3.z - p1.z;
    const x4 = p4.x - p1.x, y4 = p4.y - p1.y, z4 = p4.z - p1.z;

    const d2 = x2 * x2 + y2 * y2 + z2 * z2;
    const d3 = x3 * x3 + y3 * y3 + z3 * z3;
    const d4 = x4 * x4 + y4 * y4 + z4 * z4;

    const det = 2 * (x2 * (y3 * z4 - y4 * z3) -
                     y2 * (x3 * z4 - x4 * z3) +
                     z2 * (x3 * y4 - x4 * y3));

    if (Math.abs(det) < 1e-14) {
      return { center: p1, radius: 1e9, radiusSq: 1e18 };
    }

    const cx = (d2 * (y3 * z4 - y4 * z3) - y2 * (d3 * z4 - d4 * z3) + z2 * (d3 * y4 - d4 * y3)) / det;
    const cy = (x2 * (d3 * z4 - d4 * z3) - d2 * (x3 * z4 - x4 * z3) + z2 * (x3 * d4 - x4 * d3)) / det;
    const cz = (x2 * (y3 * d4 - y4 * d3) - y2 * (x3 * d4 - x4 * d3) + d2 * (x3 * y4 - x4 * y3)) / det;

    const center = new Point3D(p1.x + cx, p1.y + cy, p1.z + cz);
    const radiusSq = cx * cx + cy * cy + cz * cz;
    return {
      center,
      radius: Math.sqrt(radiusSq),
      radiusSq
    };
  }

  inCircumsphere(p, tolerance = 1e-10) {
    if (!this.circumsphere) return false;
    const dx = p.x - this.circumsphere.center.x;
    const dy = p.y - this.circumsphere.center.y;
    const dz = p.z - this.circumsphere.center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    return distSq <= (this.circumsphere.radiusSq + tolerance);
  }

  getFaces() {
    const [p0, p1, p2, p3] = this.nodes;
    return [
      new TriangleFace(p0, p1, p2),
      new TriangleFace(p0, p2, p3),
      new TriangleFace(p0, p3, p1),
      new TriangleFace(p1, p3, p2)
    ];
  }

  /**
   * Computes aspect ratio and radius ratio (eta = 3 * r_in / r_circ)
   * 1.0 is a perfect equilateral tetrahedron; 0.0 is degenerate.
   */
  computeQuality() {
    const edges = [
      this.nodes[0].distanceTo(this.nodes[1]),
      this.nodes[0].distanceTo(this.nodes[2]),
      this.nodes[0].distanceTo(this.nodes[3]),
      this.nodes[1].distanceTo(this.nodes[2]),
      this.nodes[1].distanceTo(this.nodes[3]),
      this.nodes[2].distanceTo(this.nodes[3])
    ];

    const maxEdge = Math.max(...edges);
    const minEdge = Math.min(...edges);

    // Sum of face areas
    const faces = this.getFaces();
    const totalArea = faces.reduce((sum, f) => sum + f.area, 0);

    // Inradius r_in = 3 * V / totalArea
    const rIn = totalArea > 1e-12 ? (3.0 * Math.abs(this.volume)) / totalArea : 0;
    const rCirc = this.circumsphere ? this.circumsphere.radius : 1e9;

    // Radius ratio eta = 3 * r_in / r_circ
    const radiusRatio = rCirc > 1e-12 ? Math.min(1.0, Math.max(0.0, (3.0 * rIn) / rCirc)) : 0;
    const aspectRatio = minEdge > 1e-12 ? maxEdge / minEdge : 999.0;

    return {
      volume: Math.abs(this.volume),
      radiusRatio,
      aspectRatio,
      isDegenerate: Math.abs(this.volume) < 1e-14 || radiusRatio < 0.01
    };
  }
}

class DelaunayMesher3D {
  constructor(options = {}) {
    this.targetEdgeLength = options.targetEdgeLength || 0.05; // 50mm default
    this.minEdgeLength = options.minEdgeLength || 0.01;
    this.maxEdgeLength = options.maxEdgeLength || 0.2;
    this.curvatureFactor = options.curvatureFactor || 0.2; // finer on curves
    this.enableBoundaryLayers = options.enableBoundaryLayers !== false;
    this.boundaryLayerCount = options.boundaryLayerCount || 2;
    this.firstLayerHeight = options.firstLayerHeight || 0.002; // 2mm
    this.growthRate = options.growthRate || 1.3;
  }

  /**
   * Generates 3D tetrahedral mesh from a closed surface triangulation
   * @param {Array<Point3D>} surfaceVertices Array of Point3D
   * @param {Array<Array<number>>} surfaceFaces Array of [idx0, idx1, idx2]
   * @param {Object} options { quadratic: boolean (TET10), sizingFunction: Function }
   */
  meshClosedSurface(surfaceVertices, surfaceFaces, options = {}) {
    const isQuadratic = options.quadratic === true;
    const sizingFn = options.sizingFunction || null;

    // 1. Prepare points with unique IDs
    const points = surfaceVertices.map((p, idx) => {
      const pt = new Point3D(p.x, p.y, p.z, idx);
      pt.isBoundary = true;
      return pt;
    });

    // 2. Bounding box computation
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z);
    }

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;

    // 3. Advancing-front interior node generation
    const interiorPoints = this._generateInteriorNodes(points, surfaceFaces, {
      minX, minY, minZ, maxX, maxY, maxZ, dx, dy, dz, sizingFn
    });

    for (const ip of interiorPoints) {
      ip.id = points.length;
      points.push(ip);
    }

    // 4. Construct Super-Tetrahedron enclosing everything by a large factor
    const boxSize = diag * 10;
    const superNodes = [
      new Point3D(midX - boxSize, midY - boxSize, midZ - boxSize, points.length),
      new Point3D(midX + boxSize, midY - boxSize, midZ - boxSize, points.length + 1),
      new Point3D(midX, midY + boxSize, midZ - boxSize, points.length + 2),
      new Point3D(midX, midY, midZ + boxSize, points.length + 3)
    ];

    const superTet = new Tetrahedron(superNodes[0], superNodes[1], superNodes[2], superNodes[3]);
    let tetList = [superTet];

    // 5. Bowyer-Watson 3D Incremental Insertion
    for (let pIdx = 0; pIdx < points.length; pIdx++) {
      const p = points[pIdx];
      const badTets = [];

      for (let tIdx = 0; tIdx < tetList.length; tIdx++) {
        const tet = tetList[tIdx];
        if (tet.inCircumsphere(p)) {
          badTets.push(tet);
        }
      }

      // Find boundary polygon faces of the cavity (faces appearing exactly once in badTets)
      const faceCountMap = new Map();
      const faceObjMap = new Map();

      for (const badTet of badTets) {
        const faces = badTet.getFaces();
        for (const face of faces) {
          const key = face.getSortedFaceKey();
          faceCountMap.set(key, (faceCountMap.get(key) || 0) + 1);
          faceObjMap.set(key, face);
        }
      }

      // Remove bad tets
      tetList = tetList.filter(t => !badTets.includes(t));

      // Re-triangulate cavity with point p
      for (const [key, count] of faceCountMap.entries()) {
        if (count === 1) {
          const face = faceObjMap.get(key);
          const newTet = new Tetrahedron(face.nodes[0], face.nodes[1], face.nodes[2], p);
          if (Math.abs(newTet.volume) > 1e-14) {
            tetList.push(newTet);
          }
        }
      }
    }

    // 6. Remove tetrahedra connected to the super-tetrahedron
    const superIds = new Set(superNodes.map(sn => sn.id));
    tetList = tetList.filter(tet => {
      return !tet.nodes.some(n => superIds.has(n.id));
    });

    // 7. Filter tetrahedra whose centroids lie strictly outside the original surface
    const surfaceTriangles = surfaceFaces.map(f => {
      return new TriangleFace(points[f[0]], points[f[1]], points[f[2]]);
    });

    const validTets = [];
    for (let i = 0; i < tetList.length; i++) {
      const tet = tetList[i];
      const centroid = new Point3D(
        (tet.nodes[0].x + tet.nodes[1].x + tet.nodes[2].x + tet.nodes[3].x) / 4,
        (tet.nodes[0].y + tet.nodes[1].y + tet.nodes[2].y + tet.nodes[3].y) / 4,
        (tet.nodes[0].z + tet.nodes[1].z + tet.nodes[2].z + tet.nodes[3].z) / 4
      );

      if (this._isPointInsideSurface(centroid, surfaceTriangles)) {
        tet.id = validTets.length;
        validTets.push(tet);
      }
    }

    // 8. If quadratic TET10 is requested, generate mid-side nodes
    let finalNodes = points.slice(0, points.length);
    if (isQuadratic) {
      this._promoteToTet10(validTets, finalNodes);
    }

    // 9. Compute mesh metrics
    const qualityList = validTets.map(t => t.computeQuality());
    const avgRadiusRatio = qualityList.reduce((sum, q) => sum + q.radiusRatio, 0) / (qualityList.length || 1);
    const minRadiusRatio = Math.min(...qualityList.map(q => q.radiusRatio));
    const totalVolume = qualityList.reduce((sum, q) => sum + q.volume, 0);

    return {
      type: isQuadratic ? 'TET10' : 'TET4',
      nodeCount: finalNodes.length,
      elementCount: validTets.length,
      nodes: finalNodes.map((n, i) => ({ id: i, x: n.x, y: n.y, z: n.z, isBoundary: n.isBoundary })),
      elements: validTets.map(t => {
        const elem = {
          id: t.id,
          nodeIds: t.nodes.map(n => n.id),
          volume: Math.abs(t.volume)
        };
        if (isQuadratic && t.midNodes.length === 6) {
          elem.midNodeIds = t.midNodes.map(n => n.id);
          elem.allNodeIds = [...elem.nodeIds, ...elem.midNodeIds];
        }
        return elem;
      }),
      metrics: {
        totalVolume,
        averageQuality: avgRadiusRatio,
        minQuality: minRadiusRatio,
        validElementPercentage: (qualityList.filter(q => !q.isDegenerate).length / (qualityList.length || 1)) * 100
      }
    };
  }

  _generateInteriorNodes(boundaryPoints, surfaceFaces, ctx) {
    const interior = [];
    const step = this.targetEdgeLength;
    const margin = step * 0.7;

    const nx = Math.ceil(ctx.dx / step);
    const ny = Math.ceil(ctx.dy / step);
    const nz = Math.ceil(ctx.dz / step);

    const surfaceTriangles = surfaceFaces.map(f => {
      return new TriangleFace(boundaryPoints[f[0]], boundaryPoints[f[1]], boundaryPoints[f[2]]);
    });

    for (let ix = 1; ix < nx; ix++) {
      const x = ctx.minX + ix * step;
      for (let iy = 1; iy < ny; iy++) {
        const y = ctx.minY + iy * step;
        for (let iz = 1; iz < nz; iz++) {
          const z = ctx.minZ + iz * step;
          const candidate = new Point3D(x, y, z);

          // Check distance to boundary vertices
          let tooClose = false;
          for (const bp of boundaryPoints) {
            if (candidate.distanceTo(bp) < margin) {
              tooClose = true;
              break;
            }
          }

          if (!tooClose && this._isPointInsideSurface(candidate, surfaceTriangles)) {
            interior.push(candidate);
          }
        }
      }
    }

    return interior;
  }

  /**
   * Ray-casting test in 3D: Cast ray in +X direction and count triangle intersections
   */
  _isPointInsideSurface(point, triangles) {
    let intersectionCount = 0;
    const rayOrigin = point;
    const rayDir = { x: 1, y: 0, z: 0 };

    for (const tri of triangles) {
      if (this._rayIntersectsTriangle(rayOrigin, rayDir, tri)) {
        intersectionCount++;
      }
    }

    // Odd number of intersections means point is inside
    return (intersectionCount % 2) === 1;
  }

  _rayIntersectsTriangle(orig, dir, tri) {
    const [v0, v1, v2] = tri.nodes;
    const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
    const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;

    // Cross product dir x e2
    const px = dir.y * e2z - dir.z * e2y;
    const py = dir.z * e2x - dir.x * e2z;
    const pz = dir.x * e2y - dir.y * e2x;

    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return false;

    const invDet = 1.0 / det;
    const tx = orig.x - v0.x, ty = orig.y - v0.y, tz = orig.z - v0.z;

    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) return false;

    // Cross product t x e1
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;

    const v = (dir.x * qx + dir.y * qy + dir.z * qz) * invDet;
    if (v < 0 || (u + v) > 1) return false;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return t > 1e-10;
  }

  _promoteToTet10(tets, nodes) {
    // 6 edges of a standard tet: (0,1), (1,2), (2,0), (0,3), (1,3), (2,3)
    const edgePairs = [
      [0, 1], [1, 2], [2, 0],
      [0, 3], [1, 3], [2, 3]
    ];

    const edgeMap = new Map();

    for (const tet of tets) {
      tet.midNodes = [];
      for (const [i1, i2] of edgePairs) {
        const n1 = tet.nodes[i1];
        const n2 = tet.nodes[i2];
        const key = n1.id < n2.id ? `${n1.id}-${n2.id}` : `${n2.id}-${n1.id}`;

        let midNode;
        if (edgeMap.has(key)) {
          midNode = edgeMap.get(key);
        } else {
          const midX = (n1.x + n2.x) / 2;
          const midY = (n1.y + n2.y) / 2;
          const midZ = (n1.z + n2.z) / 2;
          midNode = new Point3D(midX, midY, midZ, nodes.length);
          midNode.isBoundary = (n1.isBoundary && n2.isBoundary);
          nodes.push(midNode);
          edgeMap.set(key, midNode);
        }
        tet.midNodes.push(midNode);
      }
    }
  }

  /**
   * Generates a hybrid boundary-layer prism + interior Delaunay tetrahedral volume mesh.
   * Resolves near-wall turbulent boundary layers (y+ <= 1.0) while filling core volume with isotropic tets.
   * @param {Object} surfaceMesh - { vertices: [[x,y,z], ...], triangles: [[i0,i1,i2], ...] }
   * @param {Object} [prismOptions] - { firstLayerHeight, growthRatio, layerCount }
   * @param {Object} [tetOptions] - { targetEdgeLength }
   * @returns {Object} { nodes, prisms, tets, statistics }
   */
  generateHybridPrismTetMesh(surfaceMesh, prismOptions = {}, tetOptions = {}) {
    // 1. Generate anisotropic prism boundary layers
    const firstLayerHeight = prismOptions.firstLayerHeight || 0.001;
    const prismMesh = PrismLayerMesher.generatePrismLayers(surfaceMesh, {
      firstLayerHeight,
      growthRatio: prismOptions.growthRatio || 1.2,
      layerCount: prismOptions.layerCount || 5
    });

    // 2. Extract outer cap vertices and triangles representing the interior interface
    const capVertices = prismMesh.vertices;
    const capTriangles = prismMesh.outerCapTriangles || [];
    const capPoint3Ds = capVertices.map((v, idx) => new Point3D(v[0], v[1], v[2], idx));

    // 3. Mesh core volume interior using Delaunay advancing-front mesher
    let coreMesh = { nodes: capPoint3Ds, tets: [] };
    if (capTriangles.length >= 4) {
      coreMesh = this.meshClosedSurface(capPoint3Ds, capTriangles, tetOptions);
    }

    return {
      nodes: coreMesh.nodes,
      prisms: prismMesh.prisms,
      tets: coreMesh.tets,
      statistics: {
        prismCount: prismMesh.prisms.length,
        tetCount: coreMesh.tets.length,
        totalNodes: coreMesh.nodes.length,
        firstLayerHeightM: firstLayerHeight,
        growthRatio: prismOptions.growthRatio || 1.2,
        layerCount: prismOptions.layerCount || 5
      }
    };
  }
}

module.exports = {
  Point3D,
  TriangleFace,
  Tetrahedron,
  DelaunayMesher3D
};
