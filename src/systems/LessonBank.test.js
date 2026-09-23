// Property-based tests for LessonBank (mandatory PBT — see
// .kiro/steering/testing.md).
//
// Owns Property 14 (lessons vary between showings). Tests use Vitest +
// fast-check and are named after the Core Property they validate, carrying the
// requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import LessonBank, { selectLesson, LESSONS } from './LessonBank.js';

/** Build a pool of `n` distinct, minimal lesson records. */
function makeLessons(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `L-${i}`,
    subject: i % 2 === 0 ? 'math' : 'science',
    topic: `topic-${i}`,
    title: `Title ${i}`,
    text: `Body ${i}.`,
  }));
}

/** Deterministic RNG from a rolls array (cycled). */
function rngFrom(rolls) {
  let i = 0;
  return () => rolls[i++ % rolls.length];
}

describe('LessonBank — Property 14: Lessons vary between showings', () => {
  // **Validates: Requirements 5.5**
  // For any sequence of fruit collections where at least two lessons exist,
  // consecutive lessons differ whenever an unused lesson is available.
  it('successive next() calls never show the same lesson twice in a row (>= 2 lessons)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 2, maxLength: 60 }),
        (count, rolls) => {
          const bank = new LessonBank({ lessons: makeLessons(count) });
          const rng = rngFrom(rolls);

          let prev = null;
          for (let i = 0; i < rolls.length; i += 1) {
            const lesson = bank.next(rng);
            expect(lesson).not.toBeNull();
            if (prev != null) {
              // An alternative always exists when count >= 2 → never repeat.
              expect(lesson.id).not.toBe(prev.id);
            }
            prev = lesson;
          }
        },
      ),
    );
  });

  it('selectLesson prefers an unused lesson over any recent one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 10 }), fc.double({ min: 0, max: 0.999, noNaN: true }), (count, roll) => {
        const lessons = makeLessons(count);
        // All but the last id are "recent"; the unused one must be chosen.
        const recent = lessons.slice(0, count - 1).map((l) => l.id);
        const chosen = selectLesson(lessons, recent, () => roll);
        expect(chosen.id).toBe(lessons[count - 1].id);
      }),
    );
  });

  it('a single-lesson bank returns that lesson (nothing to vary)', () => {
    const bank = new LessonBank({ lessons: makeLessons(1) });
    expect(bank.next(() => 0).id).toBe('L-0');
    expect(bank.next(() => 0).id).toBe('L-0');
  });

  it('the built-in lesson set has at least two lessons so variation is possible', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(2);
  });
});
