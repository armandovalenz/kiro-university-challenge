// Framework-agnostic ghost AI helpers for the Einstein ghosts.
//
// NO Phaser imports — this module owns the pure decision logic (target-tile
// selection per personality, legal non-reversing direction choice, and
// per-grade speed scaling) so it can be unit- and property-tested without a
// Phaser runtime. `Ghost.js` (the Phaser sprite) gathers plain data from the
// scene and delegates here.
//
// The design's Correctness Properties map onto these helpers:
//   Property 23 (ghosts never step into walls / reverse) -> chooseGhostDirection
//   Property 24 (difficulty scaling monotonic, optional)  -> ghostSpeedForGrade
//
// A "grid" argument here is any object exposing the pure MazeGrid interface
// (`attemptMove`, `isWall`, `cols`, `rows`) — MazeGrid itself is framework
// agnostic, so tests can pass a real grid without Phaser.

import { SPEEDS } from '../config.js';
import { DIRECTIONS as DIR_DELTAS } from '../maze/mazeLogic.js';

/** Opposite heading for each direction (used to forbid reversing). */
export const OPPOSITE = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
};

/**
 * Candidate evaluation order. Classic Pac-Man tie-break priority is
 * up > left > down > right, so equal-distance options resolve deterministically.
 */
export const DIRECTION_PRIORITY = ['up', 'left', 'down', 'right'];

/** Tiles ahead of Math Man the "ambush" (pink) ghost aims for. */
export const AHEAD_TILES = 4;

/** Pivot distance ahead of Math Man used by the "vector" (cyan) ghost. */
export const CYAN_PIVOT_TILES = 2;

/**
 * Distance (in tiles) at/under which the "scatter" (orange) ghost retreats to
 * its home corner instead of chasing.
 */
export const ORANGE_SCATTER_DISTANCE = 8;

/**
 * Explicit ghost-house bounds matching `mazeData.js`:
 *   - interior + walls span cols 11–16, rows 12–16,
 *   - the door sits at row 12 (cols 13–14) and opens UP to row 11.
 * Used as a fallback when a house cannot be derived from the grid. See
 * {@link houseRegionFromGrid}.
 */
export const GHOST_HOUSE = { minCol: 11, maxCol: 16, minRow: 12, maxRow: 16 };

/** The tile just above the ghost-house door (the exit target). */
export const GHOST_HOUSE_EXIT = { col: 13, row: 11 };

/** Column of the ghost-house door (center of the door opening). */
export const GHOST_HOUSE_DOOR_COL = 13;

/**
 * Derive the ghost-house region from a grid's `ghostSpawns`: the bounding box
 * of the spawn tiles, expanded outward by one tile to enclose the surrounding
 * interior walls, and extended up by one row to include the door row above the
 * top spawn row. Falls back to {@link GHOST_HOUSE} when spawns are unavailable.
 *
 * The returned region describes the house interior + door rows; the tile the
 * ghost aims for on the way out lies one row ABOVE `minRow` (see
 * {@link ghostHouseExitTile}).
 *
 * @param {{ghostSpawns?: Array<{col:number,row:number}>}} grid
 * @returns {{minCol:number,maxCol:number,minRow:number,maxRow:number}}
 */
export function houseRegionFromGrid(grid) {
  const spawns = grid && Array.isArray(grid.ghostSpawns) ? grid.ghostSpawns : [];
  if (spawns.length === 0) return { ...GHOST_HOUSE };

  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const { col, row } of spawns) {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }

  // Expand outward by one tile to include the enclosing interior walls, and up
  // one extra row to cover the door row above the top spawn row.
  return {
    minCol: minCol - 1,
    maxCol: maxCol + 1,
    minRow: minRow - 1,
    maxRow: maxRow + 1,
  };
}

/**
 * True when (col,row) lies inside the ghost-house region (inclusive bounds).
 * @param {{minCol:number,maxCol:number,minRow:number,maxRow:number}} house
 * @param {number} col
 * @param {number} row
 * @returns {boolean}
 */
