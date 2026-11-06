const assert = require('assert');
const { PIDEngine } = require('../src/core/plant/pid_engine');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTag(item, fallbackKey) {
  return item && (item.tag ?? item[fallbackKey]) != null ? String(item.tag ?? item[fallbackKey]) : null;
}

function getLineNumber(line) {
  const value = line.lineNumber ?? line.number ?? line.tag;
  return value != null ? String(value) : null;
}

function getNozzleName(nozzle) {
  if (nozzle == null) return null;
  if (typeof nozzle === 'string') return nozzle.trim();
  const name = nozzle.name ?? nozzle.id ?? nozzle.n;
  return name != null ? String(name) : null;
}

function buildEquipmentMap(equipment) {
  const map = new Map();
  for (const entry of equipment) {
    const tag = getTag(entry, 'id');
    if (tag !== null) map.set(tag.toUpperCase(), entry);
  }
  return map;
}

function equipmentHasNozzle(equipment, nozzleName) {
  const target = getNozzleName(nozzleName);
  if (target === null || target === '') return false;
  if (!Array.isArray(equipment.nozzles)) return false;
  return equipment.nozzles.some((n) => {
    const name = getNozzleName(n);
    return name !== null && name.toUpperCase() === target.toUpperCase();
  });
}

function assertSvgWellFormed(svg) {
  assert.strictEqual(typeof svg, 'string');
  const printable = svg.replace(/("[^"]*"|'[^']*')/g, '"x"');
  const stack = [];
  let rootTag = null;
  const tagPattern =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)((?:\s[^<>]*?)?)\s*(\/?)>/g;
  let match;
  while ((match = tagPattern.exec(printable)) !== null) {
    const token = match[0];
    if (
      token.startsWith('<!--') ||
      token.startsWith('<![CDATA[') ||
      token.startsWith('<?') ||
      /^<!DOCTYPE/i.test(token)
    ) {
      continue;
    }
    const closing = match[1] === '/';
    const name = match[2];
    const selfClosing = match[4] === '/';
    if (closing) {
      assert(stack.length > 0, `found </${name}> with no matching open tag`);
      const expected = stack.pop();
      assert.strictEqual(expected, name, `mismatched closing tag </${name}>; expected </${expected}>`);
      continue;
    }
    if (selfClosing) continue;
    stack.push(name);
    if (rootTag === null) rootTag = name;
  }
  assert.deepStrictEqual(stack, [], `unclosed SVG tags: ${stack.join(', ')}`);
  assert.strictEqual(rootTag, 'svg', `root SVG element must be <svg>, got <${rootTag}>`);
}

