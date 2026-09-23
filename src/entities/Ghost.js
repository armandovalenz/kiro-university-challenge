// Ghost (Einstein) — the pursuer entity.
//
// A Phaser Arcade sprite that moves with the same grid-locked, turn-at-center
// rhythm as MathMan, but chooses its heading with AI instead of player input:
// at each tile center it computes a target tile from its `personality` and
// picks the legal, non-reversing direction that minimizes distance to that
// target (see the pure helpers in `ghostAI.js`).
//
// Four ghosts spawn from the ghost house in distinct colors (red/pink/cyan/
// orange) with distinct personalities (chase/ambush/vector/scatter). Speed is
// scaled by the selected grade.
//
// Rendering degrades gracefully (Req 3.5, 13.4, 13.5): per-color Einstein
// sprite frames are used when the ghost art is available, otherwise a tinted
// drawn ghost (colored body + white wild hair + mustache) is generated so each
// ghost still reads as a color-distinct Einstein. No ghost sprite atlas is
// wired in the boot pipeline yet, so the drawn Einstein fallback is the default.
//
// GameScene (Task 10) spawns the ghosts and calls `tick(delta)` each frame.
// The ghost↔MathMan overlap that emits `mathman-caught` is Task 11 — this class
// only owns the entity, its movement, and its appearance.

import Phaser from 'phaser';
import { SPEEDS, TILE_SIZE } from '../config.js';
import { DIRECTIONS, nextCenterAhead } from '../maze/mazeLogic.js';
import {
  computeTargetTile,
  chooseGhostDirection,
  houseRegionFromGrid,
  isHouseTile,
  ghostHouseExitTile,
  blockHouseReentry,
} from './ghostAI.js';

/**
 * Registry key under which BootScene stores the set of asset keys that failed
 * to load. Mirrored here to keep the entity decoupled from the boot pipeline.
 */
const MISSING_ASSETS_KEY = 'missingAssets';

/** Headings a ghost may leave the house with (tried in order). */
const SPAWN_DIRECTIONS = ['up', 'left', 'right', 'down'];

