// Fruit — the bonus collectible entity (Req 5.1, 5.2, 5.3).
//
// A Phaser Arcade sprite that appears at a maze `F` (fruit spawn) tile. When
// Math Man overlaps it, GameScene grants an extra life (capped at 10) and opens
// a micro-lesson (Task 14). GameScene owns the spawn schedule (a timer / pellet
// threshold from `config.TIMINGS`); this class owns the sprite, its Arcade body
// for overlap, and its appearance.
//
// Rendering degrades gracefully (Req 13.2, 13.5): the fruit icon is cut from
// `05_collectibles_and_math_icons.png` when that art is usable, otherwise a
// drawn cherry-style texture is generated so the fruit always renders. No frame
// map for the collectibles sheet is wired in the boot pipeline yet, so the
// drawn fallback is the default (mirrors Maze's collectible handling).

import Phaser from 'phaser';
import { TILE_SIZE, IMAGE_ASSETS } from '../config.js';

/**
 * Registry key under which BootScene stores the set of asset keys that failed
 * to load. Mirrored here to keep the entity decoupled from the boot pipeline.
 */
const MISSING_ASSETS_KEY = 'missingAssets';

/** Generated fallback texture key for the drawn fruit. */
const FRUIT_TEX = 'fruit_icon';

export default class Fruit extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene owning scene (GameScene)
   * @param {number} x spawn world x (tile center)
   * @param {number} y spawn world y (tile center)
   * @param {object} [opts]
   * @param {number} [opts.col] the fruit's tile column (for reference)
   * @param {number} [opts.row] the fruit's tile row (for reference)
   */
  constructor(scene, x, y, opts = {}) {
    const textureKey = Fruit._resolveTexture(scene);
    super(scene, x, y, textureKey);

    scene.add.existing(this);
    if (scene.physics && scene.physics.add) {
      scene.physics.add.existing(this);
    }

    this.col = opts.col;
    this.row = opts.row;

    this.setOrigin(0.5, 0.5);
    this.setDepth(8); // above pellets, below ghosts (9) and Math Man (10)

    // Snug circular body so overlap fires when Math Man is over the tile.
    if (this.body && this.body.setCircle) {
      const r = TILE_SIZE * 0.4;
      this.body.setCircle(r, TILE_SIZE / 2 - r, TILE_SIZE / 2 - r);
    }

    // A gentle pulse so the bonus reads as "collect me" (purely cosmetic).
    if (scene.tweens && typeof scene.tweens.add === 'function') {
      this._pulse = scene.tweens.add({
        targets: this,
        scale: { from: 0.9, to: 1.1 },
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /**
   * Remove the fruit from play (on collection or timeout). Stops the pulse tween
   * and destroys the sprite/body so no further overlaps fire.
   */
  collect() {
    if (this._pulse) {
      try {
        this._pulse.stop();
      } catch {
        /* ignore */
      }
      this._pulse = null;
    }
    this.destroy();
  }

  // --- Static texture helpers -------------------------------------------------

  /**
   * Choose the texture key: the collectibles art when usable, otherwise the
   * generated fallback. The collectibles sheet has no frame map yet, so the
   * reliable drawn fallback is returned (Req 13.2, 13.5).
   * @param {Phaser.Scene} scene
   * @returns {string}
   */
  static _resolveTexture(scene) {
    // When a real frame map is wired for the collectibles sheet, this is where
    // the fruit frame would be selected. Until then, fall back to a drawn icon.
    return Fruit._ensureFallbackTexture(scene);
  }

  /**
   * Whether the collectibles art loaded successfully (kept for when a frame map
   * is added; currently informational).
   * @param {Phaser.Scene} scene
   * @returns {boolean}
   */
  static _hasArt(scene) {
    const key = IMAGE_ASSETS.collectibles.key;
    const missing = scene.registry ? scene.registry.get(MISSING_ASSETS_KEY) : null;
    if (missing && typeof missing.has === 'function' && missing.has(key)) return false;
    return scene.textures.exists(key);
  }

  /**
   * Generate a simple cherry-style fruit texture (red body + green stem/leaf)
   * so the fruit renders without art. Idempotent per texture key.
   * @param {Phaser.Scene} scene
   * @returns {string} the texture key
   */
  static _ensureFallbackTexture(scene) {
    if (scene.textures.exists(FRUIT_TEX)) return FRUIT_TEX;

    const size = TILE_SIZE;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });

    // Cherry body (red circle with a small highlight).
    g.fillStyle(0xff3b3b, 1);
    g.fillCircle(size * 0.42, size * 0.66, size * 0.3);
    g.fillStyle(0xff8a8a, 1);
    g.fillCircle(size * 0.34, size * 0.58, size * 0.09);

    // Stem.
    g.lineStyle(Math.max(2, size * 0.08), 0x2e7d32, 1);
    g.beginPath();
    g.moveTo(size * 0.42, size * 0.4);
    g.lineTo(size * 0.66, size * 0.2);
    g.strokePath();

    // Leaf.
    g.fillStyle(0x43a047, 1);
    g.fillEllipse(size * 0.74, size * 0.22, size * 0.28, size * 0.14);

    g.generateTexture(FRUIT_TEX, size, size);
    g.destroy();
    return FRUIT_TEX;
  }
}
