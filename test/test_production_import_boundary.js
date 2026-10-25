'use strict';

const assert = require('assert');
const path = require('path');
const { ESLint } = require('eslint');

async function runProductionImportBoundaryTests() {
  const root = path.resolve(__dirname, '..');
  const eslint = new ESLint({ cwd: root });
  const commonJsResults = await eslint.lintText("require('../test/vv/run_vv');", {
    filePath: path.join(root, 'src/main/__production_import_boundary_probe__.js')
  });
  assert(
    commonJsResults.some((result) => result.messages.some((message) => message.ruleId === 'no-restricted-modules')),
    'Expected the production lint policy to reject CommonJS imports from test/'
  );

  const esmResults = await eslint.lintText("import { run } from '../test/vv/run_vv.js';", {
    filePath: path.join(root, 'src/main/__production_import_boundary_probe__.mjs')
  });
  assert(
    esmResults.some((result) => result.messages.some((message) => message.ruleId === 'no-restricted-imports')),
    'Expected the production lint policy to reject ESM imports from test/'
  );

  const dynamicImportResults = await eslint.lintText("import('../test/vv/run_vv.js');", {
    filePath: path.join(root, 'src/main/__production_import_boundary_probe__.js')
  });
  assert(
    dynamicImportResults.some((result) => result.messages.some((message) => message.ruleId === 'no-restricted-syntax')),
    'Expected the production lint policy to reject dynamic imports from test/'
  );

  const dynamicPathResults = await eslint.lintText('import(modulePath);', {
    filePath: path.join(root, 'src/main/__production_import_boundary_probe__.js')
  });
  assert(
    dynamicPathResults.some((result) => result.messages.some((message) => message.ruleId === 'no-restricted-syntax')),
    'Expected the production lint policy to reject dynamic import expressions with unresolved paths'
  );

  const allowedResults = await eslint.lintText("require('../core/security/ipc_validator');", {
    filePath: path.join(root, 'src/main/__production_import_boundary_probe__.js')
  });
  assert(
    allowedResults.every((result) => result.messages.every((message) => !message.ruleId?.startsWith('no-restricted-'))),
    'Expected normal production imports to remain allowed'
  );

  const allowedEsmResults = await eslint.lintText(
    "import { validateSchema } from '../core/security/ipc_validator.js';",
    {
      filePath: path.join(root, 'src/main/__production_import_boundary_probe__.mjs')
    }
  );
  assert(
    allowedEsmResults.every((result) =>
      result.messages.every((message) => !message.ruleId?.startsWith('no-restricted-'))
    ),
    'Expected normal ESM production imports to remain allowed'
  );

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runProductionImportBoundaryTests()
    .then(() => console.log('Production import boundary checks passed.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runProductionImportBoundaryTests };
