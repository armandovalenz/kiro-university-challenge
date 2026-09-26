// Framework-agnostic first-person 3D (FP3D_Mode) coordinate logic.
//
// NO Phaser and NO Three.js imports (Req 9.1) — this module owns the pure
// tile <-> world math the first-person renderer/controller needs, so it stays
// unit- and property-testable without a WebGL or Phaser runtime. It imports
// only the shared maze data/logic and config; all tile-size/grid questions are
// delegated to the passed `MazeGrid` instance (single source of maze truth).
//
// Coordinate convention: the 3D world maps X -> east (columns), Z -> south
// (rows), Y -> up. This mirrors the existing 2D `MazeGrid.worldToTile`
// (flooring by tile size) so the tile -> world3D -> tile round-trip holds for
// every tile center (design "Correctness Properties", Property 1).

// eslint-disable-next-line no-unused-vars -- imported for type/JSDoc reference only
import { MazeGrid } from '../../maze/mazeLogic.js';

/**
 * Cardinal facings in clockwise order (north, east, south, west). Turning right
 * advances one step in this array; turning left steps back one.
 * @type {readonly ['north','east','south','west']}
 */
export const CARDINALS = ['north', 'east', 'south', 'west'];

/**
 * Map an FP3D cardinal facing to the 2D `MazeGrid` movement direction so
 * movement resolution can reuse `MazeGrid.attemptMove` without forking logic.
 * North (toward smaller rows) is 'up', south is 'down', west is 'left', east
 * is 'right'.
 */
export const CARDINAL_TO_DIR = {
  north: 'up',
  south: 'down',
  west: 'left',
  east: 'right',
};

/**
 * Floor-center world coordinates for a tile in the 3D world. Mirrors
 * `MazeGrid.tileToWorld` on the X/Z plane so the round-trip with
 * {@link worldToTile3D} recovers the original tile (Property 1).
 * @param {MazeGrid} grid maze grid (owns tile size)
 * @param {number} col tile column
 * @param {number} row tile row
 * @returns {{ x: number, z: number }} floor-center world coordinates
 */
export function tileToWorld3D(grid, col, row) {
  const half = grid.tileSize / 2;
  return {
    x: col * grid.tileSize + half,
    z: row * grid.tileSize + half,
  };
}

/**
 * Tile containing a 3D world coordinate. Floors each axis by the grid's tile
 * size, matching `MazeGrid.worldToTile`, so it round-trips with
 * {@link tileToWorld3D} for any tile center (Property 1).
 * @param {MazeGrid} grid maze grid (owns tile size)
 * @param {number} x world x (east)
 * @param {number} z world z (south)
 * @returns {{ col: number, row: number }} tile coordinates
 */
export function worldToTile3D(grid, x, z) {
  return {
    col: Math.floor(x / grid.tileSize),
    row: Math.floor(z / grid.tileSize),
  };
}

/**
 * Camera anchor (eye) position for a player standing on a tile: the tile's
 * floor center on the X/Z plane, raised to `eyeHeight` on the Y axis (Req 2.1).
 * @param {MazeGrid} grid maze grid (owns tile size)
 * @param {number} col tile column
 * @param {number} row tile row
 * @param {number} eyeHeight camera height above the floor
 * @returns {{ x: number, y: number, z: number }} eye position
 */
export function eyePosition(grid, col, row, eyeHeight) {
  const { x, z } = tileToWorld3D(grid, col, row);
  return { x, y: eyeHeight, z };
}

// --- Movement resolution ------------------------------------------------------

/**
 * Resolve one grid-locked step from (col,row) in the current `facing`, reusing
 * `MazeGrid.attemptMove` so first-person movement never forks the 2D wall/tunnel
 * rules. Returns the grid's `{ col, row, moved }` verbatim: an enterable target
 * yields that neighbor with `moved: true`; a wall or out-of-bounds target on a
 * non-tunnel row yields the unchanged start tile with `moved: false` (Req 2.2,
 * 2.3). Validates Property 2.
 * @param {MazeGrid} grid maze grid (owns wall/tunnel truth)
 * @param {number} col start column
 * @param {number} row start row
 * @param {'north'|'east'|'south'|'west'} facing current cardinal facing
 * @returns {{ col: number, row: number, moved: boolean }}
 */
export function resolveMove(grid, col, row, facing) {
  return grid.attemptMove(col, row, CARDINAL_TO_DIR[facing]);
}

// --- Facing resolution --------------------------------------------------------

/**
 * Normalize a facing to a valid `CARDINALS` member. Any value outside the four
 * cardinals (including undefined) falls back to `'north'` so callers always get
 * exactly one cardinal (Req 2.4). Validates Property 3.
 * @param {*} facing candidate facing
 * @returns {'north'|'east'|'south'|'west'}
 */
export function setFacing(facing = 'north') {
  return CARDINALS.includes(facing) ? facing : 'north';
}

