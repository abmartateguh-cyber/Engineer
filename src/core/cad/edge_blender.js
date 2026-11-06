/**
 * Experimental mesh edge-blend and planar chamfer helpers. Output topology,
 * geometric continuity, and behavior on general B-rep solids have not been
 * independently validated.
 */

const { Vector3 } = require('../math/linear_algebra');
const { SolidBody, Vertex, Edge, Face } = require('./brep_topology');

class EdgeBlender {
  /**
   * Applies a constant-radius rolling-ball fillet to an edge on a SolidBody.
   * @param {SolidBody} solid - The target solid body
   * @param {string|Edge} targetEdge - Edge ID or Edge instance to fillet
   * @param {number} radius - Fillet radius (must be positive)
   * @param {Object} [options]
   * @param {number} [options.subdivisions=8] - Radial cross-section angular segments
   * @returns {SolidBody} The modified solid body with blend faces
   */
  static _readPoint(value, label) {
    const coordinates = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? [value.x, value.y, value.z]
        : null;
    if (
      !coordinates ||
      coordinates.length !== 3 ||
      !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ) {
      throw new TypeError(`${label} must contain exactly three finite numeric coordinates.`);
    }
    return value instanceof Vector3 ? value.clone() : new Vector3(...coordinates);
  }

  static _hydrateSolid(solid) {
    if (!solid || typeof solid !== 'object' || Array.isArray(solid)) {
      throw new TypeError('Edge blending requires a solid object.');
    }

    if (!(solid instanceof SolidBody)) {
      if (!Array.isArray(solid.vertices) || !Array.isArray(solid.faces) || solid.faces.length === 0) {
        throw new TypeError('Serialized edge-blend solids require vertex and face arrays.');
      }

      const hydrated = new SolidBody(
        typeof solid.name === 'string' && solid.name.trim() ? solid.name : 'HydratedSolid'
      );
      if (typeof solid.id === 'string') hydrated.id = solid.id;
      const vertexMap = new Map();

      for (const [index, sourceVertex] of solid.vertices.entries()) {
        if (!sourceVertex || typeof sourceVertex !== 'object') {
          throw new TypeError(`Serialized vertex ${index} must be an object.`);
        }
        const point = EdgeBlender._readPoint(sourceVertex.point ?? sourceVertex, `Serialized vertex ${index}`);
        const vertex = new Vertex(point.x, point.y, point.z);
        if (sourceVertex.id !== undefined) {
          if (vertexMap.has(sourceVertex.id)) throw new TypeError(`Duplicate serialized vertex id: ${sourceVertex.id}`);
          vertex.id = sourceVertex.id;
          vertexMap.set(sourceVertex.id, vertex);
        }
        hydrated.vertices.push(vertex);
      }

      const resolveFaceVertex = (reference, faceIndex, vertexIndex) => {
        const referenceId = typeof reference === 'string' || typeof reference === 'number' ? reference : reference?.id;
        if (referenceId !== undefined) {
          const match = vertexMap.get(referenceId);
          if (!match) throw new TypeError(`Face ${faceIndex} references unknown vertex id: ${referenceId}`);
          return match;
        }
        const point = EdgeBlender._readPoint(reference?.point ?? reference, `Face ${faceIndex} vertex ${vertexIndex}`);
        const vertex = new Vertex(point.x, point.y, point.z);
        hydrated.vertices.push(vertex);
        return vertex;
      };

      for (const [faceIndex, sourceFace] of solid.faces.entries()) {
        if (!sourceFace || !Array.isArray(sourceFace.vertices) || sourceFace.vertices.length < 3) {
          throw new TypeError(`Serialized face ${faceIndex} must contain at least three vertices.`);
        }
        const faceVertices = sourceFace.vertices.map((reference, vertexIndex) =>
          resolveFaceVertex(reference, faceIndex, vertexIndex)
        );
        const normal =
          sourceFace.normal === undefined || sourceFace.normal === null
            ? null
            : EdgeBlender._readPoint(sourceFace.normal, `Serialized face ${faceIndex} normal`);
        const face = new Face(faceVertices, normal);
        if (sourceFace.id !== undefined) face.id = sourceFace.id;
        if (sourceFace.material && typeof sourceFace.material === 'object') face.material = { ...sourceFace.material };
        hydrated.faces.push(face);
      }

      if (solid.edges !== undefined && !Array.isArray(solid.edges)) {
        throw new TypeError('Serialized edges must be an array when supplied.');
      }
      if (Array.isArray(solid.edges) && solid.edges.length > 0) {
        const resolveEndpoint = (endpoint, edgeIndex, label) => {
          const referenceId = typeof endpoint === 'string' || typeof endpoint === 'number' ? endpoint : endpoint?.id;
          if (referenceId !== undefined) {
            const match = vertexMap.get(referenceId);
            if (!match)
              throw new TypeError(`Serialized edge ${edgeIndex} references unknown vertex id: ${referenceId}`);
            return match;
          }
          const point = EdgeBlender._readPoint(endpoint?.point ?? endpoint, `Serialized edge ${edgeIndex} ${label}`);
          return new Vertex(point.x, point.y, point.z);
        };
        for (const [edgeIndex, sourceEdge] of solid.edges.entries()) {
          if (!sourceEdge || sourceEdge.start === undefined || sourceEdge.end === undefined) {
            throw new TypeError(`Serialized edge ${edgeIndex} requires start and end vertices.`);
          }
          const edge = new Edge(
            resolveEndpoint(sourceEdge.start, edgeIndex, 'start'),
            resolveEndpoint(sourceEdge.end, edgeIndex, 'end')
          );
          if (sourceEdge.id !== undefined) edge.id = sourceEdge.id;
          hydrated.edges.push(edge);
        }
      } else {
        hydrated.buildEdges();
      }
      return hydrated;
    }

    if (!Array.isArray(solid.vertices) || !Array.isArray(solid.faces)) {
      throw new TypeError('SolidBody vertex and face collections must be arrays.');
    }
    for (const [index, vertex] of solid.vertices.entries()) {
      if (!vertex || !vertex.point) throw new TypeError(`Solid vertex ${index} is missing its point.`);
      vertex.point = EdgeBlender._readPoint(vertex.point, `Solid vertex ${index}`);
    }
    for (const [faceIndex, face] of solid.faces.entries()) {
      if (!face || !Array.isArray(face.vertices) || face.vertices.length < 3) {
        throw new TypeError(`Solid face ${faceIndex} must contain at least three vertices.`);
      }
      for (const [vertexIndex, vertex] of face.vertices.entries()) {
        if (!vertex || !vertex.point)
          throw new TypeError(`Solid face ${faceIndex} vertex ${vertexIndex} is missing its point.`);
        vertex.point = EdgeBlender._readPoint(vertex.point, `Solid face ${faceIndex} vertex ${vertexIndex}`);
      }
      if (face.normal !== undefined && face.normal !== null) {
        face.normal = EdgeBlender._readPoint(face.normal, `Solid face ${faceIndex} normal`);
      }
    }
    if (!Array.isArray(solid.edges)) throw new TypeError('Solid edge collection must be an array.');
    for (const [edgeIndex, edge] of solid.edges.entries()) {
      if (!edge?.start?.point || !edge?.end?.point) {
        throw new TypeError(`Solid edge ${edgeIndex} requires start and end points.`);
      }
      edge.start.point = EdgeBlender._readPoint(edge.start.point, `Solid edge ${edgeIndex} start`);
      edge.end.point = EdgeBlender._readPoint(edge.end.point, `Solid edge ${edgeIndex} end`);
    }
    if (solid.edges.length === 0) solid.buildEdges();
    return solid;
  }

