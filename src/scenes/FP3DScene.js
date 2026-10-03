// FP3DScene — the first-person 3D (FP3D_Mode) gameplay scene (Task 14).
//
// This is the SOLE new Phaser scene for FP3D_Mode. It may import Phaser and the
// Three.js-facing `FP3DRenderer`, but it NEVER forks game logic: the maze, ghost
// AI, scoring, lives, lessons, audio, and persistence are all the SAME
// framework-agnostic systems the 2D `GameScene` uses (Req 9.1). Where GameScene
// reads a system, this scene reads the identical one.
//
// Task 14 scope (what this file implements now):
//   - `create()`: read `{ grade }`, build a `MazeGrid` from `getLevelLayout()`,
//     construct `FP3DRenderer`, place Math Man / 4 ghosts / fruit at their spawn
//     tiles (Req 1.4), publish a fresh `ScoreSystem` on the registry, build a
//     `LessonBank`, and wire keyboard input.
//   - `update(t, dt)`: grid-locked tile-to-tile movement interpolation (≤250 ms
//     via `FP3D.tileTraversalMs`) using `resolveMove`/`resolveTunnel`; advance
//     ghosts through a thin per-tick wrapper around the EXISTING framework-
//     agnostic `ghostAI.js` exports (never `Ghost.js`, never a forked copy);
//     collect pellets/power-pellets via `MazeGrid.eatPelletAt` →
//     `ScoreSystem.addScore` (each scored once, Req 3.4) with the pellet sfx;
//     drive the renderer (camera + ghosts w/ LOS visibility) each tick.
//
// Deliberately LEFT AS HOOKS for later tasks (not double-implemented here):
//   - Task 15: the full capture → quiz and fruit → lesson FREEZE flow. This
//     scene detects a ghost on the player's tile and a fruit overlap and calls
//     `_onCaught()` / `_onFruitCollected()`, which do minimal, non-overlay
//     handling and set a clean `_captureHook` / `_fruitHook` seam Task 15
//     replaces with the real `QuizScene`/`LessonScene` launches + freeze.
//   - Task 16: menu Render_Mode toggle, scene registration in main.js, and the
//     full WebGL-unavailable fallback into GameScene. Here the renderer
//     construction is wrapped in try/catch so the scene does not crash; the
//     fallback intent is recorded on `this._fallbackTo2D` for Task 16 to act on.

import Phaser from 'phaser';

import {
  DEFAULT_GRADE, GRADES, GHOST_PERSONALITIES, FP3D, TIMINGS, FRUIT_MIN_DISTANCE, PRESSURE, GESTURE, KNOWLEDGE,
} from '../config.js';
import { nearestGhostPathDistance, pressureTargetRate, approachRate } from '../systems/pressure.js';
import {
  MazeGrid, resolveCatchPositions, pickFruitTile, pickQuadrantFruitTiles,
} from '../maze/mazeLogic.js';
import { getLevelLayout, TILE } from '../maze/mazeData.js';
import {
  CARDINALS,
  CARDINAL_TO_DIR,
  InputBuffer,
  resolveMove,
  resolveTunnel,
  turnLeft,
  turnRight,
  setFacing,
} from '../systems/fp3d/fp3dLogic.js';
import { isGhostVisible, hasLineOfSight } from '../systems/fp3d/lineOfSight.js';
import { classifyGesture, movementVector } from '../systems/fp3d/gestureClassifier.js';
import { resolveMovementVector, resolveFlickTurn } from '../systems/fp3d/gestureResolve.js';
import { createFullscreenToggle } from '../ui/FullscreenToggle.js';
import { createVirtualJoystick } from '../ui/VirtualJoystick.js';
import LevelClearModal from '../ui/LevelClearModal.js';
import {
  computeTargetTile,
  chooseGhostDirection,
  ghostSpeedForGrade,
  houseRegionFromGrid,
  isHouseTile,
  ghostHouseExitTile,
  blockHouseReentry,
} from '../entities/ghostAI.js';
import { FP3DRenderer, NoWebGLContextError } from '../render/FP3DRenderer.js';
import ScoreSystem from '../systems/ScoreSystem.js';
import LessonBank from '../systems/LessonBank.js';
import KnowledgePower from '../systems/KnowledgePower.js';
import { resolveBookThrow } from '../systems/bookThrow.js';
import { AudioEvent } from '../systems/AudioBus.js';

/**
 * Map an FP3D cardinal facing to the 2D `DIRECTIONS`/`ghostAI` direction string
 * ('up'|'down'|'left'|'right'). Reused from `CARDINAL_TO_DIR` so the two modes
 * never diverge; kept as a local alias for readability where ghost headings are
 * tracked as directions rather than cardinals.
 */
const DIR_TO_CARDINAL = {
  up: 'north',
  down: 'south',
  left: 'west',
  right: 'east',
};

/** Opposite of a 2D heading — used to frame the ghost toward where it lunged from. */
const OPPOSITE_DIR = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * Distinct scatter home corner per personality, derived from the grid bounds —
 * IDENTICAL to `Ghost._cornerFor` in the 2D game so FP3D ghosts scatter the same
 * way: red→top-right, pink→top-left, cyan→bottom-right, orange→bottom-left.
 * @param {string} personality
 * @param {{cols:number, rows:number}} grid
 * @returns {{col:number, row:number}}
 */
function scatterCornerFor(personality, grid) {
  const maxCol = grid && grid.cols ? grid.cols - 1 : 0;
  const maxRow = grid && grid.rows ? grid.rows - 1 : 0;
  switch (personality) {
    case 'ambush': return { col: 0, row: 0 };            // pink → top-left
    case 'vector': return { col: maxCol, row: maxRow };  // cyan → bottom-right
    case 'scatter': return { col: 0, row: maxRow };      // orange → bottom-left
    case 'chase':
    default: return { col: maxCol, row: 0 };             // red → top-right
  }
}

export default class FP3DScene extends Phaser.Scene {
  constructor() {
    super('FP3DScene');
  }

  /**
   * Receive scene data (`{ grade }`) exactly like `GameScene.init`: validate the
   * grade against `GRADES`, defaulting to `DEFAULT_GRADE` when absent/invalid so
   * ghost speed scaling and the quiz flow (Task 15) read a valid grade.
   * @param {{ grade?: number }} [data]
   */
  init(data = {}) {
    this.grade = GRADES.includes(data.grade) ? data.grade : DEFAULT_GRADE;
    // Cleared each time the scene (re)starts.
    this._fallbackTo2D = false;
    this.renderer = null;
  }

  /**
   * Map the selected grade to the starting maze level so each grade opens its
   * own maze: 5th → 1 (base), 6th → 2 (circular), 7th → 3 (the Shining maze).
   * Falls back to level 1 for an unknown grade. `getLevelLayout(level)` keys the
   * maze off this level, and winning advances it (and the grade) to the next.
   * @param {number} grade
   * @returns {number}
   */
  _levelForGrade(grade) {
    const i = GRADES.indexOf(grade);
    return i >= 0 ? i + 1 : 1;
  }

  create() {
    // --- Shared systems from the registry (populated by BootScene) -----------
    // These are the SAME instances GameScene reads; FP3D_Mode never forks them.
    // Storage in-memory fallback (Req 8.4): this scene only ever touches
    // persistence through this shared `Storage` instance (e.g.
    // `storage.setRenderMode('2d')` on fallback) — never raw `localStorage`. So
    // when `localStorage` is blocked/absent, `Storage` transparently degrades
    // the `renderMode` record (and every other record) to its in-memory
    // fallback for the session without throwing, and gameplay continues
    // uninterrupted (the existing Storage Property 16 covers this path).
    this.audio = this.registry.get('audio') || null;
    this.storage = this.registry.get('storage') || null;

    // Fresh score/lives/level tracker for this run, published on the registry so
    // UIScene and later tasks share the one instance (Req 5.1, 5.4). The STARTING
    // LEVEL is derived from the chosen grade so each grade opens its own maze
    // immediately: 5th → level 1 (base), 6th → level 2 (circular), 7th → level 3
    // (the Shining maze) — see getLevelLayout. Winning still advances the level
    // (and grade) to the next maze.
    this.scoreSystem = new ScoreSystem({ level: this._levelForGrade(this.grade) });
    this.registry.set('scoreSystem', this.scoreSystem);

    // Per-run bank of tagged micro-lessons for fruit collection (Task 15 uses
    // the freeze + overlay; here it is constructed and ready).
    this.lessonBank = new LessonBank();

    // Knowledge Power charge meter (FP3D_Mode): starts FULL. A thrown book costs
    // one charge; eating a fruit refills it to max; a new level resets it. The
    // meter is a framework-agnostic integer system — this scene only reads/
    // mutates it and renders the book bar HUD (no forked rules).
    this.knowledge = new KnowledgePower();

    // --- Maze: the single source of truth (Req 1.5) --------------------------
    // Build a pure MazeGrid straight from getLevelLayout(); a malformed layout
    // throws in the MazeGrid constructor (validateLayout) — caught so the scene
    // records the 2D fallback intent instead of crashing (Task 16 wires the
    // actual GameScene handoff + notice, Req 1.6).
    try {
      // Build the maze for the RUN'S CURRENT LEVEL (set from the chosen grade in
      // the ScoreSystem above) — NOT a hardcoded level 1 — so 5th grade opens the
      // base maze, 6th the circular maze, and 7th the Shining maze. MazeGrid reads
      // getLevelLayout(level) internally, so passing the level is enough.
      const startLevel = this.scoreSystem ? this.scoreSystem.level : 1;
      this.grid = new MazeGrid({ level: startLevel });
    } catch (err) {
      // Malformed maze data → fall back to 2D (Task 16), leaving Maze_Data
      // untouched. Record the intent and stop building the 3D scene.
      this._requestFallback('maze', err);
      return;
    }

    // --- Ghost-house release setup (match the 2D Ghost behavior) -------------
    // Ghosts start INSIDE the house and must path UP through the door before
    // chasing, and must never path back in once out. Derive the house region
    // once and build a re-entry-blocking grid view — the SAME helpers the 2D
    // `Ghost` uses (`houseRegionFromGrid` / `blockHouseReentry`), so FP3D ghost
    // movement matches the top-down game instead of milling in the house.
    this._house = houseRegionFromGrid(this.grid);
    this._noReentryGrid = blockHouseReentry(this.grid, this._house);

    // --- Reduced motion (Req 7.5) --------------------------------------------
    // Honor the OS/browser preference at start; Task 17 adds the live toggle.
    this._reducedMotion = this._prefersReducedMotion();

    // --- FP3D runtime state (design "FP3D runtime state") --------------------
    const spawn = this.grid.mathManSpawn || { col: 0, row: 0 };
    // Remember the player spawn tile so `resumeAfterQuiz` can reset Math Man to
    // it after a caught → quiz cycle (mirrors GameScene.resetPositions, Req 4.3).
    this._playerSpawn = { col: spawn.col, row: spawn.row };
    // Face down an OPEN corridor at start instead of a hardcoded 'north', which
    // often points straight into a wall at the spawn tile. Reused on reset too.
    this._spawnFacing = this._initialFacing(spawn.col, spawn.row);
    this.state = {
      player: { col: spawn.col, row: spawn.row, facing: this._spawnFacing },
      traversal: null, // { active, from, to, ms, elapsed } while a step is in flight
      buffer: new InputBuffer(), // 0 or 1 pending intent (Req 2.7)
      ghosts: this._buildGhostStates(), // 4 entries with { key, color, personality, col, row }
      fruits: this._buildFruitStates(), // 4 slots (one per quadrant): { slot, col, row, present, timerMs }
      frozen: false, // true while an overlay is open (Task 15 sets it)
      reducedMotion: this._reducedMotion,
    };

    // --- Renderer (the only Three.js consumer) -------------------------------
    // Construct against the Phaser canvas' parent so the 3D canvas layers with
    // the game. Wrap in try/catch for NoWebGLContextError: on failure record the
    // 2D fallback intent (Task 16 completes the handoff, Req 8.1) — do not crash.
    const parent = this._rendererParent();
    try {
      this.renderer = new FP3DRenderer(parent, {
        grid: this.grid,
        eyeHeight: FP3D.eyeHeight,
        dprCap: FP3D.dprCap,
        reducedMotion: this._reducedMotion,
        // Mid-session context loss (Req 8.5) — Task 16 wires the real fallback.
        onContextLost: () => this._requestFallback('context-lost'),
      });
    } catch (err) {
      if (err instanceof NoWebGLContextError) {
        this._requestFallback('no-webgl', err);
        return;
      }
      throw err;
    }

    // Size the renderer to the current game canvas and keep it in sync.
    this._syncRendererSize();
    this.scale?.on?.(Phaser.Scale.Events.RESIZE, this._syncRendererSize, this);

    // --- Seed the renderer from the initial state ----------------------------
    // Camera at the player's spawn tile (Req 2.1); every live pellet shown
    // (Req 3.1/3.2); fruit shown at its spawn (Req 3.5); ghosts placed (Req 1.4).
    this.renderer.setCamera(this.state.player.col, this.state.player.row, this.state.player.facing);
    this._seedPelletMarkers();
    for (const f of this.state.fruits) {
      this.renderer.setFruit(f.col, f.row, f.present, f.slot);
    }
    this._renderGhosts();

    // --- Input ---------------------------------------------------------------
    // Discrete keyboard turn/move controls (Req 7.3): full play is possible with
    // the keyboard alone — no pointer-lock or mouse-look is ever engaged, so the
    // player can reach any tile and face all four cardinals without a pointing
    // device. On-screen touch controls (Req 2.6) are built as a DOM overlay so
    // touch-only devices can play the same intents.
    this._setupInput();
    this._buildTouchControls();
    this._buildHud();
    this._buildRotateHint();

    // One-thumb touch gesture input path (Req 1, 2, 4, 5) + the accessible
    // Fullscreen_Toggle (Req 9). Both are additive to the keyboard path above:
    // keyboard and gestures stay interchangeable within a session, with no
    // input-mode lock (Req 8.1–8.3). The crosshair reticle is shown so the Tap/
    // Long_Press interaction target is visible.
    if (this.renderer && typeof this.renderer.setCrosshair === 'function') {
      this.renderer.setCrosshair(true);
    }
    this._setupTouchGestures();
    this._buildFullscreenToggle();
    this._buildReturnToMenuButton();

    // --- Audio: gameplay music like GameScene (silent no-op if unavailable) --
    // EVERY FP3D sound is played as `this.audio.play(AudioEvent.X)` through the
    // shared `AudioBus` — this scene NEVER calls `this.sound.*` / `scene.sound.*`
    // directly. That routing is what makes a missing/failed sound key a SILENT
    // NO-OP (Req 8.3): AudioBus.play → resolveSound returns null for an unknown
    // event, and `_hasAudio(key)` is false for a key whose asset failed to
    // decode, so playback is skipped with no error surfaced to the player — the
    // exact same guarantee the 2D game relies on (Property 22). See AudioBus.js.
    //
    // `bindMuteKey` wires the shared `M` key to AudioBus.toggleMute, whose global
    // `sound.mute` silences BOTH the music and every sfx channel (Req 7.6) — the
    // FP3D cues route through the same AudioBus, so mute silences all FP3D audio.
    if (this.audio) {
      if (typeof this.audio.bindMuteKey === 'function') this.audio.bindMuteKey(this);
      // A fresh run starts at normal tempo (the scene object is reused).
      if (typeof this.audio.setMusicRate === 'function') this.audio.setMusicRate(1);
      this._musicRate = 1;
      this._targetRate = 1;
      this._pressureCheckAt = 0;
      if (typeof this.audio.play === 'function') this.audio.play(AudioEvent.GAME_MUSIC);
    }
    // Questions never repeat within a level (Req 4.10). FP3D plays a single
    // level per run, so the window starts fresh when the scene starts.
    const questionBank = this.registry.get('questionBank');
    if (questionBank && typeof questionBank.startLevel === 'function') questionBank.startLevel();

    // --- Reduced-motion live toggle (Req 7.4, 7.5) ---------------------------
    // Reduced-motion is initialized from the OS/browser preference above
    // (`_prefersReducedMotion`). Bind Shift+M as a live in-game toggle (distinct
    // from the plain `M` mute key) so a motion-sensitive player can flip it
    // during play; it also drives the labeled on-screen "Reduced motion" button
    // built in `_buildTouchControls`. Either path calls `_setReducedMotion`,
    // which reaches `renderer.setReducedMotion` live so the next animateTurn/
    // animateMove snaps while grid-locked position changes still occur.
    const kb2 = this.input && this.input.keyboard;
    if (kb2 && typeof kb2.on === 'function') {
      kb2.on('keydown-M', (ev) => {
        if (ev && ev.shiftKey) this._toggleReducedMotion();
      }, this);
    }

    // --- Capture / fruit overlay flow (Task 15) ------------------------------
    // The real freeze → QuizScene / LessonScene flows are wired directly in
    // `_onCaught` / `_onFruitCollected` below, mirroring GameScene's contract.
    // Guards a single catch cycle (mirrors GameScene._caught) so the per-tick
    // capture check launches the quiz at most once until `resumeAfterQuiz`
    // clears it.
    this._caught = false;

    // Guards the win → next-level transition so it fires exactly once per clear
    // and cannot re-enter mid-transition (mirrors GameScene._levelTransition).
    // After `grid.reset` the pellet count is non-zero again, so `_checkLevelClear`
    // will not re-trigger on the same cleared board.
    this._levelTransition = false;

    // The "Level Complete!" DOM dialog, present only while a win is being
    // announced (built in `_advanceLevel`, torn down in `_onLevelClearDismissed`
    // / `_returnToMenu` / `_onShutdown`).
    this._levelClearModal = null;

    // Duck the gameplay music while an overlay is open and restore it on
    // resume, matching GameScene's overlay ducking (Req 12.7). Because FP3DScene
    // drives its own render loop rather than pausing via the Scene Manager, the
    // duck/unduck is driven explicitly from `_freeze`/`_unfreeze` (the `frozen`
    // flag keeps the 3D frame drawing behind the DOM overlay).

    // Live held move direction ('forward'|'back'|null) for continuous keyboard
    // walking, and the live held Virtual_Joystick step sequence (facing-relative
    // cardinal legs) for continuous stick walking. Both are re-issued each tile
    // by `_continueOrConsume` and cleared on release.
    this._heldMoveDir = null;
    this._heldGestureSteps = null;

    // Frame delta + ghost step accumulator (ms), read by `_advanceGhosts`.
    this._lastDelta = 0;
    this._ghostAccumMs = 0;

    // Clean up renderer + listeners when the scene stops.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown, this);
  }

