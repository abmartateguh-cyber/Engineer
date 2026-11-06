/**
 * tet10_from_tet4.js: clean TET4 -> TET10 upgrade.
 *
 * Inserts edge midpoints for all six edges of each tetrahedron and de-duplicates
 * shared midpoints across elements, preserving corner ordering (and therefore
 * element orientation). The resulting 10-node quadratic tetrahedron is
 * straight-sided: its mapping is affine and the determinant of the Jacobian is
 * identical to the linear corner-tetrahedron determinant everywhere.
 *
 * The upgrade delegates to MeshGenerator3D.convertToTET10 (the production
 * implementation) and exposes it in a standalone, callable form.
 */

'use strict';

const { MeshGenerator3D } = require('./mesh_generator_3d');

/**
 * @param {Float64Array|number[]} nodes4 - 3*numNodes4 flattened coordinates
 * @param {Int32Array|number[]} elements4 - 4*numElements flattened indices
 * @returns {{ nodes10: Float64Array, elements10: Int32Array,
 *            numNodes: number, numElements: number }}
 */
function upgradeTet4ToTet10(nodes4, elements4) {
  if (!nodes4 || !elements4) {
    throw new Error('upgradeTet4ToTet10: nodes4 and elements4 are required.');
  }
  if (elements4.length % 4 !== 0) {
    throw new Error('upgradeTet4ToTet10: elements4 length must be a multiple of 4.');
  }
  if (nodes4.length % 3 !== 0) {
    throw new Error('upgradeTet4ToTet10: nodes4 length must be a multiple of 3.');
  }
  const generator = new MeshGenerator3D();
  return generator.convertToTET10(nodes4, elements4);
}

module.exports = { upgradeTet4ToTet10 };