  static applyFillet(solid, targetEdge, radius, options = {}) {
    if (radius <= 0) {
      throw new Error(`Fillet radius must be strictly positive, got ${radius}`);
    }

    const { subdivisions = 8 } = options;
    solid = EdgeBlender._hydrateSolid(solid);
    if (!solid.edges || solid.edges.length === 0) {
      if (typeof solid.buildEdges === 'function') solid.buildEdges();
    }
    const edge =
      typeof targetEdge === 'string'
        ? solid.edges.find((e) => e.id === targetEdge)
        : solid.edges.find((e) => e.id === targetEdge?.id) || targetEdge;

    if (!edge) {
      throw new Error(`Target edge not found in solid: ${targetEdge}`);
    }

    if (edge.start && !(edge.start.point instanceof Vector3)) {
      edge.start.point = new Vector3(edge.start.point.x || 0, edge.start.point.y || 0, edge.start.point.z || 0);
    }
    if (edge.end && !(edge.end.point instanceof Vector3)) {
      edge.end.point = new Vector3(edge.end.point.x || 0, edge.end.point.y || 0, edge.end.point.z || 0);
    }

    // Step 1: Locate the two adjacent faces sharing this edge
    const adjacentFaces = EdgeBlender._findAdjacentFaces(solid, edge);
    if (adjacentFaces.length < 2) {
      throw new Error(`Edge must be shared by at least 2 faces to blend, found ${adjacentFaces.length}`);
    }

    const f1 = adjacentFaces[0];
    const f2 = adjacentFaces[1];

    const n1 =
      f1.normal instanceof Vector3
        ? f1.normal
        : typeof f1.computeNormal === 'function'
          ? f1.computeNormal()
          : new Vector3(f1.normal?.x || 0, f1.normal?.y || 0, f1.normal?.z || 1);
    const n2 =
      f2.normal instanceof Vector3
        ? f2.normal
        : typeof f2.computeNormal === 'function'
          ? f2.computeNormal()
          : new Vector3(f2.normal?.x || 0, f2.normal?.y || 0, f2.normal?.z || 1);

    // Edge direction vector
    const edgeDir = edge.end.point.clone().sub(edge.start.point);
    const edgeLength = edgeDir.length();
    if (edgeLength < 1e-9) {
      throw new Error('Degenerate zero-length edge cannot be filleted');
    }
    const tHat = edgeDir.clone().normalize();

    // Angle theta between adjacent face normals
    const cosTheta = Math.max(-1, Math.min(1, n1.dot(n2)));
    const theta = Math.acos(cosTheta); // Radians between normals

    // Setback distance from the edge along the face planes
    // For a 90 deg corner, theta = pi/2, setback = R * tan(pi/4) = R
    const halfAngle = (Math.PI - theta) / 2;
    const setback = radius * Math.tan(halfAngle > 1e-4 ? halfAngle : Math.PI / 4);

    // Lateral directions on each face pointing away from the edge
    const d1 = n1.cross(tHat).normalize();
    const d2 = tHat.cross(n2).normalize();

    // Verify outward direction relative to adjacent face centers
    const f1Center = EdgeBlender._faceCentroid(f1);
    if (f1Center.clone().sub(edge.start.point).dot(d1) < 0) {
      d1.scale(-1);
    }
    const f2Center = EdgeBlender._faceCentroid(f2);
    if (f2Center.clone().sub(edge.start.point).dot(d2) < 0) {
      d2.scale(-1);
    }

    // Blend strip longitudinal stations (along the edge)
    const pStart = edge.start.point.clone();
    const pEnd = edge.end.point.clone();

    // Compute rolling-ball center trajectory (Spine curve)
    // Ball center is offset from edge by radius / sin((pi-theta)/2)
    const bisector = n1.clone().add(n2).normalize();
    const centerOffsetDist = radius / Math.sin(Math.max(1e-4, halfAngle));
    const spineStart = pStart.clone().sub(bisector.clone().scale(centerOffsetDist));
    const spineEnd = pEnd.clone().sub(bisector.clone().scale(centerOffsetDist));

    // Construct the cylindrical / toroidal rolling-ball blend patch
    const blendVertices = [];
    const blendFaces = [];

    // Longitudinal samples along edge
    const numStations = 2; // Linear edge: start and end
    const stations = [0, 1];

    for (let s = 0; s < numStations; s++) {
      const u = stations[s];
      const pEdge = pStart.clone().add(edgeDir.clone().scale(u));
      const pSpine = spineStart.clone().add(spineEnd.clone().sub(spineStart).scale(u));

      // Contact points on face 1 and face 2
      const ptF1 = pEdge.clone().add(d1.clone().scale(setback));
      const ptF2 = pEdge.clone().add(d2.clone().scale(setback));

      // Circular arc interpolation between ptF1 and ptF2 around pSpine
      const vF1 = ptF1.clone().sub(pSpine).normalize();
      const vF2 = ptF2.clone().sub(pSpine).normalize();
      const arcAngle = Math.acos(Math.max(-1, Math.min(1, vF1.dot(vF2))));

      const arcVerts = [];
      for (let k = 0; k <= subdivisions; k++) {
        const frac = k / subdivisions;
        const currentAngle = frac * arcAngle;
        // Slerp or Rodrigues rotation of vF1 towards vF2 around tHat
        const ptArc = pSpine.clone().add(
          vF1
            .clone()
            .scale(Math.cos(currentAngle))
            .add(tHat.cross(vF1).scale(Math.sin(currentAngle)))
            .scale(radius)
        );
        const vert = new Vertex(ptArc.x, ptArc.y, ptArc.z);
        solid.vertices.push(vert);
        arcVerts.push(vert);
      }
      blendVertices.push(arcVerts);
    }

    // Build quad/tri faces connecting the arc profiles across the edge
    for (let k = 0; k < subdivisions; k++) {
      const v00 = blendVertices[0][k];
      const v01 = blendVertices[0][k + 1];
      const v10 = blendVertices[1][k];
      const v11 = blendVertices[1][k + 1];

      // Two triangles per quad
      const fA = new Face([v00, v10, v11]);
      const fB = new Face([v00, v11, v01]);
      fA.material = { color: '#38bdf8', fillet: true };
      fB.material = { color: '#38bdf8', fillet: true };

      solid.faces.push(fA);
      solid.faces.push(fB);
      blendFaces.push(fA, fB);
    }

    return {
      solid,
      radius,
      setback,
      blendFacesCount: blendFaces.length,
      filletSurfaceArea: blendFaces.reduce((sum, f) => sum + f.area(), 0)
    };
  }

