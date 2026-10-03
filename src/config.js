// Core game constants for Math Man.
//
// This module is framework-agnostic (no Phaser imports) so it can be shared by
// scenes, entities, systems, and unit/property tests alike. Tunable numbers
// (sizes, speeds, timings, lives, colors, asset keys) live here rather than
// being hardcoded across the codebase.

// --- Grid / rendering ---------------------------------------------------------

/** Size of one maze tile in pixels. Movement is grid-locked to this. */
export const TILE_SIZE = 24;

/** Logical game resolution (columns/rows established later by the maze). */
export const GAME_WIDTH = 672; // 28 tiles wide (classic maze width)
export const GAME_HEIGHT = 744; // 31 tiles tall + HUD room

// --- Lives --------------------------------------------------------------------

/** Lives a new game starts with (Req 2.1). */
export const LIVES_START = 6;

/** Hard cap on lives (Req 2.5, 2.6). */
export const LIVES_MAX = 10;

// --- Entity speeds (pixels/second) --------------------------------------------

export const SPEEDS = {
  mathMan: 120,
  ghost: 110,
  // Ghost speed multiplier per selected grade (Req 3.6, 10.4).
  ghostByGrade: {
    5: 0.9,
    6: 1.0,
    7: 1.15,
  },
};

// --- Scoring ------------------------------------------------------------------

export const POINTS = {
  pellet: 10,
  powerPellet: 100, // big pellets pay x2 (was 50)
  fruit: 100,
};

// --- Timings (milliseconds) ---------------------------------------------------

export const TIMINGS = {
  splashAutoAdvance: 2000, // Splash auto-advance delay (Req 7.2).
  fruitSpawnInterval: 20000, // Base fruit spawn cadence (Req 5.1).
  fruitLifetime: 9000, // How long an uncollected fruit lingers.
  musicCrossfade: 400, // AudioBus crossfade duration.
};

/**
 * Fruit appears on a random corridor tile at least this many tiles (Manhattan)
 * from Math Man and every ghost, so it never pops up underfoot (Req 5.1).
 */
export const FRUIT_MIN_DISTANCE = 4;

/**
 * Pressure tempo (Req 12.9): the score music speeds up (and rises in pitch)
 * as the nearest ghost comes within `startTiles` WALKING tiles of Math Man,
 * reaching `maxRate` when it's on top of him. The change is ramped by at most
 * `rampUpPerSec` / `rampDownPerSec` rate units per second, so it's gradual.
 * Distance is re-checked every `checkMs`.
 */
export const PRESSURE = {
  startTiles: 6,
  maxRate: 1.2,
  // Rate = 1 + 0.2 · closeness^3 → subtle far away, dramatic up close:
  //   6+ tiles 1.00 · 4 tiles 1.01 · 3 tiles 1.03 · 2 tiles 1.06 ·
  //   1 tile 1.12 · touching 1.20
  curve: 3,
  rampUpPerSec: 0.35, // fast enough for the last-second spike to land
  rampDownPerSec: 0.06, // eases back slowly once the ghost is gone
  checkMs: 150,
};

// --- Grades / difficulty ------------------------------------------------------

export const GRADES = [5, 6, 7];

/** Grade used when the player has not chosen one (Req 10.2). */
export const DEFAULT_GRADE = 5;

// --- Einstein ghost colors (Req 3.2) ------------------------------------------
// Named after the classic Pac-Man quartet; rendered with an Einstein motif.

export const GHOST_COLORS = {
  red: 0xff0000,
  pink: 0xffb8ff,
  cyan: 0x00ffff,
  orange: 0xffb852,
};

/** Spawn order / personality assignment for the four ghosts. */
export const GHOST_PERSONALITIES = [
  { key: 'red', color: GHOST_COLORS.red, personality: 'chase' },
  { key: 'pink', color: GHOST_COLORS.pink, personality: 'ambush' },
  { key: 'cyan', color: GHOST_COLORS.cyan, personality: 'vector' },
  { key: 'orange', color: GHOST_COLORS.orange, personality: 'scatter' },
];

// --- Menu / blueprint background ---------------------------------------------
// A drawn "blueprint" backdrop (deep navy base + lighter blue grid lines) used
// by MenuScene instead of the dimmed hero photo, for a clean, readable,
// on-theme look. Colors are 0xRRGGBB so Phaser Graphics/rectangles can use them
// directly.
export const BLUEPRINT = {
  base: 0x0a1f4d, // deep blueprint navy
  baseTop: 0x061634, // slightly darker top for a subtle vertical gradient
  grid: 0x2b6fd6, // lighter blue grid lines
  gridBold: 0x4f93ff, // brighter line every few cells
  cell: 24, // fine grid cell size (px) — matches TILE_SIZE
  boldEvery: 4, // draw a brighter line every N cells
};