export function isHouseTile(house, col, row) {
  if (!house) return false;
  return (
    col >= house.minCol &&
    col <= house.maxCol &&
    row >= house.minRow &&
    row <= house.maxRow
  );
}

/**
 * The tile a ghost aims for to leave the house: one row above the house top
 * (the door row), at the door column. This is outside the house region, so a
 * ghost targeting it will path UP through the door and out into the maze.
 * @param {{minCol:number,maxCol:number,minRow:number,maxRow:number}} house
 * @returns {{col:number,row:number}}
 */
export function ghostHouseExitTile(house) {
  if (!house) return { ...GHOST_HOUSE_EXIT };
  return { col: GHOST_HOUSE_DOOR_COL, row: house.minRow - 1 };
}

/**
 * Build a movement grid *view* that forbids re-entry into the ghost house for a
 * ghost that has already exited. It delegates every method to the real grid but
 * reports a move as blocked (`moved:false`, position unchanged) when the step
 * would land on a house tile. `chooseGhostDirection` only needs `attemptMove`
 * (plus `cols`/`rows` passthrough), so the view is intentionally minimal.
 *
 * This prevents the exited ghost from pathing back through the door toward Math
 * Man and ping-ponging at the doorway.
 *
 * @param {{attemptMove:Function, cols?:number, rows?:number}} grid real grid
 * @param {{minCol:number,maxCol:number,minRow:number,maxRow:number}} house
 * @returns {{attemptMove:Function, cols:number, rows:number}}
 */
export function blockHouseReentry(grid, house) {
  return {
    cols: grid.cols,
    rows: grid.rows,
    attemptMove(col, row, direction) {
      const step = grid.attemptMove(col, row, direction);
      if (step.moved && isHouseTile(house, step.col, step.row)) {
        return { col, row, moved: false };
      }
      return step;
    },
  };
}

/**
 * Squared Euclidean distance between two tiles. Squared (not rooted) is enough
 * for comparisons and avoids needless `sqrt`.
 * @param {{col:number,row:number}} a
 * @param {{col:number,row:number}} b
 */
export function tileDistanceSq(a, b) {
  const dc = a.col - b.col;
  const dr = a.row - b.row;
  return dc * dc + dr * dr;
}

/**
 * Project a tile forward from Math Man's facing direction.
 * @param {{col:number,row:number}} tile origin tile
 * @param {?('left'|'right'|'up'|'down')} direction facing (null → no offset)
 * @param {number} tiles how many tiles ahead
 * @returns {{col:number,row:number}}
 */
export function tileAhead(tile, direction, tiles) {
  const d = DIR_DELTAS[direction];
  if (!d) return { col: tile.col, row: tile.row };
  return { col: tile.col + d.dx * tiles, row: tile.row + d.dy * tiles };
}

/**
 * Compute a ghost's current target tile from its personality and plain-data
 * context. Pure: no Phaser, no mutation. Personalities mirror the classic
 * quartet (see design "Ghost (Einstein)"):
 *   - 'chase'   (red)    → Math Man's tile directly.
 *   - 'ambush'  (pink)   → a few tiles ahead of Math Man's facing.
 *   - 'vector'  (cyan)   → pivot ahead of Math Man, doubled away from red ghost.
 *   - 'scatter' (orange) → chase when far, retreat to home corner when close.
 *
 * @param {string} personality one of 'chase' | 'ambush' | 'vector' | 'scatter'
 * @param {object} ctx
 * @param {{col:number,row:number}} ctx.mathManTile
 * @param {?('left'|'right'|'up'|'down')} [ctx.mathManDir]
 * @param {{col:number,row:number}} [ctx.ghostTile] this ghost's tile (scatter)
 * @param {{col:number,row:number}} [ctx.redGhostTile] red ghost tile (vector)
 * @param {{col:number,row:number}} [ctx.scatterCorner] this ghost's home corner
 * @returns {{col:number,row:number}} target tile (may be out of bounds; the
 *          direction chooser only ever steps onto in-bounds, non-wall tiles)
 */
