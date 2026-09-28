'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'test/fixtures/generated-page.html'] },

  js.configs.recommended,

  {
    rules: {
      // `catch (error)` with an unused binding is the codebase's convention.
      'no-unused-vars': ['error', { caughtErrors: 'none' }]
    }
  },

  // Extension scripts: plain scripts sharing `globalThis.PPP`, with a
  // CommonJS export tail so the tests can require them.
  {
    files: ['src/common/**/*.js', 'src/content/**/*.js', 'src/options/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        module: 'readonly',
        PPP: 'readonly'
      }
    }
  },

  {
    files: ['src/background/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.webextensions }
    }
  },

  {
    files: ['test/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node
    }
  }
];
