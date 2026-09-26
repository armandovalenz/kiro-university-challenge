// Storage — framework-agnostic wrapper over `localStorage` with an in-memory
// fallback, persisting all Math Man records under the single namespaced key
// `mathman.v1`.
//
// This module is framework-agnostic (NO Phaser imports) so it stays unit- and
// property-testable and portable (see .kiro/steering/tech.md / structure.md).
// Scenes and systems (BootScene, MenuScene, AudioBus, QuizSystem, GameOverScene)
// hold a single Storage INSTANCE and read/write through it.
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.5, 10.6, 12.4
// Properties:
//   Property 15 — high score is a persisted, monotonic maximum.
//   Property 16 — storage degrades to in-memory records without throwing.
//   Property 17 — quiz stats track answers (answered++, correct++ only if right).
//   Property 18 — difficulty defaults to DEFAULT_GRADE and persists.
//   Property 19 — a single global high score across all grades.

import { STORAGE_KEY, STORAGE_DEFAULTS, GRADES, DEFAULT_RENDER_MODE } from '../config.js';

/** The only render modes Storage will persist; anything else coerces to '2d'. */
const RENDER_MODES = ['2d', '3d'];

/**
 * A fresh, deeply-copied defaults object. Never hand callers (or the internal
 * cache) a reference to the shared STORAGE_DEFAULTS so nothing can mutate it.
 * @returns {{highScore:number,lastDifficulty:number,audioMuted:boolean,quizStats:{answered:number,correct:number}}}
 */
function makeDefaults() {
  return {
    highScore: STORAGE_DEFAULTS.highScore,
    lastDifficulty: STORAGE_DEFAULTS.lastDifficulty,
    audioMuted: STORAGE_DEFAULTS.audioMuted,
    quizStats: {
      answered: STORAGE_DEFAULTS.quizStats.answered,
      correct: STORAGE_DEFAULTS.quizStats.correct,
    },
    renderMode: normalizeRenderMode(STORAGE_DEFAULTS.renderMode),
  };
}

/** Deep copy of a state object so callers can never mutate internal state. */
function cloneState(state) {
  return {
    highScore: state.highScore,
    lastDifficulty: state.lastDifficulty,
    audioMuted: state.audioMuted,
    quizStats: {
      answered: state.quizStats.answered,
      correct: state.quizStats.correct,
    },
    renderMode: state.renderMode,
  };
}

/**
 * Coerce an arbitrary value to a valid render mode. Only '2d' and '3d' are
 * valid; everything else (absent, wrong type, unknown string) falls back to
 * DEFAULT_RENDER_MODE ('2d') so FP3D_Mode is strictly opt-in (Req 6.3, 6.6).
 * @param {*} value
 * @returns {'2d'|'3d'}
 */
function normalizeRenderMode(value) {
  return RENDER_MODES.includes(value) ? value : DEFAULT_RENDER_MODE;
}

/** Coerce to a non-negative, finite integer, else fall back to `fallback`. */
function toCount(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return fallback;
}

/**
 * Normalize an arbitrary parsed value into a valid state shape, repairing or
 * discarding any invalid on-disk fields (Property 15/17/18 rely on this).
 * @param {*} parsed
 * @returns {object} a valid, defaulted state.
 */
function normalize(parsed) {
  const defaults = makeDefaults();
  if (!parsed || typeof parsed !== 'object') return defaults;

  const state = defaults;

  // highScore: non-negative finite integer.
  state.highScore = toCount(parsed.highScore, defaults.highScore);

  // lastDifficulty: must be one of the supported grades, else default.
  state.lastDifficulty = GRADES.includes(parsed.lastDifficulty)
    ? parsed.lastDifficulty
    : defaults.lastDifficulty;

  // audioMuted: coerce to a real boolean.
  state.audioMuted = !!parsed.audioMuted;

  // quizStats: non-negative integers; correct can never exceed answered.
  const rawStats = parsed.quizStats && typeof parsed.quizStats === 'object'
    ? parsed.quizStats
    : {};
  const answered = toCount(rawStats.answered, defaults.quizStats.answered);
  const correct = toCount(rawStats.correct, defaults.quizStats.correct);
  state.quizStats.answered = answered;
  state.quizStats.correct = Math.min(correct, answered);

  // renderMode: only '2d' or '3d'; any invalid/absent value coerces to '2d'.
  state.renderMode = normalizeRenderMode(parsed.renderMode);

  return state;
}

export default class Storage {
  /**
   * @param {(Storage.Backend|null)} [backend] a Web-Storage-like object with
   *   `getItem`/`setItem`/`removeItem`. Defaults to the ambient
   *   `localStorage`. Pass `null` (or a store whose methods throw) to force the
   *   in-memory fallback path — this is what the property tests use to exercise
   *   Property 16 without a real browser.
   */
  constructor(backend = resolveAmbientStorage()) {
    /** @type {object|null} the backing Web-Storage, or null when unavailable. */
    this._backend = null;
    /** @type {boolean} true once we have fallen back to in-memory records. */
    this._memoryFallback = false;
    /** @type {object} the authoritative in-memory snapshot of state. */
    this._state = makeDefaults();

    // A `null` backend forces the in-memory path immediately.
    if (backend === null || backend === undefined) {
      this._memoryFallback = true;
    } else if (isUsableBackend(backend)) {
      this._backend = backend;
    } else {
      // A backend was supplied but probing it threw → in-memory fallback.
      this._memoryFallback = true;
    }

    // Prime the cache from whatever source of truth we ended up with.
    this._state = this._readFromSource();
  }

  /** @returns {boolean} whether records are currently kept only in memory. */
  get usingMemoryFallback() {
    return this._memoryFallback || this._backend === null;
  }

