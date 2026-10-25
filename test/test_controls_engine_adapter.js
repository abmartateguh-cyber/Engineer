'use strict';

const assert = require('assert');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  console.log('================================================================');
  console.log('       TESTING CONTROLS & DYNAMICS ENGINE ADAPTER               ');
  console.log('================================================================\n');

  const adapter = new ControlsEngineAdapter();
  const caps = adapter.describeCapabilities();
  assert.strictEqual(caps.domain, 'controls');
  assert(caps.supportedOperations.includes('simulate_block_diagram'));
  assert(caps.supportedOperations.includes('solve_state_space'));
  assert(caps.supportedOperations.includes('solve_mpc'));

  // 1. Block Diagram Simulation (Feedback Loop: Step -> Sum -> Gain -> Integrator)
  console.log('[1] Testing Block Diagram Simulation...');
  const blockEvents = [];
  const blockReq = new JobRequest({
    domain: 'controls',
    operation: 'simulate_block_diagram',
    parameters: {
      blocks: [
        { type: 'source_step', name: 'StepInput', params: { stepTime: 1.0, initialValue: 0.0, finalValue: 10.0 } },
        { type: 'gain', name: 'ControllerGain', params: { k: 2.5 } },
        { type: 'integrator', name: 'PlantIntegrator', params: { initialState: 0.0 } },
        { type: 'scope', name: 'OutputScope', params: {} }
      ],
      connections: [
        { fromBlock: 'blk_000001', toBlock: 'blk_000002' },
        { fromBlock: 'blk_000002', toBlock: 'blk_000003' },
        { fromBlock: 'blk_000003', toBlock: 'blk_000004' }
      ],
      tEnd: 3.0,
      dt: 0.05
    }
  });

  const blockRes = await adapter.execute(blockReq, (e) => blockEvents.push(e));
  assert.strictEqual(blockRes.status, JobStatus.SUCCEEDED);
  assert(blockRes.outputData.signals, 'Must contain logged signals');
  assert(blockRes.outputData.time.length > 50, 'Must record time steps');
  assert(blockEvents.length >= 2, 'Must record progress events');
  console.log(`  ✓ PASSED: Block diagram simulated across ${blockRes.outputData.time.length} steps\n`);

  // 2. State-Space RK4 Solver (Mass-Spring-Damper System)
  console.log('[2] Testing State-Space RK4 Solver...');
  // Second order system: m*x'' + c*x' + k*x = u
  // x1 = position, x2 = velocity
  // dx1/dt = x2
  // dx2/dt = -k/m * x1 - c/m * x2 + 1/m * u
  // Let m=1, k=4, c=0.5
  const ssReq = new JobRequest({
    domain: 'controls',
    operation: 'solve_state_space',
    parameters: {
      A: [
        [0.0, 1.0],
        [-4.0, -0.5]
      ],
      B: [
        [0.0],
        [1.0]
      ],
      C: [
        [1.0, 0.0]
      ],
      D: [
        [0.0]
      ],
      initialX: [0.0, 0.0],
      tEnd: 4.0,
      dt: 0.02,
      u: [1.0]
    }
  });

  const ssEvents = [];
  const ssRes = await adapter.execute(ssReq, (e) => ssEvents.push(e));
  assert.strictEqual(ssRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(ssRes.outputData.dimensions.states, 2);
  assert(ssRes.outputData.time.length === 201, 'Must have 201 time points');
  const finalPos = ssRes.outputData.finalState[0];
  // Steady state position should approach 1/k = 0.25
  assert(finalPos > 0.1 && finalPos < 0.4, `Final position should approach 0.25, got ${finalPos}`);
  console.log(`  ✓ PASSED: State-space 2nd order dynamic response calculated. Final state: [${ssRes.outputData.finalState.map(v => v.toFixed(3)).join(', ')}]\n`);

  // 3. Model Predictive Control (MPC) Goldfarb-Idnani QP
  console.log('[3] Testing Model Predictive Controller (Goldfarb-Idnani QP)...');
  const mpcReq = new JobRequest({
    domain: 'controls',
    operation: 'solve_mpc',
    parameters: {
      A: [[0.8, 0.1], [0.0, 0.9]],
      B: [[0.05], [0.1]],
      C: [[1.0, 0.0]],
      Np: 10,
      Nc: 3,
      Q: [10.0],
      R: [0.1],
      uMin: [-5.0],
      uMax: [5.0],
      x0: [0.2, 0.0],
      reference: [1.0]
    }
  });

  const mpcRes = await adapter.execute(mpcReq);
  assert.strictEqual(mpcRes.status, JobStatus.SUCCEEDED);
  assert(mpcRes.outputData.converged, 'QP must converge');
  assert(Array.isArray(mpcRes.outputData.optimalControl), 'Optimal control u must be an array');
  console.log(`  ✓ PASSED: MPC solved. u* = [${mpcRes.outputData.optimalControl.map(v => v.toFixed(3)).join(', ')}], cost = ${mpcRes.outputData.cost.toFixed(4)}\n`);

  console.log('================================================================');
  console.log('   ALL CONTROLS ENGINE ADAPTER TESTS PASSED!                    ');
  console.log('================================================================\n');
})();
