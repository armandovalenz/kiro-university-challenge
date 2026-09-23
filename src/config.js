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
  powerPellet: 50,
  fruit: 100,
};

// --- Timings (milliseconds) ---------------------------------------------------

export const TIMINGS = {
  splashAutoAdvance: 2000, // Splash auto-advance delay (Req 7.2).
  fruitSpawnInterval: 20000, // Base fruit spawn cadence (Req 5.1).
  fruitLifetime: 9000, // How long an uncollected fruit lingers.
  musicCrossfade: 400, // AudioBus crossfade duration.
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

// --- Persistence --------------------------------------------------------------

/** Namespaced localStorage key for all persisted records. */
export const STORAGE_KEY = 'mathman.v1';

/** Default persisted-state shape (see Storage design). */
export const STORAGE_DEFAULTS = {
  highScore: 0,
  lastDifficulty: DEFAULT_GRADE,
  audioMuted: false,
  quizStats: { answered: 0, correct: 0 },
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
  collectibles: { key: 'collectibles', path: 'assets/images/05_collectibles_and_math_icons.png' },
  uiKit: { key: 'ui_kit', path: 'assets/images/optimized/06_ui_kit.png' },
  einsteinPoster: { key: 'einstein_poster', path: 'assets/images/optimized/08_poster_einstein_enemies.png' },
  hero: { key: 'hero', path: 'assets/images/optimized/09_hero_einstein_enemies.png' },
};

/** Path to the bundled question bank (Req 4.2). */
export const QUESTION_BANK_PATH = 'assets/questions/math_man_question_bank_120.json';

/** Base path for audio clips (WAV; keys defined with AudioBus in a later task). */
export const AUDIO_BASE_PATH = 'assets/audio/';
