/**
 * WP-3 mandatory IPC wiring tests.
 *
 * Exercises the seven mandated channels end-to-end through the real guarded
 * IPC handlers (sender guard + schema validation + real computation):
 *
 *   1. omni:solve-water-hammer-moc    -> PlantEngineAdapter calculate_water_hammer
 *   2. omni:plant-nrtl-activity       -> PlantEngineAdapter calculate_nrtl_activity
 *   3. omni:run-optical-tolerancing   -> OpticsEngineAdapter run_optical_tolerancing
 *   4. omni:solve-thermal             -> ThermalEngine.solveTransientConduction2D (direct; no CAE adapter operation)
 *   5. omni:solve-penalty-contact     -> ContactFEM3D small real contact solve
 *   6. omni:generate-sbom             -> scripts/generate_sbom.js library (real npm sbom computation)
 *   7. omni:compute-inertia           -> material-database mass-properties code path
 *
 * No mocks, stubs, or unavailable sentinels are accepted for valid inputs.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..');
const handlers = new Map();

const electronMock = {
  app: { getAppPath: () => repositoryRoot },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  },
  dialog: {}
};

const originalLoad = Module._load;
Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let registerAllIpcHandlers;
let defineHandlerModule;
try {
  ({ registerAllIpcHandlers } = require('../src/main/ipc/index'));
  defineHandlerModule = require('../src/main/ipc/define_handler');
} finally {
  Module._load = originalLoad;
}

const CHANNELS = [
  'omni:solve-water-hammer-moc',
  'omni:plant-nrtl-activity',
  'omni:run-optical-tolerancing',
  'omni:solve-thermal',
  'omni:solve-penalty-contact',
  'omni:generate-sbom',
  'omni:compute-inertia'
];

function isFiniteDeep(value, seen = new Set()) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return Array.from(value).every(Number.isFinite);
  return Object.values(value).every((entry) => isFiniteDeep(entry, seen));
}

async function runIpcWiringsTests() {
  console.log('================================================================');
  console.log('  WP-3 MANDATORY IPC WIRINGS TEST');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const record = (name, ok, detail = '') => {
    if (ok) {
      passed++;
      console.log(`  ✓ PASS ${name}${detail ? ` [${detail}]` : ''}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL ${name}${detail ? ` [${detail}]` : ''}`);
    }
  };

  defineHandlerModule.channelRegistry.clear();
  handlers.clear();
  registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });

  for (const channel of CHANNELS) {
    record(`channel registered ${channel}`, handlers.has(channel));
  }

  const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
  const trustedEvent = {
    sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
    senderFrame: { frameTreeNodeId: 42, url: entryUrl }
  };

  // 1. Water hammer MOC via PlantEngineAdapter calculate_water_hammer
  {
    const hammerParams = {
      fluidDensity: 1000,
      fluidBulkModulus: 2.2e9,
      pipeElasticModulus: 210e9,
      pipeWallThickness: 0.01,
      restraintFactor: 0.91,
      pipeDiameter: 0.2,
      steadyVelocity: 1.0,
      runMOC: true,
      pipeLength: 100,
      darcyFrictionFactor: 0.02,
      reservoirHead: 20,
      valveClosureTime: 2,
      valveClosureLaw: 'linear',
      simulationDuration: 10,
      reaches: 50
    };
    const res = await handlers.get('omni:solve-water-hammer-moc')(trustedEvent, hammerParams);
    record('water-hammer success', res.success === true, `waveSpeedMs=${res.waveSpeedMs}`);
    record('water-hammer wave speed finite positive', Number.isFinite(res.waveSpeedMs) && res.waveSpeedMs > 0);
    record('water-hammer surge head finite', Number.isFinite(res.joukowskySurgeHeadM) && res.joukowskySurgeHeadM > 0);
    record(
      'water-hammer MOC solve executed',
      res.mocSolution &&
        res.mocSolution.success === true &&
        Number.isFinite(res.mocSolution.maxHeadObserved) &&
        Number.isInteger(res.mocSolution.totalStepsExecuted) &&
        res.mocSolution.totalStepsExecuted > 0,
      res.mocSolution ? `steps=${res.mocSolution.totalStepsExecuted}` : 'no mocSolution'
    );
    record('water-hammer output all finite', isFiniteDeep(res), 'finite-tree scan');
    const bad = await handlers.get('omni:solve-water-hammer-moc')(trustedEvent, {});
    record('water-hammer fails closed on missing inputs', bad.success === false && bad.status === 'unavailable');
  }

  // 2. NRTL activity via PlantEngineAdapter calculate_nrtl_activity
  {
    const nrtlParams = {
      liquidComposition: [0.5, 0.5],
      temperatureK: 323.15,
      delta_g: [
        [0, 500],
        [300, 0]
      ],
      alpha: [
        [0, 0.3],
        [0.3, 0]
      ]
    };
    const res = await handlers.get('omni:plant-nrtl-activity')(trustedEvent, nrtlParams);
    record('nrtl success', res.success === true);
    record(
      'nrtl activity coefficients finite',
      Array.isArray(res.activityCoefficients) &&
        res.activityCoefficients.length === 2 &&
        res.activityCoefficients.every((g) => Number.isFinite(g) && g > 0),
      res.activityCoefficients ? JSON.stringify(res.activityCoefficients) : 'none'
    );
    const bad = await handlers.get('omni:plant-nrtl-activity')(trustedEvent, {});
    record('nrtl fails closed on missing inputs', bad.success === false && bad.status === 'unavailable');
  }

  // 3. Optical tolerancing via OpticsEngineAdapter run_optical_tolerancing
  {
    const tolParams = {
      nominalSystem: {
        entrancePupilRadius: 10,
        surfaces: [
          { radius: 50, thickness: 5, refractiveIndex: 1.5 },
          { radius: -50, thickness: 45, refractiveIndex: 1.0 }
        ]
      },
      toleranceDefs: [
        { surfaceIndex: 0, type: 'RADIUS', tolerance: 1.0 },
        { surfaceIndex: 1, type: 'THICKNESS', tolerance: 0.5 }
      ],
      options: { trials: 200, seed: 7, targetRmsSpotUm: 9500, maxCompensatorTravelMm: 2 }
    };
    const res = await handlers.get('omni:run-optical-tolerancing')(trustedEvent, tolParams);
    record('tolerancing success', res.success === true);
    record('tolerancing trials ran', res.totalTrials === 200);
    record(
      'tolerancing statistics finite',
      Number.isFinite(res.samplePassPercent) &&
        Number.isFinite(res.nominalRmsSpotUm) &&
        Object.values(res.percentilesUm).every((v) => Number.isFinite(v)),
      `pass%=${res.samplePassPercent}`
    );
    const bad = await handlers.get('omni:run-optical-tolerancing')(trustedEvent, {});
    record('tolerancing fails closed on missing inputs', bad.success === false);
  }

  // 4. Thermal via direct ThermalEngine.solveTransientConduction2D
  {
    const thermalParams = {
      widthM: 0.1,
      heightM: 0.1,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.5,
      totalTimeSec: 2,
      initialTemperatureC: [
        [20, 20, 20],
        [20, 20, 20],
        [20, 20, 20]
      ],
      conductivityWPerMK: [
        [200, 200, 200],
        [200, 200, 200],
        [200, 200, 200]
      ],
      volumetricHeatCapacityJPerM3K: [
        [3.6e6, 3.6e6, 3.6e6],
        [3.6e6, 3.6e6, 3.6e6],
        [3.6e6, 3.6e6, 3.6e6]
      ],
      heatGenerationWPerM3: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    };
    const res = await handlers.get('omni:solve-thermal')(trustedEvent, thermalParams);
    record('thermal success', res.success === true, `model=${res.model}`);
    record(
      'thermal results finite',
      Number.isFinite(res.results.minimumTemperatureC) && Number.isFinite(res.results.maximumTemperatureC),
      `min=${res.results.minimumTemperatureC} max=${res.results.maximumTemperatureC}`
    );
    const bad = await handlers.get('omni:solve-thermal')(trustedEvent, {
      conductivities: [200, 200],
      boundaryTemperatures: [300, 400],
      lengthM: 1.0
    });
    record('thermal fails closed on invalid inputs', bad.success === false, `status=${bad.status}`);
  }

  // 5. Penalty contact via ContactFEM3D small real solve
  {
    const contactParams = { E: 210e9, nu: 0.3, displacementM: 1e-6 };
    const res = await handlers.get('omni:solve-penalty-contact')(trustedEvent, contactParams);
    record('penalty contact success', res.success === true);
    record('penalty contact solver executed', res.solverExecuted === true);
    record(
      'penalty contact finite positive contact data',
      Number.isFinite(res.maxPressurePa) &&
        res.maxPressurePa > 0 &&
        Number.isFinite(res.totalContactForceN) &&
        res.totalContactForceN > 0,
      `maxPressurePa=${res.maxPressurePa} forceN=${res.totalContactForceN}`
    );
    record('penalty contact converged', res.converged === true, `iterations=${res.iterations}`);
    const bad = await handlers.get('omni:solve-penalty-contact')(trustedEvent, {});
    record('penalty contact fails closed on missing inputs', bad.success === false);
  }

  // 6. SBOM via scripts/generate_sbom.js library (real computation)
  {
    const res = await handlers.get('omni:generate-sbom')(trustedEvent, {});
    record('sbom success', res.success === true);
    record(
      'sbom manifest digest is sha256 hex',
      typeof res.manifestDigest === 'string' && /^[0-9a-f]{64}$/.test(res.manifestDigest),
      res.manifestDigest
    );
    record(
      'sbom component count positive integer',
      Number.isInteger(res.cyclonedxComponentCount) && res.cyclonedxComponentCount > 0,
      `cyclonedx=${res.cyclonedxComponentCount}`
    );
    record(
      'sbom package count positive integer',
      Number.isInteger(res.spdxPackageCount) && res.spdxPackageCount > 0,
      `spdx=${res.spdxPackageCount}`
    );
    record('sbom lock digest is sha256 hex', /^[0-9a-f]{64}$/.test(res.packageLockSha256));
  }

  // 7. Inertia via mass-properties code path
  {
    const res = await handlers.get('omni:compute-inertia')(trustedEvent, {
      matKey: 'UNREVIEWED',
      widthM: 0.1,
      heightM: 0.2,
      depthM: 0.3,
      densityKgM3: 7850,
      densitySource: 'AISI 1018 steel spec'
    });
    record('inertia success (caller-supplied density)', res.success === true);
    record(
      'inertia mass matches analytic cuboid',
      Number.isFinite(res.results.massKg) && Math.abs(res.results.massKg - 0.1 * 0.2 * 0.3 * 7850) < 1e-9,
      `massKg=${res.results.massKg}`
    );
    record(
      'inertia moments finite positive',
      [res.results.Ixx, res.results.Iyy, res.results.Izz].every((v) => Number.isFinite(v) && v > 0)
    );
    const noDensity = await handlers.get('omni:compute-inertia')(trustedEvent, {
      matKey: 'AL_6061',
      widthM: 0.1,
      heightM: 0.1,
      depthM: 0.1
    });
    record('inertia fails closed without reviewed material or density', noDensity.success === false);
  }

  console.log('\n================================================================');
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');
  return { passed, failed };
}

if (require.main === module) {
  runIpcWiringsTests().then(({ failed }) => {
    process.exitCode = failed > 0 ? 1 : 0;
  });
}

module.exports = { runIpcWiringsTests };
