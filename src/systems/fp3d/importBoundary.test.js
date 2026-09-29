// Dependency-isolation guard for the framework-agnostic FP3D gesture modules
// (Req 11.1). `gestureClassifier.js` and `gestureResolve.js` must import NEITHER
// Phaser NOR Three.js — only the shared `config.js` and (for turn delegation)
// the framework-agnostic `fp3dLogic.js`. Keeping this seam pure is what lets the
// gesture logic stay unit- and property-testable without a Phaser or WebGL
// runtime, so this test reads each module's own source and asserts the boundary
// holds rather than trusting a comment. It is deterministic (no randomness, no
// network) and framework-agnostic, matching the project's Vitest style.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The two pure gesture modules that must stay free of Phaser/Three.js. */
const PURE_MODULES = ['gestureClassifier.js', 'gestureResolve.js'];

/** Allow-list of module specifiers these pure modules may import. */
const ALLOWED_SPECIFIERS = ['../../config.js', './fp3dLogic.js'];

/**
 * Extract every module specifier imported by a source file: both static
 * `import ... from '...'` / bare `import '...'` forms and dynamic `import('...')`
 * calls, matching single- or double-quoted specifiers.
 * @param {string} source module source text
 * @returns {string[]} imported specifiers in source order
 */
function importedSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g, // static import (with or without bindings)
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import()
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

describe('FP3D gesture modules — dependency isolation (Req 11.1)', () => {
  for (const moduleName of PURE_MODULES) {
    const source = readFileSync(join(HERE, moduleName), 'utf8');
    const specifiers = importedSpecifiers(source);

    it(`${moduleName} imports neither Phaser nor Three.js`, () => {
      for (const spec of specifiers) {
        const normalized = spec.toLowerCase();
        expect(normalized).not.toMatch(/(^|\/)phaser(\/|$)/);
        expect(normalized).not.toMatch(/(^|\/)three(\/|$)/);
      }
    });

    it(`${moduleName} imports only config.js and fp3dLogic.js`, () => {
      for (const spec of specifiers) {
        expect(ALLOWED_SPECIFIERS).toContain(spec);
      }
    });
  }
});
