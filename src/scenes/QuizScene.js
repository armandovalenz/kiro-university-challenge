// QuizScene — the Einstein-caught quiz overlay (Req 4.1, 4.4, 4.5, 4.6, 4.7).
//
// Launched in parallel over a PAUSED GameScene when an Einstein ghost catches
// Math Man (see GameScene._onMathManCaught). Because GameScene is paused, its
// update() and physics are frozen, so no entity moves while the question is
// open (Req 4.7). This scene:
//   1. Pulls a grade-matched question from the shared `QuestionBank` (registry
//      `'questionBank'`), drawing from BOTH math and science by default
//      (no subject filter) (Req 4.2, 4.3).
//   2. Presents it through the accessible DOM `QuizModal` (Req 4.1, 4.4).
//   3. On submit, runs the PURE `QuizSystem.check`, plays the correct/wrong
//      cue, records quiz stats via `Storage` (Req 6.6), reveals the outcome
//      (correct answer + explanation on wrong, Req 4.6), and once the player
//      continues resolves back to GameScene via `onResolved({ correct })`.
//
// GameScene.resumeAfterQuiz owns the consequences: wrong → loseLife(), then
// game-over or reset+resume. This scene therefore never touches lives directly;
// it only reports `{ correct }`. Mirrors the pause/resume contract used by
// LessonScene.

import Phaser from 'phaser';
import QuizModal from '../ui/QuizModal.js';
import QuizSystem from '../systems/QuizSystem.js';
import { AudioEvent } from '../systems/AudioBus.js';
import { DEFAULT_GRADE, GRADES } from '../config.js';

export default class QuizScene extends Phaser.Scene {
  constructor() {
    super('QuizScene');
    /** @type {QuizModal|null} */
    this.modal = null;
  }

  /**
   * @param {object} [data]
   * @param {number} [data.grade] selected grade (5/6/7) for question matching.
   * @param {(result: {correct: boolean}) => void} [data.onResolved]
   *   called once when the question is resolved (after the player continues).
   */
  init(data = {}) {
    this._grade = GRADES.includes(data.grade) ? data.grade : DEFAULT_GRADE;
    this._onResolved = typeof data.onResolved === 'function' ? data.onResolved : null;
    this._resolved = false;
  }

  create() {
    // Shared systems from the registry (populated by BootScene / GameScene).
    this.audio = this.registry.get('audio') || null;
    this.storage = this.registry.get('storage') || null;
    const bank = this.registry.get('questionBank') || null;

    // Pure answer-checking core, wired to Storage for quiz stats (Req 6.6).
    this.quizSystem = new QuizSystem({ storage: this.storage });

    // Grade-matched question drawing from BOTH subjects by default (Req 4.3).
    this._question = bank && typeof bank.next === 'function' ? bank.next(this._grade) : null;

    // No question available (bank empty / no DOM) → don't strand the paused
    // GameScene; resolve as "incorrect handling avoided" by treating it as a
    // safe pass-through resume (no life lost). This should not happen because
    // QuestionBank always falls back to a built-in set (Property 13).
    if (!this._question) {
      this._finish({ correct: true });
      return;
    }

    const root = this._overlayRoot();
    this.modal = new QuizModal(root);
    const opened = this.modal.open(this._question, (choice) => this._onSubmit(choice));

    // No DOM to render into (headless/asset-less) → resume without penalty so
    // gameplay never stalls (defensive; mirrors LessonScene).
    if (!opened) {
      this._finish({ correct: true });
      return;
    }

    // Question is on screen: replace the (already-ducked) score with the
    // quiz-thinking loop at full music volume. `_startMusic` crossfades the
    // score out and brings jeopardy in exempt from the overlay duck.
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.QUIZ_MUSIC);
    }
  }

  /**
   * Handle the player's submitted choice: run the pure check, play the cue,
   * record stats, and reveal the outcome. Resolving to GameScene is deferred
   * until the player continues from the result view (Req 4.5, 4.6).
   * @param {string} choice the selected choice string.
   */
  _onSubmit(choice) {
    const result = this.quizSystem.resolve(this._question, choice); // records stats (Req 6.6)

    // Question solved: play ONLY the correct/wrong cue — no other sound should
    // overlap it. Stop the looping jeopardy quiz music and silence any lingering
    // effect (e.g. the "caught" cue) first, so the outcome cue is heard cleanly
    // (one sound at a time). The gameplay score crossfades back in when the
    // player closes the dialog (see `_finish`). Silent no-op without audio.
    if (this.audio) {
      if (typeof this.audio.stopMusic === 'function') this.audio.stopMusic();
      if (typeof this.audio.stopAllSfx === 'function') this.audio.stopAllSfx();
      if (typeof this.audio.play === 'function') {
        this.audio.play(result.correct ? AudioEvent.CORRECT : AudioEvent.WRONG);
      }
    }

    // Reveal outcome (highlight correct answer + explanation on wrong), then
    // resolve back to GameScene once the player continues.
    if (this.modal) {
      this.modal.showResult(result, () => this._finish({ correct: result.correct }));
    } else {
      this._finish({ correct: result.correct });
    }
  }

  /**
   * Tear down the modal, notify GameScene of the outcome exactly once, and stop
   * this overlay scene. GameScene.resumeAfterQuiz applies life loss / reset /
   * resume / game-over.
   * @param {{correct: boolean}} result
   */
  _finish(result) {
    if (this._resolved) return;
    this._resolved = true;

    // Dialog closing: crossfade the jeopardy quiz loop back to the gameplay
    // score now that the player has continued past the result view. This is
    // the intended point where the score resumes, and it also covers the
    // no-DOM / no-question early-finish paths where `_onSubmit` never ran.
    // Idempotent — the `_musicKey` same-key guard makes this a no-op when the
    // score is already the current track.
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.GAME_MUSIC);
    }

    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }

    const cb = this._onResolved;
    this._onResolved = null;
    if (cb) {
      try {
        cb({ correct: !!(result && result.correct) });
      } catch {
        /* never let the resolve callback crash the overlay */
      }
    }

    this.scene.stop();
  }

  /** Locate the DOM overlay root declared in index.html. */
  _overlayRoot() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('overlay-root');
  }

  shutdown() {
    // Safety: ensure the panel never lingers if the scene is stopped externally.
    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }
  }
}
