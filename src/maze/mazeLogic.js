// Framework-agnostic maze grid logic for Math Man.
//
// NO Phaser imports — this module owns the pure grid/data logic (wall checks,
// tile<->world conversion, tunnel wrap, pellet tracking, level reset) so it can
// be unit- and property-tested without a Phaser runtime. `Maze.js` (the Phaser
// class) wraps a `MazeGrid` instance and mirrors its state onto sprites.
//
// The design's Correctness Properties map onto these helpers:
//   Property 5 (movement respects walls) -> isWall / canEnter / attemptMove
//   Property 6 (tile<->world round-trip) -> tileToWorld / worldToTile
//   Property 7 (eating a pellet)         -> pelletCount / eatPelletAt
//   Property 8 (clearing all pellets)    -> pelletCount / reset

import { TILE_SIZE, POINTS } from '../config.js';
import {
  TILE,
  WALL_CODES,
  PELLET_CODES,
  getLevelLayout,
  validateLayout,
} from './mazeData.js';

/** Stable string key for a tile coordinate (used in pellet sets/maps). */
export function tileKey(col, row) {
  return `${col},${row}`;
}

/**
 * Pure maze grid: interprets tile-code rows and answers movement, coordinate,
 * and pellet questions. Holds no rendering state.
 */
export class MazeGrid {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.layout] explicit tile-code rows (defaults to level 1)
   * @param {number} [opts.level=1] level used to pick the default layout
   * @param {number} [opts.tileSize=TILE_SIZE] pixel size of one tile
   */
  constructor({ layout, level = 1, tileSize = TILE_SIZE } = {}) {
    this.tileSize = tileSize;
    this.level = level;
    this._loadLayout(layout ?? getLevelLayout(level));
  }

  /** Parse a layout into grid metadata and the initial pellet set. */
  _loadLayout(layout) {
    const { cols, rows } = validateLayout(layout);
    this.cols = cols;
    this.rows = rows;
    this.grid = layout.slice();

    /** Tiles that started as pellets (for reset), keyed by "col,row" -> code. */
    this._initialPellets = new Map();
    /** Rows that contain a tunnel edge (enable horizontal wrap). */
    this.tunnelRows = new Set();
    /** Spawn points discovered while parsing. */
    this.mathManSpawn = null;
    this.ghostSpawns = [];
    this.fruitSpawns = [];

    for (let row = 0; row < rows; row++) {
      const line = layout[row];
      for (let col = 0; col < cols; col++) {
        const code = line[col];
        if (PELLET_CODES.has(code)) {
          this._initialPellets.set(tileKey(col, row), code);
        }
        switch (code) {
          case TILE.TUNNEL:
            this.tunnelRows.add(row);
            break;
          case TILE.MATH_MAN_SPAWN:
            if (!this.mathManSpawn) this.mathManSpawn = { col, row };
            break;
          case TILE.GHOST_SPAWN:
            this.ghostSpawns.push({ col, row });
            break;
          case TILE.FRUIT_SPAWN:
            this.fruitSpawns.push({ col, row });
            break;
          default:
            break;
        }
      }
    }

    /** Live pellets remaining this level, keyed by "col,row" -> code. */
    this.pellets = new Map(this._initialPellets);
  }

  // --- Bounds & walls ---------------------------------------------------------

  /** True when (col,row) is inside the grid. */
  inBounds(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /** Raw tile code at (col,row), or the wall code when out of bounds. */
  codeAt(col, row) {
    if (!this.inBounds(col, row)) return TILE.WALL;
    return this.grid[row][col];
  }

  /**
   * True when a tile blocks movement. Out-of-bounds counts as a wall unless the
   * row is a tunnel row (where entities wrap horizontally rather than hit a
   * wall). Validates Property 5.
   */
  isWall(col, row) {
    if (this.inBounds(col, row)) {
      return WALL_CODES.has(this.grid[row][col]);
    }
    // Off the left/right edge on a tunnel row is not a wall (it wraps).
    if ((col < 0 || col >= this.cols) && this.tunnelRows.has(row)) {
      return false;
    }
    return true;
  }

  /** Convenience inverse of {@link isWall}. */
  canEnter(col, row) {
    return !this.isWall(col, row);
  }

  /**
   * Attempt to move one tile from (col,row) in a direction. Returns the new
   * tile when the target is enterable, otherwise the original tile unchanged.
   * Directions: 'left' | 'right' | 'up' | 'down'. On a tunnel row, stepping off
   * an edge wraps to the opposite side. Validates Property 5.
   * @returns {{ col: number, row: number, moved: boolean }}
   */
  attemptMove(col, row, direction) {
    const delta = DIRECTIONS[direction];
    if (!delta) return { col, row, moved: false };

    let targetCol = col + delta.dx;
    const targetRow = row + delta.dy;

    // Horizontal tunnel wrap.
    if (this.tunnelRows.has(targetRow)) {
      if (targetCol < 0) targetCol = this.cols - 1;
      else if (targetCol >= this.cols) targetCol = 0;
    }

    if (this.canEnter(targetCol, targetRow)) {
      return { col: targetCol, row: targetRow, moved: true };
    }
    return { col, row, moved: false };
  }

  // --- Coordinate conversion --------------------------------------------------

  /**
   * Center-of-tile world coordinates for a tile. Validates Property 6 (with
   * {@link worldToTile}).
   * @returns {{ x: number, y: number }}
   */
  tileToWorld(col, row) {
    const half = this.tileSize / 2;
    return {
      x: col * this.tileSize + half,
      y: row * this.tileSize + half,
    };
  }

  /**
   * Tile containing a world coordinate. Round-trips with {@link tileToWorld}
   * for any tile center (Property 6).
   * @returns {{ col: number, row: number }}
   */
  worldToTile(x, y) {
    return {
      col: Math.floor(x / this.tileSize),
      row: Math.floor(y / this.tileSize),
    };
  }

  /** True when a world coordinate is within an epsilon of its tile center. */
  isTileCentered(x, y, epsilon = 1) {
    const { col, row } = this.worldToTile(x, y);
    const center = this.tileToWorld(col, row);
    return Math.abs(x - center.x) <= epsilon && Math.abs(y - center.y) <= epsilon;
  }

  // --- Tunnel wrap ------------------------------------------------------------

  /**
   * Pure horizontal wrap for a world x-coordinate given the maze width. Returns
   * the wrapped x. Used by {@link wrapIfTunnel}.
   */
  wrapX(x) {
    const width = this.cols * this.tileSize;
    if (x < 0) return x + width;
    if (x >= width) return x - width;
    return x;
  }

  /**
   * Wrap an object's world x when it is on a tunnel row and has crossed an
   * edge. Mutates and returns the given position-like object ({ x, y }); the
   * Phaser wrapper passes a sprite. Returns null-safe.
   */
  wrapIfTunnel(entity) {
    if (!entity) return entity;
    const { row } = this.worldToTile(entity.x, entity.y);
    if (this.tunnelRows.has(row)) {
      entity.x = this.wrapX(entity.x);
    }
    return entity;
  }

  // --- Pellets ----------------------------------------------------------------

  /** True when a live pellet remains at (col,row). */
  isPelletAt(col, row) {
    return this.pellets.has(tileKey(col, row));
  }

  /** Points a pellet of the given code is worth. */
  pointsFor(code) {
    return code === TILE.POWER_PELLET ? POINTS.powerPellet : POINTS.pellet;
  }

  /** Number of live pellets remaining this level. Validates Properties 7, 8. */
  pelletCount() {
    return this.pellets.size;
  }

  /**
   * Eat the pellet at (col,row). Removes exactly that pellet and returns the
   * points earned; returns 0 when no pellet is present. Validates Property 7.
   * @returns {number} points earned (0 when no pellet)
   */
  eatPelletAt(col, row) {
    const key = tileKey(col, row);
    const code = this.pellets.get(key);
    if (code === undefined) return 0;
    this.pellets.delete(key);
    return this.pointsFor(code);
  }

  /** True when every pellet has been eaten (level clear condition). */
  isLevelCleared() {
    return this.pellets.size === 0;
  }

  // --- Level reset ------------------------------------------------------------

  /**
   * Rebuild the pellet layer for the next level. Restores the full pellet set
   * (optionally swapping the layout for `level`) so the pellet count returns to
   * its starting value. Validates Property 8.
   * @param {number} [level] level to load; defaults to current level + 1
   */
  reset(level = this.level + 1) {
    this.level = level;
    const layout = getLevelLayout(level);
    // Reload in case a future level swaps the layout; also rebuilds pellets.
    this._loadLayout(layout);
    return this;
  }
}

