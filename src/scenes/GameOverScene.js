// GameOverScene — the end-of-run screen (Task 16; Req 7.6, 7.7, 6.2, 6.4).
//
// Started by GameScene._onGameOver when `ScoreSystem.isGameOver()` becomes true
// (lives === 0). GameScene stops the parallel UIScene and hands this scene the
// score snapshot ({ score, lives, level, gameOver }) via scene data. This scene:
//   1. Persists the final score through `Storage.updateHighScore`, which writes
//      only when it beats the stored high score — a monotonic maximum across all
//      grades (Req 6.2, 6.4 / Property 15, 19).
//   2. Plays the new-high-score cue when the run set a record (Req 12.2). The
//      game-over cue itself was already played by GameScene._onGameOver.
//   3. Displays the final score and the (possibly updated) high score (Req 7.6).
//   4. Offers Play Again and Return-to-Menu. Play Again returns to the SPLASH
//      screen (Req 7.7) so the player re-enters through the normal splash → menu
//      flow; the selected difficulty stays persisted in Storage. Menu jumps
//      straight to the start menu.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEFAULT_GRADE, GRADES } from '../config.js';
import { AudioEvent } from '../systems/AudioBus.js';

export default class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  /**
   * Receive the final score snapshot from GameScene (`ScoreSystem.snapshot()`).
   * @param {{ score?: number, lives?: number, level?: number, gameOver?: boolean }} [data]
   */
  init(data = {}) {
    this._finalScore = Number.isFinite(data.score) ? data.score : 0;
    this._level = Number.isFinite(data.level) ? data.level : 1;
    /** Guards so Restart / Menu transition only once. */
    this._done = false;
  }

  create() {
    this.audio = this.registry.get('audio') || null;
    this.storage = this.registry.get('storage') || null;

    // Read the previous high score, then persist the final score (writes only
    // when greater — Req 6.4 / Property 15). `isNewHigh` drives the record cue.
    const previousHigh = this._readHighScore();
    const highScore = this._persistHighScore(previousHigh);
    const isNewHigh = this._finalScore > previousHigh;

    // New-high-score cue (Req 12.2). Silent no-op when audio/asset is missing.
    if (isNewHigh && this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.HIGH_SCORE);
    }

    // Grade to preserve on restart (Req 7.7) — the persisted last difficulty.
    this._grade = this._loadGrade();

    this._build(highScore, isNewHigh);
    this._bindInput();
  }

  // --- Persistence -----------------------------------------------------------

  /** Read the stored high score defensively (0 when storage is unavailable). */
  _readHighScore() {
    if (this.storage && typeof this.storage.get === 'function') {
      try {
        return this.storage.get().highScore || 0;
      } catch {
        /* fall through */
      }
    }
    return 0;
  }

  /**
   * Persist the final score and return the resulting high score. Delegates the
   * write-only-when-greater rule to Storage (Req 6.4 / Property 15).
   * @param {number} previousHigh
   * @returns {number}
   */
  _persistHighScore(previousHigh) {
    if (this.storage && typeof this.storage.updateHighScore === 'function') {
      try {
        return this.storage.updateHighScore(this._finalScore);
      } catch {
        /* fall through to a computed max */
      }
    }
    return Math.max(previousHigh, this._finalScore);
  }

  /**
   * Read the persisted difficulty so restart preserves it (Req 7.7). Falls back
   * to DEFAULT_GRADE when storage is unavailable or the value is invalid.
   * @returns {number}
   */
  _loadGrade() {
    if (this.storage && typeof this.storage.get === 'function') {
      try {
        const { lastDifficulty } = this.storage.get();
        if (GRADES.includes(lastDifficulty)) return lastDifficulty;
      } catch {
        /* fall through to default */
      }
    }
    return DEFAULT_GRADE;
  }

  // --- Layout ----------------------------------------------------------------

  /**
   * Build the game-over screen: title, final + high score, a "new high score"
   * flourish when a record was set, and the Restart / Menu buttons (Req 7.6).
   * @param {number} highScore
   * @param {boolean} isNewHigh
   */
  _build(highScore, isNewHigh) {
    const cx = GAME_WIDTH / 2;

    this.cameras.main.setBackgroundColor('#000000');
    this.add
      .rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000010)
      .setOrigin(0.5)
      .setAlpha(0.9);

    this.add
      .text(cx, GAME_HEIGHT * 0.22, 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize: '64px',
        fontStyle: 'bold',
        color: '#ff3030',
        stroke: '#330000',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.40, `FINAL SCORE\n${this._finalScore}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#ffff00',
        align: 'center',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.52, `HIGH SCORE  ${highScore}`, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#00ffff',
        align: 'center',
      })
      .setOrigin(0.5);

    if (isNewHigh) {
      const banner = this.add
        .text(cx, GAME_HEIGHT * 0.60, '★ NEW HIGH SCORE! ★', {
          fontFamily: 'monospace',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      // Gentle blink to celebrate the record.
      this.tweens.add({
        targets: banner,
        alpha: 0.3,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this._restartButton = this._makeButton(cx, GAME_HEIGHT * 0.74, '▶  PLAY AGAIN', '#003366', () =>
      this._restart(),
    );
    this._menuButton = this._makeButton(cx, GAME_HEIGHT * 0.84, 'MENU', '#1b1b3a', () =>
      this._menu(),
    );

    this.add
      .text(cx, GAME_HEIGHT - 24, 'Enter/R: play again · Esc: menu · M: mute', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.65);
  }

  /**
   * Create an interactive text button with hover feedback.
   * @param {number} x
   * @param {number} y
   * @param {string} label
   * @param {string} bg background color
   * @param {() => void} onClick
   * @returns {Phaser.GameObjects.Text}
   */
  _makeButton(x, y, label, bg, onClick) {
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffff00',
        backgroundColor: bg,
        padding: { x: 30, y: 14 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setColor('#ffffff'));
    button.on('pointerout', () => button.setColor('#ffff00'));
    button.on('pointerdown', onClick);
    return button;
  }

  _bindInput() {
    const kb = this.input.keyboard;
    if (kb) {
      // Restart (Req 7.7): Enter / Space / R.
      kb.on('keydown-ENTER', () => this._restart());
      kb.on('keydown-SPACE', () => this._restart());
      kb.on('keydown-R', () => this._restart());
      // Return to menu: Esc.
      kb.on('keydown-ESC', () => this._menu());
    }

    // Mute toggle stays available (Req 12.4); harmless if absent.
    if (this.audio && typeof this.audio.bindMuteKey === 'function') {
      this.audio.bindMuteKey(this);
    }
  }

  // --- Transitions -----------------------------------------------------------

  /**
   * Restart back to the SPLASH screen (Req 7.7). Rather than dropping straight
   * into a fresh GameScene, we return to the branded splash → menu flow so the
   * player re-enters the game the same way they first did (and can re-pick a
   * grade at the menu). The persisted difficulty is still remembered by Storage,
   * so it is preserved even though we do not thread it through here.
   */
  _restart() {
    if (this._done) return;
    this._done = true;
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.MENU_SELECT);
    }
    this.scene.start('SplashScene');
  }

  /** Return to the start menu (Req 7.6). */
  _menu() {
    if (this._done) return;
    this._done = true;
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.MENU_SELECT);
    }
    this.scene.start('MenuScene');
  }
}
