import { defineConfig } from 'vite';

// Vite config for Math Man.
// - `public/` (default) holds runtime assets (images, audio, questions) served at the web root.
// - The production build emits static files to `dist/` for deployment to any static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    open: false,
  },
  // Vitest configuration for the framework-agnostic logic modules.
  // Property-based tests (fast-check) are mandatory — see .kiro/steering/testing.md.
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.js'],
  },
});
