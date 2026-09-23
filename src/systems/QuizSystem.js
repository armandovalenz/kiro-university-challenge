// QuizSystem — the pure answer-checking core of the Einstein quiz.
//
// This module is framework-agnostic (NO Phaser imports) so it stays unit- and
// property-testable and portable (see .kiro/steering/tech.md / structure.md).
// `QuizScene` (Phaser) owns presentation + audio; this module owns the pure
// decision: did the player's selected choice match the record's `answer` VALUE,
// and what does that cost?
//
// Answers in the bank match by VALUE (not index) — see QuestionBank — so the
// check compares the selected choice STRING to `question.answer`.
//
// Requirements: 4.5, 4.6, 6.6
// Properties:
//   Property 11 — the check passes iff the choice equals the answer value; a
//     correct answer costs no life, a wrong answer costs exactly one and
//     surfaces the explanation.

/**
 * @typedef {object} QuizCheck
 * @property {boolean} correct       whether the selected choice equals `answer`.
 * @property {string}  correctAnswer the record's `answer` value (for highlight).
 * @property {string}  explanation   the record's explanation (shown on wrong).
 */

/**
 * PURE answer check (Property 11). The check passes **if and only if** the
 * selected choice equals the record's `answer` value. Always returns the
 * correct answer and explanation so the caller can highlight/reveal them.
 *
 * Defensive: a missing question or a null/undefined selection is simply
 * "incorrect" (never throws), which keeps the runtime quiz flow robust.
 *
 * @param {{answer?: string, explanation?: string}|null} question the record.
 * @param {string|null|undefined} selectedChoice the player's selected choice.
 * @returns {QuizCheck}
 */
export function checkAnswer(question, selectedChoice) {
  const correctAnswer = question && typeof question.answer === 'string' ? question.answer : '';
  const explanation =
    question && typeof question.explanation === 'string' ? question.explanation : '';
  const correct = selectedChoice != null && selectedChoice === correctAnswer;
  return { correct, correctAnswer, explanation };
}

/**
 * PURE life cost of an outcome (Property 11): a correct answer deducts no life;
 * a wrong answer deducts exactly one.
 * @param {boolean} correct
 * @returns {0|1}
 */
export function lifeCostFor(correct) {
  return correct ? 0 : 1;
}

export default class QuizSystem {
  /**
   * @param {object} [deps]
   * @param {import('./Storage.js').default|null} [deps.storage]
   *   Storage instance used to record quiz stats (Req 6.6). Optional so the
   *   pure check stays usable without any wiring (Task 18 / Property 11).
   * @param {import('./ScoreSystem.js').default|null} [deps.scoreSystem]
   *   Optional ScoreSystem. NOTE: in the game the life deduction is applied by
   *   `GameScene.resumeAfterQuiz` (via the `{ correct }` result), so by default
   *   this system does NOT touch lives to avoid a double deduction. A caller may
   *   opt in with `resolve(..., { applyLife: true })` for standalone use.
   */
  constructor({ storage = null, scoreSystem = null } = {}) {
    this.storage = storage || null;
    this.scoreSystem = scoreSystem || null;
  }

  /**
   * Pure check delegating to {@link checkAnswer}. Kept as an instance method for
   * ergonomic use from `QuizScene`; separable for tests via the named export.
   * @param {object|null} question
   * @param {string|null|undefined} selectedChoice
   * @returns {QuizCheck}
   */
  check(question, selectedChoice) {
    return checkAnswer(question, selectedChoice);
  }

  /**
   * Pure life cost delegating to {@link lifeCostFor}.
   * @param {boolean} correct
   * @returns {0|1}
   */
  lifeCost(correct) {
    return lifeCostFor(correct);
  }

  /**
   * Resolve a quiz round: run the pure check, record the answer in quiz stats
   * (Req 6.6), and report the life cost. Life deduction itself is left to the
   * caller (GameScene) unless `applyLife` is set. Never throws — storage errors
   * fall through silently (Storage already degrades to in-memory).
   *
   * @param {object|null} question the served record.
   * @param {string|null|undefined} selectedChoice the player's selection.
   * @param {{recordStats?: boolean, applyLife?: boolean}} [opts]
   * @returns {QuizCheck & { lifeCost: 0|1 }}
   */
  resolve(question, selectedChoice, { recordStats = true, applyLife = false } = {}) {
    const result = checkAnswer(question, selectedChoice);
    const cost = lifeCostFor(result.correct);

    if (recordStats && this.storage && typeof this.storage.recordQuizAnswer === 'function') {
      try {
        this.storage.recordQuizAnswer(result.correct);
      } catch {
        /* stats are best-effort; never crash the quiz flow */
      }
    }

    if (applyLife && cost > 0 && this.scoreSystem && typeof this.scoreSystem.loseLife === 'function') {
      try {
        this.scoreSystem.loseLife();
      } catch {
        /* never let a life update crash the quiz flow */
      }
    }

    return { ...result, lifeCost: cost };
  }
}

/** Named export kept alongside the default for import-style flexibility. */
export { QuizSystem };
