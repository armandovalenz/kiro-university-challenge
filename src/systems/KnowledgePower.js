// KnowledgePower — the "Knowledge Power" charge meter for FP3D_Mode.
//
// This module is framework-agnostic (NO Phaser, NO Three.js imports) — like
// ScoreSystem / QuestionBank it owns ONLY plain integer state + rules, so it
// stays unit- and property-testable and portable (see .kiro/steering/tech.md).
//
// The meter is an INTEGER charge level in [0, max]:
//   - starts FULL (at max) on a new game/level,
//   - a THROW costs `throwCost` charge (default 1) and cannot fire at 0,
//   - eating a fruit REFILLS it to max (a full top-up, not +1),
//   - reset() returns it to max for a fresh level.
//
// Feature: Knowledge Power — book projectile charge meter.
// Properties:
//   KP-1 — the level is always an integer in [0, max].
//   KP-2 — a throw at < cost does not go negative and reports it did not fire.
//   KP-3 — a successful throw subtracts exactly `cost`.
//   KP-4 — refillToMax()/reset() always yield exactly max; the start level is max.

import { KNOWLEDGE } from '../config.js';

/** Default maximum charge (ten "books"). Exported for the HUD book bar. */
export const KNOWLEDGE_MAX = KNOWLEDGE.max;

/** Default cost of a single throw. */
export const KNOWLEDGE_THROW_COST = KNOWLEDGE.throwCost;

/**
 * Coerce a value to a non-negative integer, defaulting when non-finite.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  return n > 0 ? n : fallback;
}

export default class KnowledgePower {
  /**
   * @param {object} [opts]
   * @param {number} [opts.max] maximum charge (defaults to KNOWLEDGE.max = 10).
   * @param {number} [opts.throwCost] charge spent per throw (defaults to 1).
   * @param {number} [opts.level] starting level (defaults to max — full).
   */
  constructor(opts = {}) {
    // Max is a positive integer; a bad value falls back to the config default.
    this._max = toPositiveInt(opts.max, KNOWLEDGE_MAX);
    // Cost is a positive integer; a bad value falls back to the config default.
    this._cost = toPositiveInt(opts.throwCost, KNOWLEDGE_THROW_COST);
    // Start FULL unless an explicit (clamped) starting level is given (KP-4).
    const start = Number.isFinite(opts.level) ? opts.level : this._max;
    this._level = this._clamp(start);
  }

  /**
   * Clamp a candidate level into the integer range [0, max] (KP-1).
   * @param {number} value
   * @returns {number}
   */
  _clamp(value) {
    if (!Number.isFinite(value)) return 0;
    const n = Math.trunc(value);
    return Math.max(0, Math.min(this._max, n));
  }

  /** @returns {number} current charge level (always an integer in [0, max]). */
  get level() {
    return this._level;
  }

  /** @returns {number} the maximum charge. */
  get max() {
    return this._max;
  }

  /** @returns {number} the per-throw cost. */
  get cost() {
    return this._cost;
  }

  /**
   * Whether a throw is possible right now: the level covers the cost (KP-2).
   * @param {number} [cost] override cost to test (defaults to the throw cost).
   * @returns {boolean}
   */
  canThrow(cost = this._cost) {
    const c = toPositiveInt(cost, this._cost);
    return this._level >= c;
  }

  /**
   * Spend `cost` charge if available (KP-3). On success the level drops by
   * EXACTLY `cost` (clamped at 0, so it can never go negative — KP-2) and this
   * returns true; when the level is below the cost nothing changes and it
   * returns false.
   * @param {number} [cost] charge to spend (defaults to the throw cost).
   * @returns {boolean} whether the charge was spent (the throw "fired").
   */
  spend(cost = this._cost) {
    const c = toPositiveInt(cost, this._cost);
    if (this._level < c) return false;
    this._level = this._clamp(this._level - c);
    return true;
  }

  /**
   * Attempt to throw: spend one `cost` of charge. Alias of {@link spend} with
   * the default cost, named for the gameplay action.
   * @returns {boolean} whether the book was thrown (charge was spent).
   */
  throw() {
    return this.spend(this._cost);
  }

  /**
   * Refill the meter to its maximum (KP-4) — a FULL top-up, as eating a fruit
   * does. Never exceeds max.
   * @returns {number} the new level (always `max`).
   */
  refillToMax() {
    this._level = this._max;
    return this._level;
  }

  /**
   * Reset the meter back to full for a fresh level/run (KP-4).
   * @returns {number} the new level (always `max`).
   */
  reset() {
    this._level = this._max;
    return this._level;
  }

  /**
   * Fraction of the meter currently filled, in [0, 1] — handy for a bar UI.
   * @returns {number}
   */
  fraction() {
    return this._max > 0 ? this._level / this._max : 0;
  }
}