// Seasonal Halloween "dungeon" dressing for the Splash (intro) and Menu scenes:
// a dark stone-brick wall, flaming wall torches with flickering light pools,
// rising embers, drifting fog, a few bats and a vignette. Everything is drawn
// or generated at runtime (no new assets). Set `enabled: false` to return the
// menu to the blueprint backdrop. Honors prefers-reduced-motion (static
// flames, no bats, no drifting).
export const HALLOWEEN = {
  enabled: true,
  stone: 0x2b2630, // brick face
  stoneVariance: 0.22, // ± brightness per brick
  mortar: 0x0d0b10,
  brickW: 48,
  brickH: 24,
  darkness: 0.45, // black overlay over the bricks (0 = lit, 1 = black)
  lightColor: 0xff8a2a, // warm torch light pool
  lightRadius: 190,
  lightAlpha: 0.55,
  flickerAmount: 0.2, // ± light flicker (held steady under reduced motion)
  flameColors: [0xfff4b0, 0xffb040, 0xff5a10, 0x3a0a00], // core → tip
  emberColor: 0xff7a1a,
  fogAlpha: 0.22,
  fogSpeed: 0.12, // px per ms
  bats: 4,
  vignetteAlpha: 0.85,
};

// --- Persistence --------------------------------------------------------------

/** Namespaced localStorage key for all persisted records. */
export const STORAGE_KEY = 'mathman.v1';

/** Default persisted-state shape (see Storage design). */
export const STORAGE_DEFAULTS = {
  highScore: 0,
  lastDifficulty: DEFAULT_GRADE,
  audioMuted: false,
  quizStats: { answered: 0, correct: 0 },
  // Render mode the player last chose (2D top-down vs first-person 3D). Coerced
  // to '2d' when absent/invalid by Storage.normalize (Req 6.3, 6.6). The literal
  // default mirrors DEFAULT_RENDER_MODE below.
  renderMode: '2d',
};

// --- Asset keys & paths -------------------------------------------------------
// Images live in public/assets/images/ (catalogued in ASSETS.md) and are
// referenced by these stable keys throughout the game. Paths are relative to
// the web root (Vite serves `public/` at `/`).

// Display images (logo/hero/ui-kit/poster) are rendered scaled-to-fit, so the
// game loads runtime-optimized copies from `optimized/` (resized to a ~1000px
// longest side; see ASSETS.md "Runtime optimization") to keep load times
// reasonable (Req 11.3, 13.6). The full-resolution originals stay in this
// directory for provenance and future re-exports.
//
// The two sprite SHEETS (`04_mascot_sprite_sheet.png`,
// `05_collectibles_and_math_icons.png`) are loaded from the ORIGINALS so their
// frame geometry is preserved for when a frame map is wired; the game currently
// renders drawn fallbacks for both.
export const IMAGE_ASSETS = {
  logo: { key: 'logo', path: 'assets/images/optimized/02_logo.png' },
  appIcon: { key: 'app_icon', path: 'assets/images/03_app_icon.png' },
  mascotSheet: { key: 'mascot_sheet', path: 'assets/images/04_mascot_sprite_sheet.png' },
  // Frame geometry for the mascot sheet. `04_mascot_sprite_sheet.png` is a
  // 1448×1086 image laid out as a 4-column × 2-row grid of full-body poses, so
  // each frame is exactly 362×543 px. Frames are numbered left→right, top→bottom
  // (Phaser default): 0 idle, 1 run-A, 2 run-B, 3 leap, 4 walk-left-pose,
  // 5 cheer, 6 think, 7 power-up. The originals stay high-res; MathMan scales a
  // frame down to TILE_SIZE at draw time with antialiasing on, so no quality is
  // baked away. See public/assets/images/ASSETS.md.
  mascotSheetFrame: { frameWidth: 362, frameHeight: 543 },
  collectibles: { key: 'collectibles', path: 'assets/images/05_collectibles_and_math_icons.png' },
  uiKit: { key: 'ui_kit', path: 'assets/images/optimized/06_ui_kit.png' },
  einsteinPoster: { key: 'einstein_poster', path: 'assets/images/optimized/08_poster_einstein_enemies.png' },
  hero: { key: 'hero', path: 'assets/images/optimized/09_hero_einstein_enemies.png' },
};

/**
 * Named frames within the mascot sheet (see IMAGE_ASSETS.mascotSheetFrame).
 * `idle` shows when Math Man is stopped; `walk` cycles the two running poses
 * while moving. The character art faces RIGHT, so left is a horizontal flip.
 */
export const MASCOT_FRAMES = {
  idle: 0,
  walk: [1, 2],
};

/** Path to the bundled question bank (Req 4.2). */
export const QUESTION_BANK_PATH = 'assets/questions/math_man_question_bank_120.json';

/**
 * Base path (web-root-relative, like QUESTION_BANK_PATH) for the optional
 * per-question visual-aid images. A question's `image.file` is a bare filename
 * (e.g. `plants.png`); the quiz UI joins it onto this base to build the runtime
 * URL `assets/questions/images/<file>`. Vite serves `public/` at `/`, so the
 * leading slash is omitted to match every other asset reference in the app.
 */
export const QUESTION_IMAGE_BASE_PATH = 'assets/questions/images/';

