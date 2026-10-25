/**
 * Experimental viewport helpers for adapter availability, instancing descriptors,
 * and composite bounds. This class does not render geometry or provide measured
 * performance, surface-quality inspection, frustum culling, or section caps.
 */

'use strict';

class HighCapacityWebGPUViewport {
  /**
   * @param {Object} options
   * @param {string} [options.canvasId='main-canvas']
   * @param {number|null} [options.maxPolygons] Unenforced legacy capacity hint
   */
  constructor(options = {}) {
    this.canvasId = options.canvasId || 'main-canvas';
    this.maxPolygons = options.maxPolygons ?? null;
    this.maxPolygonsEnforced = false;
    this.isWebGPUSupported = false;
    this.activeBackend = 'not-connected';
    this.instancedMeshes = new Map();
    this.zebraStripingEnabled = false;
    this.zebraStripeFrequency = 30.0;
    this.frustumCullingEnabled = false;
    this.fpsCounter = null;
    this.descriptorPolygonCount = 0;

    this.checkGPUCapabilities();
  }

  /**
   * Checks for a browser WebGPU adapter. This does not attach a rendering backend.
   * @returns {Promise<boolean>}
   */
  async checkGPUCapabilities() {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.isWebGPUSupported = true;
          return true;
        }
      } catch (err) {
        console.warn('[OmniEng GPU] WebGPU requestAdapter fallback to WebGL2:', err.message);
      }
    }
    this.isWebGPUSupported = false;
    return false;
  }

  /**
   * Creates an instancing data descriptor for repeated geometry; this does not render it.
   * @param {string} partId
   * @param {Object} baseGeometryData - { vertices, normals, indices }
   * @param {Array<Object>} instanceTransforms - Array of { x, y, z, rotX, rotY, rotZ, scale }
   * @returns {Object} Instanced mesh descriptor
   */
  createInstancedPartMesh(partId, baseGeometryData, instanceTransforms) {
    const instanceCount = instanceTransforms.length;
    const vertexCount = (baseGeometryData.vertices ? baseGeometryData.vertices.length / 3 : 100);
    const triangleCount = (baseGeometryData.indices ? baseGeometryData.indices.length / 3 : vertexCount / 3);
    const totalPolygons = Math.floor(triangleCount * instanceCount);

    const transformMatrices = new Float32Array(instanceCount * 16);
    for (let i = 0; i < instanceCount; i++) {
      const t = instanceTransforms[i];
      const offset = i * 16;
      // Initialize 4x4 identity matrix with translation
      transformMatrices[offset + 0] = t.scale || 1.0;
      transformMatrices[offset + 5] = t.scale || 1.0;
      transformMatrices[offset + 10] = t.scale || 1.0;
      transformMatrices[offset + 15] = 1.0;
      transformMatrices[offset + 12] = t.x || 0.0;
      transformMatrices[offset + 13] = t.y || 0.0;
      transformMatrices[offset + 14] = t.z || 0.0;
    }

    const instancedMesh = {
      kind: 'instance-data-descriptor',
      rendered: false,
      partId,
      instanceCount,
      totalPolygons,
      polygonCountBasis: 'base-geometry triangle count multiplied by instance count',
      transformMatrices,
      visibleInstancesCount: null,
      bounds: this.calculateCompositeBounds(instanceTransforms)
    };

    this.instancedMeshes.set(partId, instancedMesh);
    this.descriptorPolygonCount += totalPolygons;
    return instancedMesh;
  }

  /**
   * Returns example zebra-stripe shader parameters; no mesh or surface quality is analyzed.
   * @param {boolean} enable
   * @param {number} [stripeFrequency=30.0]
   * @returns {Object} Shader uniforms
   */
  setZebraStriping(enable, stripeFrequency = 30.0) {
    this.zebraStripingEnabled = !!enable;
    this.zebraStripeFrequency = stripeFrequency;
    return {
      enabled: this.zebraStripingEnabled,
      frequency: this.zebraStripeFrequency,
      stripeColor1: [0.05, 0.05, 0.05, 1.0], // Dark band
      stripeColor2: [0.95, 0.95, 0.95, 1.0], // Light band
      reflectionVector: [0.0, 1.0, 0.0]
    };
  }

  /**
   * Compatibility stub for frustum-culling requests; no culling is performed.
   * @param {Array<number>} frustumPlanes - 6 planes [nx, ny, nz, d]
   * @returns {Object} Unavailable status and requested instance count
   */
  performFrustumCulling(frustumPlanes) {
    void frustumPlanes;
    const requestedInstanceCount = [...this.instancedMeshes.values()]
      .reduce((count, mesh) => count + mesh.instanceCount, 0);
    return {
      status: 'UNAVAILABLE',
      performed: false,
      reason: 'Frustum culling is not implemented by this experimental descriptor helper.',
      requestedInstanceCount,
      visibleInstances: null,
      culledInstances: null
    };
  }

  calculateCompositeBounds(transforms) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const t of transforms) {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
      if (t.z < minZ) minZ = t.z;
      if (t.z > maxZ) maxZ = t.z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  get renderedPolygonsCount() {
    return null;
  }

  getTelemetry() {
    return {
      activeBackend: this.activeBackend,
      isWebGPUSupported: this.isWebGPUSupported,
      instancedMeshCount: this.instancedMeshes.size,
      renderedPolygonsCount: null,
      descriptorPolygonCount: this.descriptorPolygonCount,
      maxPolygonsEnforced: this.maxPolygonsEnforced,
      zebraStriping: this.zebraStripingEnabled,
      fps: this.fpsCounter,
      status: 'EXPERIMENTAL_TELEMETRY_UNAVAILABLE'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HighCapacityWebGPUViewport };
}
if (typeof window !== 'undefined') {
  window.HighCapacityWebGPUViewport = HighCapacityWebGPUViewport;
}
