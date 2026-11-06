/**
 * Test Suite: FeatureDAGEngine (Parametric DAG, Persistent Topological Naming, Suppression)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FeatureDAGEngine } = require('../src/core/cad/feature_dag_engine');

test('FeatureDAGEngine: Executes parametric features in valid topological order', () => {
  const dag = new FeatureDAGEngine();

  dag.addFeature('sketch1', 'sketch');
  dag.addFeature('extrude1', 'extrude', { sides: 4, depth: 50 }, ['sketch1']);
  dag.addFeature('fillet1', 'fillet', { targetEdge: 'extrude1:EDGE:LONGITUDINAL_0', radius: 5 }, ['extrude1']);

  const rebuild = dag.rebuildModel();
  assert.equal(rebuild.executedFeatures.length, 3);
  assert.deepEqual(rebuild.executedFeatures, ['sketch1', 'extrude1', 'fillet1']);

  // Verify persistent topological entities
  const sideFace = dag.resolveTopology('extrude1:FACE:SIDE_0');
  assert.ok(sideFace !== null, 'Persistent side face must resolve');
  assert.equal(sideFace.role, 'side');

  const blendFace = dag.resolveTopology('fillet1:BLEND_FACE:extrude1:EDGE:LONGITUDINAL_0');
  assert.ok(blendFace !== null, 'Fillet blend face must resolve');
  assert.equal(blendFace.role, 'fillet_blend');
});

test('FeatureDAGEngine: Preserves persistent entity IDs across parameter modification', () => {
  const dag = new FeatureDAGEngine();
  dag.addFeature('sketch1', 'sketch');
  dag.addFeature('extrude1', 'extrude', { depth: 20 }, ['sketch1']);

  dag.rebuildModel();
  assert.ok(dag.resolveTopology('extrude1:FACE:END') !== null);

  // Modify upstream parameter: change depth from 20 to 100
  dag.updateParameters('extrude1', { depth: 100 });
  dag.rebuildModel();

  // Downstream reference should remain intact
  assert.ok(dag.resolveTopology('extrude1:FACE:END') !== null);
  assert.ok(dag.resolveTopology('extrude1:FACE:START') !== null);
});

test('FeatureDAGEngine: Supports feature suppression without breaking DAG', () => {
  const dag = new FeatureDAGEngine();
  dag.addFeature('sketch1', 'sketch');
  dag.addFeature('extrude1', 'extrude', {}, ['sketch1']);
  dag.addFeature('fillet1', 'fillet', { targetEdge: 'extrude1:EDGE:LONGITUDINAL_0' }, ['extrude1']);

  // Suppress fillet1
  dag.setSuppressed('fillet1', true);
  const res = dag.rebuildModel();

  assert.equal(res.executedFeatures.length, 2);
  assert.deepEqual(res.executedFeatures, ['sketch1', 'extrude1']);
  assert.equal(dag.resolveTopology('fillet1:BLEND_FACE:extrude1:EDGE:LONGITUDINAL_0'), null);
});

test('FeatureDAGEngine: Detects and rejects cyclic feature dependencies', () => {
  const dag = new FeatureDAGEngine();
  dag.addFeature('fA', 'sketch');
  dag.addFeature('fB', 'extrude', {}, ['fA']);
  // Attempt to add circular reference
  assert.throws(() => {
    dag.addFeature('fC', 'fillet', {}, ['fB']);
    // Artificially attach fA to fC
    dag.features.get('fA').dependencies.add('fC');
    dag.features.get('fC').dependents.add('fA');
    dag.rebuildModel();
  }, /Cyclic dependency detected/);
});
