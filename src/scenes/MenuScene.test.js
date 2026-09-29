// Example tests for the 3D-only launch decision in `MenuScene` (Task 8.2).
//
// Feature: mobile-gestures-fullscreen — Requirement 10 makes FP3D_Mode the ONLY
// player-facing mode: the menu presents no 2D/3D Render_Mode toggle (Req 10.1),
// and Start always launches `'3d'` (FP3DScene) with the current Grade, ignoring
// any persisted `renderMode` (Req 10.2, 10.3).
//
// These are EXAMPLE tests (not property tests): they pin the concrete behaviour
// MenuScene owns.
//
// WHY WE DON'T `import MenuScene`:
//   The suite runs under the `node` Vitest environment (see vite.config.js), and
//   `MenuScene.js` statically imports Phaser, which touches `window` at import
//   time and throws under node (no jsdom is available and none may be added).
//   Every existing repo test stays framework-agnostic for exactly this reason —
//   `src/systems/fp3d/importBoundary.test.js` verifies a scene-adjacent concern
//   by reading source text rather than importing a Phaser module. We follow that
//   precedent, and additionally execute the REAL `_startGame` method body in
//   isolation (extracted from source, injected with the handful of module
//   constants it references) against a tiny stub `this`. That runs the actual
//   launch logic headlessly without booting Phaser.
//
// SCOPE / DEFERRAL NOTE (Req 10.5–10.9 — internal 2D fallback):
//   The automatic 2D fallback on a WebGL-context failure, mid-session context
//   loss, or Maze_Data validation failure — preserving lives/score/Grade, the
//   dismissible "3D unavailable" notice, and unmodified Maze_Data — is owned
//   ENTIRELY by `FP3DScene._requestFallback`, NOT by `MenuScene`. `MenuScene`
//   never participates in that fallback: `_startGame` unconditionally starts
//   `FP3DScene` and returns; nothing in MenuScene selects `GameScene` or reads a
//   persisted `renderMode`. Asserting the fallback path here would require
//   fabricating a code path MenuScene does not have, so per the task guidance we
//   do NOT re-prove it at the MenuScene level. Req 10.5–10.9 are exercised where
//   they live (inside FP3DScene). These tests therefore cover the MenuScene-owned
//   criteria (10.1, 10.2, 10.3) and document that 10.5–10.9 are FP3DScene's.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_GRADE, GRADES, GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import { AudioEvent } from '../systems/AudioBus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MENU_SOURCE = readFileSync(join(HERE, 'MenuScene.js'), 'utf8');

// Names of the Render_Mode toggle handlers that Task 8.1 removed. If any of
// these reappears as a real method definition, the menu has regrown a
// player-facing 2D/3D control.
const REMOVED_RENDER_MODE_METHODS = [
  '_buildRenderModeToggle',
  '_selectRenderMode',
  '_toggleRenderMode',
  '_refreshRenderModeButtons',
  '_loadPersistedRenderMode',
];

/**
 * Strip line (`// ...`) and block (block-comment) segments from JS source so
 * assertions target real code, not documentation prose (the file's JSDoc
 * legitimately mentions "renderMode" and "2D/3D" when explaining the decision).
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating `://`)
}

/**
 * Extract the body of the `_startGame() { ... }` method from MenuScene source by
 * brace-matching, and wrap it in a callable function that runs with a stub
 * `this` and the module constants it references injected as parameters. This
 * executes the REAL launch logic (not a paraphrase) without importing Phaser.
 * @returns {(self:object) => void}
 */