function runPIDEngineTests() {
  let total = 0;
  let passed = 0;
  let failed = 0;
  const run = (name, callback) => {
    total++;
    try {
      callback();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
    }
  };

  const template = PIDEngine.oilGasProductionTemplate();
  const engine = new PIDEngine();
  const result = engine.createPID(template);
  const schedule = result.schedule;

  run('createPID(template) returns a single A0 SVG sheet with clean validation', () => {
    assert.strictEqual(result.success, true);
    assert(Array.isArray(result.sheets));
    assert.strictEqual(result.sheets.length, 1);
    const sheet = result.sheets[0];
    assert.strictEqual(sheet.sheetNumber, 1);
    assert.strictEqual(typeof sheet.svg, 'string');
    assert(sheet.svg.trimStart().startsWith('<svg'));
    assert(sheet.svg.trimEnd().endsWith('</svg>'));
    assert.strictEqual(sheet.widthMm, 1189);
    assert.strictEqual(sheet.heightMm, 841);
    assert(Array.isArray(result.validation.errors));
    assert.strictEqual(result.validation.errors.length, 0);
  });

  run('Generated schedule meets minimum category completeness thresholds', () => {
    assert(schedule.equipment.length >= 20, `equipment count ${schedule.equipment.length} < 20`);
    assert(schedule.lines.length >= 25, `line count ${schedule.lines.length} < 25`);
    assert(schedule.instruments.length >= 30, `instrument count ${schedule.instruments.length} < 30`);
    assert(schedule.valves.length >= 10, `valve count ${schedule.valves.length} < 10`);
    assert(schedule.controlLoops.length >= 5, `control loop count ${schedule.controlLoops.length} < 5`);
  });

  run('Tags are unique within each schedule category', () => {
    const assertUnique = (items, keyOf, label) => {
      const seen = new Set();
      for (const item of items) {
        const tag = keyOf(item);
        assert(tag !== null && tag !== '', `${label} entry missing tag`);
        assert(!seen.has(tag), `duplicate ${label} tag: ${tag}`);
        seen.add(tag);
      }
    };
    assertUnique(schedule.equipment, (e) => getTag(e, 'id'), 'equipment');
    assertUnique(schedule.instruments, (i) => getTag(i, 'id'), 'instrument');
    assertUnique(schedule.valves, (v) => getTag(v, 'id'), 'valve');
    assertUnique(schedule.lines, getLineNumber, 'line number');
  });

  run('Line endpoints reference existing equipment tags and nozzles', () => {
    const equipmentMap = buildEquipmentMap(schedule.equipment);
    for (const line of schedule.lines) {
      const number = getLineNumber(line);
      for (const side of ['from', 'to']) {
        const endpoint = line[side];
        assert(endpoint && endpoint.tag, `line ${number} missing ${side} tag`);
        const equipment = equipmentMap.get(String(endpoint.tag).toUpperCase());
        assert(equipment, `line ${number} ${side} references unknown equipment ${endpoint.tag}`);
        assert(
          equipmentHasNozzle(equipment, endpoint.nozzle ?? endpoint.nozzleName),
          `line ${number} ${side} references unknown nozzle ${endpoint.nozzle ?? endpoint.nozzleName} on ${endpoint.tag}`
        );
      }
    }
  });

  run('Instrument connections and control-loop references resolve to existing tags', () => {
    const knownTags = new Set();
    for (const entry of schedule.equipment) knownTags.add(getTag(entry, 'id').toUpperCase());
    for (const entry of schedule.instruments) knownTags.add(getTag(entry, 'id').toUpperCase());
    for (const entry of schedule.valves) knownTags.add(getTag(entry, 'id').toUpperCase());
    for (const loop of schedule.controlLoops) {
      const id = loop.tag ?? loop.id ?? loop.loopId;
      if (id != null) knownTags.add(String(id).toUpperCase());
    }
    for (const instrument of schedule.instruments) {
      const connected = instrument.connectedTo;
      if (connected == null || connected === '') continue;
      const target = typeof connected === 'string' ? connected : (connected.tag ?? connected.id);
      assert(target != null && target !== '', `instrument ${getTag(instrument, 'id')} has an empty connectedTo`);
      assert(
        knownTags.has(String(target).toUpperCase()),
        `instrument ${getTag(instrument, 'id')} connected to unknown tag ${target}`
      );
    }
    const loopRef = (loop, key) => {
      const value = loop[key];
      if (value == null) return null;
      return typeof value === 'string' ? value : (value.tag ?? value.id ?? null);
    };
    for (const loop of schedule.controlLoops) {
      const label = loop.tag ?? loop.id ?? loop.loopId ?? 'control loop';
      for (const key of ['sensor', 'controller', 'finalElement']) {
        const ref = loopRef(loop, key);
        assert(ref !== null && ref !== '', `${label} missing ${key} reference`);
        assert(knownTags.has(String(ref).toUpperCase()), `${label} ${key} reference ${ref} is not a known tag`);
      }
    }
  });

  run('PSV relief valves carry finite positive set pressures', () => {
    const psvs = schedule.valves.filter((v) => /psv/i.test(v.type || '') || /^psv/i.test(v.tag || ''));
    assert(psvs.length > 0, 'schedule must contain at least one PSV valve');
    for (const valve of psvs) {
      assert(Number.isFinite(valve.setPressureBarg), `PSV ${valve.tag} missing finite setPressureBarg`);
      assert(valve.setPressureBarg > 0, `PSV ${valve.tag} setPressureBarg must be positive`);
    }
  });

  run('Duplicate equipment tag is rejected with a duplicate validation error', () => {
    const broken = deepClone(template);
    broken.areas[0].equipment.push({ ...broken.areas[0].equipment[0] });
    const res = engine.createPID(broken);
    assert.strictEqual(res.success, false);
    assert(Array.isArray(res.validation.errors));
    assert(
      res.validation.errors.some((e) => /duplicate/i.test(String(e.message ?? e))),
      'expected a duplicate-related validation error'
    );
  });

  run('A dangling line endpoint tag fails validation', () => {
    const broken = deepClone(template);
    broken.lines[0].from.tag = 'NO-SUCH-TAG';
    const res = engine.createPID(broken);
    assert.strictEqual(res.success, false);
  });

  run('vectorizeSchedule returns header and data rows for all five categories', () => {
    const csv = engine.vectorizeSchedule(schedule);
    for (const key of ['equipment', 'lines', 'instruments', 'valves', 'controlLoops']) {
      assert(Object.prototype.hasOwnProperty.call(csv, key), `missing ${key} column`);
      assert.strictEqual(typeof csv[key], 'string', `${key} column must be a CSV string`);
      const rows = csv[key].trim().split(/\r?\n/);
      assert(rows.length >= 2, `${key} CSV must include a header row and at least one data row`);
      assert(rows[0].includes(','), `${key} CSV header row must contain commas`);
    }
  });

  run('createPID is deterministic for identical input', () => {
    const again = engine.createPID(template);
    assert(again.success, 'second createPID call failed');
    assert.strictEqual(again.sheets[0].svg, result.sheets[0].svg);
  });

  run('All generated line numbers match the documented format', () => {
    const lineNumberRe = /^[A-Z]{1,3}-\d{3,5}-\d{1,2}-[A-Z]{2}-\d{3}(-[A-Z0-9]+)?$/;
    for (const line of schedule.lines) {
      const number = getLineNumber(line);
      assert(number !== null, 'line entry missing line number');
      assert(lineNumberRe.test(number), `line number ${number} does not match the documented format`);
    }
  });

  run('SVG output is well-formed with balanced tags rooted at svg', () => {
    assertSvgWellFormed(result.sheets[0].svg);
  });

  run('All equipment in oilgas template is positioned within A0 plot bounds', () => {
    for (const eq of schedule.equipment) {
      assert(eq.y >= 24 && eq.y <= 640, `equipment ${eq.tag} y=${eq.y} is outside plot bounds [24, 640]`);
    }
  });

  run('Pumps and compressors are present in oilgas schedule and rendered on-sheet', () => {
    const pump = schedule.equipment.find((e) => e.type === 'pump');
    const comp = schedule.equipment.find((e) => e.type === 'compressor');
    assert(pump, 'oilgas schedule missing pump');
    assert(comp, 'oilgas schedule missing compressor');
    assert(pump.y >= 24 && pump.y <= 640, `pump ${pump.tag} y=${pump.y} is off sheet`);
    assert(comp.y >= 24 && comp.y <= 640, `compressor ${comp.tag} y=${comp.y} is off sheet`);
    assert(result.sheets[0].svg.includes(pump.tag), `SVG missing pump tag ${pump.tag}`);
    assert(result.sheets[0].svg.includes(comp.tag), `SVG missing compressor tag ${comp.tag}`);
  });

  run('LNG plant template creates valid P&ID with visible pumps, compressors, and H&MB table', () => {
    const lngTemplate = PIDEngine.lngPlantTemplate();
    const lngResult = engine.createPID(lngTemplate);
    assert.strictEqual(lngResult.success, true);
    assert.strictEqual(lngResult.sheets.length, 1);
    assertSvgWellFormed(lngResult.sheets[0].svg);

    // Verify all 32 equipment items stay within plot bounds
    for (const eq of lngResult.schedule.equipment) {
      assert(eq.y >= 24 && eq.y <= 640, `LNG equipment ${eq.tag} y=${eq.y} is outside plot bounds [24, 640]`);
    }

    // Verify pumps and compressors
    const pumps = lngResult.schedule.equipment.filter((e) => e.type === 'pump');
    const comps = lngResult.schedule.equipment.filter((e) => e.type === 'compressor');
    assert.strictEqual(pumps.length, 6, `expected 6 pumps in LNG plant, got ${pumps.length}`);
    assert.strictEqual(comps.length, 4, `expected 4 compressors in LNG plant, got ${comps.length}`);

    // Verify H&MB table and stream diamonds in SVG
    assert(lngResult.sheets[0].svg.includes('HEAT &amp; MATERIAL BALANCE'), 'SVG missing H&MB stream table');
    assert(lngResult.sheets[0].svg.includes('ISO 10628 / PIP PIC001'), 'SVG missing ISO 10628 standard subtitle');
    assert(lngResult.sheets[0].svg.includes('barg'), 'SVG missing operating pressure callouts');
  });

  run('ProcessFlowsheetSolver evaluates PUMP unit operation with thermodynamic work and temperature rise', () => {
    const { ProcessStream, ProcessFlowsheetSolver } = require('../src/core/plant/process_flowsheet_solver');
    const solver = new ProcessFlowsheetSolver();
    solver.addStream(
      new ProcessStream('PUMP_IN', {
        temperatureC: 25.0,
        pressureKPa: 200,
        molarFlowKmolH: 50,
        composition: { Water: 1.0 },
        vaporFraction: 0
      })
    );
    solver.addStream(
      new ProcessStream('PUMP_OUT', {
        temperatureC: 25.0,
        pressureKPa: 200,
        molarFlowKmolH: 50,
        composition: { Water: 1.0 },
        vaporFraction: 0
      })
    );
    solver.addPump('P-101', 'PUMP_IN', 'PUMP_OUT', {
      dischargePressureKPa: 4000,
      pumpEfficiency: 0.70,
      liquidDensityKgM3: 1000,
      heatCapacityKJperKgK: 4.18
    });
    const solveRes = solver.solve(5, 1e-6);
    assert.strictEqual(solveRes.success, true);
    const out = solver.getStream('PUMP_OUT');
    assert.strictEqual(out.P_kPa, 4000);
    assert.strictEqual(out.molarFlowKmolH, 50);
    assert.strictEqual(out.vaporFraction, 0);
    // deltaP = 3800 kPa, dT = 3800 * (1 - 0.70) / (1000 * 4.18 * 0.70) = 0.39 °C
    assert(out.T_C > 25.0, `pump discharge temp ${out.T_C} should be > inlet temp 25.0`);
    assert(Math.abs(out.T_C - 25.39) < 0.1, `expected ~25.39 °C, got ${out.T_C}`);
  });

  console.log(`  P&ID engine checks: ${passed}/${total} passed`);
  return { total, passed, failed };
}

module.exports = { runPIDEngineTests };

if (require.main === module) {
  const stats = runPIDEngineTests();
  if (stats.failed > 0) process.exit(1);
}
