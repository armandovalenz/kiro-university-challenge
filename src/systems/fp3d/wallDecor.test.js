// Property-based tests for framework-agnostic wall-decoration placement
// (mandatory PBT — see .kiro/steering/testing.md). Covers portraits and torches.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid } from '../../maze/mazeLogic.js';
import {
  wallFaces, seededRandom, pickSpacedFaces, wallKey,
} from './wallDecor.js';

/** Minimal grid-like object from a boolean wall matrix. */
const fakeGrid = (cells) => {
  const rows = cells.length;
  const cols = cells[0].length;
  const inBounds = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
  return { cols, rows, inBounds, isWall: (c, r) => !inBounds(c, r) || cells[r][c] };
};

const wallMatrix = fc.integer({ min: 2, max: 14 }).chain((cols) =>
  fc.array(fc.array(fc.boolean(), { minLength: cols, maxLength: cols }), { minLength: 2, maxLength: 14 }));

describe('wallFaces — every face is a wall tile facing an open neighbour', () => {
  it('faces are wall→open pairs whose yaw turns +Z onto the outward normal', () => {
    fc.assert(
      fc.property(wallMatrix, (cells) => {
        const grid = fakeGrid(cells);
        for (const f of wallFaces(grid)) {
          expect(grid.isWall(f.col, f.row)).toBe(true);
          expect(grid.inBounds(f.ncol, f.nrow)).toBe(true);
          expect(grid.isWall(f.ncol, f.nrow)).toBe(false);
          expect(f.ncol - f.col).toBe(f.n.nx);
          expect(f.nrow - f.row).toBe(f.n.nz);
          expect(Math.sin(f.n.yaw)).toBeCloseTo(f.n.nx, 12);
          expect(Math.cos(f.n.yaw)).toBeCloseTo(f.n.nz, 12);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('finds every wall→open adjacency on the real maze (no face missed)', () => {
    const grid = new MazeGrid();
    let expected = 0;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (!grid.isWall(c, r)) continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
          if (grid.inBounds(c + dx, r + dy) && !grid.isWall(c + dx, r + dy)) expected++;
        }
      }
    }
    expect(wallFaces(grid).length).toBe(expected);
  });
});

describe('seededRandom — deterministic floats in [0, 1)', () => {
  it('same seed gives the same sequence, all in range', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = seededRandom(seed);
        const b = seededRandom(seed);
        for (let i = 0; i < 50; i++) {
          const x = a();
          expect(x).toBe(b());
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('pickSpacedFaces — spaced, non-excluded, one per wall tile, deterministic', () => {
  it('kept faces respect exclusion, spacing and one-per-tile', () => {
    const grid = new MazeGrid();
    const faces = wallFaces(grid);
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 8 }),
        fc.subarray(faces.map((f) => wallKey(f.col, f.row)), { maxLength: 40 }),
        (seed, every, minSpacing, excluded) => {
          const excludeWalls = new Set(excluded);
          const opts = { every, minSpacing, excludeWalls };
          const kept = pickSpacedFaces(faces, { ...opts, rand: seededRandom(seed) });

          const keys = kept.map((f) => wallKey(f.col, f.row));
          expect(new Set(keys).size).toBe(keys.length);
          for (const k of keys) expect(excludeWalls.has(k)).toBe(false);
          for (const f of kept) expect(faces).toContain(f);
          for (let i = 0; i < kept.length; i++) {
            for (let j = i + 1; j < kept.length; j++) {
              const d = Math.abs(kept[i].ncol - kept[j].ncol) + Math.abs(kept[i].nrow - kept[j].nrow);
              expect(d).toBeGreaterThanOrEqual(minSpacing);
            }
          }
          // Deterministic for the same seed.
          const again = pickSpacedFaces(faces, { ...opts, rand: seededRandom(seed) });
          expect(again).toEqual(kept);
        },
      ),
      { numRuns: 100 },
    );
  });
});
