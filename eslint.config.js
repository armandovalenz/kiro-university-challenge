import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

// Flat ESLint config for Math Man (ESLint v10).
// Lints the framework-agnostic logic and Phaser/Three.js scene code under src/,
// plus the project's Node-context config/test files. Run with `npm run lint`.
//
// Security visibility:
// - eslint-plugin-security      → flags risky patterns (unsafe regex, eval-like
//   calls, non-literal fs/require, etc.).
// - eslint-plugin-no-unsanitized → flags XSS sinks (innerHTML / insertAdjacentHTML
//   / document.write with non-literal input) — most relevant for the DOM overlays.
// Dependency (CVE) vulnerabilities are covered separately by `npm run audit`.
export default [
  {
    // Never lint build output, dependencies, generated assets, or the CDK app.
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'infra/**'],
  },

  // Recommended baseline rules.
  js.configs.recommended,

  // Security hotspot detection across all linted JS.
  security.configs.recommended,
  {
    rules: {
      // detect-object-injection fires on ANY computed member access (arr[i],
      // obj[key]) — pervasive and safe in this game's grid/array logic, and
      // documented by the plugin as high-false-positive. Disable it so the
      // higher-signal security rules (unsafe regex, eval, child_process, fs,
      // timing attacks, XSS sinks) aren't buried in noise.
      'security/detect-object-injection': 'off',
    },
  },

  // Browser runtime code: game source (Phaser + Three.js live here).
  {
    files: ['src/**/*.js'],
    plugins: {
      'no-unsanitized': noUnsanitized,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // XSS sinks: block assigning non-literal/unsanitized values to innerHTML,
      // outerHTML, insertAdjacentHTML, document.write, etc.
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },

  // Test files run under Vitest in a Node environment.
  {
    files: ['src/**/*.{test,spec}.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },

  // Node-context project config (Vite/ESLint/Vitest config, tooling scripts).
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
