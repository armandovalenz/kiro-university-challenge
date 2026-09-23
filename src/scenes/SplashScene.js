// SplashScene — the branded intro screen (Task 5).
//
// Responsibilities:
//   - Center the Math Man logo (`02_logo.png`) with a short intro tween
//     (Req 7.1, 11.1, 11.3).
//   - Auto-advance to MenuScene after ~2s, or immediately on any key / click
//     (Req 7.2).
//   - Fall back to a styled text title if the logo asset failed to load, so the
//     game still boots (Req 13.5).
//
// MenuScene is built in Task 6. Until it is registered this scene guards the
// transition the same way BootScene guards SplashScene: it only starts the next
// scene when that key exists, otherwise it shows a placeholder so the
// build/run never throws.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, IMAGE_ASSETS, TIMINGS } from '../config.js';
import { MISSING_ASSETS_KEY } from './BootScene.js';
import { AudioEvent } from '../systems/AudioBus.js';

export default class SplashScene extends Phaser.Scene {
  constructor() {
    super('SplashScene');
    /** Guard so we only advance once (timer vs. input race). */
    this._advanced = false;
  }

  create() {
    this.cameras.main.setBackgroundColor('#000000');

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Decide logo vs. text-title fallback based on the missing-assets set the
    // BootScene stashed in the registry (Req 13.5).
    const missing = this.registry.get(MISSING_ASSETS_KEY);
    const logoKey = IMAGE_ASSETS.logo.key;
    const logoAvailable =
      this.textures.exists(logoKey) && !(missing && missing.has(logoKey));

    /** @type {Phaser.GameObjects.GameObject} the object we tween in. */
    let intro;

    if (logoAvailable) {
      const logo = this.add.image(cx, cy, logoKey).setOrigin(0.5);

      // Scale the logo down if it is larger than the play field so it always
      // fits without breaking layout (Req 11.3).
      const maxW = GAME_WIDTH * 0.8;
      const maxH = GAME_HEIGHT * 0.6;
      const scale = Math.min(1, maxW / logo.width, maxH / logo.height);
      logo.setScale(scale);
      this._baseScale = scale;
      intro = logo;
    } else {
      // Fallback: styled text title (Req 13.5).
      intro = this.add
        .text(cx, cy, 'MATH MAN', {
          fontFamily: 'monospace',
          fontSize: '72px',
          fontStyle: 'bold',
          color: '#ffff00',
          stroke: '#0033ff',
          strokeThickness: 8,
          align: 'center',
        })
        .setOrigin(0.5);
      this._baseScale = 1;
    }

    // Short intro tween: fade + gentle scale-up (Req 7.1, 11.1).
    intro.setAlpha(0);
    const target = this._baseScale;
    intro.setScale(target * 0.6);
    this.tweens.add({
      targets: intro,
      alpha: 1,
      scaleX: target,
      scaleY: target,
      ease: 'Back.Out',
      duration: 600,
    });

    // Hint text so the player knows they can skip.
    this.add
      .text(cx, GAME_HEIGHT - 60, 'Press any key or click to start', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    // Auto-advance after a short delay (Req 7.2).
    this._timer = this.time.delayedCall(TIMINGS.splashAutoAdvance, () => this._advance());

    // Or advance immediately on any key / pointer input (Req 7.2).
    this.input.keyboard.once('keydown', () => this._advance());
    this.input.once('pointerdown', () => this._advance());

    // Start the shared intro music (the looped score track). The AudioBus
    // defers playback until the autoplay unlock (the first key/click), which is
    // the same gesture that advances this scene, so the track begins at that
    // first interaction and then continues seamlessly (thanks to the
    // same-track guard in `_startMusic`) into Menu and Game.
    const audio = this.registry.get('audio');
    if (audio && typeof audio.play === 'function') audio.play(AudioEvent.TITLE);
  }

  /**
   * Transition to MenuScene. MenuScene is registered in Task 6; until then this
   * guards the transition so running never throws — it only starts the next
   * scene when that key is actually registered, otherwise it shows a
   * placeholder (mirrors BootScene._advance).
   */
  _advance() {
    if (this._advanced) return;
    this._advanced = true;

    if (this._timer) this._timer.remove(false);

    const nextKey = 'MenuScene';
    if (this.scene.manager.keys[nextKey]) {
      this.scene.start(nextKey);
      return;
    }

    // MenuScene not registered yet: show a placeholder so the splash flow is
    // verifiable on its own.
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 140, 'MenuScene not yet registered.', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ff8888',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
