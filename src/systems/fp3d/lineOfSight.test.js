// Property-based tests for the framework-agnostic FP3D line-of-sight logic
// (mandatory PBT — see .kiro/steering/testing.md). Uses Vitest + fast-check,
// runs at >= 100 cases, and carries the requirement trace on the property.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid } from '../../maze/mazeLogic.js';
import { getLevelLayout } from '../../maze/mazeData.js';
import { hasLineOfSight } from './lineOfSight.js';

/**
 * Independent reference supercover walk used to verify `hasLineOfSight`.
 * Yields every tile the straight segment between the two tile centers passes
 * through, EXCLUDING both endpoints — computed with a different formulation
 * than the implementation (fractional t-crossings) so the test does not merely
 * mirror the code under test. Deterministic and symmetric.
 * @returns {Array<{ col: number, row: number }>}
 */
function referenceSegmentTiles(fromCol, fromRow, toCol, toRow) {
  if (fromCol === toCol && fromRow === toRow) return [];

  const dCol = toCol - fromCol;
  const dRow = toRow - fromRow;
  const stepCol = Math.sign(dCol);
  const stepRow = Math.sign(dRow);
  const absCol = Math.abs(dCol);
  const absRow = Math.abs(dRow);

  const tiles = [];
  let col = fromCol;
  let row = fromRow;

  // Fractional distance (in [0,1]) to the next vertical / horizontal boundary.
  // Tile centers sit at half-integer offsets, so the first boundary is at 0.5
  // of a tile. tDeltaX/Y is the per-tile spacing between boundaries.
  const tDeltaCol = absCol === 0 ? Infinity : 1 / absCol;
  const tDeltaRow = absRow === 0 ? Infinity : 1 / absRow;
  let tMaxCol = absCol === 0 ? Infinity : 0.5 / absCol;
  let tMaxRow = absRow === 0 ? Infinity : 0.5 / absRow;

  const EPS = 1e-9;
  while (col !== toCol || row !== toRow) {
    if (Math.abs(tMaxCol - tMaxRow) < EPS) {
      // Exact corner: advance both axes (supercover).
      col += stepCol;
      row += stepRow;
      tMaxCol += tDeltaCol;
      tMaxRow += tDeltaRow;
    } else if (tMaxCol < tMaxRow) {
      col += stepCol;
      tMaxCol += tDeltaCol;
    } else {
      row += stepRow;
      tMaxRow += tDeltaRow;
    }

    if (col === toCol && row === toRow) break; // exclude target endpoint
    tiles.push({ col, row });
  }

  return tiles;
}

describe('lineOfSight — Property 6: Line-of-sight is wall-blocked and symmetric', () => {
  // Feature: first-person-3d-mode, Property 6: Line-of-sight is wall-blocked and symmetric — Validates: Requirements 3.7, 3.8
  it('is false when a wall lies on the straight segment, and is symmetric in its tile arguments', () => {
    const layout = getLevelLayout();
    const grid = new MazeGrid({ layout });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: grid.cols - 1 }),
        fc.integer({ min: 0, max: grid.rows - 1 }),
        fc.integer({ min: 0, max: grid.cols - 1 }),
        fc.integer({ min: 0, max: grid.rows - 1 }),
        (aCol, aRow, bCol, bRow) => {
          const los = hasLineOfSight(grid, aCol, aRow, bCol, bRow);

          // (a) Wall-blocking: independently walk the segment (endpoints
          // excluded); if any intermediate tile is a wall, LOS must be false.
          const between = referenceSegmentTiles(aCol, aRow, bCol, bRow);
          const wallBetween = between.some(({ col, row }) =>
            grid.isWall(col, row),
          );
          if (wallBetween) {
            expect(los).toBe(false);
          }

          // (b) Symmetry: swapping the two tiles yields the identical result.
          const reversed = hasLineOfSight(grid, bCol, bRow, aCol, aRow);
          expect(reversed).toBe(los);
        },
      ),
      { numRuns: 100 },
    );
  });
});
