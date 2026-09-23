// Property-based tests for Storage (mandatory PBT — see .kiro/steering/testing.md).
//
// This file owns Property 15 (high score is a persisted, monotonic maximum),
// which Task 16 (Pause/GameOver) references: GameOverScene persists the final
// score through Storage.updateHighScore, which writes only when the score beats
// the stored high score, so the stored value is a monotonic maximum readable on
// the next load.
//
// Tests use Vitest + fast-check and are named after the Core Property they
// validate, carrying the requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Storage from './Storage.js';
import { STORAGE_KEY } from '../config.js';

/**
 * A minimal in-memory Web-Storage-like backend so the property test exercises
 * real persistence (write → new instance → read) without a browser. Sharing one
 * backend between two Storage instances simulates "readable on the next load".
 */
function makeMemoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** A non-negative finite score a run could finish with. */
const finishScore = fc.integer({ min: 0, max: 1_000_000 });

describe('Storage — Property 15: High score is a persisted, monotonic maximum', () => {
  // **Validates: Requirements 6.2, 6.3, 6.4**
  // For any stored high score and finishing score, after the game ends the
  // stored high score equals the maximum of the two, never decreases, and is
  // readable on the next load.
  it('updateHighScore yields max(stored, score), never decreases, persists across loads', () => {
    fc.assert(
      fc.property(fc.array(finishScore, { minLength: 1, maxLength: 30 }), (scores) => {
        const backend = makeMemoryBackend();
        const storage = new Storage(backend);

        let expectedMax = 0; // fresh install starts at 0
        let previous = storage.get().highScore;
        expect(previous).toBe(0);

        for (const score of scores) {
          const returned = storage.updateHighScore(score);
          expectedMax = Math.max(expectedMax, score);

          // Equals the running maximum of stored + finishing scores (Req 6.4).
          expect(returned).toBe(expectedMax);
          // Monotonic: never decreases from the previous value (Req 6.2/6.3).
          expect(returned).toBeGreaterThanOrEqual(previous);
          previous = returned;

          // Readable on the next load via a brand-new instance over the same
          // backend — persistence, not just the in-memory cache (Req 6.2).
          const reloaded = new Storage(backend).get().highScore;
          expect(reloaded).toBe(expectedMax);
        }
      }),
    );
  });

  it('a lower finishing score never overwrites a higher stored high score', () => {
    fc.assert(
      fc.property(finishScore, finishScore, (a, b) => {
        const backend = makeMemoryBackend();
        const storage = new Storage(backend);
        const high = Math.max(a, b);
        const low = Math.min(a, b);

        storage.updateHighScore(high);
        // Submitting the lower score must leave the high score untouched.
        expect(storage.updateHighScore(low)).toBe(high);
        expect(new Storage(backend).get().highScore).toBe(high);
      }),
    );
  });

  it('ignores non-finite / invalid candidate scores without lowering the record', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom(NaN, Infinity, -Infinity, -5, 'x', null, undefined),
        (record, bad) => {
          const backend = makeMemoryBackend();
          const storage = new Storage(backend);
          storage.updateHighScore(record);
          // A bogus candidate must not change the stored maximum.
          expect(storage.updateHighScore(bad)).toBe(record);
          expect(new Storage(backend).get().highScore).toBe(record);
        },
      ),
    );
  });
});

