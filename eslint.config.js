import js from '@eslint/js';
import globals from 'globals';

// Flat ESLint config for Math Man (ESLint v10).
// Lints the framework-agnostic logic and Phaser/Three.js scene code under src/,
// plus the project's Node-context config/test files. Run with `npm run lint`.
export default [
  {
    // Never lint build output, dependencies, generated assets, or the CDK app.
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'infra/**'],
  },

  // Recommended baseline rules.
  js.configs.recommended,

  // Browser runtime code: game source (Phaser + Three.js live here).
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