export function computeTargetTile(personality, ctx = {}) {
  const {
    mathManTile,
    mathManDir = null,
    ghostTile,
    redGhostTile,
    scatterCorner,
  } = ctx;

  const pac = mathManTile || { col: 0, row: 0 };

  switch (personality) {
    case 'ambush': {
      return tileAhead(pac, mathManDir, AHEAD_TILES);
    }
    case 'vector': {
      // Pivot two tiles ahead of Math Man, then double the vector from the red
      // ghost through that pivot (classic "Inky" targeting).
      const pivot = tileAhead(pac, mathManDir, CYAN_PIVOT_TILES);
      const red = redGhostTile || pac;
      return {
        col: pivot.col + (pivot.col - red.col),
        row: pivot.row + (pivot.row - red.row),
      };
    }
    case 'scatter': {
      const home = scatterCorner || { col: 0, row: 0 };
      if (ghostTile) {
        const far = tileDistanceSq(ghostTile, pac) > ORANGE_SCATTER_DISTANCE * ORANGE_SCATTER_DISTANCE;
        return far ? { col: pac.col, row: pac.row } : home;
      }
      return { col: pac.col, row: pac.row };
    }
    case 'chase':
    default:
      return { col: pac.col, row: pac.row };
  }
}

/**
 * Choose the ghost's next heading at a tile center: the legal (non-wall,
 * in-bounds/tunnel-aware) direction that does NOT reverse the current heading
 * and minimizes distance to the target tile. Reversing is allowed ONLY when no
 * other legal move exists (dead-end); if fully boxed in, returns null.
 *
 * Legality is delegated to `grid.attemptMove`, which already accounts for walls,
 * bounds, and tunnel wrap — so any direction it reports as `moved` is a valid
 * step. This is the invariant exercised by Property 23.
 *
 * @param {{attemptMove: Function}} grid pure maze grid (MazeGrid-compatible)
 * @param {{col:number,row:number}} ghostTile ghost's current tile
 * @param {?('left'|'right'|'up'|'down')} currentDirection heading (null on spawn)
 * @param {{col:number,row:number}} targetTile tile to move toward
 * @returns {?('left'|'right'|'up'|'down')} chosen direction, or null if stuck
 */
export function chooseGhostDirection(grid, ghostTile, currentDirection, targetTile) {
  if (!grid || typeof grid.attemptMove !== 'function') return null;
  const reverse = OPPOSITE[currentDirection] || null;
  const target = targetTile || ghostTile;

  let best = null;
  let bestDist = Infinity;
  let reverseOption = null;

  for (const dir of DIRECTION_PRIORITY) {
    const step = grid.attemptMove(ghostTile.col, ghostTile.row, dir);
    if (!step.moved) continue; // wall / out of bounds → not a legal step

    if (dir === reverse) {
      // Remember the reverse move only as a last resort.
      if (reverseOption === null) reverseOption = dir;
      continue;
    }

    const dist = tileDistanceSq({ col: step.col, row: step.row }, target);
    // Strict `<` preserves the priority order on ties.
    if (dist < bestDist) {
      bestDist = dist;
      best = dir;
    }
  }

  if (best !== null) return best;
  // Dead-end: reversing is the only legal move.
  return reverseOption;
}

/**
 * Per-grade ghost speed multiplier (Req 3.6, 10.4). Unknown grades scale by 1.
 * @param {number} grade selected grade (5/6/7)
 * @returns {number} multiplier
 */
export function ghostSpeedMultiplier(grade) {
  const byGrade = SPEEDS.ghostByGrade || {};
  const mult = byGrade[grade];
  return typeof mult === 'number' ? mult : 1;
}

/**
 * Scale a base ghost speed by the selected grade. Monotonic in grade for the
 * configured multipliers (Property 24).
 * @param {number} grade selected grade (5/6/7)
 * @param {number} [baseSpeed] base pixels/second (defaults to config SPEEDS.ghost)
 * @returns {number} scaled speed (pixels/second)
 */
export function ghostSpeedForGrade(grade, baseSpeed = SPEEDS.ghost) {
  return baseSpeed * ghostSpeedMultiplier(grade);
}
