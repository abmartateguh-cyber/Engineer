/**
 * OmniEng Edge Blender: Rolling-Ball Fillet & Chamfer Generation Engine
 * Experimental implementation: Siemens NX / CATIA B-Rep Edge Blending & Chamfering
 *
 * Implements spherical envelope rolling-ball offset fillets, variable radius blends,
 * and asymmetric planar chamfers on 3D B-Rep solids and meshes.
 *
 * Experimental implementation; release maturity and provenance are not established.
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
  static applyFillet(solid, targetEdge, radius, options = {}) {
    if (radius <= 0) {
      throw new Error(`Fillet radius must be strictly positive, got ${radius}`);
    }

    const { subdivisions = 8 } = options;
    if (!solid.edges || solid.edges.length === 0) {
      if (typeof solid.buildEdges === 'function') solid.buildEdges();
    }
    const edge = typeof targetEdge === 'string'
      ? solid.edges.find(e => e.id === targetEdge)
      : targetEdge;

    if (!edge) {
      throw new Error(`Target edge not found in solid: ${targetEdge}`);
    }

    // Step 1: Locate the two adjacent faces sharing this edge
    const adjacentFaces = EdgeBlender._findAdjacentFaces(solid, edge);
    if (adjacentFaces.length < 2) {
      throw new Error(`Edge must be shared by at least 2 faces to blend, found ${adjacentFaces.length}`);
    }

    const f1 = adjacentFaces[0];
    const f2 = adjacentFaces[1];

    const n1 = f1.normal || f1.computeNormal();
    const n2 = f2.normal || f2.computeNormal();

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
          vF1.clone().scale(Math.cos(currentAngle))
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

    if (!solid.edges || solid.edges.length === 0) {
      if (typeof solid.buildEdges === 'function') solid.buildEdges();
    }
    const edge = typeof targetEdge === 'string'
      ? solid.edges.find(e => e.id === targetEdge)
      : targetEdge;

    if (!edge) {
      throw new Error(`Target edge not found: ${targetEdge}`);
    }

    const adjacentFaces = EdgeBlender._findAdjacentFaces(solid, edge);
    if (adjacentFaces.length < 2) {
      throw new Error('Edge requires 2 adjacent faces for chamfer');
    }

    const f1 = adjacentFaces[0];
    const f2 = adjacentFaces[1];

    const n1 = f1.normal || f1.computeNormal();
    const n2 = f2.normal || f2.computeNormal();

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
    const bevelNormal = chamferFace1.normal || chamferFace1.computeNormal();

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
    const pStart = edge.start.point;
    const pEnd = edge.end.point;

    for (const face of solid.faces) {
      let hasStart = false;
      let hasEnd = false;
      for (const v of face.vertices) {
        if (v.point.distanceTo(pStart) < 1e-4) hasStart = true;
        if (v.point.distanceTo(pEnd) < 1e-4) hasEnd = true;
      }
      if (hasStart && hasEnd) {
        adj.push(face);
      }
    }
    return adj;
  }

  static _faceCentroid(face) {
    if (face.vertices.length === 0) return new Vector3(0, 0, 0);
    const sum = new Vector3(0, 0, 0);
    for (const v of face.vertices) {
      sum.add(v.point);
    }
    return sum.scale(1 / face.vertices.length);
  }
}

module.exports = { EdgeBlender };
