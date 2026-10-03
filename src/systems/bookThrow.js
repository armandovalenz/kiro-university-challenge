// bookThrow — framework-agnostic hit-resolution helper for the Knowledge Power
// book projectile (FP3D_Mode).
//
// NO Phaser, NO Three.js imports — this is the pure, deterministic, testable
// seam the scene uses to decide WHICH ghost a thrown book hits. The renderer's
// parabolic arc is purely cosmetic over the tile path this computes.
//
// Given the player's tile + facing, `bookTilePath` returns the ordered list of
// tiles the book travels over: a straight line of tiles along the facing axis,
// starting at the tile immediately in front of the player, stopping at the
// first wall tile (exclusive) or when `maxRangeTiles` tiles have been covered
// or the grid bounds are left. `firstGhostOnPath` then picks the NEAREST ghost
// standing on that path.
//
// Feature: Knowledge Power — book projectile tile path + hit resolution.
// Properties:
//   BT-1 — every returned tile is in-bounds (never a wall, never off-grid).
//   BT-2 — the path stops at the first wall tile and never includes it.
//   BT-3 — the path length never exceeds maxRangeTiles.
//   BT-4 — every tile shares the facing axis (same row for E/W, same col for N/S)
//          and steps one tile at a time away from the player.

import { CARDINAL_TO_DIR } from './fp3d/fp3dLogic.js';

/**
 * Unit step (dcol, drow) for each cardinal facing, mirroring the 2D movement
 * convention: north = up (row-1), south = down (row+1), west = left (col-1),
 * east = right (col+1).
 * @type {Record<'north'|'east'|'south'|'west', { dcol: number, drow: number }>}
 */
const FACING_STEP = {
  north: { dcol: 0, drow: -1 },
  south: { dcol: 0, drow: 1 },
  west: { dcol: -1, drow: 0 },
  east: { dcol: 1, drow: 0 },
};

/**
 * Compute the ordered sequence of tiles a thrown book passes over.
 *
 * Starting from the tile directly in front of `from` in `facing`, the path
 * extends one tile at a time along the facing axis. It stops BEFORE the first
 * wall tile and before leaving the grid bounds, and never returns more than
 * `maxRangeTiles` tiles (BT-1..BT-4). The player's own tile is never included.
 *
 * @param {import('../maze/mazeLogic.js').MazeGrid} grid maze grid (wall/bounds truth)
 * @param {{ col: number, row: number }} from player's current tile
 * @param {'north'|'east'|'south'|'west'} facing current cardinal facing
 * @param {number} maxRangeTiles maximum number of tiles the book may cover
 * @returns {Array<{ col: number, row: number }>} ordered tiles (nearest first)
 */
export function bookTilePath(grid, from, facing, maxRangeTiles) {
  const step = FACING_STEP[facing];
  if (!grid || !from || !step) return [];

  // A non-positive / non-finite range yields an empty path.
  const range = Number.isFinite(maxRangeTiles) ? Math.trunc(maxRangeTiles) : 0;
  if (range <= 0) return [];

  const path = [];
  let col = from.col;
  let row = from.row;
  for (let i = 0; i < range; i++) {
    col += step.dcol;
    row += step.drow;
    // Leaving the grid or hitting a wall ends the path (the wall/out tile is
    // never included — BT-1, BT-2). Tunnel wrap is intentionally NOT applied:
    // a thrown book travels in a straight line and stops at the maze edge.
    if (!grid.inBounds(col, row) || grid.isWall(col, row)) break;
    path.push({ col, row });
  }
  return path;
}

/**
 * Find the nearest ghost standing on the book's tile path. Walks the path from
 * the player outward and returns the first ghost whose (col,row) matches a path
 * tile — so a ghost closer to the player is hit before one further away, and a
 * wall between them already truncated the path (handled by {@link bookTilePath}).
 *
 * @param {Array<{ col: number, row: number }>} path tiles from {@link bookTilePath}
 * @param {Array<{ col: number, row: number }>} ghosts ghost states (need col/row)
 * @returns {{ ghost: object, index: number }|null} the hit ghost + its path index, or null
 */
export function firstGhostOnPath(path, ghosts) {
  if (!Array.isArray(path) || !Array.isArray(ghosts)) return null;
  for (let i = 0; i < path.length; i++) {
    const tile = path[i];
    const ghost = ghosts.find((g) => g && g.col === tile.col && g.row === tile.row);
    if (ghost) return { ghost, index: i };
  }
  return null;
}

/**
 * Resolve a book throw against the ghosts in one call: compute the tile path and
 * return the nearest ghost on it (or null if the throw hits nothing). Pure and
 * deterministic — the scene applies the "send home" reset to the returned
 * ghost, and the renderer draws a cosmetic arc over `path`.
 *
 * @param {import('../maze/mazeLogic.js').MazeGrid} grid maze grid
 * @param {{ col: number, row: number }} from player's tile
 * @param {'north'|'east'|'south'|'west'} facing current facing
 * @param {Array<{ col: number, row: number }>} ghosts ghost states
 * @param {number} maxRangeTiles maximum tile range
 * @returns {{ path: Array<{col:number,row:number}>, hit: { ghost: object, index: number }|null }}
 */
export function resolveBookThrow(grid, from, facing, ghosts, maxRangeTiles) {
  const path = bookTilePath(grid, from, facing, maxRangeTiles);
  const hit = firstGhostOnPath(path, ghosts);
  return { path, hit };
}

// Referenced so the CARDINAL_TO_DIR import documents the shared facing↔dir
// convention this helper mirrors (north=up, etc.) without forking it.
void CARDINAL_TO_DIR;
