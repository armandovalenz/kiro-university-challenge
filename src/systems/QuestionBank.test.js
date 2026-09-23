// Property-based tests for QuestionBank (mandatory PBT — see
// .kiro/steering/testing.md).
//
// Owns Property 9 (selected question matches grade + filters), Property 10
// (loaded questions are well-formed / invalid records dropped), Property 12 (no
// immediate question repeat, avoids recent ids), and Property 13 (a missing or
// malformed bank still yields a usable fallback set). Tests use Vitest +
// fast-check and are named after the Core Property they validate, carrying the
// requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import QuestionBank, {
  isValidRecord,
  validateRecords,
  selectNext,
  FALLBACK_QUESTIONS,
} from './QuestionBank.js';
import { GRADES } from '../config.js';

const gradeArb = fc.constantFrom(...GRADES);
const subjectArb = fc.constantFrom('math', 'science');
const difficultyArb = fc.constantFrom('easy', 'medium', 'hard');

/** Build a valid question record with the given, deterministic id. */
function makeRecord({ id, grade, subject, difficulty }) {
  const answer = `ans-${id}`;
  return {
    id,
    grade,
    subject,
    topic: 'topic',
    difficulty,
    question: `Q ${id}?`,
    choices: [answer, 'other-1', 'other-2'],
    answer,
    explanation: `Because ${id}.`,
  };
}

/** An arbitrary that generates a non-empty pool of valid, uniquely-id'd records. */
function validPoolArb() {
  return fc
    .array(fc.record({ grade: gradeArb, subject: subjectArb, difficulty: difficultyArb }), {
      minLength: 1,
      maxLength: 30,
    })
    .map((specs) => specs.map((s, i) => makeRecord({ id: `Q-${i}`, ...s })));
}

/** Deterministic RNG picking a fixed fraction of the range (injectable). */
const rngArb = fc.double({ min: 0, max: 0.999, noNaN: true }).map((r) => () => r);

describe('QuestionBank — Property 9: Selected question matches the grade and filters', () => {
  // **Validates: Requirements 4.1, 4.3, 10.3**
  it('next(grade, filters) returns a record matching the grade and any supplied filters', () => {
    fc.assert(
      fc.property(validPoolArb(), gradeArb, fc.option(subjectArb), fc.option(difficultyArb), rngArb, (pool, grade, subject, difficulty, rng) => {
        const bank = new QuestionBank();
        // Ingest a known-valid pool directly (bypassing fetch).
        bank._ingest(validateRecords(pool), false);

        const filters = {};
        if (subject != null) filters.subject = subject;
        if (difficulty != null) filters.difficulty = difficulty;

        const q = bank.next(grade, filters, [], rng);

        // Determine whether the grade pool actually has a match for the filters.
        const eligible = (bank.byGrade.get(grade) || []).filter(
          (r) =>
            (subject == null || r.subject === subject) &&
            (difficulty == null || r.difficulty === difficulty),
        );

        if (eligible.length === 0) {
          expect(q).toBeNull();
        } else {
          expect(q).not.toBeNull();
          expect(q.grade).toBe(grade);
          if (subject != null) expect(q.subject).toBe(subject);
          if (difficulty != null) expect(q.difficulty).toBe(difficulty);
        }
      }),
    );
  });
});

describe('QuestionBank — Property 10: Loaded questions are well-formed', () => {
  // **Validates: Requirements 4.2**
  // For any question retained after loading, all required fields are present and
  // the answer value is one of its choices (invalid records dropped).
  it('validateRecords keeps only well-formed records and drops the rest', () => {
    // Mix valid records with a variety of malformed ones.
    const invalidArb = fc.constantFrom(
      null,
      undefined,
      42,
      {},
      { id: '', grade: 5, subject: 'math', topic: 't', difficulty: 'easy', question: 'q', choices: ['a'], answer: 'a', explanation: 'e' }, // empty id
      { id: 'x', grade: 4, subject: 'math', topic: 't', difficulty: 'easy', question: 'q', choices: ['a'], answer: 'a', explanation: 'e' }, // bad grade
      { id: 'x', grade: 5, subject: 'math', topic: 't', difficulty: 'easy', question: 'q', choices: [], answer: 'a', explanation: 'e' }, // empty choices
      { id: 'x', grade: 5, subject: 'math', topic: 't', difficulty: 'easy', question: 'q', choices: ['a', 'b'], answer: 'z', explanation: 'e' }, // answer not in choices
    );

    fc.assert(
      fc.property(
        fc.array(fc.record({ grade: gradeArb, subject: subjectArb, difficulty: difficultyArb }), { maxLength: 15 }),
        fc.array(invalidArb, { maxLength: 15 }),
        (validSpecs, invalids) => {
          const valids = validSpecs.map((s, i) => makeRecord({ id: `V-${i}`, ...s }));
          const kept = validateRecords([...valids, ...invalids]);

          // Every kept record passes the validity contract.
          for (const rec of kept) {
            expect(isValidRecord(rec)).toBe(true);
            expect(rec.choices).toContain(rec.answer);
            expect(GRADES).toContain(rec.grade);
          }
          // Exactly the valid records survive; no invalid record does.
          expect(kept.length).toBe(valids.length);
        },
      ),
    );
  });
});

