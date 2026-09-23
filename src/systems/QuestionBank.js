// QuestionBank — loads, validates, and serves the bundled grade-tagged
// question bank (`public/assets/questions/math_man_question_bank_120.json`).
//
// This module is framework-agnostic (NO Phaser imports) so it stays unit- and
// property-testable and portable (see .kiro/steering/tech.md / structure.md).
// `QuestionBank.load()` is called from BootScene; `QuizScene` pulls questions
// via `next(grade, { subject, difficulty }, recentIds)`.
//
// Requirements: 4.2, 4.3, 4.8, 4.9
// Properties:
//   Property 9  — selected question matches the grade and any supplied filters.
//   Property 10 — retained questions are well-formed (invalid records dropped).
//   Property 12 — no immediate question repeat; avoid recent ids where possible.
//   Property 13 — a missing/malformed bank still yields a usable fallback set.

import { QUESTION_BANK_PATH, GRADES } from '../config.js';

/**
 * Required fields that must each be a non-empty string on a valid record. `grade`
 * and `choices` are validated separately (numeric / array). `answer` must also be
 * one of `choices`.
 */
const REQUIRED_STRING_FIELDS = [
  'id',
  'subject',
  'topic',
  'difficulty',
  'question',
  'answer',
  'explanation',
];

/**
 * Small built-in fallback set used only when the bundled bank fails to load or
 * validate, so the quiz still functions (Req 4.9, Property 13). Covers every
 * grade (5/6/7) across both subjects (math/science). Deeply frozen so it can
 * never be mutated by selection logic.
 */
export const FALLBACK_QUESTIONS = deepFreeze([
  {
    id: 'FB-G5-MATH-001', grade: 5, subject: 'math', topic: 'arithmetic', difficulty: 'easy',
    question: 'What is 12 + 15?', choices: ['25', '27', '29', '30'], answer: '27',
    explanation: '12 + 15 = 27.',
  },
  {
    id: 'FB-G5-SCI-001', grade: 5, subject: 'science', topic: 'matter', difficulty: 'easy',
    question: 'Which is a state of matter?', choices: ['Energy', 'Solid', 'Speed', 'Light'],
    answer: 'Solid', explanation: 'Solid, liquid, and gas are common states of matter.',
  },
  {
    id: 'FB-G6-MATH-001', grade: 6, subject: 'math', topic: 'fractions', difficulty: 'easy',
    question: 'What is 1/2 of 18?', choices: ['6', '8', '9', '12'], answer: '9',
    explanation: 'Half of 18 is 9.',
  },
  {
    id: 'FB-G6-SCI-001', grade: 6, subject: 'science', topic: 'cells', difficulty: 'easy',
    question: 'What is the basic unit of life?', choices: ['Atom', 'Cell', 'Organ', 'Molecule'],
    answer: 'Cell', explanation: 'The cell is the smallest unit of life.',
  },
  {
    id: 'FB-G7-MATH-001', grade: 7, subject: 'math', topic: 'integers', difficulty: 'easy',
    question: 'What is -3 + 5?', choices: ['-8', '-2', '2', '8'], answer: '2',
    explanation: 'Adding 5 to -3 gives 2.',
  },
  {
    id: 'FB-G7-SCI-001', grade: 7, subject: 'science', topic: 'forces', difficulty: 'easy',
    question: 'Water freezes at what temperature in Celsius?', choices: ['-10', '0', '32', '100'],
    answer: '0', explanation: 'Water freezes at 0 degrees Celsius.',
  },
]);

/**
 * Validate a single question record (Req 4.2, Property 10). A record is valid
 * when every required field is a non-empty string, `grade` is one of the
 * supported grades, `choices` is a non-empty array of non-empty strings, and
 * `answer` is one of those choices.
 * @param {*} rec
 * @returns {boolean}
 */
export function isValidRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof rec[field] !== 'string' || rec[field].trim() === '') return false;
  }
  if (!GRADES.includes(rec.grade)) return false;
  if (!Array.isArray(rec.choices) || rec.choices.length === 0) return false;
  if (!rec.choices.every((c) => typeof c === 'string' && c.length > 0)) return false;
  return rec.choices.includes(rec.answer);
}

/**
 * Filter an arbitrary array down to the records that pass {@link isValidRecord}.
 * Non-array input yields an empty array.
 * @param {*} records
 * @returns {object[]}
 */
export function validateRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter(isValidRecord);
}

/**
 * Index validated records by grade for fast selection. Every supported grade is
 * seeded with an empty array so lookups are always defined.
 * @param {object[]} records
 * @returns {Map<number, object[]>}
 */
export function indexByGrade(records) {
  const map = new Map();
  for (const g of GRADES) map.set(g, []);
  if (!Array.isArray(records)) return map;
  for (const rec of records) {
    if (!map.has(rec.grade)) map.set(rec.grade, []);
    map.get(rec.grade).push(rec);
  }
  return map;
}

