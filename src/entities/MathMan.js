// MathMan — the player entity.
//
// A Phaser Arcade sprite with classic Pac-Man-style, grid-locked movement:
//   - Tracks a current `direction` and a queued `nextDirection` intent.
//   - May only change heading when centered on a tile AND the target tile is
//     not a wall ("turn buffering"). Between tile centers it advances at a
//     constant `speed` along `direction`; walls block continued movement.
//   - Wraps horizontally at tunnel-row edges via the maze grid.
//
// Rendering degrades gracefully (Req 13.1, 13.5): frames are taken from
// `04_mascot_sprite_sheet.png` when it loaded, otherwise a drawn wedge texture
// (open/closed mouth) is generated and a chomp animation plays instead. The
// sprite is flipped/rotated to face `direction`.
//
// GameScene (Task 9) owns input + the game loop: it instantiates MathMan,
// wires arrow keys / WASD to `setDirection(dir)`, and calls `tick(delta)`
// each frame. This module contains only the entity and its movement logic.

import Phaser from 'phaser';
import { SPEEDS, TILE_SIZE, IMAGE_ASSETS } from '../config.js';
import { DIRECTIONS, nextCenterAhead } from '../maze/mazeLogic.js';

/**
 * Registry key under which BootScene stores the set of asset keys that failed
 * to load. Mirrored here (rather than imported from BootScene) to keep this
 * entity decoupled from the boot pipeline / its heavy imports.
 */
const MISSING_ASSETS_KEY = 'missingAssets';

/** Generated fallback texture keys (drawn when the mascot art is unavailable). */
const TEX = {
  open: 'mathman_wedge_open',
  closed: 'mathman_wedge_closed',
};

/** Animation key for the fallback chomp cycle. */
const ANIM_CHOMP = 'mathman-chomp';

/**
 * Facing → rotation/flip for the drawn wedge (mouth points right at 0 rad).
 * Using flipX for left keeps the mouth upright; up/down rotate a quarter turn.
 */
const FACING = {
  right: { rotation: 0, flipX: false },
  left: { rotation: 0, flipX: true },
  up: { rotation: -Math.PI / 2, flipX: false },
  down: { rotation: Math.PI / 2, flipX: false },
};

export default class MathMan extends Phaser.Physics.Arcade.Sprite {
  /**
   * Whether a real frame map for `04_mascot_sprite_sheet.png` has been wired.
   *
   * The sheet is currently preloaded with only a PLACEHOLDER frame size and no
   * animation frames, so its frame 0 is the near-empty top-left corner (which
   * renders Math Man invisible). While this is `false`, {@link _isSheetMissing}
   * forces the drawn-wedge fallback (matching Maze/Ghost/Fruit). Set it to
   * `true` only after defining the sheet's real frame slicing + chomp frames.
   * @type {boolean}
   */
  static MASCOT_FRAMES_READY = false;

