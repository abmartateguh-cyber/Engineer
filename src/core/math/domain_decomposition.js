/**
 * Experimental in-memory recursive coordinate bisection (RCB) of element centroids.
 * It reports shared interface nodes and load counts; it does not optimize graph cuts,
 * form Schur complements, or run distributed solves.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class DomainDecompositionEngine {
  /**
   * Partitions element centroids into P groups using recursive median splits.
   * 
   * @param {Array<{x: number, y: number, z: number}>} nodes - Array of 3D node coordinates
   * @param {Array<number[]>} elements - Array of element connectivity arrays (node indices)
   * @param {number} [numPartitions=2] - Number of target subdomains P (power of 2 or arbitrary integer)
   * @returns {{
   *   subdomains: Array<{ id: number, elementIndices: number[], nodeIndices: number[], interfaceNodeIndices: number[] }>,
   *   sharedNodePartitionIncidences: number,
   *   interfaceNodes: number[],
   *   loadImbalanceRatio: number
   * }}
   */
  static partitionMesh(nodes, elements, numPartitions = 2) {
    if (numPartitions <= 1 || elements.length <= numPartitions) {
      const allNodes = Array.from(new Set(elements.flat()));
      return {
        subdomains: [{
          id: 0,
          elementIndices: elements.map((_, i) => i),
          nodeIndices: allNodes,
          interfaceNodeIndices: []
        }],
        sharedNodePartitionIncidences: 0,
        interfaceNodes: [],
        loadImbalanceRatio: 1.0
      };
    }

    // 1. Compute element centroids
    const elementCentroids = elements.map((el, elIdx) => {
      let cx = 0, cy = 0, cz = 0;
      for (const nIdx of el) {
        cx += nodes[nIdx].x;
        cy += nodes[nIdx].y;
        cz += nodes[nIdx].z;
      }
      const count = el.length;
      return {
        id: elIdx,
        x: cx / count,
        y: cy / count,
        z: cz / count
      };
    });

    // 2. Multi-level Recursive Coordinate Bisection (RCB)
    let partitions = [elementCentroids];

    while (partitions.length < numPartitions) {
      const nextLevel = [];
      for (const group of partitions) {
        if (group.length <= 1) {
          nextLevel.push(group);
          continue;
        }

        // Determine principal axis of greatest spatial variance
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const pt of group) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
          if (pt.z < minZ) minZ = pt.z;
          if (pt.z > maxZ) maxZ = pt.z;
        }

        const spanX = maxX - minX;
        const spanY = maxY - minY;
        const spanZ = maxZ - minZ;

        let axis = 'x';
        if (spanY >= spanX && spanY >= spanZ) axis = 'y';
        else if (spanZ >= spanX && spanZ >= spanY) axis = 'z';

        // Sort elements along principal axis
        group.sort((a, b) => a[axis] - b[axis]);

        // Median split
        const mid = Math.floor(group.length / 2);
        nextLevel.push(group.slice(0, mid));
        nextLevel.push(group.slice(mid));
      }
      partitions = nextLevel;
    }

    // Trim or balance to exactly numPartitions if needed
    while (partitions.length > numPartitions) {
      const last = partitions.pop();
      partitions[partitions.length - 1].push(...last);
    }

    // 3. Map nodes to subdomains and identify interface boundary nodes
    const nodeSubdomainMap = new Map(); // nodeIdx -> Set of subdomainIds
    const subdomains = partitions.map((group, pIdx) => {
      const elIndices = group.map(g => g.id);
      const nodeSet = new Set();
      for (const elIdx of elIndices) {
        for (const nIdx of elements[elIdx]) {
          nodeSet.add(nIdx);
          if (!nodeSubdomainMap.has(nIdx)) {
            nodeSubdomainMap.set(nIdx, new Set());
          }
          nodeSubdomainMap.get(nIdx).add(pIdx);
        }
      }
      return {
        id: pIdx,
        elementIndices: elIndices,
        nodeIndices: Array.from(nodeSet).sort((a, b) => a - b),
        interfaceNodeIndices: []
      };
    });

    // 4. Identify interface cut nodes (nodes shared by > 1 subdomain)
    const globalInterfaceNodes = new Set();
    let sharedNodePartitionIncidences = 0;

    for (const [nIdx, subSet] of nodeSubdomainMap.entries()) {
      if (subSet.size > 1) {
        globalInterfaceNodes.add(nIdx);
        sharedNodePartitionIncidences += (subSet.size - 1);
        for (const pIdx of subSet) {
          subdomains[pIdx].interfaceNodeIndices.push(nIdx);
        }
      }
    }

    // 5. Load balance evaluation
    const counts = subdomains.map(s => s.elementIndices.length);
    const maxCount = Math.max(...counts);
    const avgCount = elements.length / numPartitions;
    const loadImbalanceRatio = maxCount / avgCount;

    return {
      subdomains,
      sharedNodePartitionIncidences,
      interfaceNodes: Array.from(globalInterfaceNodes).sort((a, b) => a - b),
      loadImbalanceRatio: Number(loadImbalanceRatio.toFixed(3))
    };
  }

  /**
   * Counts internal and interface degrees of freedom; no Schur matrix is assembled.
   * 
   * @param {Object} partition
   * @param {number} totalNodes
   * @returns {{ internalDofsCount: number, interfaceDofsCount: number, schurDimension: number }}
   */
  static evaluateSchurDimensions(partition, dofsPerNode = 3) {
    const interfaceNodesCount = partition.interfaceNodes.length;
    const interfaceDofs = interfaceNodesCount * dofsPerNode;

    let totalInternalDofs = 0;
    for (const sub of partition.subdomains) {
      const internalNodes = sub.nodeIndices.length - sub.interfaceNodeIndices.length;
      totalInternalDofs += (internalNodes * dofsPerNode);
    }

    return {
      internalDofsCount: totalInternalDofs,
      interfaceDofsCount: interfaceDofs,
      schurDimension: interfaceDofs
    };
  }
}

module.exports = {
  DomainDecompositionEngine
};