  update(time, delta) {
    // Fallback requested during create() or a context loss — nothing to drive
    // here; Task 16 owns the actual GameScene handoff.
    if (this._fallbackTo2D || !this.renderer || !this.state) return;

    // Frozen (overlay open, Task 15) → render only, no movement/ghost activity
    // (Req 4.2, 6.7). Movement/turn input is ignored while frozen.
    if (this.state.frozen) {
      // Overlay open: no interaction affordance while play is suspended so no
      // stale "COLLECT" prompt lingers over the quiz/lesson (Req 6.6, 8.4).
      if (this.renderer && typeof this.renderer.setInteractionIndicator === 'function') {
        this.renderer.setInteractionIndicator(null);
      }
      this._updateHud();
      this.renderer.render(this.state);
      return;
    }

    // Capture the frame delta so the ghost step cadence in `_advanceGhosts` can
    // accumulate it without re-threading the loop argument.
    this._lastDelta = delta;

    this._pollInput();
    this._stepMovement(delta);
    this._stepFruitCadence(delta);
    this._advanceGhosts();
    this._updatePressure(time, delta);
    this._renderGhosts();
    this._updateInteractionIndicator();
    this._updateHud();

    this.renderer.render(this.state);
  }

  // --- Spawn placement (Req 1.4) ---------------------------------------------

  /**
   * Build the four ghost runtime states from `GHOST_PERSONALITIES` (config) and
   * the maze's ghost-house spawn tiles. Each state MUST carry
   * `{ key, color, personality, col, row }` — `personality` is REQUIRED by
   * `ghostAI.computeTargetTile`/`chooseGhostDirection` (they branch on it), so
   * omitting it would silently collapse every ghost onto the same target rule.
   * A `dir` (current heading) is tracked too so the AI never reverses.
   * @returns {Array<{key:string,color:number,personality:string,col:number,row:number,dir:?string}>}
   */
  /**
   * Choose a starting facing at the spawn tile that points down an OPEN
   * corridor rather than into a wall. Tries each cardinal in a natural order and
   * returns the first whose neighbor is enterable (reusing `resolveMove` so the
   * wall/tunnel rules match movement); falls back to 'north' if fully boxed in.
   * @param {number} col spawn column
   * @param {number} row spawn row
   * @returns {'north'|'east'|'south'|'west'}
   */
  _initialFacing(col, row) {
    for (const facing of CARDINALS) {
      const step = resolveMove(this.grid, col, row, facing);
      if (step.moved) return facing;
    }
    return 'north';
  }

  _buildGhostStates() {
    const spawns = this.grid.ghostSpawns || [];
    return GHOST_PERSONALITIES.map((def, i) => {
      const spawn = spawns.length ? spawns[i % spawns.length] : { col: 0, row: 0 };
      return {
        key: def.key,
        color: def.color,
        personality: def.personality,
        col: spawn.col,
        row: spawn.row,
        dir: null, // current heading ('up'|'down'|'left'|'right'), null on spawn
        // Spawn tile kept so `resumeAfterQuiz` can reset the ghost after a catch
        // (mirrors GameScene.resetPositions, Req 4.3).
        spawn: { col: spawn.col, row: spawn.row },
        // Per-personality scatter corner (matches 2D Ghost._cornerFor).
        scatterCorner: scatterCornerFor(def.personality, this.grid),
        // House-release state: false until the ghost clears the house interior,
        // exactly like the 2D Ghost._exitedHouse phase.
        exited: false,
      };
    });
  }

  /**
   * Build the four fruit slots, one per maze quadrant (Property 27), each on a
   * random corridor tile in its quadrant away from the player spawn. All four
   * are present from the start (Req 1.4, 5.7).
   * `timerMs` counts unfrozen play time: while present it runs toward
   * `TIMINGS.fruitLifetime` (then the fruit vanishes); while absent toward
   * `TIMINGS.fruitSpawnInterval` (then a new fruit appears in that quadrant).
   * @returns {Array<{slot:number,col:number,row:number,present:boolean,timerMs:number}>}
   */
  _buildFruitStates() {
    const spawn = this.grid.mathManSpawn;
    const picks = pickQuadrantFruitTiles(this.grid, Math.random, {
      avoid: spawn ? [spawn] : [],
      minDistance: FRUIT_MIN_DISTANCE,
    });
    return picks.map((tile, slot) => (tile
      ? { slot, col: tile.col, row: tile.row, present: true, timerMs: 0 }
      : { slot, col: 0, row: 0, present: false, timerMs: 0 }));
  }