  static blendEdges(solid, edgeIndices, radius, options = {}) {
    let result = solid;
    const indices = Array.isArray(edgeIndices) ? edgeIndices : [edgeIndices];
    for (const idx of indices) {
      const targetEdge = typeof idx === 'number' ? result.edges?.[idx] : idx;
      if (targetEdge) {
        const res = EdgeBlender.applyFillet(result, targetEdge, radius, options);
        result = res?.solid || res || result;
      }
    }
    return result;
  }

  /**
   * Applies an asymmetric or 45-degree planar chamfer to an edge on a SolidBody.
   * @param {SolidBody} solid - The target solid body
   * @param {string|Edge} targetEdge - Edge ID or Edge instance to chamfer
   * @param {number} distance1 - Setback distance along Face 1
   * @param {number} [distance2=distance1] - Setback distance along Face 2 (defaults to symmetric)
   * @returns {Object} Resulting chamfer metadata and updated solid
   */
  static applyChamfer(solid, targetEdge, distance1, distance2 = null) {
    if (distance1 <= 0) {
      throw new Error(`Chamfer distance must be positive, got ${distance1}`);
    }
    const d1Dist = distance1;
    const d2Dist = distance2 !== null && distance2 > 0 ? distance2 : distance1;

    solid = EdgeBlender._hydrateSolid(solid);
    if (!solid.edges || solid.edges.length === 0) {
      if (typeof solid.buildEdges === 'function') solid.buildEdges();
    }
    const edge =
      typeof targetEdge === 'string'
        ? solid.edges.find((e) => e.id === targetEdge)
        : solid.edges.find((e) => e.id === targetEdge?.id) || targetEdge;

    if (!edge) {
      throw new Error(`Target edge not found: ${targetEdge}`);
    }

    if (edge.start && !(edge.start.point instanceof Vector3)) {
      edge.start.point = new Vector3(edge.start.point.x || 0, edge.start.point.y || 0, edge.start.point.z || 0);
    }
    if (edge.end && !(edge.end.point instanceof Vector3)) {
      edge.end.point = new Vector3(edge.end.point.x || 0, edge.end.point.y || 0, edge.end.point.z || 0);
    }

    const adjacentFaces = EdgeBlender._findAdjacentFaces(solid, edge);
    if (adjacentFaces.length < 2) {
      throw new Error('Edge requires 2 adjacent faces for chamfer');
    }

    const f1 = adjacentFaces[0];
    const f2 = adjacentFaces[1];

    const n1 =
      f1.normal instanceof Vector3
        ? f1.normal
        : typeof f1.computeNormal === 'function'
          ? f1.computeNormal()
          : new Vector3(f1.normal?.x || 0, f1.normal?.y || 0, f1.normal?.z || 1);
    const n2 =
      f2.normal instanceof Vector3
        ? f2.normal
        : typeof f2.computeNormal === 'function'
          ? f2.computeNormal()
          : new Vector3(f2.normal?.x || 0, f2.normal?.y || 0, f2.normal?.z || 1);

    const edgeDir = edge.end.point.clone().sub(edge.start.point);
    const tHat = edgeDir.clone().normalize();

    let d1 = n1.cross(tHat).normalize();
    let d2 = tHat.cross(n2).normalize();

    const f1Center = EdgeBlender._faceCentroid(f1);
    if (f1Center.clone().sub(edge.start.point).dot(d1) < 0) d1.scale(-1);

    const f2Center = EdgeBlender._faceCentroid(f2);
    if (f2Center.clone().sub(edge.start.point).dot(d2) < 0) d2.scale(-1);

    const pStart = edge.start.point.clone();
    const pEnd = edge.end.point.clone();

    // 4 Corner setback vertices for the planar chamfer bevel face
    const c1_start = pStart.clone().add(d1.clone().scale(d1Dist));
    const c2_start = pStart.clone().add(d2.clone().scale(d2Dist));
    const c1_end = pEnd.clone().add(d1.clone().scale(d1Dist));
    const c2_end = pEnd.clone().add(d2.clone().scale(d2Dist));

    const v1_s = new Vertex(c1_start.x, c1_start.y, c1_start.z);
    const v2_s = new Vertex(c2_start.x, c2_start.y, c2_start.z);
    const v1_e = new Vertex(c1_end.x, c1_end.y, c1_end.z);
    const v2_e = new Vertex(c2_end.x, c2_end.y, c2_end.z);

    solid.vertices.push(v1_s, v2_s, v1_e, v2_e);

    // Create the planar bevel face bridging the two setback rails
    const chamferFace1 = new Face([v1_s, v1_e, v2_e]);
    const chamferFace2 = new Face([v1_s, v2_e, v2_s]);
    chamferFace1.material = { color: '#93c5fd', chamfer: true };
    chamferFace2.material = { color: '#93c5fd', chamfer: true };

    solid.faces.push(chamferFace1, chamferFace2);

    const bevelArea = chamferFace1.area() + chamferFace2.area();
    const bevelNormal = chamferFace1.normal instanceof Vector3 ? chamferFace1.normal : chamferFace1.computeNormal();

    return {
      solid,
      distance1: d1Dist,
      distance2: d2Dist,
      bevelArea,
      bevelNormal,
      chamferFaces: [chamferFace1, chamferFace2]
    };
  }

