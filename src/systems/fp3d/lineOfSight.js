// Framework-agnostic first-person 3D (FP3D_Mode) grid line-of-sight logic.
//
// NO Phaser and NO Three.js imports (Req 9.1) — this module owns the pure
// tile-space visibility rule the first-person renderer uses to decide whether a
// ghost is visible (Req 3.7, 3.8). Three.js raycasting is deliberately NOT used
// for gameplay visibility (design "lineOfSight" note); this cheap grid walk is.
//
// All wall/grid questions are delegated to the passed `MazeGrid` instance
// (single source of maze truth) via `grid.isWall(col, row)`.

// eslint-disable-next-line no-unused-vars -- imported for type/JSDoc reference only
import { MazeGrid } from '../../maze/mazeLogic.js';
import { CARDINAL_TO_DIR } from './fp3dLogic.js';

/**
 * Unit direction vector (in tile space) for a cardinal facing. North faces
 * toward smaller rows (-row), south toward larger rows (+row), west toward
 * smaller columns (-col), east toward larger columns (+col). Matches the 2D
 * `DIRECTIONS` deltas via `CARDINAL_TO_DIR`.
 * @param {'north'|'east'|'south'|'west'} facing
 * @returns {{ dCol: number, dRow: number }}
 */
function facingVector(facing) {
  switch (facing) {
    case 'north':
      return { dCol: 0, dRow: -1 };
    case 'south':
      return { dCol: 0, dRow: 1 };
    case 'west':
      return { dCol: -1, dRow: 0 };
    case 'east':
      return { dCol: 1, dRow: 0 };
    default:
      // Guard: unknown facings fall back to north so callers always get a
      // deterministic vector (mirrors fp3dLogic.setFacing's default).
      void CARDINAL_TO_DIR;
      return { dCol: 0, dRow: -1 };
  }
}

/**
 * True when NO wall tile lies on the straight grid segment between the two
 * tiles, i.e. the two tiles can "see" each other (Req 3.7, 3.8). Validates
 * Property 6.
 *
 * Implementation: a pure supercover grid walk (an amanatides/woo-style DDA that
 * visits EVERY tile the straight segment passes through, including tiles the
 * line merely grazes at a corner) between the two tile CENTERS. The two
 * endpoints (`from` and `to`) are EXCLUDED — a wall on the source or target
 * tile does not block the sight line; only walls strictly between them do. A
 * wall on any intermediate tile makes the result false.
 *
 * The walk is symmetric in its tile arguments: swapping (from, to) traverses
 * the identical set of intermediate tiles, so the boolean result is unchanged.
 *
 * @param {MazeGrid} grid maze grid (owns wall truth via `isWall`)
 * @param {number} fromCol source column
 * @param {number} fromRow source row
 * @param {number} toCol target column
 * @param {number} toRow target row
 * @returns {boolean} true when no wall lies strictly between the tiles
 */
export function hasLineOfSight(grid, fromCol, fromRow, toCol, toRow) {
  // Same tile: nothing between them, trivially visible.
  if (fromCol === toCol && fromRow === toRow) return true;

  for (const { col, row } of segmentTiles(fromCol, fromRow, toCol, toRow)) {
    if (grid.isWall(col, row)) return false;
  }
  return true;
}

/**
 * Yield every tile strictly between (fromCol,fromRow) and (toCol,toRow) that
 * the straight segment through their centers passes through — a supercover
 * walk with the two endpoints excluded. Deterministic and symmetric: the set of
 * tiles produced for (a -> b) is identical to that for (b -> a).
 *
 * The algorithm steps a unit-square DDA over the segment. At each grid boundary
 * crossing it advances the axis whose next crossing is nearer; when both
 * crossings coincide (the line passes exactly through a lattice corner) it
 * advances BOTH axes in a single step so no diagonally-adjacent wall is skipped
 * (true supercover behavior). Endpoints are not yielded.
 *
 * @param {number} fromCol
 * @param {number} fromRow
 * @param {number} toCol
 * @param {number} toRow
 * @returns {Array<{ col: number, row: number }>}
 */
