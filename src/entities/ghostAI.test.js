// Property-based tests for the pure ghost AI helpers (mandatory PBT — see
// .kiro/steering/testing.md).
//
// Owns Property 23 (ghosts never step into walls / never reverse unless boxed
// in) and Property 24 (optional monotonic difficulty scaling, exercised here
// because the config/AI helpers are pure). Tests use Vitest + fast-check and
// are named after the Core Property they validate, carrying the requirement
// trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  chooseGhostDirection,
  computeTargetTile,
  ghostSpeedForGrade,
  ghostSpeedMultiplier,
  OPPOSITE,
} from './ghostAI.js';
import { MazeGrid } from '../maze/mazeLogic.js';
import { GRADES } from '../config.js';

const grid = new MazeGrid();

/** Every in-bounds, non-wall tile a ghost could legitimately occupy. */
const walkableTiles = (() => {
  const tiles = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (!grid.isWall(col, row)) tiles.push({ col, row });
    }
  }
  return tiles;
})();

const tileArb = fc.constantFrom(...walkableTiles);
const dirArb = fc.constantFrom('left', 'right', 'up', 'down');
const maybeDirArb = fc.constantFrom('left', 'right', 'up', 'down', null);
const personalityArb = fc.constantFrom('chase', 'ambush', 'vector', 'scatter');

describe('ghostAI — Property 23: Ghosts never step into walls', () => {
  // **Validates: Requirements 3.1**
  // For any ghost centered on a tile, the chosen direction targets a non-wall,
  // non-reversing tile (reversing only when it is the sole legal move).
  it('the chosen direction always yields a legal (non-wall) step', () => {
    fc.assert(
      fc.property(tileArb, maybeDirArb, personalityArb, maybeDirArb, (ghostTile, currentDir, personality, mmDir) => {
        const target = computeTargetTile(personality, {
          mathManTile: { col: 14, row: 23 },
          mathManDir: mmDir,
          ghostTile,
          redGhostTile: { col: 13, row: 14 },
          scatterCorner: { col: grid.cols - 2, row: grid.rows - 2 },
        });

        const chosen = chooseGhostDirection(grid, ghostTile, currentDir, target);

        // From a walkable tile the ghost always has at least one legal move.
        expect(chosen).not.toBeNull();

        // The chosen direction is an actually-legal step (the grid moved).
        const step = grid.attemptMove(ghostTile.col, ghostTile.row, chosen);
        expect(step.moved).toBe(true);
        // The destination tile is not a wall.
        expect(grid.isWall(step.col, step.row)).toBe(false);
      }),
    );
  });

  it('never reverses when a non-reversing legal move exists', () => {
    fc.assert(
      fc.property(tileArb, dirArb, personalityArb, (ghostTile, currentDir, personality) => {
        const target = computeTargetTile(personality, {
          mathManTile: { col: 14, row: 23 },
          ghostTile,
          redGhostTile: { col: 13, row: 14 },
          scatterCorner: { col: 1, row: 1 },
        });

        // Count non-reversing legal moves available from this tile.
        const reverse = OPPOSITE[currentDir];
        const nonReversingLegal = ['up', 'left', 'down', 'right'].filter(
          (d) => d !== reverse && grid.attemptMove(ghostTile.col, ghostTile.row, d).moved,
        );

        const chosen = chooseGhostDirection(grid, ghostTile, currentDir, target);
        if (nonReversingLegal.length > 0) {
          // A non-reversing option existed, so the ghost must not have reversed.
          expect(chosen).not.toBe(reverse);
        }
      }),
    );
  });
});

describe('ghostAI — Property 24: Difficulty scaling is monotonic (optional)', () => {
  // **Validates: Requirements 3.6, 10.4**
  // For any two grades where the lower grade is easier, configured ghost speed
  // does not decrease as the grade increases. Optional because Req 3.6/10.4 use
  // "MAY"; exercised here since the helpers are pure.
  it('ghostSpeedForGrade is non-decreasing across ascending grades', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 400 }), (base) => {
        const sorted = [...GRADES].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i += 1) {
          const lower = ghostSpeedForGrade(sorted[i - 1], base);
          const higher = ghostSpeedForGrade(sorted[i], base);
          expect(higher).toBeGreaterThanOrEqual(lower);
        }
      }),
    );
  });

  it('the per-grade multiplier is non-decreasing and unknown grades scale by 1', () => {
    const sorted = [...GRADES].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(ghostSpeedMultiplier(sorted[i])).toBeGreaterThanOrEqual(ghostSpeedMultiplier(sorted[i - 1]));
    }
    // Unknown grades fall back to a neutral 1x multiplier.
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 100 }), (unknownGrade) => {
        if (GRADES.includes(unknownGrade)) return;
        expect(ghostSpeedMultiplier(unknownGrade)).toBe(1);
      }),
    );
  });
});
