// LessonBank — tagged math/science micro-lessons shown when a fruit is
// collected (Req 5.3, 5.5).
//
// This module is framework-agnostic (NO Phaser imports) so it stays unit- and
// property-testable and portable (see .kiro/steering/tech.md / structure.md).
// `LessonScene` (Phaser) reads a selected lesson from here and renders it in an
// accessible DOM panel via `LessonModal`.
//
// Requirements: 5.3, 5.5
// Properties:
//   Property 14 — lessons vary between showings: for any sequence of fruit
//     collections where at least two lessons exist, consecutive lessons differ
//     whenever an unused lesson is available.
//
// The pure selector (`selectLesson`) and the `LESSONS` data are exported so the
// mandatory property test (Task 18) can exercise Property 14 without a runtime.

/**
 * A micro-lesson record.
 * @typedef {object} Lesson
 * @property {string} id      stable id (used for no-repeat tracking)
 * @property {'math'|'science'} subject
 * @property {string} topic   short tag, e.g. 'fractions', 'space'
 * @property {string} title   short headline shown in the panel
 * @property {string} text    one- or two-sentence "did you know" body
 */

/**
 * The built-in set of tagged math/science micro-lessons (Req 5.3). Frozen so
 * callers cannot mutate the shared bank; selection is done over copies.
 * @type {ReadonlyArray<Lesson>}
 */
export const LESSONS = Object.freeze([
  // --- Math -----------------------------------------------------------------
  {
    id: 'LSN-MATH-001',
    subject: 'math',
    topic: 'zero',
    title: 'Zero is a hero',
    text: 'Zero was one of the last digits to be invented. It lets us tell 5 apart from 50 and 500 using place value.',
  },
  {
    id: 'LSN-MATH-002',
    subject: 'math',
    topic: 'primes',
    title: 'Primes never end',
    text: 'A prime number has exactly two factors: 1 and itself. There are infinitely many primes — the list never stops.',
  },
  {
    id: 'LSN-MATH-003',
    subject: 'math',
    topic: 'fractions',
    title: 'Fractions are division',
    text: 'The fraction 3/4 literally means 3 divided by 4. That is why it also equals the decimal 0.75.',
  },
  {
    id: 'LSN-MATH-004',
    subject: 'math',
    topic: 'geometry',
    title: 'A circle full of pi',
    text: 'Pi (about 3.14159) is how many times a circle\u2019s diameter wraps around its edge. It is the same for every circle.',
  },
  {
    id: 'LSN-MATH-005',
    subject: 'math',
    topic: 'percentages',
    title: 'Percent means "per hundred"',
    text: '50% is just 50 out of 100, which is the same as the fraction 1/2. Percentages make parts easy to compare.',
  },
  {
    id: 'LSN-MATH-006',
    subject: 'math',
    topic: 'symmetry',
    title: 'Even and odd',
    text: 'Any whole number that ends in 0, 2, 4, 6, or 8 is even. Add two odd numbers and you always get an even one.',
  },
  // --- Science --------------------------------------------------------------
  {
    id: 'LSN-SCI-001',
    subject: 'science',
    topic: 'space',
    title: 'Light takes time',
    text: 'Sunlight takes about 8 minutes to reach Earth, so you always see the Sun as it looked 8 minutes ago.',
  },
  {
    id: 'LSN-SCI-002',
    subject: 'science',
    topic: 'matter',
    title: 'Three states of water',
    text: 'Water is one of the few substances you meet as a solid (ice), liquid (water), and gas (steam) in everyday life.',
  },
  {
    id: 'LSN-SCI-003',
    subject: 'science',
    topic: 'cells',
    title: 'You are mostly cells',
    text: 'Your body is built from trillions of tiny cells. Most are so small that thousands would fit on the head of a pin.',
  },
  {
    id: 'LSN-SCI-004',
    subject: 'science',
    topic: 'forces',
    title: 'Gravity pulls everything',
    text: 'Gravity pulls any two masses toward each other. It is what keeps the Moon orbiting Earth and your feet on the ground.',
  },
  {
    id: 'LSN-SCI-005',
    subject: 'science',
    topic: 'energy',
    title: 'Energy changes form',
    text: 'Energy is never created or destroyed, only changed. A battery turns stored chemical energy into electrical energy.',
  },
  {
    id: 'LSN-SCI-006',
    subject: 'science',
    topic: 'ecosystems',
    title: 'Plants eat sunlight',
    text: 'Through photosynthesis, plants turn sunlight, water, and carbon dioxide into food and release the oxygen we breathe.',
  },
]);

