'use strict';

const { mkdirSync, writeFileSync } = require('fs');
const path = require('path');

const { PIDEngine } = require(path.join(__dirname, '..', 'src', 'core', 'plant', 'pid_engine'));

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

const template = argValue('--template', 'oilgas');
const outDir = argValue('--out', path.join(__dirname, '..', 'screenshots', 'pid'));
const format = argValue('--format', 'svg');
const printSchedule = args.includes('--print-schedule');

function run() {
  const engine = new PIDEngine({});
  const config = template === 'lng' ? PIDEngine.lngPlantTemplate() : PIDEngine.oilGasProductionTemplate();
  const result = engine.createPID(config);

  if (!result.success) {
    const errors = (result.validation && result.validation.errors) || [];
    for (const error of errors) {
      process.stderr.write(`P&ID validation error: ${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const { sheets, schedule, validation } = result;
  const errors = (validation && validation.errors) || [];
  const warnings = (validation && validation.warnings) || [];

  mkdirSync(outDir, { recursive: true });

  sheets.forEach((sheet, index) => {
    const filename = `pid_sheet_${index + 1}.svg`;
    writeFileSync(path.join(outDir, filename), `${sheet.svg}\n`);
  });

  writeFileSync(path.join(outDir, 'pid_schedule.json'), `${JSON.stringify(schedule, null, 2)}\n`);

  const validationLines = [];
  for (const error of errors) validationLines.push(`ERROR: ${error}`);
  for (const warning of warnings) validationLines.push(`WARNING: ${warning}`);
  writeFileSync(path.join(outDir, 'pid_validation.txt'), `${validationLines.join('\n')}\n`);

  if (printSchedule) {
    process.stdout.write(`${JSON.stringify(schedule, null, 2)}\n`);
  }

  const equipmentCount = (schedule.equipment && schedule.equipment.length) || 0;
  const lineCount = (schedule.lines && schedule.lines.length) || 0;
  const instrumentCount = (schedule.instruments && schedule.instruments.length) || 0;
  const valveCount = (schedule.valves && schedule.valves.length) || 0;
  const loopCount = (schedule.controlLoops && schedule.controlLoops.length) || 0;

  console.log(`P&ID generation complete (template: ${template}, format: ${format}).`);
  console.log(`  Output directory: ${outDir}`);
  console.log(`  Sheets: ${sheets.length}`);
  console.log(`  Equipment: ${equipmentCount}`);
  console.log(`  Lines: ${lineCount}`);
  console.log(`  Instruments: ${instrumentCount}`);
  console.log(`  Valves: ${valveCount}`);
  console.log(`  Control loops: ${loopCount}`);
  console.log(`  Validation errors: ${errors.length}`);
  console.log(`  Validation warnings: ${warnings.length}`);

  process.exitCode = 0;
}

run();
