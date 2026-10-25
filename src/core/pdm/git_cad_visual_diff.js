'use strict';

/**
 * Experimental centroid comparison helper. Its legacy class name does not imply Git,
 * B-rep, wall-thickness, or structural analysis.
 */
const MAX_FACES = 10_000;
const MAX_FACE_COMPARISONS = 10_000_000;

function hasOnlyKeys(value, allowedKeys, label) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new TypeError(`${label} contains unsupported properties: ${unexpected.join(', ')}.`);
  }
}

function requireText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function normalizeCentroid(face, label) {
  const hasMillimeterField = face.centroidMm !== undefined;
  const hasLegacyField = face.centroid !== undefined;
  if (hasMillimeterField === hasLegacyField) {
    throw new TypeError(`${label} requires exactly one centroidMm field (or the explicit legacy centroid alias).`);
  }

  const centroid = hasMillimeterField ? face.centroidMm : face.centroid;
  if (!centroid || typeof centroid !== 'object' || Array.isArray(centroid)) {
    throw new TypeError(`${label} centroid must be an object with finite x, y, and z coordinates in millimeters.`);
  }
  hasOnlyKeys(centroid, new Set(['x', 'y', 'z']), `${label} centroid`);
  if (![centroid.x, centroid.y, centroid.z].every(Number.isFinite)) {
    throw new TypeError(`${label} centroid must contain finite x, y, and z coordinates in millimeters.`);
  }
  return { x: centroid.x, y: centroid.y, z: centroid.z };
}

function normalizeRevision(revision, label) {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
    throw new TypeError(`${label} must be an explicit revision object.`);
  }
  hasOnlyKeys(revision, new Set(['commitId', 'units', 'volumeMm3', 'volume', 'faces']), label);

  const commitId = requireText(revision.commitId, `${label}.commitId`);
  const units = revision.units;
  if (!units || typeof units !== 'object' || Array.isArray(units)) {
    throw new TypeError(`${label}.units must explicitly declare length and volume units.`);
  }
  hasOnlyKeys(units, new Set(['length', 'volume']), `${label}.units`);
  if (units.length !== 'mm' || units.volume !== 'mm3') {
    throw new TypeError(`${label}.units must be { length: 'mm', volume: 'mm3' }.`);
  }

  const hasVolumeMm3 = revision.volumeMm3 !== undefined;
  const hasLegacyVolume = revision.volume !== undefined;
  if (hasVolumeMm3 === hasLegacyVolume) {
    throw new TypeError(`${label} requires exactly one volumeMm3 field (or the explicit legacy volume alias).`);
  }
  const volumeMm3 = hasVolumeMm3 ? revision.volumeMm3 : revision.volume;
  if (!Number.isFinite(volumeMm3) || volumeMm3 < 0) {
    throw new TypeError(`${label} volume must be a finite nonnegative value in cubic millimeters.`);
  }

  if (!Array.isArray(revision.faces) || revision.faces.length === 0) {
    throw new TypeError(`${label}.faces must be a non-empty caller-supplied array.`);
  }
  if (revision.faces.length > MAX_FACES) {
    throw new RangeError(`${label}.faces exceeds the ${MAX_FACES}-face resource limit.`);
  }

  const faceIds = new Set();
  const persistentIds = new Set();
  const faces = revision.faces.map((face, index) => {
    const faceLabel = `${label}.faces[${index}]`;
    if (!face || typeof face !== 'object' || Array.isArray(face)) {
      throw new TypeError(`${faceLabel} must be an object.`);
    }
    hasOnlyKeys(face, new Set(['id', 'persistentId', 'centroidMm', 'centroid']), faceLabel);
    const id = requireText(face.id, `${faceLabel}.id`);
    if (faceIds.has(id)) throw new TypeError(`${label} contains duplicate face id '${id}'.`);
    faceIds.add(id);
    const persistentId =
      face.persistentId === undefined ? null : requireText(face.persistentId, `${faceLabel}.persistentId`);
    if (persistentId !== null && persistentIds.has(persistentId)) {
      throw new TypeError(`${label} contains duplicate persistent face id '${persistentId}'.`);
    }
    if (persistentId !== null) persistentIds.add(persistentId);
    return { id, persistentId, centroidMm: normalizeCentroid(face, faceLabel) };
  });

  return { commitId, volumeMm3, faces };
}

class GitCADVisualDiffEngine {
  /**
   * @param {Object} options
   * @param {number} options.toleranceMm - Maximum centroid distance classified as unchanged
   * @param {number} options.modificationThresholdMm - Maximum centroid distance classified as modified
   */
  constructor(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('CAD comparison requires explicit tolerance and modification threshold options.');
    }
    hasOnlyKeys(options, new Set(['toleranceMm', 'modificationThresholdMm']), 'CAD comparison options');
    if (!Number.isFinite(options.toleranceMm) || options.toleranceMm < 0) {
      throw new TypeError('toleranceMm must be a finite nonnegative value in millimeters.');
    }
    if (options.toleranceMm > 100) {
      throw new TypeError('toleranceMm cannot exceed the 100 mm comparison bound.');
    }
    if (
      !Number.isFinite(options.modificationThresholdMm) ||
      options.modificationThresholdMm <= options.toleranceMm ||
      options.modificationThresholdMm > 100
    ) {
      throw new TypeError('modificationThresholdMm must be finite and greater than toleranceMm.');
    }