// Guard against an accidental namespace drift — the key backs all the above.
describe('Storage — persistence key', () => {
  it('persists under the namespaced mathman.v1 key', () => {
    const backend = makeMemoryBackend();
    const storage = new Storage(backend);
    storage.updateHighScore(123);
    expect(backend.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Property 16, 17, 18, 19 — in-memory fallback, quiz stats, difficulty
// default/persist, and a single global high score.
// -----------------------------------------------------------------------------

import { GRADES, DEFAULT_GRADE } from '../config.js';

/** A backend whose methods all throw, simulating disabled/denied storage. */
function makeThrowingBackend() {
  return {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
}

describe('Storage — Property 16: Storage degrades to in-memory records', () => {
  // **Validates: Requirements 6.5**
  // For any environment where local storage is unavailable or throws, loading
  // returns defaults and subsequent saves/loads operate on in-memory records
  // without throwing.
  it('a null backend uses in-memory records that survive save/load without throwing', () => {
    fc.assert(
      fc.property(finishScore, fc.constantFrom(...GRADES), fc.boolean(), (score, grade, muted) => {
        const storage = new Storage(null);
        expect(storage.usingMemoryFallback).toBe(true);
        // Defaults on first load.
        expect(storage.load().highScore).toBe(0);

        // Saves operate on in-memory state and round-trip within the instance.
        expect(() => {
          storage.updateHighScore(score);
          storage.setDifficulty(grade);
          storage.setMuted(muted);
        }).not.toThrow();

        const state = storage.load();
        expect(state.highScore).toBe(score);
        expect(state.lastDifficulty).toBe(grade);
        expect(state.audioMuted).toBe(muted);
      }),
    );
  });

  it('a throwing backend degrades to in-memory without throwing', () => {
    fc.assert(
      fc.property(finishScore, (score) => {
        let storage;
        expect(() => {
          storage = new Storage(makeThrowingBackend());
        }).not.toThrow();
        expect(storage.usingMemoryFallback).toBe(true);
        expect(() => storage.updateHighScore(score)).not.toThrow();
        expect(storage.get().highScore).toBe(score);
      }),
    );
  });
});

describe('Storage — Property 17: Quiz stats track answers', () => {
  // **Validates: Requirements 6.6**
  // For any answered question, the answered count increases by one, and the
  // correct count increases by one only when the answer was correct.
  it('recordQuizAnswer increments answered every time and correct only when right', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 60 }), (results) => {
        const backend = makeMemoryBackend();
        const storage = new Storage(backend);

        let answered = 0;
        let correct = 0;
        for (const wasCorrect of results) {
          const stats = storage.recordQuizAnswer(wasCorrect);
          answered += 1;
          if (wasCorrect) correct += 1;
          expect(stats.answered).toBe(answered);
          expect(stats.correct).toBe(correct);
          // Correct can never exceed answered.
          expect(stats.correct).toBeLessThanOrEqual(stats.answered);
        }

        // Persisted and readable on the next load.
        const reloaded = new Storage(backend).get().quizStats;
        expect(reloaded.answered).toBe(answered);
        expect(reloaded.correct).toBe(correct);
      }),
    );
  });
});

describe('Storage — Property 18: Difficulty defaults and persists', () => {
  // **Validates: Requirements 10.2, 10.5**
  // For a first visit with no stored difficulty, the effective grade is the
  // default (5); for any selected grade, the next load returns it.
  it('defaults to DEFAULT_GRADE on a fresh install and persists a selected grade', () => {
    // Fresh install → default grade.
    const fresh = new Storage(makeMemoryBackend());
    expect(fresh.get().lastDifficulty).toBe(DEFAULT_GRADE);
    expect(DEFAULT_GRADE).toBe(5);

    fc.assert(
      fc.property(fc.constantFrom(...GRADES), (grade) => {
        const backend = makeMemoryBackend();
        const storage = new Storage(backend);
        storage.setDifficulty(grade);
        // Readable on the next load.
        expect(new Storage(backend).get().lastDifficulty).toBe(grade);
      }),
    );
  });

  it('an invalid grade never overwrites the persisted difficulty', () => {
    fc.assert(
      fc.property(fc.constantFrom(...GRADES), fc.constantFrom(0, 4, 8, 99, -1, 'x', null), (grade, bad) => {
        const backend = makeMemoryBackend();
        const storage = new Storage(backend);
        storage.setDifficulty(grade);
        storage.setDifficulty(bad);
        expect(storage.get().lastDifficulty).toBe(grade);
      }),
    );
  });
});

describe('Storage — Property 19: A single global high score', () => {
  // **Validates: Requirements 10.6**
  // For any sequence of games played across different grades, exactly one global
  // high score is maintained, equal to the max score achieved regardless of grade.
  it('one high score tracks the max across games at any grade', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ grade: fc.constantFrom(...GRADES), score: finishScore }), { minLength: 1, maxLength: 30 }),
        (games) => {
          const backend = makeMemoryBackend();
          const storage = new Storage(backend);

          let expectedMax = 0;
          for (const { grade, score } of games) {
            // Switching grade must not affect the (single, global) high score.
            storage.setDifficulty(grade);
            storage.updateHighScore(score);
            expectedMax = Math.max(expectedMax, score);
            expect(storage.get().highScore).toBe(expectedMax);
          }

          // Exactly one persisted global high score equal to the overall max.
          expect(new Storage(backend).get().highScore).toBe(expectedMax);
        },
      ),
    );
  });
});
