/**
 * Bundled NASA TMR flat-plate theoretical skin-friction reference table.
 * This data module does not run or validate a CFD solver.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REFERENCE_SHA256 = 'bafbaf7fa7969a945a5ad0935ca90c320ab72f14ba5a08474abffa61356bba2d';
const REFERENCE_SOURCE_URL = 'https://tmbwg.github.io/turbmodels/FlatPlate_validation/cf_K-S.dat';
const REFERENCE_LICENSE = 'CC0-1.0';
const REFERENCE_PATH = path.join(__dirname, 'references', 'nasa_tmr_flatplate_cf_ks.dat');

function loadNasaTmrFlatPlateReference() {
  const contents = fs.readFileSync(REFERENCE_PATH);
  const sha256 = crypto.createHash('sha256').update(contents).digest('hex');
  if (sha256 !== REFERENCE_SHA256) {
    throw new Error(`NASA TMR reference data checksum mismatch: ${sha256}`);
  }

  const points = [];
  let hasVariableHeader = false;
  for (const [lineIndex, rawLine] of contents.toString('utf8').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('variables=')) {
      if (hasVariableHeader || line !== 'variables="retheta","cf"') {
        throw new Error(`Unexpected NASA TMR variable header on line ${lineIndex + 1}.`);
      }
      hasVariableHeader = true;
      continue;
    }

    const match = line.match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/
    );
    if (!match) throw new Error(`Malformed NASA TMR reference row on line ${lineIndex + 1}.`);

    const reynoldsTheta = Number(match[1]);
    const skinFrictionCoefficient = Number(match[2]);
    if (
      !Number.isFinite(reynoldsTheta) ||
      reynoldsTheta <= 0 ||
      !Number.isFinite(skinFrictionCoefficient) ||
      skinFrictionCoefficient <= 0
    ) {
      throw new Error(`Invalid NASA TMR reference values on line ${lineIndex + 1}.`);
    }
    if (points.length > 0 && reynoldsTheta <= points[points.length - 1].reynoldsTheta) {
      throw new Error(`NASA TMR Reynolds-theta values must be strictly increasing (line ${lineIndex + 1}).`);
    }

    points.push({ reynoldsTheta, skinFrictionCoefficient });
  }

  if (
    !hasVariableHeader ||
    points.length !== 100 ||
    points[0].reynoldsTheta !== 200 ||
    points.at(-1).reynoldsTheta !== 20000
  ) {
    throw new Error('NASA TMR flat-plate reference table does not match its expected structure.');
  }

  return Object.freeze({
    sourceUrl: REFERENCE_SOURCE_URL,
    license: REFERENCE_LICENSE,
    sha256,
    referenceType: 'theoretical-karman-schoenherr-skin-friction-correlation',
    quantity: 'skin-friction coefficient Cf versus momentum-thickness Reynolds number Re_theta',
    points: Object.freeze(points.map((point) => Object.freeze(point)))
  });
}

module.exports = { loadNasaTmrFlatPlateReference, REFERENCE_SHA256, REFERENCE_SOURCE_URL, REFERENCE_LICENSE };
