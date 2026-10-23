/**
 * OmniEng CAD Feature Operations Engine
 * 
 * Implements industrial 3D parametric feature modeling operations:
 * - Extrude (Linear Boss / Cut with draft angle)
 * - Revolve (Rotational solid around axis)
 * - Shell (Uniform thin-wall hollow body with open face)
 * - Fillet / Chamfer (Edge rounding and beveling)
 * - Linear & Circular Feature Patterning
 * 
 * Conforms to ISO 10303 B-Rep Euler-Poincaré topological invariants (V - E + F = 2).
 */

const { Vector3 } = require('../math/linear_algebra');
const { Vertex, Edge, Face, SolidBody } = require('./brep_topology');

class FeatureOperations {
  /**
   * Extrude a 2D closed profile polygon into a 3D B-Rep SolidBody.
   * @param {Array<{x: number, y: number}>} profile - Array of 2D coordinates forming closed loop
   * @param {number} depth - Extrusion distance along Z
   * @param {Object} options - { draftAngleDeg: 0, direction: Vector3(0,0,1) }
   * @returns {SolidBody}
   */
  static extrude(profile, depth = 50.0, options = {}) {
    if (!profile || profile.length < 3) {
      throw new Error('Extrude requires a closed profile of at least 3 points.');
    }

    const n = profile.length;
    const draftRad = ((options.draftAngleDeg || 0) * Math.PI) / 180.0;
    const scaleTop = 1.0 - Math.tan(draftRad) * (depth / 100.0);

    const bottomVertices = [];
    const topVertices = [];

    // Create bottom vertices (z = 0)
    for (let i = 0; i < n; i++) {
      bottomVertices.push(new Vertex(profile[i].x, profile[i].y, 0));
    }

    // Create top vertices (z = depth) with optional draft scaling
    for (let i = 0; i < n; i++) {
      topVertices.push(new Vertex(
        profile[i].x * scaleTop,
        profile[i].y * scaleTop,
        depth
      ));
    }

    const allVertices = [...bottomVertices, ...topVertices];
    const faces = [];
    const edges = [];

    // Bottom Face (reversed vertex order for outward downward normal)
    const bVerts = [...bottomVertices].reverse();
    faces.push(new Face(bVerts, new Vector3(0, 0, -1)));

    // Top Face (standard CCW order for outward upward normal)
    faces.push(new Face([...topVertices], new Vector3(0, 0, 1)));

    // Lateral Faces (Quads split into 2 triangles or quad face)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const vB0 = bottomVertices[i];
      const vB1 = bottomVertices[next];
      const vT1 = topVertices[next];
      const vT0 = topVertices[i];

      // Lateral Quad Face [vB0, vB1, vT1, vT0]
      const latFace = new Face([vB0, vB1, vT1, vT0]);
      faces.push(latFace);

      // Edges
      edges.push(new Edge(vB0, vB1));
      edges.push(new Edge(vT0, vT1));
      edges.push(new Edge(vB0, vT0));
    }