/**
 * Pick the id used as the "immediate previous" from a recent-ids list. The
 * history is stored most-recent-first, so index 0 is the last shown lesson.
 * @param {string[]} recentIds
 * @returns {string|undefined}
 */
function previousId(recentIds) {
  return Array.isArray(recentIds) && recentIds.length ? recentIds[0] : undefined;
}

/**
 * Choose the next lesson to show (pure — Property 14).
 *
 * Selection rules, in order:
 *   1. No lessons  → return null.
 *   2. One lesson  → return it (nothing to vary).
 *   3. Prefer lessons whose id is NOT in `recentIds` (unused this cycle).
 *   4. If every lesson is "recent", fall back to any lesson EXCEPT the
 *      immediately previous one, so two showings in a row are never identical
 *      while an alternative exists.
 *
 * This guarantees the Property 14 invariant: when at least two lessons exist,
 * consecutive lessons differ whenever an unused lesson is available.
 *
 * @param {ReadonlyArray<Lesson>} lessons the pool to choose from
 * @param {string[]} [recentIds] recently shown ids, most-recent-first
 * @param {() => number} [rng] random source in [0,1) (injectable for tests)
 * @returns {Lesson|null} the chosen lesson (a reference into `lessons`)
 */
export function selectLesson(lessons, recentIds = [], rng = Math.random) {
  if (!Array.isArray(lessons) || lessons.length === 0) return null;
  if (lessons.length === 1) return lessons[0];

  const recent = new Set(Array.isArray(recentIds) ? recentIds : []);
  const prevId = previousId(recentIds);

  // Prefer lessons that have not been shown recently.
  let candidates = lessons.filter((l) => !recent.has(l.id));

  // All lessons are "recent": relax to everything except the immediate
  // previous, so consecutive lessons still differ (Property 14).
  if (candidates.length === 0) {
    candidates = lessons.filter((l) => l.id !== prevId);
  }

  // Degenerate safety net (should not happen when length >= 2).
  if (candidates.length === 0) candidates = lessons.slice();

  const r = typeof rng === 'function' ? rng() : Math.random();
  const idx = Math.min(candidates.length - 1, Math.floor(r * candidates.length));
  return candidates[idx];
}

/**
 * Stateful wrapper around {@link selectLesson} that remembers recently shown
 * lessons across fruit collections in a run, so repeats are avoided when
 * possible (Req 5.5). Holds no rendering state and imports no Phaser, so it can
 * be shared by `GameScene`/`LessonScene` and tested directly.
 */
export default class LessonBank {
  /**
   * @param {object} [opts]
   * @param {ReadonlyArray<Lesson>} [opts.lessons] lesson pool (defaults to LESSONS)
   * @param {number} [opts.historySize] how many recent ids to remember; defaults
   *        to one less than the pool size so the bank cycles through all lessons
   *        before repeating any.
   */
  constructor({ lessons = LESSONS, historySize } = {}) {
    /** @type {Lesson[]} */
    this.lessons = Array.isArray(lessons) ? lessons.slice() : [];
    const defaultHistory = Math.max(1, this.lessons.length - 1);
    this.historySize = Number.isFinite(historySize)
      ? Math.max(1, Math.min(historySize, defaultHistory))
      : defaultHistory;
    /** @type {string[]} recently shown ids, most-recent-first. */
    this._recent = [];
  }

  /** Number of lessons in the bank. */
  get size() {
    return this.lessons.length;
  }

  /** A snapshot of the recent-id history (most-recent-first). */
  get recentIds() {
    return this._recent.slice();
  }

  /** All lessons (defensive copy). */
  all() {
    return this.lessons.slice();
  }

  /**
   * Select the next lesson to show and record it in the recent history so the
   * following call avoids it where possible (Req 5.5 / Property 14).
   * @param {() => number} [rng] random source (injectable for tests)
   * @returns {Lesson|null}
   */
  next(rng = Math.random) {
    const lesson = selectLesson(this.lessons, this._recent, rng);
    if (lesson) {
      this._recent.unshift(lesson.id);
      if (this._recent.length > this.historySize) {
        this._recent.length = this.historySize;
      }
    }
    return lesson;
  }

  /** Forget the recent history (e.g. on a fresh run). */
  reset() {
    this._recent = [];
    return this;
  }
}
