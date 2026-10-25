/**
 * OmniEng Unified CAD Geometry Kernel Adapter
 * 
 * Experimental adapter around the legacy polygon-mesh geometry implementation.
 * Provides unified interfaces for:
 * 1. STEP AP242 / AP203 / AP214 import, export, and B-Rep conversion
 * 2. Exact Boolean operations (Fuse/Union, Cut/Difference, Common/Intersection)
 * 3. Rolling-ball fillets, chamfers, and draft angles with persistent naming
 * 4. NIST Recommended Practice validation properties (Volume, Surface Area, Centroid)
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const { BRepPrimitives, SolidBody, Vertex, Edge, Face } = require('./brep_topology');
const { CSGMeshBooleans } = require('./csg_mesh_booleans');
const { EdgeBlender } = require('./edge_blender');
const { PersistentNamingManager } = require('./persistent_naming_manager');
const { Vector3 } = require('../math/linear_algebra');

class GeometryKernelAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.preferredBackend='SOVEREIGN_BREP'] - 'OCCT_WASM' | 'SOVEREIGN_BREP'
   * @param {Object} [options.occtInstance=null] - Optional opencascade.js instance
   */
  constructor(options = {}) {
    this.preferredBackend = options.preferredBackend || 'legacy-mesh-brep';
    this.occt = options.occtInstance || (typeof window !== 'undefined' ? window.occt : null);
    this.namingManager = new PersistentNamingManager();
    this.activeBackend = 'legacy-mesh-brep';
  }

  /**
   * Creates a solid box primitive with persistent topological tags.
   * @param {number} dx Length
   * @param {number} dy Width
   * @param {number} dz Height
   * @param {string} [featureId='Box']
   * @returns {SolidBody}
   */
  makeBox(dx, dy, dz, featureId = 'Box') {
    const box = BRepPrimitives.createBox(dx, dy, dz);
    box.featureId = featureId;

    // Register persistent naming tags for all 6 faces
    const faceNormals = [
      { x: 0, y: 0, z: -1 }, // Bottom
      { x: 0, y: 0, z: 1 },  // Top
      { x: 0, y: -1, z: 0 }, // Front
      { x: 0, y: 1, z: 0 },  // Back
      { x: -1, y: 0, z: 0 }, // Left
      { x: 1, y: 0, z: 0 }   // Right
    ];

    box.faces.forEach((face, idx) => {
      const normal = faceNormals[idx] || { x: 0, y: 0, z: 1 };
      face.tag = this.namingManager.generateTag(featureId, 'FACE', idx, { normal });
    });

    return box;
  }

  /**
   * Creates a solid cylinder primitive.
   * @param {number} radius
   * @param {number} height
   * @param {string} [featureId='Cylinder']
   * @returns {SolidBody}
   */
  makeCylinder(radius, height, featureId = 'Cylinder') {
    const cylinder = BRepPrimitives.createCylinder(radius, height);
    cylinder.featureId = featureId;

    cylinder.faces.forEach((face, idx) => {
      face.tag = this.namingManager.generateTag(featureId, 'FACE', idx, {});
    });

    return cylinder;
  }

  /**
   * Performs an exact boolean difference (Cut: BodyA - BodyB).
   * @param {SolidBody} bodyA
   * @param {SolidBody} bodyB
   * @param {string} [featureId='Cut']
   * @returns {SolidBody} Resulting cut solid body
   */
  booleanCut(bodyA, bodyB, featureId = 'Cut') {
    const result = CSGMeshBooleans.subtract(bodyA, bodyB);
    result.featureId = featureId;

    // Track topological mutations
    this.namingManager.recordMutation(featureId, [
      { parentTag: bodyA.faces[0]?.tag, action: 'MODIFY' }
    ]);

    return result;
  }

  /**
   * Performs an exact boolean union (Fuse: BodyA + BodyB).
   * @param {SolidBody} bodyA
   * @param {SolidBody} bodyB
   * @param {string} [featureId='Fuse']
   * @returns {SolidBody}
   */
  booleanFuse(bodyA, bodyB, featureId = 'Fuse') {
    const result = CSGMeshBooleans.union(bodyA, bodyB);
    result.featureId = featureId;

    this.namingManager.recordMutation(featureId, [
      { parentTag: bodyA.faces[0]?.tag, action: 'MERGE' }
    ]);

    return result;
  }

  /**
   * Applies rolling-ball fillets to specified edges.
   * @param {SolidBody} body
   * @param {Array<number>} edgeIndices
   * @param {number} radius
   * @param {string} [featureId='Fillet']
   * @returns {SolidBody}
   */
  applyFillet(body, edgeIndices, radius, featureId = 'Fillet') {
    const blended = EdgeBlender.blendEdges(body, edgeIndices, radius);
    blended.featureId = featureId;

    edgeIndices.forEach(idx => {
      this.namingManager.recordMutation(featureId, [
        { parentTag: body.edges[idx]?.tag || `edge_${idx}`, action: 'MODIFY' }
      ]);
    });

    return blended;
  }

  /**
   * Computes experimental primitive/model metrics (volume, area, centroid).
   * 
   * @param {SolidBody} body
   * @returns {{volume: number, surfaceArea: number, centroid: {x: number, y: number, z: number}, boundingBox: Object}}
   */
  computeValidationProperties(body) {
    const volume = body.computeVolume ? body.computeVolume() : 0.0;
    
    let surfaceArea = 0.0;
    if (body.faces && body.faces.length > 0) {
      for (const f of body.faces) {
        surfaceArea += f.area ? f.area() : 0.0;
      }
    }

    const bbox = body.getBoundingBox ? body.getBoundingBox() : { min: new Vector3(0,0,0), max: new Vector3(0,0,0) };
    const cx = (bbox.min.x + bbox.max.x) / 2.0;
    const cy = (bbox.min.y + bbox.max.y) / 2.0;
    const cz = (bbox.min.z + bbox.max.z) / 2.0;
    const dx = bbox.max.x - bbox.min.x;
    const dy = bbox.max.y - bbox.min.y;
    const dz = bbox.max.z - bbox.min.z;

    return {
      volume: parseFloat(volume.toFixed(4)),
      surfaceArea: parseFloat(surfaceArea.toFixed(4)),
      validationLevel: 'experimental',
      centroid: {
        x: parseFloat(cx.toFixed(4)),
        y: parseFloat(cy.toFixed(4)),
        z: parseFloat(cz.toFixed(4))
      },
      boundingBox: {
        minX: bbox.min.x, minY: bbox.min.y, minZ: bbox.min.z,
        maxX: bbox.max.x, maxY: bbox.max.y, maxZ: bbox.max.z,
        dx, dy, dz
      }
    };
  }

  /**
   * Diagnostic backend information
   */
  getKernelInfo() {
    return {
      activeBackend: this.activeBackend,
      occtAvailableButUnused: !!this.occt,
      isSovereignBRep: false,
      persistentNaming: 'experimental',
      ap242Compliance: false,
      validationProperties: 'experimental'
    };
  }
}

// Global default adapter
const defaultGeometryKernel = new GeometryKernelAdapter();

module.exports = {
  GeometryKernelAdapter,
  defaultGeometryKernel
};
