// ScoreSystem — tracks score, lives, and level for a game run.
//
// This module is framework-agnostic (NO Phaser imports) so it stays unit- and
// property-testable and portable (see .kiro/steering/tech.md / structure.md).
// Scenes (GameScene) mutate it and the HUD (UIScene) reads from it, either via
// getters or by subscribing to the change events it emits.
//
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
// Properties:
//   Property 1 — lives start at 6.
//   Property 2 — lives stay within 0..LIVES_MAX (lose = -1 while >0, gain = +1 capped).
//   Property 3 — game over iff lives === 0.

import { LIVES_START, LIVES_MAX } from '../config.js';

/**
 * Names of the events emitted on state change. Consumers can subscribe with
 * `on(event, listener)`. A generic `change` event fires on any mutation so the
 * HUD can do a single re-read.
 */
export const SCORE_EVENTS = {
  SCORE: 'score',
  LIVES: 'lives',
  LEVEL: 'level',
  GAME_OVER: 'gameover',
  CHANGE: 'change',
};

/**
 * A tiny synchronous event emitter. Kept internal so ScoreSystem has no
 * external dependency and remains framework-agnostic.
 */
class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} listener
   * @returns {() => void} an unsubscribe function.
   */
  on(event, listener) {
    if (typeof listener !== 'function') return () => {};
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Unsubscribe a previously registered listener.
   * @param {string} event
   * @param {Function} listener
   */
  off(event, listener) {
    const set = this._listeners.get(event);
    if (set) set.delete(listener);
  }

  /**
   * Emit an event to all subscribers. Listener errors are isolated so one bad
   * subscriber cannot break game state updates.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch (err) {
        // Swallow listener errors: state integrity must not depend on the HUD.
        // eslint-disable-next-line no-console
        console.error('ScoreSystem listener error:', err);
      }
    }
  }

  /** Remove every listener (used when tearing a run down). */
  removeAll() {
    this._listeners.clear();
  }
}

export default class ScoreSystem extends Emitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.lives] starting lives (defaults to LIVES_START = 6).
   * @param {number} [opts.score] starting score (defaults to 0).
   * @param {number} [opts.level] starting level (defaults to 1).
   */
  constructor(opts = {}) {
    super();
    // Remember the initial level so restart() can return to it.
    this._initialLevel = Number.isFinite(opts.level) ? opts.level : 1;

    // Req 2.1 / Property 1: a new run starts with 6 lives.
    this._lives = clampLives(Number.isFinite(opts.lives) ? opts.lives : LIVES_START);
    this._score = Number.isFinite(opts.score) ? opts.score : 0;
    this._level = this._initialLevel;
  }

  // --- Getters (HUD reads these) ---------------------------------------------

  /** @returns {number} current score. */
  get score() {
    return this._score;
  }

  /** @returns {number} current lives (always within 0..LIVES_MAX). */
  get lives() {
    return this._lives;
  }

  /** @returns {number} current level. */
  get level() {
    return this._level;
  }

  // --- Mutations -------------------------------------------------------------

  /**
   * Add points to the score (Req 1.4 scoring hook; used by pellet/fruit logic).
   * Non-finite or negative deltas are ignored so the score never decreases.
   * @param {number} points
   * @returns {number} the new score.
   */
  addScore(points) {
    if (!Number.isFinite(points) || points <= 0) return this._score;
    this._score += points;
    this.emit(SCORE_EVENTS.SCORE, this._score);
    this.emit(SCORE_EVENTS.CHANGE, this.snapshot());
    return this._score;
  }

  /**
   * Lose one life (Req 2.2). Decrements by exactly one while lives remain; never
   * drops below 0 (Property 2). Emits a game-over event when lives reach 0
   * (Req 2.3).
   * @returns {number} the new life count.
   */
  loseLife() {
    if (this._lives <= 0) return this._lives;
    this._lives -= 1;
    this.emit(SCORE_EVENTS.LIVES, this._lives);
    this.emit(SCORE_EVENTS.CHANGE, this.snapshot());
    if (this._lives === 0) {
      this.emit(SCORE_EVENTS.GAME_OVER, this.snapshot());
    }
    return this._lives;
  }

  /**
   * Gain one life (Req 2.4). Increments by exactly one but never exceeds
   * LIVES_MAX = 10 (Req 2.5, 2.6 / Property 2).
   * @returns {number} the new life count.
   */
  gainLife() {
    if (this._lives >= LIVES_MAX) return this._lives;
    this._lives += 1;
    this.emit(SCORE_EVENTS.LIVES, this._lives);
    this.emit(SCORE_EVENTS.CHANGE, this.snapshot());
    return this._lives;
  }

  /**
   * Whether the run is over (Req 2.3 / Property 3): true iff lives === 0.
   * @returns {boolean}
   */
  isGameOver() {
    return this._lives === 0;
  }

  /**
   * Advance to the next level. Increments the level counter; callers rebuild the
   * maze via Maze.reset(level).
   * @returns {number} the new level.
   */
  nextLevel() {
    this._level += 1;
    this.emit(SCORE_EVENTS.LEVEL, this._level);
    this.emit(SCORE_EVENTS.CHANGE, this.snapshot());
    return this._level;
  }

  /**
   * Reset the run for a fresh game (Property 4): score 0, lives 6, level back to
   * its initial value. Difficulty/grade lives outside this system and is
   * preserved by the caller.
   */
  restart() {
    this._score = 0;
    this._lives = LIVES_START;
    this._level = this._initialLevel;
    this.emit(SCORE_EVENTS.SCORE, this._score);
    this.emit(SCORE_EVENTS.LIVES, this._lives);
    this.emit(SCORE_EVENTS.LEVEL, this._level);
    this.emit(SCORE_EVENTS.CHANGE, this.snapshot());
  }

  /**
   * A plain-data view of the current state, handy for HUD reads and event
   * payloads.
   * @returns {{ score: number, lives: number, level: number, gameOver: boolean }}
   */
  snapshot() {
    return {
      score: this._score,
      lives: this._lives,
      level: this._level,
      gameOver: this.isGameOver(),
    };
  }
}

/**
 * Clamp an incoming life value into the valid 0..LIVES_MAX range so a bad
 * constructor argument can never place the system outside its invariant.
 * @param {number} lives
 * @returns {number}
 */
function clampLives(lives) {
  if (!Number.isFinite(lives)) return LIVES_START;
  return Math.max(0, Math.min(LIVES_MAX, Math.trunc(lives)));
}
