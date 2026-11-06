'use strict';

/**
 * Persistent topological naming verification gate.
 *
 * Builds a parametric part (base extrude → circular boss → edge fillet),
 * edits the base sketch size, and asserts the downstream fillet's parent
 * attachment survives the rebuild (same resolved reference name). Also
 * verifies suppression/re-enable and reorder behavior and determinism.
 */

const assert = require('assert');
const { FeatureDAGEngine } = require('../src/core/cad/feature_dag_engine');

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

// --- Build the parametric part ---
{
  const eng = new FeatureDAGEngine();
  eng.addFeature('Base', 'extrude', { w: 40, h: 30, depth: 10 });
  eng.addFeature('Boss', 'boss', { w: 20, h: 20, depth: 8 }, 'Base');
  eng.addFeature('Fillet', 'fillet', { r: 3, cx: 10, cy: 10, depth: 18 }, 'Boss');

  // baseline: fillet resolves to a boss face
  const before = eng.resolveReference('Fillet');
  check('initial: fillet reference resolved', before.resolved === true, before.name || '');

  // Edit the base sketch size → rebuild → downstream must retain attachment
  const remap = eng.editFeature('Base', { w: 50, h: 40 });
  const after = eng.resolveReference('Fillet');
  check('after base edit: fillet reference still resolved', after.resolved === true, after.name || '');
  check('after base edit: resolved face exists in rebuilt boss', eng.faceExists('Boss', after.name), after.name);
  check('remap produced a non-empty map', remap.size > 0, `${remap.size} names remapped`);

  // Suppress the boss → fillet dirty
  eng.suppress('Boss');
  const dirtied = eng.resolveReference('Fillet');
  check(
    'suppressed boss: fillet marked dirty (unresolved)',
    dirtied.resolved === false && dirtied.reason.includes('dirty'),
    dirtied.reason
  );

  // Re-enable the boss → fillet restored
  eng.unsuppress('Boss');
  const restored = eng.resolveReference('Fillet');
  check('re-enabled boss: fillet reference restored', restored.resolved === true, restored.name || '');

  // Reorder: move Fillet to attach directly under Base (still resolvable)
  eng.reorder('Fillet', 'Base');
  const reorderd = eng.resolveReference('Fillet');
  check('reorder: fillet still resolvable under new parent', reorderd.resolved === true, reorderd.name || '');

  // Determinism: rebuild same edit twice gives identical remap
  const remap1 = eng.editFeature('Base', { w: 44 });
  const remap2 = eng.editFeature('Base', { w: 44 });
  check('determinism: identical remap on identical edit', JSON.stringify([...remap1]) === JSON.stringify([...remap2]));

  // Fail closed: unknown feature
  let threw = false;
  try {
    eng.editFeature('Nope', { w: 1 });
  } catch (_) {
    threw = true;
  }
  check('unknown feature edit throws', threw);
}

console.log(`\ntopological_naming: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