describe('QuestionBank — Property 12: No immediate question repeat', () => {
  // **Validates: Requirements 4.8**
  // For any selection sequence from a grade with >= 2 eligible questions, the
  // next question is never the same id twice in a row and avoids recent ids
  // whenever an alternative exists.
  it('consecutive selections never repeat an id when at least two exist', () => {
    fc.assert(
      fc.property(
        gradeArb,
        fc.integer({ min: 2, max: 12 }),
        fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 2, maxLength: 40 }),
        (grade, count, rolls) => {
          // A pool of `count` distinct questions all in the target grade.
          const pool = Array.from({ length: count }, (_, i) =>
            makeRecord({ id: `G${grade}-${i}`, grade, subject: 'math', difficulty: 'easy' }),
          );
          const bank = new QuestionBank();
          bank._ingest(pool, false);

          let idx = 0;
          const rng = () => rolls[idx++ % rolls.length];

          let prevId = null;
          for (let i = 0; i < rolls.length; i += 1) {
            const q = bank.next(grade, {}, [], rng);
            expect(q).not.toBeNull();
            if (prevId != null) {
              // Never the same id twice in a row (an alternative always exists).
              expect(q.id).not.toBe(prevId);
            }
            prevId = q.id;
          }
        },
      ),
    );
  });

  it('selectNext avoids recentIds when an unused candidate is available', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 10 }), rngArb, (count, rng) => {
        const pool = Array.from({ length: count }, (_, i) =>
          makeRecord({ id: `R-${i}`, grade: 5, subject: 'math', difficulty: 'easy' }),
        );
        // Mark all but one as recently used; the chosen one must be the unused id.
        const recent = pool.slice(0, count - 1).map((r) => r.id);
        const chosen = selectNext(pool, {}, recent, rng, null);
        expect(chosen.id).toBe(pool[count - 1].id);
      }),
    );
  });
});

describe('QuestionBank — Property 13: The question bank always yields a usable set', () => {
  // **Validates: Requirements 4.9**
  // For any load where the JSON is missing or malformed, the active set is
  // non-empty because the built-in fallback set is used.
  it('load falls back to a non-empty, well-formed set when fetch fails or returns junk', async () => {
    const brokenFetchers = [
      // Rejecting fetch (network error).
      () => Promise.reject(new Error('offline')),
      // Non-ok HTTP response.
      () => Promise.resolve({ ok: false, status: 500, json: async () => [] }),
      // Ok but malformed JSON body (not an array / no questions).
      () => Promise.resolve({ ok: true, status: 200, json: async () => ({ nope: true }) }),
      // Ok but every record invalid.
      () => Promise.resolve({ ok: true, status: 200, json: async () => [{ id: '' }, 7, null] }),
    ];

    for (const fetchImpl of brokenFetchers) {
      const bank = new QuestionBank();
      const loadedFromJson = await bank.load({ fetchImpl });
      expect(loadedFromJson).toBe(false);
      expect(bank.usingFallback).toBe(true);
      expect(bank.size).toBeGreaterThan(0);
      // Every fallback grade must be able to serve a question.
      for (const grade of GRADES) {
        expect(bank.next(grade)).not.toBeNull();
      }
    }

    // The exported fallback set is itself well-formed.
    expect(validateRecords(FALLBACK_QUESTIONS).length).toBe(FALLBACK_QUESTIONS.length);
  });
});