/** Unit direction deltas in tile space. */
export const DIRECTIONS = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
};

/**
 * World coordinate of the next tile CENTER strictly ahead of `(x, y)` along
 * `direction`. This is the target a grid-locked mover advances toward each
 * step of the frame-rate-independent, budget-based movement loop.
 *
 * Correctness across refresh rates hinges on this being computed from the
 * entity's continuous position — NOT from `worldToTile` (which floors at tile
 * EDGES). A mover crossing an edge mid-tile would otherwise see its target jump
 * a full tile ahead and never actually land on a center. Here the reference
 * tile is chosen by ROUNDING each axis to the nearest center, then the moving
 * axis is snapped to that center while the travel axis advances exactly one
 * tile in `direction`. The perpendicular axis is returned snapped to its center
 * so movement stays grid-locked. Validates the grid-lock rule (Req 1.2, 1.3).
 *
 * @param {MazeGrid} grid
 * @param {number} x world x
 * @param {number} y world y
 * @param {'left'|'right'|'up'|'down'} direction
 * @returns {{ x: number, y: number }} world center of the tile one step ahead
 */
export function nextCenterAhead(grid, x, y, direction) {
  const d = DIRECTIONS[direction];
  const size = grid.tileSize;
  const half = size / 2;
  // Tile-center INDEX for a coordinate is `(coord - half) / size`; centers sit
  // at integer indices. The next center strictly ahead along the moving axis is
  // the adjacent integer index in the travel direction — using ceil-1 when
  // decreasing and floor+1 when increasing so that, when the entity sits
  // exactly on a center, the target correctly advances to the NEXT one (and
  // otherwise it targets the nearest center still ahead, which it can reach).
  const colIdx = (x - half) / size;
  const rowIdx = (y - half) / size;

  let targetCol;
  let targetRow;
  if (d.dx < 0) {
    targetCol = Math.ceil(colIdx) - 1; // moving left (x decreasing)
    targetRow = Math.round(rowIdx);
  } else if (d.dx > 0) {
    targetCol = Math.floor(colIdx) + 1; // moving right (x increasing)
    targetRow = Math.round(rowIdx);
  } else if (d.dy < 0) {
    targetRow = Math.ceil(rowIdx) - 1; // moving up (y decreasing)
    targetCol = Math.round(colIdx);
  } else {
    targetRow = Math.floor(rowIdx) + 1; // moving down (y increasing)
    targetCol = Math.round(colIdx);
  }

  return {
    x: targetCol * size + half,
    y: targetRow * size + half,
  };
}