  /**
   * @param {Phaser.Scene} scene owning scene (GameScene)
   * @param {number} x spawn world x (tile center)
   * @param {number} y spawn world y (tile center)
   * @param {import('../maze/Maze.js').default | import('../maze/mazeLogic.js').MazeGrid} maze
   *        the maze (Phaser wrapper or pure grid) used for wall/tunnel checks
   * @param {object} [opts]
   * @param {number} [opts.speed] pixels/second (defaults to config SPEEDS.mathMan)
   */
  constructor(scene, x, y, maze, { speed = SPEEDS.mathMan } = {}) {
    const usingFallback = MathMan._isSheetMissing(scene);
    if (usingFallback) MathMan._ensureFallbackTextures(scene);

    const textureKey = usingFallback ? TEX.closed : IMAGE_ASSETS.mascotSheet.key;
    super(scene, x, y, textureKey);

    scene.add.existing(this);
    if (scene.physics && scene.physics.add) {
      scene.physics.add.existing(this);
    }

    // The maze may be the Phaser wrapper (has `.grid`) or a bare MazeGrid.
    /** @type {import('../maze/mazeLogic.js').MazeGrid} */
    this.grid = maze && maze.grid ? maze.grid : maze;
    this.maze = maze;

    // --- Movement state -------------------------------------------------------
    this.speed = speed;
    /** @type {?('left'|'right'|'up'|'down')} current heading (null = idle). */
    this.direction = null;
    /** @type {?('left'|'right'|'up'|'down')} buffered turn intent. */
    this.nextDirection = null;
    /** True while actively advancing (false when blocked by a wall or idle). */
    this.moving = false;
    /** Spawn point, used by {@link resetPosition}. */
    this.spawnPoint = { x, y };
    /** How close (px) to a tile center counts as "centered" for decisions. */
    this.centerEpsilon = 1;

    this._usingFallback = usingFallback;

    // Fit the physics body a little inside the tile for fair overlap checks.
    this.setOrigin(0.5, 0.5);
    this.setDepth(10);
    if (this.body && this.body.setCircle) {
      const r = TILE_SIZE * 0.4;
      this.body.setCircle(r, TILE_SIZE / 2 - r, TILE_SIZE / 2 - r);
    }
    if (this.body) {
      // Movement is manual/grid-locked; the body exists only for overlap
      // detection. Stop Arcade Physics from integrating/reverting the sprite
      // so the manual position writes in tick() are authoritative.
      this.body.moves = false;
    }

    this._initAnimation();
    this._faceDirection();
  }

  // --- Public API (used by GameScene) -----------------------------------------

  /**
   * Queue a direction change. The turn is applied on the next tile center when
   * the target tile is not a wall (turn buffering); until then Math Man keeps
   * moving along its current heading. Ignores unknown directions.
   * @param {'left'|'right'|'up'|'down'} dir
   */
  setDirection(dir) {
    if (!DIRECTIONS[dir]) return;
    this.nextDirection = dir;
  }

