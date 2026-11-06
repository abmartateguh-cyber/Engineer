/**
 * OmniEng Diagnostics Console (Stage 2 item 2).
 *
 * Collapsible multi-tab console view: System Log, Solver Telemetry, V&V
 * Evidence, and OmniAI Assistant. DOM-built only (no innerHTML), namespaced
 * `.diagconsole-*` classes, deterministic (no Math.random). Reads live data
 * through the existing `omniEngAPI` IPC surface where available; otherwise it
 * reports honestly that no active session exists.
 */
'use strict';

(function attachDiagnosticsConsoleView(global) {
  const TABS = Object.freeze([
    { key: 'system-log', label: 'System Log' },
    { key: 'solver-telemetry', label: 'Solver Telemetry' },
    { key: 'vv-evidence', label: 'V&V Evidence' },
    { key: 'omniai-assistant', label: 'OmniAI Assistant' }
  ]);

  const MAX_LOG_LINES = 200;
  const PRE = 'diagconsole';
  const cls = (name) => `${PRE}-${name}`;

  function createElement(documentRef, tag, className, text) {
    const el = documentRef.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function setStyles(el, styles) {
    for (const [property, value] of Object.entries(styles)) {
      el.style[property] = value;
    }
  }

  function formatTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function createKeyValueRow(documentRef, label, value) {
    const row = createElement(documentRef, 'div', cls('row'));
    const labelEl = createElement(documentRef, 'span', cls('row-label'), label);
    const valueEl = createElement(documentRef, 'span', cls('row-value'), value);
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  function showPlaceholder(documentRef, container, text) {
    container.replaceChildren();
    container.appendChild(createElement(documentRef, 'div', cls('placeholder'), text));
  }

  let activeSession = null;

  function appendLog(source, message, level) {
    if (!activeSession) return { success: false, error: 'Diagnostics console is not mounted.' };
    activeSession.logLine(source, message, level);
    return { success: true };
  }

  function mount(documentRef, root, api, options = {}) {
    if (!root || !documentRef?.createElement) {
      return { success: false, error: 'Diagnostics console root unavailable.' };
    }

    const session = {
      buffers: [],
      activeTab: TABS[0].key,
      collapsed: false,
      refreshing: false,
      logLine(source, message, level) {
        const entry = {
          time: formatTime(new Date()),
          source: String(source),
          message: String(message),
          level: level || 'info'
        };
        this.buffers.push(entry);
        if (this.buffers.length > MAX_LOG_LINES) this.buffers.shift();

        const line = createElement(documentRef, 'div', `${cls('log-line')} ${cls(`level-${entry.level}`)}`);
        const timeEl = createElement(documentRef, 'span', cls('log-time'), entry.time);
        const sourceEl = createElement(documentRef, 'span', cls('log-source'), entry.source);
        const messageEl = createElement(documentRef, 'span', cls('log-message'), entry.message);
        line.appendChild(timeEl);
        line.appendChild(sourceEl);
        line.appendChild(messageEl);
        logView.appendChild(line);
        logView.scrollTop = logView.scrollHeight;
      }
    };

    const view = createElement(documentRef, 'section', cls('view'));
    setStyles(view, {
      background: 'var(--surface-2, #0f172a)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '6px',
      margin: '8px',
      fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
      fontSize: '11px',
      color: 'var(--fg-1, #e2e8f0)',
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '50vh',
      overflow: 'hidden'
    });

    const header = createElement(documentRef, 'div', cls('header'));
    setStyles(header, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      borderBottom: '1px solid var(--line, #334155)',
      flexShrink: '0'
    });
    const collapseBtn = createElement(documentRef, 'button', cls('collapse-btn'), '▾');
    collapseBtn.type = 'button';
    collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.title = 'Collapse Diagnostics Console';
    setStyles(collapseBtn, {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: '12px',
      padding: '0 2px'
    });
    const title = createElement(documentRef, 'span', cls('title'), 'Diagnostics Console');
    setStyles(title, { fontWeight: '600', letterSpacing: '0.5px' });
    const statusDot = createElement(documentRef, 'span', cls('status-dot'));
    statusDot.setAttribute('role', 'status');
    setStyles(statusDot, {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: 'var(--accent, #38bdf8)',
      marginLeft: 'auto'
    });
    header.appendChild(collapseBtn);
    header.appendChild(title);
    header.appendChild(statusDot);
    view.appendChild(header);

    const tabBar = createElement(documentRef, 'div', cls('tabbar'));
    tabBar.setAttribute('role', 'tablist');
    setStyles(tabBar, {
      display: 'flex',
      gap: '4px',
      padding: '4px 8px',
      borderBottom: '1px solid var(--line, #334155)',
      flexShrink: '0'
    });

    const tabButtons = [];
    const panels = new Map();
    const tabData = new Map();

    for (const tab of TABS) {
      const button = createElement(documentRef, 'button', cls('tab'), tab.label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.key === session.activeTab));
      button.dataset.diagconsoleTab = tab.key;
      setStyles(button, {
        background: tab.key === session.activeTab ? 'var(--surface-3, #1e293b)' : 'transparent',
        border: '1px solid var(--line, #334155)',
        borderRadius: '4px',
        color: 'inherit',
        cursor: 'pointer',
        padding: '3px 10px',
        fontSize: '11px'
      });
      button.classList.toggle('is-active', tab.key === session.activeTab);
      tabBar.appendChild(button);
      tabButtons.push(button);
      tabData.set(tab.key, tab);

      const panel = createElement(documentRef, 'div', cls('panel'));
      panel.dataset.diagconsolePanel = tab.key;
      panel.setAttribute('role', 'tabpanel');
      setStyles(panel, {
        display: tab.key === session.activeTab ? 'flex' : 'none',
        flexDirection: 'column',
        minHeight: '0',
        flex: '1',
        overflow: 'hidden'
      });
      panel.classList.toggle('is-active', tab.key === session.activeTab);
      panels.set(tab.key, panel);
      view.appendChild(panel);
    }
    view.appendChild(tabBar);
    // Tab bar is visually above panels; move it before the first panel.
    view.insertBefore(tabBar, panels.get(TABS[0].key));

    // --- System Log panel ---
    const logPanel = panels.get('system-log');
    const logToolbar = createElement(documentRef, 'div', cls('toolbar'));
    setStyles(logToolbar, {
      display: 'flex',
      justifyContent: 'flex-end',
      padding: '4px 8px',
      gap: '6px',
      flexShrink: '0'
    });
    const clearLogBtn = createElement(documentRef, 'button', cls('tool-btn'), 'Clear Log');
    clearLogBtn.type = 'button';
    setStyles(clearLogBtn, {
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '10px'
    });
    logToolbar.appendChild(clearLogBtn);
    const logView = createElement(documentRef, 'div', cls('logview'));
    setStyles(logView, {
      overflowY: 'auto',
      flex: '1',
      minHeight: '0',
      padding: '6px 10px',
      lineHeight: '1.5'
    });
    logPanel.appendChild(logToolbar);
    logPanel.appendChild(logView);

    clearLogBtn.addEventListener('click', () => {
      session.buffers.length = 0;
      logView.replaceChildren();
      session.logLine('system', 'System log cleared.', 'info');
    });

    // --- Solver Telemetry panel ---
    const telemetryPanel = panels.get('solver-telemetry');
    const telemetryToolbar = createElement(documentRef, 'div', cls('toolbar'));
    setStyles(telemetryToolbar, {
      display: 'flex',
      justifyContent: 'flex-end',
      padding: '4px 8px',
      gap: '6px',
      flexShrink: '0'
    });
    const telemetryRefreshBtn = createElement(documentRef, 'button', cls('tool-btn'), 'Refresh');
    telemetryRefreshBtn.type = 'button';
    setStyles(telemetryRefreshBtn, {
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '10px'
    });
    telemetryToolbar.appendChild(telemetryRefreshBtn);
    const telemetryBody = createElement(documentRef, 'div', cls('telemetry'));
    setStyles(telemetryBody, {
      overflowY: 'auto',
      flex: '1',
      minHeight: '0',
      padding: '6px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    });
    telemetryPanel.appendChild(telemetryToolbar);
    telemetryPanel.appendChild(telemetryBody);

    function refreshTelemetry() {
      if (session.refreshing) return;
      session.refreshing = true;
      try {
        if (!api || (typeof api.getComputeTelemetry !== 'function' && typeof api.getClusterStatus !== 'function')) {
          showPlaceholder(
            documentRef,
            telemetryBody,
            'No active solver session. IPC telemetry routes are unavailable.'
          );
          session.logLine('solver-telemetry', 'No active solver session; telemetry routes unavailable.', 'warn');
          return;
        }
        telemetryBody.replaceChildren();
        telemetryBody.appendChild(createElement(documentRef, 'div', cls('panel-title'), 'Live solver telemetry'));

        if (typeof api.getComputeTelemetry === 'function') {
          api
            .getComputeTelemetry()
            .then((response) => {
              const t = response?.telemetry;
              if (!t || !response || response.success !== true) {
                telemetryBody.appendChild(createKeyValueRow(documentRef, 'Compute host', 'no telemetry'));
                return;
              }
              telemetryBody.appendChild(
                createKeyValueRow(documentRef, 'Execution mode', String(t.executionMode ?? 'unavailable'))
              );
              telemetryBody.appendChild(createKeyValueRow(documentRef, 'Running jobs', String(t.runningCount ?? 0)));
              telemetryBody.appendChild(createKeyValueRow(documentRef, 'Queued jobs', String(t.queuedCount ?? 0)));
              telemetryBody.appendChild(createKeyValueRow(documentRef, 'Active jobs', String(t.activeCount ?? 0)));
              telemetryBody.appendChild(
                createKeyValueRow(documentRef, 'Heap used', `${t.heapUsedMb ?? 'unavailable'} MB`)
              );
              session.logLine('solver-telemetry', 'Compute host telemetry refreshed.', 'info');
            })
            .catch(() => {
              telemetryBody.appendChild(createKeyValueRow(documentRef, 'Compute host', 'query failed'));
            });
        }

        if (typeof api.getClusterStatus === 'function') {
          api
            .getClusterStatus()
            .then((response) => {
              if (!response || response.success !== true || response.configured !== true) {
                telemetryBody.appendChild(createKeyValueRow(documentRef, 'HPC cluster', 'no active session'));
                session.logLine('solver-telemetry', 'HPC cluster: no active session.', 'warn');
                return;
              }
              telemetryBody.appendChild(
                createKeyValueRow(
                  documentRef,
                  'HPC provider',
                  String(response.provider ?? response.status ?? 'configured')
                )
              );
              telemetryBody.appendChild(
                createKeyValueRow(documentRef, 'Scheduler', String(response.scheduler ?? 'unavailable'))
              );
              telemetryBody.appendChild(
                createKeyValueRow(documentRef, 'Cluster status', String(response.status ?? 'unknown'))
              );
              const jobs = response.telemetry?.jobs;
              if (jobs) {
                telemetryBody.appendChild(createKeyValueRow(documentRef, 'Job total', String(jobs.total ?? 0)));
              }
              session.logLine('solver-telemetry', 'HPC cluster telemetry refreshed.', 'info');
            })
            .catch(() => {
              telemetryBody.appendChild(createKeyValueRow(documentRef, 'HPC cluster', 'query failed'));
            });
        }
      } finally {
        session.refreshing = false;
      }
    }

    telemetryRefreshBtn.addEventListener('click', () => {
      refreshTelemetry();
      session.logLine('solver-telemetry', 'Manual telemetry refresh requested.', 'info');
    });

    // --- V&V Evidence panel ---
    const evidencePanel = panels.get('vv-evidence');
    const evidenceToolbar = createElement(documentRef, 'div', cls('toolbar'));
    setStyles(evidenceToolbar, {
      display: 'flex',
      justifyContent: 'flex-end',
      padding: '4px 8px',
      gap: '6px',
      flexShrink: '0'
    });
    const evidenceRefreshBtn = createElement(documentRef, 'button', cls('tool-btn'), 'Refresh');
    evidenceRefreshBtn.type = 'button';
    setStyles(evidenceRefreshBtn, {
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '10px'
    });
    evidenceToolbar.appendChild(evidenceRefreshBtn);
    const evidenceBody = createElement(documentRef, 'div', cls('evidence'));
    setStyles(evidenceBody, {
      overflowY: 'auto',
      flex: '1',
      minHeight: '0',
      padding: '6px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    });
    evidencePanel.appendChild(evidenceToolbar);
    evidencePanel.appendChild(evidenceBody);

    function refreshEvidence() {
      if (session.refreshing) return;
      session.refreshing = true;
      try {
        const hasMaturity = typeof api?.getFeatureMaturity === 'function';
        const hasLedger =
          typeof api?.verifyLedger === 'function' || typeof api?.stenographerVerifyLedger === 'function';
        const hasBenchmarks = typeof api?.runVVBenchmarks === 'function';
        if (!api || (!hasMaturity && !hasLedger && !hasBenchmarks)) {
          showPlaceholder(documentRef, evidenceBody, 'No V&V evidence session. Verification routes are unavailable.');
          session.logLine('vv-evidence', 'No V&V evidence session; verification routes unavailable.', 'warn');
          return;
        }
        evidenceBody.replaceChildren();
        evidenceBody.appendChild(
          createElement(documentRef, 'div', cls('panel-title'), 'Verification & validation evidence')
        );

        if (hasMaturity) {
          api
            .getFeatureMaturity()
            .then((response) => {
              const domains = response?.domains;
              if (!response || response.success !== true || !domains || typeof domains !== 'object') {
                evidenceBody.appendChild(createKeyValueRow(documentRef, 'Feature maturity', 'unavailable'));
                return;
              }
              const counts = {};
              for (const entry of Object.values(domains)) {
                const state = typeof entry?.state === 'string' ? entry.state : 'experimental';
                counts[state] = (counts[state] || 0) + 1;
              }
              const summary = Object.entries(counts)
                .map(([state, count]) => `${count} ${state}`)
                .join(' · ');
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Feature maturity', summary || 'experimental'));
            })
            .catch(() => {
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Feature maturity', 'query failed'));
            });
        }

        if (hasLedger) {
          const verifyFn = api.verifyLedger || api.stenographerVerifyLedger;
          verifyFn()
            .then((response) => {
              if (!response || response.success !== true) {
                evidenceBody.appendChild(createKeyValueRow(documentRef, 'Evidence ledger', 'verification unavailable'));
                return;
              }
              const integrity = response.integrity || response.ledgerIntegrity || {};
              const state = integrity.valid === true ? 'valid' : integrity.status || 'verified';
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Evidence ledger', state));
            })
            .catch(() => {
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Evidence ledger', 'query failed'));
            });
        }

        if (hasBenchmarks) {
          api
            .runVVBenchmarks()
            .then((response) => {
              if (!response || response.success !== true) {
                evidenceBody.appendChild(
                  createKeyValueRow(
                    documentRef,
                    'Released benchmark suite',
                    response?.error?.message || 'not configured'
                  )
                );
                return;
              }
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Released benchmark suite', 'passed'));
            })
            .catch(() => {
              evidenceBody.appendChild(createKeyValueRow(documentRef, 'Released benchmark suite', 'query failed'));
            });
        }
      } finally {
        session.refreshing = false;
      }
    }

    evidenceRefreshBtn.addEventListener('click', () => {
      refreshEvidence();
      session.logLine('vv-evidence', 'Manual evidence refresh requested.', 'info');
    });

    // --- OmniAI Assistant panel ---
    const assistantPanel = panels.get('omniai-assistant');
    const assistantBody = createElement(documentRef, 'div', cls('assistant'));
    setStyles(assistantBody, {
      overflowY: 'auto',
      flex: '1',
      minHeight: '0',
      padding: '6px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    });
    const composer = createElement(documentRef, 'div', cls('composer'));
    setStyles(composer, {
      display: 'flex',
      gap: '6px',
      padding: '6px 8px',
      borderTop: '1px solid var(--line, #334155)',
      flexShrink: '0'
    });
    const promptInput = createElement(documentRef, 'input', cls('prompt-input'));
    promptInput.type = 'text';
    promptInput.placeholder = 'Prompt OmniAI (legacy macro route)...';
    setStyles(promptInput, {
      flex: '1',
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      padding: '3px 8px',
      fontSize: '11px'
    });
    const sendBtn = createElement(documentRef, 'button', cls('send-btn'), 'Send');
    sendBtn.type = 'button';
    setStyles(sendBtn, {
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      cursor: 'pointer',
      padding: '3px 12px',
      fontSize: '11px'
    });
    const assistantClearBtn = createElement(documentRef, 'button', cls('tool-btn'), 'Clear');
    assistantClearBtn.type = 'button';
    setStyles(assistantClearBtn, {
      background: 'var(--surface-3, #1e293b)',
      border: '1px solid var(--line, #334155)',
      borderRadius: '4px',
      color: 'inherit',
      cursor: 'pointer',
      padding: '3px 8px',
      fontSize: '10px'
    });
    composer.appendChild(promptInput);
    composer.appendChild(sendBtn);
    composer.appendChild(assistantClearBtn);
    assistantPanel.appendChild(assistantBody);
    assistantPanel.appendChild(composer);

    const assistantAvailable = typeof api?.processAIPrompt === 'function';
    if (!assistantAvailable) {
      showPlaceholder(
        documentRef,
        assistantBody,
        'No OmniAI session. The assistant route is unavailable in this build.'
      );
      promptInput.disabled = true;
      sendBtn.disabled = true;
    }

    function appendAssistantTurn(role, text) {
      const bubble = createElement(documentRef, 'div', `${cls('chat-line')} ${cls(`role-${role}`)}`);
      const roleEl = createElement(documentRef, 'span', cls('chat-role'), role === 'user' ? 'you' : 'omniai');
      const textEl = createElement(documentRef, 'span', cls('chat-text'), text);
      bubble.appendChild(roleEl);
      bubble.appendChild(textEl);
      assistantBody.appendChild(bubble);
      assistantBody.scrollTop = assistantBody.scrollHeight;
    }

    function sendPrompt() {
      const promptText = promptInput.value.trim();
      if (!promptText || !assistantAvailable) return;
      appendAssistantTurn('user', promptText);
      promptInput.value = '';
      sendBtn.disabled = true;
      api
        .processAIPrompt(promptText, { source: 'diagnostics-console' })
        .then((response) => {
          const message =
            response?.assistantMessage ||
            response?.status ||
            (response?.success === false ? response?.error?.message : '');
          appendAssistantTurn('assistant', message || 'No assistant response was produced.');
          session.logLine('omniai-assistant', 'OmniAI responded to prompt.', 'info');
        })
        .catch(() => {
          appendAssistantTurn('assistant', 'Assistant request failed; check the renderer console.');
          session.logLine('omniai-assistant', 'OmniAI request failed.', 'error');
        })
        .finally(() => {
          sendBtn.disabled = false;
        });
    }

    sendBtn.addEventListener('click', sendPrompt);
    promptInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendPrompt();
    });
    assistantClearBtn.addEventListener('click', () => {
      assistantBody.replaceChildren();
      session.logLine('omniai-assistant', 'Assistant history cleared.', 'info');
    });

    // --- Tab switching ---
    function switchTab(key) {
      if (!tabData.has(key)) return;
      session.activeTab = key;
      for (const button of tabButtons) {
        const isActive = button.dataset.diagconsoleTab === key;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        setStyles(button, { background: isActive ? 'var(--surface-3, #1e293b)' : 'transparent' });
      }
      for (const [panelKey, panel] of panels.entries()) {
        const isActive = panelKey === key;
        panel.classList.toggle('is-active', isActive);
        panel.style.display = isActive ? 'flex' : 'none';
      }
      if (key === 'solver-telemetry') refreshTelemetry();
      if (key === 'vv-evidence') refreshEvidence();
      session.logLine('system', `Switched to ${tabData.get(key).label} tab.`, 'info');
    }

    for (const button of tabButtons) {
      button.addEventListener('click', () => switchTab(button.dataset.diagconsoleTab));
    }

    // --- Collapse / expand ---
    function toggleCollapsed() {
      session.collapsed = !session.collapsed;
      view.classList.toggle('is-collapsed', session.collapsed);
      collapseBtn.textContent = session.collapsed ? '▸' : '▾';
      collapseBtn.setAttribute('aria-expanded', String(!session.collapsed));
      collapseBtn.title = session.collapsed ? 'Expand Diagnostics Console' : 'Collapse Diagnostics Console';
      tabBar.style.display = session.collapsed ? 'none' : 'flex';
      for (const panel of panels.values()) {
        if (!session.collapsed) {
          panel.style.display = panel.dataset.diagconsolePanel === session.activeTab ? 'flex' : 'none';
        } else {
          panel.style.display = 'none';
        }
      }
      session.logLine(
        'system',
        session.collapsed ? 'Diagnostics Console collapsed.' : 'Diagnostics Console expanded.',
        'info'
      );
    }

    collapseBtn.addEventListener('click', toggleCollapsed);

    // --- Global renderer error capture (System Log) ---
    if (options.attachGlobalListeners !== false && typeof global.addEventListener === 'function') {
      global.addEventListener('error', (event) => {
        session.logLine('renderer', event.message || 'Renderer runtime error', 'error');
      });
      global.addEventListener('unhandledrejection', (event) => {
        session.logLine('renderer', `Unhandled rejection: ${String(event.reason ?? '')}`, 'error');
      });
    }

    root.replaceChildren(view);
    activeSession = session;
    session.logLine('system', 'Diagnostics Console initialized.', 'info');

    if (typeof api?.getComputeTelemetry === 'function') {
      refreshTelemetry();
    }

    return {
      success: true,
      tabs: TABS.map((tab) => tab.key),
      activeTab: session.activeTab
    };
  }

  const api = Object.freeze({
    TABS,
    appendLog,
    mount
  });

  if (global) global.OmniDiagnosticsConsoleView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