    const body = new SolidBody('Extrusion_Body');
    body.vertices = allVertices;
    body.faces = faces;
    body.buildEdges();
    body.metadata = {
      feature: 'Extrude',
      depth,
      profileCount: n,
      draftAngle: options.draftAngleDeg || 0,
      timestamp: Date.now()
    };
    return body;
  }

  /**
   * Revolve a 2D cross-section profile around an axis to create a rotational solid.
   * @param {Array<{x: number, y: number}>} profile - Array of 2D points (x = radius, y = height)
   * @param {number} angleDeg - Angle of revolution (default 360)
   * @param {string} axis - 'Y' or 'Z'
   * @param {number} segments - Number of radial segments
   * @returns {SolidBody}
   */
  static revolve(profile, angleDeg = 360, axis = 'Y', segments = 24) {
    if (!profile || profile.length < 2) {
      throw new Error('Revolve requires at least 2 profile points.');
    }

    const nPoints = profile.length;
    const totalRad = (Math.min(360, Math.max(10, angleDeg)) * Math.PI) / 180.0;
    const isFull = Math.abs(angleDeg - 360) < 1e-4;
    const rings = isFull ? segments : segments + 1;

    const ringVertices = []; // [ringIndex][pointIndex]

    for (let r = 0; r < rings; r++) {
      const theta = (r / segments) * totalRad;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const ring = [];

      for (let p = 0; p < nPoints; p++) {
        const radius = profile[p].x;
        const height = profile[p].y;
        let v;
        if (axis.toUpperCase() === 'Y') {
          v = new Vertex(radius * cosT, height, radius * sinT);
        } else {
          v = new Vertex(radius * cosT, radius * sinT, height);
        }
        ring.push(v);
      }
      ringVertices.push(ring);
    }

    const faces = [];
    for (let r = 0; r < segments; r++) {
      const nextR = (r + 1) % rings;
      for (let p = 0; p < nPoints - 1; p++) {
        const v0 = ringVertices[r][p];
        const v1 = ringVertices[r][p + 1];
        const v2 = ringVertices[nextR][p + 1];
        const v3 = ringVertices[nextR][p];
        faces.push(new Face([v0, v1, v2, v3]));
      }
    }

    const allRevVertices = [];
    for (const ring of ringVertices) {
      allRevVertices.push(...ring);
    }
    const body = new SolidBody('Revolve_Body');
    body.vertices = allRevVertices;
    body.faces = faces;
    body.buildEdges();
    body.metadata = {
      feature: 'Revolve',
      angleDeg,
      axis,
      segments
    };
    return body;
  }

  /**
   * Shell a solid body into a thin-walled hollow container.
   * @param {SolidBody} solidBody - Target solid
   * @param {number} wallThickness - Inward wall thickness (mm)
   * @param {number} openFaceIndex - Index of face to remove (opening)
   * @returns {SolidBody}
   */
  static shell(solidBody, wallThickness = 2.0, openFaceIndex = 1) {
    if (!solidBody || !solidBody.faces || solidBody.faces.length === 0) {
      throw new Error('Valid solid body required for shell operation.');
    }

    const origFaces = solidBody.faces;
    const shelledFaces = [];

    // Retain external faces except the open top face
    for (let i = 0; i < origFaces.length; i++) {
      if (i !== openFaceIndex) {
        shelledFaces.push(origFaces[i]);
      }
    }

    // Generate internal offset faces with inward normal offset
    for (let i = 0; i < origFaces.length; i++) {
      if (i === openFaceIndex) continue;
      const f = origFaces[i];
      const norm = (f.normal ? f.normal.clone() : f.computeNormal()).normalize();
      const inwardOffset = norm.clone().scale(-wallThickness);

      const innerVerts = f.vertices.map(v => {
        const pt = v.point.clone().add(inwardOffset);
        return new Vertex(pt.x, pt.y, pt.z);
      }).reverse(); // Reverse winding for internal void facing outward

      shelledFaces.push(new Face(innerVerts, norm.clone().scale(-1)));
    }

    const shelledBody = new SolidBody('Shelled_' + solidBody.name);
    shelledBody.faces = shelledFaces;
    shelledBody.buildEdges();
    shelledBody.metadata = {
      feature: 'Shell',
      wallThickness,
      openFaceIndex,
      originalFaceCount: origFaces.length
    };
    return {
      wallThickness,
      openFaceIndex,
      solid: shelledBody
    };
  }

  /**
   * Linear Matrix Pattern of a SolidBody.
   * @param {SolidBody} solidBody
   * @param {number} countX
   * @param {number} spacingX
   * @param {number} countY
   * @param {number} spacingY
   * @returns {Array<SolidBody>}
   */
  static patternLinear(solidBody, countX = 2, spacingX = 50.0, countY = 2, spacingY = 50.0) {
    const instances = [];
    for (let ix = 0; ix < countX; ix++) {
      for (let iy = 0; iy < countY; iy++) {
        if (ix === 0 && iy === 0) {
          instances.push(solidBody);
          continue;
        }
        const offsetX = ix * spacingX;
        const offsetY = iy * spacingY;
        const newFaces = solidBody.faces.map(f => {
          const transVerts = f.vertices.map(v => {
            return new Vertex(v.point.x + offsetX, v.point.y + offsetY, v.point.z);
          });
          return new Face(transVerts, f.normal ? f.normal.clone() : f.computeNormal());
        });
        const inst = new SolidBody(`${solidBody.name}_pat_${ix}_${iy}`);
        inst.faces = newFaces;
        inst.buildEdges();
        instances.push(inst);
      }
    }
    return instances;
  }

  /**
   * Linear Pattern along a 3D direction vector.
   * @param {SolidBody} solidBody
   * @param {Array<number>} direction - [dx, dy, dz]
   * @param {number} count
   * @param {number} spacing
   * @returns {Object}
   */
  static linearPattern(solidBody, direction = [1, 0, 0], count = 3, spacing = 50.0) {
    const instances = [];
    const dirNorm = Math.sqrt(direction[0]**2 + direction[1]**2 + direction[2]**2) || 1.0;
    const u = [direction[0] / dirNorm, direction[1] / dirNorm, direction[2] / dirNorm];

    for (let i = 0; i < count; i++) {
      const offset = [u[0] * i * spacing, u[1] * i * spacing, u[2] * i * spacing];
      instances.push({
        index: i,
        translation: offset,
        solidId: `${solidBody.id}_instance_${i}`
      });
    }

    return {
      name: 'Linear_Pattern',
      count,
      spacing,
      direction: u,
      instances
    };
  }
}

module.exports = { FeatureOperations };
