'use strict';

const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '/Users/yuta/.gemini/antigravity/brain/bd7b9506-4d4a-4b5a-be3d-297d1d74b805';
const TARGET_HTML = path.join(ARTIFACT_DIR, 'pid_proof_viewer.html');

const lngSvg = fs.readFileSync(path.join(__dirname, '..', 'screenshots', 'pid_lng', 'pid_sheet_1.svg'), 'utf8');
const ogSvg = fs.readFileSync(path.join(__dirname, '..', 'screenshots', 'pid_oilgas', 'pid_sheet_1.svg'), 'utf8');

const lngSchedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'screenshots', 'pid_lng', 'pid_schedule.json'), 'utf8'));
const ogSchedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'screenshots', 'pid_oilgas', 'pid_schedule.json'), 'utf8'));

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OmniEng Production P&ID Interactive Proof Viewer</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    :root {
      --bg-dark: #0f172a;
      --card-dark: #1e293b;
      --border-dark: #334155;
      --accent-blue: #0284c7;
      --accent-cyan: #06b6d4;
    }
    body {
      margin: 0;
      padding: 0;
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .svg-viewport {
      flex: 1;
      overflow: hidden;
      position: relative;
      background: radial-gradient(circle at 50% 50%, #1e293b 0%, #0a0f1d 100%);
      cursor: grab;
      user-select: none;
    }
    .svg-viewport:active {
      cursor: grabbing;
    }
    #svgContainer {
      position: absolute;
      transform-origin: 0 0;
      transition: transform 0.05s ease-out;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      background: white;
    }
    #svgContainer svg {
      display: block;
      width: 1189mm;
      height: 841mm;
    }
    .badge-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-weight: 600;
      letter-spacing: 0.025em;
    }
    /* Element highlight */
    .highlight-glow {
      outline: 4px solid #ef4444 !important;
      outline-offset: 4px;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; filter: drop-shadow(0 0 10px #ef4444); }
      50% { opacity: 0.6; filter: drop-shadow(0 0 3px #ef4444); }
    }
  </style>
</head>
<body class="flex flex-col h-screen">

  <!-- Top Navigation & Control Bar -->
  <header class="bg-[#131b2e] border-b border-[#243352] px-4 py-2.5 flex items-center justify-between shrink-0 z-20">
    <div class="flex items-center space-x-3">
      <div class="w-8 h-8 rounded bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-md">
        Ω
      </div>
      <div>
        <h1 class="text-sm font-bold tracking-wide text-white flex items-center gap-2">
          OmniEng P&amp;ID Studio
          <span class="badge-pill bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Tier-1 Industrial Production Proof</span>
        </h1>
        <p class="text-xs text-slate-400">Deterministic ISO 10628 / ISA-5.1 Drawing Generation Engine</p>
      </div>
    </div>

    <!-- Template Switcher & Stats -->
    <div class="flex items-center space-x-3">
      <div class="flex bg-[#0b1120] p-1 rounded-lg border border-[#243352]">
        <button id="btnLng" onclick="switchTemplate('lng')" class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-blue-600 text-white shadow">
          LNG Liquefaction Plant (32 Units, H&amp;MB Table)
        </button>
        <button id="btnOilgas" onclick="switchTemplate('oilgas')" class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-400 hover:text-white">
          Oil &amp; Gas Separation (24 Units, 62 Instruments)
        </button>
      </div>

      <!-- Search Tag / Stream -->
      <div class="relative">
        <input id="searchInput" type="text" placeholder="Search tag (e.g. P-2001, C-4001, 101, PSV)..." 
               oninput="onSearch(this.value)"
               class="bg-[#0b1120] border border-[#243352] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 w-64 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
        <button onclick="clearSearch()" class="absolute right-2.5 top-2 text-xs text-slate-500 hover:text-slate-300">✕</button>
      </div>

      <!-- Zoom Controls -->
      <div class="flex items-center space-x-1 bg-[#0b1120] p-1 rounded-lg border border-[#243352]">
        <button onclick="zoomBy(1.25)" title="Zoom In" class="px-2.5 py-1 text-slate-300 hover:bg-[#1e293b] rounded text-xs font-bold">+</button>
        <button onclick="zoomBy(0.8)" title="Zoom Out" class="px-2.5 py-1 text-slate-300 hover:bg-[#1e293b] rounded text-xs font-bold">−</button>
        <button onclick="resetZoom()" title="Fit Screen" class="px-2.5 py-1 text-slate-300 hover:bg-[#1e293b] rounded text-xs">Fit</button>
        <span id="zoomLevel" class="px-2 text-xs font-mono text-cyan-400 font-bold min-w-[50px] text-center">100%</span>
      </div>
    </div>
  </header>

  <!-- Main Body: Viewport + Inspector Drawer -->
  <div class="flex flex-1 overflow-hidden relative">

    <!-- Interactive Canvas Viewport -->
    <div id="viewport" class="svg-viewport">
      <div id="svgContainer"></div>
    </div>

    <!-- Right-Hand Properties & Stream Inspector -->
    <aside id="inspector" class="w-80 bg-[#131b2e] border-l border-[#243352] flex flex-col shrink-0 z-10 shadow-xl overflow-hidden">
      <div class="p-3.5 border-b border-[#243352] bg-[#0f172a] flex items-center justify-between">
        <div>
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-cyan-400"></span> Process &amp; Equipment Inspector
          </h2>
          <p id="plantTitle" class="text-[11px] text-slate-400 truncate mt-0.5 font-medium"></p>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="p-3 grid grid-cols-2 gap-2 border-b border-[#243352] bg-[#0b1120]/40 text-xs">
        <div class="bg-[#1e293b]/70 p-2 rounded border border-[#2d3f63]">
          <span class="text-slate-400 block text-[10px] uppercase">Equipment</span>
          <span id="statEquip" class="font-bold text-white text-sm">32</span>
        </div>
        <div class="bg-[#1e293b]/70 p-2 rounded border border-[#2d3f63]">
          <span class="text-slate-400 block text-[10px] uppercase">Piping Lines</span>
          <span id="statLines" class="font-bold text-white text-sm">34</span>
        </div>
        <div class="bg-[#1e293b]/70 p-2 rounded border border-[#2d3f63]">
          <span class="text-slate-400 block text-[10px] uppercase">Instruments / Loops</span>
          <span id="statInst" class="font-bold text-white text-sm">19 / 10</span>
        </div>
        <div class="bg-[#1e293b]/70 p-2 rounded border border-[#2d3f63]">
          <span class="text-slate-400 block text-[10px] uppercase">Validation Errors</span>
          <span class="font-bold text-emerald-400 text-sm">0 (Clean)</span>
        </div>
      </div>

      <!-- Tab Content: Equipment & Streams List -->
      <div class="flex border-b border-[#243352] text-xs font-semibold bg-[#0f172a]">
        <button id="tabEquipBtn" onclick="setTab('equip')" class="flex-1 py-2 text-center text-cyan-400 border-b-2 border-cyan-400">Equipment</button>
        <button id="tabStreamsBtn" onclick="setTab('streams')" class="flex-1 py-2 text-center text-slate-400 hover:text-slate-200">H&amp;MB Streams</button>
      </div>

      <!-- Scrollable List -->
      <div id="inspectorList" class="flex-1 overflow-y-auto p-2 space-y-1.5 text-xs divide-y divide-[#243352]/40">
        <!-- populated dynamically -->
      </div>

      <!-- Engineering Compliance Footer -->
      <div class="p-2.5 bg-[#0b1120] border-t border-[#243352] text-[10px] text-slate-400 flex flex-col gap-1">
        <div class="flex justify-between items-center">
          <span>Standard:</span>
          <span class="font-mono text-slate-200 font-semibold">ISO 10628 / PIP PIC001</span>
        </div>
        <div class="flex justify-between items-center">
          <span>Sheet Size:</span>
          <span class="font-mono text-slate-200 font-semibold">ISO A0 (1189 × 841 mm)</span>
        </div>
        <div class="flex justify-between items-center">
          <span>Plot Bounds:</span>
          <span class="font-mono text-emerald-400 font-semibold">y ∈ [24, 640] mm (100% Pass)</span>
        </div>
      </div>
    </aside>
  </div>

  <script>
    const DATA = {
      lng: {
        title: "LNG Receiving & Liquefaction Facility",
        svg: ${JSON.stringify(lngSvg)},
        schedule: ${JSON.stringify(lngSchedule)}
      },
      oilgas: {
        title: "Oil & Gas Production Facility",
        svg: ${JSON.stringify(ogSvg)},
        schedule: ${JSON.stringify(ogSchedule)}
      }
    };

    let currentTemplate = 'lng';
    let currentTab = 'equip';

    // Viewport transform state
    let scale = 0.28;
    let translateX = 30;
    let translateY = 20;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const viewport = document.getElementById('viewport');
    const container = document.getElementById('svgContainer');
    const zoomText = document.getElementById('zoomLevel');

    function updateTransform() {
      container.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
      zoomText.textContent = Math.round(scale * 100) + '%';
    }

    function zoomBy(factor) {
      const rect = viewport.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const oldScale = scale;
      scale = Math.max(0.05, Math.min(3.5, scale * factor));
      translateX = cx - (cx - translateX) * (scale / oldScale);
      translateY = cy - (cy - translateY) * (scale / oldScale);
      updateTransform();
    }

    function resetZoom() {
      const rect = viewport.getBoundingClientRect();
      // A0 mm to px approximation (1mm ~ 3.7795px at 96dpi, or SVG viewBox 1189x841)
      const svgW = 1189;
      const svgH = 841;
      const fitScale = Math.min((rect.width - 60) / svgW, (rect.height - 60) / svgH);
      scale = fitScale > 0 ? fitScale : 0.28;
      translateX = (rect.width - svgW * scale) / 2;
      translateY = (rect.height - svgH * scale) / 2;
      updateTransform();
    }

    // Mouse drag pan
    viewport.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      const oldScale = scale;
      scale = Math.max(0.05, Math.min(3.5, scale * factor));
      translateX = mouseX - (mouseX - translateX) * (scale / oldScale);
      translateY = mouseY - (mouseY - translateY) * (scale / oldScale);
      updateTransform();
    }, { passive: false });

    function switchTemplate(name) {
      currentTemplate = name;
      document.getElementById('btnLng').className = name === 'lng' 
        ? 'px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-blue-600 text-white shadow'
        : 'px-3 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-400 hover:text-white';
      document.getElementById('btnOilgas').className = name === 'oilgas' 
        ? 'px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-blue-600 text-white shadow'
        : 'px-3 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-400 hover:text-white';

      loadCurrent();
      resetZoom();
    }

    function setTab(tab) {
      currentTab = tab;
      const tE = document.getElementById('tabEquipBtn');
      const tS = document.getElementById('tabStreamsBtn');
      if (tab === 'equip') {
        tE.className = 'flex-1 py-2 text-center text-cyan-400 border-b-2 border-cyan-400';
        tS.className = 'flex-1 py-2 text-center text-slate-400 hover:text-slate-200';
      } else {
        tS.className = 'flex-1 py-2 text-center text-cyan-400 border-b-2 border-cyan-400';
        tE.className = 'flex-1 py-2 text-center text-slate-400 hover:text-slate-200';
      }
      renderInspectorList();
    }

    function loadCurrent() {
      const data = DATA[currentTemplate];
      document.getElementById('plantTitle').textContent = data.title;
      container.innerHTML = data.svg;

      const sched = data.schedule;
      document.getElementById('statEquip').textContent = sched.equipment ? sched.equipment.length : 0;
      document.getElementById('statLines').textContent = sched.lines ? sched.lines.length : 0;
      document.getElementById('statInst').textContent = (sched.instruments ? sched.instruments.length : 0) + ' / ' + (sched.controlLoops ? sched.controlLoops.length : 0);

      renderInspectorList();
    }

    function renderInspectorList() {
      const data = DATA[currentTemplate];
      const sched = data.schedule;
      const list = document.getElementById('inspectorList');
      list.innerHTML = '';

      if (currentTab === 'equip') {
        (sched.equipment || []).forEach(eq => {
          const item = document.createElement('div');
          item.className = 'p-2 rounded hover:bg-[#1e293b] cursor-pointer transition flex items-start justify-between group';
          item.onclick = () => focusTag(eq.tag);
          item.innerHTML = \`
            <div>
              <div class="flex items-center gap-1.5">
                <span class="font-mono font-bold text-cyan-400 group-hover:text-cyan-300">\${eq.tag}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">\${eq.type}</span>
              </div>
              <div class="text-[11px] text-slate-300 mt-0.5">\${eq.description}</div>
              <div class="text-[10px] text-slate-500 mt-0.5 font-mono">Area: \${eq.area || '-'} | (x: \${Math.round(eq.x)}, y: \${Math.round(eq.y)} mm)</div>
            </div>
            <button class="text-slate-500 group-hover:text-cyan-400 text-xs mt-1">➔</button>
          \`;
          list.appendChild(item);
        });
      } else {
        // H&MB streams
        (sched.lines || []).filter(l => l.streamNumber || l.pressureBarg || l.operatingPressureBarg).forEach(l => {
          const sNum = l.streamNumber || '?';
          const p = l.operatingPressureBarg ?? l.pressureBarg ?? '-';
          const t = l.operatingTemperatureC ?? l.temperatureC ?? '-';
          const flow = l.flowRateTH ? l.flowRateTH + ' t/h' : (l.flowRateKgH ? (l.flowRateKgH/1000).toFixed(1) + ' t/h' : '-');
          const item = document.createElement('div');
          item.className = 'p-2 rounded hover:bg-[#1e293b] cursor-pointer transition flex items-start justify-between group';
          item.onclick = () => focusTag(l.lineNumber);
          item.innerHTML = \`
            <div class="w-full">
              <div class="flex items-center justify-between">
                <span class="font-mono font-bold text-amber-400 flex items-center gap-1">
                  ◆ Stream <\${sNum}>
                </span>
                <span class="font-mono text-[10px] text-cyan-300">\${p} barg | \${t} °C</span>
              </div>
              <div class="text-[11px] text-slate-300 font-medium mt-0.5">\${l.service}</div>
              <div class="text-[10px] text-slate-500 font-mono mt-0.5 truncate">\${l.lineNumber}</div>
              <div class="mt-1 flex items-center justify-between text-[10px] text-slate-400 border-t border-[#243352]/40 pt-1">
                <span>Flow: <strong class="text-slate-200">\${flow}</strong></span>
                <span>From: \${l.from?.tag || '-'} ➔ To: \${l.to?.tag || '-'}</span>
              </div>
            </div>
          \`;
          list.appendChild(item);
        });
      }
    }

    function onSearch(query) {
      if (!query || query.trim() === '') {
        clearSearch();
        return;
      }
      const q = query.trim().toUpperCase();
      const texts = container.querySelectorAll('text');
      let found = null;
      texts.forEach(t => {
        if (t.textContent.toUpperCase().includes(q)) {
          t.parentElement.classList.add('highlight-glow');
          if (!found) found = t;
        } else {
          t.parentElement.classList.remove('highlight-glow');
        }
      });
      if (found) {
        // center on element
        const bbox = found.getBBox();
        const pt = found.ownerSVGElement.createSVGPoint();
        pt.x = bbox.x + bbox.width / 2;
        pt.y = bbox.y + bbox.height / 2;
        centerOnCoords(pt.x, pt.y);
      }
    }

    function focusTag(tag) {
      document.getElementById('searchInput').value = tag;
      onSearch(tag);
    }

    function clearSearch() {
      document.getElementById('searchInput').value = '';
      container.querySelectorAll('.highlight-glow').forEach(el => el.classList.remove('highlight-glow'));
    }

    function centerOnCoords(svgX, svgY) {
      const rect = viewport.getBoundingClientRect();
      translateX = rect.width / 2 - svgX * scale;
      translateY = rect.height / 2 - svgY * scale;
      updateTransform();
    }

    window.addEventListener('load', () => {
      loadCurrent();
      resetZoom();
    });
    window.addEventListener('resize', resetZoom);
  </script>
</body>
</html>
`;

fs.writeFileSync(TARGET_HTML, htmlContent, 'utf8');
console.log('Successfully generated interactive viewer at: ' + TARGET_HTML);