export default class Ghost extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene owning scene (GameScene)
   * @param {number} x spawn world x (tile center)
   * @param {number} y spawn world y (tile center)
   * @param {import('../maze/Maze.js').default | import('../maze/mazeLogic.js').MazeGrid} maze
   *        the maze (Phaser wrapper or pure grid) used for wall/tunnel checks
   * @param {object} [opts]
   * @param {number} [opts.color] tint/body color (0xRRGGBB)
   * @param {string} [opts.personality] 'chase' | 'ambush' | 'vector' | 'scatter'
   * @param {number} [opts.speed] pixels/second (defaults to config SPEEDS.ghost)
   * @param {string} [opts.colorKey] stable name ('red'/'pink'/...) for texture keys
   */
  constructor(scene, x, y, maze, opts = {}) {
    const {
      color = 0xff0000,
      personality = 'chase',
      speed = SPEEDS.ghost,
      colorKey = String(color),
    } = opts;

    const usingArt = Ghost._hasArt(scene, colorKey);
    const textureKey = usingArt
      ? Ghost._artTextureKey(colorKey)
      : Ghost._ensureFallbackTexture(scene, color, colorKey);

    super(scene, x, y, textureKey);

    scene.add.existing(this);
    if (scene.physics && scene.physics.add) {
      scene.physics.add.existing(this);
    }

    // The maze may be the Phaser wrapper (has `.grid`) or a bare MazeGrid.
    /** @type {import('../maze/mazeLogic.js').MazeGrid} */
    this.grid = maze && maze.grid ? maze.grid : maze;
    this.maze = maze;

    // --- Identity -------------------------------------------------------------
    this.color = color;
    this.colorKey = colorKey;
    this.personality = personality;

    // --- Movement state (mirrors MathMan) ------------------------------------
    this.speed = speed;
    /** @type {?('left'|'right'|'up'|'down')} current heading. */
    this.direction = null;
    /** True while actively advancing (false when fully blocked). */
    this.moving = false;
    /** Spawn point, used by {@link resetPosition}. */
    this.spawnPoint = { x, y };
    /** How close (px) to a tile center counts as "centered" for decisions. */
    this.centerEpsilon = 1;
    this._usingArt = usingArt;

    // Home corner this ghost retreats to (scatter personality). Distinct per
    // ghost so the quartet spreads out. Derived from grid bounds.
    this.scatterCorner = Ghost._cornerFor(personality, this.grid);

    // --- Ghost-house release --------------------------------------------------
    // The ghost starts INSIDE the house. Until it clears the house it heads for
    // the exit tile above the door (via the normal grid, so it can pass through
    // the door). Once out it never re-enters (see `_decideAtTile`).
    /** @type {{minCol:number,maxCol:number,minRow:number,maxRow:number}} */
    this._house = houseRegionFromGrid(this.grid);
    /** True once the ghost has left the house interior. */
    this._exitedHouse = false;
    /** Cached re-entry-blocking grid view (built lazily, reused). */
    this._noReentryGrid = this.grid ? blockHouseReentry(this.grid, this._house) : null;

    this.setOrigin(0.5, 0.5);
    this.setDepth(9); // just below Math Man (depth 10)
    if (this._usingArt) this.setTint(color);
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

    // Pick an initial legal heading out of the house.
    this._initDirection();
  }

  // --- Public API (used by GameScene) -----------------------------------------

  /**
   * Advance movement for one frame. Call once per frame from GameScene's
   * `update(time, delta)` (pass the frame delta in ms). Named `tick` (not
   * `update`) so Phaser's automatic Scene update list can never invoke it — the
   * manual GameScene call is the sole driver, so nothing moves while paused.
   * Decisions (target + heading) happen only at tile centers; motion between
   * centers is a constant-speed step along `direction`, with tunnel wrap.
   * Validates the ghost movement of Requirements 3.1 (legal moves) and the
   * grid-lock rule.
   * @param {number} delta frame time in milliseconds
   */
  tick(delta) {
    if (!this.grid) return;

    // Clamp delta so a hitch (tab switch, breakpoint) cannot tunnel through a
    // wall in one frame, then convert to a per-frame travel BUDGET in pixels.
    // The budget-based loop below is frame-rate independent: it advances toward
    // successive tile centers and re-decides each time a center is REACHED, so
    // it behaves identically at 30/60/120/240 Hz. It replaces the old
    // epsilon-based snap-and-decide, which oscillated on high-refresh displays
    // (when stepLen < centerEpsilon the entity snapped back every frame and
    // never left its spawn tile).
    const dt = Math.min(delta, 100) / 1000;
    let budget = this.speed * dt;
    if (budget <= 0) return;

    // Exact-center re-decide: if the ghost is sitting EXACTLY on a tile center
    // (e.g. at spawn), re-target once so it picks a heading before stepping.
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
    // deciding a new heading each time a center is reached. The `guard` cap is
    // a safety bound against a decision that leaves `moving` true while the
    // entity cannot progress (only reachable with pathological deltas); it is
    // not part of normal flow.
    let guard = 0;
    while (budget > 1e-6 && this.moving && this.direction && guard++ < 8) {
      // Re-validate the heading whenever we are exactly on a tile center: only
      // step into the tile ahead if it is enterable (attemptMove respects
      // walls, bounds, and tunnel wrap). If blocked, re-decide here; if still
      // blocked, stop this frame so the ghost never enters a wall or leaves the
      // maze. Gated at the center (0.01px) so it can't reintroduce the
      // high-refresh oscillation the old 1px centerEpsilon caused.
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
        // tunnel edge, then re-decide at the reached (in-bounds) tile.
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
        this.grid.wrapIfTunnel(this);
        budget = 0;
      }
    }

    this._faceDirection();
  }

  /**
   * Reset the ghost to its spawn tile and clear movement state (used after a
   * catch / on a new life; Req 3.4).
   */
  resetPosition(x = this.spawnPoint.x, y = this.spawnPoint.y) {
    this.setPosition(x, y);
    this.direction = null;
    this.moving = false;
    // Returned to the spawn inside the house: perform the exit sequence again.
    this._exitedHouse = false;
    if (this.body && this.body.reset) this.body.reset(x, y);
    this._initDirection();
    this._faceDirection();
    return this;
  }

  /** Current tile coordinate of the ghost. */
  currentTile() {
    return this.grid.worldToTile(this.x, this.y);
  }

  // --- Movement internals -----------------------------------------------------

  /** Choose a starting heading from the spawn tile (first legal option). */
  _initDirection() {
    if (!this.grid) return;
    const { col, row } = this.grid.worldToTile(this.x, this.y);
    for (const dir of SPAWN_DIRECTIONS) {
      if (this.grid.attemptMove(col, row, dir).moved) {
        this.direction = dir;
        this.moving = true;
        return;
      }
    }
    this.direction = null;
    this.moving = false;
  }

  /**
   * At a tile center, choose the next heading. Two phases:
   *
   *  1. House release: while the ghost has not yet cleared the house, it aims
   *     for the exit tile above the door and chooses using the NORMAL grid, so
   *     it can path UP through the door and out. The moment it stands on a tile
   *     outside the house, it is marked exited.
   *  2. Chase: once exited, it targets its personality tile and chooses using a
   *     re-entry-blocking grid view so it can never path back into the house and
   *     ping-pong at the doorway.
   *
   * All decision logic stays in the pure helpers in `ghostAI.js` (Property 23).
   * @param {number} col
   * @param {number} row
   */
  _decideAtTile(col, row) {
    const ghostTile = { col, row };

    // Phase transition: as soon as we stand outside the house, lock in exited.
    if (!this._exitedHouse && !isHouseTile(this._house, col, row)) {
      this._exitedHouse = true;
    }

    let target;
    let gridView;
    if (!this._exitedHouse) {
      // Exit phase: head for the door and out (normal grid allows the door).
      target = ghostHouseExitTile(this._house);
      gridView = this.grid;
    } else {
      // Chase phase: personality target, but forbidden from re-entering.
      target = computeTargetTile(this.personality, this._aiContext(ghostTile));
      gridView = this._noReentryGrid || this.grid;
    }

    const dir = chooseGhostDirection(gridView, ghostTile, this.direction, target);
    if (dir) {
      this.direction = dir;
      this.moving = true;
    } else {
      this.moving = false;
    }
  }

  /**
   * Gather plain-data context for the AI from the scene (Math Man tile/heading
   * and the red ghost's tile for the vector personality). Kept here so the AI
   * helpers stay framework-agnostic.
   * @param {{col:number,row:number}} ghostTile
   */
  _aiContext(ghostTile) {
    const scene = this.scene;
    const mathMan = scene && scene.mathMan;
    const mathManTile = mathMan && typeof mathMan.currentTile === 'function'
      ? mathMan.currentTile()
      : ghostTile;
    const mathManDir = mathMan ? mathMan.direction : null;

    let redGhostTile;
    if (this.personality === 'vector') {
      const red = Ghost._findRedGhost(scene);
      redGhostTile = red && red !== this && typeof red.currentTile === 'function'
        ? red.currentTile()
        : mathManTile;
    }

    return {
      mathManTile,
      mathManDir,
      ghostTile,
      redGhostTile,
      scatterCorner: this.scatterCorner,
    };
  }

  // --- Rendering --------------------------------------------------------------

  /** Face the sprite toward its heading (flip for left when using art). */
  _faceDirection() {
    if (this._usingArt) {
      this.setFlipX(this.direction === 'left');
    }
    // The drawn Einstein ghost is symmetric; no rotation needed.
  }

  // --- Static helpers ---------------------------------------------------------

  /** Locate the red ghost among the scene's ghost group (for vector targeting). */
  static _findRedGhost(scene) {
    const group = scene && scene.ghosts;
    if (!group || typeof group.getChildren !== 'function') return null;
    return group.getChildren().find((g) => g.colorKey === 'red') || null;
  }

  /**
   * Distinct home corner per personality, derived from grid bounds so it works
   * for any maze size. red→top-right, pink→top-left, cyan→bottom-right,
   * orange→bottom-left; default to top-right.
   */
  static _cornerFor(personality, grid) {
    const maxCol = grid && grid.cols ? grid.cols - 1 : 0;
    const maxRow = grid && grid.rows ? grid.rows - 1 : 0;
    switch (personality) {
      case 'ambush': // pink
        return { col: 0, row: 0 };
      case 'vector': // cyan
        return { col: maxCol, row: maxRow };
      case 'scatter': // orange
        return { col: 0, row: maxRow };
      case 'chase': // red
      default:
        return { col: maxCol, row: 0 };
    }
  }

  /** Texture key for per-color ghost art (spritesheet frames, when present). */
  static _artTextureKey(colorKey) {
    return `ghost_art_${colorKey}`;
  }

  /**
   * True when per-color ghost art is loaded for this color. No ghost atlas is
   * registered in the boot pipeline yet, so this is effectively always false
   * and the drawn Einstein fallback is used — but the check is honored so real
   * art can be dropped in later without touching movement code.
   * @param {Phaser.Scene} scene
   * @param {string} colorKey
   */
  static _hasArt(scene, colorKey) {
    const key = Ghost._artTextureKey(colorKey);
    const missing = scene.registry ? scene.registry.get(MISSING_ASSETS_KEY) : null;
    if (missing && typeof missing.has === 'function' && missing.has(key)) return false;
    return scene.textures.exists(key);
  }

  /**
   * Generate a tinted Einstein ghost texture (colored ghost body + big white
   * eyes, wild white hair tufts, and a white mustache) so the ghost renders
   * without art. Idempotent per color key. Returns the texture key.
   * @param {Phaser.Scene} scene
   * @param {number} color body color (0xRRGGBB)
   * @param {string} colorKey stable name for the texture key
   * @returns {string} generated texture key
   */
  static _ensureFallbackTexture(scene, color, colorKey) {
    const key = `ghost_einstein_${colorKey}`;
    if (scene.textures.exists(key)) return key;

    const size = TILE_SIZE;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const w = size;
    const h = size;
    const cx = w / 2;

    // --- Ghost body (rounded dome + wavy skirt) -------------------------------
    g.fillStyle(color, 1);
    const bodyTop = h * 0.34;
    const r = w * 0.42;
    g.fillCircle(cx, bodyTop, r); // dome
    g.fillRect(cx - r, bodyTop, r * 2, h * 0.5 - bodyTop + h * 0.18); // torso
    // Wavy skirt: three little bumps along the bottom edge.
    const skirtY = bodyTop + (h * 0.5 - bodyTop + h * 0.18);
    const bump = r * 2 / 3;
    g.fillCircle(cx - r + bump * 0.5, skirtY, bump * 0.5);
    g.fillCircle(cx, skirtY, bump * 0.5);
    g.fillCircle(cx + r - bump * 0.5, skirtY, bump * 0.5);

    // --- Einstein wild white hair (tufts across the dome) ---------------------
    g.fillStyle(0xffffff, 1);
    const hairY = bodyTop - r * 0.55;
    for (let i = -2; i <= 2; i++) {
      const hx = cx + i * (r * 0.42);
      g.fillCircle(hx, hairY + Math.abs(i) * (r * 0.12), r * 0.26);
    }

    // --- Eyes -----------------------------------------------------------------
    const eyeY = bodyTop + r * 0.05;
    const eyeDX = r * 0.42;
    const eyeR = r * 0.28;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - eyeDX, eyeY, eyeR);
    g.fillCircle(cx + eyeDX, eyeY, eyeR);
    g.fillStyle(0x1a1a3a, 1);
    g.fillCircle(cx - eyeDX, eyeY, eyeR * 0.5);
    g.fillCircle(cx + eyeDX, eyeY, eyeR * 0.5);

    // --- Einstein mustache (white, under the eyes) ----------------------------
    g.fillStyle(0xffffff, 1);
    const mY = eyeY + r * 0.62;
    g.fillCircle(cx - r * 0.2, mY, r * 0.2);
    g.fillCircle(cx + r * 0.2, mY, r * 0.2);
    g.fillRect(cx - r * 0.2, mY - r * 0.14, r * 0.4, r * 0.24);

    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }
}
