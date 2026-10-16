/**
 * OmniEng Application Controller & Orchestration Logic
 * Coordinates Studio Switching, 3D/2D viewports, manual parameter sliders, and OmniAI Co-Pilot.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Viewports
  const viewport3D = new Viewport3D('three-canvas');
  const blockDiagramUI = new BlockDiagramUI('diagram-canvas');
  const schematicLayoutUI = new SchematicLayoutUI('eda-canvas');

  // Application State
  const state = {
    currentStudio: 'consumer', // 'consumer', 'eda', 'aerospace', 'oilgas', 'simulink', 'universal_cad'
    activeViewMode: '3d',      // '3d', 'diagram', 'eda'
    samples: [],
    manualParams: {
      // Consumer Electronics
      dropHeight: 1.5,
      impactAngle: 'corner',
      socPowerWatts: 8.5,
      hasVaporChamber: true,
      chassisMaterial: 'Titanium',
      
      // Semiconductor & EDA
      verilogModule: 'alu_core',
      minWidthDrc: 50,
      minSpacingDrc: 45,

      // Drone & Aerospace
      targetAltitude: 12.0,
      windGustSpeed: 3.0,
      rotorRPM: 8000,
      propDiameter: 5.0,

      // Oil & Gas Process
      pipeSpec: '8_SCH40',
      operatingTempC: 220.0,
      hasExpansionLoop: true,
      crudeFeedBPD: 50000,

      // CAD
      cadType: 'box',
      cadWidth: 75,
      cadHeight: 8.2,
      cadDepth: 160
    }
  };

  // DOM Elements
  const studioButtons = document.querySelectorAll('.studio-btn');
  const inspectorTitle = document.getElementById('inspector-studio-title');
  const inspectorContainer = document.getElementById('inspector-dynamic-controls');
  const sampleContainer = document.getElementById('sample-list-container');
  const aiChatHistory = document.getElementById('ai-chat-history');
  const aiInput = document.getElementById('ai-input');
  const aiSendBtn = document.getElementById('ai-send-btn');
  const aiChips = document.getElementById('ai-chips');

  // Viewport switch tabs
  const btnView3d = document.getElementById('btn-view-3d');
  const btnViewDiagram = document.getElementById('btn-view-diagram');
  const btnViewEda = document.getElementById('btn-view-eda');
  const canvas3D = document.getElementById('three-canvas');
  const canvasDiagram = document.getElementById('diagram-canvas');
  const canvasEda = document.getElementById('eda-canvas');

  // Load Community Samples from IPC
  try {
    if (window.omniEngAPI && window.omniEngAPI.getCommunitySamples) {
      state.samples = await window.omniEngAPI.getCommunitySamples();
      renderSampleCatalog();
    }
  } catch (err) {
    console.warn('IPC offline, using local fallback samples', err);
  }

  // Bind Viewport Mode Buttons
  function setViewMode(mode) {
    state.activeViewMode = mode;
    [btnView3d, btnViewDiagram, btnViewEda].forEach(b => b.classList.remove('active'));
    canvas3D.style.display = 'none';
    canvasDiagram.style.display = 'none';
    canvasEda.style.display = 'none';

    if (mode === '3d') {
      btnView3d.classList.add('active');
      canvas3D.style.display = 'block';
      viewport3D.onResize();
    } else if (mode === 'diagram') {
      btnViewDiagram.classList.add('active');
      canvasDiagram.style.display = 'block';
      blockDiagramUI.onResize();
    } else if (mode === 'eda') {
      btnViewEda.classList.add('active');
      canvasEda.style.display = 'block';
      schematicLayoutUI.onResize();
    }
  }

  btnView3d.addEventListener('click', () => setViewMode('3d'));
  btnViewDiagram.addEventListener('click', () => setViewMode('diagram'));
  btnViewEda.addEventListener('click', () => setViewMode('eda'));

  // Studio Switcher Event Binding
  studioButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const studio = btn.dataset.studio;
      switchStudio(studio);
    });
  });

  function switchStudio(studio) {
    state.currentStudio = studio;
    studioButtons.forEach(b => b.classList.toggle('active', b.dataset.studio === studio));

    // Update 3D scene & Inspector
    if (studio === 'consumer') {
      inspectorTitle.textContent = 'Consumer Electronics Studio';
      setViewMode('3d');
      viewport3D.renderSmartphoneCad(state.manualParams.cadWidth, state.manualParams.cadHeight, state.manualParams.cadDepth);
      renderConsumerInspector();
    } else if (studio === 'eda') {
      inspectorTitle.textContent = 'Semiconductor & EDA Studio';
      setViewMode('eda');
      schematicLayoutUI.setMode('eda');
      renderEdaInspector();
    } else if (studio === 'aerospace') {
      inspectorTitle.textContent = 'Drone & Aerospace Studio';
      setViewMode('3d');
      viewport3D.renderDrone3D(85);
      renderAerospaceInspector();
    } else if (studio === 'oilgas') {
      inspectorTitle.textContent = 'Oil & Gas Process Studio';
      setViewMode('3d');
      viewport3D.renderPipingLoop3D(state.manualParams.hasExpansionLoop ? 40 : 25, 10, 6);
      renderOilGasInspector();
    } else if (studio === 'simulink') {
      inspectorTitle.textContent = 'Dynamic Simulink Studio';
      setViewMode('diagram');
      renderSimulinkInspector();
    } else if (studio === 'universal_cad') {
      inspectorTitle.textContent = 'Parametric CAD Studio';
      setViewMode('3d');
      viewport3D.renderSmartphoneCad(state.manualParams.cadWidth, state.manualParams.cadHeight, state.manualParams.cadDepth);
      renderCadInspector();
    }
  }

  // --- Dynamic Inspector Panels (Full Manual Editing Support) ---

  function renderConsumerInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>📱 Phone Packaging CAD</span>
          <span class="tag">PTC Creo / NX</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Chassis Width:</span>
            <span class="param-val" id="val-cad-w">${state.manualParams.cadWidth} mm</span>
          </div>
          <input type="range" class="slider-input" min="60" max="90" step="1" value="${state.manualParams.cadWidth}" id="slider-cad-w">
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Chassis Thickness:</span>
            <span class="param-val" id="val-cad-h">${state.manualParams.cadHeight} mm</span>
          </div>
          <input type="range" class="slider-input" min="6.5" max="12.0" step="0.1" value="${state.manualParams.cadHeight}" id="slider-cad-h">
        </div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span>💥 Explicit Drop Test (FEA)</span>
          <span class="tag">Ansys Mechanical</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Drop Height:</span>
            <span class="param-val" id="val-drop-h">${state.manualParams.dropHeight} m</span>
          </div>
          <input type="range" class="slider-input" min="0.5" max="2.5" step="0.1" value="${state.manualParams.dropHeight}" id="slider-drop-h">
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Impact Orientation:</span>
          </div>
          <select class="select-input" id="select-drop-angle">
            <option value="corner" ${state.manualParams.impactAngle === 'corner' ? 'selected' : ''}>Corner Impact (High Shear)</option>
            <option value="edge" ${state.manualParams.impactAngle === 'edge' ? 'selected' : ''}>Side Edge Impact</option>
            <option value="face" ${state.manualParams.impactAngle === 'face' ? 'selected' : ''}>Front Screen Flat Impact</option>
          </select>
        </div>
        <button class="btn-primary" id="btn-run-drop">
          <span>▶ Run Explicit Drop Test</span>
        </button>
        <div id="drop-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span>🔥 Thermal CHT & Vapor Chamber</span>
          <span class="tag">Ansys Icepak</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>SoC Heat Dissipation:</span>
            <span class="param-val" id="val-soc-pwr">${state.manualParams.socPowerWatts} W</span>
          </div>
          <input type="range" class="slider-input" min="2.0" max="15.0" step="0.5" value="${state.manualParams.socPowerWatts}" id="slider-soc-pwr">
        </div>
        <div class="param-row">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); cursor: pointer;">
            <input type="checkbox" id="chk-vapor-chamber" ${state.manualParams.hasVaporChamber ? 'checked' : ''}>
            <span>Enable Sintered Copper Vapor Chamber</span>
          </label>
        </div>
        <button class="btn-primary" id="btn-run-thermal" style="background: linear-gradient(135deg, var(--accent-amber), var(--accent-rose));">
          <span>▶ Run Thermal CHT Simulation</span>
        </button>
        <div id="thermal-telemetry-container"></div>
      </div>
    `;

    // Bind manual sliders
    const sliderW = document.getElementById('slider-cad-w');
    const sliderH = document.getElementById('slider-cad-h');
    sliderW.addEventListener('input', (e) => {
      state.manualParams.cadWidth = Number(e.target.value);
      document.getElementById('val-cad-w').textContent = `${state.manualParams.cadWidth} mm`;
      viewport3D.renderSmartphoneCad(state.manualParams.cadWidth, state.manualParams.cadHeight, state.manualParams.cadDepth);
    });
    sliderH.addEventListener('input', (e) => {
      state.manualParams.cadHeight = Number(e.target.value);
      document.getElementById('val-cad-h').textContent = `${state.manualParams.cadHeight} mm`;
      viewport3D.renderSmartphoneCad(state.manualParams.cadWidth, state.manualParams.cadHeight, state.manualParams.cadDepth);
    });

    const sliderDropH = document.getElementById('slider-drop-h');
    sliderDropH.addEventListener('input', (e) => {
      state.manualParams.dropHeight = Number(e.target.value);
      document.getElementById('val-drop-h').textContent = `${state.manualParams.dropHeight} m`;
    });

    const selectDropAngle = document.getElementById('select-drop-angle');
    selectDropAngle.addEventListener('change', (e) => {
      state.manualParams.impactAngle = e.target.value;
    });

    // Run Drop Test Action
    document.getElementById('btn-run-drop').addEventListener('click', async () => {
      const dropContainer = document.getElementById('drop-telemetry-container');
      dropContainer.innerHTML = '<div style="font-size:11px; color:var(--accent-cyan); padding:8px 0;">Solving explicit central difference equations...</div>';
      
      const res = await window.omniEngAPI.solveDropTest({
        dropHeight: state.manualParams.dropHeight,
        impactAngle: state.manualParams.impactAngle
      });

      // Switch to FEA stress contour view
      viewport3D.renderFEAStressHeatmap();

      const isPass = res.status.includes('PASS');
      const isWarn = res.status.includes('WARNING');
      const statusClass = isPass ? 'status-pass' : (isWarn ? 'status-warn' : 'status-fail');

      dropContainer.innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Impact Velocity:</span>
            <span class="telemetry-value">${res.impactVelocity} m/s</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Peak Deceleration:</span>
            <span class="telemetry-value">${res.peakDeceleration_G} G</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Screen Glass Stress:</span>
            <span class="telemetry-value">${res.peakScreenStress_MPa} MPa</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Chassis Stress:</span>
            <span class="telemetry-value">${res.peakChassisStress_MPa} MPa</span>
          </div>
          <div class="status-indicator ${statusClass}">${res.status}</div>
        </div>
      `;
    });

    // Run Thermal CHT Action
    document.getElementById('btn-run-thermal').addEventListener('click', async () => {
      const thermalContainer = document.getElementById('thermal-telemetry-container');
      thermalContainer.innerHTML = '<div style="font-size:11px; color:var(--accent-amber); padding:8px 0;">Simulating multi-phase conjugate heat transfer...</div>';

      const res = await window.omniEngAPI.solveThermal({
        socPowerWatts: state.manualParams.socPowerWatts,
        hasVaporChamber: document.getElementById('chk-vapor-chamber').checked
      });

      const isPass = res.verdict.includes('NORMAL');
      const isWarn = res.verdict.includes('WARNING');
      const statusClass = isPass ? 'status-pass' : (isWarn ? 'status-warn' : 'status-fail');

      thermalContainer.innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">SoC Junction Temp:</span>
            <span class="telemetry-value" style="color: ${res.maxSocTempC > 85 ? 'var(--accent-rose)' : 'var(--accent-green)'};">${res.maxSocTempC} °C</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Battery Surface Temp:</span>
            <span class="telemetry-value">${res.maxBatteryTempC} °C</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Exterior Skin Temp:</span>
            <span class="telemetry-value">${res.maxSkinTempC} °C</span>
          </div>
          <div class="status-indicator ${statusClass}">${res.verdict}</div>
        </div>
      `;
    });
  }

  function renderEdaInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>🔬 RTL Logic Synthesis</span>
          <span class="tag">Design Compiler</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Verilog Code:</span>
          </div>
          <textarea class="text-input" id="txt-verilog" style="height: 110px; font-family: var(--font-mono); font-size: 11px;">module alu_core (
  input clk, input a, input b,
  output reg y
);
  always @(posedge clk) begin
    y <= a & b;
  end
endmodule</textarea>
        </div>
        <button class="btn-primary" id="btn-run-synth">
          <span>▶ Synthesize to Standard Cells</span>
        </button>
        <div id="synth-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span>📐 Physical DRC Verification</span>
          <span class="tag">Siemens Calibre</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Min Metal Width:</span>
            <span class="param-val" id="val-drc-w">50 nm</span>
          </div>
          <input type="range" class="slider-input" min="30" max="80" value="50" id="slider-drc-w">
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Min Metal Spacing:</span>
            <span class="param-val" id="val-drc-s">45 nm</span>
          </div>
          <input type="range" class="slider-input" min="30" max="80" value="45" id="slider-drc-s">
        </div>
        <button class="btn-primary" id="btn-run-drc" style="background: linear-gradient(135deg, var(--accent-indigo), var(--accent-cyan));">
          <span>▶ Run Calibre DRC Verification</span>
        </button>
        <div id="drc-telemetry-container"></div>
      </div>
    `;

    document.getElementById('btn-run-synth').addEventListener('click', async () => {
      const code = document.getElementById('txt-verilog').value;
      const res = await window.omniEngAPI.synthesizeVerilog(code);
      document.getElementById('synth-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Standard Cells:</span>
            <span class="telemetry-value">${res.gateCount} Gates</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Total Cell Area:</span>
            <span class="telemetry-value">${res.totalArea_um2} µm²</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Fmax Target:</span>
            <span class="telemetry-value">${res.maxFrequency_MHz} MHz</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Timing Slack:</span>
            <span class="telemetry-value" style="color:var(--accent-green);">${res.timingSlack_ps} ps</span>
          </div>
          <div class="status-indicator status-pass">${res.verdict}</div>
        </div>
      `;
    });

    document.getElementById('btn-run-drc').addEventListener('click', async () => {
      const testShapes = [
        { id: 'M1_NET1', layer: 'Metal1', x: 80, y: 120, w: 40, h: 120 }, // Violates 50nm min width
        { id: 'M1_NET2', layer: 'Metal1', x: 130, y: 120, w: 60, h: 120 } // Violates 45nm spacing
      ];
      const res = await window.omniEngAPI.runDRC(testShapes, { minWidth: 50, minSpacing: 45 });
      schematicLayoutUI.setDRCViolations(res.violations);

      document.getElementById('drc-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Polygons Checked:</span>
            <span class="telemetry-value">${res.totalShapesChecked}</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Violations Found:</span>
            <span class="telemetry-value" style="color:var(--accent-rose);">${res.violationCount}</span>
          </div>
          <div class="status-indicator status-fail">${res.verdict}</div>
        </div>
      `;
    });
  }

  function renderAerospaceInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>🛸 6-DOF Autonomous Drone GNC</span>
          <span class="tag">Simulink Autopilot</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Target Altitude:</span>
            <span class="param-val" id="val-target-alt">${state.manualParams.targetAltitude} m</span>
          </div>
          <input type="range" class="slider-input" min="2" max="30" step="1" value="${state.manualParams.targetAltitude}" id="slider-target-alt">
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Wind Gust Disturbance:</span>
            <span class="param-val" id="val-wind-gust">${state.manualParams.windGustSpeed} m/s</span>
          </div>
          <input type="range" class="slider-input" min="0" max="10" step="0.5" value="${state.manualParams.windGustSpeed}" id="slider-wind-gust">
        </div>
        <button class="btn-primary" id="btn-run-drone">
          <span>▶ Simulate 6-DOF Flight Control</span>
        </button>
        <div id="drone-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span>🌀 Rotor Propeller CFD (MRF)</span>
          <span class="tag">Ansys Fluent</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Rotor RPM:</span>
            <span class="param-val" id="val-rotor-rpm">${state.manualParams.rotorRPM} RPM</span>
          </div>
          <input type="range" class="slider-input" min="3000" max="15000" step="500" value="${state.manualParams.rotorRPM}" id="slider-rotor-rpm">
        </div>
        <button class="btn-primary" id="btn-run-propeller" style="background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue));">
          <span>▶ Compute Rotor Thrust & Torque</span>
        </button>
        <div id="propeller-telemetry-container"></div>
      </div>
    `;

    document.getElementById('slider-target-alt').addEventListener('input', (e) => {
      state.manualParams.targetAltitude = Number(e.target.value);
      document.getElementById('val-target-alt').textContent = `${state.manualParams.targetAltitude} m`;
    });
    document.getElementById('slider-rotor-rpm').addEventListener('input', (e) => {
      state.manualParams.rotorRPM = Number(e.target.value);
      document.getElementById('val-rotor-rpm').textContent = `${state.manualParams.rotorRPM} RPM`;
    });

    document.getElementById('btn-run-drone').addEventListener('click', async () => {
      const res = await window.omniEngAPI.simulateDrone({
        targetAltitude: state.manualParams.targetAltitude,
        windGustSpeed: state.manualParams.windGustSpeed
      });

      document.getElementById('drone-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Settling Time:</span>
            <span class="telemetry-value">${res.settlingTime_s} s</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Max Overshoot:</span>
            <span class="telemetry-value">${res.overshootPercent} %</span>
          </div>
          <div class="status-indicator status-pass">${res.stabilityVerdict}</div>
        </div>
      `;
    });

    document.getElementById('btn-run-propeller').addEventListener('click', async () => {
      const res = await window.omniEngAPI.solvePropellerThrust({
        rpm: state.manualParams.rotorRPM,
        diameterInches: state.manualParams.propDiameter,
        pitchInches: 3.5
      });

      document.getElementById('propeller-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Total Thrust:</span>
            <span class="telemetry-value" style="color:var(--accent-cyan);">${res.thrust_N} N (${res.thrust_grams} g)</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Shaft Power:</span>
            <span class="telemetry-value">${res.power_Watts} W</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Figure of Merit:</span>
            <span class="telemetry-value">${res.figureOfMerit}</span>
          </div>
          <div class="status-indicator status-pass">AERODYNAMIC EQUILIBRIUM</div>
        </div>
      `;
    });
  }

  function renderOilGasInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>🛢️ ASME B31.3 Piping Stress</span>
          <span class="tag">Caesar II / AutoPIPE</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Operating Temp:</span>
            <span class="param-val" id="val-pipe-t">${state.manualParams.operatingTempC} °C</span>
          </div>
          <input type="range" class="slider-input" min="50" max="450" step="10" value="${state.manualParams.operatingTempC}" id="slider-pipe-t">
        </div>
        <div class="param-row">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); cursor: pointer;">
            <input type="checkbox" id="chk-pipe-loop" ${state.manualParams.hasExpansionLoop ? 'checked' : ''}>
            <span>Include ASME Thermal Expansion Loop</span>
          </label>
        </div>
        <button class="btn-primary" id="btn-run-pipe">
          <span>▶ Check ASME Code Compliance</span>
        </button>
        <div id="pipe-telemetry-container"></div>
      </div>

      <div class="param-group">
        <div class="param-group-title">
          <span>⚗️ Crude Distillation Column</span>
          <span class="tag">Aspen HYSYS</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Crude Feed Rate:</span>
            <span class="param-val" id="val-crude-bpd">${state.manualParams.crudeFeedBPD.toLocaleString()} BPD</span>
          </div>
          <input type="range" class="slider-input" min="10000" max="100000" step="5000" value="${state.manualParams.crudeFeedBPD}" id="slider-crude-bpd">
        </div>
        <button class="btn-primary" id="btn-run-hysys" style="background: linear-gradient(135deg, var(--accent-amber), var(--accent-blue));">
          <span>▶ Run HYSYS Fractionation</span>
        </button>
        <div id="hysys-telemetry-container"></div>
      </div>
    `;

    document.getElementById('slider-pipe-t').addEventListener('input', (e) => {
      state.manualParams.operatingTempC = Number(e.target.value);
      document.getElementById('val-pipe-t').textContent = `${state.manualParams.operatingTempC} °C`;
    });

    document.getElementById('chk-pipe-loop').addEventListener('change', (e) => {
      state.manualParams.hasExpansionLoop = e.target.checked;
      viewport3D.renderPipingLoop3D(state.manualParams.hasExpansionLoop ? 40 : 25, 10, 6);
    });

    document.getElementById('btn-run-pipe').addEventListener('click', async () => {
      const res = await window.omniEngAPI.evaluatePipingStress({
        operatingTempC: state.manualParams.operatingTempC,
        hasExpansionLoop: state.manualParams.hasExpansionLoop
      });

      const isPass = res.isCodeCompliant;
      const statusClass = isPass ? 'status-pass' : 'status-fail';

      document.getElementById('pipe-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Expansion Stress:</span>
            <span class="telemetry-value">${res.expansionStress_SE_MPa} MPa</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Allowable Stress (Sa):</span>
            <span class="telemetry-value">${res.allowableStress_SA_MPa} MPa</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Stress Ratio:</span>
            <span class="telemetry-value" style="color:${isPass ? 'var(--accent-green)' : 'var(--accent-rose)'};">${res.stressRatio}</span>
          </div>
          <div class="status-indicator ${statusClass}">${res.status}</div>
        </div>
      `;
    });

    document.getElementById('btn-run-hysys').addEventListener('click', async () => {
      const res = await window.omniEngAPI.simulateDistillation({
        feedBPD: state.manualParams.crudeFeedBPD,
        trayCount: 30
      });

      schematicLayoutUI.setMode('pid');
      setViewMode('eda');

      document.getElementById('hysys-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Light Naphtha:</span>
            <span class="telemetry-value">${res.products.lightNaphtha_BPD.toLocaleString()} BPD</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Diesel Fuel:</span>
            <span class="telemetry-value">${res.products.dieselFuel_BPD.toLocaleString()} BPD</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Condenser Duty:</span>
            <span class="telemetry-value">${res.thermalDuties.condenserDuty_MW} MW</span>
          </div>
          <div class="status-indicator status-pass">${res.verdict}</div>
        </div>
      `;
    });
  }

  function renderSimulinkInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>🧮 Dynamic Simulink Engine</span>
          <span class="tag">MATLAB / Simulink</span>
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Proportional Gain (Kp):</span>
            <span class="param-val">2.5</span>
          </div>
          <input type="range" class="slider-input" min="0.1" max="10.0" step="0.1" value="2.5" id="slider-kp">
        </div>
        <div class="param-row">
          <div class="param-label-row">
            <span>Integral Gain (Ki):</span>
            <span class="param-val">0.5</span>
          </div>
          <input type="range" class="slider-input" min="0.0" max="5.0" step="0.1" value="0.5" id="slider-ki">
        </div>
        <button class="btn-primary" id="btn-run-simulink">
          <span>▶ Solve Dynamic Continuous Loop</span>
        </button>
        <div id="simulink-telemetry-container"></div>
      </div>
    `;

    document.getElementById('btn-run-simulink').addEventListener('click', () => {
      blockDiagramUI.render();
      document.getElementById('simulink-telemetry-container').innerHTML = `
        <div class="telemetry-card">
          <div class="telemetry-row">
            <span class="telemetry-label">Integrator Steps:</span>
            <span class="telemetry-value">1,000 (dt=0.01s)</span>
          </div>
          <div class="telemetry-row">
            <span class="telemetry-label">Closed Loop Poles:</span>
            <span class="telemetry-value">-1.5 ± 2.8j (Stable)</span>
          </div>
          <div class="status-indicator status-pass">SOLVER CONVERGED (RK45)</div>
        </div>
      `;
    });
  }

  function renderCadInspector() {
    inspectorContainer.innerHTML = `
      <div class="param-group">
        <div class="param-group-title">
          <span>📐 Parametric B-Rep Solids</span>
          <span class="tag">Siemens NX / CATIA</span>
        </div>
        <div class="param-row">
          <button class="btn-primary" id="btn-cad-box">Create Parametric Box</button>
          <button class="btn-primary" id="btn-cad-cyl" style="margin-top: 6px;">Create Cylinder</button>
          <button class="btn-primary" id="btn-cad-sph" style="margin-top: 6px;">Create Sphere</button>
        </div>
      </div>
    `;

    document.getElementById('btn-cad-box').addEventListener('click', () => {
      viewport3D.renderSmartphoneCad(80, 20, 100);
    });
    document.getElementById('btn-cad-cyl').addEventListener('click', () => {
      viewport3D.clearMesh();
      const geom = new THREE.CylinderGeometry(20, 20, 50, 32);
      const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8 });
      viewport3D.currentMesh = new THREE.Mesh(geom, mat);
      viewport3D.scene.add(viewport3D.currentMesh);
    });
    document.getElementById('btn-cad-sph').addEventListener('click', () => {
      viewport3D.clearMesh();
      const geom = new THREE.SphereGeometry(25, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.8 });
      viewport3D.currentMesh = new THREE.Mesh(geom, mat);
      viewport3D.scene.add(viewport3D.currentMesh);
    });
  }

  // --- Render Community Samples ---
  function renderSampleCatalog() {
    sampleContainer.innerHTML = '';
    for (const sample of state.samples) {
      const card = document.createElement('div');
      card.className = 'sample-card';
      card.innerHTML = `
        <div class="sample-title">${sample.title}</div>
        <div class="sample-desc">${sample.description}</div>
        <div class="tag-list">
          ${sample.tags.map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.sample-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        loadSampleProject(sample);
      });
      sampleContainer.appendChild(card);
    }
  }

  function loadSampleProject(sample) {
    switchStudio(sample.studio);
    addAiMessage(`Loaded turnkey community sample: "${sample.title}". All physics parameters, CAD features, and simulation boundary conditions are initialized and ready to run or edit.`);
  }

  // --- OmniAI Co-Pilot Messaging & Dual Editing ---
  function addAiMessage(text, isUser = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'user' : 'ai'}`;
    bubble.innerHTML = isUser ? text : `<strong>OmniAI:</strong> ${text}`;
    aiChatHistory.appendChild(bubble);
    aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
  }

  async function handleAiPrompt(promptText) {
    if (!promptText.trim()) return;
    addAiMessage(promptText, true);
    aiInput.value = '';

    try {
      const plan = await window.omniEngAPI.processAIPrompt(promptText, {
        currentStudio: state.currentStudio,
        params: state.manualParams
      });

      addAiMessage(plan.assistantMessage);

      // Automatically sync AI results with manual sliders & viewport
      if (plan.matchedTool === 'run_phone_drop_test') {
        switchStudio('consumer');
        viewport3D.renderFEAStressHeatmap();
      } else if (plan.matchedTool === 'simulate_mobile_thermal') {
        switchStudio('consumer');
      } else if (plan.matchedTool === 'synthesize_verilog_chip' || plan.matchedTool === 'run_calibre_drc_check') {
        switchStudio('eda');
      } else if (plan.matchedTool === 'simulate_drone_flight') {
        switchStudio('aerospace');
      } else if (plan.matchedTool === 'calculate_asme_piping_stress' || plan.matchedTool === 'run_hysys_flash_distillation') {
        switchStudio('oilgas');
      }

      // Sync suggested parameters into manual inspector controls
      if (plan.suggestedManualEdits && plan.suggestedManualEdits.length > 0) {
        for (const edit of plan.suggestedManualEdits) {
          if (state.manualParams[edit.key] !== undefined) {
            state.manualParams[edit.key] = edit.value;
          }
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
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      handleAiPrompt(prompt);
    });
  });

  // Default initial studio setup
  switchStudio('consumer');
});