/**
 * Pure selection over a grade-specific pool (Req 4.3, 4.8; Properties 9, 12).
 * Applies subject/difficulty filters STRICTLY (a supplied filter is never
 * ignored — that would violate Property 9), then avoids the immediately
 * previous id and any `recentIds` whenever an alternative exists.
 *
 * @param {object[]} pool records already matched to the target grade.
 * @param {{subject?: string, difficulty?: string}} [filters]
 * @param {string[]} [recentIds] ids to avoid where possible.
 * @param {() => number} [rng] source of randomness in [0, 1).
 * @param {string|null} [lastId] id served immediately before (never repeated).
 * @returns {object|null} the chosen record, or null when none match.
 */
export function selectNext(pool, filters = {}, recentIds = [], rng = Math.random, lastId = null) {
  if (!Array.isArray(pool) || pool.length === 0) return null;

  let candidates = pool;
  if (filters && filters.subject) {
    candidates = candidates.filter((q) => q.subject === filters.subject);
  }
  if (filters && filters.difficulty) {
    candidates = candidates.filter((q) => q.difficulty === filters.difficulty);
  }
  if (candidates.length === 0) return null;

  // Avoid recent ids (and the immediately previous id) where possible.
  const avoid = new Set(Array.isArray(recentIds) ? recentIds : []);
  if (lastId != null) avoid.add(lastId);

  let eligible = candidates.filter((q) => !avoid.has(q.id));
  if (eligible.length === 0) {
    // Everything is recent; at minimum avoid the immediately previous id.
    eligible = candidates.filter((q) => q.id !== lastId);
  }
  if (eligible.length === 0) eligible = candidates;

  const roll = typeof rng === 'function' ? rng() : Math.random();
  const idx = Math.floor((Number.isFinite(roll) ? roll : 0) * eligible.length);
  return eligible[Math.min(Math.max(idx, 0), eligible.length - 1)];
}

export default class QuestionBank {
  constructor() {
    /** @type {object[]} validated records currently in play. */
    this.questions = [];
    /** @type {Map<number, object[]>} records indexed by grade. */
    this.byGrade = new Map();
    /** @type {boolean} whether the built-in fallback set is in use. */
    this.usingFallback = false;
    /** @type {string|null} id of the most recently served question. */
    this._lastId = null;
  }

  /** @returns {number} number of validated questions currently available. */
  get size() {
    return this.questions.length;
  }

  /**
   * Fetch and validate the bundled question bank (Req 4.2). Invalid records are
   * dropped (Property 10); if the file is missing, unreadable, or contains no
   * valid records, the built-in fallback set is used (Req 4.9, Property 13).
   *
   * @param {{path?: string, fetchImpl?: typeof fetch}} [opts]
   *   `path` overrides the bank URL; `fetchImpl` injects a fetch implementation
   *   (used by tests / non-browser environments).
   * @returns {Promise<boolean>} true when the JSON bank loaded, false on fallback.
   */
  async load({ path = QUESTION_BANK_PATH, fetchImpl } = {}) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    try {
      if (!doFetch) throw new Error('no fetch implementation available');
      const res = await doFetch(path);
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'error'}`);
      const data = await res.json();
      const records = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.questions) ? data.questions : []);
      const valid = validateRecords(records);
      if (valid.length === 0) throw new Error('no valid records in bank');
      this._ingest(valid, false);
      return true;
    } catch {
      this._ingest(validateRecords(FALLBACK_QUESTIONS), true);
      return false;
    }
  }

  /**
   * Return a question matched to `grade`, optionally filtered by subject and/or
   * difficulty, avoiding an immediate repeat and (where possible) any id in
   * `recentIds` (Req 4.3, 4.8; Properties 9, 12).
   *
   * @param {number} grade selected grade (5/6/7).
   * @param {{subject?: string, difficulty?: string}} [filters]
   * @param {string[]} [recentIds]
   * @param {() => number} [rng] source of randomness (injectable for tests).
   * @returns {object|null} a question record, or null if none match.
   */
  next(grade, filters = {}, recentIds = [], rng = Math.random) {
    const pool = this.byGrade.get(grade) || [];
    const record = selectNext(pool, filters, recentIds, rng, this._lastId);
    if (record) this._lastId = record.id;
    return record;
  }

  /**
   * @private Replace the active set with the given validated records and
   * re-index by grade. Resets the no-repeat cursor.
   */
  _ingest(validRecords, usingFallback) {
    this.questions = validRecords;
    this.byGrade = indexByGrade(validRecords);
    this.usingFallback = usingFallback;
    this._lastId = null;
  }
}

/** Named export kept alongside the default for import-style flexibility. */
export { QuestionBank };

/**
 * Recursively freeze an array of plain records so the fallback set is immutable.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }
  return value;
}