  /**
   * Advance movement for one frame. Call once per frame from GameScene's
   * `update(time, delta)` (pass the frame delta in ms). Named `tick` (not
   * `update`) so Phaser's automatic Scene update list can never invoke it — the
   * manual GameScene call is the sole driver, so nothing moves while paused.
   *
   * Decisions (turning / stopping at walls) happen only at tile centers; motion
   * between centers is a constant-speed step along `direction`. Handles tunnel
   * wrap via the maze grid. Validates Requirements 1.2, 1.3.
   * @param {number} delta frame time in milliseconds
   */
  tick(delta) {
    if (!this.grid) return;

    // Clamp delta so a hitch (tab switch, breakpoint) cannot tunnel through a
    // wall by moving more than roughly one tile in a single frame, then convert
    // to a per-frame travel BUDGET in pixels. The budget-based loop below is
    // frame-rate independent: it advances toward successive tile centers and
    // re-decides each time a center is REACHED, so it behaves identically at
    // 30/60/120/240 Hz. It replaces the old epsilon-based snap-and-decide,
    // which oscillated on high-refresh displays (when stepLen < centerEpsilon
    // the entity snapped back every frame instead of crossing a full tile).
    const dt = Math.min(delta, 100) / 1000;
    let budget = this.speed * dt;
    if (budget <= 0) {
      this._updateAnimation();
      return;
    }

    // Exact-center re-decide: if Math Man is sitting EXACTLY on a tile center,
    // honor any buffered turn (and wall stop) the moment it is centered — e.g.
    // a queued turn at an intersection, or the first tick after a key press.
    // Uses a tiny 0.01px tolerance — NOT the 1px centerEpsilon — so it can
    // never reintroduce the sub-pixel oscillation the old code suffered from.
    {
      const { col, row } = this.grid.worldToTile(this.x, this.y);
      const center = this.grid.tileToWorld(col, row);
      if (Math.abs(this.x - center.x) < 0.01 && Math.abs(this.y - center.y) < 0.01) {
        this.x = center.x;
        this.y = center.y;
        this._decideAtTile(col, row);
      }
    }

    // Consume the travel budget by advancing toward successive tile centers,
    // applying buffered turns / wall stops each time a center is reached. The
    // `guard` cap is a safety bound against a decision that leaves `moving` true
    // while the entity cannot progress (only reachable with pathological
    // deltas); it is not part of normal flow.
    let guard = 0;
    while (budget > 1e-6 && this.moving && this.direction && guard++ < 8) {
      // Re-validate the heading whenever we are exactly on a tile center: only
      // step into the tile ahead if it is enterable (attemptMove respects
      // walls, bounds, and tunnel wrap). If blocked, re-decide here (apply
      // buffered turn / wall stop); if still blocked, stop this frame so Math
      // Man never enters a wall or leaves the maze. Gated at the center
      // (0.01px) so it can't reintroduce the high-refresh oscillation the old
      // 1px centerEpsilon caused.
      {
        const { col, row } = this.grid.worldToTile(this.x, this.y);
        const center = this.grid.tileToWorld(col, row);
        const onCenter =
          Math.abs(this.x - center.x) < 0.01 && Math.abs(this.y - center.y) < 0.01;
        if (onCenter) {
          if (!this.grid.attemptMove(col, row, this.direction).moved) {
            this._decideAtTile(col, row);
            if (!this.direction || !this.grid.attemptMove(col, row, this.direction).moved) {
              this.moving = false;
              break;
            }
          }
        }
      }

      const targetCenter = nextCenterAhead(this.grid, this.x, this.y, this.direction);
      const remaining = Math.hypot(targetCenter.x - this.x, targetCenter.y - this.y);

      if (remaining <= budget) {
        // Reached the next tile center: clamp exactly, wrap if we stepped off a
        // tunnel edge, then re-decide (apply buffered turn / wall stop) there.
        this.x = targetCenter.x;
        this.y = targetCenter.y;
        this.grid.wrapIfTunnel(this);
        budget -= remaining;
        const reached = this.grid.worldToTile(this.x, this.y);
        this._decideAtTile(reached.col, reached.row);
      } else {
        // Not enough budget to reach the center: advance and stop for the frame.
        const d = DIRECTIONS[this.direction];
        this.x += d.dx * budget;
        this.y += d.dy * budget;
        // Horizontal wrap at tunnel-row edges (mutates this.x when applicable).
        this.grid.wrapIfTunnel(this);
        budget = 0;
      }
    }

    this._faceDirection();
    this._updateAnimation();
  }

  /**
   * Reset Math Man to its spawn tile and clear movement state (used after a
   * catch / on a new life).
   * @param {number} [x] optional world x (defaults to spawn)
   * @param {number} [y] optional world y (defaults to spawn)
   */
  resetPosition(x = this.spawnPoint.x, y = this.spawnPoint.y) {
    this.setPosition(x, y);
    this.direction = null;
    this.nextDirection = null;
    this.moving = false;
    if (this.body && this.body.reset) this.body.reset(x, y);
    this._faceDirection();
    this._updateAnimation();
    return this;
  }

  /** Current tile coordinate of Math Man. */
  currentTile() {
    return this.grid.worldToTile(this.x, this.y);
  }

  // --- Movement internals -----------------------------------------------------

  /**
   * At a tile center, apply the buffered turn if its target tile is enterable,
   * then determine whether the (possibly new) heading is blocked by a wall.
   * Sets `direction` / `moving` accordingly. Turn buffering: an unapplicable
   * `nextDirection` is retained so it can take effect at a later intersection.
   * @param {number} col
   * @param {number} row
   */
  _decideAtTile(col, row) {
    // Try the queued turn first.
    if (this.nextDirection && this.nextDirection !== this.direction) {
      const turn = this.grid.attemptMove(col, row, this.nextDirection);
      if (turn.moved) {
        this.direction = this.nextDirection;
        this.nextDirection = null;
      }
    } else if (this.nextDirection === this.direction) {
      // Redundant queue; drop it.
      this.nextDirection = null;
    }

    // Can we keep going in the current heading?
    if (this.direction) {
      const ahead = this.grid.attemptMove(col, row, this.direction);
      this.moving = ahead.moved;
    } else {
      this.moving = false;
    }
  }

