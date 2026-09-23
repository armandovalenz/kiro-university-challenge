// Property-based tests for QuizSystem (mandatory PBT — see
// .kiro/steering/testing.md).
//
// Owns Property 11 (answer checking and life cost are consistent). Tests use
// Vitest + fast-check and are named after the Core Property they validate,
// carrying the requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import QuizSystem, { checkAnswer, lifeCostFor } from './QuizSystem.js';

/** Build a question whose `choices` include `answer` plus some distractors. */
function questionArb() {
  return fc
    .record({
      answer: fc.string({ minLength: 1, maxLength: 8 }),
      distractors: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
      explanation: fc.string({ maxLength: 20 }),
    })
    .map(({ answer, distractors, explanation }) => ({
      id: 'q',
      answer,
      // Ensure the answer is a choice; distractors that equal the answer are fine.
      choices: [...distractors, answer],
      explanation,
    }));
}

describe('QuizSystem — Property 11: Answer checking and life cost are consistent', () => {
  // **Validates: Requirements 4.5, 4.6**
  // For any question and selected choice, the check passes iff the choice equals
  // the answer value; a correct answer deducts no life, a wrong answer deducts
  // exactly one and surfaces the explanation.
  it('check passes iff selection equals answer; cost is 0 when correct, 1 when wrong', () => {
    fc.assert(
      fc.property(questionArb(), (question) => {
        // Select every choice and verify the contract for each.
        for (const choice of question.choices) {
          const result = checkAnswer(question, choice);
          const shouldBeCorrect = choice === question.answer;

          expect(result.correct).toBe(shouldBeCorrect);
          expect(result.correctAnswer).toBe(question.answer);
          // The explanation is always surfaced (shown on wrong answers).
          expect(result.explanation).toBe(question.explanation);
          // Life cost mirrors correctness exactly.
          expect(lifeCostFor(result.correct)).toBe(shouldBeCorrect ? 0 : 1);
        }
      }),
    );
  });

  it('a selection outside the choices is wrong and costs exactly one life', () => {
    fc.assert(
      fc.property(questionArb(), fc.string({ minLength: 1 }), (question, selection) => {
        // Only exercise selections that are genuinely not a valid choice.
        if (question.choices.includes(selection)) return;
        const result = checkAnswer(question, selection);
        expect(result.correct).toBe(false);
        expect(lifeCostFor(result.correct)).toBe(1);
      }),
    );
  });

  it('null/undefined selections never crash and are treated as incorrect', () => {
    fc.assert(
      fc.property(questionArb(), fc.constantFrom(null, undefined), (question, selection) => {
        const result = checkAnswer(question, selection);
        expect(result.correct).toBe(false);
        expect(lifeCostFor(result.correct)).toBe(1);
      }),
    );
  });

  it('resolve records exactly one answered per call and correct only when right (Req 6.6)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 40 }), (answerCorrectness) => {
        // A tiny in-memory storage stub tracking quizStats the way Storage does.
        let answered = 0;
        let correct = 0;
        const storage = {
          recordQuizAnswer(wasCorrect) {
            answered += 1;
            if (wasCorrect) correct += 1;
          },
        };
        const quiz = new QuizSystem({ storage });

        let expectedAnswered = 0;
        let expectedCorrect = 0;
        for (const wantCorrect of answerCorrectness) {
          const question = { id: 'q', answer: 'A', choices: ['A', 'B'], explanation: 'e' };
          const selection = wantCorrect ? 'A' : 'B';
          const out = quiz.resolve(question, selection);

          expectedAnswered += 1;
          if (wantCorrect) expectedCorrect += 1;

          expect(out.correct).toBe(wantCorrect);
          expect(out.lifeCost).toBe(wantCorrect ? 0 : 1);
          expect(answered).toBe(expectedAnswered);
          expect(correct).toBe(expectedCorrect);
        }
      }),
    );
  });
});