/**
 * Turn clockwise (right) by one cardinal step: north -> east -> south -> west ->
 * north. Invalid input is normalized to `'north'` first, so the result is always
 * exactly one `CARDINALS` member (Req 2.4). Validates Property 3.
 * @param {'north'|'east'|'south'|'west'} facing current facing
 * @returns {'north'|'east'|'south'|'west'}
 */
export function turnRight(facing) {
  const idx = CARDINALS.indexOf(setFacing(facing));
  return CARDINALS[(idx + 1) % CARDINALS.length];
}

/**
 * Turn counter-clockwise (left) by one cardinal step: north -> west -> south ->
 * east -> north. Invalid input is normalized to `'north'` first, so the result
 * is always exactly one `CARDINALS` member (Req 2.4). Validates Property 3.
 * @param {'north'|'east'|'south'|'west'} facing current facing
 * @returns {'north'|'east'|'south'|'west'}
 */
export function turnLeft(facing) {
  const idx = CARDINALS.indexOf(setFacing(facing));
  // + length keeps the modulo non-negative when idx is 0.
  return CARDINALS[(idx - 1 + CARDINALS.length) % CARDINALS.length];
}

// --- Input buffering ----------------------------------------------------------

/**
 * At-most-one input buffer for first-person move/turn intents (Req 2.7).
 *
 * During a single tile traversal the player may fire several intents; only the
 * MOST RECENT one is worth acting on when the mover reaches the next tile
 * center, so the buffer retains exactly one pending intent. Each `push` replaces
 * any prior pending intent (extras are dropped, latest wins), `take` returns and
 * clears it, and `size` is always 0 or 1. Validates Property 5.
 */
export class InputBuffer {
  constructor() {
    /** The single pending intent, or null when empty. @type {*} */
    this._intent = null;
  }

  /**
   * Store an intent, dropping any previously buffered one (keep-latest). A
   * null/undefined intent clears the buffer.
   * @param {*} intent the intent to retain (e.g. a facing or turn command)
   */
  push(intent) {
    this._intent = intent ?? null;
  }

  /**
   * Return and clear the single pending intent, or null when the buffer is
   * empty.
   * @returns {*} the retained intent, or null
   */
  take() {
    const intent = this._intent;
    this._intent = null;
    return intent;
  }

  /** Number of buffered intents: always 0 or 1. @returns {0|1} */
  get size() {
    return this._intent === null ? 0 : 1;
  }
}

// --- Tunnel-wrap resolution ---------------------------------------------------

/**
 * Resolve a horizontal tunnel wrap for a first-person player, mirroring the 2D
 * `MazeGrid.attemptMove` / `wrapIfTunnel` rule in tile space so the two modes
 * never diverge (Req 2.5, 9.1). Validates Property 4.
 *
 * Contract:
 * - Only a WEST or EAST step can leave the horizontal bounds; on a tunnel row
 *   (`grid.tunnelRows.has(row)`) such a step wraps to the opposite in-bounds
 *   edge — off the LEFT edge (west, `col === 0`) wraps to `grid.cols - 1`; off
 *   the RIGHT edge (east, `col === grid.cols - 1`) wraps to `0`. This matches
 *   `MazeGrid.attemptMove`, which maps `targetCol < 0 -> cols - 1` and
 *   `targetCol >= cols -> 0` on a tunnel row.
 * - The entry `row` and the entry `facing` are preserved.
 * - Any position/facing that does NOT step off a horizontal edge — a non-tunnel
 *   row, a north/south facing, or a west/east step that stays in bounds — is
 *   returned unchanged (`{ col, row, facing }` verbatim). Callers use
 *   {@link resolveMove} for the ordinary in-bounds case; `resolveTunnel` only
 *   rewrites the column when a genuine edge wrap occurs.
 *
 * @param {MazeGrid} grid maze grid (owns tunnel rows / column count)
 * @param {number} col start column
 * @param {number} row start row
 * @param {'north'|'east'|'south'|'west'} facing current cardinal facing
 * @returns {{ col: number, row: number, facing: 'north'|'east'|'south'|'west' }}
 */
export function resolveTunnel(grid, col, row, facing) {
  // Not a tunnel row -> no wrap possible; return unchanged.
  if (!grid.tunnelRows.has(row)) {
    return { col, row, facing };
  }

  // Only a horizontal step can leave the left/right bounds.
  const dir = CARDINAL_TO_DIR[facing];
  if (dir === 'left' && col === 0) {
    // Stepping off the left edge wraps to the rightmost in-bounds column.
    return { col: grid.cols - 1, row, facing };
  }
  if (dir === 'right' && col === grid.cols - 1) {
    // Stepping off the right edge wraps to the leftmost in-bounds column.
    return { col: 0, row, facing };
  }

  // Vertical step, or a horizontal step that stays in bounds: no wrap.
  return { col, row, facing };
}
