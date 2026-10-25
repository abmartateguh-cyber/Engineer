/**
 * OmniEng Application Controller & Orchestration Logic
 * Coordinates Studio Switching, 3D/2D viewports, manual parameter sliders, and OmniAI Co-Pilot.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const maturityLabel = document.getElementById('status-maturity-label');
  if (maturityLabel && window.omniEngAPI?.getFeatureMaturity) {
    window.omniEngAPI
      .getFeatureMaturity()
      .then((response) => {
        const domains = response?.domains;
        if (!response?.success || !domains || typeof domains !== 'object') {
          maturityLabel.textContent = 'Maturity unknown · assume experimental';
          return;
        }
        const counts = Object.values(domains).reduce((result, entry) => {
          const state = typeof entry?.state === 'string' ? entry.state : 'experimental';
          result[state] = (result[state] || 0) + 1;
          return result;
        }, {});
        const summary = Object.entries(counts)
          .map(([state, count]) => `${count} ${state}`)
          .join(' · ');
        maturityLabel.textContent = `Domain maturity: ${summary || 'experimental'}`;
      })
      .catch(() => {
        maturityLabel.textContent = 'Maturity unavailable · assume experimental';
      });
  }

  // Renderer Error Listener and Audit Event Sender
  window.addEventListener('error', (event) => {
    console.error('[OmniEng Workstation Error Boundary]', event.error || event.message);
    if (window.omniEngAPI?.auditRecordAction) {
      window.omniEngAPI
        .auditRecordAction({
          eventType: 'RENDERER_RUNTIME_ERROR',
          details: { message: event.message, filename: event.filename, lineno: event.lineno }
        })
        .catch(() => {});
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[OmniEng Workstation Unhandled Rejection]', event.reason);
    if (window.omniEngAPI?.auditRecordAction) {
      window.omniEngAPI
        .auditRecordAction({
          eventType: 'RENDERER_UNHANDLED_PROMISE',
          details: { reason: String(event.reason) }
        })
        .catch(() => {});
    }
  });

  // Hydrate all static vector SVG icons across headers, ribbon, tabs, modals
  if (window.OmniIcons) {
    window.OmniIcons.hydrateAll(document);
  }

  // Initialize Viewports
  const viewport3D = new Viewport3D('three-canvas');
  const blockDiagramUI = new BlockDiagramUI('diagram-canvas');
  const schematicLayoutUI = new SchematicLayoutUI('eda-canvas');

  // Expose instances for automation and inspection
  window.viewport3D = viewport3D;
  window.omniAppState = null;

  // Application State
  const state = {
    currentStudio: 'consumer', // 'consumer', 'eda', 'aerospace', 'oilgas', 'simulink', 'universal_cad'
    activeViewMode: '3d', // '3d', 'diagram', 'eda'
    samples: [],
    controls: {
      blockGraphJson: '',
      blockGraphTEndSeconds: '',
      blockGraphDtSeconds: '',
      blockGraphResultSummary: ''
    },
    manualParams: {
      // Consumer Electronics (Phone CAD & Drop/Thermal)
      dropHeight: null,
      phoneMassKg: null,
      impactAngle: null,
      impactAnimationDurationMs: null,
      impactAnimationStepCount: null,

      // Consumer Electronics (Camera Lens Optomechanics & Ray Tracing)
      lensSubTab: 'phone', // 'phone' or 'lens'
      lensFStop: 1.4,
      lensCutawayDeg: 90,
      lensShowRays: true,
      lensSubjectDist: 2.0,
      lensExplodePercent: 0,

      // Semiconductor & EDA
      // Drone & Aerospace
      // Legacy aerospace example views
      nasaRocketArticle: 'full_stack',

      // Oil & Gas Process
      hasExpansionLoop: true,

      // CAD
      cadType: 'box',
      cadWidth: 75,
      cadHeight: 8.2,
      cadDepth: 160,
      massPropertiesDensityKgM3: null,
      massPropertiesDensitySource: ''
    }
  };

  const MANUAL_PARAMETER_EDIT_VALIDATORS = Object.freeze({
    lensFStop: (value) => [1.4, 2, 2.8, 4, 5.6, 8, 11, 16].includes(value),
    lensSubjectDist: (value) => Number.isFinite(value) && value >= 0.5 && value <= 15,
    lensCutawayDeg: (value) => Number.isInteger(value) && value >= 0 && value <= 180 && value % 5 === 0,
    lensShowRays: (value) => typeof value === 'boolean',
    dropHeight: (value) => Number.isFinite(value) && value >= 0.5 && value <= 2.5,
    phoneMassKg: (value) => Number.isFinite(value) && value >= 0.000001 && value <= 1000000,
    impactAngle: (value) => ['corner', 'edge', 'face'].includes(value),
    hasExpansionLoop: (value) => typeof value === 'boolean'
  });
  const STUDIO_IDS = Object.freeze(['consumer', 'eda', 'aerospace', 'oilgas', 'simulink', 'universal_cad']);

  function applySuggestedManualEdit(key, value) {
    if (typeof key !== 'string' || !Object.hasOwn(MANUAL_PARAMETER_EDIT_VALIDATORS, key)) return false;
    const validator = MANUAL_PARAMETER_EDIT_VALIDATORS[key];
    if (typeof validator !== 'function' || !validator(value)) return false;
    state.manualParams[key] = value;
    return true;
  }

  window.omniAppState = state;

  // DOM Elements
  const studioButtons = document.querySelectorAll('.studio-btn');
  const inspectorTitle = document.getElementById('inspector-studio-title');
  const inspectorContainer = document.getElementById('inspector-dynamic-controls');
  const sampleContainer = document.getElementById('sample-list-container');
  const aiChatHistory = document.getElementById('ai-chat-history');
  const aiInput = document.getElementById('ai-input');
  const aiSendBtn = document.getElementById('ai-send-btn');
  const aiChips = document.getElementById('ai-chips');

  // Viewport switch tabs (Universal 3D & 2D Engineering Viewports)
  const btnView3d = document.getElementById('btn-view-3d');
  const btnViewDiagram = document.getElementById('btn-view-diagram');
  const btnViewEda = document.getElementById('btn-view-eda');
  const btnViewPcb = document.getElementById('btn-view-pcb');
  const btnViewPid = document.getElementById('btn-view-pid');
  const btnViewVle = document.getElementById('btn-view-vle');
  const btnViewTray = document.getElementById('btn-view-tray');
  const canvas3D = document.getElementById('three-canvas');
  const canvasDiagram = document.getElementById('diagram-canvas');
  const canvasEda = document.getElementById('eda-canvas');
  const allModeBtns = [btnView3d, btnViewDiagram, btnViewEda, btnViewPcb, btnViewPid, btnViewVle, btnViewTray];

  // Viewport In-Canvas Direct Modeling Toolbar Buttons
  const btnToolSelect = document.getElementById('btn-tool-select');
  const btnToolGizmo = document.getElementById('btn-tool-gizmo');
  const btnToolAddComp = document.getElementById('btn-tool-add-comp');
  const btnToolDelete = document.getElementById('btn-tool-delete');

  // Inspector Dual-Tab Controls (Object Property Grid vs Studio Solvers)
  const tabBtnProperties = document.getElementById('tab-btn-properties');
  const tabBtnSolvers = document.getElementById('tab-btn-solvers');
  const inspectorPropertyGrid = document.getElementById('inspector-property-grid');
  const propertyGridEmpty = document.getElementById('property-grid-empty');
  const propertyGridContent = document.getElementById('property-grid-content');

  function switchInspectorTab(tab) {
    if (tab === 'properties') {
      if (tabBtnProperties) {
        tabBtnProperties.classList.add('active');
        tabBtnProperties.setAttribute('aria-selected', 'true');
      }
      if (tabBtnSolvers) {
        tabBtnSolvers.classList.remove('active');
        tabBtnSolvers.setAttribute('aria-selected', 'false');
      }
      if (inspectorPropertyGrid) inspectorPropertyGrid.style.display = 'block';
      if (inspectorContainer) inspectorContainer.style.display = 'none';
    } else {
      if (tabBtnSolvers) {
        tabBtnSolvers.classList.add('active');
        tabBtnSolvers.setAttribute('aria-selected', 'true');
      }
      if (tabBtnProperties) {
        tabBtnProperties.classList.remove('active');
        tabBtnProperties.setAttribute('aria-selected', 'false');
      }
      if (inspectorPropertyGrid) inspectorPropertyGrid.style.display = 'none';
      if (inspectorContainer) inspectorContainer.style.display = 'block';
    }
  }

  if (tabBtnProperties) tabBtnProperties.addEventListener('click', () => switchInspectorTab('properties'));
  if (tabBtnSolvers) tabBtnSolvers.addEventListener('click', () => switchInspectorTab('solvers'));

  // Load Community Samples synchronously from local source or window, then refresh via IPC if available
  try {
    if (typeof window !== 'undefined' && window.COMMUNITY_SAMPLES && Array.isArray(window.COMMUNITY_SAMPLES)) {
      state.samples = window.COMMUNITY_SAMPLES;
      renderSampleCatalog();
    } else if (typeof require !== 'undefined') {
      try {
        const cs = require('../samples/community_samples');
        if (cs && cs.COMMUNITY_SAMPLES) {
          state.samples = cs.COMMUNITY_SAMPLES;
          renderSampleCatalog();
        }
      } catch (reqErr) {
        // Fallback require ignore
      }
    }

    if (window.omniEngAPI && window.omniEngAPI.getCommunitySamples) {
      window.omniEngAPI
        .getCommunitySamples()
        .then((ipcSamples) => {
          if (ipcSamples && Array.isArray(ipcSamples) && ipcSamples.length) {
            state.samples = ipcSamples;
            renderSampleCatalog();
          }
        })
        .catch((err) => {
          console.warn('IPC getCommunitySamples error', err);
        });
    }
  } catch (err) {
    console.warn('Sample catalog initialization warning', err);
  }

  // Bind Viewport Mode Buttons (7 Dedicated Engineering Operational Modes)
  function setViewMode(mode, syncStudio = true) {
    state.activeViewMode = mode;
    allModeBtns.forEach((b) => {
      if (b) b.classList.remove('active');
    });
    canvas3D.style.display = 'none';
    canvasDiagram.style.display = 'none';
    canvasEda.style.display = 'none';

    // Auto-hide 3D ViewCube nav gizmo in 2D views
    const navGizmo = document.getElementById('viewport-nav-gizmo');
    if (navGizmo) {
      navGizmo.style.display = mode === '3d' ? 'block' : 'none';
    }

    if (mode === '3d') {
      if (btnView3d) btnView3d.classList.add('active');
      canvas3D.style.display = 'block';
      viewport3D.onResize();
      if (
        syncStudio &&
        state.currentStudio !== 'consumer' &&
        state.currentStudio !== 'aerospace' &&
        state.currentStudio !== 'oilgas' &&
        state.currentStudio !== 'universal_cad'
      ) {
        switchStudio('consumer', false);
      }
    } else if (mode === 'diagram') {
      if (btnViewDiagram) btnViewDiagram.classList.add('active');
      canvasDiagram.style.display = 'block';
      blockDiagramUI.onResize();
      if (syncStudio && state.currentStudio !== 'simulink') {
        switchStudio('simulink', false);
      }
    } else if (mode === 'eda' || mode === 'pcb' || mode === 'pid' || mode === 'vle' || mode === 'tray') {
      canvasEda.style.display = 'block';
      const activeBtn =
        mode === 'eda'
          ? btnViewEda
          : mode === 'pcb'
            ? btnViewPcb
            : mode === 'pid'
              ? btnViewPid
              : mode === 'vle'
                ? btnViewVle
                : btnViewTray;
      if (activeBtn) activeBtn.classList.add('active');
      const targetSubMode = mode === 'tray' ? 'tray_profile' : mode;
      schematicLayoutUI.setMode(targetSubMode);
      schematicLayoutUI.onResize();

      if (syncStudio) {
        if ((mode === 'eda' || mode === 'pcb') && state.currentStudio !== 'eda') {
          switchStudio('eda', false);
        } else if ((mode === 'pid' || mode === 'vle' || mode === 'tray') && state.currentStudio !== 'oilgas') {
          switchStudio('oilgas', false);
        }
      }
    }
  }

  if (btnView3d) btnView3d.addEventListener('click', () => setViewMode('3d'));
  if (btnViewDiagram) btnViewDiagram.addEventListener('click', () => setViewMode('diagram'));
  if (btnViewEda) btnViewEda.addEventListener('click', () => setViewMode('eda'));
  if (btnViewPcb) btnViewPcb.addEventListener('click', () => setViewMode('pcb'));
  if (btnViewPid) btnViewPid.addEventListener('click', () => setViewMode('pid'));
  if (btnViewVle) btnViewVle.addEventListener('click', () => setViewMode('vle'));
  if (btnViewTray) btnViewTray.addEventListener('click', () => setViewMode('tray'));

  // Wire Direct Viewport Modeling Tools
  let activeGizmoMode = 'translate';

  if (btnToolSelect) {
    btnToolSelect.addEventListener('click', () => {
      btnToolSelect.classList.add('active');
      switchInspectorTab('properties');
    });
  }

  if (btnToolGizmo) {
    btnToolGizmo.addEventListener('click', () => {
      const modes = ['translate', 'rotate', 'scale'];
      const nextIdx = (modes.indexOf(activeGizmoMode) + 1) % modes.length;
      activeGizmoMode = modes[nextIdx];
      viewport3D.setGizmoMode(activeGizmoMode);
      btnToolGizmo.title = `3D Gizmo: ${activeGizmoMode.toUpperCase()}`;
      const label = btnToolGizmo.querySelector('.v-tool-label');
      if (label) label.textContent = activeGizmoMode.charAt(0).toUpperCase() + activeGizmoMode.slice(1);
    });
  }

  if (btnToolAddComp) {
    btnToolAddComp.addEventListener('click', () => {
      if (state.activeViewMode === '3d') {
        if (viewport3D.currentMesh) {
          const geom = new THREE.CylinderGeometry(8, 8, 20, 16);
          const mat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            metalness: 0.8,
            roughness: 0.25
          });
          const part = new THREE.Mesh(geom, mat);
          part.name = 'Component_Boss_' + Math.floor(Math.random() * 1000);
          part.userData = {
            partName: part.name,
            materialName: 'Unspecified illustrative material',
            category: 'Precision Mechanical Feature'
          };
          part.position.set(0, 20, 0);
          viewport3D.currentMesh.add(part);
          viewport3D.selectPart(part);
        }
      } else if (schematicLayoutUI) {
        schematicLayoutUI.addComponent();
      }
    });
  }

  if (btnToolDelete) {
    btnToolDelete.addEventListener('click', () => {
      if (state.activeViewMode === '3d') {
        viewport3D.deleteSelectedPart();
      } else if (schematicLayoutUI) {
        schematicLayoutUI.deleteSelected();
      }
    });
  }

  // --- Live Interactive Object Property Grid ---
  let selectedEntityData = null;
  let isSelectedEntity3D = false;

  function renderPropertyGrid(props, is3D = true) {
    selectedEntityData = props;
    isSelectedEntity3D = is3D;

    if (!props) {
      if (propertyGridEmpty) propertyGridEmpty.style.display = 'block';
      if (propertyGridContent) {
        propertyGridContent.style.display = 'none';
        propertyGridContent.replaceChildren();
      }
      return;
    }

    if (propertyGridEmpty) propertyGridEmpty.style.display = 'none';
    if (!propertyGridContent) return;

    propertyGridContent.style.display = 'block';
    switchInspectorTab('properties');

    const propertyGridElements = window.OmniPropertyGridView?.createPropertyGridElements(document, props, is3D) || [];
    propertyGridContent.replaceChildren(...propertyGridElements);

    if (window.OmniIcons) {
      window.OmniIcons.hydrateAll(propertyGridContent);
    }

    // Attach Two-Way Live Binding Handlers
    const inX = document.getElementById('prop-input-pos-x');
    const inY = document.getElementById('prop-input-pos-y');
    const inZ = document.getElementById('prop-input-pos-z');
    const inMaterialLabel = document.getElementById('prop-input-material-label');
    const inW = document.getElementById('prop-input-w');
    const inH = document.getElementById('prop-input-h');
    const inDelay = document.getElementById('prop-input-delay');
    const inNet = document.getElementById('prop-input-net');
    const inTemp = document.getElementById('prop-input-temp');
    const inPress = document.getElementById('prop-input-press');
    const btnApply = document.getElementById('btn-prop-apply');
    const btnDelete = document.getElementById('btn-prop-delete');

    function applyLiveChanges() {
      const readOptionalNumberInput = window.OmniPropertyGridView.readOptionalNumberInput;
      if (is3D) {
        const position = {};
        for (const [axis, input] of Object.entries({ x: inX, y: inY, z: inZ })) {
          const value = readOptionalNumberInput(input);
          if (value !== null) position[axis] = value;
        }
        const changes = {};
        if (Object.keys(position).length > 0) changes.position = position;
        if (inMaterialLabel) changes.materialName = inMaterialLabel.value;
        viewport3D.updateSelectedPart(changes);
      } else {
        const changes = {
          delay: inDelay?.value,
          net: inNet?.value,
          temp: inTemp?.value,
          press: inPress?.value
        };
        for (const [key, input] of Object.entries({ x: inX, y: inY, w: inW, h: inH })) {
          const value = readOptionalNumberInput(input);
          if (value !== null) changes[key] = value;
        }
        schematicLayoutUI.updateSelectedEntity(changes);
      }
    }

    [inX, inY, inZ, inMaterialLabel, inW, inH, inDelay, inNet, inTemp, inPress].forEach((input) => {
      if (input) {
        input.addEventListener('input', applyLiveChanges);
        input.addEventListener('change', applyLiveChanges);
      }
    });

    propertyGridContent.querySelectorAll('.prop-step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const axis = btn.dataset.axis;
        const dir = Number(btn.dataset.dir);
        if (!Number.isFinite(dir)) return;
        const targetInput = axis === 'x' ? inX : axis === 'y' ? inY : inZ;
        if (targetInput) {
          const value = window.OmniPropertyGridView.readOptionalNumberInput(targetInput);
          if (value === null) return;
          targetInput.value = (value + dir).toFixed(1);
          applyLiveChanges();
        }
      });
    });

    if (btnApply) {
      btnApply.addEventListener('click', applyLiveChanges);
    }

    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (is3D) {
          viewport3D.deleteSelectedPart();
        } else {
          schematicLayoutUI.deleteSelected();
        }
      });
    }

    const btnInspectWbs = document.getElementById('btn-inspect-wbs-entity');
    if (btnInspectWbs) {
      btnInspectWbs.addEventListener('click', () => {
        if (typeof openNasaWbsModal === 'function') {
          openNasaWbsModal();
        } else if (typeof window.openNasaWbsModal === 'function') {
          window.openNasaWbsModal();
        }
      });
    }
  }

  function syncPropertyGridInputs(props, is3D = true) {
    if (!props || !selectedEntityData) return;
    const inX = document.getElementById('prop-input-pos-x');
    const inY = document.getElementById('prop-input-pos-y');
    const inZ = document.getElementById('prop-input-pos-z');

    if (is3D && props.position) {
      if (inX && document.activeElement !== inX) inX.value = props.position.x;
      if (inY && document.activeElement !== inY) inY.value = props.position.y;
      if (inZ && document.activeElement !== inZ) inZ.value = props.position.z;
    } else if (!is3D) {
      if (inX && document.activeElement !== inX) inX.value = props.x;
      if (inY && document.activeElement !== inY) inY.value = props.y;
    }
  }

  // Connect callbacks
  viewport3D.onSelectPart = (props) => renderPropertyGrid(props, true);
  viewport3D.onPartTransform = (props) => syncPropertyGridInputs(props, true);
  viewport3D.onPartTransformEnd = (props) => syncPropertyGridInputs(props, true);

  schematicLayoutUI.onSelect = (entity) => renderPropertyGrid(entity ? entity.data : null, false);
  schematicLayoutUI.onEntityChange = (entity) => syncPropertyGridInputs(entity ? entity.data : null, false);

  // Studio Switcher Event Binding with WAI-ARIA keyboard navigation
  studioButtons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const studio = btn.dataset.studio;
      switchStudio(studio);
    });
    btn.addEventListener('keydown', (e) => {
      let targetIndex = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        targetIndex = (index + 1) % studioButtons.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        targetIndex = (index - 1 + studioButtons.length) % studioButtons.length;
      }
      if (targetIndex !== null) {
        e.preventDefault();
        studioButtons[targetIndex].focus();
        switchStudio(studioButtons[targetIndex].dataset.studio);
      }
    });
  });

  function switchStudio(studio) {
    if (!STUDIO_IDS.includes(studio)) return;
    state.currentStudio = studio;
    studioButtons.forEach((b) => {
      const isActive = b.dataset.studio === studio;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      b.tabIndex = isActive ? 0 : -1;
    });

    // Update 3D scene & Inspector (default to Studio Solvers tab)
    switchInspectorTab('solvers');
    if (studio === 'consumer') {
      inspectorTitle.textContent = 'Consumer Electronics Studio';
      setViewMode('3d');
      if (state.manualParams.lensSubTab === 'lens') {
        const cutawayRad = (state.manualParams.lensCutawayDeg * Math.PI) / 180;
        viewport3D.renderCameraLens3D(
          true,
          cutawayRad,
          state.manualParams.lensExplodePercent / 100,
          state.manualParams.lensFStop,
          state.manualParams.lensShowRays
        );
      } else {
        viewport3D.renderSmartphoneCad(
          state.manualParams.cadWidth,
          state.manualParams.cadHeight,
          state.manualParams.cadDepth
        );
      }
      renderConsumerInspector();
    } else if (studio === 'eda') {
      inspectorTitle.textContent = 'Semiconductor & EDA Studio';
      setViewMode('eda');
      schematicLayoutUI.setMode('eda');
      renderEdaInspector();
    } else if (studio === 'aerospace') {
      inspectorTitle.textContent = 'Experimental Aerospace Visualization Studio';
      setViewMode('3d');
      if (state.manualParams.nasaRocketArticle === 'drone') {
        viewport3D.renderDrone3D(85);
      } else if (
        state.manualParams.nasaRocketArticle === 'macro_engine' ||
        state.manualParams.nasaRocketArticle === 'engine_macro'
      ) {
        viewport3D.renderNasaSpaceRocket3D('engine_macro');
      } else if (
        state.manualParams.nasaRocketArticle === 'spacecraft_interior' ||
        state.manualParams.nasaRocketArticle === 'spaceship_interior'
      ) {
        viewport3D.renderNasaSpaceRocket3D('spacecraft_interior');
      } else {
        state.manualParams.nasaRocketArticle = 'full_stack';
        viewport3D.renderNasaSpaceRocket3D('full_stack');
      }
      renderAerospaceInspector();
    } else if (studio === 'oilgas') {
      inspectorTitle.textContent = 'Oil & Gas Process Studio';
      setViewMode('3d');
      viewport3D.renderPipingLoop3D(state.manualParams.hasExpansionLoop ? 40 : 25, 10, 6);
      renderOilGasInspector();
    } else if (studio === 'simulink') {
      inspectorTitle.textContent = 'Block Diagram and Controls Studio';
      setViewMode('diagram');
      renderSimulinkInspector();
    } else if (studio === 'universal_cad') {
      inspectorTitle.textContent = 'Parametric CAD Studio';
      setViewMode('3d');
      viewport3D.renderSmartphoneCad(
        state.manualParams.cadWidth,
        state.manualParams.cadHeight,
        state.manualParams.cadDepth
      );
      renderCadInspector();
    }

    if (window.OmniIcons && inspectorContainer) {
      window.OmniIcons.hydrateAll(inspectorContainer);
    }

    // Update Contextual Studio Ribbon Filter
    const ribbon = document.querySelector('.engineering-ribbon');
    if (ribbon) {
      ribbon.classList.remove(
        'filter-consumer',
        'filter-eda',
        'filter-aerospace',
        'filter-oilgas',
        'filter-simulink',
        'filter-universal_cad'
      );
      ribbon.classList.add(`filter-${studio}`);
    }
  }

  // --- Dynamic Inspector Panels (Full Manual Editing Support) ---

  // Optical estimates run only through IPC with explicit form inputs.
  async function calculateOptics(inputs) {
    if (!window.omniEngAPI?.solveOptics) throw new Error('Optical calculation service is unavailable.');
    return window.omniEngAPI.solveOptics(inputs);
  }

  function renderConsumerInspector() {
    const isLens = state.manualParams.lensSubTab === 'lens';
    const boundedUiNumber = (value, minimum, maximum, fallback) =>
      typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
    const lensFStopOptions = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
    const lensFStop = lensFStopOptions.includes(state.manualParams.lensFStop) ? state.manualParams.lensFStop : 1.4;
    const lensCutawayDeg = boundedUiNumber(state.manualParams.lensCutawayDeg, 0, 180, 90);
    const lensExplodePercent = boundedUiNumber(state.manualParams.lensExplodePercent, 0, 100, 0);
    const lensSubjectDist = boundedUiNumber(state.manualParams.lensSubjectDist, 0.5, 15, 2);
    const lensShowRays = typeof state.manualParams.lensShowRays === 'boolean' ? state.manualParams.lensShowRays : true;
    const cadWidth = boundedUiNumber(state.manualParams.cadWidth, 60, 90, 75);
    const cadHeight = boundedUiNumber(state.manualParams.cadHeight, 6.5, 12, 8.2);
    const dropHeight = boundedUiNumber(state.manualParams.dropHeight, 0.5, 2.5, null);
    const phoneMassKg = boundedUiNumber(state.manualParams.phoneMassKg, 0.000001, 1000000, null);
    const impactAngle = ['corner', 'edge', 'face'].includes(state.manualParams.impactAngle)
      ? state.manualParams.impactAngle
      : '';
    const impactAnimationDurationMs = boundedUiNumber(
      state.manualParams.impactAnimationDurationMs,
      0.001,
      1000000,
      null
    );
    const impactAnimationStepCount =
      Number.isInteger(state.manualParams.impactAnimationStepCount) &&
      state.manualParams.impactAnimationStepCount >= 1 &&
      state.manualParams.impactAnimationStepCount <= 10000
        ? state.manualParams.impactAnimationStepCount
        : null;

    // Sub-tab switcher header
    let html = `
      <div style="display: flex; gap: 6px; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
        <button id="subtab-phone" class="ribbon-btn ${!isLens ? 'active' : ''}" style="flex: 1; padding: 6px 4px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;"><span class="icon-slot" data-omni-icon="smartphone"></span> Smartphone CAD</button>
        <button id="subtab-lens" class="ribbon-btn ${isLens ? 'active' : ''}" style="flex: 1; padding: 6px 4px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;"><span class="icon-slot" data-omni-icon="cameraLens"></span> Illustrative Lens Sample</button>
      </div>
    `;

    if (isLens) {
      // --- Illustrative camera-lens visualization ---
      html += `
        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="cameraLens"></span> Illustrative 50mm Lens Cutaway</span>
            <span class="tag">Sample geometry only</span>
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span>Aperture f-Stop (9-Blade Dynamic Iris):</span>
              <span class="param-val" id="val-lens-fstop" style="color: var(--accent-cyan); font-weight:700;">f/${lensFStop}</span>
            </div>
            <select class="select-input" id="select-lens-fstop">
              <option value="1.4" ${lensFStop === 1.4 ? 'selected' : ''}>f/1.4 (Max Aperture / 35.7mm Pupil)</option>
              <option value="2.0" ${lensFStop === 2.0 ? 'selected' : ''}>f/2.0 (25.0mm Pupil)</option>
              <option value="2.8" ${lensFStop === 2.8 ? 'selected' : ''}>f/2.8 (17.9mm Pupil)</option>
              <option value="4.0" ${lensFStop === 4.0 ? 'selected' : ''}>f/4.0 (12.5mm Pupil)</option>
              <option value="5.6" ${lensFStop === 5.6 ? 'selected' : ''}>f/5.6 (Sweet Spot Sharpness)</option>
              <option value="8.0" ${lensFStop === 8.0 ? 'selected' : ''}>f/8.0 (Deep Landscape Sharpness)</option>
              <option value="11.0" ${lensFStop === 11.0 ? 'selected' : ''}>f/11 (Deep Focus)</option>
              <option value="16.0" ${lensFStop === 16.0 ? 'selected' : ''}>f/16 (Min Aperture / 3.1mm Pupil)</option>
            </select>
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span>Barrel 3D Cutaway Angle:</span>
              <span class="param-val" id="val-lens-cutaway">${lensCutawayDeg}° (${lensCutawayDeg === 90 ? 'Quadrant View' : lensCutawayDeg === 180 ? 'Half-Section' : lensCutawayDeg === 0 ? 'Sealed' : 'Custom'})</span>
            </div>
            <input type="range" class="slider-input" min="0" max="180" step="5" value="${lensCutawayDeg}" id="slider-lens-cutaway">
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span>Optical Axis Explode:</span>
              <span class="param-val" id="val-lens-explode">${lensExplodePercent}%</span>
            </div>
            <input type="range" class="slider-input" min="0" max="100" step="1" value="${lensExplodePercent}" id="slider-lens-explode">
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span>Subject Focus Distance:</span>
              <span class="param-val" id="val-lens-dist">${lensSubjectDist} m</span>
            </div>
            <input type="range" class="slider-input" min="0.5" max="15.0" step="0.1" value="${lensSubjectDist}" id="slider-lens-dist">
          </div>

          <div class="param-row">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); cursor: pointer;">
              <input type="checkbox" id="chk-lens-rays" ${lensShowRays ? 'checked' : ''}>
              <span>Trace Paraxial Light Rays (Pupil to Sensor Plane)</span>
            </label>
          </div>

        </div>

        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="optics"></span> Experimental Scalar Estimate</span>
            <span class="tag">All inputs required</span>
          </div>
          <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 8px;">These values are independent of the illustrative lens cutaway. No optical prescription or image-quality trace is calculated.</div>
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
            <label style="font-size: 10px;">Focal length (mm)<input class="text-input" id="input-lens-estimate-focal-length" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:3px;"></label>
            <label style="font-size: 10px;">F-number<input class="text-input" id="input-lens-estimate-f-number" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:3px;"></label>
            <label style="font-size: 10px;">Subject distance (m)<input class="text-input" id="input-lens-estimate-distance" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:3px;"></label>
            <label style="font-size: 10px;">Wavelength (nm)<input class="text-input" id="input-lens-estimate-wavelength" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:3px;"></label>
            <label style="font-size: 10px;">Circle of confusion (mm)<input class="text-input" id="input-lens-estimate-coc" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:3px;"></label>
          </div>
          <button class="btn-primary" id="btn-run-optics" style="margin-top: 10px;">
            <span>Run scalar estimate</span>
          </button>
          <div id="lens-optics-telemetry"></div>
        </div>

        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="lensElement"></span> Illustrative 8-Element Lens Example</span>
            <span class="tag">Synthetic prescription</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">Glass labels and values are illustrative; this is not a sourced prescription or materials catalog.</div>
          <div style="max-height: 155px; overflow-y: auto; font-size: 10px; font-family: var(--font-mono); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 6px; background: rgba(0,0,0,0.25);">
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead>
                <tr style="color: var(--text-dim); border-bottom: 1px solid var(--border-subtle);">
                  <th style="padding: 2px;">Grp</th>
                  <th style="padding: 2px;">Elem</th>
                  <th style="padding: 2px;">Glass</th>
                  <th style="padding: 2px;">nd</th>
                  <th style="padding: 2px;">Vd</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="color:var(--accent-cyan);">G1</td><td>E1 (Asph)</td><td>Glass A</td><td>1.517</td><td>64.2</td></tr>
                <tr><td style="color:var(--accent-cyan);">G2</td><td>E2</td><td>Glass B</td><td>1.785</td><td>25.8</td></tr>
                <tr><td style="color:var(--accent-cyan);">G3</td><td>E3</td><td>Glass A</td><td>1.517</td><td>64.2</td></tr>
                <tr><td style="color:var(--accent-cyan);">G3</td><td>E4</td><td>Glass B</td><td>1.785</td><td>25.8</td></tr>
                <tr style="background: rgba(245, 158, 11, 0.12); color: var(--accent-amber); font-weight:700;"><td colspan="5" style="padding: 2px;"><span class="icon-slot" data-omni-icon="aperture"></span> 9-Blade Dynamic Iris Diaphragm</td></tr>
                <tr><td style="color:var(--accent-green);">G4</td><td>E5 (ED)</td><td>Glass C</td><td>1.434</td><td>95.3</td></tr>
                <tr><td style="color:var(--accent-green);">G5</td><td>E6</td><td>Glass A</td><td>1.517</td><td>64.2</td></tr>
                <tr><td style="color:var(--accent-green);">G6</td><td>E7</td><td>Glass B</td><td>1.785</td><td>25.8</td></tr>
                <tr><td style="color:var(--accent-green);">G6</td><td>E8</td><td>Glass A</td><td>1.517</td><td>64.2</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      // --- Synthetic device geometry, experimental impact estimate, thermal example ---
      html += `
        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="smartphone"></span> Phone Packaging CAD</span>
            <span class="tag">Experimental example</span>
          </div>
          <div class="param-row">
            <div class="param-label-row">
              <span>Chassis Width:</span>
              <span class="param-val" id="val-cad-w">${cadWidth} mm</span>
            </div>
            <input type="range" class="slider-input" min="60" max="90" step="1" value="${cadWidth}" id="slider-cad-w">
          </div>
          <div class="param-row">
            <div class="param-label-row">
              <span>Chassis Thickness:</span>
              <span class="param-val" id="val-cad-h">${cadHeight} mm</span>
            </div>
            <input type="range" class="slider-input" min="6.5" max="12.0" step="0.1" value="${cadHeight}" id="slider-cad-h">
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-cad-depth-mm">Cuboid length (mm)</label>
            <input class="text-input" id="input-cad-depth-mm" type="number" min="0.001" step="any" required>
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-mass-density">Caller-supplied effective density (kg/m³)</label>
            <input class="text-input" id="input-mass-density" type="number" min="0.000001" step="any" required>
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-mass-density-source">Density source</label>
            <input class="text-input" id="input-mass-density-source" type="text" maxlength="1000" required placeholder="Enter a measurement, datasheet, or other source">
          </div>
          <div class="status-indicator status-warn">No reviewed material catalog is bundled. The calculation below uses only your supplied density and treats the visible dimensions as a homogeneous solid cuboid; it does not identify or qualify a material.</div>
          <button class="btn-primary" id="btn-calculate-mass-properties" type="button">Calculate cuboid mass properties</button>
          <div class="status-indicator status-warn" id="mass-properties-result" role="status" aria-live="polite">Enter a positive density and its source, then calculate.</div>
        </div>

        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="dropTest"></span> Experimental Impact Estimate</span>
            <span class="tag">Example assumptions only</span>
          </div>
          <div class="param-row">
            <div class="param-label-row">
              <span>Drop Height:</span>
              <span class="param-val" id="val-drop-h">${dropHeight === null ? 'Required' : `${dropHeight} m`}</span>
            </div>
            <input class="text-input" id="slider-drop-h" type="number" min="0.5" max="2.5" step="0.1" required value="${dropHeight ?? ''}" aria-describedby="drop-height-help">
            <div id="drop-height-help" style="font-size: 10px; color: var(--text-muted);">Enter the drop height in meters. No height is assumed.</div>
          </div>
          <div class="param-row">
            <div class="param-label-row">
              <span>Impact Orientation:</span>
            </div>
            <select class="select-input" id="select-drop-angle" required>
              <option value="" disabled ${impactAngle === '' ? 'selected' : ''}>Choose an orientation</option>
              <option value="corner" ${impactAngle === 'corner' ? 'selected' : ''}>Corner Impact (High Shear)</option>
              <option value="edge" ${impactAngle === 'edge' ? 'selected' : ''}>Side Edge Impact</option>
              <option value="face" ${impactAngle === 'face' ? 'selected' : ''}>Front Screen Flat Impact</option>
            </select>
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-drop-mass">
              <span>Device Mass:</span><span class="param-val">kg</span>
            </label>
            <input class="text-input" id="input-drop-mass" type="number" min="0.000001" step="any" required value="${phoneMassKg ?? ''}" aria-describedby="drop-mass-help">
            <div id="drop-mass-help" style="font-size: 10px; color: var(--text-muted);">Enter the device mass in kilograms. No mass is assumed.</div>
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-drop-duration-ms">
              <span>Animation Duration:</span><span class="param-val">ms</span>
            </label>
            <input class="text-input" id="input-drop-duration-ms" type="number" min="0.001" step="any" required value="${impactAnimationDurationMs ?? ''}">
          </div>
          <div class="param-row">
            <label class="param-label-row" for="input-drop-step-count">
              <span>Animation Frames:</span><span class="param-val">count</span>
            </label>
            <input class="text-input" id="input-drop-step-count" type="number" min="1" max="10000" step="1" required value="${impactAnimationStepCount ?? ''}">
          </div>
          <button class="btn-primary" id="btn-run-drop" style="display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span class="icon-slot" data-omni-icon="play"></span> <span>Run Impact Example</span>
          </button>
          <div id="drop-telemetry-container"></div>
        </div>

        <div class="param-group">
          <div class="param-group-title">
            <span style="display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="thermalCht"></span> Handset Thermal Analysis</span>
            <span class="tag">Unavailable</span>
          </div>
          <div class="status-indicator status-warn">Unavailable: no independently reviewed handset thermal model, material-property set, geometry, or boundary conditions are configured.</div>
        </div>
      `;
    }

    inspectorContainer.innerHTML = html;

    // Subtab button handlers
    const btnSubPhone = document.getElementById('subtab-phone');
    const btnSubLens = document.getElementById('subtab-lens');
    if (btnSubPhone) {
      btnSubPhone.addEventListener('click', () => {
        state.manualParams.lensSubTab = 'phone';
        viewport3D.renderSmartphoneCad(
          state.manualParams.cadWidth,
          state.manualParams.cadHeight,
          state.manualParams.cadDepth
        );
        renderConsumerInspector();
      });
    }
    if (btnSubLens) {
      btnSubLens.addEventListener('click', () => {
        state.manualParams.lensSubTab = 'lens';
        const cutawayRad = (state.manualParams.lensCutawayDeg * Math.PI) / 180;
        viewport3D.renderCameraLens3D(
          true,
          cutawayRad,
          state.manualParams.lensExplodePercent / 100,
          state.manualParams.lensFStop,
          state.manualParams.lensShowRays
        );
        renderConsumerInspector();
      });
    }

    if (isLens) {
      // Bind Lens controls
      async function updateOpticalTelemetry() {
        const container = document.getElementById('lens-optics-telemetry');
        if (!container) return;
        const inputs = {
          focalLengthMm: Number(document.getElementById('input-lens-estimate-focal-length')?.value),
          fStop: Number(document.getElementById('input-lens-estimate-f-number')?.value),
          subjectDistM: Number(document.getElementById('input-lens-estimate-distance')?.value),
          wavelengthNm: Number(document.getElementById('input-lens-estimate-wavelength')?.value),
          circleOfConfusionMm: Number(document.getElementById('input-lens-estimate-coc')?.value)
        };
        if (Object.values(inputs).some((value) => !Number.isFinite(value) || value <= 0)) {
          container.textContent = 'No estimate run. Enter a positive value for each scalar input above.';
          return;
        }
        try {
          const res = await calculateOptics(inputs);
          window.OmniEngineeringResultView?.renderOpticsEstimateResult(res, document, container);
        } catch (err) {
          container.textContent = `No estimate was returned: ${String(err?.message || 'calculation failed')}`;
        }
      }

      function refreshLens3D() {
        const cutawayRad = (state.manualParams.lensCutawayDeg * Math.PI) / 180;
        viewport3D.renderCameraLens3D(
          true,
          cutawayRad,
          state.manualParams.lensExplodePercent / 100,
          state.manualParams.lensFStop,
          state.manualParams.lensShowRays
        );
      }

      const selectFStop = document.getElementById('select-lens-fstop');
      if (selectFStop) {
        selectFStop.addEventListener('change', (e) => {
          state.manualParams.lensFStop = Number(e.target.value);
          const valEl = document.getElementById('val-lens-fstop');
          if (valEl) valEl.textContent = `f/${state.manualParams.lensFStop}`;
          refreshLens3D();
        });
      }

      const sliderCutaway = document.getElementById('slider-lens-cutaway');
      if (sliderCutaway) {
        sliderCutaway.addEventListener('input', (e) => {
          state.manualParams.lensCutawayDeg = Number(e.target.value);
          const tag =
            state.manualParams.lensCutawayDeg === 90
              ? 'Quadrant View'
              : state.manualParams.lensCutawayDeg === 180
                ? 'Half-Section'
                : state.manualParams.lensCutawayDeg === 0
                  ? 'Sealed'
                  : 'Custom';
          const valEl = document.getElementById('val-lens-cutaway');
          if (valEl) valEl.textContent = `${state.manualParams.lensCutawayDeg}° (${tag})`;
          refreshLens3D();
        });
      }

      const sliderExplode = document.getElementById('slider-lens-explode');
      if (sliderExplode) {
        sliderExplode.addEventListener('input', (e) => {
          state.manualParams.lensExplodePercent = Number(e.target.value);
          const valEl = document.getElementById('val-lens-explode');
          if (valEl) valEl.textContent = `${state.manualParams.lensExplodePercent}%`;
          viewport3D.setExplodeFactor(state.manualParams.lensExplodePercent / 100);
          if (ribbonExplodeSlider) ribbonExplodeSlider.value = state.manualParams.lensExplodePercent;
          if (ribbonExplodeVal) ribbonExplodeVal.textContent = `${state.manualParams.lensExplodePercent}%`;
        });
      }

      const sliderDist = document.getElementById('slider-lens-dist');
      if (sliderDist) {
        sliderDist.addEventListener('input', (e) => {
          state.manualParams.lensSubjectDist = Number(e.target.value);
          const valEl = document.getElementById('val-lens-dist');
          if (valEl) valEl.textContent = `${state.manualParams.lensSubjectDist} m`;
        });
      }

      const chkRays = document.getElementById('chk-lens-rays');
      if (chkRays) {
        chkRays.addEventListener('change', (e) => {
          state.manualParams.lensShowRays = e.target.checked;
          refreshLens3D();
        });
      }

      const btnRunOptics = document.getElementById('btn-run-optics');
      if (btnRunOptics) {
        btnRunOptics.addEventListener('click', () => {
          refreshLens3D();
          updateOpticalTelemetry();
        });
      }
      const scalarInputIds = [
        'input-lens-estimate-focal-length',
        'input-lens-estimate-f-number',
        'input-lens-estimate-distance',
        'input-lens-estimate-wavelength',
        'input-lens-estimate-coc'
      ];
      for (const id of scalarInputIds) {
        document.getElementById(id)?.addEventListener('input', () => {
          const container = document.getElementById('lens-optics-telemetry');
          if (container) container.textContent = 'Inputs changed. Run the estimate again to update the result.';
        });
      }
    } else {
      // Bind device example, impact estimate, and thermal example controls
      const sliderW = document.getElementById('slider-cad-w');
      const sliderH = document.getElementById('slider-cad-h');
      const depthInput = document.getElementById('input-cad-depth-mm');
      const densityInput = document.getElementById('input-mass-density');
      const densitySourceInput = document.getElementById('input-mass-density-source');
      const massPropertiesResult = document.getElementById('mass-properties-result');
      if (depthInput) depthInput.value = String(state.manualParams.cadDepth);
      if (densityInput && Number.isFinite(state.manualParams.massPropertiesDensityKgM3)) {
        densityInput.value = String(state.manualParams.massPropertiesDensityKgM3);
      }
      if (densitySourceInput) densitySourceInput.value = state.manualParams.massPropertiesDensitySource;

      const invalidateMassProperties = () => {
        if (!massPropertiesResult) return;
        massPropertiesResult.textContent = 'Inputs changed. Recalculate to update the cuboid estimate.';
        massPropertiesResult.style.whiteSpace = 'normal';
      };
      sliderW?.addEventListener('input', (e) => {
        state.manualParams.cadWidth = Number(e.target.value);
        const valW = document.getElementById('val-cad-w');
        if (valW) valW.textContent = `${state.manualParams.cadWidth} mm`;
        if (viewport3D?.renderSmartphoneCad) {
          viewport3D.renderSmartphoneCad(
            state.manualParams.cadWidth,
            state.manualParams.cadHeight,
            state.manualParams.cadDepth
          );
        }
        invalidateMassProperties();
      });
      sliderH?.addEventListener('input', (e) => {
        state.manualParams.cadHeight = Number(e.target.value);
        const valH = document.getElementById('val-cad-h');
        if (valH) valH.textContent = `${state.manualParams.cadHeight} mm`;
        if (viewport3D?.renderSmartphoneCad) {
          viewport3D.renderSmartphoneCad(
            state.manualParams.cadWidth,
            state.manualParams.cadHeight,
            state.manualParams.cadDepth
          );
        }
        invalidateMassProperties();
      });
      depthInput?.addEventListener('input', (e) => {
        const depthMm = Number(e.target.value);
        if (!Number.isFinite(depthMm) || depthMm <= 0) {
          invalidateMassProperties();
          return;
        }
        state.manualParams.cadDepth = depthMm;
        if (viewport3D?.renderSmartphoneCad) {
          viewport3D.renderSmartphoneCad(
            state.manualParams.cadWidth,
            state.manualParams.cadHeight,
            state.manualParams.cadDepth
          );
        }
        invalidateMassProperties();
      });
      densityInput?.addEventListener('input', (e) => {
        state.manualParams.massPropertiesDensityKgM3 = e.target.value === '' ? null : Number(e.target.value);
        invalidateMassProperties();
      });
      densitySourceInput?.addEventListener('input', (e) => {
        state.manualParams.massPropertiesDensitySource = e.target.value;
        invalidateMassProperties();
      });
      document.getElementById('btn-calculate-mass-properties')?.addEventListener('click', async () => {
        const widthM = Number(sliderW?.value) / 1000;
        const heightM = Number(sliderH?.value) / 1000;
        const depthM = Number(depthInput?.value) / 1000;
        const densityKgM3 = Number(densityInput?.value);
        const densitySource = densitySourceInput?.value.trim() || '';
        if (
          ![widthM, heightM, depthM, densityKgM3].every((value) => Number.isFinite(value) && value > 0) ||
          !densitySource
        ) {
          if (massPropertiesResult) {
            massPropertiesResult.textContent =
              'Provide positive cuboid dimensions, a positive density, and the density source.';
          }
          return;
        }
        if (!window.omniEngAPI?.computeCuboidMassProperties) {
          if (massPropertiesResult)
            massPropertiesResult.textContent = 'Cuboid mass properties are unavailable in this application build.';
          return;
        }

        if (massPropertiesResult) massPropertiesResult.textContent = 'Calculating analytical cuboid properties…';
        try {
          const response = await window.omniEngAPI.computeCuboidMassProperties({
            widthM,
            heightM,
            depthM,
            densityKgM3,
            densitySource
          });
          if (!response?.success || !response.results) {
            throw new Error(response?.error?.message || 'The calculation returned no result.');
          }
          const formatValue = (value) => Number(value).toPrecision(5);
          if (massPropertiesResult) {
            massPropertiesResult.style.whiteSpace = 'pre-line';
            massPropertiesResult.textContent = [
              `${response.model} estimate (experimental)`,
              `Density: ${formatValue(densityKgM3)} kg/m³`,
              `Density source: ${densitySource}`,
              `Volume: ${formatValue(response.results.volumeM3)} m³`,
              `Mass: ${formatValue(response.results.massKg)} kg`,
              `Centroidal inertia Ixx / Iyy / Izz: ${formatValue(response.results.Ixx)} / ${formatValue(response.results.Iyy)} / ${formatValue(response.results.Izz)} kg·m²`,
              'Assumption: solid cuboid with uniform density; this does not represent internal parts or establish material properties.'
            ].join('\n');
          }
        } catch (error) {
          if (massPropertiesResult)
            massPropertiesResult.textContent = `Could not calculate cuboid mass properties: ${error.message}`;
        }
      });

      const sliderDropH = document.getElementById('slider-drop-h');
      sliderDropH?.addEventListener('input', (e) => {
        state.manualParams.dropHeight = e.target.value === '' ? null : Number(e.target.value);
        const valDrop = document.getElementById('val-drop-h');
        if (valDrop) {
          valDrop.textContent =
            state.manualParams.dropHeight === null ? 'Required' : `${state.manualParams.dropHeight} m`;
        }
      });

      const selectDropAngle = document.getElementById('select-drop-angle');
      selectDropAngle?.addEventListener('change', (e) => {
        state.manualParams.impactAngle = e.target.value || null;
      });

      document.getElementById('input-drop-mass')?.addEventListener('input', (e) => {
        state.manualParams.phoneMassKg = e.target.value === '' ? null : Number(e.target.value);
      });

      document.getElementById('input-drop-duration-ms')?.addEventListener('input', (e) => {
        state.manualParams.impactAnimationDurationMs = e.target.value === '' ? null : Number(e.target.value);
      });

      document.getElementById('input-drop-step-count')?.addEventListener('input', (e) => {
        state.manualParams.impactAnimationStepCount = e.target.value === '' ? null : Number(e.target.value);
      });

      document.getElementById('btn-run-drop')?.addEventListener('click', async () => {
        const dropContainer = document.getElementById('drop-telemetry-container');
        const dropHeightM = Number(document.getElementById('slider-drop-h')?.value);
        const impactAngle = document.getElementById('select-drop-angle')?.value;
        const phoneMassKg = Number(document.getElementById('input-drop-mass')?.value);
        if (!Number.isFinite(dropHeightM) || dropHeightM < 0.5 || dropHeightM > 2.5) {
          if (dropContainer) dropContainer.textContent = 'No estimate was run. Enter a drop height from 0.5 to 2.5 m.';
          return;
        }
        if (!['corner', 'edge', 'face'].includes(impactAngle)) {
          if (dropContainer) dropContainer.textContent = 'No estimate was run. Choose an impact orientation.';
          return;
        }
        if (!Number.isFinite(phoneMassKg) || phoneMassKg <= 0) {
          if (dropContainer)
            dropContainer.textContent = 'No estimate was run. Enter a positive device mass in kilograms.';
          return;
        }
        if (dropContainer) dropContainer.textContent = 'Running experimental impact estimate...';

        let res;
        try {
          res = await window.omniEngAPI.solveDropTest({
            dropHeight: dropHeightM,
            phoneMass: phoneMassKg,
            impactAngle
          });
        } catch (error) {
          if (dropContainer) dropContainer.textContent = `No estimate was returned: ${String(error?.message ?? error)}`;
          return;
        }
        if (!res?.inputs) {
          if (dropContainer) dropContainer.textContent = 'No estimate was returned for the supplied inputs.';
          return;
        }

        let transientRes = null;
        let transientStatusMessage = '';
        const totalDurationMs = Number(document.getElementById('input-drop-duration-ms')?.value);
        const stepCount = Number(document.getElementById('input-drop-step-count')?.value);
        if (
          !Number.isFinite(totalDurationMs) ||
          totalDurationMs <= 0 ||
          !Number.isInteger(stepCount) ||
          stepCount < 1
        ) {
          transientStatusMessage =
            'Animation history was not generated. Enter a positive duration and a positive whole-number frame count.';
          if (viewport3D?.loadTransientDropData) viewport3D.loadTransientDropData(null);
        } else {
          try {
            transientRes = await window.omniEngAPI.solveTransientDrop({
              dropHeightM,
              phoneMassKg,
              impactAngle,
              totalDurationMs,
              stepCount
            });
            if (viewport3D?.loadTransientDropData) viewport3D.loadTransientDropData(transientRes);
          } catch (err) {
            transientStatusMessage = 'Animation history is unavailable for the supplied inputs.';
            console.warn('Transient animation history unavailable', err);
            if (viewport3D?.loadTransientDropData) viewport3D.loadTransientDropData(null);
          }
        }

        const curDrop = document.getElementById('drop-telemetry-container');
        if (curDrop) {
          curDrop.replaceChildren();
          const card = document.createElement('div');
          card.className = 'telemetry-card';
          const addRow = (label, value) => {
            const row = document.createElement('div');
            row.className = 'telemetry-row';
            const labelElement = document.createElement('span');
            labelElement.className = 'telemetry-label';
            labelElement.textContent = label;
            const valueElement = document.createElement('span');
            valueElement.className = 'telemetry-value';
            valueElement.textContent = String(value);
            row.append(labelElement, valueElement);
            card.appendChild(row);
          };
          addRow(
            'Inputs Used:',
            `${res.inputs.phoneMassKg} kg, ${res.inputs.dropHeightM} m, ${res.inputs.impactAngle}`
          );
          addRow('Impact Velocity Estimate:', `${res.impactVelocity} m/s`);
          addRow('Peak Deceleration Estimate:', `${res.peakDeceleration_G} G`);
          addRow('Screen Stress Estimate:', `${res.peakScreenStress_MPa} MPa`);
          addRow('Chassis Stress Estimate:', `${res.peakChassisStress_MPa} MPa`);

          const details = document.createElement('details');
          details.style.cssText = 'margin-top:8px;font-size:11px;color:var(--text-muted);';
          const summary = document.createElement('summary');
          summary.textContent = 'Bundled model assumptions';
          const pre = document.createElement('pre');
          pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;';
          pre.textContent = JSON.stringify(
            {
              impactEstimate: { inputs: res.inputs, assumptions: res.modelAssumptions },
              transientAnimation: transientRes
                ? { inputs: transientRes.inputs, assumptions: transientRes.modelAssumptions }
                : null
            },
            null,
            2
          );
          details.append(summary, pre);
          card.appendChild(details);

          const warning = document.createElement('div');
          warning.className = 'status-indicator status-warn';
          warning.textContent =
            'EXPERIMENTAL ESTIMATE ONLY. The bundled contact and stress assumptions are illustrative; no pass/fail or material failure assessment is made.';
          card.appendChild(warning);
          if (transientStatusMessage) {
            const transientStatus = document.createElement('div');
            transientStatus.className = 'status-indicator status-warn';
            transientStatus.textContent = transientStatusMessage;
            card.appendChild(transientStatus);
          }
          curDrop.appendChild(card);
        }
      });
    }
  }

  function renderEdaInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="circuit"></span> Experimental RTL Logic Estimate</span>
          <span class="tag">Simplified model</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Verilog Code:</span>
          </div>
          <textarea class="text-input" id="txt-verilog" placeholder="Paste a Verilog module with a simple assignment, such as assign y = a & b;" style="height: 110px; font-family: var(--font-mono); font-size: 11px;"></textarea>
        </div>
        <button class="btn-primary" id="btn-run-synth">
          <span>Inspect supported Verilog subset</span>
        </button>
        <div id="synth-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="drcCheck"></span> Rectangle Rule Screen</span>
          <span class="tag">Experimental EDA workflow</span>
        </div>
        <div class="param-row"><span class="status-indicator status-warn">Paste explicit rectangle geometry and positive minWidth, minSpacing, and minArea limits. Units must match. No process rule deck is configured.</span></div>
        <button class="btn-primary" id="btn-run-drc">
          <span>Run supplied rectangle screen</span>
        </button>
        <div id="drc-telemetry-container"></div>
      </div>
    `;

    document.getElementById('btn-run-synth')?.addEventListener('click', async () => {
      const telem = document.getElementById('synth-telemetry-container');
      try {
        const code = document.getElementById('txt-verilog')?.value || '';
        const res = await window.omniEngAPI.synthesizeVerilog(code);
        if (!res?.success) throw new Error(res?.error?.message || 'The limited Verilog analysis is unavailable.');
        if (telem) {
          const rendered = window.OmniEdaResultView?.renderVerilogResult(res, document, telem);
          if (!rendered?.success)
            throw new Error(rendered?.error || 'The experimental Verilog result view is unavailable.');
        }
      } catch (error) {
        if (telem) telem.textContent = `Verilog inspection unavailable: ${error.message}`;
      }
    });

    document.getElementById('btn-run-drc')?.addEventListener('click', async () => {
      const telem = document.getElementById('drc-telemetry-container');
      const rawRequest = window.prompt(
        'Paste a DRC request JSON object with shapes [{id, layer, x, y, w, h}] and rules {minWidth, minSpacing, minArea}. The rectangle coordinates and all rule values must use matching units.'
      );
      if (rawRequest === null) return;

      try {
        const request = JSON.parse(rawRequest);
        const res = await window.omniEngAPI.runDRC(request.shapes, request.rules);
        if (!res?.success) throw new Error(res?.error?.message || 'The rectangle screen is unavailable.');
        if (telem) {
          const rendered = window.OmniEdaResultView?.renderDrcResult(res, document, telem);
          if (!rendered?.success)
            throw new Error(rendered?.error || 'The experimental rectangle result view is unavailable.');
        }
      } catch (error) {
        if (telem) telem.textContent = `Rectangle screen unavailable: ${error.message}`;
      }
    });

    // Add illustrative IC and PCB layout view switchers.
    const layoutModeRow = document.createElement('div');
    layoutModeRow.style.marginTop = '10px';
    layoutModeRow.style.display = 'flex';
    layoutModeRow.style.flexDirection = 'column';
    layoutModeRow.style.gap = '6px';
    layoutModeRow.innerHTML = `
      <button class="btn-primary" id="btn-inspect-ic" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;background: var(--bg-tertiary); border: 1px solid var(--accent-indigo); color: var(--accent-cyan); margin-top: 0; padding: 6px 10px; font-size: 11px;">
        <span class="icon-slot" data-omni-icon="circuit"></span> View Illustrative IC Layout
      </button>
      <button class="btn-primary" id="btn-inspect-pcb" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;background: var(--bg-tertiary); border: 1px solid var(--accent-green); color: var(--accent-green); margin-top: 0; padding: 6px 10px; font-size: 11px;">
        <span class="icon-slot" data-omni-icon="pcbStack"></span> View Illustrative PCB Layout
      </button>
    `;
    inspectorContainer.appendChild(layoutModeRow);

    document.getElementById('btn-inspect-ic')?.addEventListener('click', () => setViewMode('eda'));
    document.getElementById('btn-inspect-pcb')?.addEventListener('click', () => setViewMode('pcb'));

    if (window.OmniIcons) window.OmniIcons.hydrateAll(inspectorContainer);
  }

  function renderAerospaceInspector() {
    const article = state.manualParams.nasaRocketArticle;
    const isDrone = article === 'drone';
    const isRocketFull = article === 'full_stack';
    const isRocketEngine = article === 'engine_macro';
    const isRocketInterior = article === 'spacecraft_interior';

    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="rocket"></span> Illustrative Aerospace Scenes</span>
          <span class="tag">Synthetic · experimental</span>
        </div>
        <div class="sample-status" role="status">
          Scenes contain synthetic geometry only. Flight, propeller, propulsion, cryogenic loading, and ignition calculations are unavailable; no independently reviewed reference is configured.
        </div>
        <div class="param-row">
          <label style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;display:block;">Choose an illustrative scene:</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
            <button class="btn-secondary ${isDrone ? 'active' : ''}" id="btn-cad-drone" style="padding:5px 8px;font-size:11px;">Synthetic Quadcopter Geometry</button>
            <button class="btn-secondary" id="btn-cad-raptor" style="padding:5px 8px;font-size:11px;">Synthetic Engine-Stand Geometry</button>
            <button class="btn-secondary ${isRocketFull ? 'active' : ''}" id="btn-cad-nasa-rocket" style="padding:5px 8px;font-size:11px;">Illustrative Vehicle Geometry</button>
            <button class="btn-secondary ${isRocketEngine ? 'active' : ''}" id="btn-cad-nasa-engine" style="padding:5px 8px;font-size:11px;">Illustrative Engine Geometry</button>
            <button class="btn-secondary ${isRocketInterior ? 'active' : ''}" id="btn-cad-nasa-ship" style="grid-column:1 / -1;padding:5px 8px;font-size:11px;">Illustrative Spacecraft Interior Geometry</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <button class="btn-secondary" id="btn-open-nasa-wbs" style="font-size:11px;padding:6px 8px;">Subsystem Source Status</button>
          <button class="btn-secondary" id="btn-open-nasa-ship-spec" style="font-size:11px;padding:6px 8px;">Spacecraft Source Status</button>
          <button class="btn-secondary" id="btn-storytelling-nasa" style="font-size:11px;padding:6px 8px;">Illustrative Scene Tour</button>
          <button class="btn-secondary" id="btn-view-cad-tree" style="font-size:11px;padding:6px 8px;">View Generated Feature Tree</button>
        </div>
      </div>
    `;

    const sceneButtons = [
      'btn-cad-drone',
      'btn-cad-raptor',
      'btn-cad-nasa-rocket',
      'btn-cad-nasa-engine',
      'btn-cad-nasa-ship'
    ];
    const markScene = (activeId) => {
      sceneButtons.forEach((id) => {
        document.getElementById(id)?.classList.toggle('active', id === activeId);
      });
    };

    document.getElementById('btn-cad-drone')?.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'drone';
      markScene('btn-cad-drone');
      viewport3D.renderDrone3D(85);
    });
    document.getElementById('btn-cad-raptor')?.addEventListener('click', () => {
      markScene('btn-cad-raptor');
      viewport3D.renderRaptorTestStand3D();
    });
    document.getElementById('btn-cad-nasa-rocket')?.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'full_stack';
      markScene('btn-cad-nasa-rocket');
      viewport3D.renderNasaSpaceRocket3D('full_stack');
      addAiMessage(
        '[Illustrative aerospace scene] Displayed synthetic vehicle geometry without source-verified design data.'
      );
    });
    document.getElementById('btn-cad-nasa-engine')?.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'engine_macro';
      markScene('btn-cad-nasa-engine');
      viewport3D.renderNasaSpaceRocket3D('engine_macro');
      addAiMessage(
        '[Illustrative aerospace scene] Displayed synthetic engine geometry without source-verified configuration or performance data.'
      );
    });
    document.getElementById('btn-cad-nasa-ship')?.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'spacecraft_interior';
      markScene('btn-cad-nasa-ship');
      viewport3D.renderNasaSpaceRocket3D('spacecraft_interior');
      addAiMessage(
        '[Illustrative aerospace scene] Displayed synthetic spacecraft geometry without source-verified subsystem data.'
      );
    });
    document.getElementById('btn-open-nasa-wbs')?.addEventListener('click', openNasaWbsModal);
    document.getElementById('btn-open-nasa-ship-spec')?.addEventListener('click', openNasaShipSpecModal);
    document.getElementById('btn-storytelling-nasa')?.addEventListener('click', () => {
      if (window.storytellingRails) {
        window.storytellingRails.loadStagePreset('nasa_rocket');
        addAiMessage(
          '[Illustrative aerospace tour] Geometry and callouts are synthetic examples, not validated engineering data.'
        );
      }
    });
    document.getElementById('btn-view-cad-tree')?.addEventListener('click', () => {
      document.getElementById('tab-tree')?.click();
      addAiMessage(
        '[Generated feature tree] This tree describes illustrative geometry and is not a source-verified vehicle definition.'
      );
    });

    if (window.OmniIcons) window.OmniIcons.hydrateAll(inspectorContainer);
  }

  function renderOilGasInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="piping"></span> Experimental Piping Estimate</span>
          <span class="tag">No code assessment</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.5;margin:8px 0;">
          Supply every engineering input explicitly. There is no bundled material or schedule catalog. This simplified model has no allowable stress or pass/fail result.
        </div>
        <div class="param-row">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); cursor: pointer;">
            <input type="checkbox" id="chk-pipe-loop" ${state.manualParams.hasExpansionLoop ? 'checked' : ''}>
            <span>Show illustrative loop geometry in viewport</span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0;">
          <label style="font-size:11px;color:var(--text-muted);">Outside diameter (mm)<input id="pipe-outer-diameter-mm" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Wall thickness (mm)<input id="pipe-wall-thickness-mm" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Young's modulus (GPa)<input id="pipe-youngs-modulus-gpa" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Thermal expansion (1/K)<input id="pipe-thermal-expansion-per-k" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Design pressure (bar)<input id="pipe-design-pressure-bar" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Operating temperature (°C)<input id="pipe-operating-temp-c" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Ambient temperature (°C)<input id="pipe-ambient-temp-c" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Straight length (m)<input id="pipe-straight-length-m" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Corrosion allowance (mm)<input id="pipe-corrosion-allowance-mm" type="number" step="any" placeholder="Required; no default" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Expansion loop
            <select id="pipe-has-expansion-loop" style="display:block;width:100%;margin-top:4px;" aria-label="Select whether the estimate includes an expansion loop">
              <option value="">Required; select an option</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label style="font-size:11px;color:var(--text-muted);">Loop height (m; if included)<input id="pipe-loop-height-m" type="number" step="any" placeholder="Required when loop is included" style="display:block;width:100%;margin-top:4px;"></label>
          <label style="font-size:11px;color:var(--text-muted);">Elbow centerline radius (m; if included)<input id="pipe-elbow-radius-m" type="number" step="any" placeholder="Required when loop is included" style="display:block;width:100%;margin-top:4px;"></label>
        </div>
        <button class="btn-primary" id="btn-run-pipe">
          <span>Run experimental estimate</span>
        </button>
        <div id="pipe-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="distillation"></span> Crude Distillation Column</span>
          <span class="tag">Unavailable</span>
        </div>
        <div class="sample-status" role="status">
          No sourced crude assay, reviewed column model, or independent fractionation reference is configured.
          The former synthetic tray temperatures, flows, and product compositions were withdrawn.
        </div>
        <button class="btn-primary" id="btn-run-hysys" disabled aria-disabled="true" title="Distillation calculations are unavailable">
          <span>Distillation calculation unavailable</span>
        </button>
        <div id="hysys-telemetry-container"></div>
      </div>
    `;

    document.getElementById('chk-pipe-loop')?.addEventListener('change', (e) => {
      state.manualParams.hasExpansionLoop = e.target.checked;
      if (viewport3D?.renderPipingLoop3D) {
        viewport3D.renderPipingLoop3D(state.manualParams.hasExpansionLoop ? 40 : 25, 10, 6);
      }
    });

    document.getElementById('btn-run-pipe')?.addEventListener('click', async () => {
      const inputIds = {
        pipeOuterDiameterMm: 'pipe-outer-diameter-mm',
        nominalWallThicknessMm: 'pipe-wall-thickness-mm',
        youngsModulusGPa: 'pipe-youngs-modulus-gpa',
        thermalExpansionPerK: 'pipe-thermal-expansion-per-k',
        designPressureBar: 'pipe-design-pressure-bar',
        operatingTempC: 'pipe-operating-temp-c',
        ambientTempC: 'pipe-ambient-temp-c',
        straightLengthM: 'pipe-straight-length-m',
        corrosionAllowanceMm: 'pipe-corrosion-allowance-mm',
        loopHeightM: 'pipe-loop-height-m',
        elbowCenterlineRadiusM: 'pipe-elbow-radius-m'
      };
      const params = {};
      for (const [key, id] of Object.entries(inputIds)) {
        const rawValue = document.getElementById(id)?.value;
        if (typeof rawValue === 'string' && rawValue.trim() !== '') params[key] = Number(rawValue);
      }
      const loopSelection = document.getElementById('pipe-has-expansion-loop')?.value;
      if (loopSelection === 'true' || loopSelection === 'false') params.hasExpansionLoop = loopSelection === 'true';

      const res = await window.omniEngAPI.evaluatePipingStress(params);

      const telem = document.getElementById('pipe-telemetry-container');
      if (telem) {
        if (!res?.success || !Number.isFinite(res.expansionStress_MPa)) {
          telem.textContent = String(
            res?.error?.message || res?.error || 'Experimental piping stress estimate unavailable.'
          );
          return;
        }
        window.OmniEngineeringResultView?.renderPipingStressResult(res, document, telem);
      }
    });

    // Add Direct Chemical Thermodynamics Inspection Buttons
    const vleBtnRow = document.createElement('div');
    vleBtnRow.style.marginTop = '10px';
    vleBtnRow.style.display = 'flex';
    vleBtnRow.style.flexDirection = 'column';
    vleBtnRow.style.gap = '6px';
    vleBtnRow.innerHTML = `
      <button class="btn-primary" id="btn-inspect-vle" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;background: var(--bg-tertiary); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); margin-top: 0; padding: 6px 10px; font-size: 11px;">
        <span class="icon-slot" data-omni-icon="flowChart"></span> Open VLE Availability Status
      </button>
      <button class="btn-primary" id="btn-inspect-tray" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;background: var(--bg-tertiary); border: 1px solid var(--accent-green); color: var(--accent-green); margin-top: 0; padding: 6px 10px; font-size: 11px;">
        <span class="icon-slot" data-omni-icon="distillation"></span> Open Column Profile Availability Status
      </button>
    `;
    inspectorContainer.appendChild(vleBtnRow);

    document.getElementById('btn-inspect-vle')?.addEventListener('click', () => setViewMode('vle'));
    document.getElementById('btn-inspect-tray')?.addEventListener('click', () => setViewMode('tray'));

    if (window.OmniIcons) window.OmniIcons.hydrateAll(inspectorContainer);
  }

  function renderSimulinkInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="flowChart"></span> Block Diagram</span>
          <span class="tag">Experimental</span>
        </div>
        <div id="simulink-model-status" class="sample-status" role="status">
          No caller-supplied block model is loaded. This editor accepts dimensionless signals only; simulation time is in seconds.
          Block parameter units follow the fixed experimental contract. It does not infer physical units or validate a physical control system.
        </div>
        <div class="prop-grid-row" style="display:block;margin-top:8px;">
          <label for="simulink-model-json">Block graph JSON</label>
          <textarea id="simulink-model-json" rows="9" maxlength="200000" spellcheck="false" aria-describedby="simulink-model-help" style="display:block;width:100%;margin-top:4px;font-family:monospace;"></textarea>
          <div id="simulink-model-help" class="sample-status">
            Supported acyclic blocks: source_step, source_sine, source_constant, gain, sum, pid, scope. Units: stepTime and PID initialState are s; sine frequency is Hz; PID ki is s^-1; PID kd is s; signal values, gain, PID kp, and limits are dimensionless. The generic integrator is withheld until the graph supports explicit per-port units.
          </div>
          <details class="sample-status" style="margin-top:6px;">
            <summary>Show an illustrative source → gain → scope JSON example</summary>
            <pre style="white-space:pre-wrap;user-select:text;">{
  "blocks": [
    { "id": "step", "type": "source_step", "params": { "stepTime": 0, "initialValue": 0, "finalValue": 1 } },
    { "id": "gain", "type": "gain", "params": { "k": 2 } },
    { "id": "scope", "type": "scope", "params": {} }
  ],
  "connections": [
    { "fromBlock": "step", "toBlock": "gain" },
    { "fromBlock": "gain", "toBlock": "scope" }
  ]
}</pre>
          </details>
        </div>
        <div class="prop-grid-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <label for="simulink-t-end-seconds">Duration (s)
            <input id="simulink-t-end-seconds" type="number" min="0.000001" max="1000000" step="any" inputmode="decimal" style="display:block;width:100%;">
          </label>
          <label for="simulink-dt-seconds">Time step (s)
            <input id="simulink-dt-seconds" type="number" min="0.000001" max="1000000" step="any" inputmode="decimal" style="display:block;width:100%;">
          </label>
        </div>
        <button class="btn-primary" id="btn-run-simulink" type="button" disabled>
          <span>Run caller-supplied model</span>
        </button>
        <div id="simulink-telemetry-container" class="sample-status" role="status" aria-live="polite"></div>
      </div>
    `;

    const modelInput = document.getElementById('simulink-model-json');
    const tEndInput = document.getElementById('simulink-t-end-seconds');
    const dtInput = document.getElementById('simulink-dt-seconds');
    const runButton = document.getElementById('btn-run-simulink');
    const modelStatus = document.getElementById('simulink-model-status');
    const statusOutput = document.getElementById('simulink-telemetry-container');
    if (modelInput) modelInput.value = state.controls.blockGraphJson;
    if (tEndInput) tEndInput.value = state.controls.blockGraphTEndSeconds;
    if (dtInput) dtInput.value = state.controls.blockGraphDtSeconds;
    if (statusOutput) statusOutput.textContent = state.controls.blockGraphResultSummary;

    let graphData = null;
    const updateModel = (resetResult = true) => {
      const previousGraphText = state.controls.blockGraphJson;
      state.controls.blockGraphJson = modelInput?.value || '';
      state.controls.blockGraphTEndSeconds = tEndInput?.value || '';
      state.controls.blockGraphDtSeconds = dtInput?.value || '';
      if (resetResult) state.controls.blockGraphResultSummary = '';
      graphData = null;
      const graphChanged = previousGraphText !== state.controls.blockGraphJson;
      if (resetResult) blockDiagramUI.clearModel();

      const rawGraph = state.controls.blockGraphJson.trim();
      if (!rawGraph) {
        if (modelStatus) {
          modelStatus.textContent =
            'No caller-supplied block model is loaded. This editor accepts dimensionless signals only; simulation time is in seconds.';
        }
        if (statusOutput) statusOutput.textContent = 'Paste caller-supplied block graph JSON to load a model.';
        if (runButton) runButton.disabled = true;
        return;
      }
      try {
        graphData = JSON.parse(rawGraph);
        if (resetResult || graphChanged || blockDiagramUI.blocks.length === 0) {
          blockDiagramUI.loadModel(graphData);
        }
      } catch (error) {
        graphData = null;
        blockDiagramUI.clearModel();
        if (modelStatus) modelStatus.textContent = `No model loaded. ${error.message}`;
        if (statusOutput) statusOutput.textContent = `Model JSON is invalid: ${error.message}`;
        if (runButton) runButton.disabled = true;
        return;
      }

      const tEnd = Number(state.controls.blockGraphTEndSeconds);
      const dt = Number(state.controls.blockGraphDtSeconds);
      const hasTimes =
        state.controls.blockGraphTEndSeconds.trim() !== '' &&
        state.controls.blockGraphDtSeconds.trim() !== '' &&
        Number.isFinite(tEnd) &&
        Number.isFinite(dt) &&
        tEnd > 0 &&
        dt > 0;
      const steps = hasTimes ? Math.ceil(tEnd / dt) : Number.POSITIVE_INFINITY;
      const workUnits = hasTimes ? steps * (graphData.blocks.length + graphData.connections.length) : Infinity;
      const recordedValues = hasTimes ? (steps + 1) * (graphData.blocks.length + 1) : Infinity;
      const withinWorkLimit =
        Number.isSafeInteger(steps) && steps <= 1_000_000 && workUnits <= 10_000_000 && recordedValues <= 2_000_000;
      if (runButton) runButton.disabled = !hasTimes || !withinWorkLimit;
      if (modelStatus) {
        modelStatus.textContent = `Caller-supplied dimensionless graph loaded (${graphData.blocks.length} blocks). Time is interpreted in seconds.`;
      }
      if (statusOutput) {
        statusOutput.textContent =
          !resetResult && state.controls.blockGraphResultSummary
            ? state.controls.blockGraphResultSummary
            : !hasTimes
              ? 'Model loaded. Enter positive duration and time-step values in seconds.'
              : !withinWorkLimit
                ? 'The request exceeds the engine time-step, total-work, or result-size budget.'
                : `Caller model loaded (${graphData.blocks.length} blocks). No simulation has run.`;
      }
    };

    modelInput?.addEventListener('input', () => updateModel(true));
    tEndInput?.addEventListener('input', () => updateModel(true));
    dtInput?.addEventListener('input', () => updateModel(true));
    updateModel(false);

    runButton?.addEventListener('click', async () => {
      if (!graphData) return;
      const tEnd = Number(state.controls.blockGraphTEndSeconds);
      const dt = Number(state.controls.blockGraphDtSeconds);
      if (!window.omniEngAPI?.simulateBlockDiagram) {
        if (statusOutput) statusOutput.textContent = 'The experimental block-diagram engine is unavailable.';
        return;
      }
      blockDiagramUI.loadModel(graphData);
      runButton.disabled = true;
      modelInput.disabled = true;
      tEndInput.disabled = true;
      dtInput.disabled = true;
      if (statusOutput) statusOutput.textContent = 'Running the caller-supplied experimental graph…';
      try {
        const result = await window.omniEngAPI.simulateBlockDiagram(graphData, tEnd, dt);
        blockDiagramUI.setSimulationResult(result);
        const scopeSummaries = graphData.blocks
          .filter((block) => block.type === 'scope')
          .map((block) => {
            const values = result.signals[block.id];
            return Array.isArray(values)
              ? `${block.name || block.id}: ${values[values.length - 1]} (dimensionless)`
              : `${block.name || block.id}: no returned signal`;
          });
        const endTime = result.time[result.time.length - 1];
        state.controls.blockGraphResultSummary =
          `Experimental result: ${result.time.length} returned samples, ending at ${endTime} s.` +
          (scopeSummaries.length
            ? ` Scope outputs: ${scopeSummaries.join('; ')}.`
            : ' This graph has no scope blocks.');
        if (statusOutput) statusOutput.textContent = state.controls.blockGraphResultSummary;
      } catch (error) {
        state.controls.blockGraphResultSummary = `Simulation failed: ${error.message}`;
        if (statusOutput) statusOutput.textContent = state.controls.blockGraphResultSummary;
      } finally {
        modelInput.disabled = false;
        tEndInput.disabled = false;
        dtInput.disabled = false;
        updateModel(false);
      }
    });

    if (window.OmniIcons) window.OmniIcons.hydrateAll(inspectorContainer);
  }

  function renderCadInspector() {
    inspectorContainer.innerHTML = `
      <!-- 1. Parametric Feature Operations -->
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="solidExtrude"></span> Parametric Feature Operations</span>
          <span class="tag">CAD shortcut profiles</span>
        </div>
        
        <div class="param-row" style="margin-bottom: 8px;">
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 3px;">Extrusion Depth (mm): <span id="lbl-cad-extrude-depth" style="color: var(--accent-cyan); font-weight: 600;">50 mm</span></label>
          <input type="range" id="slider-cad-extrude-depth" min="10" max="200" value="50" step="5" style="width: 100%;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Draft Angle:</label>
            <select id="select-cad-draft" class="ribbon-select" style="width: 100%; font-size: 11px; padding: 4px;">
              <option value="0">0° (None)</option>
              <option value="3">3° (Molding)</option>
              <option value="5">5° (Die-Cast)</option>
              <option value="10">10° (Draft)</option>
            </select>
          </div>
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Profile Shape:</label>
            <select id="select-cad-profile" class="ribbon-select" style="width: 100%; font-size: 11px; padding: 4px;">
              <option value="rect">Rectangle 60x40</option>
              <option value="hex">Hexagon (ISO)</option>
              <option value="flange">Flange Contour</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <button class="btn-primary" id="btn-cad-extrude" style="margin-top: 0; padding: 6px 10px; font-size: 11px;">
            <span class="icon-slot" data-omni-icon="cadExtrude"></span> Extrude Boss
          </button>
          <button class="btn-primary" id="btn-cad-revolve" style="margin-top: 0; padding: 6px 10px; font-size: 11px;">
            <span class="icon-slot" data-omni-icon="cadRevolve"></span> Revolve 360°
          </button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px;">
          <button class="ribbon-btn" id="btn-cad-shell" style="padding: 6px 10px; font-size: 11px;">
            <span class="icon-slot" data-omni-icon="cadShell"></span> Shell (2mm)
          </button>
          <button class="ribbon-btn" id="btn-cad-fillet" style="padding: 6px 10px; font-size: 11px;">
            <span class="icon-slot" data-omni-icon="fillet"></span> Fillet (R5)
          </button>
        </div>
      </div>

      <!-- 2. Experimental CAM toolpath preview -->
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="camGcode"></span> Experimental Toolpath Example</span>
          <span class="tag">Unvalidated output</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Endmill Tool:</label>
            <select id="select-cam-tool" class="ribbon-select" style="width: 100%; font-size: 11px; padding: 4px;">
              <option value="10">Ø10mm Carbide Flat</option>
              <option value="6">Ø6mm Flat Endmill</option>
              <option value="16">Ø16mm Rougher</option>
            </select>
          </div>
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Spindle (RPM):</label>
            <input type="number" id="input-cam-spindle" class="ribbon-select" value="8000" style="width: 100%; font-size: 11px; padding: 4px;">
          </div>
        </div>

        <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;">The generated example has no machine-specific postprocessor or NC validation and is not ready for machining.</div>
        <button class="btn-primary" id="btn-generate-cam-toolpath" style="width: 100%; margin-top: 0; padding: 7px; font-size: 11px;">
          <span class="icon-slot" data-omni-icon="camGcode"></span> Generate Illustrative Toolpath
        </button>

        <div id="cam-telemetry-container" style="margin-top: 8px; display: none;">
          <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-size: 11px; font-family: monospace;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: var(--text-muted);">Cut Time:</span>
              <strong id="cam-cut-time" style="color: #4ade80;">--</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: var(--text-muted);">Path Length:</span>
              <strong id="cam-path-len" style="color: #38bdf8;">--</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">MRR:</span>
              <strong id="cam-mrr" style="color: #fbbf24;">--</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Sample B-Rep Primitives -->
      <div class="param-group">
        <div class="param-group-title">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="icon-slot" data-omni-icon="cube"></span> Sample B-Rep Primitives</span>
          <span class="tag">Example geometry</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
          <button class="ribbon-btn" id="btn-cad-box" style="font-size: 11px; padding: 5px;">Box</button>
          <button class="ribbon-btn" id="btn-cad-cyl" style="font-size: 11px; padding: 5px;">Cylinder</button>
          <button class="ribbon-btn" id="btn-cad-sph" style="font-size: 11px; padding: 5px;">Sphere</button>
        </div>
      </div>
    `;

    // Sliders & Controls
    const sliderDepth = document.getElementById('slider-cad-extrude-depth');
    const lblDepth = document.getElementById('lbl-cad-extrude-depth');
    if (sliderDepth && lblDepth) {
      sliderDepth.addEventListener('input', () => {
        lblDepth.textContent = `${sliderDepth.value} mm`;
      });
    }

    // Extrude Boss Event
    document.getElementById('btn-cad-extrude')?.addEventListener('click', async () => {
      const depth = parseFloat(sliderDepth ? sliderDepth.value : 50);
      const draft = parseFloat(document.getElementById('select-cad-draft')?.value || 0);
      const shape = document.getElementById('select-cad-profile')?.value || 'rect';

      let profile;
      if (shape === 'hex') {
        profile = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          profile.push({ x: 30 * Math.cos(a), y: 30 * Math.sin(a) });
        }
      } else if (shape === 'flange') {
        profile = [
          { x: -35, y: -25 },
          { x: 35, y: -25 },
          { x: 35, y: -10 },
          { x: 15, y: 10 },
          { x: 15, y: 25 },
          { x: -15, y: 25 },
          { x: -15, y: 10 },
          { x: -35, y: -10 }
        ];
      } else {
        profile = [
          { x: -30, y: -20 },
          { x: 30, y: -20 },
          { x: 30, y: 20 },
          { x: -30, y: 20 }
        ];
      }

      window.omniSetSolverProgress('Extruding 3D B-Rep Feature Profile...', 40);
      if (window.omniEngAPI?.cadExtrudeProfile) {
        const res = await window.omniEngAPI.cadExtrudeProfile({ profile, depth, draftAngleDeg: draft });
        if (res?.success && res.triangles) {
          window.viewport3D?.renderBRepSolid(res.triangles, `Extrude_${shape.toUpperCase()}`);
          window.omniSetSolverProgress(`Extrude Complete: Volume ${(res.volume / 1000).toFixed(1)} cm³`, 100, true);
          addAiMessage(
            `[CAD Feature] Extruded <strong>${shape.toUpperCase()}</strong> profile to depth ${depth}mm (Volume: ${(res.volume / 1000).toFixed(2)} cm³). Topology has not been independently validated.`
          );
        }
      } else {
        viewport3D.renderSmartphoneCad(60, 40, depth);
      }
    });

    // Revolve 360° Event
    document.getElementById('btn-cad-revolve')?.addEventListener('click', async () => {
      window.omniSetSolverProgress('Revolving 2D Profile around Spatial Y-Axis...', 50);
      if (window.omniEngAPI?.cadRevolveProfile) {
        const res = await window.omniEngAPI.cadRevolveProfile({ angleDeg: 360, axis: 'Y', segments: 28 });
        if (res?.success && res.triangles) {
          window.viewport3D?.renderBRepSolid(res.triangles, 'Rotational_Solid_360');
          window.omniSetSolverProgress('Revolve 360° Complete', 100, true);
          addAiMessage(`[CAD Feature] Generated rotational B-Rep solid with 28 radial segments.`);
        }
      }
    });

    // Shell Body Event
    document.getElementById('btn-cad-shell')?.addEventListener('click', async () => {
      window.omniSetSolverProgress('Shelling B-Rep Solid (Wall: 2.0mm)...', 50);
      if (window.omniEngAPI?.cadShellBody) {
        const res = await window.omniEngAPI.cadShellBody({ wallThickness: 2.0, openFaceIndex: 1 });
        if (res?.success && res.triangles) {
          window.viewport3D?.renderBRepSolid(res.triangles, 'Shelled_Enclosure_2mm');
          window.omniSetSolverProgress('Thin-Wall Shell Complete', 100, true);
          addAiMessage(`[CAD Feature] Shelled solid body with uniform 2.0mm wall thickness.`);
        }
      }
    });

    // Fillet Event
    document.getElementById('btn-cad-fillet')?.addEventListener('click', () => {
      document.getElementById('ribbon-btn-blend')?.click();
    });

    // CAM Toolpath Generator Event
    document.getElementById('btn-generate-cam-toolpath')?.addEventListener('click', async () => {
      const toolDia = parseFloat(document.getElementById('select-cam-tool')?.value || 10);
      const rpm = parseInt(document.getElementById('input-cam-spindle')?.value || 8000, 10);

      window.omniSetSolverProgress('Planning 3-Axis Planar Roughing Toolpath...', 40);
      if (window.omniEngAPI?.camGenerateToolpath) {
        const res = await window.omniEngAPI.camGenerateToolpath({
          options: { toolDiameter: toolDia, spindleRpm: rpm, feedRateMmMin: 1200, stepdownMm: 2.5 }
        });
        if (res?.success && res.telemetry) {
          const telemBox = document.getElementById('cam-telemetry-container');
          if (telemBox) telemBox.style.display = 'block';
          const elTime = document.getElementById('cam-cut-time');
          const elLen = document.getElementById('cam-path-len');
          const elMrr = document.getElementById('cam-mrr');
          if (elTime) elTime.textContent = `${res.telemetry.estimatedTimeMin} min`;
          if (elLen) elLen.textContent = `${res.telemetry.totalPathLengthMm} mm`;
          if (elMrr) elMrr.textContent = `${res.telemetry.mrrMm3PerMin.toLocaleString()} mm³/min`;

          // Render real CNC toolpath layers in Three.js viewport
          const actualLayers = res.layers || [];
          window.viewport3D?.renderToolpath3D(actualLayers);

          window.omniSetSolverProgress(`CAM: ${res.totalGcodeLines} G-Code Lines Generated`, 100, true);
          addAiMessage(
            `[Experimental toolpath example] Generated ${res.totalGcodeLines} illustrative G-code blocks with an estimated cut time of ${res.telemetry.estimatedTimeMin} min. The output has no machine-specific postprocessor or NC validation and is not ready for machining.`
          );
        }
      }
    });

    // Primitives
    document.getElementById('btn-cad-box')?.addEventListener('click', () => {
      viewport3D.renderSmartphoneCad(80, 20, 100);
    });

    document.getElementById('btn-cad-cyl')?.addEventListener('click', () => {
      viewport3D.clearMesh();
      const geom = new THREE.CylinderGeometry(20, 20, 50, 32);
      const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8 });
      viewport3D.currentMesh = new THREE.Mesh(geom, mat);
      viewport3D.scene.add(viewport3D.currentMesh);
    });

    document.getElementById('btn-cad-sph')?.addEventListener('click', () => {
      viewport3D.clearMesh();
      const geom = new THREE.SphereGeometry(25, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.8 });
      viewport3D.currentMesh = new THREE.Mesh(geom, mat);
      viewport3D.scene.add(viewport3D.currentMesh);
    });

    if (window.OmniIcons) window.OmniIcons.hydrateAll(inspectorContainer);
  }

  // --- Render Community Samples ---
  function renderSampleCatalog() {
    sampleContainer.replaceChildren();
    for (const sample of state.samples) {
      const card = document.createElement('div');
      card.className = 'sample-card';
      const title = document.createElement('div');
      title.className = 'sample-title';
      title.textContent = String(sample.title ?? 'Untitled synthetic example');
      const status = document.createElement('div');
      status.className = 'sample-status';
      status.textContent = 'Synthetic example · Experimental · Not independently validated';
      const description = document.createElement('div');
      description.className = 'sample-desc';
      description.textContent = String(sample.description ?? 'No description was supplied.');
      const tags = document.createElement('div');
      tags.className = 'tag-list';
      for (const value of Array.isArray(sample.tags) ? sample.tags.slice(0, 20) : []) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = String(value);
        tags.appendChild(tag);
      }
      card.append(title, status, description, tags);
      card.addEventListener('click', () => {
        document.querySelectorAll('.sample-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        loadSampleProject(sample);
      });
      sampleContainer.appendChild(card);
    }
  }

  function loadSampleProject(sample) {
    if (sample.id === 'sample_camera_lens_50mm') {
      state.manualParams.lensSubTab = 'lens';
      if (sample.cadParams) {
        state.manualParams.lensFStop = sample.cadParams.fStop || 1.4;
        state.manualParams.lensCutawayDeg = Math.round(
          ((sample.cadParams.cutawayAngle || Math.PI / 2) * 180) / Math.PI
        );
        state.manualParams.lensShowRays = sample.cadParams.showRays !== false;
      }
      if (sample.opticsParams) {
        state.manualParams.lensSubjectDist = sample.opticsParams.subjectDistM || 2.0;
      }
      switchStudio('consumer');
      addAiMessage(
        `Loaded synthetic optics example: "${sample.title}". Its values are illustrative inputs for the experimental workbench; no sourced lens prescription or validated optical result is included.`
      );
      return;
    }
    if (sample.id === 'sample_nasa_space_launch_system') {
      state.manualParams.nasaRocketArticle = 'full_stack';
      switchStudio('aerospace');
      viewport3D.renderNasaSpaceRocket3D('full_stack');
      renderAerospaceInspector();
      addAiMessage(
        `Loaded synthetic aerospace example: "${sample.title}". The viewport is illustrative and does not represent an actual vehicle or validated propulsion design.`
      );
      return;
    }
    if (sample.id === 'sample_raptor_propulsion_stand') {
      switchStudio('aerospace');
      viewport3D.renderRaptorTestStand3D();
      renderAerospaceInspector();
      addAiMessage(
        `Loaded synthetic aerospace example: "${sample.title}". The viewport is illustrative and is not a real engine or validated test stand.`
      );
      return;
    }
    state.manualParams.lensSubTab = 'phone';
    switchStudio(sample.studio);
    addAiMessage(
      `Loaded synthetic example: "${sample.title}". Its bundled parameters are illustrative; verify and replace them before using any experimental calculation.`
    );
  }

  // --- Left Sidebar Tab Switching: Samples vs Feature Tree DAG ---
  const tabSamples = document.getElementById('tab-samples');
  const tabTree = document.getElementById('tab-tree');
  const sidebarSamplesContent = document.getElementById('sidebar-samples-content');
  const sidebarTreeContent = document.getElementById('sidebar-tree-content');
  const featureTreeContainer = document.getElementById('feature-tree-container');

  async function renderFeatureTree() {
    if (!featureTreeContainer) return;
    if (state.currentStudio !== 'aerospace') {
      featureTreeContainer.textContent = 'No saved project feature history is loaded for this workbench.';
      return;
    }
    featureTreeContainer.textContent =
      'No source-verified or caller-supplied feature history is loaded. The viewport shows illustrative geometry only.';
  }

  // --- Activity Rail & Left Sidebar Tab Switching ---
  const railBtnSamples = document.getElementById('rail-btn-samples');
  const railBtnTree = document.getElementById('rail-btn-tree');
  const railBtnToggleLeft = document.getElementById('rail-btn-toggle-left');
  const railBtnToggleRight = document.getElementById('rail-btn-toggle-right');

  function activateSidebarTab(tab) {
    if (tab === 'samples') {
      document.body.classList.remove('left-collapsed');
      if (tabSamples) tabSamples.classList.add('active');
      if (tabTree) tabTree.classList.remove('active');
      if (railBtnSamples) railBtnSamples.classList.add('active');
      if (railBtnTree) railBtnTree.classList.remove('active');
      if (sidebarSamplesContent) sidebarSamplesContent.style.display = 'block';
      if (sidebarTreeContent) sidebarTreeContent.style.display = 'none';
    } else if (tab === 'tree') {
      document.body.classList.remove('left-collapsed');
      if (tabTree) tabTree.classList.add('active');
      if (tabSamples) tabSamples.classList.remove('active');
      if (railBtnTree) railBtnTree.classList.add('active');
      if (railBtnSamples) railBtnSamples.classList.remove('active');
      if (sidebarSamplesContent) sidebarSamplesContent.style.display = 'none';
      if (sidebarTreeContent) sidebarTreeContent.style.display = 'block';
      renderFeatureTree();
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
  }

  function toggleLeftSidebar() {
    document.body.classList.toggle('left-collapsed');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
  }

  function toggleRightInspector() {
    document.body.classList.toggle('right-collapsed');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
  }

  if (tabSamples && tabTree) {
    tabSamples.addEventListener('click', () => activateSidebarTab('samples'));
    tabTree.addEventListener('click', () => activateSidebarTab('tree'));
  }
  if (railBtnSamples) {
    railBtnSamples.addEventListener('click', () => activateSidebarTab('samples'));
  }
  if (railBtnTree) {
    railBtnTree.addEventListener('click', () => activateSidebarTab('tree'));
  }
  if (railBtnToggleLeft) {
    railBtnToggleLeft.addEventListener('click', toggleLeftSidebar);
  }
  if (railBtnToggleRight) {
    railBtnToggleRight.addEventListener('click', toggleRightInspector);
  }

  // Keyboard shortcuts for shell panels
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleLeftSidebar();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      toggleRightInspector();
    } else if (e.altKey && e.key === '1') {
      e.preventDefault();
      activateSidebarTab('samples');
    } else if (e.altKey && e.key === '2') {
      e.preventDefault();
      activateSidebarTab('tree');
    }
  });

  // --- OmniAI Co-Pilot Messaging & Dual Editing ---
  function addAiMessage(text, isUser = false, suggestions = []) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'user' : 'ai'}`;
    if (isUser) {
      bubble.textContent = String(text ?? '');
    } else {
      const title = document.createElement('strong');
      title.textContent = 'OmniAI legacy macro:';
      bubble.appendChild(title);
      bubble.appendChild(document.createTextNode(' '));
      if (window.OmniSafeDOM?.appendSafeInlineMarkup) {
        window.OmniSafeDOM.appendSafeInlineMarkup(bubble, text);
      } else {
        bubble.appendChild(document.createTextNode(String(text ?? '')));
      }

      if (Array.isArray(suggestions) && suggestions.length > 0) {
        const suggestionList = document.createElement('div');
        suggestionList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
        for (const suggestion of suggestions) {
          if (!suggestion || typeof suggestion !== 'object') continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ribbon-btn action-btn';
          button.style.cssText =
            'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:10px;border-radius:4px;border:1px solid var(--accent-cyan);background:rgba(56,189,248,0.15);';
          const icon = document.createElement('span');
          icon.className = 'icon-slot';
          icon.dataset.omniIcon = 'bolt';
          button.appendChild(icon);
          button.appendChild(
            document.createTextNode(
              ` Auto-Fix: ${String(suggestion.label ?? '')} (${String(suggestion.value ?? '')}${suggestion.unit ? ` ${String(suggestion.unit)}` : ''})`
            )
          );
          button.addEventListener('click', () => window.omniAutoRemediate('param', suggestion.key, suggestion.value));
          suggestionList.appendChild(button);
        }
        if (suggestionList.childElementCount > 0) bubble.appendChild(suggestionList);
      }
    }
    if (window.OmniIcons) window.OmniIcons.hydrateAll(bubble);
    aiChatHistory.appendChild(bubble);
    aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
  }

  window.omniAutoRemediate = function (actionType, paramKey, paramVal) {
    if (actionType === 'param') {
      if (!applySuggestedManualEdit(paramKey, paramVal)) {
        addAiMessage(
          '[Parameter update] No change was made because the suggested setting is unsupported or outside its allowed range.'
        );
        return;
      }
      addAiMessage(
        `Applied engineering remediation: <code>${paramKey} = ${paramVal}</code>. Synchronizing manual controls and re-evaluating...`
      );
      switchStudio(state.currentStudio);
    } else if (actionType === 'studio') {
      if (STUDIO_IDS.includes(paramVal)) {
        switchStudio(paramVal);
      }
    } else if (actionType === 'solve') {
      switchStudio(state.currentStudio);
    }
  };

  async function handleAiPrompt(promptText) {
    if (!promptText.trim()) return;
    addAiMessage(promptText, true);
    aiInput.value = '';

    try {
      const plan = await window.omniEngAPI.processAIPrompt(promptText, {
        currentStudio: state.currentStudio,
        params: state.manualParams
      });
      if (!plan?.success) {
        throw new Error(plan?.error?.message || 'The legacy router is unavailable. No action was taken.');
      }

      addAiMessage(plan.assistantMessage, false, plan.suggestedManualEdits);

      // Automatically sync AI results with manual sliders & viewport
      if (plan.matchedTool === 'design_camera_lens_optics' || plan.matchedTool === 'solve_skew_optics') {
        state.manualParams.lensSubTab = 'lens';
        if (plan.toolInput) {
          if (Number.isFinite(plan.toolInput.fStop)) applySuggestedManualEdit('lensFStop', plan.toolInput.fStop);
          if (Number.isFinite(plan.toolInput.cutawayAngle)) {
            applySuggestedManualEdit('lensCutawayDeg', Math.round((plan.toolInput.cutawayAngle * 180) / Math.PI));
          }
          if (Number.isFinite(plan.toolInput.subjectDistM)) {
            applySuggestedManualEdit('lensSubjectDist', plan.toolInput.subjectDistM);
          }
          if (typeof plan.toolInput.showRays === 'boolean') {
            applySuggestedManualEdit('lensShowRays', plan.toolInput.showRays);
          }
        }
        switchStudio('consumer');
        if (plan.matchedTool === 'solve_skew_optics' && modalOpticalInspector) {
          modalOpticalInspector.classList.add('active');
          runOpticalInspection();
        }
      } else if (plan.matchedTool === 'solve_spice_circuit') {
        switchStudio('eda');
        if (modalSpiceOscilloscope) {
          modalSpiceOscilloscope.classList.add('active');
          runSpiceOscilloscope();
        }
      } else if (plan.matchedTool === 'solve_flowsheet') {
        switchStudio('oilgas');
        if (modalFlowsheetPfd) {
          modalFlowsheetPfd.classList.add('active');
          runFlowsheetPfd();
        }
      } else if (plan.matchedTool === 'run_phone_drop_test') {
        state.manualParams.lensSubTab = 'phone';
        switchStudio('consumer');
      } else if (plan.matchedTool === 'simulate_mobile_thermal') {
        state.manualParams.lensSubTab = 'phone';
        switchStudio('consumer');
      } else if (
        plan.matchedTool === 'synthesize_verilog_chip' ||
        plan.matchedTool === 'run_calibre_drc_check' ||
        plan.matchedTool === 'power_grid_ir_drop_analysis'
      ) {
        switchStudio('eda');
      } else if (plan.matchedTool === 'simulate_drone_flight') {
        switchStudio('aerospace');
      } else if (
        plan.matchedTool === 'calculate_asme_piping_stress' ||
        plan.matchedTool === 'run_hysys_flash_distillation' ||
        plan.matchedTool === 'asme_viii_div2_report'
      ) {
        switchStudio('oilgas');
      } else if (
        plan.matchedTool === 'variational_constraint_solver' ||
        plan.matchedTool === 'topological_healing' ||
        plan.matchedTool === 'git_cad_visual_diff' ||
        plan.matchedTool === 'sheet_metal_unfolding' ||
        plan.matchedTool === 'gdt_inspection'
      ) {
        switchStudio('universal_cad');
      }

      // Automatically open and trigger matching modal if specified
      if (plan.modalToOpen) {
        const targetModal = document.getElementById(plan.modalToOpen);
        if (targetModal) {
          targetModal.classList.add('active');
          if (plan.modalToOpen === 'modal-variational-sketcher') {
            if (typeof renderSketcherCanvas === 'function') renderSketcherCanvas();
            if (typeof solveSketcher === 'function') solveSketcher();
          } else if (plan.modalToOpen === 'modal-topological-healer') {
            const btnRun = document.getElementById('btn-run-auto-heal');
            if (btnRun) btnRun.click();
          } else if (plan.modalToOpen === 'modal-dls-optimizer') {
            if (typeof plotDLSConvergence === 'function') plotDLSConvergence();
            const btnRun = document.getElementById('btn-run-dls-opt');
            if (btnRun) btnRun.click();
          } else if (plan.modalToOpen === 'modal-asme-report' && typeof evaluateAndRenderASME === 'function') {
            evaluateAndRenderASME();
          } else if (plan.modalToOpen === 'modal-cad-diff' && typeof executeVisualDiff === 'function') {
            executeVisualDiff();
          } else if (plan.modalToOpen === 'modal-optical-inspector' && typeof runOpticalInspection === 'function') {
            runOpticalInspection();
          } else if (plan.modalToOpen === 'modal-spice-oscilloscope' && typeof runSpiceOscilloscope === 'function') {
            runSpiceOscilloscope();
          } else if (plan.modalToOpen === 'modal-flowsheet-pfd' && typeof runFlowsheetPfd === 'function') {
            runFlowsheetPfd();
          }
        }
      }

      // Sync suggested parameters into manual inspector controls
      if (plan.suggestedManualEdits && plan.suggestedManualEdits.length > 0) {
        for (const edit of plan.suggestedManualEdits) {
          applySuggestedManualEdit(edit?.key, edit?.value);
        }
      }
    } catch (err) {
      addAiMessage(`Error executing AI action: ${err.message}`);
    }
  }

  aiSendBtn.addEventListener('click', () => handleAiPrompt(aiInput.value));
  aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAiPrompt(aiInput.value);
  });

  // Suggestion Chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      handleAiPrompt(prompt);
    });
  });

  // --- Engineering Ribbon Toolbar Event Wiring ---
  const ribbonBtnShaded = document.getElementById('ribbon-btn-shaded');
  const ribbonBtnWire = document.getElementById('ribbon-btn-wire');
  const ribbonBtnXray = document.getElementById('ribbon-btn-xray');
  const ribbonBtnFea = document.getElementById('ribbon-btn-fea');
  const ribbonExplodeSlider = document.getElementById('ribbon-explode-slider');
  const ribbonExplodeVal = document.getElementById('ribbon-explode-val');

  function setRibbonRenderMode(btn, mode) {
    [ribbonBtnShaded, ribbonBtnWire, ribbonBtnXray, ribbonBtnFea].forEach((b) => {
      if (b) b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');

    if (mode === 'fea') {
      viewport3D.renderFEAStressHeatmap('normal', 145);
    } else {
      viewport3D.setViewMode(mode);
    }
  }

  if (ribbonBtnShaded) ribbonBtnShaded.addEventListener('click', () => setRibbonRenderMode(ribbonBtnShaded, 'shaded'));
  if (ribbonBtnWire) ribbonBtnWire.addEventListener('click', () => setRibbonRenderMode(ribbonBtnWire, 'wireframe'));
  if (ribbonBtnXray) ribbonBtnXray.addEventListener('click', () => setRibbonRenderMode(ribbonBtnXray, 'xray'));
  if (ribbonBtnFea) ribbonBtnFea.addEventListener('click', () => setRibbonRenderMode(ribbonBtnFea, 'fea'));

  if (ribbonExplodeSlider) {
    ribbonExplodeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (ribbonExplodeVal) ribbonExplodeVal.textContent = `${val}%`;
      viewport3D.setExplodeFactor(val / 100);
      if (state.manualParams.lensSubTab === 'lens') {
        state.manualParams.lensExplodePercent = val;
        const sliderLensExplode = document.getElementById('slider-lens-explode');
        if (sliderLensExplode) sliderLensExplode.value = val;
        const valLensExplode = document.getElementById('val-lens-explode');
        if (valLensExplode) valLensExplode.textContent = `${val}%`;
      }
    });
  }

  // Section Cut (Cross-Section Clipping Plane)
  let isClippingActive = false;
  const ribbonBtnClip = document.getElementById('ribbon-btn-clip');
  const ribbonClipAxis = document.getElementById('ribbon-clip-axis');
  const ribbonClipSlider = document.getElementById('ribbon-clip-slider');

  function updateClipping() {
    if (!ribbonClipAxis || !ribbonClipSlider) return;
    const axis = ribbonClipAxis.value;
    const offset = Number(ribbonClipSlider.value);
    viewport3D.setClippingPlane(isClippingActive, axis, offset);
  }

  if (ribbonBtnClip) {
    ribbonBtnClip.addEventListener('click', () => {
      isClippingActive = !isClippingActive;
      ribbonBtnClip.classList.toggle('active', isClippingActive);
      updateClipping();
    });
  }
  if (ribbonClipAxis) ribbonClipAxis.addEventListener('change', updateClipping);
  if (ribbonClipSlider) ribbonClipSlider.addEventListener('input', updateClipping);

  // 3D Point-to-Point Caliper Inspection
  const ribbonBtnMeasure = document.getElementById('ribbon-btn-measure');
  if (ribbonBtnMeasure) {
    ribbonBtnMeasure.addEventListener('click', () => {
      const active = !viewport3D.isMeasuring;
      viewport3D.toggleMeasureTool(active);
      ribbonBtnMeasure.classList.toggle('active', active);
    });
  }

  // Transient experimental impact estimate playback controls
  const btnTransPlay = document.getElementById('btn-transient-play');
  const btnTransPause = document.getElementById('btn-transient-pause');
  const btnTransReset = document.getElementById('btn-transient-reset');
  const transSlider = document.getElementById('transient-time-slider');

  if (btnTransPlay) {
    btnTransPlay.addEventListener('click', () => viewport3D.playTransient());
  }
  if (btnTransPause) {
    btnTransPause.addEventListener('click', () => viewport3D.pauseTransient());
  }
  if (btnTransReset) {
    btnTransReset.addEventListener('click', () => viewport3D.resetTransient());
  }
  if (transSlider) {
    transSlider.addEventListener('input', (e) => {
      viewport3D.pauseTransient();
      viewport3D.renderTransientFrame(Number(e.target.value));
    });
  }

  // Camera Presets
  const camIso = document.getElementById('ribbon-cam-iso');
  const camTop = document.getElementById('ribbon-cam-top');
  const camFront = document.getElementById('ribbon-cam-front');
  const camReset = document.getElementById('ribbon-cam-reset');

  if (camIso) camIso.addEventListener('click', () => viewport3D.setCameraPreset('iso'));
  if (camTop) camTop.addEventListener('click', () => viewport3D.setCameraPreset('top'));
  if (camFront) camFront.addEventListener('click', () => viewport3D.setCameraPreset('front'));
  if (camReset) camReset.addEventListener('click', () => viewport3D.setCameraPreset('reset'));

  const btnQuadView = document.getElementById('ribbon-btn-quad-view');
  if (btnQuadView) {
    btnQuadView.addEventListener('click', () => {
      const isQuad = viewport3D.toggleQuadView();
      btnQuadView.classList.toggle('active', isQuad);
      addAiMessage(
        `[Viewport] Switched to ${isQuad ? '4-View Engineering Quad Layout (Top, Front, Right, Iso)' : 'Single Perspective View'}.`
      );
    });
  }

  // In-Viewport 3D ViewCube & Orientation Gizmo
  const navGizmo = document.getElementById('viewport-nav-gizmo');
  if (navGizmo) {
    navGizmo.addEventListener('click', (e) => {
      const face = e.target.closest('.cube-face');
      if (face) {
        const view = face.getAttribute('data-view');
        if (view) viewport3D.setCameraPreset(view);
        return;
      }
      const compass = e.target.closest('.nav-compass');
      if (compass) {
        viewport3D.setCameraPreset('iso');
      }
    });
  }

  // --- Specialist Tool Modals ---
  const modalVerilog = document.getElementById('modal-verilog');
  const modalHpc = document.getElementById('modal-hpc');
  const modalReport = document.getElementById('modal-report');

  const btnOpenVerilog = document.getElementById('ribbon-btn-verilog');
  const btnOpenHpc = document.getElementById('ribbon-btn-hpc');
  const btnOpenReport = document.getElementById('ribbon-btn-report');
  const btnExportObj = document.getElementById('ribbon-btn-obj');

  if (btnOpenVerilog && modalVerilog) {
    btnOpenVerilog.addEventListener('click', () => {
      modalVerilog.classList.add('active');
    });
  }
  const btnCloseVerilog = document.getElementById('btn-close-verilog');
  if (btnCloseVerilog && modalVerilog) {
    btnCloseVerilog.addEventListener('click', () => modalVerilog.classList.remove('active'));
  }

  // Modal Verilog Synthesis
  const btnSynthesizeModal = document.getElementById('btn-synthesize-modal');
  const verilogInput = document.getElementById('verilog-source-input');
  const verilogResults = document.getElementById('verilog-synthesis-results');

  if (btnSynthesizeModal && verilogInput) {
    btnSynthesizeModal.addEventListener('click', async () => {
      try {
        const res = await window.omniEngAPI.synthesizeVerilog(verilogInput.value);
        if (!res?.success) throw new Error(res?.error?.message || 'The limited Verilog analysis is unavailable.');
        if (!verilogResults || !window.OmniEdaResultView?.renderVerilogResult) {
          throw new Error('The experimental Verilog result view is unavailable.');
        }
        const rendered = window.OmniEdaResultView.renderVerilogResult(res, document, verilogResults);
        if (!rendered.success)
          throw new Error(rendered.error || 'The experimental Verilog result could not be rendered.');
        verilogResults.style.display = 'block';
      } catch (err) {
        if (verilogResults) {
          verilogResults.style.display = 'block';
          verilogResults.textContent = `Synthesis Error: ${String(err?.message ?? err)}`;
        }
      }
    });
  }

  // Cloud HPC Modal
  const hpcTierText = document.getElementById('hpc-tier-status-text');
  const hpcNodesGrid = document.getElementById('hpc-nodes-grid');
  const btnSubmitHpcJob = document.getElementById('btn-submit-hpc-job');

  async function refreshHpcTelemetry() {
    if (!window.omniEngAPI || !window.omniEngAPI.getClusterStatus) return;
    try {
      const data = await window.omniEngAPI.getClusterStatus();
      if (hpcTierText) {
        hpcTierText.textContent =
          data?.configured === true
            ? `Configured provider: ${String(data.providerName || 'unknown').slice(0, 200)}`
            : 'Not configured';
      }
      if (hpcNodesGrid) {
        hpcNodesGrid.replaceChildren();
        const nodes = Array.isArray(data?.nodesSample) ? data.nodesSample.slice(0, 100) : [];
        if (nodes.length === 0) {
          hpcNodesGrid.textContent = 'No scheduler telemetry is available.';
        } else {
          for (const node of nodes) {
            if (!node || typeof node !== 'object') continue;
            const box = document.createElement('div');
            box.className = 'node-box';
            const header = document.createElement('div');
            header.className = 'node-box-header';
            const id = document.createElement('span');
            id.textContent = String(node.id ?? 'unknown').slice(0, 200);
            const cpuLoad = Number.isFinite(node.cpuLoadPct) ? Math.max(0, Math.min(100, node.cpuLoadPct)) : null;
            const cpu = document.createElement('span');
            cpu.textContent = cpuLoad === null ? 'CPU: unavailable' : `CPU: ${cpuLoad}%`;
            if (cpuLoad !== null) cpu.style.color = cpuLoad > 80 ? 'var(--accent-amber)' : 'var(--accent-cyan)';
            header.append(id, cpu);
            box.appendChild(header);

            const details = document.createElement('div');
            details.style.cssText = 'font-size:9px;color:var(--text-dim);';
            const gpuLoad = Number.isFinite(node.gpuLoadPct) ? `${node.gpuLoadPct}%` : 'unavailable';
            const memoryLoad = Number.isFinite(node.memUsagePct) ? `${node.memUsagePct}%` : 'unavailable';
            details.textContent = `GPU: ${gpuLoad} | Mem: ${memoryLoad}`;
            box.appendChild(details);

            if (cpuLoad !== null) {
              const barBackground = document.createElement('div');
              barBackground.className = 'load-bar-bg';
              const barFill = document.createElement('div');
              barFill.className = 'load-bar-fill';
              barFill.style.width = `${cpuLoad}%`;
              barBackground.appendChild(barFill);
              box.appendChild(barBackground);
            }
            hpcNodesGrid.appendChild(box);
          }
        }
      }
      if (btnSubmitHpcJob) btnSubmitHpcJob.disabled = true;
    } catch (err) {
      console.warn('HPC telemetry fetch error', err);
    }
  }

  if (btnOpenHpc && modalHpc) {
    btnOpenHpc.addEventListener('click', async () => {
      modalHpc.classList.add('active');
      await refreshHpcTelemetry();
    });
  }
  const btnCloseHpc = document.getElementById('btn-close-hpc');
  if (btnCloseHpc && modalHpc) {
    btnCloseHpc.addEventListener('click', () => modalHpc.classList.remove('active'));
  }

  // Audit Report Modal
  const reportIframe = document.getElementById('report-iframe');
  if (btnOpenReport && modalReport) {
    btnOpenReport.addEventListener('click', async () => {
      modalReport.classList.add('active');
      try {
        const report = await window.omniEngAPI.generateAuditReport(window.omniProjectEvidence || {});
        if (reportIframe) {
          if (report?.success && typeof report.htmlReport === 'string') {
            reportIframe.srcdoc = report.htmlReport;
          } else {
            reportIframe.srcdoc =
              '<!doctype html><html lang="en"><meta charset="utf-8"><body><h1>Report unavailable</h1><p>Provide project revision, engine version, hashed inputs, and result provenance before generating an engineering evidence report.</p></body></html>';
          }
        }
      } catch (err) {
        console.error('Audit report generation error', err);
      }
    });
  }
  const btnCloseReport = document.getElementById('btn-close-report');
  if (btnCloseReport && modalReport) {
    btnCloseReport.addEventListener('click', () => modalReport.classList.remove('active'));
  }
  const btnPrintReport = document.getElementById('btn-print-report');
  if (btnPrintReport && reportIframe) {
    btnPrintReport.addEventListener('click', () => {
      if (typeof window !== 'undefined' && (window.__OMNI_TEST_MODE__ || window.navigator?.webdriver)) {
        console.log('[Print] Automated test mode detected, bypassing native print dialog');
        return;
      }
      try {
        if (reportIframe.contentWindow && typeof reportIframe.contentWindow.print === 'function') {
          reportIframe.contentWindow.print();
        } else {
          window.print();
        }
      } catch (err) {
        console.warn('Iframe print error, falling back to window.print():', err);
        window.print();
      }
    });
  }

  // --- Experimental Frequency Response & Bode Plot Modal ---
  const modalBode = document.getElementById('modal-bode');
  const btnOpenBode = document.getElementById('ribbon-btn-bode');
  const btnCloseBode = document.getElementById('btn-close-bode');
  const btnRecomputeBode = document.getElementById('btn-recompute-bode');
  const bodePresetSelect = document.getElementById('bode-preset-select');
  const bodeSvgContainer = document.getElementById('bode-plot-svg-container');
  const bodeMetricsSummary = document.getElementById('bode-metrics-summary');

  async function runBodeAnalysis() {
    if (!window.omniEngAPI?.solveBode) {
      if (bodeSvgContainer) bodeSvgContainer.textContent = 'The experimental Bode analysis route is unavailable.';
      if (bodeMetricsSummary) bodeMetricsSummary.textContent = 'No margin values are available.';
      return;
    }

    const preset = window.OmniBodeChartModel?.getSyntheticPreset(bodePresetSelect?.value);
    if (!preset) {
      if (bodeSvgContainer) bodeSvgContainer.textContent = 'Select a supported synthetic Bode example to continue.';
      if (bodeMetricsSummary) bodeMetricsSummary.textContent = 'No margin values are available.';
      return;
    }

    try {
      const res = await window.omniEngAPI.solveBode({
        numCoeffs: preset.numCoeffs,
        denCoeffs: preset.denCoeffs,
        omegaMin: 0.1,
        omegaMax: 1000,
        points: 80
      });
      renderBodeSVG(res);
    } catch (err) {
      if (bodeSvgContainer) {
        bodeSvgContainer.textContent = `Bode estimate unavailable: ${String(err?.message ?? err)}`;
      }
    }
  }

  function renderBodeSVG(data) {
    if (!window.OmniBodeChartModel?.render) {
      if (bodeSvgContainer) bodeSvgContainer.textContent = 'The experimental Bode chart renderer is unavailable.';
      if (bodeMetricsSummary) bodeMetricsSummary.textContent = 'No margin values are available.';
      return;
    }

    window.OmniBodeChartModel.render(data, document, bodeSvgContainer, bodeMetricsSummary);
  }

  if (btnOpenBode && modalBode) {
    btnOpenBode.addEventListener('click', async () => {
      modalBode.classList.add('active');
      await runBodeAnalysis();
    });
  }
  if (btnCloseBode && modalBode) {
    btnCloseBode.addEventListener('click', () => modalBode.classList.remove('active'));
  }
  if (btnRecomputeBode) {
    btnRecomputeBode.addEventListener('click', runBodeAnalysis);
  }

  // --- Optical Spot Diagram & MTF Modal ---
  const modalOpticalInspector = document.getElementById('modal-optical-inspector');
  const btnOpenOpticalInspector = document.getElementById('ribbon-btn-optics');
  const btnCloseOpticalInspector = document.getElementById('btn-close-optical-inspector');
  const opticalInspectorBody = document.getElementById('optical-inspector-body');
  let opticalInspectorInstance = null;
  let lastOpticalInspectionResult = null;

  async function runOpticalInspection(request) {
    if (!opticalInspectorInstance && window.OpticalInspectorUI) {
      opticalInspectorInstance = new window.OpticalInspectorUI('optical-inspector-body');
    }
    if (!opticalInspectorInstance) return;
    if (!request) {
      opticalInspectorInstance.render(
        lastOpticalInspectionResult || {
          success: false,
          status: 'input-required',
          validationLevel: 'experimental',
          error: {
            code: 'INVALID_INPUT',
            message: 'Supply an optical surface array and trace settings to calculate spot and MTF estimates.'
          }
        }
      );
      return;
    }

    opticalInspectorInstance.setInputRequest(request);
    lastOpticalInspectionResult = null;
    if (!window.omniEngAPI?.solveSkewOptics) {
      opticalInspectorInstance.render({
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: { code: 'UNSUPPORTED', message: 'The optical ray-trace IPC route is unavailable in this build.' }
      });
      return;
    }
    try {
      const result = await window.omniEngAPI.solveSkewOptics(request);
      lastOpticalInspectionResult = result?.success === true ? result : null;
      opticalInspectorInstance.render(result);
    } catch (error) {
      opticalInspectorInstance.render({
        success: false,
        status: 'numerical-failure',
        validationLevel: 'experimental',
        error: { code: 'NUMERICAL_FAILURE', message: error.message || 'The supplied system could not be traced.' }
      });
    }
  }

  if (opticalInspectorBody) {
    opticalInspectorBody.addEventListener('click', async (event) => {
      if (!event.target.closest?.('#btn-run-optical-inspection') || !opticalInspectorInstance) return;
      try {
        const request = opticalInspectorInstance.readInputRequest();
        const status = document.getElementById('optical-run-status');
        if (status) status.textContent = 'Tracing the supplied system…';
        await runOpticalInspection(request);
      } catch (error) {
        const status = document.getElementById('optical-run-status');
        if (status) status.textContent = error.message || 'Check the supplied optical inputs.';
      }
    });
  }

  if (btnOpenOpticalInspector && modalOpticalInspector) {
    btnOpenOpticalInspector.addEventListener('click', async () => {
      modalOpticalInspector.classList.add('active');
      await runOpticalInspection();
    });
  }
  if (btnCloseOpticalInspector && modalOpticalInspector) {
    btnCloseOpticalInspector.addEventListener('click', () => modalOpticalInspector.classList.remove('active'));
  }

  // --- Experimental caller-supplied SPICE waveform viewer ---
  const modalSpiceOscilloscope = document.getElementById('modal-spice-oscilloscope');
  const btnOpenSpiceOscilloscope = document.getElementById('ribbon-btn-scope');
  const btnCloseSpiceOscilloscope = document.getElementById('btn-close-spice-oscilloscope');
  let spiceOscilloscopeInstance = null;

  async function runSpiceOscilloscope() {
    if (!window.omniEngAPI || !window.omniEngAPI.solveSpiceCircuit) return;
    if (!spiceOscilloscopeInstance && window.SpiceOscilloscopeUI) {
      spiceOscilloscopeInstance = new window.SpiceOscilloscopeUI('spice-oscilloscope-body', (request) =>
        window.omniEngAPI.solveSpiceCircuit(request)
      );
    }
    spiceOscilloscopeInstance?.render();
  }

  if (btnOpenSpiceOscilloscope && modalSpiceOscilloscope) {
    btnOpenSpiceOscilloscope.addEventListener('click', async () => {
      modalSpiceOscilloscope.classList.add('active');
      await runSpiceOscilloscope();
    });
  }
  if (btnCloseSpiceOscilloscope && modalSpiceOscilloscope) {
    btnCloseSpiceOscilloscope.addEventListener('click', () => modalSpiceOscilloscope.classList.remove('active'));
  }

  // --- Experimental plant flowsheet status modal ---
  const modalFlowsheetPfd = document.getElementById('modal-flowsheet-pfd');
  const btnOpenFlowsheetPfd = document.getElementById('ribbon-btn-pfd');
  const btnCloseFlowsheetPfd = document.getElementById('btn-close-flowsheet-pfd');
  let flowsheetPfdInstance = null;

  async function runFlowsheetPfd() {
    if (!window.omniEngAPI || !window.omniEngAPI.solveFlowsheet) return;
    try {
      if (!flowsheetPfdInstance && window.FlowsheetPfdUI) {
        flowsheetPfdInstance = new window.FlowsheetPfdUI('flowsheet-pfd-body');
      }
      const res = await window.omniEngAPI.solveFlowsheet();
      if (flowsheetPfdInstance) {
        flowsheetPfdInstance.render(res);
      }
    } catch (err) {
      console.error('Flowsheet PFD error:', err);
    }
  }

  if (btnOpenFlowsheetPfd && modalFlowsheetPfd) {
    btnOpenFlowsheetPfd.addEventListener('click', async () => {
      modalFlowsheetPfd.classList.add('active');
      await runFlowsheetPfd();
    });
  }
  if (btnCloseFlowsheetPfd && modalFlowsheetPfd) {
    btnCloseFlowsheetPfd.addEventListener('click', () => modalFlowsheetPfd.classList.remove('active'));
  }

  // --- ISO 10303-21 STEP Export Ribbon Button ---
  const btnExportStep = document.getElementById('ribbon-btn-step');
  if (btnExportStep) {
    btnExportStep.addEventListener('click', async () => {
      try {
        const res = await window.omniEngAPI.exportSTEP({
          width: state.manualParams.cadWidth,
          height: state.manualParams.cadHeight,
          depth: state.manualParams.cadDepth,
          units: 'mm',
          name: `OmniEng_${state.currentStudio}_Solid`
        });
        if (res && res.stepText) {
          const blob = new Blob([res.stepText], { type: 'application/step' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = res.filename || 'omnieng_model.step';
          a.click();
          URL.revokeObjectURL(url);
          addAiMessage(
            `Exported STEP-format geometry text: <code>${res.filename}</code> (${(res.stepText.length / 1024).toFixed(1)} KB). The file has not been independently validated for interoperability.`
          );
        }
      } catch (err) {
        console.error('STEP export error:', err);
      }
    });
  }

  // --- RS-274X Gerber Package Export Ribbon Button ---
  const btnExportGerber = document.getElementById('ribbon-btn-gerber');
  if (btnExportGerber) {
    btnExportGerber.addEventListener('click', async () => {
      const rawLayout = window.prompt(
        'Paste explicit PCB layout JSON. Include traces, pads, vias, solderMaskOpenings, holes, and boardOutline. All coordinates and dimensions are in millimeters.'
      );
      if (rawLayout === null) return;

      try {
        const pcbData = JSON.parse(rawLayout);
        const res = await window.omniEngAPI.exportGerber(pcbData);
        if (!res?.success || !res.package?.files) {
          addAiMessage(
            `[Experimental EDA] Gerber export unavailable: ${res?.error?.message || 'Invalid PCB layout input.'}`
          );
          return;
        }
        const files = Object.entries(res.package.files);
        for (const [filename, content] of files) {
          const blob = new Blob([content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }
        addAiMessage(
          `[Experimental EDA] Exported ${files.length} caller-supplied Gerber/Excellon files. Manufacturing compatibility has not been independently verified.`
        );
      } catch (err) {
        console.error('Gerber export error:', err);
        addAiMessage(`[Experimental EDA] Gerber export failed: ${err.message}`);
      }
    });
  }

  // Wavefront OBJ Export
  if (btnExportObj) {
    btnExportObj.addEventListener('click', async () => {
      try {
        const objContent = await window.omniEngAPI.exportCADOBJ({
          width: state.manualParams.cadWidth,
          height: state.manualParams.cadHeight,
          depth: state.manualParams.cadDepth,
          units: 'mm'
        });
        const blob = new Blob([objContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omnieng_${state.currentStudio}_model.obj`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('CAD OBJ export error', err);
      }
    });
  }

  // --- Phase 1 Project Lifecycle, Atomic Persistence & Undo/Redo ---
  function updateProjectHistoryUI(summary) {
    const btnUndoElem = document.getElementById('ribbon-btn-undo');
    const btnRedoElem = document.getElementById('ribbon-btn-redo');
    if (btnUndoElem) {
      btnUndoElem.disabled = !summary?.canUndo;
      btnUndoElem.title = summary?.canUndo ? 'Undo last change (Ctrl+Z)' : 'Nothing to undo';
      btnUndoElem.setAttribute('aria-label', btnUndoElem.title);
    }
    if (btnRedoElem) {
      btnRedoElem.disabled = !summary?.canRedo;
      btnRedoElem.title = summary?.canRedo ? 'Redo change (Ctrl+Y)' : 'Nothing to redo';
      btnRedoElem.setAttribute('aria-label', btnRedoElem.title);
    }
  }
  window.updateProjectHistoryUI = updateProjectHistoryUI;

  const btnNewProject = document.getElementById('ribbon-btn-new-project');
  if (btnNewProject) {
    btnNewProject.addEventListener('click', async () => {
      try {
        const res = await window.omni?.newProject?.({
          projectName: 'Untitled_Project',
          engineeringDomain: state.currentStudio || 'universal'
        });
        if (res?.success) {
          updateProjectHistoryUI(res.project);
          addAiMessage(`[Project Storage] Initialized fresh project session: ${res.project.projectName}`);
        }
      } catch (err) {
        console.error('Failed to create new project:', err);
      }
    });
  }

  const btnSaveProject = document.getElementById('ribbon-btn-save-project');
  if (btnSaveProject) {
    btnSaveProject.addEventListener('click', async () => {
      try {
        const res = await window.omni?.saveProject?.();
        if (res?.success) {
          addAiMessage(`[Project Storage] Saved project revision ${res.revision} to: ${res.filePath}`);
        } else if (res?.cancelled) {
          // User cancelled file dialog
        } else if (res?.error) {
          addAiMessage(`[Project Storage Error] ${res.error.message}`);
        }
      } catch (err) {
        console.error('Failed to save project:', err);
      }
    });
  }

  const btnOpenProject = document.getElementById('ribbon-btn-open-project');
  if (btnOpenProject) {
    btnOpenProject.addEventListener('click', async () => {
      try {
        const res = await window.omni?.openProject?.();
        if (res?.success && res.project) {
          updateProjectHistoryUI(res.project);
          addAiMessage(
            `[Project Storage] Opened project: ${res.project.projectName} (Revision ${res.project.revision}, ${res.project.blobCount} artifacts)`
          );
        } else if (res?.cancelled) {
          // User cancelled file dialog
        } else if (res?.error) {
          addAiMessage(`[Project Storage Error] ${res.error.message}`);
        }
      } catch (err) {
        console.error('Failed to open project:', err);
      }
    });
  }

  const btnUndo = document.getElementById('ribbon-btn-undo');
  if (btnUndo) {
    btnUndo.addEventListener('click', async () => {
      try {
        const res = await window.omni?.undoProjectCommand?.();
        if (res?.success) {
          updateProjectHistoryUI(res);
          addAiMessage(`[Undo] Undone: ${res.undoneEntry?.description || res.undoneEntry?.actionType || 'command'}`);
        }
      } catch (err) {
        console.error('Undo failed:', err);
      }
    });
  }

  const btnRedo = document.getElementById('ribbon-btn-redo');
  if (btnRedo) {
    btnRedo.addEventListener('click', async () => {
      try {
        const res = await window.omni?.redoProjectCommand?.();
        if (res?.success) {
          updateProjectHistoryUI(res);
          addAiMessage(`[Redo] Redone: ${res.redoneEntry?.description || res.redoneEntry?.actionType || 'command'}`);
        }
      } catch (err) {
        console.error('Redo failed:', err);
      }
    });
  }

  // --- Universal Usability & Phase 1 Guided Design Wizards ---
  const modalWizards = document.getElementById('modal-design-wizards');
  const btnOpenWizards = document.getElementById('ribbon-btn-wizards');
  const btnCloseWizards = document.getElementById('btn-close-design-wizards');
  const wizardsBody = document.getElementById('design-wizards-body');

  function renderWizardsModal() {
    if (!wizardsBody) return;
    wizardsBody.innerHTML = `
      <div style="padding: 10px 0;">
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Select an experimental workflow and provide its required inputs. Returned estimates do not establish design readiness:
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;">
          <!-- Wizard 1: Drop Test -->
          <div class="card" style="background: var(--bg-surface); padding: 16px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--accent-cyan); margin-bottom: 6px;">
              <span class="icon-slot" data-omni-icon="smartphone"></span> Phone Drop Test Wizard
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Runs a simplified handset impact estimate from the supplied mass, drop height, and orientation. No pass/fail or material failure decision is made.</div>
            <label style="display: block; font-size: 11px; margin-bottom: 8px;">Device mass (kg)
              <input class="text-input" id="wizard-drop-mass" type="number" min="0.000001" step="any" required value="" style="display: block; width: 100%; margin-top: 4px;">
            </label>
            <label style="display: block; font-size: 11px; margin-bottom: 8px;">Drop height (m)
              <input class="text-input" id="wizard-drop-height" type="number" min="0.000001" step="any" required value="" style="display: block; width: 100%; margin-top: 4px;">
            </label>
            <label style="display: block; font-size: 11px; margin-bottom: 12px;">Impact orientation
              <select class="select-input" id="wizard-drop-angle" required style="display: block; width: 100%; margin-top: 4px;">
                <option value="" selected>Select orientation</option>
                <option value="corner">Corner</option>
                <option value="edge">Edge</option>
                <option value="face">Face</option>
              </select>
            </label>
            <button class="btn btn-primary" id="wizard-run-drop" style="width: 100%; padding: 8px; font-size: 12px;">Run Impact Example</button>
          </div>

          <!-- Wizard 2: Drone Design -->
          <div class="card" style="background: var(--bg-surface); padding: 16px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #10b981; margin-bottom: 6px;">
              <span class="icon-slot" data-omni-icon="drone"></span> Drone & UAV Airframe Wizard
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Unavailable. The former estimate used unsourced thrust and battery assumptions; no independently reviewed sizing model is configured.</div>
            <button class="btn btn-primary" id="wizard-run-drone" disabled aria-disabled="true" style="width: 100%; padding: 8px; font-size: 12px; background: #10b981;">Drone Sizing Unavailable</button>
          </div>

          <!-- Wizard 3: Lens Optics -->
          <div class="card" style="background: var(--bg-surface); padding: 16px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #8b5cf6; margin-bottom: 6px;">
              <span class="icon-slot" data-omni-icon="cameraLens"></span> Camera Lens Optics Wizard
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Runs scalar estimates from the supplied lens, focus, wavelength, and circle-of-confusion inputs. It does not create a prescription or image-quality trace.</div>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Focal length (mm)<input class="text-input" id="wizard-lens-focal-length" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">F-number<input class="text-input" id="wizard-lens-f-number" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Subject distance (m)<input class="text-input" id="wizard-lens-distance" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Wavelength (nm)<input class="text-input" id="wizard-lens-wavelength" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:12px;">Circle of confusion (mm)<input class="text-input" id="wizard-lens-coc" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <button class="btn btn-primary" id="wizard-run-lens" style="width: 100%; padding: 8px; font-size: 12px; background: #8b5cf6;">Run Scalar Estimate</button>
          </div>

          <!-- Wizard 4: PCB RF Stackup -->
          <div class="card" style="background: var(--bg-surface); padding: 16px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #f59e0b; margin-bottom: 6px;">
              <span class="icon-slot" data-omni-icon="pcbStack"></span> High-Speed PCB Stackup Wizard
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Shows an experimental microstrip formula estimate from the supplied stackup. It does not generate manufacturing files or perform DRC, impedance verification, or release checks.</div>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Layer count<input class="text-input" id="wizard-pcb-layer-count" type="number" min="1" step="1" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Dielectric height (mm)<input class="text-input" id="wizard-pcb-dielectric-height" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Target impedance (Ω)<input class="text-input" id="wizard-pcb-target-impedance" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:8px;">Relative permittivity (er)<input class="text-input" id="wizard-pcb-er" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <label style="display:block;font-size:11px;margin-bottom:12px;">Copper thickness (mm)<input class="text-input" id="wizard-pcb-copper-thickness" type="number" min="0" step="any" required value="" style="display:block;width:100%;margin-top:4px;"></label>
            <button class="btn btn-primary" id="wizard-run-pcb" style="width: 100%; padding: 8px; font-size: 12px; background: #f59e0b;">Run Formula Estimate</button>
          </div>
        </div>

        <div id="wizard-output-container" style="margin-top: 18px; display: none; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
          <!-- Dynamically populated output -->
        </div>
      </div>
    `;

    // Attach run handlers
    const outContainer = document.getElementById('wizard-output-container');
    const showWizardOutput = (title, result, details) => {
      if (!outContainer) return;
      outContainer.style.display = 'block';
      outContainer.replaceChildren();
      const heading = document.createElement('div');
      heading.style.cssText =
        'display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--accent-cyan);margin-bottom:6px;';
      const icon = document.createElement('span');
      icon.className = 'icon-slot';
      icon.dataset.omniIcon = 'info';
      heading.append(icon, document.createTextNode(` ${String(title ?? '')} — Experimental Estimate Only`));

      const summary = document.createElement('div');
      summary.style.cssText = 'font-size:12px;color:#e2e8f0;line-height:1.5;margin-bottom:10px;';
      summary.textContent = String(result?.plainSummary ?? 'No summary was returned.');

      const detailBlock = document.createElement('pre');
      detailBlock.style.cssText =
        'background:#090d16;padding:10px;border-radius:6px;font-size:11px;color:#94a3b8;overflow-x:auto;';
      const serializedDetails = JSON.stringify(details, null, 2);
      detailBlock.textContent =
        serializedDetails && serializedDetails.length <= 1000000
          ? serializedDetails
          : 'Details are unavailable or exceed the 1 MB display limit.';

      outContainer.append(heading, summary, detailBlock);
      if (window.OmniIcons) window.OmniIcons.hydrateAll(outContainer);
    };

    const readPositiveInput = (id) => {
      const value = Number(document.getElementById(id)?.value);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const showWizardInputError = (message) => {
      if (!outContainer) return;
      outContainer.style.display = 'block';
      outContainer.textContent = message;
    };

    if (window.OmniIcons) window.OmniIcons.hydrateAll(wizardsBody);

    document.getElementById('wizard-run-drop')?.addEventListener('click', async () => {
      if (window.omniEngAPI?.runDesignWizard) {
        const phoneMassKg = Number(document.getElementById('wizard-drop-mass')?.value);
        const dropHeightM = Number(document.getElementById('wizard-drop-height')?.value);
        const impactAngle = document.getElementById('wizard-drop-angle')?.value;
        if (
          !Number.isFinite(phoneMassKg) ||
          phoneMassKg <= 0 ||
          !Number.isFinite(dropHeightM) ||
          dropHeightM <= 0 ||
          !['corner', 'edge', 'face'].includes(impactAngle)
        ) {
          if (outContainer) {
            outContainer.style.display = 'block';
            outContainer.textContent =
              'No estimate was run. Enter a positive device mass and drop height, and select an impact orientation.';
          }
          return;
        }
        const res = await window.omniEngAPI.runDesignWizard('drop_test', { phoneMassKg, dropHeightM, impactAngle });
        if (res?.result) {
          showWizardOutput('Smartphone Impact Example', res.result, {
            inputs: res.result.inputs,
            modelAssumptions: res.result.modelAssumptions,
            physics: res.result.physics
          });
          addAiMessage(`Wizard Result: ${res.result.plainSummary}`);
        } else if (outContainer) {
          outContainer.style.display = 'block';
          outContainer.textContent =
            res?.error?.message || 'No estimate was run because the input values were invalid.';
        }
      }
    });

    document.getElementById('wizard-run-lens')?.addEventListener('click', async () => {
      if (window.omniEngAPI?.runDesignWizard) {
        const inputs = {
          focalLengthMm: readPositiveInput('wizard-lens-focal-length'),
          fStop: readPositiveInput('wizard-lens-f-number'),
          subjectDistM: readPositiveInput('wizard-lens-distance'),
          wavelengthNm: readPositiveInput('wizard-lens-wavelength'),
          circleOfConfusionMm: readPositiveInput('wizard-lens-coc')
        };
        if (Object.values(inputs).some((value) => value === null)) {
          showWizardInputError('No estimate was run. Enter a positive value for each lens input.');
          return;
        }
        const res = await window.omniEngAPI.runDesignWizard('camera_lens', {
          ...inputs
        });
        if (res?.result) {
          showWizardOutput('Camera Lens Scalar Estimate', res.result, res.result.opticalSpecs);
          addAiMessage(`Wizard Result: ${res.result.plainSummary}`);
        } else {
          showWizardInputError(res?.error?.message || 'No scalar estimate was returned.');
        }
      }
    });

    document.getElementById('wizard-run-pcb')?.addEventListener('click', async () => {
      if (window.omniEngAPI?.runDesignWizard) {
        const layerCount = readPositiveInput('wizard-pcb-layer-count');
        const inputs = {
          layerCount,
          dielectricHeightMm: readPositiveInput('wizard-pcb-dielectric-height'),
          targetImpedanceOhm: readPositiveInput('wizard-pcb-target-impedance'),
          er: readPositiveInput('wizard-pcb-er'),
          copperThicknessMm: readPositiveInput('wizard-pcb-copper-thickness')
        };
        if (Object.values(inputs).some((value) => value === null) || !Number.isInteger(layerCount)) {
          showWizardInputError(
            'No estimate was run. Enter a positive value for each PCB input and an integer layer count.'
          );
          return;
        }
        const res = await window.omniEngAPI.runDesignWizard('pcb', {
          ...inputs
        });
        if (res?.result) {
          showWizardOutput('PCB Trace Formula Estimate', res.result, res.result.stackup);
          addAiMessage(`Wizard Result: ${res.result.plainSummary}`);
        } else {
          showWizardInputError(res?.error?.message || 'No PCB estimate was returned.');
        }
      }
    });
  }

  if (btnOpenWizards && modalWizards) {
    btnOpenWizards.addEventListener('click', () => {
      modalWizards.classList.add('active');
      renderWizardsModal();
    });
  }
  if (btnCloseWizards && modalWizards) {
    btnCloseWizards.addEventListener('click', () => modalWizards.classList.remove('active'));
  }

  // --- Single-File .omni Container Export Ribbon Button ---
  const btnSaveOmni = document.getElementById('ribbon-btn-omni-archive');
  if (btnSaveOmni) {
    btnSaveOmni.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.packageOmniArchive) {
          const res = await window.omniEngAPI.packageOmniArchive({
            projectName: `OmniEng_${state.currentStudio}_Project`,
            engineeringDomain: state.currentStudio,
            sections: {
              activeParams: state.manualParams,
              exportTime: new Date().toISOString()
            }
          });
          if (res?.success) {
            addAiMessage(
              `Exported .omni session snapshot: <code>${res.filename}</code> (${res.sizeBytes} bytes, ${res.sectionCount} sections: ${res.sections.join(', ')}). This snapshot contains the supplied sections only; a complete project archive or lossless round trip has not been verified.`
            );
          }
        }
      } catch (err) {
        console.error('.omni archive packaging error:', err);
      }
    });
  }

  // --- Phase 2: 2D Engineering Drafting & GD&T Sheet ---
  const btnOpenDrafting = document.getElementById('ribbon-btn-drafting');
  const modalDrafting = document.getElementById('modal-drafting-sheet');
  const btnCloseDrafting = document.getElementById('btn-close-drafting-sheet');
  const draftingSheetBody = document.getElementById('drafting-sheet-body');

  if (btnOpenDrafting && modalDrafting) {
    btnOpenDrafting.addEventListener('click', async () => {
      modalDrafting.classList.add('active');
      if (draftingSheetBody) {
        draftingSheetBody.textContent = 'Generating an experimental sample drawing...';
      }
      try {
        if (window.omniEngAPI?.generateDraftingSheet) {
          const res = await window.omniEngAPI.generateDraftingSheet({
            partName: 'Universal Bracket Mount',
            partNumber: 'OE-DWG-BKT-01',
            scale: '1:1',
            units: 'mm',
            width: 50,
            height: 30,
            depth: 20
          });
          if (
            res?.success &&
            draftingSheetBody &&
            typeof res.svg === 'string' &&
            res.svg.length <= 1000000 &&
            Number.isFinite(res.sheetWidth) &&
            Number.isFinite(res.sheetHeight)
          ) {
            const header = document.createElement('div');
            header.style.cssText =
              'margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;color:#94a3b8;font-size:12px;';
            const description = document.createElement('span');
            description.textContent =
              'Illustrative box drawing; no GD&T supplied; standards conformance is not evaluated.';
            const sheetSize = document.createElement('span');
            sheetSize.style.cssText = 'color:var(--accent-cyan);font-weight:600;';
            sheetSize.textContent = `Scale 1:1 • Sheet Size: ${res.sheetWidth}x${res.sheetHeight}`;
            header.append(description, sheetSize);

            const drawingImage = document.createElement('img');
            drawingImage.alt = 'Experimental illustrative box drawing';
            drawingImage.style.cssText = 'display:block;width:100%;height:auto;background:#020617;';
            drawingImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(res.svg)}`;
            const drawingFrame = document.createElement('div');
            drawingFrame.style.cssText =
              'background:#020617;border:1px solid #1e293b;border-radius:6px;padding:8px;overflow:auto;max-height:70vh;';
            drawingFrame.replaceChildren(drawingImage);
            draftingSheetBody.replaceChildren(header, drawingFrame);
            addAiMessage(
              'Experimental sample drawing generated. It has not been checked for drafting-standard conformance.'
            );
          } else if (draftingSheetBody) {
            draftingSheetBody.textContent = String(
              res?.error?.message ||
                (typeof res?.svg === 'string' && res.svg.length > 1000000
                  ? 'No drawing was shown because the returned SVG exceeded the 1 MB display limit.'
                  : 'No drawing was returned for the supplied inputs.')
            );
          }
        }
      } catch (err) {
        console.error('Drafting generation error:', err);
      }
    });
  }

  if (btnCloseDrafting && modalDrafting) {
    btnCloseDrafting.addEventListener('click', () => modalDrafting.classList.remove('active'));
  }

  // --- Phase 2: Rolling-Ball Fillet / Chamfer Edge Blend ---
  const btnEdgeBlend = document.getElementById('ribbon-btn-blend');
  if (btnEdgeBlend) {
    btnEdgeBlend.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.applyEdgeBlend) {
          const res = await window.omniEngAPI.applyEdgeBlend({
            type: 'fillet',
            radius: 2.5,
            width: 30,
            height: 30,
            depth: 30
          });
          if (res?.success) {
            addAiMessage(
              `[Edge Blender] Rolling-ball fillet applied (Radius: 2.5mm, Blend Faces: ${res.blendFacesCount}, Surface Area: ${res.filletSurfaceArea?.toFixed(2)} mm²).`
            );
          }
        }
      } catch (err) {
        console.error('Edge blend error:', err);
      }
    });
  }

  // --- Phase 2: 3D Assembly Kinematic Mates ---
  const btnAssembly = document.getElementById('ribbon-btn-assembly');
  if (btnAssembly) {
    btnAssembly.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.solveAssemblyMates) {
          const res = await window.omniEngAPI.solveAssemblyMates({ targetZ: 12.0 });
          if (res?.success && res.result) {
            addAiMessage(
              `[Kinematic Solver] 3D Assembly resolved Coincident & Concentric mates (Iterations: ${res.result.iterations}, Max Residual: ${res.result.maxResidual?.toExponential(3)}, Rank: ${res.result.rank}/${res.result.totalDOFs}, Remaining DOFs: ${res.result.dofRemaining}).`
            );
          }
        }
      } catch (err) {
        console.error('Assembly mates error:', err);
      }
    });
  }

  // --- Phase 3: 3D Delaunay & Advancing-Front TET10 Mesher ---
  const btnMesher = document.getElementById('ribbon-btn-mesher');
  if (btnMesher) {
    btnMesher.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.meshDelaunay3D) {
          const boxVerts = [
            { x: 0, y: 0, z: 0 },
            { x: 0.1, y: 0, z: 0 },
            { x: 0.1, y: 0.1, z: 0 },
            { x: 0, y: 0.1, z: 0 },
            { x: 0, y: 0, z: 0.1 },
            { x: 0.1, y: 0, z: 0.1 },
            { x: 0.1, y: 0.1, z: 0.1 },
            { x: 0, y: 0.1, z: 0.1 }
          ];
          const boxFaces = [
            [0, 1, 2],
            [0, 2, 3],
            [4, 6, 5],
            [4, 7, 6],
            [0, 5, 1],
            [0, 4, 5],
            [2, 7, 3],
            [2, 6, 7],
            [0, 3, 7],
            [0, 7, 4],
            [1, 5, 6],
            [1, 6, 2]
          ];
          const res = await window.omniEngAPI.meshDelaunay3D({ vertices: boxVerts, faces: boxFaces, quadratic: true });
          if (res?.success && res.mesh) {
            addAiMessage(
              `[3D Mesher] Delaunay mesher generated ${res.mesh.type} volume mesh with ${res.mesh.nodeCount} nodes and ${res.mesh.elementCount} elements (Avg Quality: ${res.mesh.metrics?.averageQuality?.toFixed(3)}, Valid: ${res.mesh.metrics?.validElementPercentage?.toFixed(1)}%).`
            );
          }
        }
      } catch (err) {
        console.error('3D mesher error:', err);
      }
    });
  }

  // --- Phase 3: 3D Polyhedral FVM Navier-Stokes with k-omega SST ---
  const btnFvmCfd = document.getElementById('ribbon-btn-fvm-cfd');
  if (btnFvmCfd) {
    btnFvmCfd.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.solveFvmCFD3D) {
          const res = await window.omniEngAPI.solveFvmCFD3D({ inletVelocity: 25.0, steps: 5 });
          if (res?.success && res.result) {
            addAiMessage(
              `[Polyhedral CFD] Solved 5 pseudo-transient steps with Menter k-omega SST turbulence (Max Velocity: ${res.result.maxVelocity?.toFixed(2)} m/s, Max Eddy Viscosity: ${res.result.maxTurbulentViscosity?.toExponential(3)} m²/s).`
            );
          }
        }
      } catch (err) {
        console.error('3D CFD error:', err);
      }
    });
  }

  // --- Phase 6: DIN 6935 K-Factor Sheet Metal Unfolding ---
  const btnSheetMetal = document.getElementById('ribbon-btn-sheet-metal');
  if (btnSheetMetal) {
    btnSheetMetal.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.unfoldSheetMetal) {
          const res = await window.omniEngAPI.unfoldSheetMetal({
            bend: { angleDeg: 90.0, innerRadiusMm: 2.0, thicknessMm: 2.0, kFactor: 0.44 },
            flanges: [
              { name: 'Base', lengthMm: 60, widthMm: 40 },
              { name: 'Flange', lengthMm: 40, widthMm: 40 }
            ]
          });
          if (res?.success && res.flat) {
            addAiMessage(
              `[Sheet Metal] DIN 6935 unfolder generated 2D flat blank pattern (Developed Length: ${res.flat.totalDevelopedLengthMm?.toFixed(2)} mm, Bend Allowance: ${res.bendAllowanceMm?.toFixed(2)} mm, Bend Deduction: ${res.bendDeductionMm?.toFixed(2)} mm).`
            );
          }
        }
      } catch (err) {
        console.error('Sheet metal error:', err);
      }
    });
  }

  // --- Experimental sample tolerance calculation ---
  const btnGDT = document.getElementById('ribbon-btn-gdt');
  if (btnGDT) {
    btnGDT.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.evaluateGDT) {
          const res = await window.omniEngAPI.evaluateGDT({
            fcf: { specifiedTolerance: 0.25, materialCondition: 'MMC' }
          });
          if (res?.success && res.result) {
            addAiMessage(
              `[Experimental tolerance example] Sample position error: ${res.result.positionErrorDiameter?.toFixed(3)} mm; example bonus tolerance: +${res.result.bonusTolerance?.toFixed(3)} mm; example total tolerance: ${res.result.totalAllowableTolerance?.toFixed(3)} mm. No standards conformance decision is made.`
            );
          }
        }
      } catch (err) {
        console.error('GD&T error:', err);
      }
    });
  }

  // --- Experimental co-simulation example ---
  const btnFmi = document.getElementById('ribbon-btn-fmi');
  if (btnFmi) {
    btnFmi.addEventListener('click', async () => {
      try {
        if (window.omniEngAPI?.runFmiCoSimulation) {
          const res = await window.omniEngAPI.runFmiCoSimulation({
            config: { startTime: 0, stopTime: 0.1, defaultStepSize: 0.001 }
          });
          if (res?.success && res.result) {
            addAiMessage(
              `[Experimental co-simulation example] Returned ${res.result.slaveCount} component examples and ${res.result.totalSteps} time steps through ${res.result.finalTime?.toFixed(3)} s. The workflow has not been independently validated for FMI conformance or engineering use.`
            );
          }
        }
      } catch (err) {
        console.error('FMI Co-Sim error:', err);
      }
    });
  }

  // =========================================================================
  // Experimental workbench modals and UI handlers
  // =========================================================================

  // 1. 2D Variational Geometric Constraint Sketcher Modal & Canvas
  const modalSketcher = document.getElementById('modal-variational-sketcher');
  const btnOpenSketcher = document.getElementById('ribbon-btn-sketcher');
  const btnCloseSketcher = document.getElementById('btn-close-variational-sketcher');
  const canvasSketcher = document.getElementById('canvas-variational-sketcher');
  const btnSolveSketcher = document.getElementById('btn-solve-sketcher');
  const btnResetSketcher = document.getElementById('btn-reset-sketcher');
  const sketcherPresetSelect = document.getElementById('sketcher-preset-select');

  const sketcherPresets = {
    quad_constrained: {
      points: {
        P1: { x: 200, y: 300, fixed: true, label: 'P1 (Fixed Origin)' },
        P2: { x: 560, y: 300, fixed: false, label: 'P2' },
        P3: { x: 560, y: 140, fixed: false, label: 'P3' },
        P4: { x: 200, y: 140, fixed: false, label: 'P4' }
      },
      constraints: [
        { type: 'HORIZONTAL', point1: 'P1', point2: 'P2' },
        { type: 'VERTICAL', point1: 'P2', point2: 'P3' },
        { type: 'HORIZONTAL', point1: 'P4', point2: 'P3' },
        { type: 'VERTICAL', point1: 'P1', point2: 'P4' },
        { type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 },
        { type: 'DISTANCE', point1: 'P2', point2: 'P3', value: 30.0 }
      ],
      glyphs: [
        { text: 'H [L=40.0mm]', pt1: 'P1', pt2: 'P2', offset: { x: -25, y: 16 } },
        { text: 'V [H=30.0mm]', pt1: 'P2', pt2: 'P3', offset: { x: 8, y: 0 } },
        { text: 'H', pt1: 'P4', pt2: 'P3', offset: { x: -4, y: -8 } },
        { text: 'V', pt1: 'P1', pt2: 'P4', offset: { x: -18, y: 0 } }
      ]
    },
    triplet_triangle: {
      points: {
        P1: { x: 220, y: 320, fixed: true, label: 'P1 (Origin)' },
        P2: { x: 580, y: 320, fixed: false, label: 'P2' },
        P3: { x: 220, y: 120, fixed: false, label: 'P3 (Apex)' }
      },
      constraints: [
        { type: 'HORIZONTAL', point1: 'P1', point2: 'P2' },
        { type: 'VERTICAL', point1: 'P1', point2: 'P3' },
        { type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 },
        { type: 'DISTANCE', point1: 'P1', point2: 'P3', value: 30.0 }
      ],
      glyphs: [
        { text: 'H [Base=40mm]', pt1: 'P1', pt2: 'P2', offset: { x: -30, y: 16 } },
        { text: 'V [Height=30mm]', pt1: 'P1', pt2: 'P3', offset: { x: -35, y: 0 } },
        { text: 'Hypotenuse', pt1: 'P2', pt2: 'P3', offset: { x: 10, y: -10 } }
      ]
    },
    tangent_arc: {
      points: {
        P1: { x: 250, y: 250, fixed: true, label: 'C (Center)' },
        P2: { x: 450, y: 250, fixed: false, label: 'P_arc' },
        P3: { x: 450, y: 120, fixed: false, label: 'P_tan' },
        P4: { x: 250, y: 120, fixed: false, label: 'P_top' }
      },
      constraints: [
        { type: 'HORIZONTAL', point1: 'P1', point2: 'P2' },
        { type: 'VERTICAL', point1: 'P2', point2: 'P3' },
        { type: 'HORIZONTAL', point1: 'P4', point2: 'P3' },
        { type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 25.0 }
      ],
      glyphs: [
        { text: 'Radius R=25mm', pt1: 'P1', pt2: 'P2', offset: { x: -35, y: 16 } },
        { text: 'Tangent Line', pt1: 'P2', pt2: 'P3', offset: { x: 8, y: 0 } }
      ]
    }
  };

  const sketcherState = {
    currentPreset: 'quad_constrained',
    points: JSON.parse(JSON.stringify(sketcherPresets.quad_constrained.points)),
    draggedPointId: null,
    dragOffset: { x: 0, y: 0 }
  };

  function loadSketcherPreset(key) {
    if (!sketcherPresets[key]) return;
    sketcherState.currentPreset = key;
    sketcherState.points = JSON.parse(JSON.stringify(sketcherPresets[key].points));
    renderSketcherCanvas();
    solveSketcher();
  }

  if (sketcherPresetSelect) {
    sketcherPresetSelect.addEventListener('change', (e) => {
      loadSketcherPreset(e.target.value);
    });
  }

  function renderSketcherCanvas() {
    if (!canvasSketcher) return;
    const ctx = canvasSketcher.getContext('2d');
    const w = canvasSketcher.width;
    const h = canvasSketcher.height;

    // Clear background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, w, h);

    // Subtle CAD coordinate grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridSize = 25;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const pts = sketcherState.points;
    const keys = Object.keys(pts);

    // Draw Parametric Profile Lines
    if (keys.length >= 2) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pts[keys[0]].x, pts[keys[0]].y);
      for (let i = 1; i < keys.length; i++) {
        ctx.lineTo(pts[keys[i]].x, pts[keys[i]].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Fill semi-transparent profile
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fill();
    }

    // Draw Constraint Glyphs from preset
    const presetDef = sketcherPresets[sketcherState.currentPreset];
    if (presetDef && presetDef.glyphs) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px monospace';
      for (const g of presetDef.glyphs) {
        const p1 = pts[g.pt1];
        const p2 = pts[g.pt2];
        if (p1 && p2) {
          const midX = (p1.x + p2.x) / 2 + (g.offset.x || 0);
          const midY = (p1.y + p2.y) / 2 + (g.offset.y || 0);
          ctx.fillText(g.text, midX, midY);
        }
      }
    }

    // Draw Vertices
    for (const [id, pt] of Object.entries(pts)) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.fixed ? 7 : 6, 0, Math.PI * 2);
      ctx.fillStyle = pt.fixed ? '#ef4444' : sketcherState.draggedPointId === id ? '#4ade80' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Vertex label
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText(pt.label || id, pt.x + 8, pt.y - 8);
    }
  }

  async function solveSketcher() {
    if (!window.omniEngAPI?.solveVariationalSketch) return;
    try {
      const presetDef = sketcherPresets[sketcherState.currentPreset];
      if (!presetDef) return;

      const pts = sketcherState.points;
      const refP = pts.P1 || Object.values(pts)[0];
      const scale = 9.0;

      const solverPoints = Object.entries(pts).map(([id, pt]) => ({
        id,
        x: (pt.x - refP.x) / scale,
        y: -(pt.y - refP.y) / scale,
        fixed: !!pt.fixed
      }));

      const res = await window.omniEngAPI.solveVariationalSketch({
        points: solverPoints,
        constraints: presetDef.constraints
      });

      if (res?.success) {
        const elRes = document.getElementById('sketcher-residual');
        const elIter = document.getElementById('sketcher-iterations');
        const elDof = document.getElementById('sketcher-dof');
        if (elRes) elRes.textContent = Number.isFinite(res.residualNorm) ? res.residualNorm.toExponential(2) : '—';
        if (elIter) elIter.textContent = res.iterations ?? '—';
        if (elDof) elDof.textContent = `${res.degreesOfFreedom ?? '—'} (${res.status || 'experimental result'})`;

        // Physically snap points to variational solved coordinates
        if (res.points) {
          for (const [id, sol] of Object.entries(res.points)) {
            if (pts[id] && !pts[id].fixed) {
              pts[id].x = refP.x + sol.x * scale;
              pts[id].y = refP.y - sol.y * scale;
            }
          }
          renderSketcherCanvas();
        }
      }
    } catch (err) {
      console.error('Sketcher solver error:', err);
    }
  }

  if (canvasSketcher) {
    canvasSketcher.addEventListener('mousedown', (e) => {
      const rect = canvasSketcher.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      for (const [id, pt] of Object.entries(sketcherState.points)) {
        if (!pt.fixed) {
          const dist = Math.hypot(mouseX - pt.x, mouseY - pt.y);
          if (dist <= 14) {
            sketcherState.draggedPointId = id;
            sketcherState.dragOffset = { x: mouseX - pt.x, y: mouseY - pt.y };
            break;
          }
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (sketcherState.draggedPointId && canvasSketcher) {
        const rect = canvasSketcher.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const pt = sketcherState.points[sketcherState.draggedPointId];
        if (pt) {
          pt.x = Math.max(30, Math.min(canvasSketcher.width - 30, mouseX - sketcherState.dragOffset.x));
          pt.y = Math.max(30, Math.min(canvasSketcher.height - 30, mouseY - sketcherState.dragOffset.y));
          renderSketcherCanvas();
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (sketcherState.draggedPointId) {
        sketcherState.draggedPointId = null;
        solveSketcher();
      }
    });
  }

  if (btnOpenSketcher && modalSketcher) {
    btnOpenSketcher.addEventListener('click', () => {
      modalSketcher.classList.add('active');
      renderSketcherCanvas();
      solveSketcher();
    });
  }
  if (btnCloseSketcher && modalSketcher) {
    btnCloseSketcher.addEventListener('click', () => modalSketcher.classList.remove('active'));
  }
  if (btnSolveSketcher) {
    btnSolveSketcher.addEventListener('click', () => {
      solveSketcher();
      renderSketcherCanvas();
    });
  }
  if (btnResetSketcher) {
    btnResetSketcher.addEventListener('click', () => {
      loadSketcherPreset(sketcherState.currentPreset);
    });
  }

  // 2. Topological Healing Modal
  const modalHealer = document.getElementById('modal-topological-healer');
  const btnOpenHealer = document.getElementById('ribbon-btn-heal');
  const btnCloseHealer = document.getElementById('btn-close-topological-healer');
  const btnRunHeal = document.getElementById('btn-run-auto-heal');
  const sliderHealTol = document.getElementById('slider-healing-tol');
  const lblHealTol = document.getElementById('lbl-healing-tol');
  const logHealOutput = document.getElementById('healing-log-output');

  if (sliderHealTol && lblHealTol) {
    sliderHealTol.addEventListener('input', () => {
      const tol = parseFloat(sliderHealTol.value);
      lblHealTol.textContent = tol.toFixed(3) + ' mm';
      const gapEl = document.getElementById('healer-gap-val');
      if (gapEl && gapEl.textContent.includes('gap')) {
        gapEl.textContent = (tol * 0.44).toFixed(3) + ' mm gap';
      }
    });
  }

  if (btnRunHeal && logHealOutput) {
    btnRunHeal.addEventListener('click', async () => {
      try {
        logHealOutput.textContent =
          '[1/3] Scanning B-Rep topological graph for vertex micro-gaps & non-manifold edges...';
        if (window.omniEngAPI?.healCadGeometry) {
          const tol = parseFloat(sliderHealTol?.value || 0.05);
          const t0 = performance.now();
          const res = await window.omniEngAPI.healCadGeometry({
            options: { tolerance: tol },
            dirtyModel: {
              vertices: [
                { id: 'v1', x: 0, y: 0, z: 0 },
                { id: 'v2', x: 0.02, y: 0.01, z: 0 },
                { id: 'v3', x: 10, y: 0, z: 0 },
                { id: 'v4', x: 10, y: 10, z: 0 },
                { id: 'v5', x: 0, y: 10, z: 0 }
              ],
              faces: [
                { id: 'f1', vertexIds: ['v1', 'v3', 'v4', 'v5'] },
                { id: 'f_sliver', vertexIds: ['v1', 'v2', 'v3'] }
              ]
            }
          });
          const elapsed = (performance.now() - t0).toFixed(1);

          // Update inspection table dynamically to reflect healed status
          const elNm = document.getElementById('healer-nonmanifold-count');
          const elSl = document.getElementById('healer-sliver-count');
          const elGap = document.getElementById('healer-gap-val');
          const elWt = document.getElementById('healer-watertight-status');
          if (elNm) elNm.textContent = 'Not reported';
          if (elSl) elSl.textContent = 'Not reported';
          if (elGap) elGap.textContent = 'Not reported';
          if (elWt) elWt.textContent = 'Experimental';

          const output = document.createDocumentFragment();
          const appendHealingLine = (text, emphasis = false) => {
            const line = document.createElement(emphasis ? 'strong' : 'span');
            line.style.color = emphasis ? '#fbbf24' : '#cbd5e1';
            line.textContent = text;
            output.append(line, document.createElement('br'));
          };
          appendHealingLine(`EXPERIMENTAL GEOMETRY HEALING OUTPUT (${elapsed} ms)`, true);
          appendHealingLine(`- Stitched vertex count: ${res.stitchedVerticesCount ?? 'not reported'}`);
          appendHealingLine(
            `- Collapsed sliver count: ${res.collapsedSliversCount ?? res.collapsedSliverCount ?? 'not reported'}`
          );
          appendHealingLine('- Topology and downstream CAD validity have not been independently verified.');
          logHealOutput.replaceChildren(output);
          addAiMessage(
            `[Experimental Topology Healer] Returned geometry diagnostics in ${elapsed}ms. Review the result before use.`
          );
        }
      } catch (err) {
        logHealOutput.textContent = `Geometry diagnostic unavailable: ${String(err?.message ?? err)}`;
      }
    });
  }

  if (btnOpenHealer && modalHealer) {
    btnOpenHealer.addEventListener('click', () => {
      modalHealer.classList.add('active');
    });
  }
  if (btnCloseHealer && modalHealer) {
    btnCloseHealer.addEventListener('click', () => modalHealer.classList.remove('active'));
  }

  // 3. DLS Optical Optimizer Modal
  const modalDLS = document.getElementById('modal-dls-optimizer');
  const btnOpenDLS = document.getElementById('ribbon-btn-opt-dls');
  const btnCloseDLS = document.getElementById('btn-close-dls-optimizer');
  const btnRunDLS = document.getElementById('btn-run-dls-opt');
  const canvasDLS = document.getElementById('canvas-dls-convergence');

  function plotDLSConvergence(history = []) {
    if (!canvasDLS) return;
    const ctx = canvasDLS.getContext('2d');
    const w = canvasDLS.width;
    const h = canvasDLS.height;

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 60; x < w - 20; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, h - 30);
      ctx.stroke();
    }
    for (let y = 20; y < h - 30; y += 35) {
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(w - 20, y);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(60, 10);
    ctx.lineTo(60, h - 30);
    ctx.lineTo(w - 20, h - 30);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    const validHistory = Array.isArray(history) ? history.filter(Number.isFinite) : [];
    const maxVal = validHistory.length ? Math.max(...validHistory, 1) : 1;
    ctx.fillText('Merit', 15, 20);
    if (validHistory.length) {
      ctx.fillText(maxVal.toFixed(0), 30, 25);
      ctx.fillText((maxVal * 0.5).toFixed(0), 30, (h - 30) / 2 + 5);
    }
    ctx.fillText('0', 45, h - 32);

    ctx.fillText('DLS Levenberg-Marquardt Iterations', w / 2 - 80, h - 10);

    if (validHistory.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('No optimization history available', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Plot line
    const xStep = (w - 100) / Math.max(1, validHistory.length - 1);

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    validHistory.forEach((val, idx) => {
      const px = 60 + idx * xStep;
      const py = h - 30 - (val / maxVal) * (h - 60);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Plot Points
    validHistory.forEach((val, idx) => {
      const px = 60 + idx * xStep;
      const py = h - 30 - (val / maxVal) * (h - 60);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = idx === validHistory.length - 1 ? '#38bdf8' : '#4ade80';
      ctx.fill();
      ctx.stroke();
    });
  }

  if (btnRunDLS) {
    btnRunDLS.addEventListener('click', async () => {
      const status = document.getElementById('dls-run-status');
      const outputIds = [
        'lbl-dls-init-merit',
        'lbl-dls-opt-merit',
        'lbl-dls-focal',
        'lbl-dls-spread',
        'lbl-dls-termination'
      ];
      const setStatus = (message) => {
        if (status) status.textContent = message;
      };
      const setOutputsUnavailable = () => {
        for (const id of outputIds) {
          const element = document.getElementById(id);
          if (element) element.textContent = 'Unavailable';
        }
      };
      try {
        if (!window.omniEngAPI?.optimizeOpticalDLS) {
          setOutputsUnavailable();
          setStatus('The optical optimizer IPC is unavailable in this build.');
          return;
        }

        const parseJsonField = (id, label, expectedType) => {
          const raw = document.getElementById(id)?.value?.trim();
          if (!raw) throw new Error(`${label} is required.`);
          let value;
          try {
            value = JSON.parse(raw);
          } catch (error) {
            throw new Error(`${label} must contain valid JSON: ${error.message}`);
          }
          if (expectedType === 'array' && !Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
          if (expectedType === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
            throw new Error(`${label} must be a JSON object.`);
          }
          return value;
        };

        const request = {
          system: parseJsonField('dls-system-input', 'Optical system', 'object'),
          variables: parseJsonField('dls-variables-input', 'Optimization variables', 'array'),
          operands: parseJsonField('dls-operands-input', 'Merit operands', 'array'),
          options: parseJsonField('dls-options-input', 'Optimizer controls', 'object')
        };
        setOutputsUnavailable();
        setStatus('Running experimental paraxial optimization…');

        const res = await window.omniEngAPI.optimizeOpticalDLS(request);
        if (!res?.success) {
          plotDLSConvergence();
          setStatus(res?.error?.message || 'The optical optimizer could not run with these inputs.');
          return;
        }

        const history = Array.isArray(res.history)
          ? res.history.map((entry) => entry.merit).filter(Number.isFinite)
          : [];
        plotDLSConvergence(history);
        const values = {
          'lbl-dls-init-merit': Number.isFinite(res.initialMerit) ? res.initialMerit.toPrecision(6) : 'Unavailable',
          'lbl-dls-opt-merit': Number.isFinite(res.finalMerit) ? res.finalMerit.toPrecision(6) : 'Unavailable',
          'lbl-dls-focal': Number.isFinite(res.finalMetrics?.paraxialFocalLengthMm)
            ? `${res.finalMetrics.paraxialFocalLengthMm.toPrecision(6)} mm`
            : 'Unavailable',
          'lbl-dls-spread': Number.isFinite(res.finalMetrics?.terminalRaySpreadMm)
            ? `${res.finalMetrics.terminalRaySpreadMm.toPrecision(6)} mm`
            : 'Unavailable',
          'lbl-dls-termination': res.terminationReason || 'Unavailable'
        };
        for (const [id, value] of Object.entries(values)) {
          const element = document.getElementById(id);
          if (element) element.textContent = value;
        }
        setStatus(
          `Experimental result only. ${history.length} merit samples; independent optical validation is unavailable.`
        );
      } catch (err) {
        plotDLSConvergence();
        setOutputsUnavailable();
        setStatus(err.message || 'The optical optimizer could not run.');
      }
    });
  }

  if (btnOpenDLS && modalDLS) {
    btnOpenDLS.addEventListener('click', () => {
      modalDLS.classList.add('active');
      plotDLSConvergence();
    });
  }
  if (btnCloseDLS && modalDLS) {
    btnCloseDLS.addEventListener('click', () => modalDLS.classList.remove('active'));
  }

  // 4. ASME Section VIII Div 2 Compliance Report Modal
  const modalASME = document.getElementById('modal-asme-report');
  const btnOpenASME = document.getElementById('ribbon-btn-asme');
  const btnCloseASME = document.getElementById('btn-close-asme-report');
  const btnExportASME = document.getElementById('btn-export-asme-pdf');
  let currentASMEDoc = null;

  async function evaluateAndRenderASME() {
    currentASMEDoc = null;
    const tbody = document.getElementById('asme-report-tbody');
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="padding: 12px;">No reviewed stress field is available. Results remain experimental and cannot support a code compliance decision.</td></tr>';
    }
    return { success: false, error: { code: 'UNSUPPORTED', message: 'A released code assessment is not available.' } };
  }

  if (btnOpenASME && modalASME) {
    btnOpenASME.addEventListener('click', async () => {
      modalASME.classList.add('active');
      await evaluateAndRenderASME();
    });
  }
  if (btnCloseASME && modalASME) {
    btnCloseASME.addEventListener('click', () => modalASME.classList.remove('active'));
  }
  if (btnExportASME) {
    btnExportASME.disabled = true;
    btnExportASME.addEventListener('click', () => {
      addAiMessage('[Experimental stress screen] Certification export is unavailable.');
    });
  }

  // 5. Experimental caller-input CAD centroid comparison modal
  const modalCADDiff = document.getElementById('modal-cad-diff');
  const btnOpenCADDiff = document.getElementById('ribbon-btn-cad-diff');
  const btnCloseCADDiff = document.getElementById('btn-close-cad-diff');
  const btnRunVisualDiff = document.getElementById('btn-run-cad-diff');

  const cadDiffRevisionAInput = document.getElementById('diff-rev-a-input');
  const cadDiffRevisionBInput = document.getElementById('diff-rev-b-input');
  const cadDiffToleranceInput = document.getElementById('diff-tolerance-mm');
  const cadDiffModificationThresholdInput = document.getElementById('diff-modification-threshold-mm');
  const cadDiffStatus = document.getElementById('cad-diff-status');
  const cadDiffSummaryPanel = document.getElementById('cad-diff-summary-panel');
  let visualDiffRequestSequence = 0;

  function clearVisualDiffResultFields() {
    for (const id of ['diff-added-vol', 'diff-removed-vol', 'diff-modified-faces', 'diff-unchanged-pct']) {
      const element = document.getElementById(id);
      if (element) element.textContent = '--';
    }
  }

  function invalidateVisualDiff(message) {
    visualDiffRequestSequence++;
    clearVisualDiffResultFields();
    if (cadDiffSummaryPanel) cadDiffSummaryPanel.textContent = message;
    if (cadDiffStatus) cadDiffStatus.textContent = message;
  }

  async function executeVisualDiff() {
    const requestSequence = ++visualDiffRequestSequence;
    clearVisualDiffResultFields();
    if (cadDiffSummaryPanel) cadDiffSummaryPanel.textContent = 'Comparison is running.';
    if (cadDiffStatus) cadDiffStatus.textContent = 'Comparison is running.';
    if (!window.omniEngAPI?.visualDiffCAD) {
      invalidateVisualDiff(
        'No comparison was run. The CAD comparison service is unavailable in this application build.'
      );
      return;
    }

    try {
      const rawA = cadDiffRevisionAInput?.value.trim() || '';
      const rawB = cadDiffRevisionBInput?.value.trim() || '';
      if (!rawA || !rawB) throw new Error('Paste both caller-supplied revision objects before comparing.');
      if (rawA.length > 1000000 || rawB.length > 1000000) {
        throw new Error('Each revision JSON input must be at most 1 MB.');
      }
      const toleranceText = cadDiffToleranceInput?.value.trim() || '';
      const modificationThresholdText = cadDiffModificationThresholdInput?.value.trim() || '';
      if (!toleranceText || !modificationThresholdText) {
        throw new Error('Enter an explicit match tolerance and modification threshold in millimeters.');
      }
      const modelA = JSON.parse(rawA);
      const modelB = JSON.parse(rawB);
      const options = {
        toleranceMm: Number(toleranceText),
        modificationThresholdMm: Number(modificationThresholdText)
      };

      const result = await window.omniEngAPI.visualDiffCAD({ modelA, modelB, options });
      if (requestSequence !== visualDiffRequestSequence) return;
      if (!result?.success) throw new Error(result?.error?.message || 'The supplied revisions were rejected.');
      if (!result?.summary) throw new Error('No comparison summary was returned.');

      const pctUnchanged =
        result.summary.totalFacesA > 0
          ? ((result.summary.unchangedCount / result.summary.totalFacesA) * 100).toFixed(1)
          : '0.0';
      const elAdded = document.getElementById('diff-added-vol');
      const elRemoved = document.getElementById('diff-removed-vol');
      const elModified = document.getElementById('diff-modified-faces');
      const elUnchanged = document.getElementById('diff-unchanged-pct');
      if (elAdded) elAdded.textContent = String(result.summary.addedCount);
      if (elRemoved) elRemoved.textContent = String(result.summary.removedCount);
      if (elModified) elModified.textContent = String(result.summary.modifiedCount);
      if (elUnchanged) elUnchanged.textContent = `${pctUnchanged}%`;

      const summary = `Experimental centroid heuristic comparison of supplied revisions ${result.commitA} and ${result.commitB}. ${result.summary.unchangedCount} unchanged, ${result.summary.modifiedCount} modified, ${result.summary.removedCount} removed, and ${result.summary.addedCount} added faces. Supplied volume delta: ${result.volumetric.volumeDeltaMm3} mm³. This is not a B-rep, wall-thickness, material, or structural assessment.`;
      if (cadDiffSummaryPanel) cadDiffSummaryPanel.textContent = summary;
      if (cadDiffStatus)
        cadDiffStatus.textContent = 'Experimental comparison complete for the supplied centroid and volume data.';
      addAiMessage(
        '[Experimental CAD comparison] Caller-supplied face centroids were compared using a nearest-neighbor heuristic. The result is not a B-rep or design integrity assessment.'
      );
    } catch (err) {
      if (requestSequence !== visualDiffRequestSequence) return;
      const message = `No comparison was completed. ${err.message}`;
      clearVisualDiffResultFields();
      if (cadDiffSummaryPanel) cadDiffSummaryPanel.textContent = message;
      if (cadDiffStatus) cadDiffStatus.textContent = message;
    }
  }

  for (const input of [
    cadDiffRevisionAInput,
    cadDiffRevisionBInput,
    cadDiffToleranceInput,
    cadDiffModificationThresholdInput
  ]) {
    input?.addEventListener('input', () =>
      invalidateVisualDiff('Input changed. Previous comparison results were cleared; compare again.')
    );
  }

  if (btnRunVisualDiff) {
    btnRunVisualDiff.addEventListener('click', executeVisualDiff);
  }
  if (btnOpenCADDiff && modalCADDiff) {
    btnOpenCADDiff.addEventListener('click', () => modalCADDiff.classList.add('active'));
  }
  if (btnCloseCADDiff && modalCADDiff) {
    btnCloseCADDiff.addEventListener('click', () => modalCADDiff.classList.remove('active'));
  }

  // 6. eBOM Manager Modal
  const modalEBOM = document.getElementById('modal-ebom-manager');
  const btnOpenEBOM = document.getElementById('ribbon-btn-ebom');
  const btnCloseEBOM = document.getElementById('btn-close-ebom-manager');
  const btnRunEBOM = document.getElementById('btn-run-ebom');
  const btnConsolidateEBOM = document.getElementById('btn-consolidate-hardware');
  const btnExportEBOM = document.getElementById('btn-export-ebom-csv');
  const ebomInput = document.getElementById('ebom-input-json');
  const ebomStatus = document.getElementById('ebom-status');
  const ebomResults = document.getElementById('ebom-results');
  const ebomTableBody = document.getElementById('ebom-table-tbody');
  let lastBOMResult = null;
  let currentBOMViewMode = 'indented';
  let ebomRequestSequence = 0;

  function renderBOMRows() {
    if (!ebomTableBody || !lastBOMResult) return;
    const quantityHeader = document.getElementById('ebom-quantity-header');
    const massHeader = document.getElementById('ebom-mass-header');
    const costHeader = document.getElementById('ebom-cost-header');
    if (quantityHeader)
      quantityHeader.textContent = currentBOMViewMode === 'indented' ? 'Quantity' : 'Requested leaf qty';
    if (massHeader) {
      massHeader.textContent = currentBOMViewMode === 'indented' ? 'Per-item rolled mass (kg)' : 'Extended mass (kg)';
    }
    if (costHeader) {
      costHeader.textContent = currentBOMViewMode === 'indented' ? 'Per-item rolled cost (USD)' : 'Extended cost (USD)';
    }
    const rows =
      currentBOMViewMode === 'indented'
        ? lastBOMResult.indented.map((item) => ({
            name: item.indentDisplay,
            partNumber: item.partNumber,
            revision: item.revision,
            quantity: item.quantity,
            unitMassKg: item.unitMassKg,
            totalMassKg: item.totalMassKg,
            unitCostUsd: item.unitCostUsd,
            totalCostUsd: item.totalCostUsd
          }))
        : lastBOMResult.flattened.map((item) => ({
            name: item.name,
            partNumber: item.partNumber,
            revision: item.revision,
            quantity: item.totalQuantity,
            unitMassKg: item.unitMassKg,
            totalMassKg: item.extendedMassKg,
            unitCostUsd: item.unitCostUsd,
            totalCostUsd: item.extendedCostUsd
          }));
    ebomTableBody.replaceChildren();
    for (const item of rows) {
      const row = document.createElement('tr');
      for (const value of [
        item.name,
        item.partNumber,
        item.revision ?? '',
        String(item.quantity),
        Number(item.unitMassKg).toFixed(6),
        Number(item.totalMassKg).toFixed(6),
        Number(item.unitCostUsd).toFixed(2),
        Number(item.totalCostUsd).toFixed(2)
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.style.padding = '5px 7px';
        row.appendChild(cell);
      }
      ebomTableBody.appendChild(row);
    }
  }

  async function updateEBOMData() {
    if (!ebomInput || !ebomStatus) return;
    const requestSequence = ++ebomRequestSequence;
    const rawInput = ebomInput.value.trim();
    lastBOMResult = null;
    if (ebomResults) ebomResults.hidden = true;
    if (btnConsolidateEBOM) btnConsolidateEBOM.disabled = true;
    if (btnExportEBOM) btnExportEBOM.disabled = true;
    if (!rawInput) {
      ebomStatus.textContent = 'No calculation was run. Enter a caller-supplied assembly hierarchy first.';
      return;
    }
    if (rawInput.length > 1000000) {
      ebomStatus.textContent = 'No calculation was run. The assembly input exceeds the 1 MB limit.';
      return;
    }

    let rootAssembly;
    try {
      rootAssembly = JSON.parse(rawInput);
    } catch (error) {
      ebomStatus.textContent = `No calculation was run. The assembly JSON is invalid: ${error.message}`;
      return;
    }
    if (!window.omniEngAPI?.rollupEBOM) {
      ebomStatus.textContent = 'No calculation was run. The eBOM service is unavailable in this application build.';
      return;
    }

    try {
      const result = await window.omniEngAPI.rollupEBOM({ rootAssembly });
      if (requestSequence !== ebomRequestSequence) return;
      if (!result?.success) {
        ebomStatus.textContent = `No calculation was run. ${result?.error?.message || 'The supplied assembly was rejected.'}`;
        return;
      }
      lastBOMResult = result;
      currentBOMViewMode = 'indented';
      const count = document.getElementById('ebom-total-parts');
      const mass = document.getElementById('ebom-total-weight');
      const cost = document.getElementById('ebom-total-cost');
      if (count) count.textContent = String(result.requestedTotals.totalPartCount);
      if (mass) mass.textContent = Number(result.requestedTotals.rolledUpMassKg).toFixed(6);
      if (cost) cost.textContent = Number(result.requestedTotals.rolledUpCostUsd).toFixed(2);
      if (ebomResults) ebomResults.hidden = false;
      if (btnConsolidateEBOM) btnConsolidateEBOM.disabled = false;
      if (btnExportEBOM) btnExportEBOM.disabled = false;
      if (btnConsolidateEBOM) btnConsolidateEBOM.textContent = 'Show consolidated parts';
      renderBOMRows();
      ebomStatus.textContent =
        'Experimental requested totals apply root quantity to the per-assembly roll-up. Flattened rows show leaf parts with child and root quantities applied; assembly-node mass and cost contribute only to roll-up totals. Input properties and prices were not independently reviewed.';
    } catch (error) {
      if (requestSequence !== ebomRequestSequence) return;
      ebomStatus.textContent = `No calculation was run. The eBOM service failed: ${error.message}`;
    }
  }

  if (ebomInput) {
    ebomInput.addEventListener('input', () => {
      ebomRequestSequence++;
      lastBOMResult = null;
      if (ebomResults) ebomResults.hidden = true;
      if (btnConsolidateEBOM) btnConsolidateEBOM.disabled = true;
      if (btnExportEBOM) btnExportEBOM.disabled = true;
      if (ebomStatus) ebomStatus.textContent = 'Input changed. Previous results were cleared; run the roll-up again.';
    });
  }

  if (btnOpenEBOM && modalEBOM) {
    btnOpenEBOM.addEventListener('click', () => modalEBOM.classList.add('active'));
  }
  if (btnCloseEBOM && modalEBOM) {
    btnCloseEBOM.addEventListener('click', () => modalEBOM.classList.remove('active'));
  }
  if (btnRunEBOM) btnRunEBOM.addEventListener('click', updateEBOMData);
  if (btnConsolidateEBOM) {
    btnConsolidateEBOM.addEventListener('click', () => {
      if (!lastBOMResult) return;
      currentBOMViewMode = currentBOMViewMode === 'indented' ? 'flattened' : 'indented';
      btnConsolidateEBOM.textContent =
        currentBOMViewMode === 'indented' ? 'Show consolidated parts' : 'Show assembly hierarchy';
      renderBOMRows();
    });
  }
  if (btnExportEBOM) {
    btnExportEBOM.addEventListener('click', () => {
      if (!lastBOMResult?.csv) return;
      const blob = new Blob([lastBOMResult.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'OmniEng_eBOM.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
  }

  // 7. Experimental primitive geometry metrics modal
  const modalNist = document.getElementById('modal-nist-validation');
  const btnOpenNist = document.getElementById('ribbon-btn-nist-props');
  const btnCloseNist = document.getElementById('btn-close-nist-validation');
  const btnRecomputeNist = document.getElementById('btn-recompute-nist');
  const btnExportNist = document.getElementById('btn-export-nist-report');

  let lastNistResult = null;

  async function updateNistValidationData() {
    if (!window.omniEngAPI?.computeCadValidationProperties) return;
    try {
      const geomParams = {
        dx: state.manualParams.cadWidth,
        dy: state.manualParams.cadHeight,
        dz: state.manualParams.cadDepth,
        shapeType: 'box'
      };
      const res = await window.omniEngAPI.computeCadValidationProperties(geomParams);
      lastNistResult = res;

      const elVol = document.getElementById('nist-val-volume');
      const elArea = document.getElementById('nist-val-area');
      const elCent = document.getElementById('nist-val-centroid');
      const elBbox = document.getElementById('nist-val-bbox');
      const elStatus = document.getElementById('nist-val-status');

      if (res && res.success && res.properties) {
        const p = res.properties;
        if (elVol)
          elVol.textContent = Number.isFinite(p.volume)
            ? p.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })
            : 'Unavailable';
        if (elArea)
          elArea.textContent = Number.isFinite(p.surfaceArea)
            ? p.surfaceArea.toLocaleString('en-US', { maximumFractionDigits: 2 })
            : 'Unavailable';
        if (elCent)
          elCent.textContent = p.centroid
            ? `[${p.centroid.x.toFixed(2)}, ${p.centroid.y.toFixed(2)}, ${p.centroid.z.toFixed(2)}]`
            : 'Unavailable';
        if (elBbox && p.boundingBox) {
          if (p.boundingBox.minX !== undefined) {
            elBbox.textContent = `[${p.boundingBox.minX.toFixed(1)}, ${p.boundingBox.minY.toFixed(1)}, ${p.boundingBox.minZ.toFixed(1)}] to [${p.boundingBox.maxX.toFixed(1)}, ${p.boundingBox.maxY.toFixed(1)}, ${p.boundingBox.maxZ.toFixed(1)}]`;
          } else if (Array.isArray(p.boundingBox.min)) {
            elBbox.textContent = `[${p.boundingBox.min.join(', ')}] to [${p.boundingBox.max.join(', ')}]`;
          } else {
            elBbox.textContent = 'Unavailable';
          }
        } else if (elBbox) {
          elBbox.textContent = 'Unavailable';
        }
        if (elStatus) {
          elStatus.textContent =
            'Experimental metrics for the sample box dimensions; this is not STEP translation validation.';
          elStatus.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          elStatus.style.color = '#f59e0b';
          elStatus.style.background = 'rgba(245, 158, 11, 0.1)';
        }
      }
    } catch (err) {
      console.error('NIST Validation error:', err);
    }
  }

  if (btnOpenNist && modalNist) {
    btnOpenNist.addEventListener('click', () => {
      modalNist.classList.add('active');
      updateNistValidationData();
    });
  }
  if (btnCloseNist && modalNist) {
    btnCloseNist.addEventListener('click', () => modalNist.classList.remove('active'));
  }
  if (btnRecomputeNist) {
    btnRecomputeNist.addEventListener('click', () => updateNistValidationData());
  }
  if (btnExportNist) {
    btnExportNist.addEventListener('click', async () => {
      try {
        if (!lastNistResult) {
          window.omniSetSolverProgress('Computing experimental primitive geometry metrics...', 50);
          await updateNistValidationData();
        }
        if (!lastNistResult) {
          addAiMessage('[Geometry Metrics] Experimental primitive metrics could not be computed.');
          return;
        }
        const jsonStr = JSON.stringify(lastNistResult, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'experimental_geometry_metrics.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addAiMessage(
          `[Geometry Metrics] Exported experimental geometry metrics. No standards certification is implied.`
        );
      } catch (err) {
        console.error('NIST export error:', err);
        addAiMessage(`[Geometry Metrics] Export error: ${err.message}`);
      }
    });
  }

  // 8. Illustrative Aerospace WBS Example Modal
  const modalNasaWbs = document.getElementById('modal-nasa-wbs');
  const btnCloseNasaWbs = document.getElementById('btn-close-nasa-wbs');
  const btnNasaWbsViewEngine = document.getElementById('btn-nasa-wbs-view-engine');
  const btnNasaWbsViewStack = document.getElementById('btn-nasa-wbs-view-stack');

  function openNasaWbsModal() {
    if (!modalNasaWbs) return;
    modalNasaWbs.classList.add('active');
    renderNasaWbsEntities();
  }
  window.openNasaWbsModal = openNasaWbsModal;

  function renderNasaWbsEntities() {
    const container = document.getElementById('nasa-wbs-entity-list');
    if (!container) return;
    container.textContent =
      'No source-verified aerospace subsystem records are available. The previous unsourced records have been withdrawn.';
  }

  if (btnCloseNasaWbs && modalNasaWbs) {
    btnCloseNasaWbs.addEventListener('click', () => modalNasaWbs.classList.remove('active'));
    modalNasaWbs.addEventListener('click', (e) => {
      if (e.target === modalNasaWbs) {
        modalNasaWbs.classList.remove('active');
      }
    });
  }

  if (btnNasaWbsViewEngine) {
    btnNasaWbsViewEngine.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'engine_macro';
      viewport3D.renderNasaSpaceRocket3D('engine_macro');
      modalNasaWbs?.classList.remove('active');
      renderAerospaceInspector();
    });
  }

  if (btnNasaWbsViewStack) {
    btnNasaWbsViewStack.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'full_stack';
      viewport3D.renderNasaSpaceRocket3D('full_stack');
      modalNasaWbs?.classList.remove('active');
      renderAerospaceInspector();
    });
  }

  const ribbonBtnNasaWbs = document.getElementById('ribbon-btn-nasa-wbs');
  const ribbonBtnNasaRocket = document.getElementById('ribbon-btn-nasa-rocket');

  if (ribbonBtnNasaWbs) {
    ribbonBtnNasaWbs.addEventListener('click', () => {
      openNasaWbsModal();
    });
  }

  if (ribbonBtnNasaRocket) {
    ribbonBtnNasaRocket.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'full_stack';
      switchStudio('aerospace');
      viewport3D.renderNasaSpaceRocket3D('full_stack');
      renderAerospaceInspector();
      addAiMessage(
        '[Illustrative aerospace example] Loaded synthetic vehicle geometry; no source-verified design data is associated with it.'
      );
    });
  }

  // --- Spacecraft example availability modal ---
  const modalNasaShipSpec = document.getElementById('modal-nasa-spaceship-interior');
  const btnCloseNasaShipSpec = document.getElementById('btn-close-nasa-ship-spec');
  const btnShipSpecFocus3d = document.getElementById('btn-ship-spec-focus-3d');

  function openNasaShipSpecModal(initialTab = 'overview') {
    if (!modalNasaShipSpec) return;
    modalNasaShipSpec.classList.add('active');
    const chips = document.querySelectorAll('#nasa-ship-filter-bar .palette-filter-chip');
    chips.forEach((c) => {
      if (c.getAttribute('data-ship-tab') === initialTab) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
    renderNasaShipSpecTab(initialTab);
  }
  window.openNasaShipSpecModal = openNasaShipSpecModal;

  function renderNasaShipSpecTab() {
    const container = document.getElementById('nasa-ship-tab-content');
    if (!container) return;
    container.innerHTML = `
      <div class="sample-status" role="status">
        Spacecraft specification unavailable. The previous unsourced crew, life-support, radiation,
        avionics, and vehicle values have been withdrawn. No standards assessment is available.
      </div>
    `;
  }

  if (btnCloseNasaShipSpec && modalNasaShipSpec) {
    btnCloseNasaShipSpec.addEventListener('click', () => modalNasaShipSpec.classList.remove('active'));
    modalNasaShipSpec.addEventListener('click', (e) => {
      if (e.target === modalNasaShipSpec) {
        modalNasaShipSpec.classList.remove('active');
      }
    });
  }

  if (btnShipSpecFocus3d) {
    btnShipSpecFocus3d.addEventListener('click', () => {
      state.manualParams.nasaRocketArticle = 'spacecraft_interior';
      switchStudio('aerospace');
      viewport3D.renderNasaSpaceRocket3D('spacecraft_interior');
      modalNasaShipSpec?.classList.remove('active');
      renderAerospaceInspector();
      addAiMessage(
        '[Illustrative spacecraft example] Framed synthetic geometry; no source-verified subsystem specification is available.'
      );
    });
  }

  const shipFilterChips = document.querySelectorAll('#nasa-ship-filter-bar .palette-filter-chip');
  shipFilterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      shipFilterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const tab = chip.getAttribute('data-ship-tab') || 'overview';
      renderNasaShipSpecTab(tab);
    });
  });

  // =========================================================================
  // Workstation Controls and Command Palette (Ctrl+K)
  // =========================================================================

  // --- 1. Global Solver Progress Bar ---
  const globalSolverProgress = document.getElementById('global-solver-progress');
  const solverProgressFill = document.getElementById('solver-progress-fill');
  const solverProgressStatus = document.getElementById('solver-progress-status');
  const solverProgressPct = document.getElementById('solver-progress-pct');
  const btnCancelSolver = document.getElementById('btn-cancel-solver');

  let solverProgressTimeout = null;

  window.omniSetSolverProgress = function (statusText, pct = 0, autoHide = false) {
    if (!globalSolverProgress) return;
    clearTimeout(solverProgressTimeout);
    globalSolverProgress.style.display = 'block';
    if (solverProgressFill) solverProgressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (solverProgressStatus) solverProgressStatus.textContent = statusText;
    if (solverProgressPct) solverProgressPct.textContent = Math.round(pct) + '%';

    if (pct >= 100 || autoHide) {
      solverProgressTimeout = setTimeout(() => {
        if (globalSolverProgress) globalSolverProgress.style.display = 'none';
      }, 1500);
    }
  };

  if (btnCancelSolver && globalSolverProgress) {
    btnCancelSolver.addEventListener('click', () => {
      globalSolverProgress.style.display = 'none';
    });
  }

  // --- 2. High-Contrast Workstation Theme Toggle ---
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const themeIcon = document.getElementById('theme-icon');

  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      const isHighContrast = document.body.classList.toggle('theme-high-contrast');
      if (themeIcon && window.OmniIcons) {
        themeIcon.innerHTML = isHighContrast ? window.OmniIcons.get('themeSun') : window.OmniIcons.get('themeMoon');
      }
      addAiMessage(
        `[Display Theme] Switched to ${isHighContrast ? 'Technical High-Contrast' : 'Default Glassmorphic Night'} workstation mode.`
      );
    });
  }

  // --- 3. Multi-Document Workspace Tab Bar ---
  const workspaceTabsList = document.getElementById('workspace-tabs-list');
  const btnNewDocTab = document.getElementById('btn-new-doc-tab');

  const documentContextMap = {
    'doc-main-cad': { studio: 'consumer', name: 'Main_Assembly.omni', badge: 'CAD' },
    'doc-optics': { studio: 'consumer', name: 'Doublet_Lens.zmx', badge: 'Optics', subTab: 'lens' },
    'doc-power-pdn': { studio: 'eda', name: 'Power_Grid_PDN.cir', badge: 'EDA' },
    'doc-asme-vessel': { studio: 'oilgas', name: 'Pressure_Vessel_Example.omni', badge: 'Illustrative' }
  };

  function activateDocumentTab(docId) {
    if (!workspaceTabsList) return;
    const allTabs = workspaceTabsList.querySelectorAll('.workspace-tab');
    allTabs.forEach((t) => t.classList.toggle('active', t.getAttribute('data-doc-id') === docId));

    const docDef = documentContextMap[docId];
    if (docDef) {
      if (docDef.subTab) state.manualParams.lensSubTab = docDef.subTab;
      switchStudio(docDef.studio);
    }
  }

  if (workspaceTabsList) {
    workspaceTabsList.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.doc-close-btn');
      const tab = e.target.closest('.workspace-tab');
      if (closeBtn && tab) {
        e.stopPropagation();
        const docId = tab.getAttribute('data-doc-id');
        tab.remove();
        delete documentContextMap[docId];
        const remaining = workspaceTabsList.querySelector('.workspace-tab');
        if (remaining) activateDocumentTab(remaining.getAttribute('data-doc-id'));
        return;
      }
      if (tab) {
        activateDocumentTab(tab.getAttribute('data-doc-id'));
      }
    });
  }

  if (btnNewDocTab && workspaceTabsList) {
    let newTabCounter = 1;
    btnNewDocTab.addEventListener('click', () => {
      const docId = `doc-new-${newTabCounter++}`;
      documentContextMap[docId] = {
        studio: state.currentStudio,
        name: `Untitled_${newTabCounter}.omni`,
        badge: state.currentStudio.toUpperCase()
      };

      const tabEl = window.OmniWorkspaceTabView.createWorkspaceTab(document, {
        docId,
        title: `Untitled_${newTabCounter}.omni`,
        badge: state.currentStudio.toUpperCase(),
        active: true
      });
      workspaceTabsList.appendChild(tabEl);
      if (window.OmniIcons) window.OmniIcons.hydrateAll(tabEl);
      activateDocumentTab(docId);
    });
  }

  // --- 4. Global Command Palette (Ctrl+K) ---
  const commandPaletteModal = document.getElementById('command-palette-modal');
  const btnOpenPalette = document.getElementById('btn-open-palette');
  const btnClosePalette = document.getElementById('btn-close-command-palette');
  const paletteInput = document.getElementById('command-palette-input');
  const paletteResults = document.getElementById('command-palette-results');
  const paletteFilterChips = document.querySelectorAll('.palette-filter-chip');

  let currentPaletteFilter = 'all';
  let selectedPaletteIndex = 0;

  function getPaletteIcon(iconKey) {
    return iconKey;
  }

  // --- Workstation Keymap Profile Helper ---
  function setKeymapProfile(profileName) {
    if (window.keymapManager) {
      try {
        const prof = window.keymapManager.setProfile(profileName);
        addAiMessage(`[Keymap Manager] Switched shortcut layout to <strong>${prof.name}</strong>.`);
      } catch (err) {
        addAiMessage(`[Keymap Manager] Error setting keymap: ${err.message}`);
      }
    }
  }

  // --- Experimental password-protected session snapshot export ---
  async function executeVaultSaveProject() {
    try {
      if (window.omniEngAPI?.vaultEncryptProject) {
        const password = window.prompt(
          'Choose a password of at least 12 characters for this encrypted session snapshot. It cannot be recovered if lost.'
        );
        if (password === null) return;
        if (password.length < 12) {
          addAiMessage('[Encrypted Snapshot] Choose a password with at least 12 characters.');
          return;
        }
        const payload = {
          format: 'experimental-session-snapshot',
          schemaVersion: 1,
          engineeringDomain: state.currentStudio,
          manualParams: state.manualParams,
          timestamp: new Date().toISOString()
        };
        const res = await window.omniEngAPI.vaultEncryptProject({
          password,
          payload
        });
        if (res?.success && res.encryptedBase64) {
          const encryptedBytes = Uint8Array.from(atob(res.encryptedBase64), (char) => char.charCodeAt(0));
          const blob = new Blob([encryptedBytes], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `omnieng-session-${Date.now()}.omni-vault`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          addAiMessage(
            `[Encrypted Snapshot] Downloaded ${res.encryptedBytes} encrypted bytes. This contains the current session parameters, not a complete project archive.`
          );
          return res;
        }
      }
    } catch (err) {
      console.error('Vault encryption error:', err);
      addAiMessage(`[Encrypted Snapshot] Export error: ${err.message}`);
    }
  }

  async function executeVaultVerifyProject() {
    const api = window.omniEngAPI;
    if (typeof api?.vaultDecryptProject !== 'function') {
      addAiMessage('[Encrypted Snapshot] Decryption is unavailable in this application build.');
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.omni-vault,application/octet-stream';
    fileInput.hidden = true;
    document.body.appendChild(fileInput);
    const selectedFile = await new Promise((resolve) => {
      const finish = (file) => {
        fileInput.remove();
        resolve(file);
      };
      fileInput.addEventListener('change', () => finish(fileInput.files?.[0] ?? null), { once: true });
      fileInput.addEventListener('cancel', () => finish(null), { once: true });
      fileInput.click();
    });

    if (!selectedFile) return;
    const maximumEncryptedSnapshotBytes = 16 * 1024 * 1024;
    if (selectedFile.size <= 0 || selectedFile.size > maximumEncryptedSnapshotBytes) {
      addAiMessage('[Encrypted Snapshot] Choose a nonempty encrypted session snapshot no larger than 16 MiB.');
      return;
    }

    const password = window.prompt('Enter the password used to encrypt this session snapshot.');
    if (password === null) return;
    if (password.length < 12) {
      addAiMessage('[Encrypted Snapshot] The password must contain at least 12 characters.');
      return;
    }

    try {
      const encryptedBytes = new Uint8Array(await selectedFile.arrayBuffer());
      const result = await api.vaultDecryptProject({ password, encryptedBytes });
      if (!result?.success || !result.payload || typeof result.payload !== 'object') {
        addAiMessage(
          '[Encrypted Snapshot] The selected file could not be authenticated as a supported session snapshot.'
        );
        return result;
      }

      addAiMessage(
        '[Encrypted Snapshot] Authenticated decryption succeeded. The snapshot payload was verified and was not loaded into the active project.'
      );
      return { success: true, payload: result.payload };
    } catch (error) {
      console.error('Encrypted snapshot verification error:', error);
      addAiMessage('[Encrypted Snapshot] Decryption failed. Check the selected file and password.');
      return { success: false, error: { code: 'INVALID_INPUT', message: 'Snapshot authentication failed.' } };
    }
  }

  const COMMAND_CATALOG = [
    // Studios
    {
      id: 'studio-consumer',
      title: 'Experimental Consumer Examples',
      desc: 'Experimental drop-test, thermal, and optical example workflows',
      category: 'studios',
      icon: getPaletteIcon('studioConsumer'),
      action: () => switchStudio('consumer')
    },
    {
      id: 'studio-eda',
      title: 'Experimental EDA Studio',
      desc: 'Experimental RTL and timing workflows; signoff DRC and LVS are unavailable',
      category: 'studios',
      icon: getPaletteIcon('studioEda'),
      action: () => switchStudio('eda')
    },
    {
      id: 'studio-aerospace',
      title: 'Experimental Aerospace Examples',
      desc: 'Illustrative flight and geometry examples; independent validation is unavailable',
      category: 'studios',
      icon: getPaletteIcon('studioAerospace'),
      action: () => switchStudio('aerospace')
    },
    {
      id: 'studio-oilgas',
      title: 'Experimental Plant Studio',
      desc: 'Plant calculation examples; no released process simulation is available',
      category: 'studios',
      icon: getPaletteIcon('studioPlant'),
      action: () => switchStudio('oilgas')
    },
    {
      id: 'studio-simulink',
      title: 'Block Diagram and Controls Studio',
      desc: 'Experimental block diagram, frequency response, and state-space examples',
      category: 'studios',
      icon: getPaletteIcon('studioSimulink'),
      action: () => switchStudio('simulink')
    },
    {
      id: 'studio-cad',
      title: 'Parametric CAD Studio',
      desc: 'Constructive solid geometry, NURBS surfaces, feature DAG history',
      category: 'studios',
      icon: getPaletteIcon('studioCad'),
      action: () => switchStudio('universal_cad')
    },

    // CAD / Geometry
    {
      id: 'tool-sketcher',
      title: 'Experimental Constraint Sketcher',
      desc: 'Run an experimental 2D geometric constraint example; results are not independently validated',
      category: 'cad',
      icon: getPaletteIcon('sketcher'),
      action: () => {
        modalSketcher?.classList.add('active');
        renderSketcherCanvas();
        solveSketcher();
      }
    },
    {
      id: 'tool-healer',
      title: 'Experimental Geometry Cleanup',
      desc: 'Run a sample topology cleanup workflow; watertightness and downstream validity are not guaranteed',
      category: 'cad',
      icon: getPaletteIcon('autoHeal'),
      action: () => {
        modalHealer?.classList.add('active');
      }
    },
    {
      id: 'tool-cad-diff',
      title: 'Experimental Caller-Input CAD Comparison',
      desc: 'Compare caller-supplied revisions using a centroid heuristic',
      category: 'cad',
      icon: getPaletteIcon('cadDiff'),
      action: () => {
        modalCADDiff?.classList.add('active');
      }
    },
    {
      id: 'tool-sheet-metal',
      title: 'Experimental Sheet Unfolding Example',
      desc: 'Calculate a sample bend allowance; standards conformance and manufacturing suitability are not assessed',
      category: 'cad',
      icon: getPaletteIcon('sheetMetal'),
      action: () => document.getElementById('ribbon-btn-sheet-metal')?.click()
    },
    {
      id: 'tool-gdt',
      title: 'Experimental Tolerance Example',
      desc: 'Calculate sample position and tolerance values; no standards conformance decision is made',
      category: 'cad',
      icon: getPaletteIcon('gdt'),
      action: () => document.getElementById('ribbon-btn-gdt')?.click()
    },
    {
      id: 'tool-drafting',
      title: 'Experimental Sample Drawing',
      desc: 'Generate a sample multi-view drawing; drafting-standard conformance is not evaluated',
      category: 'cad',
      icon: getPaletteIcon('drawing2d'),
      action: () => document.getElementById('ribbon-btn-drafting')?.click()
    },
    {
      id: 'tool-export-step',
      title: 'Export STEP-Format Geometry',
      desc: 'Serialize active solid geometry as STEP-format text; interoperability has not been independently verified',
      category: 'cad',
      icon: getPaletteIcon('step'),
      action: () => document.getElementById('ribbon-btn-step')?.click()
    },
    {
      id: 'tool-nist-props',
      title: 'Experimental Primitive Geometry Metrics',
      desc: 'Compute volume, area, and centroid for the sample primitive; no STEP translation validation is performed',
      category: 'cad',
      icon: getPaletteIcon('gdt'),
      action: () => document.getElementById('ribbon-btn-nist-props')?.click()
    },
    {
      id: 'view-quad-layout',
      title: 'Toggle 4-View Engineering Quad Layout',
      desc: 'Display Top, Front, Right Orthogonal and Isometric viewports simultaneously',
      category: 'cad',
      icon: getPaletteIcon('assembly'),
      action: () => document.getElementById('ribbon-btn-quad-view')?.click()
    },

    // CAE / FEA / CFD
    {
      id: 'tool-mesher',
      title: 'Experimental Tetrahedral Mesh Example',
      desc: 'Generate a sample quadratic tetrahedral mesh; mesh quality is not independently validated',
      category: 'cae',
      icon: getPaletteIcon('mesher'),
      action: () => document.getElementById('ribbon-btn-mesher')?.click()
    },
    {
      id: 'tool-fvm-cfd',
      title: 'Experimental CFD Example',
      desc: 'Run a small fluid-flow example; independent validation is unavailable',
      category: 'cae',
      icon: getPaletteIcon('cfd'),
      action: () => document.getElementById('ribbon-btn-fvm-cfd')?.click()
    },
    {
      id: 'tool-sparse-cholesky',
      title: 'Experimental Sparse Direct Solver',
      desc: 'Legacy sparse Cholesky example using nested-dissection ordering',
      category: 'cae',
      icon: getPaletteIcon('bolt'),
      action: async () => {
        window.omniSetSolverProgress('Experimental sparse Cholesky example running...', 45);
        const result = await window.omniEngAPI?.solveWasmSparseMultifrontal?.({ N: 40 });
        if (!result?.success) {
          window.omniSetSolverProgress('Sparse calculation unavailable', 100, false);
          addAiMessage('[Experimental sparse solver] No result was returned.');
          return;
        }
        window.omniSetSolverProgress(`Experimental sparse solve completed for N=${result.N}`, 100, true);
        addAiMessage(
          `[Experimental sparse solver] N=${result.N}, elapsed=${result.totalTimeMs.toFixed(1)} ms, relative residual=${result.relativeResidual.toExponential(2)}, ordering=${result.orderingMethod}. This is an internal smoke example, not performance qualification.`
        );
      }
    },
    {
      id: 'tool-gpu-pcg',
      title: 'Experimental CPU PCG Example',
      desc: 'Run a CPU implementation of preconditioned conjugate gradients; GPU acceleration is not implemented',
      category: 'cae',
      icon: getPaletteIcon('gear'),
      action: async () => {
        window.omniSetSolverProgress('Running experimental CPU PCG example...', 60);
        const res = await window.omniEngAPI?.solveGpuParallelPCG?.({ N: 30 });
        if (!res || !Number.isFinite(res.relativeResidual)) {
          window.omniSetSolverProgress('PCG result unavailable', 100, false);
          addAiMessage('[Experimental PCG] No result was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental CPU PCG result returned', 100, Boolean(res.converged));
        addAiMessage(
          `[Experimental PCG] N=${res.solution?.length ?? 30}, iterations=${res.iterations}, relative residual=${res.relativeResidual.toExponential(2)}, backend=${res.hardwareAcceleration}. No GPU speedup or solver qualification is established.`
        );
      }
    },

    // Legacy aerospace examples
    {
      id: 'tool-nasa-rocket',
      title: 'Illustrative Vehicle Geometry',
      desc: 'View synthetic launch vehicle geometry with no sourced dimensions or validated design data',
      category: 'cae',
      icon: getPaletteIcon('rocket'),
      action: () => {
        switchStudio('aerospace');
        viewport3D.renderNasaSpaceRocket3D('full_stack');
        renderAerospaceInspector();
      }
    },
    {
      id: 'tool-nasa-engine',
      title: 'Illustrative Engine Geometry',
      desc: 'View a synthetic engine scene; configuration and performance data are not verified',
      category: 'cae',
      icon: getPaletteIcon('spaceEngine'),
      action: () => {
        switchStudio('aerospace');
        viewport3D.renderNasaSpaceRocket3D('engine_macro');
        renderAerospaceInspector();
      }
    },
    {
      id: 'tool-nasa-wbs',
      title: 'Aerospace Subsystem Data Availability',
      desc: 'Check whether source-verified aerospace subsystem records are available',
      category: 'compliance',
      icon: getPaletteIcon('rocket'),
      action: () => openNasaWbsModal()
    },
    {
      id: 'tool-nasa-tour',
      title: 'Illustrative Aerospace Example Tour',
      desc: 'Guided visual walkthrough of synthetic geometry and unvalidated callouts',
      category: 'cae',
      icon: getPaletteIcon('play'),
      action: () => {
        switchStudio('aerospace');
        window.storytellingRails?.loadStagePreset('nasa_rocket');
      }
    },

    // Optics
    {
      id: 'tool-dls-opt',
      title: 'Experimental Optical Merit Optimizer',
      desc: 'Experimental damped least-squares workflow; independent validation is unavailable',
      category: 'optics',
      icon: getPaletteIcon('dlsOpt'),
      action: () => {
        modalDLS?.classList.add('active');
        plotDLSConvergence();
      }
    },
    {
      id: 'tool-optical-inspector',
      title: 'Experimental Optical Inspector',
      desc: 'Open the caller-input optical inspector; experimental results are not independently validated',
      category: 'optics',
      icon: getPaletteIcon('optics'),
      action: () => {
        modalOpticalInspector?.classList.add('active');
        runOpticalInspection();
      }
    },

    // EDA / Silicon
    {
      id: 'tool-verilog',
      title: 'Experimental Verilog Subset Inspector',
      desc: 'Inspect a limited Boolean assignment subset; no frequency or timing-slack result is calculated',
      category: 'eda',
      icon: getPaletteIcon('verilog'),
      action: () => document.getElementById('ribbon-btn-verilog')?.click()
    },
    {
      id: 'tool-spice-scope',
      title: 'Experimental RC Circuit Example',
      desc: 'Display the bundled RC transient example; this is not a general circuit solver',
      category: 'eda',
      icon: getPaletteIcon('oscilloscope'),
      action: () => {
        modalSpiceOscilloscope?.classList.add('active');
        runSpiceOscilloscope();
      }
    },
    {
      id: 'tool-export-gerber',
      title: 'Experimental Gerber Export',
      desc: 'Export explicitly supplied board geometry; manufacturing compatibility is not independently verified',
      category: 'eda',
      icon: getPaletteIcon('gerber'),
      action: () => document.getElementById('ribbon-btn-gerber')?.click()
    },
    {
      id: 'tool-pdn-ir',
      title: 'PDN Analysis Availability',
      desc: 'No sourced power-grid model or independently reviewed IR-drop workflow is configured',
      category: 'eda',
      icon: getPaletteIcon('bolt'),
      action: () =>
        addAiMessage(
          '[Experimental EDA] Power-grid IR-drop analysis is unavailable; no voltage-drop or electromigration result was calculated.'
        )
    },

    // Compliance & Lifecycle
    {
      id: 'tool-asme-viii',
      title: 'Experimental Stress Screen',
      desc: 'Unreleased stress-line calculations for research and development only',
      category: 'compliance',
      icon: getPaletteIcon('asme'),
      action: () => {
        modalASME?.classList.add('active');
        evaluateAndRenderASME();
      }
    },
    {
      id: 'tool-ebom',
      title: 'Experimental eBOM Roll-Up',
      desc: 'Calculate a pasted hierarchy; mass and cost remain caller-supplied and unreviewed',
      category: 'compliance',
      icon: getPaletteIcon('ebom'),
      action: () => modalEBOM?.classList.add('active')
    },
    {
      id: 'tool-fmi',
      title: 'Experimental Co-Simulation Example',
      desc: 'Run an illustrative multi-component simulation; FMI conformance and engineering validation are not established',
      category: 'compliance',
      icon: getPaletteIcon('fmi'),
      action: () => document.getElementById('ribbon-btn-fmi')?.click()
    },
    {
      id: 'tool-audit-report',
      title: 'Experimental Evidence Report',
      desc: 'Summarize supplied inputs and outputs with experimental maturity status',
      category: 'compliance',
      icon: getPaletteIcon('auditReport'),
      action: () => document.getElementById('ribbon-btn-report')?.click()
    },

    // Security, Storage & Workstation Usability
    {
      id: 'tool-vault-encrypt',
      title: 'Export Encrypted Session Snapshot',
      desc: 'Download the current parameter snapshot as password-protected data',
      category: 'compliance',
      icon: getPaletteIcon('bolt'),
      action: () => executeVaultSaveProject()
    },
    {
      id: 'tool-vault-verify',
      title: 'Verify Encrypted Session Snapshot',
      desc: 'Select an encrypted snapshot and authenticate it with its password',
      category: 'compliance',
      icon: getPaletteIcon('auditReport'),
      action: () => executeVaultVerifyProject()
    },
    {
      id: 'tool-keymap-catia',
      title: 'Keymap Profile: CATIA V5',
      desc: 'Switch workstation shortcut bindings to Dassault Systèmes CATIA V5',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: () => setKeymapProfile('CATIA_V5')
    },
    {
      id: 'tool-keymap-nx',
      title: 'Keymap Profile: Siemens NX',
      desc: 'Switch workstation shortcut bindings to Siemens NX / Unigraphics',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: () => setKeymapProfile('SIEMENS_NX')
    },
    {
      id: 'tool-keymap-solidworks',
      title: 'Keymap Profile: SolidWorks',
      desc: 'Switch workstation shortcut bindings to Dassault SolidWorks',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: () => setKeymapProfile('SOLIDWORKS')
    },
    {
      id: 'tool-keymap-blender',
      title: 'Keymap Profile: Blender',
      desc: 'Switch workstation shortcut bindings to Blender 4.x navigation',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: () => setKeymapProfile('BLENDER')
    },
    {
      id: 'tool-keymap-omnieng',
      title: 'Keymap Profile: OmniEng Default',
      desc: 'Reset workstation shortcut bindings to OmniEng Standard',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: () => setKeymapProfile('OMNIENG_DEFAULT')
    },
    {
      id: 'tool-quad-view',
      title: 'Toggle Quad Viewport (Top/Front/Right/Iso)',
      desc: 'Switch 3D viewport between single perspective and synchronized 4-camera split',
      category: 'cad',
      icon: getPaletteIcon('drawing2d'),
      action: () => {
        const isQuad = window.viewport3D?.toggleQuadView();
        addAiMessage(
          `[Workstation Viewport] Quad Viewport: <strong>${isQuad ? 'ACTIVE' : 'INACTIVE'}</strong> (Top, Front, Right, Isometric)`
        );
      }
    },
    {
      id: 'tool-spacemouse',
      title: 'Pair 3Dconnexion SpaceMouse (WebHID)',
      desc: 'Connect 6-DOF hardware controller for fluid simultaneous 3D pan, orbit, and zoom',
      category: 'cad',
      icon: getPaletteIcon('gear'),
      action: async () => {
        if (window.spaceMouseController) {
          const paired = await window.spaceMouseController.requestDevice();
          addAiMessage(
            `[Hardware] SpaceMouse WebHID controller: <strong>${paired ? 'CONNECTED' : 'DISCONNECTED / CANCELLED'}</strong>`
          );
        }
      }
    },
    {
      id: 'tool-contact-fea',
      title: 'Unavailable: Experimental Hertz Formula Estimate',
      desc: 'This command has no input form and cannot calculate a contact result',
      category: 'cae',
      icon: getPaletteIcon('fea'),
      action: () => {
        addAiMessage(
          '[Experimental Hertz estimate] No calculation was run. The separate formula route requires contact radius (m), normal load (N), Young’s modulus for both bodies (Pa), and both Poisson ratios (dimensionless). No discrete contact solver or independently reviewed accuracy result is available.'
        );
      }
    },
    {
      id: 'tool-zmx-import',
      title: 'ZMX Parser (UI Input Unavailable)',
      desc: 'The experimental parser has no file picker or text input in this interface',
      category: 'optics',
      icon: getPaletteIcon('optics'),
      action: () => {
        addAiMessage(
          '[Experimental Optics] ZMX parsing is unavailable in this interface because no file or text input is configured. No file was parsed.'
        );
      }
    },
    {
      id: 'tool-vv-diagnostics',
      title: 'Validation Evidence',
      desc: 'Request released validation only when a reviewed validation service is configured',
      category: 'development',
      icon: getPaletteIcon('auditReport'),
      action: async () => {
        window.omniSetSolverProgress('Requesting experimental diagnostics...', 40);
        const res = await window.omniEngAPI?.run100GoldBenchmarks?.();
        if (!res?.success) {
          window.omniSetSolverProgress('Diagnostics unavailable', 100, false);
          addAiMessage(
            `[Validation Evidence] ${res?.error?.message || 'No released validation service is configured.'}`
          );
          return;
        }
        const summary = res.summary || res;
        window.omniSetSolverProgress('Experimental diagnostics completed', 100, true);
        addAiMessage(
          `[Validation Evidence] ${summary.passed ?? 0} passed; ${summary.unavailable ?? 0} unavailable; ${summary.failed ?? 0} failed. Results are not released until reviewed.`
        );
      }
    },
    {
      id: 'tool-cad-extrude',
      title: 'Experimental Extrusion Example',
      desc: 'Run the bundled rectangular profile example in millimetres; no active user sketch is read',
      category: 'cad',
      icon: getPaletteIcon('cadExtrude'),
      action: async () => {
        window.omniSetSolverProgress('Running experimental extrusion example...', 50);
        const res = await window.omniEngAPI?.cadExtrudeProfile?.({
          profile: [
            { x: -25, y: -15 },
            { x: 25, y: -15 },
            { x: 25, y: 15 },
            { x: -25, y: 15 }
          ],
          depth: 25.0,
          draftAngleDeg: 1.5,
          lengthUnit: 'mm'
        });
        window.omniSetSolverProgress('Experimental extrusion example returned', 100, Boolean(res?.success));
        if (res?.triangles && window.viewport3D?.renderBRepSolid) {
          window.viewport3D.renderBRepSolid(res.triangles, 'Extruded_Solid');
        }
        if (!res?.success) {
          addAiMessage('[Experimental CAD] No extrusion result was returned.');
          return;
        }
        addAiMessage(
          `[Experimental CAD] Extrusion example returned ${res.faceCount ?? 'an unreported number of'} faces and volume ${res.volume ?? 'not reported'} mm³. Topology has not been independently validated.`
        );
      }
    },
    {
      id: 'tool-cad-revolve',
      title: 'Experimental Revolve Example',
      desc: 'Revolve a bundled sample profile in millimetres; no active user sketch is read',
      category: 'cad',
      icon: getPaletteIcon('cadRevolve'),
      action: async () => {
        window.omniSetSolverProgress('Generating 360° Revolved Solid...', 50);
        const res = await window.omniEngAPI?.cadRevolveProfile?.({
          profile: [
            { x: 10, y: 0 },
            { x: 25, y: 5 },
            { x: 20, y: 30 },
            { x: 8, y: 35 }
          ],
          segments: 32,
          angleDeg: 360,
          axis: 'Y',
          lengthUnit: 'mm'
        });
        if (!res?.success || !Array.isArray(res.triangles)) {
          window.omniSetSolverProgress('Experimental revolve example unavailable', 100, false);
          addAiMessage('[Experimental CAD] No revolve result was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental revolve example returned', 100, true);
        if (window.viewport3D?.renderBRepSolid) {
          window.viewport3D.renderBRepSolid(res.triangles, 'Revolved_Solid');
        }
        addAiMessage(
          `[Experimental CAD] Revolve example returned ${res.faceCount} faces for visualization. Volume and topology validity were not assessed.`
        );
      }
    },
    {
      id: 'tool-cad-shell',
      title: 'Experimental Thin-Wall Shell Example',
      desc: 'Shell a bundled box example with explicit millimetre dimensions; no active user model is read',
      category: 'cad',
      icon: getPaletteIcon('cadShell'),
      action: async () => {
        window.omniSetSolverProgress('Computing Thin-Wall Shell Offset...', 50);
        const res = await window.omniEngAPI?.cadShellBody?.({
          width: 60.0,
          height: 40.0,
          depth: 80.0,
          wallThickness: 2.0,
          openFaceIndex: 5,
          lengthUnit: 'mm'
        });
        if (!res?.success || !Array.isArray(res.triangles)) {
          window.omniSetSolverProgress('Experimental shell example unavailable', 100, false);
          addAiMessage('[Experimental CAD] No shell result was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental shell example returned', 100, true);
        if (window.viewport3D?.renderBRepSolid) {
          window.viewport3D.renderBRepSolid(res.triangles, 'Shelled_Body');
        }
        addAiMessage(
          `[Experimental CAD] Shell example returned ${res.faceCount} faces with a requested wall thickness of ${res.wallThickness} mm. Wall uniformity and topology validity were not assessed.`
        );
      }
    },
    {
      id: 'tool-cam-gcode',
      title: 'Experimental Toolpath Example',
      desc: 'Generate illustrative path and G-code text; no machine-specific postprocessor or NC validation is provided',
      category: 'cad',
      icon: getPaletteIcon('camGcode'),
      action: async () => {
        window.omniSetSolverProgress('Generating experimental toolpath example...', 50);
        const res = await window.omniEngAPI?.camGenerateToolpath?.({
          stepdown: 2.5,
          stepover: 4.0,
          feedrate: 800,
          spindleRPM: 6000
        });
        if (!res?.success || !res.toolpath || typeof res.gcode !== 'string') {
          window.omniSetSolverProgress('Experimental toolpath unavailable', 100, false);
          addAiMessage('[Experimental toolpath] No result was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental toolpath example returned', 100, true);
        if (Array.isArray(res.toolpath.layers) && window.viewport3D?.renderToolpath3D) {
          window.viewport3D.renderToolpath3D(res.toolpath.layers);
        }
        addAiMessage(
          `[Experimental toolpath] Returned ${res.toolpath.layers.length} illustrative layers and ${res.totalGcodeLines} G-code text lines; estimated time ${res.machiningTimeMin} min. The output is not machine-validated and is not ready for machining.`
        );
      }
    },
    {
      id: 'tool-cae-nonlinear',
      title: 'Experimental Cantilever Formula Example',
      desc: 'Bundled beam estimate uses mm, MPa, and N; it is not finite-element analysis and does not read a user model',
      category: 'cae',
      icon: getPaletteIcon('fea'),
      action: async () => {
        window.omniSetSolverProgress('Calculating experimental cantilever formula example...', 50);
        const res = await window.omniEngAPI?.caeNonlinearLargeDeflection?.({
          length: 100.0,
          width: 20.0,
          height: 5.0,
          E: 200000.0,
          P: 25.0,
          lengthUnit: 'mm',
          modulusUnit: 'MPa',
          forceUnit: 'N'
        });
        if (!res?.success || !Number.isFinite(res.formulaAdjustedTipDeflectionMm)) {
          window.omniSetSolverProgress('Experimental cantilever estimate unavailable', 100, false);
          addAiMessage('[Experimental cantilever example] No result was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental cantilever estimate returned', 100, true);
        addAiMessage(
          `[Experimental cantilever example] Linear estimate=${res.linearTipDeflectionMm} mm; formula-adjusted estimate=${res.formulaAdjustedTipDeflectionMm} mm. No finite-element solve or design assessment was performed.`
        );
      }
    },
    {
      id: 'tool-eda-pnr',
      title: 'Experimental Placement and Routing Example',
      desc: 'Place synthetic cells in rows and draw simple L-shaped routes; no design-rule check is performed',
      category: 'eda',
      icon: getPaletteIcon('circuit'),
      action: async () => {
        window.omniSetSolverProgress('Running experimental placement and routing example...', 50);
        const res = await window.omniEngAPI?.edaPlaceAndRoute?.();
        if (!res?.success || !res.telemetry) {
          window.omniSetSolverProgress('Experimental placement example unavailable', 100, false);
          addAiMessage('[Experimental EDA] No placement or routing example was returned.');
          return;
        }
        window.omniSetSolverProgress('Experimental placement example returned', 100, true);
        addAiMessage(
          `[Experimental EDA] Placed ${res.cellsPlacedCount} synthetic cells and returned ${res.netsRoutedCount} simple routes with ${res.telemetry.totalViaCount} illustrative vias. No DRC or foundry signoff was run.`
        );
      }
    },
    {
      id: 'tool-plant-nrtl',
      title: 'NRTL Route Availability',
      desc: 'Check availability of a non-ideal mixture model with sourced binary parameters',
      category: 'plant',
      icon: getPaletteIcon('studioPlant'),
      action: async () => {
        window.omniSetSolverProgress('Checking experimental thermodynamics route...', 50);
        const res = await window.omniEngAPI?.plantNrtlActivity?.({
          system: 'ethanol_water',
          temperatureK: 351.4,
          x1: 0.894
        });
        window.omniSetSolverProgress('Thermodynamics route status returned', 100, Boolean(res?.success));
        addAiMessage(
          `[Plant Thermodynamics] ${res?.error?.message || res?.error || 'No validated non-ideal mixture result was returned.'}`
        );
      }
    }
  ];

  function openCommandPalette() {
    if (!commandPaletteModal) return;
    commandPaletteModal.classList.add('active');
    if (paletteInput) {
      paletteInput.value = '';
      paletteInput.focus();
    }
    selectedPaletteIndex = 0;
    renderPaletteResults();
  }

  function closeCommandPalette() {
    if (commandPaletteModal) commandPaletteModal.classList.remove('active');
  }

  function renderPaletteResults() {
    if (!paletteResults) return;
    const query = (paletteInput?.value || '').trim().toLowerCase();
    const filtered = COMMAND_CATALOG.filter((cmd) => {
      const matchCat = currentPaletteFilter === 'all' || cmd.category === currentPaletteFilter;
      const matchQuery =
        !query ||
        cmd.title.toLowerCase().includes(query) ||
        cmd.desc.toLowerCase().includes(query) ||
        cmd.id.toLowerCase().includes(query);
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = 'text-align:center;padding:24px 12px;color:#64748b;font-size:13px;';
      emptyState.textContent = `No matching engineering commands or engines found for "${query}"`;
      paletteResults.replaceChildren(emptyState);
      return;
    }

    selectedPaletteIndex = Math.max(0, Math.min(selectedPaletteIndex, filtered.length - 1));

    const items = filtered.map((cmd, idx) =>
      window.OmniCommandPaletteView.createCommandPaletteItem(document, cmd, idx, idx === selectedPaletteIndex)
    );
    paletteResults.replaceChildren(...items);
    if (window.OmniIcons) window.OmniIcons.hydrateAll(paletteResults);

    // Attach click listeners to rows
    items.forEach((item, idx) => {
      item.addEventListener('click', () => {
        closeCommandPalette();
        filtered[idx].action();
      });
    });
  }

  if (paletteInput) {
    paletteInput.addEventListener('input', () => {
      selectedPaletteIndex = 0;
      renderPaletteResults();
    });

    paletteInput.addEventListener('keydown', (e) => {
      const query = (paletteInput.value || '').trim().toLowerCase();
      const filtered = COMMAND_CATALOG.filter((cmd) => {
        const matchCat = currentPaletteFilter === 'all' || cmd.category === currentPaletteFilter;
        const matchQuery =
          !query ||
          cmd.title.toLowerCase().includes(query) ||
          cmd.desc.toLowerCase().includes(query) ||
          cmd.id.toLowerCase().includes(query);
        return matchCat && matchQuery;
      });

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedPaletteIndex = (selectedPaletteIndex + 1) % Math.max(1, filtered.length);
        renderPaletteResults();
        ensureVisiblePaletteItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedPaletteIndex = (selectedPaletteIndex - 1 + filtered.length) % Math.max(1, filtered.length);
        renderPaletteResults();
        ensureVisiblePaletteItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedPaletteIndex]) {
          closeCommandPalette();
          filtered[selectedPaletteIndex].action();
        }
      } else if (e.key === 'Escape') {
        closeCommandPalette();
      }
    });
  }

  function ensureVisiblePaletteItem() {
    const selectedEl = paletteResults?.querySelector('.command-item.selected');
    if (selectedEl && paletteResults) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  paletteFilterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      paletteFilterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentPaletteFilter = chip.getAttribute('data-category') || 'all';
      selectedPaletteIndex = 0;
      renderPaletteResults();
    });
  });

  if (btnOpenPalette) {
    btnOpenPalette.addEventListener('click', openCommandPalette);
  }
  if (btnClosePalette) {
    btnClosePalette.addEventListener('click', closeCommandPalette);
  }

  // Global Keyboard Shortcut: Ctrl+K or Cmd+K
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (commandPaletteModal?.classList.contains('active')) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    } else if (e.key === 'Escape' && commandPaletteModal?.classList.contains('active')) {
      closeCommandPalette();
    }
  });

  // --- 5. Floating In-Viewport HUD Toolbar Interaction ---
  const hudToolbar = document.getElementById('viewport-hud-toolbar');
  if (hudToolbar) {
    hudToolbar.querySelectorAll('.hud-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-ribbon-target');
        if (targetId) {
          const ribbonBtn = document.getElementById(targetId);
          if (ribbonBtn) ribbonBtn.click();
        }
        // Synchronize active highlight across the HUD render style buttons
        if (
          btn.id.startsWith('hud-btn-shaded') ||
          btn.id.startsWith('hud-btn-wire') ||
          btn.id.startsWith('hud-btn-xray') ||
          btn.id.startsWith('hud-btn-fea')
        ) {
          hudToolbar
            .querySelectorAll('[id^="hud-btn-shaded"], [id^="hud-btn-wire"], [id^="hud-btn-xray"], [id^="hud-btn-fea"]')
            .forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        } else if (btn.id === 'hud-btn-clip' || btn.id === 'hud-btn-measure') {
          btn.classList.toggle('active');
        } else if (btn.id === 'btn-anatomy-card') {
          const overlay = document.getElementById('anatomy-card-overlay');
          if (overlay) {
            const isVisible = overlay.style.display !== 'none';
            overlay.style.display = isVisible ? 'none' : 'flex';
            btn.classList.toggle('active', !isVisible);

            // Synchronize live telemetry
            if (!isVisible && window.viewport3D) {
              const telemetryEl = document.getElementById('anatomy-telemetry-badge');
              const footerLeft = document.getElementById('anatomy-footer-left');
              const footerRight = document.getElementById('anatomy-footer-right');

              const angle = window.viewport3D.cameraAngle || { theta: 0.65, phi: 0.85 };
              const azDeg = ((angle.theta * 180) / Math.PI).toFixed(1);
              const elDeg = (((Math.PI / 2 - angle.phi) * 180) / Math.PI).toFixed(1);
              const dist = (window.viewport3D.cameraDistance || 220).toFixed(0);

              if (telemetryEl)
                telemetryEl.textContent = `ILLUSTRATIVE MOTION PREVIEW: EXAMPLE DAMPING=22 N·s/m | EXAMPLE STIFFNESS=140 N/m`;
              if (footerRight) footerRight.textContent = `AZIMUTH: ${azDeg}° • ELEV: ${elDeg}° • DIST: ${dist}mm`;
              if (footerLeft) footerLeft.textContent = `ILLUSTRATIVE SCALE • NO TOLERANCE SPECIFIED • WEBGL 2.0`;
            }
          }
        } else if (btn.id === 'btn-storytelling-play') {
          if (!window.omniStorytelling && window.StorytellingRails) {
            window.omniStorytelling = window.StorytellingRails.createController({ viewport3d: window.viewport3D });
            window.omniStorytelling.onStageChange((stage, idx, total) => {
              const figTitle = document.getElementById('anatomy-fig-title');
              if (figTitle) figTitle.textContent = `${stage.title.toUpperCase()} • ${stage.subtitle.toUpperCase()}`;
              const badge = document.getElementById('anatomy-telemetry-badge');
              if (badge) badge.textContent = `BREAKDOWN STAGE [${idx + 1}/${total}]: ${stage.id.toUpperCase()}`;
            });
          }
          if (window.omniStorytelling) {
            const isPlaying = window.omniStorytelling.toggleTour();
            btn.classList.toggle('active', isPlaying);
          }
        } else if (btn.id === 'btn-storytelling-next') {
          if (!window.omniStorytelling && window.StorytellingRails) {
            window.omniStorytelling = window.StorytellingRails.createController({ viewport3d: window.viewport3D });
          }
          if (window.omniStorytelling) {
            window.omniStorytelling.nextStage();
          }
        }
      });
    });
  }

  // --- In-Viewport Direct 3D Modeling Gizmos & Sketcher Canvas ---
  try {
    const GizmoClass =
      typeof ViewportGizmos !== 'undefined'
        ? ViewportGizmos
        : typeof require !== 'undefined'
          ? require('./viewport_gizmos').ViewportGizmos
          : null;
    if (GizmoClass) {
      window.omniGizmos = new GizmoClass({
        mode: 'translate',
        onTransformDrag: (data) => {
          if (window.viewport3D && window.viewport3D.updateTransform) {
            window.viewport3D.updateTransform(data);
          }
        }
      });
    }

    const Sketcher3DClass =
      typeof SketcherCanvas3D !== 'undefined'
        ? SketcherCanvas3D
        : typeof require !== 'undefined'
          ? require('./sketcher_canvas_3d').SketcherCanvas3D
          : null;
    if (Sketcher3DClass) {
      window.omniSketcher3D = new Sketcher3DClass({ plane: 'XY' });
    }
  } catch (gizmoErr) {
    console.debug('Gizmos/Sketcher initialization:', gizmoErr.message);
  }

  // --- 6. Collapsible Bottom OmniAI Dock Panel Interaction ---
  const aiCopilotDock = document.getElementById('ai-copilot-dock');
  const btnToggleAiDock = document.getElementById('btn-toggle-ai-dock');

  function toggleAiDock() {
    if (!aiCopilotDock) return;
    const isCollapsed = aiCopilotDock.classList.toggle('collapsed');
    if (btnToggleAiDock && window.OmniIcons) {
      const slot = btnToggleAiDock.querySelector('.icon-slot');
      if (slot) {
        slot.setAttribute('data-omni-icon', isCollapsed ? 'chevronUp' : 'chevronDown');
        window.OmniIcons.hydrateAll(btnToggleAiDock);
      }
    }
    // Dispatch window resize event so 3D Viewport expands smoothly to fill full canvas
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 240);
  }

  if (btnToggleAiDock) {
    btnToggleAiDock.addEventListener('click', toggleAiDock);
  }

  // Global Keyboard Shortcut: Ctrl+J or Cmd+J to toggle OmniAI Dock
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      toggleAiDock();
    }
  });

  // --- 7. Modeless Docking Manager Initialization ---
  if (window.DockingManager) {
    const dm = new window.DockingManager();
    window.dockingManager = dm;

    const dockablePanels = [
      { id: 'modal-optical-inspector', slot: 'bottom' },
      { id: 'modal-spice-oscilloscope', slot: 'bottom' },
      { id: 'modal-flowsheet-pfd', slot: 'bottom' },
      { id: 'modal-cad-diff', slot: 'bottom' },
      { id: 'modal-ebom-manager', slot: 'right' },
      { id: 'modal-sketcher', slot: 'left' },
      { id: 'modal-healer', slot: 'bottom' },
      { id: 'modal-dls', slot: 'bottom' },
      { id: 'modal-asme', slot: 'bottom' },
      { id: 'modal-drawing', slot: 'bottom' },
      { id: 'modal-blend', slot: 'bottom' },
      { id: 'modal-assembly', slot: 'bottom' },
      { id: 'modal-mesher', slot: 'bottom' },
      { id: 'modal-fvm-cfd', slot: 'bottom' },
      { id: 'modal-sheet-metal', slot: 'bottom' },
      { id: 'modal-gdt', slot: 'bottom' },
      { id: 'modal-fmi', slot: 'bottom' },
      { id: 'modal-hpc', slot: 'bottom' },
      { id: 'modal-verilog', slot: 'bottom' },
      { id: 'modal-wizards', slot: 'bottom' }
    ];

    dockablePanels.forEach((p) => {
      const el = document.getElementById(p.id);
      if (el) {
        dm.registerPanel(p.id, el, {
          title: el.querySelector('.modal-title')?.textContent?.trim() || p.id,
          preferredSlot: p.slot,
          onOpen: () => el.classList.add('active'),
          onClose: () => el.classList.remove('active')
        });
      }
    });
  }

  // --- 8. CAD Keymap and Shortcut Manager Initialization ---
  if (window.KeymapManager) {
    const km = new window.KeymapManager('OMNIENG_DEFAULT');
    window.keymapManager = km;

    km.onAction('ACTION_FIT_VIEWPORT', () => {
      document.getElementById('ribbon-cam-reset')?.click();
    });
    km.onAction('ACTION_VIEW_ISOMETRIC', () => {
      document.getElementById('ribbon-cam-iso')?.click();
    });
    km.onAction('ACTION_VIEW_SOLID', () => {
      document.getElementById('ribbon-btn-shaded')?.click();
    });
    km.onAction('ACTION_VIEW_WIREFRAME', () => {
      document.getElementById('ribbon-btn-wire')?.click();
    });
    km.onAction('ACTION_VIEW_XRAY', () => {
      document.getElementById('ribbon-btn-xray')?.click();
    });
    km.onAction('ACTION_VIEW_FEA_STRESS', () => {
      document.getElementById('ribbon-btn-fea')?.click();
    });
    km.onAction('ACTION_TOGGLE_SECTION_CLIP', () => {
      document.getElementById('ribbon-btn-clip')?.click();
    });
    km.onAction('ACTION_TOGGLE_CALIPER_MEASURE', () => {
      document.getElementById('ribbon-btn-measure')?.click();
    });
    km.onAction('ACTION_OPEN_COMMAND_PALETTE', () => {
      openCommandPalette();
    });
    km.onAction('ACTION_TOGGLE_AI_DOCK', () => {
      toggleAiDock();
    });
    km.onAction('ACTION_SAVE_PROJECT', () => {
      document.getElementById('ribbon-btn-save-project')?.click();
    });
    km.onAction('ACTION_VIEW_FRONT', () => {
      document.getElementById('ribbon-cam-front')?.click();
    });
    km.onAction('ACTION_VIEW_TOP', () => {
      document.getElementById('ribbon-cam-top')?.click();
    });
    km.onAction('ACTION_UNDO', () => {
      document.getElementById('ribbon-btn-undo')?.click();
    });
    km.onAction('ACTION_TOGGLE_QUAD_VIEW', () => {
      window.viewport3D?.toggleQuadView();
    });
    km.onAction('ACTION_REDO', () => {
      document.getElementById('ribbon-btn-redo')?.click();
    });

    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      km.handleKeyboardEvent(e);
    });
  }

  // --- 9. 3Dconnexion SpaceMouse WebHID Controller Initialization ---
  if (window.SpaceMouseController && window.viewport3D) {
    window.spaceMouseController = new window.SpaceMouseController(window.viewport3D);
  }

  // --- 10. Industrial Workstation Status Bar Handlers (CARD-104 & CARD-105) ---
  const statusKeymapSelector = document.getElementById('status-keymap-selector');
  if (statusKeymapSelector) {
    statusKeymapSelector.addEventListener('change', (e) => {
      const profile = e.target.value;
      if (window.keymapManager) {
        window.keymapManager.setProfile(profile);
      }
      const label = e.target.options[e.target.selectedIndex]?.text || profile;
      addAiMessage(`[Ergonomics] Workstation navigation keymap switched to: ${label}`);
    });
  }

  // --- 11. 3D Viewport Right-Click Engineering Context Menu ---
  const viewportContextMenu = document.getElementById('viewport-context-menu');
  const threeCanvas = document.getElementById('three-canvas');
  let canvasRightMouseDownPos = { x: 0, y: 0 };
  let canvasRightMoved = false;

  if (threeCanvas && viewportContextMenu) {
    // Hydrate icons inside context menu
    if (window.OmniIcons?.hydrateIcons) {
      window.OmniIcons.hydrateIcons();
    }

    threeCanvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        canvasRightMouseDownPos = { x: e.clientX, y: e.clientY };
        canvasRightMoved = false;
      }
    });

    threeCanvas.addEventListener('mousemove', (e) => {
      if (e.buttons === 2) {
        const dx = Math.abs(e.clientX - canvasRightMouseDownPos.x);
        const dy = Math.abs(e.clientY - canvasRightMouseDownPos.y);
        if (dx > 4 || dy > 4) {
          canvasRightMoved = true;
          viewportContextMenu.style.display = 'none';
        }
      }
    });

    threeCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!canvasRightMoved) {
        // Position menu safely inside viewport bounds
        const x = Math.min(e.clientX, window.innerWidth - 250);
        const y = Math.min(e.clientY, window.innerHeight - 380);
        viewportContextMenu.style.left = `${Math.max(10, x)}px`;
        viewportContextMenu.style.top = `${Math.max(10, y)}px`;
        viewportContextMenu.style.display = 'block';
      }
    });

    // Close context menu on outside click
    window.addEventListener('click', (e) => {
      if (!viewportContextMenu.contains(e.target)) {
        viewportContextMenu.style.display = 'none';
      }
    });

    // Close context menu on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && viewportContextMenu.style.display !== 'none') {
        viewportContextMenu.style.display = 'none';
      }
    });

    // Handle context menu actions
    viewportContextMenu.querySelectorAll('.context-menu-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        viewportContextMenu.style.display = 'none';

        switch (action) {
          case 'filter-face':
            addAiMessage('[Selection Filter] Selection mask set to <strong>B-Rep Faces</strong>.');
            break;
          case 'filter-edge':
            addAiMessage('[Selection Filter] Selection mask set to <strong>B-Rep Edges</strong>.');
            break;
          case 'extrude-face':
            document.getElementById('cad-extrude-btn')?.click();
            break;
          case 'revolve-profile':
            document.getElementById('cad-revolve-btn')?.click();
            break;
          case 'shell-body':
            document.getElementById('cad-shell-btn')?.click();
            break;
          case 'cam-toolpath':
            document.getElementById('cad-cam-preview-btn')?.click();
            break;
          case 'nonlinear-fea': {
            window.omniSetSolverProgress('Calculating experimental cantilever formula example...', 50);
            const res = await window.omniEngAPI?.caeNonlinearLargeDeflection?.({
              length: 100,
              width: 20,
              height: 5,
              E: 200000,
              P: 25,
              lengthUnit: 'mm',
              modulusUnit: 'MPa',
              forceUnit: 'N'
            });
            if (!res?.success || !Number.isFinite(res.formulaAdjustedTipDeflectionMm)) {
              window.omniSetSolverProgress('Experimental cantilever estimate unavailable', 100, false);
              addAiMessage('[Experimental cantilever example] No result was returned.');
              break;
            }
            window.omniSetSolverProgress('Experimental cantilever estimate returned', 100, true);
            addAiMessage(
              `[Experimental cantilever example] Formula-adjusted tip deflection estimate: ${res.formulaAdjustedTipDeflectionMm} mm. No finite-element solve or design assessment was performed.`
            );
            break;
          }
          case 'measure-caliper':
            document.getElementById('btn-measure-caliper')?.click();
            break;
          case 'toggle-wireframe':
            window.viewport3D?.toggleWireframe();
            break;
          case 'reset-camera':
            window.viewport3D?.resetCamera();
            break;
        }
      });
    });
  }

  // Default initial studio setup - illustrative aerospace geometry
  state.manualParams.nasaRocketArticle = 'full_stack';
  switchStudio('aerospace');
  viewport3D.renderNasaSpaceRocket3D('full_stack');
});