function extractStartGame() {
  const marker = '_startGame() {';
  const start = MENU_SOURCE.indexOf(marker);
  if (start === -1) throw new Error('could not locate _startGame in MenuScene.js');
  const bodyOpen = start + marker.length - 1; // index of the opening brace
  let depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < MENU_SOURCE.length; i += 1) {
    const ch = MENU_SOURCE[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('could not brace-match _startGame body');
  const body = MENU_SOURCE.slice(bodyOpen + 1, end);
  // `this` inside the body is provided by `.call(self)`. The body references the
  // module-scope constants GAME_WIDTH/GAME_HEIGHT and AudioEvent — inject them.
  // eslint-disable-next-line no-new-func
  const fn = new Function('GAME_WIDTH', 'GAME_HEIGHT', 'AudioEvent', `return function(){${body}};`);
  const impl = fn(GAME_WIDTH, GAME_HEIGHT, AudioEvent);
  return (self) => impl.call(self);
}

const startGame = extractStartGame();

/**
 * Build a minimal stub `this` for invoking the extracted `_startGame`.
 * Records the scene launch(es) and any placeholder text created.
 * @param {object} [opts]
 * @param {boolean} [opts.fp3dRegistered=true] whether FP3DScene is registered
 * @param {number} [opts.grade=DEFAULT_GRADE] the currently selected grade
 * @param {object|null} [opts.storage] a Storage stub (its renderMode must be ignored)
 */
function makeStartStub({ fp3dRegistered = true, grade = DEFAULT_GRADE, storage = null } = {}) {
  const started = [];
  const placeholders = [];
  const audioPlays = [];
  return {
    scene: {
      manager: { keys: fp3dRegistered ? { FP3DScene: {} } : {} },
      start: (key, data) => started.push({ key, data }),
    },
    _audio: { play: (evt) => audioPlays.push(evt) },
    _storage: storage,
    _grade: grade,
    _started: false,
    // `this.add.text(...)` in the not-registered placeholder branch — return a
    // chainable stub so `.setOrigin(...)` does not throw.
    add: {
      text: (...args) => {
        placeholders.push(args);
        return { setOrigin: () => ({}) };
      },
    },
    // expose captured data to the test
    _captured: { started, placeholders, audioPlays },
  };
}

describe('MenuScene — no Render_Mode toggle is presented (Req 10.1)', () => {
  const code = stripComments(MENU_SOURCE);

  it('defines none of the removed Render_Mode toggle handler methods', () => {
    for (const method of REMOVED_RENDER_MODE_METHODS) {
      // A method definition would look like `  _selectRenderMode(` in the class
      // body. Assert no such definition survives in real (comment-stripped) code.
      const defPattern = new RegExp(`\\b${method}\\s*\\(`);
      expect(defPattern.test(code)).toBe(false);
    }
  });

  it('builds no 2D/3D Render_Mode selection UI in real code', () => {
    // No live reference to a render-mode concept as code (only JSDoc may mention
    // it). The strings the menu actually renders are grade labels and PLAY, not
    // a "2D"/"3D" mode chooser.
    expect(/renderMode/i.test(code)).toBe(false);
    // Ensure there is no interactive MODE toggle label wired up.
    expect(/['"`][^'"`]*\bMODE\b[^'"`]*['"`]/.test(code)).toBe(false);
  });
});

describe('MenuScene._startGame — always launches FP3DScene in 3D (Req 10.2, 10.3)', () => {
  it('starts FP3DScene with the current grade', () => {
    const stub = makeStartStub({ grade: 7 });
    startGame(stub);

    expect(stub._captured.started).toHaveLength(1);
    expect(stub._captured.started[0].key).toBe('FP3DScene');
    expect(stub._captured.started[0].data).toEqual({ grade: 7 });
  });

  it('launches FP3DScene for every valid grade', () => {
    for (const grade of GRADES) {
      const stub = makeStartStub({ grade });
      startGame(stub);
      expect(stub._captured.started).toEqual([{ key: 'FP3DScene', data: { grade } }]);
    }
  });

  it('ignores a persisted renderMode of "2d" and still launches 3D/FP3DScene (Req 10.3)', () => {
    // Storage stub whose persisted renderMode is '2d'. MenuScene must NOT read
    // it to pick a mode — the launch is always '3d' (FP3DScene). We also assert
    // the launch never touches GameScene.
    const storage = {
      get: () => ({ lastDifficulty: 6, highScore: 0, renderMode: '2d' }),
      setRenderMode: () => {
        throw new Error('MenuScene must not persist a render mode on launch');
      },
    };
    const stub = makeStartStub({ grade: 6, storage });
    startGame(stub);

    expect(stub._captured.started).toHaveLength(1);
    expect(stub._captured.started[0].key).toBe('FP3DScene');
    expect(stub._captured.started[0].data).toEqual({ grade: 6 });
    // Never launches the 2D GameScene from the menu (fallback is FP3DScene-owned).
    const launchedKeys = stub._captured.started.map((s) => s.key);
    expect(launchedKeys).not.toContain('GameScene');
  });

  it('only launches once (guarded by _started)', () => {
    const stub = makeStartStub({ grade: 5 });
    startGame(stub);
    startGame(stub);
    expect(stub._captured.started).toHaveLength(1);
  });

  it('shows a placeholder (never throws, never launches 2D) when FP3DScene is not registered', () => {
    const stub = makeStartStub({ grade: 5, fp3dRegistered: false });
    // Should not throw even though FP3DScene is absent (Req 13.5 spirit).
    expect(() => startGame(stub)).not.toThrow();
    // No scene started at all — certainly not a 2D GameScene.
    expect(stub._captured.started).toHaveLength(0);
    // A placeholder notice was drawn instead.
    expect(stub._captured.placeholders.length).toBeGreaterThan(0);
    // And it re-arms so a later launch (once the scene lands) can retry.
    expect(stub._started).toBe(false);
  });
});

describe('MenuScene — internal 2D fallback (Req 10.5–10.9) is FP3DScene-owned', () => {
  // Documentation guard: MenuScene contains no fallback logic of its own. The
  // fallback (WebGL failure / context loss / Maze_Data failure → 2D, preserving
  // lives/score/Grade) lives in `FP3DScene._requestFallback`. This asserts
  // MenuScene neither references GameScene as a launch target nor implements a
  // fallback selector, so the criteria are correctly deferred to FP3DScene.
  it('does not select or launch GameScene as a fallback from the menu', () => {
    const code = stripComments(MENU_SOURCE);
    expect(/scene\.start\(\s*['"`]GameScene['"`]/.test(code)).toBe(false);
    expect(/_requestFallback|setRenderMode/.test(code)).toBe(false);
  });
});
