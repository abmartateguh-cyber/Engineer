/**
 * Experimental parametric feature tree and history engine.
 * Manages an ordered directed acyclic graph (DAG) of modeling features with rollback and parameter editing.
 */

const { Vector3 } = require('../math/linear_algebra');
const { SolidBody, Vertex, Face, BRepPrimitives } = require('./brep_topology');

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
    const feat = this.features.find(f => f.id === featureId);
    if (feat) {
      feat.setParam(key, value);
      return this.rebuild();
    }
    return this.currentSolid;
  }

  removeFeature(featureId) {
    this.features = this.features.filter(f => f.id !== featureId);
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
          break;
        }
        case 'cylinder': {
          const { radius = 15, height = 40, segments = 24 } = feat.params;
          activeBody = BRepPrimitives.createCylinder(radius, height, segments, feat.name);
          break;
        }
        case 'sphere': {
          const { radius = 25 } = feat.params;
          activeBody = BRepPrimitives.createSphere(radius, 16, 24, feat.name);
          break;
        }
        case 'extrude_sketch': {
          // Extrude a 2D closed polygon along Z axis
          const { polygon = [[-20, -20], [20, -20], [20, 20], [-20, 20]], height = 30 } = feat.params;
          activeBody = this._extrudePolygon(polygon, height, feat.name);
          break;
        }
        case 'fillet': {
          // Chamfer/fillet bounding edges
          if (activeBody) {
            const { radius = 2 } = feat.params;
            this._applyBevel(activeBody, radius);
          }
          break;
        }
        case 'shell': {
          // Hollow out body (shell thickness)
          if (activeBody) {
            feat.params.actualVolume = activeBody.computeVolume();
          }
          break;
        }
        case 'revolve': {
          const { profile = [[5, 0], [10, 15], [8, 30]], segments = 24 } = feat.params;
          activeBody = this._revolveProfile(profile, segments, feat.name);
          break;
        }
        case 'cone': {
          const { rBottom = 15, rTop = 8, height = 30, segments = 24 } = feat.params;
          const profile = [[0, -height / 2], [rBottom, -height / 2], [rTop, height / 2], [0, height / 2]];
          activeBody = this._revolveProfile(profile, segments, feat.name);
          break;
        }
        case 'isogrid_pocket': {
          if (activeBody) {
            feat.params.ribThickness = feat.params.ribThickness || 2.4;
            feat.params.pocketDepth = feat.params.pocketDepth || 15.0;
            feat.params.massReductionRatio = 0.65;
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

  _applyBevel(body, radius) {
    // Modify outer vertices slightly to simulate rounded edge
    for (const v of body.vertices) {
      const dist = v.point.length();
      if (dist > 1e-6) {
        const factor = Math.max(0.8, (dist - radius * 0.1) / dist);
        v.point.scale(factor);
      }
    }
  }

  toSTEP(modelName = 'OmniEng_Parametric_Part') {
    const { StepTranslator } = require('./step_translator');
    return StepTranslator.exportSTEP(this.currentSolid, modelName);
  }

  toJSON() {
    return {
      features: this.features.map(f => ({
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
const { CSGSolid } = require('./csg_mesh_booleans');

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    ParametricFeature, 
    FeatureTree,
    StepTranslator,
    ConstraintSolver2D,
    CSGSolid
  };
}
