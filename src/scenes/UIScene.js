// UIScene — the HUD overlay (Task 9).
//
// Runs in parallel over GameScene (`scene.launch('UIScene')`) and draws the
// score, level, high score, and remaining lives (Req 1.6). It reads the shared
// `ScoreSystem` from the registry (published by GameScene) and subscribes to
// its change events to stay in sync — it never mutates game state.
//
// Styling uses the UI kit art (`06_ui_kit.png`) for the HUD bars where
// practical (Req 13.3); life icons come from the collectibles art
// (`05_collectibles_and_math_icons.png`) with a drawn fallback (Req 13.2,
// 13.5). Because the HUD sits over the maze border walls (top/bottom rows), it
// costs no playfield space.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, IMAGE_ASSETS } from '../config.js';
import { SCORE_EVENTS } from '../systems/ScoreSystem.js';
import { MISSING_ASSETS_KEY } from './BootScene.js';

/** Drawn fallback texture key for a single life icon. */
const LIFE_ICON_TEX = 'hud_life_icon';

/** HUD bar height (px) — sits over the maze's solid border rows. */
const BAR_HEIGHT = 26;

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
    /** @type {Array<() => void>} ScoreSystem unsubscribe functions. */
    this._unsubscribers = [];
    /** @type {Phaser.GameObjects.GameObject[]} live life-icon sprites. */
    this._lifeIcons = [];
  }

  create() {
    this.scoreSystem = this.registry.get('scoreSystem') || null;
    this.storage = this.registry.get('storage') || null;
    this._missing = this.registry.get(MISSING_ASSETS_KEY) || new Set();

    // Track the last-seen life count so a change can be flagged as a gain or a
    // loss for the visible feedback (Req 9.1).
    this._lastLives = this.scoreSystem ? this.scoreSystem.snapshot().lives : 0;

    this._ensureLifeIconTexture();
    this._buildBars();
    this._buildText();

    // Initial paint from the current snapshot.
    this._refreshAll();

    this._subscribe();

    // Drop subscriptions when the HUD stops so listeners never fire against a
    // torn-down scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._onShutdown, this);
  }

  // --- Layout -----------------------------------------------------------------

  /**
   * Draw the top and bottom HUD bars. Uses the UI-kit texture as a tiled strip
   * when available (Req 13.3), otherwise a translucent rectangle so text stays
   * legible over the maze (Req 9.2, 13.5).
   */
  _buildBars() {
    const makeBar = (y) => {
      if (this._assetAvailable(IMAGE_ASSETS.uiKit.key)) {
        const bar = this.add
          .tileSprite(0, y, GAME_WIDTH, BAR_HEIGHT, IMAGE_ASSETS.uiKit.key)
          .setOrigin(0, 0)
          .setAlpha(0.85);
        // Backing tint keeps text readable regardless of the sampled art.
        this.add
          .rectangle(0, y, GAME_WIDTH, BAR_HEIGHT, 0x000018)
          .setOrigin(0, 0)
          .setAlpha(0.55);
        return bar;
      }
      return this.add
        .rectangle(0, y, GAME_WIDTH, BAR_HEIGHT, 0x000018)
        .setOrigin(0, 0)
        .setAlpha(0.7);
    };

    this._topBar = makeBar(0);
    this._bottomBar = makeBar(GAME_HEIGHT - BAR_HEIGHT);
  }

  /** Create the score / level / high-score text. */
  _buildText() {
    const style = {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#ffff00',
    };

    this._scoreText = this.add
      .text(10, BAR_HEIGHT / 2, 'SCORE 0', style)
      .setOrigin(0, 0.5);

    this._levelText = this.add
      .text(GAME_WIDTH / 2, BAR_HEIGHT / 2, 'LEVEL 1', {
        ...style,
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5);

    this._highText = this.add
      .text(GAME_WIDTH - 10, BAR_HEIGHT / 2, 'HIGH 0', {
        ...style,
        color: '#00ffff',
      })
      .setOrigin(1, 0.5);

    // Bottom bar label preceding the life icons.
    this._livesLabel = this.add
      .text(10, GAME_HEIGHT - BAR_HEIGHT / 2, 'LIVES', {
        ...style,
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5);
  }

  // --- Data binding -----------------------------------------------------------

  /** Subscribe to ScoreSystem change events (single re-read on any change). */
  _subscribe() {
    if (!this.scoreSystem || typeof this.scoreSystem.on !== 'function') return;
    // CHANGE fires on every mutation → one place to re-read everything.
    this._unsubscribers.push(
      this.scoreSystem.on(SCORE_EVENTS.CHANGE, () => this._refreshAll()),
    );
    // LIVES fires on gain/loss → show a visible +1/-1 flash (Req 9.1).
    this._unsubscribers.push(
      this.scoreSystem.on(SCORE_EVENTS.LIVES, (lives) => this._onLivesChanged(lives)),
    );
    // Task 16 will surface game over; harmless hook kept here for later use.
    this._unsubscribers.push(
      this.scoreSystem.on(SCORE_EVENTS.GAME_OVER, () => {
        /* GameOverScene transition is Task 16. */
      }),
    );
  }

  /** Re-read the score system and repaint every HUD element. */
  _refreshAll() {
    const snap = this.scoreSystem
      ? this.scoreSystem.snapshot()
      : { score: 0, lives: 0, level: 1 };
    this._scoreText.setText(`SCORE ${snap.score}`);
    this._levelText.setText(`LEVEL ${snap.level}`);
    this._highText.setText(`HIGH ${this._highScore(snap.score)}`);
    this._renderLives(snap.lives);
  }

  /**
   * Effective high score to display: the larger of the stored high score and
   * the current run's score, so beating the record shows immediately (the
   * persisted write happens at game over in Task 16).
   * @param {number} currentScore
   * @returns {number}
   */
  _highScore(currentScore) {
    let stored = 0;
    if (this.storage && typeof this.storage.get === 'function') {
      try {
        stored = this.storage.get().highScore || 0;
      } catch {
        stored = 0;
      }
    }
    return Math.max(stored, currentScore || 0);
  }

  /**
   * Draw one life icon per remaining life along the bottom bar (Req 1.6, 13.2).
   * @param {number} lives
   */
  _renderLives(lives) {
    for (const icon of this._lifeIcons) icon.destroy();
    this._lifeIcons = [];

    const size = BAR_HEIGHT - 8;
    const gap = 6;
    const startX = (this._livesLabel ? this._livesLabel.x + this._livesLabel.width : 10) + 12;
    const y = GAME_HEIGHT - BAR_HEIGHT / 2;

    for (let i = 0; i < lives; i++) {
      const x = startX + i * (size + gap);
      const icon = this.add.image(x, y, LIFE_ICON_TEX).setOrigin(0, 0.5);
      icon.setDisplaySize(size, size);
      this._lifeIcons.push(icon);
    }

    // Remember where the lives row starts/ends so the flash can anchor to it.
    this._livesRowStartX = startX;
    this._livesRowEndX = startX + Math.max(lives, 0) * (size + gap);
    this._livesRowY = y;
  }

  /**
   * Visible life-change feedback (Req 9.1). When the life count rises or falls,
   * float a "+1 LIFE" (green) or "-1 LIFE" (red) label above the lives row and
   * briefly pulse the lives label so the change is unmissable — this is in
   * addition to the icon count updating via {@link _refreshAll}.
   * @param {number} lives the new life count.
   */
  _onLivesChanged(lives) {
    const prev = this._lastLives;
    this._lastLives = lives;
    if (!Number.isFinite(prev) || lives === prev) return;

    const gained = lives > prev;
    const label = gained ? '+1 LIFE' : '-1 LIFE';
    const color = gained ? '#00ffab' : '#ff5470';

    // Pulse the "LIVES" label in the change color for a quick, legible cue.
    if (this._livesLabel) {
      const restore = '#ffffff';
      this._livesLabel.setColor(color);
      this.time.delayedCall(450, () => {
        if (this._livesLabel && this._livesLabel.active) this._livesLabel.setColor(restore);
      });
    }

    // Float a short label up from the lives row and fade it out.
    const x = (this._livesRowEndX ?? (GAME_WIDTH / 2)) + 14;
    const y = this._livesRowY ?? (GAME_HEIGHT - BAR_HEIGHT / 2);
    const flash = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '16px',
        fontStyle: 'bold',
        color,
      })
      .setOrigin(0, 0.5)
      .setDepth(1000);

    this.tweens.add({
      targets: flash,
      y: y - 22,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  // --- Textures / assets ------------------------------------------------------

  /**
   * Generate the drawn life-icon texture (a small Math Man head) once. Used as
   * the reliable fallback for the collectibles art, which has no frame map yet
   * (mirrors Maze's collectible handling; Req 13.2, 13.5).
   */
  _ensureLifeIconTexture() {
    if (this.textures.exists(LIFE_ICON_TEX)) return;
    const s = TILE_SIZE;
    const cx = s / 2;
    const cy = s / 2;
    const r = s / 2 - 2;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffe000, 1);
    // Pac-Man-style wedge facing right (mouth open).
    const start = Phaser.Math.DegToRad(30);
    const end = Phaser.Math.DegToRad(330);
    g.slice(cx, cy, r, start, end, false);
    g.fillPath();
    g.generateTexture(LIFE_ICON_TEX, s, s);
    g.destroy();
  }

  /**
   * Whether an image asset is usable: the texture exists AND it was not flagged
   * as failed during boot (Req 13.5).
   * @param {string} key
   * @returns {boolean}
   */
  _assetAvailable(key) {
    return this.textures.exists(key) && !(this._missing && this._missing.has(key));
  }

  // --- Teardown ---------------------------------------------------------------

  _onShutdown() {
    for (const off of this._unsubscribers) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this._unsubscribers = [];
    for (const icon of this._lifeIcons) icon.destroy();
    this._lifeIcons = [];
  }
}