  /**
   * Fruit cadence, mirroring GameScene's timers but driven by unfrozen frame
   * time (so it pauses with overlays). Per quadrant slot: an uncollected fruit
   * disappears after `fruitLifetime`, and an empty slot refills after
   * `fruitSpawnInterval` with a random corridor tile in that same quadrant,
   * away from the player and ghosts.
   * @param {number} delta frame time in ms
   */
  _stepFruitCadence(delta) {
    const st = this.state;
    if (!st || !st.fruits) return;
    let spawned = false;
    for (const fruit of st.fruits) {
      fruit.timerMs += delta || 0;

      if (fruit.present) {
        if (fruit.timerMs < TIMINGS.fruitLifetime) continue;
        fruit.present = false;
        fruit.timerMs = 0;
        if (this.renderer) this.renderer.setFruit(fruit.col, fruit.row, false, fruit.slot);
        continue;
      }

      if (fruit.timerMs < TIMINGS.fruitSpawnInterval) continue;
      fruit.timerMs = 0;
      const avoid = [{ col: st.player.col, row: st.player.row }]
        .concat(st.ghosts.map((g) => ({ col: g.col, row: g.row })));
      const tile = pickFruitTile(this.grid, Math.random, {
        avoid, minDistance: FRUIT_MIN_DISTANCE, quadrant: fruit.slot,
      });
      if (!tile) continue;
      fruit.col = tile.col;
      fruit.row = tile.row;
      fruit.present = true;
      if (this.renderer) this.renderer.setFruit(fruit.col, fruit.row, true, fruit.slot);
      spawned = true;
    }
    if (spawned && this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.FRUIT_SPAWN);
    }
  }

  /**
   * Pressure tempo (Req 12.9 / Properties 28–29), identical rule to
   * GameScene: every `PRESSURE.checkMs`, the walking distance to the nearest
   * ghost sets a target playback rate for the score; every frame the actual
   * rate ramps toward it, so the music speeds up and slows down gradually.
   * Only runs in the unfrozen update path, so overlays hold it still.
   * @param {number} time scene clock (ms)
   * @param {number} delta frame time (ms)
   */
  _updatePressure(time, delta) {
    if (!this.audio || typeof this.audio.setMusicRate !== 'function' || !this.state) return;
    if (this._musicRate === undefined) { this._musicRate = 1; this._targetRate = 1; }

    if (time >= (this._pressureCheckAt || 0)) {
      this._pressureCheckAt = time + PRESSURE.checkMs;
      const st = this.state;
      const d = nearestGhostPathDistance(
        this.grid, st.player, st.ghosts.map((g) => ({ col: g.col, row: g.row })), PRESSURE.startTiles,
      );
      this._targetRate = pressureTargetRate(d, PRESSURE);
    }

    const next = approachRate(this._musicRate, this._targetRate, delta, PRESSURE);
    if (next !== this._musicRate) {
      this._musicRate = next;
      this.audio.setMusicRate(next);
    }
  }

  /** Show a marker for every live pellet in the grid (Req 3.1, 3.2). */
  _seedPelletMarkers() {
    for (const key of this.grid.pellets.keys()) {
      const [col, row] = key.split(',').map(Number);
      this.renderer.setPelletVisible(col, row, true);
    }
  }

  // --- Input (Req 2.6, 7.3; full touch/accessibility is Task 17) -------------

  /**
   * Wire keyboard controls with a simple, forgiving maze scheme:
   *   - Up / W        → walk forward (HOLD to keep walking corridor to corridor;
   *                     stops at a wall, no need to release).
   *   - Down / S      → walk backward.
   *   - Left / A      → turn 90° left IN PLACE — always works instantly, never
   *                     blocked by a wall.
   *   - Right / D     → turn 90° right in place.
   * Turning and moving are decoupled: to take a corner you just tap left/right
   * to face the corridor while holding Up — the camera turns immediately and
   * the next step follows the new facing, so corners never require precise
   * timing or stopping. Fully playable from the keyboard alone without
   * pointer-lock (Req 7.3); mouse-look and touch buttons layer on top.
   */
  _setupInput() {
    const kb = this.input.keyboard;
    if (!kb) {
      this.cursors = null;
      this.wasd = null;
      return;
    }
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // Turn keys fire on keydown (discrete, one cardinal per press) so a held key
    // does not spin the camera; forward/back are polled while held for smooth
    // repeated stepping.
    const turnLeftKeys = ['keydown-LEFT', 'keydown-A'];
    const turnRightKeys = ['keydown-RIGHT', 'keydown-D'];
    for (const ev of turnLeftKeys) kb.on(ev, () => this._queueTurn('left'), this);
    for (const ev of turnRightKeys) kb.on(ev, () => this._queueTurn('right'), this);

    // Escape abandons the run and returns straight to the main menu (no
    // game-over / high-score write) — the chosen "quit to menu" behavior.
    kb.on('keydown-ESC', () => this._returnToMenu(), this);

    // Spacebar throws a Knowledge Power book. `_throwBook` is gated to the
    // unfrozen, scene-owned state, so pressing Space while a quiz/lesson/level-
    // clear overlay is open (which also listens for Space) does nothing here.
    kb.on('keydown-SPACE', () => this._throwBook(), this);

    this._setupMouseLook();
  }

  /**
   * Google-Street-View-style mouse look: click-drag on the view to pan the
   * camera freely (a live yaw/pitch offset on top of the current grid facing),
   * and on release SNAP the facing to the nearest cardinal so grid movement
   * still lines up with where you're looking. Free-look does not move the
   * player and is ignored while an overlay is open (frozen). Keyboard/touch
   * turning still works as before.
   */
  _setupMouseLook() {
    const input = this.input;
    if (!input) return;

    this._look = { dragging: false, startX: 0, startY: 0, yaw: 0, pitch: 0 };

    input.on('pointerdown', (p) => {
      if (!this.state || this.state.frozen) return;
      this._look.dragging = true;
      this._look.startX = p.x;
      this._look.startY = p.y;
      // Begin from the current offset so repeated drags accumulate naturally.
      this._look.baseYaw = this._look.yaw;
      this._look.basePitch = this._look.pitch;
    }, this);

    input.on('pointermove', (p) => {
      const look = this._look;
      if (!look || !look.dragging || !this.state || this.state.frozen) return;
      const w = this.scale?.width || this.game?.canvas?.width || 800;
      const h = this.scale?.height || this.game?.canvas?.height || 600;
      // Drag right → look right. ~1.2 screen widths = a full 360° for a
      // comfortable Street-View sensitivity.
      const yawPerPx = (Math.PI * 2) / (w * 1.2);
      const pitchPerPx = (Math.PI) / (h * 1.5);
      look.yaw = look.baseYaw + (p.x - look.startX) * yawPerPx;
      look.pitch = look.basePitch - (p.y - look.startY) * pitchPerPx;
      if (this.renderer && typeof this.renderer.setLookOffset === 'function') {
        this.renderer.setLookOffset(look.yaw, look.pitch);
      }
    }, this);

    const endDrag = () => {
      const look = this._look;
      if (!look || !look.dragging) return;
      look.dragging = false;
      this._snapLookToFacing();
    };
    input.on('pointerup', endDrag, this);
    input.on('pointerupoutside', endDrag, this);
  }

  /**
   * On drag release, choose the cardinal whose yaw is closest to where the
   * camera is now looking (base facing + free-look yaw), set that as the new
   * `facing` (animating the base yaw to it), and zero the look offset so the
   * base yaw cleanly owns the orientation again. Pitch eases back to level.
   */
  _snapLookToFacing() {
    const look = this._look;
    if (!look || !this.state) return;

    // Snap yaw only when the player looked far enough to intend a turn; small
    // nudges just recenter without changing facing.
    const yawOff = look.yaw;
    const quarter = Math.PI / 2;
    // How many cardinal steps the free-look yaw corresponds to (screen +x drag
    // turns the camera right, i.e. clockwise = turnRight).
    const steps = Math.round(yawOff / quarter);

    let facing = this.state.player.facing;
    const from = facing;
    for (let i = 0; i < Math.abs(steps); i++) {
      facing = steps > 0 ? turnRight(facing) : turnLeft(facing);
    }
    this.state.player.facing = setFacing(facing);

    // Zero the free-look offset and animate the base yaw to the new facing.
    look.yaw = 0;
    look.pitch = 0;
    if (this.renderer) {
      if (typeof this.renderer.setLookOffset === 'function') this.renderer.setLookOffset(0, 0);
      if (typeof this.renderer.animateTurn === 'function') this.renderer.animateTurn(from, this.state.player.facing);
    }
  }

  /**
   * Queue a "turn-and-go" corner intent (Left/Right). This is what makes corners
   * smooth: instead of a stop → turn → forward sequence, a single left/right
   * TURNS to that side and, if the tile ahead in the new facing is open, STEPS
   * into it in the same motion. At a dead-end (no open tile that way) it just
   * turns in place, so it still works as a plain turn.
   *
   * If a step is in flight, the intent is buffered (at most one, keep-latest)
   * and applied the instant the player reaches the next tile center — so you can
   * pre-tap the corner just before the junction and glide around it (Req 2.7).
   * @param {'left'|'right'} turn
   */
  _queueTurn(turn) {
    if (!this.state || this.state.frozen) return;
    // Turning ALWAYS succeeds in place and is applied immediately — it never
    // depends on a tile being open, so it never feels dead or "stuck in the
    // corner". Movement is a SEPARATE action (hold forward), so the flow is:
    // face the corridor you want (left/right), then go (up). Mid-traversal the
    // turn still applies right away so the camera is already facing the new way
    // when you reach the next tile; hold forward to continue down it.
    this._applyTurn(turn);
    // If the player is holding forward, keep moving: after the turn, the next
    // _pollInput tick re-buffers a forward move, so a held-forward corner is a
    // simple "tap the turn as you approach, keep holding up" — no precise stop.
  }

  /** Apply a turn to the player's facing and animate the camera (Req 2.4). */
  _applyTurn(turn) {
    if (!this.state) return;
    const from = this.state.player.facing;
    const to = turn === 'left' ? turnLeft(from) : turnRight(from);
    this.state.player.facing = setFacing(to);
    if (this.renderer) this.renderer.animateTurn(from, this.state.player.facing);
  }

  /**
   * Poll held move keys into a buffered forward/back intent. Only one intent is
   * retained during a traversal (Req 2.7); when idle the intent is applied on
   * the next `_stepMovement` tick.
   */
  _pollInput() {
    const c = this.cursors;
    const w = this.wasd;
    if (!c && !w) return;
    const down = (a, b) => (a && a.isDown) || (b && b.isDown);

    // Live held direction: while a move key is held, `_heldMoveDir` stays set so
    // `_continueOrConsume` keeps stepping corridor after corridor with no
    // re-press. Cleared when nothing is held so the player stops at rest.
    if (down(c && c.up, w && w.up)) {
      this._heldMoveDir = 'forward';
    } else if (down(c && c.down, w && w.down)) {
      this._heldMoveDir = 'back';
    } else {
      this._heldMoveDir = null;
    }
  }

  /**
   * Queue a forward/back move intent from a source OTHER than the polled
   * keyboard (the on-screen touch buttons). Routes through the exact same
   * `InputBuffer` path as `_pollInput` so touch and keyboard share one movement
   * pipeline (Req 2.6). Ignored while frozen (overlay open) or before state
   * exists.
   * @param {'forward'|'back'} dir
   */
  _queueMove(dir) {
    if (!this.state || this.state.frozen) return;
    this.state.buffer.push({ type: 'move', dir });
  }

  // --- Knowledge Power: throw a book (Spacebar / on-screen FIRE button) -------

  /**
   * Throw a Knowledge Power book in the player's current facing. Gated to the
   * unfrozen, scene-owned state so it never fires while an overlay (quiz/lesson/
   * level-clear) is open. When the meter is empty it is a soft no-op.
   *
   * The hit decision is DETERMINISTIC and runs here over the pure tile path
   * (`resolveBookThrow`): the nearest ghost on the straight line of tiles ahead
   * (up to `KNOWLEDGE.maxRangeTiles`, stopping at the first wall) is sent back
   * to its ghost-house spawn — the SAME per-ghost reset `_buildGhostStates`/
   * `resetPositions` use (col/row ← spawn, dir = null, exited = false). A hit
   * never changes score or lives. The renderer's arced book is purely cosmetic.
   */
  _throwBook() {
    if (!this.state || this.state.frozen || !this.knowledge) return;
    if (!this.knowledge.canThrow()) {
      // Empty meter: no throw, no charge spent. (Soft no-op — no error.)
      return;
    }

    // Spend one charge (always succeeds here since canThrow() was true).
    this.knowledge.throw();

    // Throw cue (silent no-op if audio/asset is unavailable — Property 22).
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.BOOK_THROW);
    }

    const player = { col: this.state.player.col, row: this.state.player.row };
    const facing = this.state.player.facing;

    // Cosmetic arced book from the renderer (guarded; no-op in headless/tests).
    if (this.renderer && typeof this.renderer.throwBook === 'function') {
      this.renderer.throwBook(player, facing, { maxRangeTiles: KNOWLEDGE.maxRangeTiles });
    }

    // Authoritative hit test over the pure tile path.
    const { hit } = resolveBookThrow(
      this.grid, player, facing, this.state.ghosts, KNOWLEDGE.maxRangeTiles,
    );
    if (hit && hit.ghost) {
      const ghost = hit.ghost;
      const dimMs = KNOWLEDGE.hitDimMs;

      // Start the hit ghost DIMMING OUT right as the book lands (guarded no-op
      // in headless/tests). The send-home + hit cue are DEFERRED until the dim
      // finishes: this makes the ghost visibly fade before it vanishes, and —
      // because AudioBus plays one sfx at a time — holding the BOOK_HIT cue back
      // past the dim lets the knowledge-power throw sting above play out instead
      // of being cut off in the same tick (so the "knowledge is power" sound is
      // heard on every throw).
      if (this.renderer && typeof this.renderer.dimGhost === 'function') {
        this.renderer.dimGhost(ghost.key, { durationMs: dimMs });
      }

      // After the dim: play the hit cue, send the ghost home, and re-place it —
      // `_renderGhosts` → `setGhosts` restores the group's solid opacity so the
      // re-homed ghost reappears at the house. Guarded so it no-ops if the scene
      // is shutting down or the ghost was already reset/invalidated meanwhile.
      this.time?.delayedCall?.(dimMs, () => {
        // No-op if the scene is shutting down or state was torn down.
        if (!this.scene || (this.scene.isActive && !this.scene.isActive())) return;
        if (!this.state || !ghost) return;
        // Already home/invalid (e.g. reset by a capture cycle in the meantime):
        // the dim already hid it and setGhosts will restore it — skip the hit
        // cue + redundant send-home.
        const spawn = ghost.spawn;
        const alreadyHome = spawn && ghost.col === spawn.col && ghost.row === spawn.row && !ghost.exited;
        if (alreadyHome) {
          this._renderGhosts();
          return;
        }
        if (this.audio && typeof this.audio.play === 'function') {
          this.audio.play(AudioEvent.BOOK_HIT);
        }
        this._sendGhostHome(ghost);
        // Re-place the ghost at home; setGhosts restores its normal opacity.
        this._renderGhosts();
      }, [], this);
    }

    // Reflect the spent charge in the HUD immediately.
    this._updateKnowledgeHud();
  }

  /**
   * Send a single ghost back to its ghost-house spawn — the SAME per-ghost
   * reset used elsewhere (col/row ← its `spawn`, heading cleared, and
   * `exited = false` so it must re-exit the house). Does NOT touch score/lives.
   * @param {{col:number,row:number,spawn?:{col:number,row:number},dir:?string,exited:boolean}} ghost
   */
  _sendGhostHome(ghost) {
    if (!ghost) return;
    const spawn = ghost.spawn || { col: ghost.col, row: ghost.row };
    ghost.col = spawn.col;
    ghost.row = spawn.row;
    ghost.dir = null;
    ghost.exited = false;
  }

  // --- One-thumb touch gestures (Req 1, 2, 4, 5, 7, 8) -----------------------

  /**
   * Attach the raw touch/pointer listeners that feed the framework-agnostic
   * gesture pipeline. This is the ONLY place the DOM touch events are wired; the
   * classification (`gestureClassifier`) and vector→intent resolution
   * (`gestureResolve`) are pure modules, and the resulting intents flow through
   * the SAME `fp3dLogic` seam the keyboard uses (Req 7.1, 8.1–8.3) — this scene
   * never forks movement/turn/tunnel/buffer logic.
   *
   * Touch events are preferred (`touchstart`/`touchmove`/`touchend`); when the
   * platform reports no `ontouchstart` we fall back to Pointer Events
   * (`pointerdown`/`pointermove`/`pointerup`), filtered to `touch`/`pen` so a
   * mouse still drives the existing click-drag free-look (`_setupMouseLook`)
   * rather than double-anchoring a Floating_Joystick. Listeners live on the game
   * surface element and are removed on shutdown.
   */
  _setupTouchGestures() {
    if (typeof document === 'undefined') return; // headless / tests

    const surface = this._surfaceEl();
    if (!surface || typeof surface.addEventListener !== 'function') return;
    this._gestureSurface = surface;

    // Cache the overlay layer (`#overlay-root`) — the host of the quiz/lesson/
    // level-clear modals AND the on-screen controls. The gesture surface is
    // `#app`, an ANCESTOR of `#overlay-root`, so a tap on a modal button bubbles
    // up here. Without a guard the gesture handlers below `preventDefault()` the
    // touchstart and the browser never fires the button's synthetic `click`
    // (BUG 1). `_onTouchStart`/`_move`/`_end` short-circuit when the event
    // target is inside this element so the DOM control receives its tap intact.
    this._overlayRootEl = (typeof document !== 'undefined')
      ? document.getElementById('overlay-root')
      : null;

    // Floating_Joystick + sampling state for the active Touch_Hold (Req 1.1–1.6).
    //   origin        — anchored touch point ({x,y} in dip); null when no hold
    //   pointerId     — the id of the active touch so a 2nd concurrent touch is
    //                   ignored (Req 1.6)
    //   samples       — ordered {x,y,t} samples for classifyGesture (Req 1.3)
    //   vector        — live Movement_Vector (point - origin)
    // `_tapCtx` carries the previous Tap so a Double_Tap can be detected across
    // interactions (Req 5.9); it is the classifier `ctx`.
    this._touch = { origin: null, pointerId: null, samples: null, vector: null };
    this._tapCtx = { prevTapAt: null, prevTapPos: null };

    const supportsTouch = typeof window !== 'undefined' && 'ontouchstart' in window;

    if (supportsTouch) {
      this._touchHandlers = {
        start: (e) => this._onTouchStart(e),
        move: (e) => this._onTouchMove(e),
        end: (e) => this._onTouchEnd(e),
      };
      surface.addEventListener('touchstart', this._touchHandlers.start, { passive: false });
      surface.addEventListener('touchmove', this._touchHandlers.move, { passive: false });
      surface.addEventListener('touchend', this._touchHandlers.end, { passive: false });
      surface.addEventListener('touchcancel', this._touchHandlers.end, { passive: false });
      this._touchMode = 'touch';
    } else {
      // Pointer Events fallback — only touch/pen anchor a joystick; a mouse is
      // left to the existing free-look so the two input models don't collide.
      this._pointerHandlers = {
        down: (e) => { if (e.pointerType !== 'mouse') this._onTouchStart(e); },
        move: (e) => { if (e.pointerType !== 'mouse') this._onTouchMove(e); },
        up: (e) => { if (e.pointerType !== 'mouse') this._onTouchEnd(e); },
      };
      surface.addEventListener('pointerdown', this._pointerHandlers.down);
      surface.addEventListener('pointermove', this._pointerHandlers.move);
      surface.addEventListener('pointerup', this._pointerHandlers.up);
      surface.addEventListener('pointercancel', this._pointerHandlers.up);
      this._touchMode = 'pointer';
    }
  }

  /**
   * Normalize a touch/pointer event to a single `{ x, y, t, id }` sample in
   * device-independent pixels relative to the surface, plus a stable pointer id
   * used to reject a second concurrent touch. For a `TouchEvent` the first
   * `changedTouches` entry is used; for a `PointerEvent` the event itself.
   * @param {TouchEvent|PointerEvent} e
   * @returns {{ x:number, y:number, t:number, id:(number|string) }|null}
   */
  _samplePoint(e) {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    let clientX;
    let clientY;
    let id;
    if (e && e.changedTouches && e.changedTouches.length) {
      const t = e.changedTouches[0];
      clientX = t.clientX;
      clientY = t.clientY;
      id = t.identifier;
    } else if (e && typeof e.clientX === 'number') {
      clientX = e.clientX;
      clientY = e.clientY;
      id = e.pointerId != null ? e.pointerId : 'pointer';
    } else {
      return null;
    }
    // Convert to surface-local dip so the anchor and samples share one frame.
    let x = clientX;
    let y = clientY;
    const surface = this._gestureSurface;
    if (surface && typeof surface.getBoundingClientRect === 'function') {
      try {
        const r = surface.getBoundingClientRect();
        x = clientX - r.left;
        y = clientY - r.top;
      } catch { /* keep client coords */ }
    }
    return { x, y, t: now, id };
  }

  /**
   * Whether a touch/pointer event originated inside the overlay layer
   * (`#overlay-root`) — i.e. on a quiz/lesson/level-clear modal or an on-screen
   * control. The gesture surface (`#app`) is an ancestor of the overlay root,
   * so such events bubble up here; when they do, the gesture handlers must let
   * the event proceed to the DOM control (NO `preventDefault`, no joystick
   * anchoring) so the button's `click` fires (BUG 1). Robust for both
   * `TouchEvent` and `PointerEvent` — both expose `e.target`.
   * @param {TouchEvent|PointerEvent} e
   * @returns {boolean}
   */
  _eventInOverlay(e) {
    const root = this._overlayRootEl;
    if (!root || !e || typeof root.contains !== 'function') return false;
    const target = e.target;
    if (!target) return false;
    try {
      return root.contains(target);
    } catch {
      return false;
    }
  }

  /**
   * Whether a point (client coords) lands over an interactive on-screen control
   * we must not treat as a Floating_Joystick anchor — the Fullscreen_Toggle
   * (Req 1.1). Uses each control's bounding rect so a Touch_Hold that begins on
   * the button starts no movement.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {boolean}
   */
  _pointOverInteractiveControl(clientX, clientY) {
    // Any of the on-screen controls: the Fullscreen_Toggle, the visible
    // Virtual_Joystick base, and the turn buttons. A touch that STARTS on one of
    // these must NOT also anchor the free-look / gesture origin on the surface,
    // so the joystick and the invisible-gesture handlers never fight over the
    // same finger.
    const els = [
      this._fullscreenToggle && this._fullscreenToggle.el,
      this._joystick && this._joystick.el,
      this._touchControls && typeof this._touchControls.querySelector === 'function'
        ? this._touchControls.querySelector('.fp3d-turn-cluster')
        : null,
    ];
    for (const el of els) {
      if (!el || typeof el.getBoundingClientRect !== 'function') continue;
      try {
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return true;
        }
      } catch { /* skip this control */ }
    }
    return false;
  }

  /**
   * Begin a Touch_Hold: anchor a Floating_Joystick origin at the touch point and
   * enter movement mode (Req 1.1). A point over the Fullscreen_Toggle is ignored
   * so the control handles it (Req 1.1); a second concurrent touch is ignored so
   * the original origin is retained (Req 1.6). No persistent on-screen joystick
   * is drawn (Req 1.2) — the origin lives only in `_touch`.
   * @param {TouchEvent|PointerEvent} e
   */
  _onTouchStart(e) {
    if (!this._touch) return;
    // Event originated inside the overlay layer (a modal button or on-screen
    // control) → let it proceed to the DOM control untouched so its click fires
    // (BUG 1). Return immediately WITHOUT preventDefault and without anchoring a
    // Floating_Joystick.
    if (this._eventInOverlay(e)) return;
    // A hold already active → a second concurrent touch changes nothing (Req 1.6).
    if (this._touch.origin) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      return;
    }

    // Over an interactive control (Fullscreen_Toggle) → no joystick (Req 1.1).
    const clientX = (e.changedTouches && e.changedTouches.length)
      ? e.changedTouches[0].clientX
      : e.clientX;
    const clientY = (e.changedTouches && e.changedTouches.length)
      ? e.changedTouches[0].clientY
      : e.clientY;
    if (this._pointOverInteractiveControl(clientX, clientY)) return;

    const p = this._samplePoint(e);
    if (!p) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    this._touch.origin = { x: p.x, y: p.y };
    this._touch.pointerId = p.id;
    this._touch.samples = [{ x: p.x, y: p.y, t: p.t }];
    this._touch.vector = { x: 0, y: 0 };
  }

  /**
   * Sample the active Touch_Hold: record `{x,y,t}` and recompute the
   * Movement_Vector relative to the anchored origin (Req 1.3). Samples from a
   * second concurrent touch (a different pointer id) are ignored (Req 1.6).
   * While an overlay is open the samples are still recorded but produce no
   * movement — the freeze is enforced at dispatch (Req 8.4).
   * @param {TouchEvent|PointerEvent} e
   */
  _onTouchMove(e) {
    const touch = this._touch;
    if (!touch || !touch.origin) return;
    // Defensive (BUG 1): if the finger has drifted over the overlay layer, do
    // not preventDefault — let the DOM control keep the event.
    if (this._eventInOverlay(e)) return;
    const p = this._samplePoint(e);
    if (!p) return;
    // Only the pointer that anchored the origin drives the vector (Req 1.6).
    if (touch.pointerId != null && p.id !== touch.pointerId) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    touch.samples.push({ x: p.x, y: p.y, t: p.t });
    touch.vector = movementVector(touch.origin, { x: p.x, y: p.y });
  }

  /**
   * End the Touch_Hold (Release): classify the completed interaction to exactly
   * one Gesture, dispatch it through the `fp3dLogic` seam, then clear the origin
   * and stop movement (Req 1.4). A Release from a non-anchoring pointer is
   * ignored. The classifier context (`_tapCtx`) is advanced so a following Tap
   * can pair into a Double_Tap (Req 5.9).
   * @param {TouchEvent|PointerEvent} e
   */
  _onTouchEnd(e) {
    const touch = this._touch;
    if (!touch || !touch.origin) return;
    // Defensive (BUG 1): a hold that began outside but is RELEASED over the
    // overlay layer must not preventDefault, or the modal button's click would
    // be suppressed. Clear the gesture state without dispatching a gesture.
    if (this._eventInOverlay(e)) {
      this._touch.origin = null;
      this._touch.pointerId = null;
      this._touch.samples = null;
      this._touch.vector = null;
      return;
    }
    const p = this._samplePoint(e);
    // Release from a different pointer than the active hold → ignore (Req 1.6).
    if (p && touch.pointerId != null && p.id !== touch.pointerId) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (p) touch.samples.push({ x: p.x, y: p.y, t: p.t });

    const result = classifyGesture(touch.samples, GESTURE, this._tapCtx);
    const facing = this.state ? this.state.player.facing : 'north';
    this._dispatchGesture(result, facing);

    // Advance the Double_Tap context using this interaction's START (Req 5.9).
    if (result.gesture === 'Tap' || result.gesture === 'Double_Tap') {
      const first = touch.samples[0];
      this._tapCtx = { prevTapAt: first.t, prevTapPos: { x: first.x, y: first.y } };
    }

    // Release: clear the Floating_Joystick origin and stop movement (Req 1.4).
    // A held continuous walk is a keyboard concept; a gesture move is a single
    // buffered intent, so clearing the origin ends the "movement mode".
    this._touch.origin = null;
    this._touch.pointerId = null;
    this._touch.samples = null;
    this._touch.vector = null;
  }

  /**
   * Route one classified {@link classifyGesture} result to the EXISTING
   * `fp3dLogic` seam — never a forked movement/turn/tunnel/buffer path (Req 7):
   *
   *   - **Drag** → `resolveMovementVector`:
   *       - `move`  → push a `{ type:'move' }` intent into the existing
   *         `InputBuffer`. A cardinal move carries a single `steps` entry; a
   *         `diagonal` carries its two nearest cardinals dominant-axis-first,
   *         fed one leg at a time and skipping a blocked leg (Req 2.4, 2.7).
   *       - `steer` → adjust facing to the nearest cardinal via
   *         `fp3dLogic.setFacing` with NO tile move (Req 2.8).
   *   - **Flick** → `resolveFlickTurn` → push a `{ type:'turn' }` intent (Req 4).
   *   - **Double_Tap** → push a forward dash `{ type:'move' }` intent (Req 5.4).
   *   - **Tap** → `interactUnderCrosshair()` (Req 5.1–5.3).
   *   - **Long_Press** → `inspectUnderCrosshair()` (Req 5.6, 5.7).
   *
   * All gesture-derived MOVE/TURN intents are frozen while a quiz/lesson overlay
   * is open (Req 8.4). Interactions (Tap/Long_Press) are likewise ignored while
   * frozen. Under Reduced_Motion the resulting grid-locked position and cardinal
   * facing still change; only non-essential camera motion is suppressed, which
   * the renderer already honors via its reduced-motion flag (Req 7.5, 8.5).
   * @param {{gesture:string, vector?:{x:number,y:number}, direction?:('left'|'right')}} result
   * @param {'north'|'east'|'south'|'west'} facing current facing
   */
  _dispatchGesture(result, facing) {
    if (!result || !this.state) return;
    const frozen = this.state.frozen;

    switch (result.gesture) {
      case 'Drag': {
        if (frozen) return; // overlay open: no move/turn (Req 8.4)
        const outcome = resolveMovementVector(result.vector || { x: 0, y: 0 }, GESTURE);
        if (outcome.kind === 'steer') {
          // Gentle steering: adjust facing to the nearest cardinal, no move
          // (Req 2.8). Reuse fp3dLogic.setFacing so exactly one cardinal is set.
          this._applyGestureFacing(setFacing(outcome.toward));
        } else {
          // A move intent (single cardinal or a diagonal sequence). The buffer
          // holds at most one intent; extras are dropped (Req 7.3).
          this.state.buffer.push({ type: 'move', gesture: true, steps: outcome.steps.slice() });
        }
        return;
      }
      case 'Flick': {
        if (frozen) return; // overlay open: no move/turn (Req 8.4)
        const to = resolveFlickTurn(setFacing(facing), result.direction === 'left' ? 'left' : 'right');
        this.state.buffer.push({ type: 'turn', gesture: true, to });
        return;
      }
      case 'Double_Tap': {
        if (frozen) return; // overlay open: no move/turn (Req 8.4)
        // Forward dash of exactly one grid move in the current facing (Req 5.4).
        this.state.buffer.push({ type: 'move', gesture: true, steps: ['forward'] });
        return;
      }
      case 'Tap': {
        if (frozen) return; // overlay open: interactions suspended (Req 8.4)
        this.interactUnderCrosshair();
        return;
      }
      case 'Long_Press': {
        if (frozen) return;
        this.inspectUnderCrosshair();
        return;
      }
      default:
        // Touch_Hold / Release / anything else: no discrete action.
    }
  }

  /**
   * Apply a gesture-derived facing change to exactly one cardinal and animate
   * the camera turn (Req 2.8, 7.2). Reuses the same `renderer.animateTurn` the
   * keyboard turn path uses, so Reduced_Motion snapping is honored identically.
   * @param {'north'|'east'|'south'|'west'} to target cardinal
   */
  _applyGestureFacing(to) {
    if (!this.state) return;
    const from = this.state.player.facing;
    const next = setFacing(to);
    if (next === from) return;
    this.state.player.facing = next;
    if (this.renderer && typeof this.renderer.animateTurn === 'function') {
      this.renderer.animateTurn(from, next);
    }
  }

  // --- Interaction targeting under the Crosshair (Req 5, 6) ------------------

  /**
   * Walk the Crosshair line (the player's current facing ray) and return the
   * nearest present, in-range Interactable tile on it, or null. Per the design's
   * Interactable mapping, FRUIT is the only Interactable in FP3D_Mode today —
   * pellets are auto-collected on tile entry and ghosts capture on tile
   * occupancy, so neither is targetable. The seam is generic against
   * `state.fruits`: if a future task adds doors/ladders/pickups, they extend the
   * same targeting adapter rather than forking it.
   *
   * A tile is targeted only when the straight facing ray reaches it with no wall
   * strictly between (reusing the framework-agnostic `hasLineOfSight` walk) and
   * it is within `GESTURE.interactionRangeTiles` of the camera (Req 5.2, 6.1,
   * 6.5). The nearest such fruit along the ray wins (Req 5.2).
   * @returns {{ kind:'fruit', fruit:object, distance:number }|null}
   */
  _targetUnderCrosshair() {
    const st = this.state;
    const grid = this.grid;
    if (!st || !grid) return null;

    const { col, row, facing } = st.player;
    const step = {
      north: { dCol: 0, dRow: -1 },
      south: { dCol: 0, dRow: 1 },
      west: { dCol: -1, dRow: 0 },
      east: { dCol: 1, dRow: 0 },
    }[facing] || { dCol: 0, dRow: -1 };

    const range = GESTURE.interactionRangeTiles;
    let best = null;
    // Walk straight ahead tile by tile within range; the nearest matching fruit
    // that is not blocked by a wall between the camera and it wins.
    for (let d = 1; d <= range; d++) {
      const tc = col + step.dCol * d;
      const tr = row + step.dRow * d;
      if (grid.isWall(tc, tr)) break; // wall occludes anything beyond it
      const fruit = (st.fruits || []).find((f) => f.present && f.col === tc && f.row === tr);
      if (fruit && hasLineOfSight(grid, col, row, tc, tr)) {
        best = { kind: 'fruit', fruit, distance: d };
        break; // nearest along the ray
      }
    }
    return best;
  }

  /**
   * Primary interaction (Tap): act on the nearest present, in-range Interactable
   * under the Crosshair (Req 5.1, 5.2). For a fruit this calls the EXACT
   * tile-entry collection path (`_onFruitCollected` → shared `ScoreSystem` +
   * `LessonScene`), so Tap-to-collect forks no scoring/lesson logic — it is a
   * convenience over walking onto the tile. When nothing is targeted it is a
   * no-op and leaves position and facing unchanged (Req 5.3).
   */
  interactUnderCrosshair() {
    if (!this.state || this.state.frozen) return;
    const target = this._targetUnderCrosshair();
    if (!target) return; // no Interactable under the Crosshair (Req 5.3)
    if (target.kind === 'fruit' && target.fruit.present) {
      this._onFruitCollected(target.fruit);
    }
  }

  /**
   * Secondary interaction (Long_Press / inspect): preview the targeted
   * Interactable without consuming it or moving (Req 5.6). For a fruit this
   * shows its micro-lesson topic as the Interaction_Indicator label without
   * launching `LessonScene` or collecting the fruit. When nothing is targeted it
   * is a no-op and leaves position and facing unchanged (Req 5.7).
   */
  inspectUnderCrosshair() {
    if (!this.state || this.state.frozen) return;
    const target = this._targetUnderCrosshair();
    if (!target) return; // nothing to inspect (Req 5.7)
    if (target.kind === 'fruit' && target.fruit.present) {
      const topic = this._fruitInspectLabel();
      if (this.renderer && typeof this.renderer.setInteractionIndicator === 'function') {
        this.renderer.setInteractionIndicator(topic);
      }
    }
  }

  /**
   * A short inspect label (≤24 chars) for a fruit's micro-lesson. Peeks at the
   * next LessonBank topic without consuming a lesson when possible; falls back
   * to a generic "INSPECT" when no topic is available. Kept ≤24 chars to match
   * the Interaction_Indicator contract (Req 6.1).
   * @returns {string}
   */
  _fruitInspectLabel() {
    let topic = null;
    const bank = this.lessonBank;
    if (bank) {
      if (typeof bank.peek === 'function') {
        try { const l = bank.peek(); topic = l && (l.topic || l.title); } catch { /* ignore */ }
      }
    }
    const label = topic ? String(topic).toUpperCase() : 'INSPECT';
    return label.slice(0, 24);
  }

  /**
   * Drive `FP3DRenderer.setInteractionIndicator(...)` from whatever Interactable
   * is currently under the Crosshair (Req 6.1, 6.5). Shows the primary action
   * label ("COLLECT") for a present, in-range fruit and hides the indicator
   * (null) when none is targeted, out of range, or removed. Called every
   * unfrozen frame so the affordance appears/updates/clears well within 100 ms.
   */
  _updateInteractionIndicator() {
    if (!this.renderer || typeof this.renderer.setInteractionIndicator !== 'function') return;
    const target = this._targetUnderCrosshair();
    const label = target && target.kind === 'fruit' ? 'COLLECT' : null;
    this.renderer.setInteractionIndicator(label);
  }

  // --- Fullscreen toggle (Req 9) ---------------------------------------------

  /**
   * Construct the accessible Fullscreen_Toggle over the game surface and mount
   * it on `#overlay-root` (the same host as the quiz/lesson modals). The helper
   * returns `null` when the Fullscreen API is unavailable, in which case no
   * control is added and gameplay continues (Req 9.5). A rejected request is
   * caught inside the helper; here we only log via the `onError` hook. The
   * button carries the `fp3d-fullscreen-btn` class so index.html positions it
   * responsively (BUG 2): top-right on desktop, and — because the minimap moves
   * to the top-right on coarse-pointer devices — relocated to the left edge
   * below the "← Menu" button on touch, so it never hides under the minimap.
   */
  _buildFullscreenToggle() {
    if (typeof document === 'undefined') return; // headless / tests
    const surface = this._surfaceEl();
    if (!surface) return;

    const toggle = createFullscreenToggle(surface, {
      onError: (err) => console.warn('FP3DScene: fullscreen request failed', err || ''),
    });
    if (!toggle) return; // API unavailable → no control (Req 9.5)

    const root = document.getElementById('overlay-root') || document.body;
    if (root && toggle.el) {
      // Tag the element with a stable class so index.html owns its responsive
      // placement (BUG 2): on desktop it keeps its top-right spot; on coarse-
      // pointer (touch) devices — where the minimap moves to the top-right — the
      // CSS relocates it to the LEFT edge below the "← Menu" button so it never
      // hides under the minimap or the return-to-menu control, honors safe-area
      // insets, and stays a comfortable tap size. Only z-index is kept inline as
      // a floor so it always sits above the minimap.
      toggle.el.classList.add('fp3d-fullscreen-btn');
      Object.assign(toggle.el.style, {
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: '25',
        pointerEvents: 'auto',
      });
      root.appendChild(toggle.el);
    }
    this._fullscreenToggle = toggle;
  }

  // --- Discreet on-screen "return to menu" control ---------------------------

  /**
   * Build a subtle, unobtrusive "return to menu" control on `#overlay-root`
   * (the same host as the touch controls / Fullscreen_Toggle). It is a real
   * `<button>` tucked in the TOP-LEFT corner at low opacity, becoming more
   * visible on hover/focus, so it does not distract from play but is always
   * reachable. Clicking it — or focusing it and pressing Enter/Space — routes
   * to the SAME `_returnToMenu()` the Escape key uses. It carries an
   * `aria-label` and a visible focus ring for keyboard/AT users. Positioned in a
   * corner and stopping propagation only on its own activation so it never
   * captures the gameplay touches used for movement. No-op in headless/tests.
   */
  _buildReturnToMenuButton() {
    if (typeof document === 'undefined') return; // headless / tests
    const root = document.getElementById('overlay-root') || document.body;
    if (!root) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fp3d-return-menu';
    btn.setAttribute('aria-label', 'Return to menu');
    // A small back glyph; the accessible name comes from aria-label above.
    btn.textContent = '\u2190 Menu';
    Object.assign(btn.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      zIndex: '20',
      pointerEvents: 'auto',
      padding: '4px 8px',
      font: '600 12px/1.2 monospace',
      color: '#cfe0ff',
      background: 'rgba(0, 0, 20, 0.35)',
      border: '1px solid rgba(120, 160, 255, 0.4)',
      borderRadius: '6px',
      opacity: '0.28', // discreet at rest…
      cursor: 'pointer',
      transition: 'opacity 120ms ease',
      touchAction: 'manipulation',
      userSelect: 'none',
    });

    // …but clearly visible (and shows a focus ring) on hover/focus.
    const reveal = () => { btn.style.opacity = '1'; btn.style.outline = '2px solid #ffe000'; };
    const dim = () => { btn.style.opacity = '0.28'; btn.style.outline = 'none'; };
    btn.addEventListener('mouseenter', reveal);
    btn.addEventListener('mouseleave', dim);
    btn.addEventListener('focus', reveal);
    btn.addEventListener('blur', dim);

    // Activate on pointerdown for a snappy tap, and on click so keyboard
    // Enter/Space activation also works (the browser synthesizes a click).
    // Stop propagation only on THIS control's own events so a tap here never
    // anchors a movement joystick, while gameplay touches elsewhere are
    // untouched. A pointer-handled activation swallows the following click.
    let handledByPointer = false;
    btn.addEventListener('pointerdown', (e) => {
      handledByPointer = true;
      e.preventDefault();
      e.stopPropagation();
      this._returnToMenu();
    });
    btn.addEventListener('click', (e) => {
      if (handledByPointer) { handledByPointer = false; return; }
      e.preventDefault();
      e.stopPropagation();
      this._returnToMenu();
    });

    root.appendChild(btn);
    this._returnMenuBtn = btn;
  }

  /** Remove the discreet return-to-menu control (scene teardown). */
  _destroyReturnToMenuButton() {
    if (this._returnMenuBtn) {
      try {
        this._returnMenuBtn.remove();
      } catch {
        if (this._returnMenuBtn.parentNode) {
          this._returnMenuBtn.parentNode.removeChild(this._returnMenuBtn);
        }
      }
      this._returnMenuBtn = null;
    }
  }

  /**
   * The game surface element used as the fullscreen target and the touch-event
   * host: the `#app` container (which wraps the canvas and the overlay root) so
   * fullscreen brings the whole game surface, not just the canvas. Falls back to
   * the canvas' parent, then the canvas, then `document.body`.
   * @returns {HTMLElement|null}
   */
  _surfaceEl() {
    if (typeof document !== 'undefined') {
      const app = document.getElementById('app');
      if (app) return app;
    }
    const gameCanvas = this.game && this.game.canvas;
    if (gameCanvas && gameCanvas.parentElement) return gameCanvas.parentElement;
    if (gameCanvas) return gameCanvas;
    if (typeof document !== 'undefined' && document.body) return document.body;
    return null;
  }

  /** Remove the touch/pointer gesture listeners and the Fullscreen_Toggle. */
  _destroyTouchGestures() {
    const surface = this._gestureSurface;
    if (surface && typeof surface.removeEventListener === 'function') {
      if (this._touchHandlers) {
        surface.removeEventListener('touchstart', this._touchHandlers.start);
        surface.removeEventListener('touchmove', this._touchHandlers.move);
        surface.removeEventListener('touchend', this._touchHandlers.end);
        surface.removeEventListener('touchcancel', this._touchHandlers.end);
      }
      if (this._pointerHandlers) {
        surface.removeEventListener('pointerdown', this._pointerHandlers.down);
        surface.removeEventListener('pointermove', this._pointerHandlers.move);
        surface.removeEventListener('pointerup', this._pointerHandlers.up);
        surface.removeEventListener('pointercancel', this._pointerHandlers.up);
      }
    }
    this._touchHandlers = null;
    this._pointerHandlers = null;
    this._gestureSurface = null;
    this._overlayRootEl = null;
    this._touch = null;

    if (this._fullscreenToggle && typeof this._fullscreenToggle.destroy === 'function') {
      try { this._fullscreenToggle.destroy(); } catch { /* ignore */ }
    }
    this._fullscreenToggle = null;
  }

  // --- On-screen touch controls (Req 2.6) ------------------------------------

  /**
   * Build a DOM overlay of on-screen controls layered above the game canvas so
   * FP3D_Mode is comfortably playable on a touch device (Req 2.6). The controls
   * map to the SAME intent pipeline as the keyboard/gestures — no forked
   * movement or turn logic:
   *   - VISIBLE Virtual_Joystick (bottom-LEFT) → its normalized vector is
   *     resolved by `resolveMovementVector` (screen up = -y ⇒ forward) and the
   *     resulting move/steer feeds the existing `InputBuffer`/`_beginGestureStep`
   *     seam, driving continuous forward/strafe stepping while held.
   *   - Turn ◀ / ▶ (bottom-RIGHT), large buttons → `_queueTurn('left'|'right')`.
   *   - a labeled "Reduced motion" toggle (Req 7.4).
   * Turn buttons and the toggle are real `<button>`s — keyboard-focusable
   * (Tab/Enter/Space) with an `aria-label` — so they are operable without a
   * pointer too. The joystick is a pointer-only control (keyboard players keep
   * the full keyboard scheme), so it stays out of the tab order.
   *
   * The overlay lives on `#overlay-root` (same host as the quiz/lesson modals)
   * and is hidden while the scene is frozen so it never appears over or steals
   * input from an open quiz/lesson overlay (Req 6.7). It is only SHOWN on touch
   * / coarse-pointer devices; on a desktop mouse/keyboard setup it stays hidden
   * so it does not clutter that experience.
   */
  _buildTouchControls() {
    if (typeof document === 'undefined') return; // headless / tests
    const root = document.getElementById('overlay-root');
    if (!root) return;

    const container = document.createElement('div');
    container.className = 'fp3d-touch-controls';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'First-person movement controls');
    Object.assign(container.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none', // children opt back in; empty gaps stay click-through
      display: 'block',
      boxSizing: 'border-box',
    });

    const makeButton = (label, ariaLabel, onActivate) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.setAttribute('aria-label', ariaLabel);
      Object.assign(btn.style, {
        pointerEvents: 'auto',
        minWidth: '64px',
        minHeight: '64px',
        margin: '6px',
        fontSize: '22px',
        fontWeight: '700',
        color: '#0d0d2b',
        background: 'rgba(255, 224, 0, 0.85)', // UI-kit yellow, slightly translucent
        border: '2px solid #ffe000',
        borderRadius: '12px',
        touchAction: 'manipulation',
        userSelect: 'none',
      });
      // Fire on pointerdown for snappy touch, and on click so keyboard
      // Enter/Space activation also works (click is synthesized by the browser
      // for keyboard activation). Guard against a double-fire from the same
      // gesture by swallowing the click that follows a pointerdown. Stop
      // propagation so a tap on a control never also anchors the free-look /
      // gesture origin on the game surface.
      let handledByPointer = false;
      btn.addEventListener('pointerdown', (e) => {
        handledByPointer = true;
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      });
      btn.addEventListener('click', (e) => {
        if (handledByPointer) {
          handledByPointer = false;
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      });
      return btn;
    };

    // --- Visible Virtual_Joystick (bottom-LEFT) ------------------------------
    // Feeds the SAME movement seam as gestures/keyboard: its analog vector is
    // resolved by `resolveMovementVector` and pushed through the InputBuffer.
    const joystick = createVirtualJoystick(container, {
      ariaLabel: 'Movement joystick',
      onChange: (v) => this._onJoystickChange(v),
      onEnd: () => this._onJoystickEnd(),
      document,
    });
    this._joystick = joystick;

    // --- Turn buttons (bottom-RIGHT) -----------------------------------------
    const turnCluster = document.createElement('div');
    turnCluster.className = 'fp3d-turn-cluster';
    Object.assign(turnCluster.style, {
      position: 'absolute',
      display: 'flex',
      alignItems: 'flex-end',
      pointerEvents: 'none', // buttons opt back in individually
    });
    const turnLeftBtn = makeButton('\u25C0', 'Turn left', () => this._queueTurn('left'));
    const turnRightBtn = makeButton('\u25B6', 'Turn right', () => this._queueTurn('right'));
    turnLeftBtn.classList.add('fp3d-turn-btn');
    turnRightBtn.classList.add('fp3d-turn-btn');
    turnCluster.appendChild(turnLeftBtn);
    turnCluster.appendChild(turnRightBtn);
    container.appendChild(turnCluster);

    // --- Reduced-motion toggle (top area of the right cluster) ---------------
    const motionBtn = makeButton(
      this._reducedMotion ? 'Motion: off' : 'Motion: on',
      'Toggle reduced motion',
      () => this._toggleReducedMotion(),
    );
    motionBtn.classList.add('fp3d-motion-btn');
    motionBtn.setAttribute('aria-pressed', this._reducedMotion ? 'true' : 'false');
    Object.assign(motionBtn.style, {
      position: 'absolute',
      minWidth: '120px',
      minHeight: '44px',
      fontSize: '14px',
    });
    this._motionBtn = motionBtn;
    container.appendChild(motionBtn);

    // --- Knowledge Power FIRE button (bottom-center) -------------------------
    // Throws a book, same action as the Spacebar. A real <button> so it is
    // keyboard-focusable/operable; `makeButton` already stops propagation so a
    // tap here never also anchors the free-look / joystick origin.
    const fireBtn = makeButton('\uD83D\uDCDA', 'Throw book', () => this._throwBook());
    fireBtn.classList.add('fp3d-fire-btn');
    Object.assign(fireBtn.style, {
      position: 'absolute',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      minWidth: '72px',
      minHeight: '72px',
      fontSize: '30px',
      background: 'rgba(120, 90, 255, 0.85)', // distinct from the yellow move/turn buttons
      border: '2px solid #b9a8ff',
      color: '#fff',
    });
    this._fireBtn = fireBtn;
    container.appendChild(fireBtn);

    root.appendChild(container);
    this._touchControls = container;

    // Only surface the on-screen controls on touch / coarse-pointer devices;
    // keep them hidden on a desktop mouse/keyboard setup so they don't clutter
    // that experience. Full keyboard play remains available regardless.
    this._touchControlsSupported = this._isTouchLikeDevice();
    if (!this._touchControlsSupported) {
      container.style.display = 'none';
    }
  }

  /**
   * Whether this device should show the on-screen touch controls: a touch
   * capability or a coarse pointer (phones/tablets). Guarded for environments
   * without `matchMedia`/`window` (tests) — defaults to false there.
   * @returns {boolean}
   */
  _isTouchLikeDevice() {
    try {
      if (typeof window === 'undefined') return false;
      if ('ontouchstart' in window) return true;
      return typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  /**
   * Handle a Virtual_Joystick update. Resolves the analog vector through the
   * EXISTING framework-agnostic `resolveMovementVector` (screen convention up =
   * -y ⇒ forward) and feeds the result into the SAME movement pipeline as the
   * gestures and keyboard — no forked movement/turn logic (Req 7):
   *   - a `steer` (sub-deadzone) result adjusts facing to the nearest cardinal
   *     with NO tile move, via `_applyGestureFacing`;
   *   - a `move` result becomes a continuously HELD gesture-step sequence
   *     (`_heldGestureSteps`) that `_continueOrConsume` re-issues each tile so
   *     holding the stick walks corridor to corridor, exactly like held-forward
   *     keyboard walking.
   * Ignored while frozen (overlay open) — the freeze contract is enforced here
   * and again at consumption time.
   * @param {{x:number, y:number, magnitude:number}} v normalized joystick vector
   */
  _onJoystickChange(v) {
    if (!this.state || this.state.frozen || !v) return;
    // Scale the normalized vector into the resolver's pixel space so magnitudes
    // below the joystick deadzone (already zeroed) fall under the movement
    // deadzone and above it clear the cardinal thresholds. The direction — not
    // the exact length — determines the discrete intent.
    const scale = (GESTURE.movementDeadzonePx || 18) * 4;
    const outcome = resolveMovementVector({ x: v.x * scale, y: v.y * scale }, GESTURE);
    if (outcome.kind === 'steer') {
      // Below the deadzone: gentle facing nudge only, no continuous walking.
      this._heldGestureSteps = null;
      this._applyGestureFacing(setFacing(outcome.toward));
      return;
    }
    // A move: hold this step sequence so the player keeps walking while the
    // stick is pushed. `_continueOrConsume` re-issues it on each tile arrival.
    this._heldGestureSteps = outcome.steps.slice();
  }

  /**
   * Handle Virtual_Joystick release: stop continuous walking by clearing the
   * held gesture-step sequence, mirroring how releasing a held forward key
   * stops keyboard walking. Any in-flight tile traversal finishes normally.
   */
  _onJoystickEnd() {
    this._heldGestureSteps = null;
  }

  /**
   * Show/hide the on-screen touch controls. Hidden while frozen so they never
   * appear over — or steal focus/input from — an open quiz/lesson overlay
   * (Req 6.7). Called from `_freeze`/`_unfreeze`. On desktop (no touch/coarse
   * pointer) the controls stay hidden regardless, so a resume never reveals
   * them there.
   * @param {boolean} visible
   */
  _setTouchControlsVisible(visible) {
    if (!this._touchControls) return;
    const show = visible && this._touchControlsSupported !== false;
    this._touchControls.style.display = show ? 'block' : 'none';
    if (this._joystick && typeof this._joystick.setVisible === 'function') {
      this._joystick.setVisible(show);
    }
    if (!show) this._heldGestureSteps = null;
  }

  // --- Score HUD + 2D minimap (bottom-right) ---------------------------------

  /**
   * Build the DOM HUD: a score/lives readout (top-left of the game container)
   * and a small top-down MINIMAP canvas in the BOTTOM-RIGHT showing the maze,
   * the player (with facing), and the ghosts. Both live on `#overlay-root` like
   * the touch controls, are pointer-transparent, and are redrawn each frame by
   * `_updateHud`. No-op in headless/tests (no document).
   */
  _buildHud() {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('overlay-root');
    if (!root) return;

    // Score / lives readout.
    const score = document.createElement('div');
    score.className = 'fp3d-hud-score';
    Object.assign(score.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      padding: '6px 12px',
      font: '700 18px/1.2 monospace',
      color: '#ffe000',
      background: 'rgba(0, 0, 20, 0.55)',
      border: '1px solid rgba(255, 224, 0, 0.5)',
      borderRadius: '8px',
      pointerEvents: 'none',
      textShadow: '0 1px 2px #000',
      whiteSpace: 'pre',
    });
    root.appendChild(score);
    this._hudScore = score;

    // Knowledge Power book bar: a labeled row of 10 book glyphs under the score,
    // filled books = current charge, dim books = spent slots. Updated per frame
    // in `_updateKnowledgeHud`.
    const knowledge = document.createElement('div');
    knowledge.className = 'fp3d-hud-knowledge';
    knowledge.setAttribute('role', 'status');
    knowledge.setAttribute('aria-label', 'Knowledge ammo');
    Object.assign(knowledge.style, {
      position: 'absolute',
      top: '46px',
      left: '10px',
      padding: '5px 10px',
      font: '700 13px/1 monospace',
      color: '#ffe000',
      background: 'rgba(0, 0, 20, 0.55)',
      border: '1px solid rgba(255, 224, 0, 0.5)',
      borderRadius: '8px',
      pointerEvents: 'none',
      textShadow: '0 1px 2px #000',
      whiteSpace: 'nowrap',
      letterSpacing: '1px',
    });

    const label = document.createElement('span');
    label.textContent = 'KNOWLEDGE AMMO ';
    label.style.verticalAlign = 'middle';
    knowledge.appendChild(label);

    const books = document.createElement('span');
    books.className = 'fp3d-hud-books';
    books.style.verticalAlign = 'middle';
    books.style.fontSize = '16px';
    knowledge.appendChild(books);

    root.appendChild(knowledge);
    this._hudKnowledge = knowledge;
    this._hudBooks = books;
    this._updateKnowledgeHud();

    // Compass badge (N/E/S/W of the current facing), sitting above the minimap.
    const compass = document.createElement('div');
    compass.className = 'fp3d-compass';
    Object.assign(compass.style, {
      position: 'absolute',
      right: '10px',
      bottom: '236px',
      width: '220px',
      textAlign: 'center',
      padding: '4px 0',
      font: '700 15px/1.2 monospace',
      letterSpacing: '2px',
      color: '#cfe0ff',
      background: 'rgba(0, 0, 20, 0.55)',
      border: '1px solid rgba(120, 160, 255, 0.6)',
      borderRadius: '8px',
      pointerEvents: 'none',
      boxSizing: 'border-box',
    });
    root.appendChild(compass);
    this._hudCompass = compass;

    // Minimap canvas, bottom-right. Larger for legibility. Backing resolution is
    // 2× the CSS size for crispness; the context is scaled once in _drawMinimap.
    const size = 220;
    const canvas = document.createElement('canvas');
    canvas.className = 'fp3d-minimap';
    canvas.width = size * 2;
    canvas.height = size * 2;
    Object.assign(canvas.style, {
      position: 'absolute',
      right: '10px',
      bottom: '10px',
      width: size + 'px',
      height: size + 'px',
      background: 'rgba(4, 6, 16, 0.82)',
      border: '2px solid rgba(120, 160, 255, 0.7)',
      borderRadius: '8px',
      pointerEvents: 'none',
    });
    root.appendChild(canvas);
    this._minimapCanvas = canvas;
    this._minimapSize = size * 2; // draw in backing pixels
  }

  /** Refresh the score/lives readout and redraw the minimap. Cheap; per frame. */
  _updateHud() {
    if (this._hudScore && this.scoreSystem) {
      const sc = this.scoreSystem.score ?? 0;
      const lives = this.scoreSystem.lives ?? 0;
      this._hudScore.textContent = `SCORE ${sc}   LIVES ${lives}`;
    }
    if (this._hudCompass && this.state) {
      // Show the four cardinals with the one you're facing highlighted with
      // brackets, e.g. "N  ·  E  ·  [S]  ·  W".
      const f = this.state.player.facing;
      const letter = { north: 'N', east: 'E', south: 'S', west: 'W' };
      const order = ['north', 'east', 'south', 'west'];
      this._hudCompass.textContent = order
        .map((c) => (c === f ? `[${letter[c]}]` : letter[c]))
        .join('   ');
    }
    this._updateKnowledgeHud();
    this._drawMinimap();
  }

  /**
   * Refresh the Knowledge Power book bar: `level` filled book glyphs (📚) and
   * the rest dim empty slots, out of `max`. No-op in headless/tests (no HUD) or
   * before the meter exists.
   */
  _updateKnowledgeHud() {
    if (!this._hudBooks || !this.knowledge) return;
    const level = this.knowledge.level;
    const max = this.knowledge.max;
    // Filled books are the bright 📚 glyph; spent slots are the same glyph dimmed.
    // The whole row shows exactly `max` glyphs so the bar width is stable. Built
    // from DOM nodes (not innerHTML) so there is no unsafe HTML assignment.
    const doc = this._hudBooks.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    while (this._hudBooks.firstChild) this._hudBooks.removeChild(this._hudBooks.firstChild);
    for (let i = 0; i < max; i++) {
      const span = doc.createElement('span');
      span.textContent = '\uD83D\uDCDA';
      span.style.opacity = i < level ? '1' : '0.22';
      this._hudBooks.appendChild(span);
    }
    if (this._hudKnowledge) {
      this._hudKnowledge.setAttribute('aria-label', `Knowledge ammo ${level} of ${max}`);
    }
  }

  /**
   * Draw the top-down minimap: maze walls, the player (a triangle pointing along
   * its facing), and the ghosts (colored dots — brighter when currently visible
   * to the player per LOS/FOV). Purely a 2D-canvas HUD; it reads the same grid
   * and in-memory state the 3D view uses, so it never forks game data.
   */
  _drawMinimap() {
    const canvas = this._minimapCanvas;
    const grid = this.grid;
    const st = this.state;
    if (!canvas || !grid || !st) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const S = this._minimapSize;
    const pad = 10;
    const cell = Math.min((S - pad * 2) / grid.cols, (S - pad * 2) / grid.rows);
    const ox = (S - cell * grid.cols) / 2;
    const oy = (S - cell * grid.rows) / 2;

    // Background (paths) + wall cells for clear contrast.
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0b1024';                 // path/open background
    ctx.fillRect(ox, oy, cell * grid.cols, cell * grid.rows);
    ctx.fillStyle = '#4f8bff';                 // walls (bright blue)
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (grid.isWall(col, row)) {
          ctx.fillRect(ox + col * cell, oy + row * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }

    // Remaining pellets — small pale dots (power pellets larger + brighter) at
    // each live pellet tile, read straight from the shared grid's pellet Map so
    // the map depletes as the player eats. Drawn under ghosts/player.
    if (grid.pellets && grid.pellets.size) {
      const pelletR = Math.max(0.8, cell * 0.16);
      const powerR = Math.max(1.5, cell * 0.32);
      for (const [pkey, code] of grid.pellets) {
        const [pc, pr] = pkey.split(',').map(Number);
        const cx = ox + (pc + 0.5) * cell;
        const cy = oy + (pr + 0.5) * cell;
        const isPower = code === TILE.POWER_PELLET;
        ctx.fillStyle = isPower ? '#ffd24a' : '#ffe8a8';
        ctx.beginPath();
        ctx.arc(cx, cy, isPower ? powerR : pelletR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const player = { col: st.player.col, row: st.player.row };
    const facing = st.player.facing;

    // Ghosts — colored dots; dim when not currently visible to the player.
    for (const g of st.ghosts) {
      const cx = ox + (g.col + 0.5) * cell;
      const cy = oy + (g.row + 0.5) * cell;
      let visible = true;
      try {
        visible = isGhostVisible(grid, player, facing, { col: g.col, row: g.row }, FP3D.fovDegrees);
      } catch { /* default visible */ }
      const hex = '#' + ((g.color ?? 0xffffff) & 0xffffff).toString(16).padStart(6, '0');
      ctx.globalAlpha = visible ? 1 : 0.45;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(3, cell * 0.5), 0, Math.PI * 2);
      ctx.fill();
      // Outline so ghosts pop against walls.
      ctx.globalAlpha = visible ? 1 : 0.6;
      ctx.lineWidth = Math.max(1, cell * 0.12);
      ctx.strokeStyle = '#00000088';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Fruit markers. Up to four fruits (one per quadrant, Property 27) sit on
    // random corridor tiles, so there is no fixed spawn ring: each ACTIVE
    // fruit is drawn as a bright, outlined red cherry dot with a soft glow.
    const fruitR = Math.max(3, cell * 0.5);
    for (const fruit of st.fruits || []) {
      if (!fruit.present) continue;
      const fx = ox + (fruit.col + 0.5) * cell;
      const fy = oy + (fruit.row + 0.5) * cell;
      // Glow.
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath();
      ctx.arc(fx, fy, fruitR * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Cherry dot + outline.
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(fx, fy, fruitR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.12);
      ctx.strokeStyle = '#7a1500';
      ctx.stroke();
      // Little green stem so it reads as a cherry.
      ctx.strokeStyle = '#38e06a';
      ctx.beginPath();
      ctx.moveTo(fx, fy - fruitR);
      ctx.lineTo(fx + fruitR * 0.6, fy - fruitR * 1.8);
      ctx.stroke();
    }

    // Player — a bold arrow pointing along the current facing, plus a small
    // dot so the position is clear even when the arrow is small.
    const px = ox + (player.col + 0.5) * cell;
    const py = oy + (player.row + 0.5) * cell;
    const ang = { north: -Math.PI / 2, south: Math.PI / 2, west: Math.PI, east: 0 }[facing] ?? -Math.PI / 2;
    const r = Math.max(5, cell * 1.1);
    ctx.fillStyle = '#ffe000';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(1, cell * 0.12);
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ang) * r, py + Math.sin(ang) * r);
    ctx.lineTo(px + Math.cos(ang + 2.4) * r * 0.75, py + Math.sin(ang + 2.4) * r * 0.75);
    ctx.lineTo(px + Math.cos(ang - 2.4) * r * 0.75, py + Math.sin(ang - 2.4) * r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // A small "N" marker in the top-left of the map so the fixed orientation is
    // obvious (the map is not rotated with the player; the arrow shows facing).
    ctx.fillStyle = '#9fb6ff';
    ctx.font = `bold ${Math.round(S * 0.07)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('N\u2191', ox + 2, oy + 2);
  }

  /** Remove the HUD + minimap DOM nodes (scene teardown). */
  _destroyHud() {
    for (const el of [this._hudScore, this._minimapCanvas, this._hudCompass, this._hudKnowledge]) {
      if (!el) continue;
      try { el.remove(); } catch { if (el.parentNode) el.parentNode.removeChild(el); }
    }
    this._hudScore = null;
    this._minimapCanvas = null;
    this._hudCompass = null;
    this._hudKnowledge = null;
    this._hudBooks = null;
  }

  /** Remove the touch-control overlay (incl. the joystick) from the DOM. */
  _destroyTouchControls() {
    // Destroy the joystick first so its pointer listeners are removed even if
    // the container removal below throws.
    if (this._joystick && typeof this._joystick.destroy === 'function') {
      try { this._joystick.destroy(); } catch { /* ignore */ }
    }
    this._joystick = null;
    this._heldGestureSteps = null;
    if (this._touchControls) {
      try {
        this._touchControls.remove();
      } catch {
        if (this._touchControls.parentNode) {
          this._touchControls.parentNode.removeChild(this._touchControls);
        }
      }
      this._touchControls = null;
      this._motionBtn = null;
      this._fireBtn = null;
    }
  }

  // --- Portrait rotate hint (responsive; non-blocking) -----------------------

  /**
   * Build a subtle, non-blocking "rotate for the best view" hint shown only when
   * a small screen is held in PORTRAIT — first-person play is more comfortable
   * in landscape. It never blocks play: it is pointer-transparent, auto-hides
   * after a few seconds, and re-appears on an orientation change back to
   * portrait. Only created on touch-like devices; a no-op in headless/tests.
   */
  _buildRotateHint() {
    if (typeof document === 'undefined') return; // headless / tests
    if (!this._isTouchLikeDevice || !this._isTouchLikeDevice()) return;
    const root = document.getElementById('overlay-root');
    if (!root) return;

    const hint = document.createElement('div');
    hint.className = 'fp3d-rotate-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = 'Rotate your device for the best view';
    hint.hidden = true;
    root.appendChild(hint);
    this._rotateHint = hint;

    // Re-evaluate on resize/orientationchange; also drives joystick geometry
    // recompute (see `_onViewportChange`).
    this._viewportChangeHandler = () => this._onViewportChange();
    try {
      window.addEventListener('resize', this._viewportChangeHandler);
      window.addEventListener('orientationchange', this._viewportChangeHandler);
    } catch { /* no window (tests) */ }

    this._updateRotateHint();
  }

  /**
   * React to a viewport resize / orientation change: recompute the joystick's
   * cached geometry (so its normalized vector stays correct after a rotate) and
   * re-evaluate the portrait rotate hint. The DOM controls themselves re-layout
   * automatically because they are CSS-anchored/relative.
   */
  _onViewportChange() {
    if (this._joystick && typeof this._joystick.resize === 'function') {
      this._joystick.resize();
    }
    this._updateRotateHint();
  }

  /**
   * Show the rotate hint when in portrait on a small screen; hide it otherwise.
   * When shown it auto-hides after a short delay so it never lingers over play.
   */
  _updateRotateHint() {
    const hint = this._rotateHint;
    if (!hint || typeof window === 'undefined') return;
    const w = window.innerWidth || 0;
    const h = window.innerHeight || 0;
    const isPortrait = h > w;
    const isSmall = Math.min(w, h) <= 820; // phones / small tablets
    const shouldShow = isPortrait && isSmall;

    if (this._rotateHintTimer) {
      clearTimeout(this._rotateHintTimer);
      this._rotateHintTimer = null;
    }
    if (shouldShow) {
      hint.hidden = false;
      hint.style.opacity = '1';
      // Auto-hide after ~4s; fade out first, then remove from layout.
      this._rotateHintTimer = setTimeout(() => {
        hint.style.opacity = '0';
        this._rotateHintTimer = setTimeout(() => { hint.hidden = true; }, 450);
      }, 4000);
    } else {
      hint.hidden = true;
    }
  }

  /** Remove the rotate hint + its viewport listeners (scene teardown). */
  _destroyRotateHint() {
    if (this._rotateHintTimer) {
      clearTimeout(this._rotateHintTimer);
      this._rotateHintTimer = null;
    }
    if (this._viewportChangeHandler && typeof window !== 'undefined') {
      try {
        window.removeEventListener('resize', this._viewportChangeHandler);
        window.removeEventListener('orientationchange', this._viewportChangeHandler);
      } catch { /* ignore */ }
    }
    this._viewportChangeHandler = null;
    if (this._rotateHint) {
      try { this._rotateHint.remove(); } catch {
        if (this._rotateHint.parentNode) this._rotateHint.parentNode.removeChild(this._rotateHint);
      }
      this._rotateHint = null;
    }
  }

  // --- Reduced motion live toggle (Req 7.4, 7.5) -----------------------------

  /** Flip the reduced-motion setting live. */
  _toggleReducedMotion() {
    this._setReducedMotion(!this._reducedMotion);
  }

  /**
   * Apply a reduced-motion setting live: update the scene flag and the shared
   * `state.reducedMotion`, and push it to the renderer via
   * `renderer.setReducedMotion(enabled)` so it takes effect on the NEXT
   * `animateTurn`/`animateMove` (the renderer snaps to the target instead of
   * tweening when enabled — Req 7.4). Grid-locked position changes are
   * unaffected: `_stepMovement` still advances the player tile-by-tile; only the
   * camera's non-essential transition animation is suppressed. Also reflects the
   * new state on the on-screen toggle button's label + `aria-pressed`.
   * @param {boolean} enabled
   */
  _setReducedMotion(enabled) {
    const value = !!enabled;
    this._reducedMotion = value;
    if (this.state) this.state.reducedMotion = value;
    if (this.renderer && typeof this.renderer.setReducedMotion === 'function') {
      this.renderer.setReducedMotion(value);
    }
    if (this._motionBtn) {
      this._motionBtn.textContent = value ? 'Motion: off' : 'Motion: on';
      this._motionBtn.setAttribute('aria-pressed', value ? 'true' : 'false');
    }
    this.events.emit('fp3d-reduced-motion', { enabled: value });
  }

  // --- Movement loop (Req 2.2, 2.3, 2.5) -------------------------------------

  /**
   * Advance grid-locked, tile-to-tile movement. When a traversal is in flight it
   * interpolates over `FP3D.tileTraversalMs` (≤250 ms, Req 2.2) and resolves the
   * arrival on completion; when idle it takes the single buffered intent and
   * starts the next step via `resolveMove` (walls keep the player put — Req 2.3)
   * with tunnel-wrap via `resolveTunnel` (Req 2.5).
   * @param {number} delta ms since last frame
   */
  _stepMovement(delta) {
    const st = this.state;
    const tr = st.traversal;

    // In-progress traversal: accumulate time; on completion snap to the target
    // tile and run arrival effects. The renderer tween handles the visual glide.
    if (tr && tr.active) {
      tr.elapsed += delta;
      if (tr.elapsed >= tr.ms) {
        st.player.col = tr.to.col;
        st.player.row = tr.to.row;
        st.traversal = null;
        this._onArriveTile(tr.to.col, tr.to.row);
        // Continue immediately if the player is still holding a move direction,
        // so holding UP walks corridor after corridor with no re-press, and a
        // turn tapped mid-step (which already changed `facing`) is followed the
        // moment we arrive — that is what makes corners easy. Buffered one-shot
        // intents (e.g. touch tap) are honored too.
        this._continueOrConsume();
      }
      return;
    }

    // Idle (no traversal in flight): start moving from held keys or a buffered
    // one-shot intent.
    this._continueOrConsume();
  }

  /**
   * Start the next step from the currently HELD move direction (continuous
   * walking) or, failing that, a single buffered one-shot move intent (from a
   * touch tap). Turning is instant/separate, so this only ever deals with
   * forward/back. No open tile ahead → no step (you simply stop at the wall,
   * still facing it; tap a turn and keep holding forward to round the corner).
   */
  _continueOrConsume() {
    const st = this.state;
    if (!st || st.traversal) return;

    // Live held direction wins (continuous keyboard movement).
    if (this._heldMoveDir) {
      this._beginStep(this._heldMoveDir);
      if (st.traversal) return; // a step started; done
    }

    // Held Virtual_Joystick direction: while the stick is pushed past the
    // deadzone, `_heldGestureSteps` holds a facing-relative step sequence
    // (single cardinal, or a diagonal fed one leg at a time). Re-issue it each
    // tile so holding the stick walks corridor to corridor, mirroring held
    // keyboard walking; a fully blocked sequence keeps the player put (Req 2.6).
    if (Array.isArray(this._heldGestureSteps) && this._heldGestureSteps.length) {
      this._runHeldGestureSteps(this._heldGestureSteps);
      if (st.traversal) return; // a leg started; done
    }

    // Otherwise honor a single buffered one-shot intent (touch button tap or a
    // resolved gesture). Turns apply in place; gesture moves may carry a
    // diagonal `steps` sequence resolved cardinal-relative to the CURRENT facing.
    const intent = st.buffer.take();
    if (!intent) return;
    if (intent.type === 'turn') {
      // A Flick-resolved cardinal turn (Req 4). Applied in place; if the player
      // is still holding forward, the next tick continues down the new facing.
      this._applyGestureFacing(intent.to);
      return;
    }
    if (intent.type === 'move') {
      if (Array.isArray(intent.steps)) {
        // A gesture move: one cardinal, or a diagonal fed one leg at a time,
        // skipping a blocked leg (Req 2.4, 2.7). Each leg is a facing-relative
        // grid move resolved through the same `_beginGestureStep` → resolveMove/
        // resolveTunnel seam. At most one leg actually starts a traversal this
        // tick; the remaining leg (if any) is re-buffered so it runs on arrival.
        this._runGestureSteps(intent.steps);
      } else if (intent.dir) {
        // Legacy on-screen touch-button move ({ type:'move', dir }).
        this._beginStep(intent.dir);
      }
    }
  }

  /**
   * Run a gesture move's `steps` sequence (one or two cardinal legs). Attempts
   * legs in order, skipping any leg blocked by a wall (Req 2.7); the FIRST leg
   * that actually moves starts the traversal, and any leftover leg is re-buffered
   * so it is attempted the moment the player reaches the next tile center
   * (preserving the at-most-one-in-flight, grid-locked model, Req 7.1, 7.3).
   * A fully blocked sequence keeps the player put and preserves facing (Req 2.6).
   * @param {string[]} steps ordered move intents ('forward'|'backward'|'strafe-left'|'strafe-right')
   */
  _runGestureSteps(steps) {
    const st = this.state;
    if (!st || !Array.isArray(steps) || steps.length === 0) return;
    for (let i = 0; i < steps.length; i++) {
      const started = this._beginGestureStep(steps[i]);
      if (started) {
        // A leg moved; re-buffer any remaining legs for the next arrival so the
        // diagonal completes as a grid-locked two-step (at most one in flight).
        const remaining = steps.slice(i + 1);
        if (remaining.length) {
          st.buffer.push({ type: 'move', gesture: true, steps: remaining });
        }
        return;
      }
      // Blocked leg → skip it and try the next (Req 2.7).
    }
    // Fully blocked: player stays put, facing preserved (Req 2.6).
  }

  /**
   * Run a HELD Virtual_Joystick step sequence for one tile. Unlike
   * `_runGestureSteps` (which re-buffers leftover legs into the `InputBuffer`
   * for a one-shot diagonal), the held version does NOT re-buffer: the joystick
   * re-issues `_heldGestureSteps` live from `_onJoystickChange`, so the current
   * push direction is re-evaluated at every tile. Each tick it starts the FIRST
   * non-blocked leg (skipping a blocked cardinal, Req 2.7) through the SAME
   * `_beginGestureStep` → `resolveMove`/`resolveTunnel` seam; a fully blocked
   * sequence keeps the player put with facing preserved (Req 2.6).
   * @param {string[]} steps facing-relative legs ('forward'|'backward'|'strafe-left'|'strafe-right')
   */
  _runHeldGestureSteps(steps) {
    const st = this.state;
    if (!st || st.traversal || !Array.isArray(steps)) return;
    for (const step of steps) {
      if (this._beginGestureStep(step)) return; // first open leg starts a step
      // Blocked leg → try the next (diagonal fallback to its open cardinal).
    }
    // Fully blocked: stay put, facing preserved (Req 2.6).
  }

  /**
   * Begin ONE facing-relative gesture step and report whether a traversal
   * started. A gesture move intent is expressed relative to the current facing:
   *   forward       → step in facing
   *   backward      → step opposite the facing
   *   strafe-left   → step 90° counter-clockwise of the facing
   *   strafe-right  → step 90° clockwise of the facing
   * The step direction is resolved to a cardinal and applied through the EXISTING
   * `resolveTunnel`/`resolveMove` seam (Req 2.5, 7.1, 7.4) — the player's FACING
   * is NOT changed by a strafe/back move, matching keyboard `back` (only the
   * position moves). A wall keeps the player put and preserves facing (Req 2.6,
   * 7.5).
   * @param {string} intent one of forward/backward/strafe-left/strafe-right
   * @returns {boolean} true when a traversal was started
   */
  _beginGestureStep(intent) {
    const st = this.state;
    if (!st) return false;
    const facing = st.player.facing;
    let stepFacing;
    switch (intent) {
      case 'forward': stepFacing = facing; break;
      case 'backward': stepFacing = this._opposite(facing); break;
      case 'strafe-left': stepFacing = turnLeft(facing); break;
      case 'strafe-right': stepFacing = turnRight(facing); break;
      default: return false;
    }

    const from = { col: st.player.col, row: st.player.row };
    // Tunnel wrap takes priority at a tunnel-row edge (Req 7.4); otherwise a
    // normal grid move (Req 7.1). Facing is preserved through both.
    const wrapped = resolveTunnel(this.grid, from.col, from.row, stepFacing);
    let to;
    let didWrap = false;
    if (wrapped.col !== from.col || wrapped.row !== from.row) {
      to = { col: wrapped.col, row: wrapped.row, moved: true };
      didWrap = true;
    } else {
      to = resolveMove(this.grid, from.col, from.row, stepFacing);
    }
    if (!to.moved) return false; // wall / out of bounds: stay put (Req 2.6, 7.5)

    const ms = FP3D.tileTraversalMs;
    st.traversal = {
      active: true,
      from,
      to: { col: to.col, row: to.row },
      wrapped: didWrap,
      ms,
      elapsed: 0,
    };
    if (didWrap && this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.TUNNEL);
    }
    if (this.renderer && typeof this.renderer.animateMove === 'function') {
      this.renderer.animateMove(from, st.traversal.to, ms);
    }
    return true;
  }

  /**
   * Begin a one-tile step in the player's current facing (`forward`) or the
   * opposite (`back`). Resolution reuses `resolveMove` (→ `MazeGrid.attemptMove`)
   * so wall/out-of-bounds behavior is exactly the 2D rule (Req 2.3); a tunnel
   * edge is resolved by `resolveTunnel` (Req 2.5). No movement → no traversal.
   * @param {'forward'|'back'} dir
   */
  _beginStep(dir) {
    const st = this.state;
    const from = { col: st.player.col, row: st.player.row };
    // `back` steps opposite the facing without changing where the camera looks.
    const stepFacing = dir === 'back'
      ? this._opposite(st.player.facing)
      : st.player.facing;

    // Tunnel wrap takes priority when the player is on a tunnel row at an edge:
    // resolveTunnel returns the wrapped tile (same row, opposite edge) or the
    // unchanged tile when no wrap applies.
    const wrapped = resolveTunnel(this.grid, from.col, from.row, stepFacing);
    let to;
    let didWrap = false;
    if (wrapped.col !== from.col || wrapped.row !== from.row) {
      to = { col: wrapped.col, row: wrapped.row, moved: true };
      didWrap = true; // stepped through the tunnel hallway (Req 12.10)
    } else {
      to = resolveMove(this.grid, from.col, from.row, stepFacing);
    }

    if (!to.moved) return; // wall / out of bounds: stay put, keep facing (Req 2.3)

    const ms = FP3D.tileTraversalMs; // eased in the renderer; longer = smoother glide
    st.traversal = {
      active: true,
      from,
      to: { col: to.col, row: to.row },
      wrapped: didWrap,
      ms,
      elapsed: 0,
    };
    // Teleport SFX at the moment the wrap step begins (Req 12.10).
    if (didWrap && this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.TUNNEL);
    }
    if (this.renderer) this.renderer.animateMove(from, st.traversal.to, ms);
  }

  /** Opposite cardinal facing (used for the `back` step). */
  _opposite(facing) {
    const idx = CARDINALS.indexOf(setFacing(facing));
    return CARDINALS[(idx + 2) % CARDINALS.length];
  }

  /**
   * Tile-arrival effects: collect a pellet/power-pellet here (Req 3.3, 3.4),
   * collect the fruit if present (Req 5.2 — minimal handling; the lesson freeze
   * is Task 15), then test for a ghost capture (Task 15 owns the quiz freeze).
   * @param {number} col
   * @param {number} row
   */
  _onArriveTile(col, row) {
    // --- Pellet / power-pellet (each scored exactly once, Req 3.4) -----------
    // `eatPelletAt` removes exactly that pellet from the pure grid and returns
    // its points (0 when none). The renderer marker is hidden to match.
    const points = this.grid.eatPelletAt(col, row);
    if (points > 0) {
      this.scoreSystem.addScore(points);
      if (this.renderer) this.renderer.setPelletVisible(col, row, false);
      if (this.audio && typeof this.audio.play === 'function') {
        this.audio.play(AudioEvent.PELLET);
      }
      // Eating that last pellet clears the level → win music + auto-advance
      // (Req 1.5). Checked right after the pellet is scored so a cleared board
      // is detected the instant the final pellet is consumed.
      this._checkLevelClear();
    }

    // --- Fruit (Req 5.1, 5.2) ------------------------------------------------
    // Minimal handling: remove the marker and grant a life + lesson hook. The
    // FULL freeze → LessonScene overlay is Task 15; here we only clear a clean
    // seam so pellet/movement flow stays correct and the fruit isn't collected
    // twice.
    const fruit = this.state.fruits.find((f) => f.present && f.col === col && f.row === row);
    if (fruit) {
      this._onFruitCollected(fruit);
    }

    // --- Capture check (Task 15 owns the quiz freeze) ------------------------
    this._checkCapture();
  }

  // --- Level progression (win → next level, Req 1.5) -------------------------

  /**
   * Detect a cleared maze (every pellet eaten) and advance to the next level,
   * mirroring GameScene._checkLevelClear. Fires once per clear: the
   * `_levelTransition` guard blocks re-entry while a transition is in flight,
   * and after `_advanceLevel` rebuilds the pellet layer `isLevelCleared()` is
   * false again, so it will not re-trigger on the same board. Called from
   * `_onArriveTile` right after a pellet is scored.
   */
  _checkLevelClear() {
    if (this._levelTransition) return;
    if (!this.grid || !this.grid.isLevelCleared()) return;
    this._advanceLevel();
  }

  /**
   * Win transition (Req 1.5): play the win/"Stage Clear" music, BUMP THE GRADE
   * one step (5→6→7, capped at the last grade), advance the run's level, and
   * rebuild the maze's pellet layer for it — preserving score and lives
   * (ScoreSystem.nextLevel only bumps `level`). The grade bump naturally raises
   * ghost speed (`ghostSpeedForGrade(this.grade)` is read per tick) and the
   * question grade (QuizScene reads `this.grade`) without forking either. Math
   * Man and the ghosts return to their spawns for the fresh level, the fruit
   * slots are rebuilt, and the renderer's pellet/fruit markers are re-seeded to
   * match the rebuilt grid.
   *
   * The next level is built and revealed immediately, but the scene is FROZEN
   * and a "Level Complete!" announcement dialog (`LevelClearModal`) is shown
   * over the shared `#overlay-root`. Play only resumes — and the once-only
   * `_levelTransition` guard is only cleared — in `_onLevelClearDismissed`, when
   * the player continues (or immediately, if the dialog cannot render).
   */
  _advanceLevel() {
    this._levelTransition = true;

    // Freeze immediately so movement/ghosts are suspended while the "Level
    // Complete!" dialog is up — the same overlay contract the quiz/lesson use
    // (Req 4.2, 6.7). The render loop keeps drawing the (rebuilt) frozen 3D
    // frame behind the DOM overlay. Play only resumes in
    // `_onLevelClearDismissed`, which also clears `_levelTransition`.
    this._freeze();

    // The cleared level number is the run's CURRENT level, captured before the
    // ScoreSystem bump below so the dialog announces the level just finished.
    const clearedLevel = this.scoreSystem ? this.scoreSystem.level : undefined;

    // 1) Win music (silent no-op when audio / asset is unavailable). LEVEL_CLEAR
    //    is a MUSIC cue: it plays "Stage Clear" then loops the score track.
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.LEVEL_CLEAR);
    }

    // 2) Bump the grade one step along GRADES (5→6→7), capped at the top grade
    //    (stay at 7 after 7). Falling back to DEFAULT_GRADE's index when the
    //    current grade is somehow off-list keeps the step well-defined. Capture
    //    the grade BEFORE and AFTER so the dialog can show any change.
    const fromGrade = this.grade;
    const idx = GRADES.indexOf(this.grade);
    const from = idx === -1 ? GRADES.indexOf(DEFAULT_GRADE) : idx;
    const nextIdx = Math.min((from < 0 ? 0 : from) + 1, GRADES.length - 1);
    this.grade = GRADES[nextIdx];
    const toGrade = this.grade;

    // 3) Advance the level and rebuild the pure grid's pellet layer for it.
    //    Score/lives are preserved (nextLevel only bumps `level`). Hide every
    //    currently-shown pellet marker BEFORE the reset — the only shown markers
    //    are exactly the grid's remaining live pellets (eaten ones were removed
    //    on eat), so this clears the renderer of stale markers without inventing
    //    a renderer method — then re-seed from the rebuilt grid.
    if (this.renderer && typeof this.renderer.setPelletVisible === 'function') {
      for (const key of this.grid.pellets.keys()) {
        const [pc, pr] = key.split(',').map(Number);
        this.renderer.setPelletVisible(pc, pr, false);
      }
    }
    this.scoreSystem.nextLevel();
    this.grid.reset(this.scoreSystem.level);

    // Knowledge Power: each fresh level starts with a full book meter.
    if (this.knowledge) this.knowledge.reset();

    // Refresh the ghost-house release setup against the rebuilt grid so the
    // exit/re-entry rules match the new level's layout.
    this._house = houseRegionFromGrid(this.grid);
    this._noReentryGrid = blockHouseReentry(this.grid, this._house);

    // 4) Fresh no-repeat question window for the new level (same guard as create).
    const questionBank = this.registry.get('questionBank');
    if (questionBank && typeof questionBank.startLevel === 'function') {
      questionBank.startLevel();
    }

    // 5) Re-seed the renderer's pellet markers from the rebuilt grid (Req 3.1).
    if (this.renderer && typeof this.renderer.setPelletVisible === 'function') {
      this._seedPelletMarkers();
    }

    // 6) Rebuild the fruit slots for the new level the same way create() seeds
    //    them, and re-seed their renderer markers so none linger and none are
    //    double-collected (the old slots are replaced wholesale).
    this.state.fruits = this._buildFruitStates();
    if (this.renderer && typeof this.renderer.setFruit === 'function') {
      for (const f of this.state.fruits) {
        this.renderer.setFruit(f.col, f.row, f.present, f.slot);
      }
    }

    // 7) Return Math Man and the ghosts to their spawns for the fresh level,
    //    reusing the same spawn-reset path a resolved quiz uses (no duplication).
    //    The next level is now built and revealed BEHIND the dialog.
    this.resetPositions();

    // 8) Announce the win over the shared `#overlay-root` and WAIT for the
    //    player. We deliberately do NOT clear `_levelTransition` or unfreeze
    //    here — `_onLevelClearDismissed` does both once the player continues, so
    //    the transition fires exactly once and play stays suspended until then.
    const root = this._overlayRoot();
    this._levelClearModal = new LevelClearModal(root);
    const opened = this._levelClearModal.open(
      {
        level: clearedLevel,
        score: this.scoreSystem ? this.scoreSystem.score : undefined,
        fromGrade,
        toGrade,
      },
      () => this._onLevelClearDismissed(),
    );

    // Headless / no-DOM safety: if the panel could not render (tests/headless),
    // don't strand the frozen scene — resume immediately via the same dismissed
    // path, exactly like LessonScene does when `opened` is false (Req 8: graceful
    // fallback).
    if (!opened) {
      this._onLevelClearDismissed();
    }
  }

  /** Locate the DOM overlay root declared in index.html (shared host). */
  _overlayRoot() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('overlay-root');
  }

  /**
   * Resume play after the "Level Complete!" dialog is dismissed (button / Enter
   * / Space / Esc) or when it could not render. Tears the modal down, unfreezes
   * the scene, and clears the once-only `_levelTransition` guard so gameplay
   * continues and future clears can fire.
   */
  _onLevelClearDismissed() {
    if (this._levelClearModal) {
      try { this._levelClearModal.close(); } catch { /* ignore */ }
      this._levelClearModal = null;
    }
    this._unfreeze();
    this._levelTransition = false;
  }

  // --- Ghosts: thin wrapper around the EXISTING ghostAI (Req 9.1) ------------

  /**
   * Advance every ghost one resolved step this tick using ONLY the existing
   * framework-agnostic `ghostAI.js` exports — never `Ghost.js` and never a
   * forked personality/target-tile copy. For each ghost:
   *   1. `computeTargetTile(personality, ctx)` picks the target tile,
   *   2. `chooseGhostDirection(grid, ghostTile, dir, targetTile)` picks a legal
   *      non-reversing direction,
   *   3. `grid.attemptMove` steps it (walls/tunnels handled by the grid).
   * Ghosts read/write only their in-memory `{col,row}` (and heading `dir`).
   *
   * `ghostSpeedForGrade(grade)` scales per-grade speed; here it gates how often
   * a ghost takes a tile step (faster grades step more frequently) so movement
   * stays grid-locked rather than sub-tile. Speed is a rate, not a fork of the
   * decision logic.
   */
  _advanceGhosts() {
    const player = { col: this.state.player.col, row: this.state.player.row };
    const playerDir = CARDINAL_TO_DIR[this.state.player.facing] || null;
    const ghosts = this.state.ghosts;
    const red = ghosts.find((g) => g.key === 'red') || ghosts[0];
    const redTile = red ? { col: red.col, row: red.row } : player;

    // Per-grade step cadence: convert the grade's ghost speed (pixels/second)
    // into a per-tile interval (ms) so higher grades step more often. Tracked
    // per ghost via an accumulator on the shared `_ghostStepMs`.
    // Scale the 2D per-grade speed down (FP3D.ghostSpeedScale) so ghosts close in
    // gradually and are easier to see approaching in first person.
    const speed = ghostSpeedForGrade(this.grade) * FP3D.ghostSpeedScale; // px/s
    const tilePx = this.grid.tileSize;
    const stepIntervalMs = speed > 0 ? (tilePx / speed) * 1000 : Infinity;
    // Tell the renderer how long a ghost tile-step takes so it can smoothly
    // interpolate ghost meshes between tiles instead of snapping.
    if (this.renderer && typeof this.renderer.setGhostStepMs === 'function') {
      this.renderer.setGhostStepMs(stepIntervalMs);
    }
    this._ghostAccumMs = (this._ghostAccumMs || 0) + this._lastDelta;

    if (this._ghostAccumMs < stepIntervalMs) return; // not time to step yet
    this._ghostAccumMs -= stepIntervalMs;

    for (const ghost of ghosts) {
      const ghostTile = { col: ghost.col, row: ghost.row };

      // Phase transition: as soon as the ghost stands OUTSIDE the house, lock in
      // exited (mirrors Ghost._decideAtTile).
      if (!ghost.exited && !isHouseTile(this._house, ghost.col, ghost.row)) {
        ghost.exited = true;
      }

      let target;
      let gridView;
      if (!ghost.exited) {
        // Exit phase: head UP through the door to the exit tile, using the
        // NORMAL grid so the door is passable.
        target = ghostHouseExitTile(this._house);
        gridView = this.grid;
      } else {
        // Chase phase: personality target, using the re-entry-blocking grid so
        // the ghost can't path back into the house and ping-pong at the door.
        target = computeTargetTile(ghost.personality, {
          mathManTile: player,
          mathManDir: playerDir,
          ghostTile,
          redGhostTile: redTile,
          scatterCorner: ghost.scatterCorner,
        });
        gridView = this._noReentryGrid || this.grid;
      }

      const dir = chooseGhostDirection(gridView, ghostTile, ghost.dir, target);
      if (!dir) continue; // fully boxed in: hold position
      // Step on the SAME grid view used to decide, so a house-blocked step is
      // consistent with the decision (re-entry stays blocked).
      const step = gridView.attemptMove(ghost.col, ghost.row, dir);
      if (step.moved) {
        ghost.col = step.col;
        ghost.row = step.row;
        ghost.dir = dir;
      }
    }

    // A ghost may have stepped onto the player's tile — check capture.
    this._checkCapture();
  }

  /**
   * Push the current ghost states to the renderer, hiding each ghost that is not
   * visible per the injected LOS/FOV test (`isGhostVisible` from `lineOfSight`)
   * — never via raycasting (Req 3.7, 3.8).
   */
  _renderGhosts() {
    if (!this.renderer) return;
    const player = { col: this.state.player.col, row: this.state.player.row };
    const facing = this.state.player.facing;
    const grid = this.grid;
    const visibilityFn = (ghost) =>
      isGhostVisible(grid, player, facing, { col: ghost.col, row: ghost.row }, FP3D.fovDegrees);
    this.renderer.setGhosts(this.state.ghosts, visibilityFn);
  }

  // --- Capture → quiz freeze flow (Req 4.1, 4.2, 4.3, 4.4, 4.6, 6.7) ---------

  /**
   * Detect a ghost occupying the player's tile (Req 4.1) and start the caught →
   * quiz freeze flow. Guarded by `_caught` so the per-tick check (which runs
   * from both `_onArriveTile` and `_advanceGhosts`) launches the quiz at most
   * once until `resumeAfterQuiz` resolves it.
   */
  _checkCapture() {
    if (this._caught || this.state.frozen) return;
    const { col, row } = this.state.player;
    const ghost = this.state.ghosts.find((g) => g.col === col && g.row === row);
    if (!ghost) return;
    this._caught = true;
    this._onCaught(ghost);
  }

  /**
   * Capture handler — mirrors GameScene._onMathManCaught exactly, adapted to
   * FP3D's own render-loop freeze. Within 100 ms plays the CAUGHT cue via the
   * AudioBus, freezes the scene (`state.frozen = true`, so `update()` renders
   * only and movement/turn/ghost activity are suspended — Req 4.2, 6.7), and
   * launches the EXISTING `QuizScene` with the shared grade and an `onResolved`
   * callback routing back into {@link resumeAfterQuiz}. The `QuizScene` launch
   * is guarded like GameScene's `_isSceneRegistered` so a missing scene never
   * strands the frozen loop.
   * @param {object} ghost the catching ghost state
   */
  _onCaught(ghost) {
    // Caught cue (silent no-op when audio / asset is unavailable). Played
    // immediately so it lands within 100 ms of the capture (Req 4.1).
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.CAUGHT);
    }

    // Broadcast for listeners/tests. Payload carries the catching ghost.
    this.events.emit('fp3d-caught', { ghost, grade: this.grade });

    // Freeze: suspend movement/turn input and ghost activity while the question
    // is open (Req 4.2, 6.7). The render loop keeps drawing the frozen 3D frame
    // behind the DOM overlay.
    this._freeze();

    // 😱 Face-the-ghost scare: snap the camera to look straight at the ghost
    // that caught you — turned toward where it lunged from — so it looms in your
    // face for a beat before the quiz overlay pops. The ghost is on your tile;
    // we frame it toward the REVERSE of its heading (where it came at you from).
    // The turn animates over ~turnAnimMs; we hold briefly, then launch the quiz.
    const cameFrom = ghost.dir ? DIR_TO_CARDINAL[OPPOSITE_DIR[ghost.dir]] : this.state.player.facing;
    if (this.renderer && typeof this.renderer.faceGhost === 'function') {
      this.renderer.faceGhost(ghost.key, cameFrom || this.state.player.facing);
    }

    const launchQuiz = () => {
      if (this._isSceneRegistered('QuizScene')) {
        // QuizScene resolves the question and calls back with `{ correct }`;
        // `grade` picks a grade-appropriate question (identical to GameScene).
        this.scene.launch('QuizScene', {
          grade: this.grade,
          onResolved: (result) => this.resumeAfterQuiz(result),
        });
      } else {
        // Defensive: no QuizScene registered → don't strand the frozen loop.
        this.resumeAfterQuiz({ correct: true });
      }
    };

    // Give the player ~700ms to see the ghost's face before the quiz. Guarded
    // so a missing time plugin (headless/tests) launches immediately.
    if (this.time && typeof this.time.delayedCall === 'function') {
      this.time.delayedCall(700, launchQuiz, undefined, this);
    } else {
      launchQuiz();
    }
  }

  /**
   * Resolve a catch after the quiz returns (called by QuizScene). Mirrors
   * GameScene.resumeAfterQuiz: a correct answer leaves lives unchanged and
   * resumes (Req 4.3); a wrong answer costs one life via the shared
   * `ScoreSystem.loseLife()` — QuizScene has already shown the explanation
   * (Req 4.4). When no lives remain the run ends via {@link _onGameOver}
   * (Req 4.6, 5.6, 5.7); otherwise the player and ghosts reset to their spawn
   * tiles and the scene unfreezes (Req 4.3, 4.4).
   * @param {{ correct?: boolean }} [result] outcome of the quiz.
   */
  resumeAfterQuiz(result = {}) {
    const correct = !!result.correct;

    // Wrong answer → lose one life (Req 4.4). Lives/scoring are the SAME shared
    // ScoreSystem the 2D mode uses — never forked.
    if (!correct) {
      this.scoreSystem.loseLife();
    }

    // No lives left → game over (Req 4.6); do not reset or resume.
    if (this.scoreSystem.isGameOver()) {
      this._onGameOver();
      return;
    }

    // Lives remain (Property 25 / resolveCatchPositions): a correct answer
    // saves the life, so the player stays on the tile where he was caught and
    // only the ghosts go home (Req 4.3). A wrong answer resets everyone (4.4).
    this.resetPositions({ keepPlayer: correct });
    this._caught = false;
    this._unfreeze();
  }

  /**
   * Reset Math Man and every ghost to their spawn tiles and re-seed the camera
   * and renderer, mirroring GameScene.resetPositions (Req 4.3). Because FP3D
   * tracks position as in-memory `{ col, row }`, this rewrites those tiles (and
   * clears any in-flight traversal / buffered intent) rather than moving
   * sprites, then snaps the camera and ghost meshes to the reset state.
   * @param {object} [opts]
   * @param {boolean} [opts.keepPlayer=false] true after a correct answer: the
   *   player stays on his tile (and facing) and only the ghosts go home.
   */
  resetPositions({ keepPlayer = false } = {}) {
    const st = this.state;
    if (!st) return;

    const next = resolveCatchPositions({
      correct: keepPlayer,
      player: st.player,
      playerSpawn: this._playerSpawn,
      ghostSpawns: st.ghosts.map((g) => g.spawn || { col: g.col, row: g.row }),
    });

    // Player: kept in place (saved life) or back to spawn. Either way clear any
    // in-flight step / pending intent. Facing is kept when staying put.
    st.player.col = next.player.col;
    st.player.row = next.player.row;
    if (!keepPlayer) st.player.facing = this._spawnFacing || 'north';
    st.traversal = null;
    if (st.buffer && typeof st.buffer.take === 'function') st.buffer.take();

    // Ghosts back to their spawn tiles with a cleared heading.
    st.ghosts.forEach((ghost, i) => {
      ghost.col = next.ghosts[i].col;
      ghost.row = next.ghosts[i].row;
      ghost.dir = null;
      // Returned inside the house → run the exit sequence again (matches 2D).
      ghost.exited = false;
    });
    // Reset the ghost step accumulator so cadence restarts cleanly.
    this._ghostAccumMs = 0;
    // Stop any continuous walking so the player doesn't auto-move on resume.
    this._heldMoveDir = null;

    // Re-seed the renderer: clear any face-the-ghost scare, snap the camera to
    // the player's (kept or spawn) tile, and push the reset ghost positions.
    if (this.renderer) {
      if (typeof this.renderer.clearFaceGhost === 'function') this.renderer.clearFaceGhost();
      this.renderer.setCamera(st.player.col, st.player.row, st.player.facing);
      this._renderGhosts();
    }
  }

  /**
   * End the run and route to `GameOverScene`, mirroring GameScene._onGameOver:
   * stop the QuizScene/LessonScene overlays, clear the music duck, play the
   * GAME_OVER cue, then start `GameOverScene` with the `ScoreSystem` snapshot so
   * it persists the high score through `Storage.updateHighScore` (Req 4.6, 5.6,
   * 5.7). GameOverScene owns the high-score write; this scene never forks it.
   */
  _onGameOver() {
    this._caught = false;

    // Stop the quiz overlay FIRST so its DOM modal + scene do not linger over
    // the GameOverScene we are about to start; also stop any lesson overlay.
    if (this.scene.isActive('QuizScene')) this.scene.stop('QuizScene');
    if (this.scene.isActive('LessonScene')) this.scene.stop('LessonScene');

    // Clear any overlay music duck so the game-over cue is at full volume, then
    // play it (GAME_OVER is a MUSIC event → replaces the current track).
    if (this.audio) {
      if (typeof this.audio.unduckMusic === 'function') this.audio.unduckMusic();
      if (typeof this.audio.play === 'function') this.audio.play(AudioEvent.GAME_OVER);
    }

    if (!this._isSceneRegistered('GameOverScene')) return;

    // Snapshot the final state (same shape GameScene passes) — GameOverScene
    // reads `score`/`level` and persists the high score via Storage.
    const snapshot = this.scoreSystem.snapshot();

    // Tear down this scene and boot the game-over screen through the game-level
    // Scene Manager (always live), matching GameScene's handoff.
    const manager = this.scene.manager;
    try {
      if (manager && typeof manager.stop === 'function') manager.stop('FP3DScene');
      if (manager && typeof manager.start === 'function') {
        manager.start('GameOverScene', snapshot);
      } else {
        this.scene.start('GameOverScene', snapshot);
      }
    } catch {
      this.scene.start('GameOverScene', snapshot);
    }
  }

  // --- Quit to menu ----------------------------------------------------------

  /**
   * Abandon the current run and return straight to the main `MenuScene`. This is
   * the chosen "quit" behavior: NO game-over screen and NO high-score write — the
   * run is simply discarded. Bound to the Escape key and to the discreet
   * on-screen "return to menu" control, both of which route here.
   *
   * Stops any open quiz/lesson/pause overlays first so their DOM modals + scenes
   * do not linger over the menu, clears any music duck / resets the tempo, then
   * tears down FP3DScene and starts MenuScene through the game-level Scene
   * Manager the SAME way `_onGameOver` hands off (with a scene-local fallback).
   * Guarded by `_isSceneRegistered('MenuScene')` like the other handoffs.
   */
  _returnToMenu() {
    // Stop overlays that may be open so nothing lingers over the menu.
    if (this.scene.isActive('QuizScene')) this.scene.stop('QuizScene');
    if (this.scene.isActive('LessonScene')) this.scene.stop('LessonScene');
    if (this.scene.isActive('PauseScene')) this.scene.stop('PauseScene');

    // Close the "Level Complete!" dialog if one is up so it never lingers over
    // the menu (its own DOM panel, not a scene).
    if (this._levelClearModal) {
      try { this._levelClearModal.close(); } catch { /* ignore */ }
      this._levelClearModal = null;
    }

    // Clear any overlay music duck and restore normal tempo before leaving.
    if (this.audio) {
      if (typeof this.audio.unduckMusic === 'function') this.audio.unduckMusic();
      if (typeof this.audio.setMusicRate === 'function') this.audio.setMusicRate(1);
    }

    if (!this._isSceneRegistered('MenuScene')) return;

    // Tear down this scene and boot the menu through the game-level Scene
    // Manager (always live), matching the game-over handoff. Fall back to a
    // scene-local start if the manager path is unavailable.
    const manager = this.scene.manager;
    try {
      if (manager && typeof manager.stop === 'function') manager.stop('FP3DScene');
      if (manager && typeof manager.start === 'function') {
        manager.start('MenuScene');
      } else {
        this.scene.start('MenuScene');
      }
    } catch {
      this.scene.start('MenuScene');
    }
  }

  // --- Fruit → extra life → lesson freeze flow (Req 4.2, 5.2, 6.7) -----------

  /**
   * Fruit collection handler — mirrors GameScene._onFruitCollected. Grants one
   * extra life through the shared `ScoreSystem.gainLife()` (capped at 10 —
   * Req 5.2), removes the fruit marker, plays the collect + 1-up cues, freezes
   * the scene, and launches the EXISTING `LessonScene` with the next
   * `LessonBank` lesson and an `onDismiss` callback into {@link resumeAfterLesson}.
   * While frozen, movement/turn input and ghost activity are suspended (already
   * handled by `state.frozen` in `update()`/`_queueTurn`/`_pollInput` — Req 6.7).
   * @param {{col:number,row:number,present:boolean}} fruit
   */
  _onFruitCollected(fruit) {
    fruit.present = false;
    fruit.timerMs = 0; // next fruit after a full spawn interval

    // Extra life, capped at LIVES_MAX = 10 by ScoreSystem (Req 5.2). Same shared
    // ScoreSystem — never forked.
    this.scoreSystem.gainLife();

    // Knowledge Power: a fruit tops the book meter back up to full (not +1).
    if (this.knowledge) this.knowledge.refillToMax();

    if (this.renderer) this.renderer.setFruit(fruit.col, fruit.row, false, fruit.slot);
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.FRUIT_COLLECT);
      this.audio.play(AudioEvent.EXTRA_LIFE);
    }

    // Freeze and show the micro-lesson (Req 4.2). Selecting from the per-run
    // LessonBank varies the content between showings (Req 5.5).
    this._freeze();
    const lesson = this.lessonBank ? this.lessonBank.next() : null;
    if (this._isSceneRegistered('LessonScene')) {
      this.scene.launch('LessonScene', {
        lesson,
        onDismiss: () => this.resumeAfterLesson(),
      });
    } else {
      // Defensive: no LessonScene registered → don't strand the frozen loop.
      this.resumeAfterLesson();
    }
  }

  /**
   * Resume gameplay after the lesson panel is dismissed (Req 4.2). Called by
   * LessonScene's dismiss callback; mirrors {@link resumeAfterLesson} in
   * GameScene — simply unfreeze and continue.
   */
  resumeAfterLesson() {
    this._unfreeze();
  }

  // --- Freeze / unfreeze (render-loop equivalent of scene.pause/resume) ------

  /**
   * Freeze the scene while an overlay is open. Sets `state.frozen = true` so
   * `update()` renders the current 3D frame only and skips movement, turn
   * input, and ghost activity (Req 4.2, 6.7), and ducks the gameplay music so
   * the overlay audio is heard cleanly (matches GameScene's pause duck).
   */
  _freeze() {
    if (this.state) this.state.frozen = true;
    // Hide the on-screen touch controls so they neither appear over the open
    // quiz/lesson overlay nor capture input meant for it (Req 6.7, 7.8).
    this._setTouchControlsVisible(false);
    if (this.audio && typeof this.audio.duckMusic === 'function') this.audio.duckMusic();
  }

  /**
   * Unfreeze the scene when the overlay closes: clear `state.frozen` so the
   * render loop resumes driving movement/ghosts, and restore the gameplay music
   * volume.
   */
  _unfreeze() {
    if (this.state) this.state.frozen = false;
    // Restore the on-screen touch controls now that gameplay resumes.
    this._setTouchControlsVisible(true);
    if (this.audio && typeof this.audio.unduckMusic === 'function') this.audio.unduckMusic();
  }

  /**
   * Whether a scene key is registered with the Scene Manager. Used to guard the
   * QuizScene / LessonScene / GameOverScene launches (mirrors GameScene's guard
   * of the same name) so this scene never targets a missing scene.
   * @param {string} key
   * @returns {boolean}
   */
  _isSceneRegistered(key) {
    const mgr = this.scene && this.scene.manager;
    return !!(mgr && typeof mgr.getScene === 'function' && mgr.getScene(key));
  }

  // --- Fallback plumbing (Task 16 completes the handoff) ---------------------

  /**
   * Fall back to the 2D `GameScene` and complete the handoff (Req 1.6, 8.1,
   * 8.5). Triggered by:
   *   - `'no-webgl'`: no WebGL context at construction (create-time, no run yet),
   *   - `'context-lost'`: the WebGL context was lost mid-session during play,
   *   - `'maze'`: malformed Maze_Data (create-time).
   *
   * The handoff is idempotent (guarded by `_fallbackTo2D`) so a burst of
   * context-loss events resolves once. It:
   *   1. records the '2d' render-mode intent via the shared `Storage` so the
   *      menu preselects 2D next time (best-effort; never throws),
   *   2. shows a visible "3D unavailable" notice, and
   *   3. starts `GameScene` with the current grade — preserving lives/score via
   *      the shared registry `scoreSystem` when a run is already in progress
   *      (mid-session context loss), or a fresh run for a create-time failure.
   *
   * `Maze_Data` is NEVER modified — the same `getLevelLayout()` source drives
   * both modes; we only switch the renderer/scene.
   * @param {'no-webgl'|'context-lost'|'maze'} reason
   * @param {Error} [err]
   */
  _requestFallback(reason, err) {
    if (this._fallbackTo2D) return; // already handed off; ignore repeats
    this._fallbackTo2D = true;
    this._fallbackReason = reason;
    console.warn(`FP3DScene: falling back to 2D (${reason})`, err || '');
    this.events.emit('fp3d-fallback', { reason });

    // 1) Persist the '2d' render-mode intent (Req 6.3, 8.5). Best-effort: a
    //    blocked/absent storage degrades to in-memory inside Storage itself.
    if (this.storage && typeof this.storage.setRenderMode === 'function') {
      try {
        this.storage.setRenderMode('2d');
      } catch {
        /* persistence is best-effort; never block the fallback */
      }
    }

    // A mid-session context loss means a run is in progress: preserve the
    // player's lives/score through the shared registry ScoreSystem. A
    // create-time failure ('no-webgl'/'maze') has no run yet → fresh start.
    const runInProgress = reason === 'context-lost';

    // 2) Show the visible notice, then 3) hand off to GameScene. The notice is
    //    drawn before the handoff so it is guaranteed visible at the moment of
    //    the switch even if GameScene starts on the next tick.
    this._showFallbackNotice(() => this._startGameScene(runInProgress));
  }

  /**
   * Draw a visible "3D unavailable" notice over the current frame, then invoke
   * `done` to continue the handoff. Uses a Phaser text overlay on this scene's
   * camera so it shows regardless of the 3D canvas state; briefly held so the
   * player sees why the view changed before GameScene takes over.
   * @param {() => void} done
   */
  _showFallbackNotice(done) {
    let shown = false;
    try {
      const cam = this.cameras && this.cameras.main;
      const w = cam ? cam.width : 640;
      const h = cam ? cam.height : 480;
      // Dim backdrop + message so it reads over whatever the 3D frame left.
      this.add
        .rectangle(w / 2, h / 2, w, h, 0x000000, 0.7)
        .setScrollFactor(0)
        .setDepth(10000);
      this.add
        .text(w / 2, h / 2, '3D unavailable\nSwitching to 2D…', {
          fontFamily: 'monospace',
          fontSize: '24px',
          fontStyle: 'bold',
          color: '#ffff66',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10001);
      shown = true;
    } catch {
      /* headless/test or no camera yet — fall through to immediate handoff */
    }

    // Hold the notice briefly when it was actually shown, otherwise hand off
    // immediately (tests / headless). Guarded so a missing time plugin can't
    // strand the fallback.
    if (shown && this.time && typeof this.time.delayedCall === 'function') {
      this.time.delayedCall(900, done, undefined, this);
    } else {
      done();
    }
  }

  /**
   * Start the 2D `GameScene` with the current grade, preserving the run's
   * lives/score when `preserveScore` is true (mid-session fallback). Guarded so
   * a missing GameScene never throws. Uses the game-level Scene Manager
   * (always live) to stop this scene and start GameScene, mirroring the
   * game-over handoff.
   * @param {boolean} preserveScore
   */
  _startGameScene(preserveScore) {
    const payload = { grade: this.grade, preserveScore };
    const manager = this.scene && this.scene.manager;
    try {
      if (manager && typeof manager.stop === 'function') manager.stop('FP3DScene');
      if (manager && typeof manager.start === 'function') {
        manager.start('GameScene', payload);
        return;
      }
    } catch {
      /* fall through to the scene-local start */
    }
    try {
      this.scene.start('GameScene', payload);
    } catch {
      /* GameScene not registered (early tasks) — nothing more we can do */
    }
  }

  // --- Renderer host / sizing -------------------------------------------------

  /**
   * The DOM element the FP3D canvas renders into: the Phaser game canvas' parent
   * container so the 3D view sits with the game. Falls back to `document.body`
   * when the canvas/parent is unavailable (headless/tests).
   * @returns {HTMLElement}
   */
  _rendererParent() {
    const gameCanvas = this.game?.canvas;
    const parent = gameCanvas?.parentElement;
    if (parent) return parent;
    if (typeof document !== 'undefined' && document.body) return document.body;
    return gameCanvas || null;
  }

  /**
   * Resize the renderer to the box its canvas actually fills. The FP3D canvas
   * is styled 100%×100% of the host container, so the drawing buffer and camera
   * aspect must come from that container — NOT Phaser's fitted game size, which
   * has the maze's aspect and made the 3D view stretch horizontally.
   */
  _syncRendererSize() {
    if (!this.renderer) return;
    const host = this._rendererParent();
    let w = host?.clientWidth || 0;
    let h = host?.clientHeight || 0;
    if (!w || !h) {
      const scaleMgr = this.scale;
      w = scaleMgr?.displaySize?.width || this.game?.canvas?.width || 0;
      h = scaleMgr?.displaySize?.height || this.game?.canvas?.height || 0;
    }
    if (w && h) this.renderer.resize(w, h);
  }

  /**
   * Whether the OS/browser reports a reduced-motion preference at start (Req
   * 7.5). Guarded for environments without `matchMedia` (tests).
   * @returns {boolean}
   */
  _prefersReducedMotion() {
    try {
      return (
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch {
      return false;
    }
  }

  // --- Teardown ---------------------------------------------------------------

  _onShutdown() {
    this.scale?.off?.(Phaser.Scale.Events.RESIZE, this._syncRendererSize, this);
    // Remove the DOM touch-control overlay so it does not linger past the scene.
    this._destroyTouchControls();
    // Remove the raw touch/pointer gesture listeners + the Fullscreen_Toggle.
    this._destroyTouchGestures();
    // Remove the discreet return-to-menu control.
    this._destroyReturnToMenuButton();
    // Remove the portrait rotate hint + its viewport listeners.
    this._destroyRotateHint();
    // Tear down the "Level Complete!" dialog if the scene stops while it is up.
    if (this._levelClearModal) {
      try { this._levelClearModal.close(); } catch { /* ignore */ }
      this._levelClearModal = null;
    }
    this._destroyHud();
    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
    // Back to normal tempo for whatever comes next (menu / game over).
    if (this.audio && typeof this.audio.setMusicRate === 'function') this.audio.setMusicRate(1);
  }
}

// Reference the direction alias so linters don't flag it as unused; it documents
// the 2D-direction ↔ cardinal mapping the ghost heading tracking relies on.
void DIR_TO_CARDINAL;
