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

import { DEFAULT_GRADE, GRADES, GHOST_PERSONALITIES, FP3D } from '../config.js';
import { MazeGrid } from '../maze/mazeLogic.js';
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
import { isGhostVisible } from '../systems/fp3d/lineOfSight.js';
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
    // UIScene and later tasks share the one instance (Req 5.1, 5.4).
    this.scoreSystem = new ScoreSystem();
    this.registry.set('scoreSystem', this.scoreSystem);

    // Per-run bank of tagged micro-lessons for fruit collection (Task 15 uses
    // the freeze + overlay; here it is constructed and ready).
    this.lessonBank = new LessonBank();

    // --- Maze: the single source of truth (Req 1.5) --------------------------
    // Build a pure MazeGrid straight from getLevelLayout(); a malformed layout
    // throws in the MazeGrid constructor (validateLayout) — caught so the scene
    // records the 2D fallback intent instead of crashing (Task 16 wires the
    // actual GameScene handoff + notice, Req 1.6).
    try {
      this.grid = new MazeGrid({ layout: getLevelLayout(1), level: 1 });
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
      fruit: this._buildFruitState(), // { col, row, present }
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
    if (this.state.fruit) {
      this.renderer.setFruit(this.state.fruit.col, this.state.fruit.row, this.state.fruit.present);
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
      if (typeof this.audio.play === 'function') this.audio.play(AudioEvent.GAME_MUSIC);
    }

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

    // Duck the gameplay music while an overlay is open and restore it on
    // resume, matching GameScene's overlay ducking (Req 12.7). Because FP3DScene
    // drives its own render loop rather than pausing via the Scene Manager, the
    // duck/unduck is driven explicitly from `_freeze`/`_unfreeze` (the `frozen`
    // flag keeps the 3D frame drawing behind the DOM overlay).

    // Live held move direction ('forward'|'back'|null) for continuous walking.
    this._heldMoveDir = null;

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
      this._updateHud();
      this.renderer.render(this.state);
      return;
    }

    // Capture the frame delta so the ghost step cadence in `_advanceGhosts` can
    // accumulate it without re-threading the loop argument.
    this._lastDelta = delta;

    this._pollInput();
    this._stepMovement(delta);
    this._advanceGhosts();
    this._renderGhosts();
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
   * Build the single fruit runtime state from the maze's first fruit spawn tile
   * (Req 1.4). Present from the start so it renders in the seeded scene; the
   * full fruit spawn cadence + lesson freeze is Task 15's concern.
   * @returns {{col:number,row:number,present:boolean}|null}
   */
  _buildFruitState() {
    const fruits = this.grid.fruitSpawns || [];
    if (!fruits.length) return null;
    const { col, row } = fruits[0];
    return { col, row, present: true };
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

  // --- On-screen touch controls (Req 2.6) ------------------------------------

  /**
   * Build a DOM overlay of on-screen controls layered above the game canvas so
   * FP3D_Mode is fully playable on a touch device (Req 2.6). The controls map to
   * the SAME intent pipeline as the keyboard:
   *   - Forward / Back  → `_queueMove('forward'|'back')` (buffered move intent).
   *   - Turn ◀ / Turn ▶ → `_queueTurn('left'|'right')` (immediate/buffered turn).
   * plus a labeled "Reduced motion" toggle (Req 7.4). Every control is a real
   * `<button>` — keyboard-focusable (Tab/Enter/Space) and given an accessible
   * name via `aria-label` — so the overlay is operable without a pointer too.
   * The overlay lives on `#overlay-root` (same host as the quiz/lesson modals)
   * and is hidden while the scene is frozen so it never appears over or steals
   * input from an open quiz/lesson overlay (Req 6.7).
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
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      padding: '16px',
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
      // gesture by swallowing the click that follows a pointerdown.
      let handledByPointer = false;
      btn.addEventListener('pointerdown', (e) => {
        handledByPointer = true;
        e.preventDefault();
        onActivate();
      });
      btn.addEventListener('click', (e) => {
        if (handledByPointer) {
          handledByPointer = false;
          return;
        }
        e.preventDefault();
        onActivate();
      });
      return btn;
    };

    // Left cluster: turn left / turn right.
    const leftCluster = document.createElement('div');
    Object.assign(leftCluster.style, { display: 'flex', alignItems: 'flex-end' });
    leftCluster.appendChild(makeButton('\u25C0', 'Turn left', () => this._queueTurn('left')));
    leftCluster.appendChild(makeButton('\u25B6', 'Turn right', () => this._queueTurn('right')));

    // Right cluster: forward / back stacked, plus the reduced-motion toggle.
    const rightCluster = document.createElement('div');
    Object.assign(rightCluster.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
    });

    const moveRow = document.createElement('div');
    Object.assign(moveRow.style, { display: 'flex' });
    moveRow.appendChild(makeButton('\u25B2', 'Move forward', () => this._queueMove('forward')));
    moveRow.appendChild(makeButton('\u25BC', 'Move back', () => this._queueMove('back')));

    const motionBtn = makeButton(
      this._reducedMotion ? 'Motion: off' : 'Motion: on',
      'Toggle reduced motion',
      () => this._toggleReducedMotion(),
    );
    motionBtn.setAttribute('aria-pressed', this._reducedMotion ? 'true' : 'false');
    Object.assign(motionBtn.style, { minWidth: '120px', minHeight: '44px', fontSize: '14px' });
    this._motionBtn = motionBtn;

    rightCluster.appendChild(moveRow);
    rightCluster.appendChild(motionBtn);

    container.appendChild(leftCluster);
    container.appendChild(rightCluster);

    root.appendChild(container);
    this._touchControls = container;
  }

  /**
   * Show/hide the on-screen touch controls. Hidden while frozen so they never
   * appear over — or steal focus/input from — an open quiz/lesson overlay
   * (Req 6.7). Called from `_freeze`/`_unfreeze`.
   * @param {boolean} visible
   */
  _setTouchControlsVisible(visible) {
    if (this._touchControls) {
      this._touchControls.style.display = visible ? 'flex' : 'none';
    }
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
    this._drawMinimap();
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

    // Fruit markers. Every fruit SPAWN tile is shown as a faint ring so the
    // player always knows where fruit can appear; the ACTIVE fruit (present and
    // uncollected) is drawn as a bright, outlined red cherry dot with a soft
    // glow so it clearly stands out on the map.
    const fruitR = Math.max(3, cell * 0.5);
    const spawns = (grid.fruitSpawns && grid.fruitSpawns.length)
      ? grid.fruitSpawns
      : (st.fruit ? [st.fruit] : []);
    for (const fs of spawns) {
      const fx = ox + (fs.col + 0.5) * cell;
      const fy = oy + (fs.row + 0.5) * cell;
      const active = st.fruit && st.fruit.present && st.fruit.col === fs.col && st.fruit.row === fs.row;
      if (active) {
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
      } else {
        // Faint spawn-location ring.
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(1, cell * 0.1);
        ctx.strokeStyle = '#ff8a7a';
        ctx.beginPath();
        ctx.arc(fx, fy, fruitR * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
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
    for (const el of [this._hudScore, this._minimapCanvas, this._hudCompass]) {
      if (!el) continue;
      try { el.remove(); } catch { if (el.parentNode) el.parentNode.removeChild(el); }
    }
    this._hudScore = null;
    this._minimapCanvas = null;
    this._hudCompass = null;
  }

  /** Remove the touch-control overlay from the DOM (scene teardown). */
  _destroyTouchControls() {
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

    // Live held direction wins (continuous movement).
    if (this._heldMoveDir) {
      this._beginStep(this._heldMoveDir);
      if (st.traversal) return; // a step started; done
    }
    // Otherwise honor a single buffered one-shot move (touch button tap).
    const intent = st.buffer.take();
    if (intent && intent.type === 'move') {
      this._beginStep(intent.dir);
    }
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
    if (wrapped.col !== from.col || wrapped.row !== from.row) {
      to = { col: wrapped.col, row: wrapped.row, moved: true };
    } else {
      to = resolveMove(this.grid, from.col, from.row, stepFacing);
    }

    if (!to.moved) return; // wall / out of bounds: stay put, keep facing (Req 2.3)

    const ms = FP3D.tileTraversalMs; // eased in the renderer; longer = smoother glide
    st.traversal = {
      active: true,
      from,
      to: { col: to.col, row: to.row },
      ms,
      elapsed: 0,
    };
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
    }

    // --- Fruit (Req 5.1, 5.2) ------------------------------------------------
    // Minimal handling: remove the marker and grant a life + lesson hook. The
    // FULL freeze → LessonScene overlay is Task 15; here we only clear a clean
    // seam so pellet/movement flow stays correct and the fruit isn't collected
    // twice.
    const fruit = this.state.fruit;
    if (fruit && fruit.present && fruit.col === col && fruit.row === row) {
      this._onFruitCollected(fruit);
    }

    // --- Capture check (Task 15 owns the quiz freeze) ------------------------
    this._checkCapture();
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

    // Lives remain → reset player + ghosts to spawns (Req 4.3) and unfreeze.
    this.resetPositions();
    this._caught = false;
    this._unfreeze();
  }

  /**
   * Reset Math Man and every ghost to their spawn tiles and re-seed the camera
   * and renderer, mirroring GameScene.resetPositions (Req 4.3). Because FP3D
   * tracks position as in-memory `{ col, row }`, this rewrites those tiles (and
   * clears any in-flight traversal / buffered intent) rather than moving
   * sprites, then snaps the camera and ghost meshes to the reset state.
   */
  resetPositions() {
    const st = this.state;
    if (!st) return;

    // Player back to spawn, facing north, no in-flight step or pending intent.
    st.player.col = this._playerSpawn.col;
    st.player.row = this._playerSpawn.row;
    st.player.facing = this._spawnFacing || 'north';
    st.traversal = null;
    if (st.buffer && typeof st.buffer.take === 'function') st.buffer.take();

    // Ghosts back to their spawn tiles with a cleared heading.
    for (const ghost of st.ghosts) {
      if (ghost.spawn) {
        ghost.col = ghost.spawn.col;
        ghost.row = ghost.spawn.row;
      }
      ghost.dir = null;
      // Returned inside the house → run the exit sequence again (matches 2D).
      ghost.exited = false;
    }
    // Reset the ghost step accumulator so cadence restarts cleanly.
    this._ghostAccumMs = 0;
    // Stop any continuous walking so the player doesn't auto-move on resume.
    this._heldMoveDir = null;

    // Re-seed the renderer: clear any face-the-ghost scare, snap the camera to
    // the player spawn, and push the reset ghost positions.
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

    // Extra life, capped at LIVES_MAX = 10 by ScoreSystem (Req 5.2). Same shared
    // ScoreSystem — never forked.
    this.scoreSystem.gainLife();

    if (this.renderer) this.renderer.setFruit(fruit.col, fruit.row, false);
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
    // eslint-disable-next-line no-console
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

  /** Resize the renderer to the current game canvas dimensions. */
  _syncRendererSize() {
    if (!this.renderer) return;
    const scaleMgr = this.scale;
    const w = scaleMgr?.displaySize?.width || this.game?.canvas?.width || 0;
    const h = scaleMgr?.displaySize?.height || this.game?.canvas?.height || 0;
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
    this._destroyHud();
    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      this.renderer = null;
    }
  }
}

// Reference the direction alias so linters don't flag it as unused; it documents
// the 2D-direction ↔ cardinal mapping the ghost heading tracking relies on.
void DIR_TO_CARDINAL;
