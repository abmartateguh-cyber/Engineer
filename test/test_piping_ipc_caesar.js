/**
 * test/test_piping_ipc_caesar.js
 * Verification suite for ASME 3D Piping Catalog, 3D Mesh Generation,
 * CAESAR II Flexibility & Stress Analysis, and ISOGEN PCF Export IPC Handlers.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
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

const REQUIRED_CHANNELS = [
  'plant:get-asme-piping-catalog',
  'plant:generate-piping-3d-geometry',
  'plant:run-caesar-stress-analysis',
  'plant:export-pcf'
];

async function runPipingIpcCaesarTests() {
  console.log('================================================================');
  console.log('  ASME 3D PIPING & CAESAR II STRESS IPC VERIFICATION SUITE      ');
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

  const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
  const trustedEvent = {
    sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 101 } },
    senderFrame: { frameTreeNodeId: 101, url: entryUrl }
  };

  // 1. Channel registration checks
  console.log('[1] Verifying IPC Channel Registrations...');
  for (const channel of REQUIRED_CHANNELS) {
    record(`channel registered: ${channel}`, handlers.has(channel));
  }

  // 2. Catalog querying across NPS sizes and schedules
  console.log('\n[2] Verifying ASME Piping Catalog Queries...');
  {
    const overview = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, {});
    record('catalog query overview success', overview.success === true);
    record('catalog includes standard NPS sizes', Array.isArray(overview.npsSizes) && overview.npsSizes.length >= 20);
    record('catalog includes standard schedules', overview.schedules.includes('40') && overview.schedules.includes('80'));
    record('catalog includes ASME flange ratings', overview.flangeRatings.includes('150') && overview.flangeRatings.includes('300'));
    record('catalog includes standard materials', overview.materials.includes('A106-B') && overview.materials.includes('316L'));
    record('catalog combinatorial SKU count', overview.componentCounts.combinatorialCatalogSKUs > 50000, `SKUs=${overview.componentCounts.combinatorialCatalogSKUs}`);

    // NPS 4 Sch 40 pipe query
    const pipe4 = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, { nps: '4', schedule: '40' });
    record('pipe NPS 4 Sch 40 OD verified', pipe4.pipe.outsideDiameter_mm === 114.3, `OD=${pipe4.pipe.outsideDiameter_mm}mm`);
    record('pipe NPS 4 Sch 40 thickness verified', pipe4.pipe.wallThickness_mm === 6.02, `t=${pipe4.pipe.wallThickness_mm}mm`);

    // NPS 8 Sch 80 pipe query
    const pipe8 = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, { nps: '8', schedule: '80' });
    record('pipe NPS 8 Sch 80 OD verified', pipe8.pipe.outsideDiameter_mm === 219.1);
    record('pipe NPS 8 Sch 80 thickness verified', pipe8.pipe.wallThickness_mm === 12.7);

    // NPS 6 Class 300 flange query
    const flange6 = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, { nps: '6', rating: '300' });
    record('flange NPS 6 Cl 300 OD verified', flange6.flange.outsideDiameter_mm === 317.5);
    record('flange NPS 6 Cl 300 bolt count verified', flange6.flange.boltCount === 12);

    // NPS 4 Fitting query
    const fitting4 = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, { nps: '4', fitting: true });
    record('fitting NPS 4 elbow LR verified', fitting4.fitting.elbow90_LR_mm === 152.4);
    record('fitting NPS 4 tee center verified', fitting4.fitting.teeCenterToEnd_mm === 104.6);

    // MAWP query
    const mawpQ = await handlers.get('plant:get-asme-piping-catalog')(trustedEvent, {
      nps: '8',
      schedule: '80',
      material: 'A106-B',
      temperature_C: 150
    });
    record('catalog MAWP evaluated', mawpQ.mawp && mawpQ.mawp.mawp_bar > 50, `MAWP=${mawpQ.mawp.mawp_bar} bar`);
  }

  // 3. 3D Parametric Geometry Generation
  console.log('\n[3] Verifying 3D Parametric Mesh Geometry Generation...');
  {
    // Straight pipe spool mesh
    const spoolMesh = await handlers.get('plant:generate-piping-3d-geometry')(trustedEvent, {
      componentType: 'pipe',
      nps: '6',
      schedule: '40',
      length_mm: 3000
    });
    record('straight spool geometry success', spoolMesh.success === true);
    record('straight spool type verified', spoolMesh.componentType === 'StraightPipeSpool');
    record('straight spool vertex count verified', spoolMesh.vertexCount === 48);
    record('straight spool triangle count verified', spoolMesh.triangleCount === 48);
    record('straight spool vertices array finite', Array.isArray(spoolMesh.vertices) && spoolMesh.vertices.length === 144);
    record('straight spool indices array valid', Array.isArray(spoolMesh.indices) && spoolMesh.indices.length === 144);
    record('straight spool mass evaluated', spoolMesh.mesh.mass_kg > 80 && spoolMesh.mesh.mass_kg < 90);

    // 90 deg Long Radius elbow mesh
    const elbowMesh = await handlers.get('plant:generate-piping-3d-geometry')(trustedEvent, {
      componentType: 'elbow',
      nps: '4',
      schedule: '40'
    });
    record('elbow geometry success', elbowMesh.success === true);
    record('elbow type verified', elbowMesh.componentType === 'Elbow90LR');
    record('elbow bend radius verified', elbowMesh.mesh.bendRadius_mm === 152.4);
    record('elbow vertex count positive', elbowMesh.vertexCount > 0);
    record('elbow triangle count positive', elbowMesh.triangleCount > 0);
    record('elbow vertices array non-empty', Array.isArray(elbowMesh.vertices) && elbowMesh.vertices.length > 0);

    // Weld-neck flange mesh
    const flangeMesh = await handlers.get('plant:generate-piping-3d-geometry')(trustedEvent, {
      componentType: 'flange',
      nps: '4',
      rating: '150',
      flangeType: 'WN'
    });
    record('flange geometry success', flangeMesh.success === true);
    record('flange type verified', flangeMesh.componentType === 'Flange_WN');
    record('flange bolt count verified', flangeMesh.mesh.boltCount === 8);
    record('flange bolt holes generated', flangeMesh.mesh.boltHoles.length === 8);
    record('flange vertices array non-empty', Array.isArray(flangeMesh.vertices) && flangeMesh.vertices.length > 0);
    record('flange triangle count positive', flangeMesh.triangleCount > 0);

    // Straight tee mesh
    const teeMesh = await handlers.get('plant:generate-piping-3d-geometry')(trustedEvent, {
      componentType: 'tee',
      nps: '4',
      schedule: '40'
    });
    record('tee geometry success', teeMesh.success === true);
    record('tee type verified', teeMesh.componentType === 'StraightTee');
    record('tee run length positive', teeMesh.mesh.runLength_mm > 0);
    record('tee vertices array non-empty', Array.isArray(teeMesh.vertices) && teeMesh.vertices.length > 0);
  }

  // 4. ASME B31.3 & CAESAR II Stress Analysis
  console.log('\n[4] Verifying ASME B31.3 Stress & CAESAR II Flexibility Analysis...');
  {
    // Comprehensive expansion loop stress evaluation
    const stressRes = await handlers.get('plant:run-caesar-stress-analysis')(trustedEvent, {
      runLength_m: 60.0,
      offset_m: 6.0,
      nps: '6',
      schedule: '40',
      material: 'A106-B',
      operatingTempC: 220.0,
      pressure_Pa: 2.0e6,
      nozzle: {
        nps: '4',
        Fx: 1200,
        Fy: 1500,
        Fz: 800,
        Mx: 600,
        My: 700,
        Mz: 500
      }
    });

    record('stress analysis success', stressRes.success === true);
    record('stress evaluation status', stressRes.status === 'evaluated');
    record('thermal expansion computed', stressRes.thermalExpansion_mm > 100 && stressRes.thermalExpansion_mm < 200, `DeltaL=${stressRes.thermalExpansion_mm.toFixed(1)}mm`);
    record('sustained stress positive', stressRes.sustainedStress_MPa > 0, `SL=${stressRes.sustainedStress_MPa.toFixed(1)}MPa`);
    record('displacement stress range computed', stressRes.expansionStress_MPa > 0, `SE=${stressRes.expansionStress_MPa.toFixed(1)}MPa`);
    record('allowable displacement stress range computed', stressRes.allowableExpansion_MPa > stressRes.expansionStress_MPa, `SA=${stressRes.allowableExpansion_MPa.toFixed(1)}MPa`);
    record('expansion stress ratio within limits', stressRes.stressRatio_expansion <= 1.0, `ratio=${stressRes.stressRatio_expansion.toFixed(3)}`);
    record('ASME B31.3 code compliance evaluated true', stressRes.codeCompliance === true);
    record('MAWP evaluated', stressRes.mawp && stressRes.mawp.mawp_MPa > 0, `MAWP=${stressRes.mawp?.mawp_MPa}MPa`);
    record('elbow SIF in-plane factor computed', stressRes.elbowFactors && stressRes.elbowFactors.i_i > 1.0, `ii=${stressRes.elbowFactors?.i_i.toFixed(2)}`);
    record('elbow flexibility factor k computed', stressRes.elbowFactors && stressRes.elbowFactors.k > 1.0, `k=${stressRes.elbowFactors?.k.toFixed(2)}`);
    record('reaction force on anchor computed', Number.isFinite(stressRes.reactionForce_N) && stressRes.reactionForce_N > 0, `F=${Math.round(stressRes.reactionForce_N)}N`);
    record('API 610 nozzle check evaluated pass', stressRes.nozzleCheck && stressRes.nozzleCheck.pass === true);

    // API 610 excessive load check
    const excessNozzle = await handlers.get('plant:run-caesar-stress-analysis')(trustedEvent, {
      analysisType: 'nozzle',
      nozzle: {
        nps: '4',
        Fx: 9000,
        Fy: 9000,
        Fz: 9000
      }
    });
    record('API 610 excessive nozzle load flagged', excessNozzle.nozzleCheck && excessNozzle.nozzleCheck.pass === false);

    // Spring hanger selection
    const spring = await handlers.get('plant:run-caesar-stress-analysis')(trustedEvent, {
      analysisType: 'spring',
      support: {
        operatingLoad_N: 15000,
        verticalTravel_mm: 18.5
      }
    });
    record('spring hanger selected', spring.springHanger && spring.springHanger.type === 'Variable Effort Spring Hanger');
    record('spring cold load computed', spring.springHanger && spring.springHanger.coldLoad_N > 0, `Cold=${spring.springHanger?.coldLoad_N}N`);
  }

  // 5. ISOGEN PCF Document Export
  console.log('\n[5] Verifying ISOGEN PCF Document Export...');
  {
    const pcfResult = await handlers.get('plant:export-pcf')(trustedEvent, {
      pipelineRef: '10-P-101-CS150',
      projectName: 'OMNI_PLANT_PROCESS_01',
      components: [
        {
          type: 'PIPE',
          nps: 100,
          ep1: { x: 0, y: 0, z: 0 },
          ep2: { x: 3000, y: 0, z: 0 },
          material: 'ASTM A106-B',
          skey: 'PIPE'
        },
        {
          type: 'ELBOW',
          nps: 100,
          ep1: { x: 3000, y: 0, z: 0 },
          ep2: { x: 3152.4, y: 152.4, z: 0 },
          cp: { x: 3152.4, y: 0, z: 0 },
          skey: 'EL90'
        },
        {
          type: 'FLANGE',
          nps: 100,
          position: { x: 3152.4, y: 152.4, z: 0 },
          rating: '150',
          material: 'ASTM A105',
          skey: 'FLWN'
        }
      ]
    });

    record('PCF export success', pcfResult.success === true);
    record('PCF component count verified', pcfResult.componentCount === 3);
    record('PCF pipeline reference verified', pcfResult.pipelineRef === '10-P-101-CS150');
    record('PCF contains ISOGEN header', pcfResult.pcf.includes('ISOGEN-FILES ISOGEN.FLS'));
    record('PCF contains pipeline reference record', pcfResult.pcf.includes('PIPELINE-REFERENCE 10-P-101-CS150'));
    record('PCF contains PIPE component element', pcfResult.pcf.includes('ELEM PIPE'));
    record('PCF contains ELBOW component element', pcfResult.pcf.includes('ELEM ELBOW'));
    record('PCF contains FLANGE component element', pcfResult.pcf.includes('ELEM FLANGE'));
    record('PCF contains node connectivity records', pcfResult.pcf.includes('NODE 1 1 START'));

    // Empty components fail closed
    const badPcf = await handlers.get('plant:export-pcf')(trustedEvent, { components: [] });
    record('PCF export fails closed on empty components', badPcf.success === false && badPcf.error.code === 'INVALID_INPUT');
  }

  // 6. Preload API Surface Verification
  console.log('\n[6] Verifying Preload API Surface Exposure...');
  {
    const preloadSource = fs.readFileSync(path.join(repositoryRoot, 'preload.js'), 'utf8');
    const exposed = {};
    const invocations = [];

    vm.runInNewContext(
      preloadSource,
      {
        require(moduleName) {
          if (moduleName !== 'electron') throw new Error(`Unexpected preload import: ${moduleName}`);
          return {
            contextBridge: {
              exposeInMainWorld(name, api) {
                exposed[name] = api;
              }
            },
            ipcRenderer: {
              invoke(channel, payload) {
                invocations.push({ channel, payload });
                return Promise.resolve({ success: true, channel });
              }
            }
          };
        }
      },
      { filename: 'preload.js', timeout: 1000 }
    );

    record('electronAPI exposed in preload', typeof exposed.electronAPI === 'object');
    record('electronAPI.plant exposed in preload', typeof exposed.electronAPI?.plant === 'object');
    record('getAsmePipingCatalog exposed in electronAPI.plant', typeof exposed.electronAPI?.plant?.getAsmePipingCatalog === 'function');
    record('generatePiping3DGeometry exposed in electronAPI.plant', typeof exposed.electronAPI?.plant?.generatePiping3DGeometry === 'function');
    record('runCaesarStressAnalysis exposed in electronAPI.plant', typeof exposed.electronAPI?.plant?.runCaesarStressAnalysis === 'function');
    record('exportPCF exposed in electronAPI.plant', typeof exposed.electronAPI?.plant?.exportPCF === 'function');

    // Test calling preload methods and verify exact IPC channels invoked
    invocations.length = 0;
    await exposed.electronAPI.plant.getAsmePipingCatalog({ nps: '4' });
    record('invoked plant:get-asme-piping-catalog', invocations[0]?.channel === 'plant:get-asme-piping-catalog');

    await exposed.electronAPI.plant.generatePiping3DGeometry({ nps: '4' });
    record('invoked plant:generate-piping-3d-geometry', invocations[1]?.channel === 'plant:generate-piping-3d-geometry');

    await exposed.electronAPI.plant.runCaesarStressAnalysis({ nps: '4' });
    record('invoked plant:run-caesar-stress-analysis', invocations[2]?.channel === 'plant:run-caesar-stress-analysis');

    await exposed.electronAPI.plant.exportPCF({ components: [] });
    record('invoked plant:export-pcf', invocations[3]?.channel === 'plant:export-pcf');
  }

  console.log('\n================================================================');
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (require.main === module) {
  runPipingIpcCaesarTests().then(({ failed }) => {
    process.exitCode = failed > 0 ? 1 : 0;
  });
}

module.exports = { runPipingIpcCaesarTests };