  // --- Rendering / animation --------------------------------------------------

  /** Orient the sprite to face the current (or last) heading. */
  _faceDirection() {
    const facing = FACING[this.direction];
    if (!facing) return;
    if (this._usingFallback) {
      this.setRotation(facing.rotation);
      this.setFlipX(facing.flipX);
    } else {
      // Real mascot art: avoid rotating a drawn-facing sprite; flip for left.
      this.setFlipX(this.direction === 'left');
    }
  }

  /** Build the chomp animation (fallback wedge) once, if not already present. */
  _initAnimation() {
    if (!this._usingFallback) return;
    const anims = this.scene.anims;
    if (anims.exists(ANIM_CHOMP)) return;
    anims.create({
      key: ANIM_CHOMP,
      frames: [{ key: TEX.open }, { key: TEX.closed }],
      frameRate: 10,
      repeat: -1,
    });
  }

  /** Play the chomp cycle while moving; hold a frame while idle/blocked. */
  _updateAnimation() {
    if (!this._usingFallback) return;
    if (this.moving) {
      if (!this.anims.isPlaying) this.anims.play(ANIM_CHOMP, true);
    } else if (this.anims.isPlaying) {
      this.anims.stop();
      this.setTexture(TEX.closed);
    }
  }

  // --- Static texture / asset helpers -----------------------------------------

  /**
   * True when the mascot sprite sheet cannot be used for rendering — so Math
   * Man falls back to its drawn wedge.
   *
   * `04_mascot_sprite_sheet.png` is preloaded (in BootScene) as a spritesheet
   * with a PLACEHOLDER frame size (TILE_SIZE×TILE_SIZE) against a ~2000px
   * source image, and no frame map has been wired yet. Frame 0 is therefore the
   * near-empty top-left 24×24 corner, which renders Math Man invisible. Like
   * the rest of the codebase (Maze/Ghost/Fruit), we deliberately keep using the
   * drawn fallback until a real mascot frame map exists — gated by
   * {@link MathMan.MASCOT_FRAMES_READY}. Flip that flag to true only once the
   * sheet's frame slicing + animation frames are actually defined.
   *
   * @param {Phaser.Scene} scene
   */
  static _isSheetMissing(scene) {
    // No real frame map yet → always use the drawn wedge fallback.
    if (!MathMan.MASCOT_FRAMES_READY) return true;

    const key = IMAGE_ASSETS.mascotSheet.key;
    const missing = scene.registry ? scene.registry.get(MISSING_ASSETS_KEY) : null;
    if (missing && typeof missing.has === 'function' && missing.has(key)) return true;
    return !scene.textures.exists(key);
  }

  /**
   * Generate the open/closed wedge textures (yellow pie slice with a mouth) so
   * Math Man renders even without the mascot art. Idempotent per texture key.
   * @param {Phaser.Scene} scene
   */
  static _ensureFallbackTextures(scene) {
    const size = TILE_SIZE;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 1;

    const draw = (key, mouthDeg) => {
      if (scene.textures.exists(key)) return;
      const g = scene.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffe000, 1);
      if (mouthDeg <= 0) {
        g.fillCircle(cx, cy, r);
      } else {
        // Pie slice leaving a wedge-shaped mouth open on the right (+x).
        const start = Phaser.Math.DegToRad(mouthDeg);
        const end = Phaser.Math.DegToRad(360 - mouthDeg);
        g.slice(cx, cy, r, start, end, false);
        g.fillPath();
      }
      g.generateTexture(key, size, size);
      g.destroy();
    };

    draw(TEX.closed, 0); // full circle (mouth closed)
    draw(TEX.open, 38); // mouth open
  }
}