/** Base path for audio clips (WAV; keys defined with AudioBus in a later task). */
export const AUDIO_BASE_PATH = 'assets/audio/';

// --- First-person 3D mode (FP3D_Mode) ----------------------------------------
// Tunable constants for the optional Three.js first-person renderer/controller
// layer. Kept here (not hardcoded in scenes/renderer) so the 3D layer stays
// config-driven and the framework-agnostic modules can read timings without
// importing Three.js. See .kiro/specs/first-person-3d-mode/design.md.

export const FP3D = {
  eyeHeight: TILE_SIZE * 0.5, // camera anchor height at tile center (Req 2.1)
  dprCap: 2, // devicePixelRatio cap (perf §5)
  tileTraversalMs: 300, // per-tile move; longer + eased so the glide is smooth, not sharp (Req 2.2 upper bound relaxed for feel)
  turnAnimMs: 300, // cardinal turn; matched to the move so turn-and-go corners sweep smoothly (0 when reduced-motion, Req 7.4)
  fovDegrees: 75, // camera + visibility FOV
  webglTimeoutMs: 5000, // context-creation budget before 2D fallback (Req 8.1)
  assetTimeoutMs: 10000, // 3D asset load budget before placeholder (Req 8.2)
  // Ghosts in FP3D_Mode step at this fraction of their 2D per-grade speed so
  // they close in gradually and are easier to see approaching. <1 = slower.
  ghostSpeedScale: 0.5,
};

/**
 * Render mode the game falls back to when FP3D_Mode can't run. The menu always
 * launches '3d'; '2d' is reached only on a WebGL_Context or Maze_Data failure,
 * so this now describes the fallback target, not a launch default (Req 10.3,
 * 10.4).
 */
export const DEFAULT_RENDER_MODE = '2d';

// --- Mobile gesture controls (FP3D_Mode) -------------------------------------
// Finalized thresholds for the one-thumb touch scheme (Floating_Joystick drag,
// Flick turn, Tap/Double_Tap/Long_Press). Kept here so the framework-agnostic
// gesture classifier/resolver and the scene/renderer read tunable numbers from
// config rather than hardcoding any gesture value. Distances in dip unless the
// name says px. See .kiro/specs/mobile-gestures-fullscreen/design.md.

export const GESTURE = {
  movementDeadzonePx: 18, // Movement_Deadzone: below this a Drag is steer, not a move (Req 2.8, 11.3)
  flickDurationMs: 150, // Flick_Duration_Threshold — at or below is a Flick candidate (Req 4.1, 11.6)
  flickDistanceDip: 48, // Flick_Distance_Threshold — at or above (dip) (Req 4.1, 11.6)
  flickAngleBandDeg: 30, // within 30° of horizontal to be a Flick, else Drag (Req 4.1, 4.5, 11.6)
  forwardAssistConeDeg: 25, // Forward_Assist_Cone: ±25° from up, boundary inside (Req 3.1, 3.3, 11.4)
  cardinalSectorDeg: 45, // Cardinal_Sectors: ±45° around up/down/left/right (Req 2.1–2.3)
  tapDurationMs: 200, // Tap_Duration_Threshold — at or below is a Tap (Req 5.8)
  tapMoveToleranceDip: 12, // Tap_Move_Tolerance — total movement below this (Req 5.8–5.10)
  doubleTapIntervalMs: 300, // Double_Tap_Interval between two Tap starts (Req 5.9)
  longPressMs: 500, // Long_Press_Duration — stationary hold (Req 5.10)
  interactionRangeTiles: 3, // interaction activation range from the camera (Req 6.1, 6.5)
};

// --- Knowledge Power (FP3D_Mode book projectile) ------------------------------
// The "Knowledge Power" charge meter + thrown-book projectile. The meter is a
// framework-agnostic integer in [0, max] owned by `systems/KnowledgePower.js`;
// these are the only tunable gameplay numbers (no hardcoded values in the scene
// or renderer). Projectile fields drive the renderer's cosmetic parabolic arc;
// the authoritative hit test runs over the pure tile path (`systems/bookThrow.js`).

export const KNOWLEDGE = {
  max: 10, // full charge = ten books (the HUD book bar has this many slots)
  throwCost: 1, // charge spent per throw; a throw at < this cannot fire
  maxRangeTiles: 8, // how many tiles the thrown book can travel before landing
  projectileSpeed: TILE_SIZE * 10, // horizontal travel speed (world units/sec) along the facing axis
  projectileGravity: TILE_SIZE * 40, // downward acceleration (world units/sec²) for the arc
  projectileArcHeight: TILE_SIZE * 0.9, // initial upward lift so the book rises then falls
  // On a hit, the struck ghost DIMS OUT over this window before being sent home.
  // Deferring the hit cue + send-home by this long also lets the knowledge-power
  // throw sting finish instead of being cut off by the hit cue (AudioBus plays
  // one sfx at a time). Under reduced motion the dim is instant (hide now).
  hitDimMs: 300,
};
