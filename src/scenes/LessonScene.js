// LessonScene — the fruit micro-lesson overlay (Req 5.3, 5.4).
//
// Launched in parallel over a PAUSED GameScene when Math Man collects a fruit
// (see GameScene._onFruitCollected). It renders an accessible DOM panel
// (`LessonModal`) over the `#overlay-root` element and, on dismiss (button /
// Enter / Esc), tears the panel down and calls back into GameScene to resume
// gameplay. Mirrors the pause/resume contract GameScene already uses for the
// quiz (`resumeAfterQuiz`) — here it is `resumeAfterLesson`.
//
// The lesson to show is selected by GameScene's `LessonBank` (so the
// vary-between-showings history persists across a run, Req 5.5 / Property 14)
// and handed in via scene data; this scene only presents it. A `lesson` may be
// absent (defensive) — the modal falls back to a generic "Did you know?".

import Phaser from 'phaser';
import LessonModal from '../ui/LessonModal.js';

export default class LessonScene extends Phaser.Scene {
  constructor() {
    super('LessonScene');
    /** @type {LessonModal|null} */
    this.modal = null;
  }

  /**
   * @param {object} [data]
   * @param {import('../systems/LessonBank.js').Lesson} [data.lesson] lesson to show
   * @param {() => void} [data.onDismiss] called once the player dismisses it
   */
  init(data = {}) {
    this._lesson = data.lesson || null;
    this._onDismiss = typeof data.onDismiss === 'function' ? data.onDismiss : null;
  }

  create() {
    const root = this._overlayRoot();
    this.modal = new LessonModal(root);

    // Play the fruit/lesson panel; dismissing it resumes gameplay exactly once.
    const opened = this.modal.open(this._lesson, () => this._finish());

    // If there is no DOM to render into (headless/asset-less), don't strand the
    // paused GameScene — resume immediately so play continues (Req 5.4).
    if (!opened) {
      this._finish();
    }
  }

  /** Tear down, notify the opener, and stop this overlay scene. */
  _finish() {
    if (this._finished) return;
    this._finished = true;

    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }

    const cb = this._onDismiss;
    this._onDismiss = null;
    if (cb) {
      try {
        cb();
      } catch {
        /* never let the resume callback crash the overlay */
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
