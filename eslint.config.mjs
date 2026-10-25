import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'src/vendor/**', 'src/public/**', 'dist/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, setImmediate: 'readonly', SharedArrayBuffer: 'readonly' }
    },
    rules: {
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error'
    }
  },
  {
    files: ['main.js', 'preload.js', 'src/**/*.js', 'src/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['test', 'test/**', '**/test', '**/test/**'],
              message: 'Production code must not import from the test tree.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.type!="Literal"]',
          message: 'Production dynamic imports must use a string literal specifier.'
        },
        {
          selector: 'ImportExpression[source.value=/\\/test(?:\\/|$)/]',
          message: 'Production code must not load modules from the test tree.'
        },
        {
          selector: 'ImportExpression[source.value=/^test(?:\\/|$)/]',
          message: 'Production code must not load modules from the test tree.'
        }
      ],
      'no-restricted-modules': ['error', { patterns: ['test', 'test/**', '**/test', '**/test/**'] }]
    }
  },
  { files: ['src/**/*.mjs'], languageOptions: { sourceType: 'module' } },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } }
];