  static _findAdjacentFaces(solid, edge) {
    const adj = [];
    const pStart = edge.start?.point;
    const pEnd = edge.end?.point;
    if (!pStart || !pEnd) return adj;

    const dist = (p1, p2) =>
      Math.hypot((p1.x || 0) - (p2.x || 0), (p1.y || 0) - (p2.y || 0), (p1.z || 0) - (p2.z || 0));

    for (const face of solid.faces || []) {
      let hasStart = false;
      let hasEnd = false;
      for (const v of face.vertices || []) {
        if (v.point && dist(v.point, pStart) < 1e-4) hasStart = true;
        if (v.point && dist(v.point, pEnd) < 1e-4) hasEnd = true;
      }
      if (hasStart && hasEnd) {
        adj.push(face);
      }
    }
    return adj;
  }

  static _faceCentroid(face) {
    if (!face || !face.vertices || face.vertices.length === 0) return new Vector3(0, 0, 0);
    const sum = new Vector3(0, 0, 0);
    for (const v of face.vertices) {
      const p = v.point || { x: 0, y: 0, z: 0 };
      sum.x += p.x || 0;
      sum.y += p.y || 0;
      sum.z += p.z || 0;
    }
    return sum.scale(1 / face.vertices.length);
  }
}

module.exports = { EdgeBlender };