    this.toleranceMm = options.toleranceMm;
    this.modificationThresholdMm = options.modificationThresholdMm;
  }

  _dist3D(p1, p2) {
    const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
    if (!Number.isFinite(distance)) {
      throw new RangeError('CAD centroid distance exceeded the finite numeric range.');
    }
    return distance;
  }

  /**
   * Compares caller-supplied face centroids and volume values using a heuristic.
   * This does not compare B-rep topology, wall thickness, material, or structural integrity.
   */
  compareRevisions(revisionAInput, revisionBInput) {
    const revisionA = normalizeRevision(revisionAInput, 'revisionA');
    const revisionB = normalizeRevision(revisionBInput, 'revisionB');
    const facesA = revisionA.faces;
    const facesB = revisionB.faces;
    if (facesA.length * facesB.length > MAX_FACE_COMPARISONS) {
      throw new RangeError(`CAD comparison exceeds the ${MAX_FACE_COMPARISONS}-pair work resource limit.`);
    }

    const addedFaces = [];
    const removedFaces = [];
    const modifiedFaces = [];
    const unchangedFaces = [];
    const matchedBIndices = new Set();
    const reservedBIndices = new Set();
    const persistentMatchesA = new Map();

    // Reserve stable identities across the complete pair before proximity matching;
    // otherwise an earlier face could consume a later face's exact identity match.
    const persistentIndicesB = new Map();
    facesB.forEach((face, index) => {
      if (face.persistentId) persistentIndicesB.set(face.persistentId, index);
    });
    facesA.forEach((face, index) => {
      if (!face.persistentId || !persistentIndicesB.has(face.persistentId)) return;
      const matchIndex = persistentIndicesB.get(face.persistentId);
      persistentMatchesA.set(index, matchIndex);
      reservedBIndices.add(matchIndex);
    });

    for (let i = 0; i < facesA.length; i++) {
      const faceA = facesA[i];
      let bestMatchIndex = -1;
      let minimumDistanceMm = Infinity;

      if (persistentMatchesA.has(i)) {
        bestMatchIndex = persistentMatchesA.get(i);
        minimumDistanceMm = this._dist3D(faceA.centroidMm, facesB[bestMatchIndex].centroidMm);
      } else {
        for (let j = 0; j < facesB.length; j++) {
          if (reservedBIndices.has(j) || matchedBIndices.has(j)) continue;
          const distanceMm = this._dist3D(faceA.centroidMm, facesB[j].centroidMm);
          if (distanceMm < minimumDistanceMm) {
            minimumDistanceMm = distanceMm;
            bestMatchIndex = j;
          }
        }
      }

      if (bestMatchIndex !== -1 && minimumDistanceMm <= this.toleranceMm) {
        const faceB = facesB[bestMatchIndex];
        matchedBIndices.add(bestMatchIndex);
        unchangedFaces.push({
          faceId: faceA.id,
          faceIdA: faceA.id,
          faceIdB: faceB.id,
          color: '#6c757d',
          status: 'UNCHANGED',
          opacity: 0.3
        });
      } else if (bestMatchIndex !== -1 && minimumDistanceMm <= this.modificationThresholdMm) {
        const faceB = facesB[bestMatchIndex];
        matchedBIndices.add(bestMatchIndex);
        modifiedFaces.push({
          faceIdA: faceA.id,
          faceIdB: faceB.id,
          centroidDisplacementMm: minimumDistanceMm,
          displacementDeltaMm: minimumDistanceMm,
          color: '#ffc107',
          status: 'MODIFIED',
          opacity: 0.9
        });
      } else {
        removedFaces.push({ faceId: faceA.id, color: '#dc3545', status: 'REMOVED', opacity: 1.0 });
      }
    }

    for (let j = 0; j < facesB.length; j++) {
      if (!matchedBIndices.has(j)) {
        addedFaces.push({ faceId: facesB[j].id, color: '#28a745', status: 'ADDED', opacity: 1.0 });
      }
    }

    const volumeDeltaMm3 = revisionB.volumeMm3 - revisionA.volumeMm3;
    const volumeDeltaPercent = revisionA.volumeMm3 > 0 ? (volumeDeltaMm3 / revisionA.volumeMm3) * 100 : null;
    const maxCentroidDisplacementMm = modifiedFaces.reduce(
      (maximum, face) => Math.max(maximum, face.centroidDisplacementMm),
      0
    );
    if (
      ![volumeDeltaMm3, maxCentroidDisplacementMm].every(Number.isFinite) ||
      (volumeDeltaPercent !== null && !Number.isFinite(volumeDeltaPercent))
    ) {
      throw new RangeError('CAD comparison output exceeded the finite numeric range.');
    }

    return {
      validationLevel: 'experimental',
      comparisonMethod: 'one-to-one centroid nearest-neighbor with persistent-id priority',
      commitA: revisionA.commitId,
      commitB: revisionB.commitId,
      summary: {
        totalFacesA: facesA.length,
        totalFacesB: facesB.length,
        addedCount: addedFaces.length,
        removedCount: removedFaces.length,
        modifiedCount: modifiedFaces.length,
        unchangedCount: unchangedFaces.length
      },
      volumetric: {
        volumeA_mm3: revisionA.volumeMm3,
        volumeB_mm3: revisionB.volumeMm3,
        volumeDeltaMm3,
        volumeDeltaPercent
      },
      maxCentroidDisplacementMm,
      maxThicknessReductionMm: null,
      colorMap: {
        added: '#28a745',
        removed: '#dc3545',
        modified: '#ffc107',
        unchanged: '#6c757d'
      },
      warnings: [
        'Face matching uses caller-supplied centroids and is an experimental heuristic, not B-rep comparison.',
        'Wall thickness, material, manufacturing change, and structural integrity are not assessed.',
        'Volume change is arithmetic over caller-supplied values in mm3.'
      ],
      entities: { added: addedFaces, removed: removedFaces, modified: modifiedFaces, unchanged: unchangedFaces }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GitCADVisualDiffEngine };
}
if (typeof window !== 'undefined') {
  window.GitCADVisualDiffEngine = GitCADVisualDiffEngine;
}
