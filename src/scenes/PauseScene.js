// PauseScene — the pause overlay (Task 16; Req 7.5).
//
// Launched in parallel over a PAUSED GameScene when the player presses `P` or
// `Esc` (see GameScene._pauseGame). Because GameScene is paused, its update()
// and physics are frozen, so all entity movement halts while the overlay is up
// (Req 7.5). This scene draws a dim "PAUSED" overlay over the frozen frame and
// toggles back to gameplay on the next `P`/`Esc`: it resumes GameScene and
// stops itself. Mirrors the pause/resume contract the design describes
// (overlay scenes launch over a paused GameScene and resume it on dismiss).
//
// A short input-arming delay prevents the same key press that OPENED the pause
// (and keyboard auto-repeat while the key is held) from immediately resuming.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import { AudioEvent } from '../systems/AudioBus.js';

/** How long (ms) to ignore the pause key after opening, to debounce the toggle. */
const TOGGLE_ARM_DELAY = 200;

export default class PauseScene extends Phaser.Scene {
  constructor() {
    super('PauseScene');
  }

  create() {
    this.audio = this.registry.get('audio') || null;

    // Guards so the overlay resumes exactly once and only after arming.
    this._resumed = false;
    this._canToggle = false;

    this._buildOverlay();

    // Arm the resume toggle after a short delay so the keydown that launched
    // this overlay (and any auto-repeat) does not immediately unpause.
    this.time.delayedCall(TOGGLE_ARM_DELAY, () => {
      this._canToggle = true;
    });

    this._bindInput();
  }

  /** Draw the dim scrim, PAUSED title, and resume hint. */
  _buildOverlay() {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Dim the frozen gameplay frame beneath so the overlay reads clearly.
    this.add
      .rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 24, 'PAUSED', {
        fontFamily: 'monospace',
        fontSize: '56px',
        fontStyle: 'bold',
        color: '#ffff00',
        stroke: '#0033ff',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 34, 'Press P or Esc to resume', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.85);
  }

  _bindInput() {
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-P', this._resume, this);
      kb.on('keydown-ESC', this._resume, this);
    }

    // Mute toggle stays available while paused (Req 12.4); harmless if absent.
    if (this.audio && typeof this.audio.bindMuteKey === 'function') {
      this.audio.bindMuteKey(this);
    }
  }

  /**
   * Resume gameplay: play the pause/unpause cue (Req 12.2), un-pause GameScene,
   * and stop this overlay. No-op until armed or after it has already resumed.
   */
  _resume() {
    if (this._resumed || !this._canToggle) return;
    this._resumed = true;

    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.PAUSE);
    }

    if (this.scene.isPaused('GameScene')) {
      this.scene.resume('GameScene');
    }
    this.scene.stop();
  }
}