  /**
   * Read persisted state from the backing store, normalizing invalid values.
   * On any failure (unavailable storage, malformed JSON) switch to the
   * in-memory fallback and return defaults (Req 6.5, Property 16).
   * @returns {object} a fresh copy of the loaded state.
   */
  load() {
    this._state = this._readFromSource();
    return cloneState(this._state);
  }

  /**
   * A defensive copy of the current cached state without touching the backend.
   * @returns {object}
   */
  get() {
    return cloneState(this._state);
  }

  /**
   * Merge a partial patch into the current state and persist it. Never throws:
   * quota/denied/serialization errors switch to the in-memory fallback
   * (Req 6.5, Property 16).
   * @param {object} [patch] partial state to merge (supports nested quizStats).
   * @returns {object} a fresh copy of the merged state.
   */
  save(patch = {}) {
    const next = cloneState(this._state);

    if (patch && typeof patch === 'object') {
      if ('highScore' in patch) next.highScore = patch.highScore;
      if ('lastDifficulty' in patch) next.lastDifficulty = patch.lastDifficulty;
      if ('audioMuted' in patch) next.audioMuted = patch.audioMuted;
      if ('renderMode' in patch) next.renderMode = patch.renderMode;
      if (patch.quizStats && typeof patch.quizStats === 'object') {
        next.quizStats = {
          ...next.quizStats,
          ...patch.quizStats,
        };
      }
    }

    // Normalize so an out-of-range patch can never corrupt persisted state.
    this._state = normalize(next);
    this._writeToSource(this._state);
    return cloneState(this._state);
  }

  /**
   * Persist a new high score only when it beats the stored one (Req 6.4). The
   * stored value is a monotonic maximum across every grade (Property 15, 19).
   * @param {number} score candidate final score.
   * @returns {number} the resulting (possibly unchanged) high score.
   */
  updateHighScore(score) {
    if (typeof score === 'number' && Number.isFinite(score) && score > this._state.highScore) {
      this.save({ highScore: Math.trunc(score) });
    }
    return this._state.highScore;
  }

  /**
   * Record one answered quiz question (Req 6.6, Property 17): the answered
   * count always increments, the correct count only when `correct` is truthy.
   * @param {boolean} correct whether the answer was correct.
   * @returns {{answered:number, correct:number}} the updated stats.
   */
  recordQuizAnswer(correct) {
    const stats = this._state.quizStats;
    this.save({
      quizStats: {
        answered: stats.answered + 1,
        correct: stats.correct + (correct ? 1 : 0),
      },
    });
    return { ...this._state.quizStats };
  }

  /**
   * Persist the selected difficulty/grade so it preselects next visit
   * (Req 10.5, Property 18). Invalid grades are ignored.
   * @param {number} grade one of GRADES (5, 6, 7).
   * @returns {number} the effective persisted difficulty.
   */
  setDifficulty(grade) {
    if (GRADES.includes(grade)) {
      this.save({ lastDifficulty: grade });
    }
    return this._state.lastDifficulty;
  }

  /**
   * Persist the selected render mode so it preselects next visit (Req 6.3,
   * 6.6). Only '2d' or '3d' are valid; any other value is ignored (the stored
   * mode is left unchanged). Mirrors {@link setDifficulty}.
   * @param {'2d'|'3d'} mode
   * @returns {'2d'|'3d'} the effective persisted render mode.
   */
  setRenderMode(mode) {
    if (RENDER_MODES.includes(mode)) {
      this.save({ renderMode: mode });
    }
    return this._state.renderMode;
  }

  /**
   * Persist the mute flag (Req 12.4). Coerced to a real boolean.
   * @param {boolean} muted
   * @returns {boolean} the persisted mute state.
   */
  setMuted(muted) {
    this.save({ audioMuted: !!muted });
    return this._state.audioMuted;
  }

  // --- Internals -------------------------------------------------------------

  /**
   * @private Read + normalize state from the backend, or return the current
   * in-memory snapshot when in fallback mode. Switches to fallback on error.
   */
  _readFromSource() {
    if (this._memoryFallback || !this._backend) {
      // In-memory: the cache IS the source of truth.
      return cloneState(this._state);
    }
    try {
      const raw = this._backend.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined || raw === '') {
        return makeDefaults();
      }
      return normalize(JSON.parse(raw));
    } catch {
      // Read/parse failed → degrade to in-memory records (Property 16).
      this._memoryFallback = true;
      this._backend = null;
      return makeDefaults();
    }
  }

  /**
   * @private Write state to the backend. On any failure switch to the in-memory
   * fallback; the cache (`_state`) already holds the value so nothing is lost.
   */
  _writeToSource(state) {
    if (this._memoryFallback || !this._backend) return; // memory: cache is enough
    try {
      this._backend.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      this._memoryFallback = true;
      this._backend = null;
    }
  }
}

/** Named export kept alongside the default for import-style flexibility. */
export { Storage };

/**
 * Resolve the ambient Web-Storage without throwing in non-browser (test/SSR)
 * environments where `localStorage` is absent.
 * @returns {object|null}
 */
function resolveAmbientStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    /* accessing localStorage can itself throw (e.g. sandboxed iframes) */
  }
  return null;
}

/**
 * Probe a backend to confirm it is actually usable (private mode / disabled
 * storage throws on write). Returns false on any error.
 * @param {object} backend
 * @returns {boolean}
 */
function isUsableBackend(backend) {
  if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function') {
    return false;
  }
  try {
    const probe = '__mathman_probe__';
    backend.setItem(probe, '1');
    if (typeof backend.removeItem === 'function') backend.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
