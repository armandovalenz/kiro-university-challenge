// Property-based tests for the book-throw tile-path helper (mandatory PBT —
// see .kiro/steering/testing.md).
//
// Feature: Knowledge Power — book projectile tile path + hit resolution.
// Owns BT-1..BT-4: every returned tile is in-bounds (never a wall / off-grid);
// the path stops at the first wall (exclusive); the length never exceeds
// maxRangeTiles; every tile shares the facing axis and steps one tile at a time
// away from the player. Also checks firstGhostOnPath picks the NEAREST ghost.
// Vitest + fast-check, named after the property.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid } from '../maze/mazeLogic.js';
import { bookTilePath, firstGhostOnPath, resolveBookThrow } from './bookThrow.js';

const grid = new MazeGrid();
const open = [];
for (let row = 0; row < grid.rows; row++) {
  for (let col = 0; col < grid.cols; col++) {
    if (grid.canEnter(col, row)) open.push({ col, row });
  }
}
const openTile = fc.constantFrom(...open);
const facingArb = fc.constantFrom('north', 'east', 'south', 'west');
const rangeArb = fc.integer({ min: 0, max: 20 });

const STEP = {
  north: { dcol: 0, drow: -1 },
  south: { dcol: 0, drow: 1 },
  west: { dcol: -1, drow: 0 },
  east: { dcol: 1, drow: 0 },
};

describe('bookThrow — BT-1/BT-2/BT-3/BT-4: tile path integrity — Validates: Knowledge Power', () => {
  it('every tile is in-bounds and not a wall, path <= maxRange, stops at first wall, shares the facing axis', () => {
    fc.assert(
      fc.property(openTile, facingArb, rangeArb, (from, facing, range) => {
        const path = bookTilePath(grid, from, facing, range);

        // BT-3: never longer than the requested range.
        expect(path.length).toBeLessThanOrEqual(Math.max(0, range));

        const step = STEP[facing];
        let prev = from;
        for (let i = 0; i < path.length; i++) {
          const tile = path[i];
          // BT-1: in-bounds and not a wall.
          expect(grid.inBounds(tile.col, tile.row)).toBe(true);
          expect(grid.isWall(tile.col, tile.row)).toBe(false);
          // BT-4: exactly one step from the previous tile along the facing axis.
          expect(tile.col).toBe(prev.col + step.dcol);
          expect(tile.row).toBe(prev.row + step.drow);
          // BT-4: shares the player's row (E/W) or column (N/S).
          if (step.drow === 0) expect(tile.row).toBe(from.row);
          if (step.dcol === 0) expect(tile.col).toBe(from.col);
          prev = tile;
        }

        // BT-2: the tile just past the end is a wall, off-grid, or the range ran
        // out — never an enterable in-bounds tile that was silently skipped.
        if (path.length < Math.max(0, range)) {
          const nextCol = prev.col + step.dcol;
          const nextRow = prev.row + step.drow;
          const blocked = !grid.inBounds(nextCol, nextRow) || grid.isWall(nextCol, nextRow);
          expect(blocked).toBe(true);
        }
      }),
    );
  });

  it('a zero/negative range yields an empty path', () => {
    fc.assert(
      fc.property(openTile, facingArb, fc.integer({ min: -10, max: 0 }), (from, facing, range) => {
        expect(bookTilePath(grid, from, facing, range)).toEqual([]);
      }),
    );
  });
});

describe('bookThrow — firstGhostOnPath picks the nearest ghost on the path — Validates: Knowledge Power', () => {
  it('returns the earliest path tile occupied by a ghost (nearest to the player)', () => {
    fc.assert(
      fc.property(openTile, facingArb, fc.integer({ min: 1, max: 20 }), (from, facing, range) => {
        const path = bookTilePath(grid, from, facing, range);
        fc.pre(path.length >= 1);

        // Put a ghost on a chosen path tile; a ghost on an EARLIER tile must win.
        const idx = path.length - 1;
        const target = path[idx];
        const ghosts = [{ key: 'far', col: target.col, row: target.row }];
        let hit = firstGhostOnPath(path, ghosts);
        expect(hit).not.toBeNull();
        expect(hit.index).toBe(idx);
        expect(hit.ghost.key).toBe('far');

        if (path.length >= 2) {
          const near = path[0];
          ghosts.push({ key: 'near', col: near.col, row: near.row });
          hit = firstGhostOnPath(path, ghosts);
          expect(hit.index).toBe(0);
          expect(hit.ghost.key).toBe('near');
        }

        // resolveBookThrow agrees with the two helpers composed.
        const resolved = resolveBookThrow(grid, from, facing, ghosts, range);
        expect(resolved.path).toEqual(path);
        expect(resolved.hit.index).toBe(hit.index);
      }),
    );
  });

  it('no ghost on the path => no hit', () => {
    fc.assert(
      fc.property(openTile, facingArb, rangeArb, (from, facing, range) => {
        const path = bookTilePath(grid, from, facing, range);
        // Ghosts far away / off the path: place them on the player's own tile,
        // which is never part of the path.
        const ghosts = [{ key: 'self', col: from.col, row: from.row }];
        expect(firstGhostOnPath(path, ghosts)).toBeNull();
      }),
    );
  });
});