function segmentTiles(fromCol, fromRow, toCol, toRow) {
  const tiles = [];

  const dCol = toCol - fromCol;
  const dRow = toRow - fromRow;
  const stepCol = Math.sign(dCol);
  const stepRow = Math.sign(dRow);
  const absCol = Math.abs(dCol);
  const absRow = Math.abs(dRow);

  // Pure horizontal / vertical / (already handled) same-tile lines: walk the
  // single moving axis, excluding both endpoints.
  if (dCol === 0 || dRow === 0) {
    let col = fromCol;
    let row = fromRow;
    while (col !== toCol || row !== toRow) {
      col += stepCol;
      row += stepRow;
      if (col === toCol && row === toRow) break; // exclude target endpoint
      tiles.push({ col, row });
    }
    return tiles;
  }

  // Diagonal (both axes move): DDA using integer error accumulation so the walk
  // is exact and symmetric. We track how far along each axis we've advanced and
  // compare cross-multiplied progress to decide the next boundary crossing.
  let col = fromCol;
  let row = fromRow;
  let nCol = 0; // columns advanced so far
  let nRow = 0; // rows advanced so far

  // Total boundary crossings = absCol + absRow; a coincident-corner crossing
  // consumes one of each. Loop until we reach the target tile.
  while (col !== toCol || row !== toRow) {
    // Next column boundary is at fractional distance (nCol + 0.5)/absCol along
    // the segment (tile centers sit at half-integer positions); likewise for
    // rows. Compare via cross-multiplication to avoid floating point.
    //   colSideDist ~ (2*nCol + 1) * absRow
    //   rowSideDist ~ (2*nRow + 1) * absCol
    const colSide = (2 * nCol + 1) * absRow;
    const rowSide = (2 * nRow + 1) * absCol;

    if (colSide < rowSide) {
      // Cross a vertical boundary first: step in column.
      col += stepCol;
      nCol += 1;
    } else if (rowSide < colSide) {
      // Cross a horizontal boundary first: step in row.
      row += stepRow;
      nRow += 1;
    } else {
      // Exact lattice corner: advance BOTH axes together (supercover) so a wall
      // touching the corner is still counted.
      col += stepCol;
      row += stepRow;
      nCol += 1;
      nRow += 1;
    }

    if (col === toCol && row === toRow) break; // exclude target endpoint
    tiles.push({ col, row });
  }

  return tiles;
}

/**
 * True when a ghost should be visible to the player in first-person: it has an
 * unobstructed line of sight AND lies within the player's field of view
 * (Req 3.7, 3.8). A ghost on the SAME tile as the player is always visible.
 *
 * The FOV test compares the angle between the player's `facing` direction
 * vector and the player -> ghost vector; the ghost is included when that angle
 * is within `fovDegrees / 2` (half-angle to either side of the look
 * direction). North = toward -row, south = +row, west = -col, east = +col.
 *
 * @param {MazeGrid} grid maze grid (owns wall truth)
 * @param {{ col: number, row: number }} player player tile
 * @param {'north'|'east'|'south'|'west'} facing player's cardinal facing
 * @param {{ col: number, row: number }} ghost ghost tile
 * @param {number} fovDegrees full field-of-view angle in degrees
 * @returns {boolean}
 */
export function isGhostVisible(grid, player, facing, ghost, fovDegrees) {
  // Same tile: always visible regardless of facing (Req 3.7 note).
  if (player.col === ghost.col && player.row === ghost.row) return true;

  // Blocked by a wall between the two tiles -> not visible.
  if (!hasLineOfSight(grid, player.col, player.row, ghost.col, ghost.row)) {
    return false;
  }

  // Field-of-view test: angle between facing and the player -> ghost vector.
  const { dCol: fCol, dRow: fRow } = facingVector(facing);
  const vCol = ghost.col - player.col;
  const vRow = ghost.row - player.row;
  const vLen = Math.hypot(vCol, vRow);
  if (vLen === 0) return true; // guarded above, but keep safe

  // facing vector is a unit vector, so dot / |v| = cos(angle).
  const cosAngle = (fCol * vCol + fRow * vRow) / vLen;
  // Clamp to [-1, 1] to avoid NaN from floating point before acos.
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  const angleDeg = (Math.acos(clamped) * 180) / Math.PI;

  return angleDeg <= fovDegrees / 2;
}
