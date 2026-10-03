// Property-based tests for the pure maze grid logic (mandatory PBT — see
// .kiro/steering/testing.md).
//
// Owns Property 5 (movement respects walls), Property 6 (tile/world round-trip),
// Property 7 (eating a pellet removes it and scores), and Property 8 (clearing
// all pellets advances the level). Tests use Vitest + fast-check and are named
// after the Core Property they validate, carrying the requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid, DIRECTIONS, tileKey } from './mazeLogic.js';
import { POINTS } from '../config.js';
import { TILE } from './mazeData.js';

/** A fresh grid over the shared base layout. */
function makeGrid() {
  return new MazeGrid();
}

/** Arbitrary that yields any in-bounds tile of a grid. */
function anyTile(grid) {
  return fc.record({
    col: fc.integer({ min: 0, max: grid.cols - 1 }),
    row: fc.integer({ min: 0, max: grid.rows - 1 }),
  });
}

const anyDirection = fc.constantFrom('left', 'right', 'up', 'down');

describe('MazeGrid — Property 5: Movement respects walls', () => {
  // **Validates: Requirements 1.2, 1.3**
  // For any mover centered on a tile with a queued direction, it advances toward
  // the target when that tile is not a wall and stays put when it is — so a
  // mover can never enter a wall.
  it('attemptMove enters non-wall targets, blocks on walls, and never lands on a wall', () => {
    const grid = makeGrid();
    fc.assert(
      fc.property(anyTile(grid), anyDirection, ({ col, row }, direction) => {
        const result = grid.attemptMove(col, row, direction);
        const delta = DIRECTIONS[direction];

        // Compute the (possibly tunnel-wrapped) target the same way the grid does.
        let targetCol = col + delta.dx;
        const targetRow = row + delta.dy;
        if (grid.tunnelRows.has(targetRow)) {
          if (targetCol < 0) targetCol = grid.cols - 1;
          else if (targetCol >= grid.cols) targetCol = 0;
        }

        if (grid.canEnter(targetCol, targetRow)) {
          // Non-wall target → the mover advanced onto it.
          expect(result.moved).toBe(true);
          expect(result.col).toBe(targetCol);
          expect(result.row).toBe(targetRow);
        } else {
          // Wall target → the mover stayed exactly where it was.
          expect(result.moved).toBe(false);
          expect(result.col).toBe(col);
          expect(result.row).toBe(row);
        }

        // A mover can never be sitting on a wall after a move attempt (unless it
        // began on one, which the layout never does for in-bounds path tiles).
        if (!grid.isWall(col, row)) {
          expect(grid.isWall(result.col, result.row)).toBe(false);
        }
      }),
    );
  });
});

describe('MazeGrid — Property 5 (vertical tunnels): Movement wraps on tunnel columns', () => {
  // **Validates: Requirements 1.2, 1.3**
  // Levels 2 and 3 add vertical ('|') wrap edges on a central column. For any
  // tile+direction, when the target leaves the top/bottom edge on a tunnelCols
  // column the mover wraps to the opposite edge row (symmetric to the existing
  // horizontal row-wrap); every other target still obeys the wall/edge rules.
  it('attemptMove wraps off top/bottom edges on tunnel columns and respects walls elsewhere', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(2, 3), // levels whose layouts carry vertical tunnels
        (level) => {
          const grid = new MazeGrid({ level });
          // The layout must actually have vertical tunnel columns for this to
          // be meaningful.
          expect(grid.tunnelCols.size).toBeGreaterThan(0);

          fc.assert(
            fc.property(anyTile(grid), anyDirection, ({ col, row }, direction) => {
              const result = grid.attemptMove(col, row, direction);
              const delta = DIRECTIONS[direction];

              // Compute the (possibly wrapped) target exactly as the grid does:
              // horizontal wrap on a tunnel row, then vertical wrap on a tunnel
              // column.
              let targetCol = col + delta.dx;
              let targetRow = row + delta.dy;
              if (grid.tunnelRows.has(targetRow)) {
                if (targetCol < 0) targetCol = grid.cols - 1;
                else if (targetCol >= grid.cols) targetCol = 0;
              }
              if (grid.tunnelCols.has(targetCol)) {
                if (targetRow < 0) targetRow = grid.rows - 1;
                else if (targetRow >= grid.rows) targetRow = 0;
              }

              if (grid.canEnter(targetCol, targetRow)) {
                expect(result.moved).toBe(true);
                expect(result.col).toBe(targetCol);
                expect(result.row).toBe(targetRow);
              } else {
                expect(result.moved).toBe(false);
                expect(result.col).toBe(col);
                expect(result.row).toBe(row);
              }

              // A mover never ends on a wall (unless it began on one, which the
              // layout never does for in-bounds path tiles).
              if (!grid.isWall(col, row)) {
                expect(grid.isWall(result.col, result.row)).toBe(false);
              }
            }),
            { numRuns: 150 },
          );
        },
      ),
      { numRuns: 2 },
    );
  });

  it('a step off the top edge on a tunnel column lands on the bottom edge row (and vice versa)', () => {
    const grid = new MazeGrid({ level: 2 });
    const tunnelCols = [...grid.tunnelCols];
    expect(tunnelCols.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(fc.constantFrom(...tunnelCols), fc.constantFrom('up', 'down'), (col, direction) => {
        const startRow = direction === 'up' ? 0 : grid.rows - 1;
        const expectedRow = direction === 'up' ? grid.rows - 1 : 0;
        const result = grid.attemptMove(col, startRow, direction);
        // The opposite-edge target is a path tile in these layouts, so the move
        // succeeds and lands on the wrapped row, same column.
        expect(result.moved).toBe(true);
        expect(result.col).toBe(col);
        expect(result.row).toBe(expectedRow);
      }),
      { numRuns: 100 },
    );
  });
});

describe('MazeGrid — Property 6: Tile and world coordinates round-trip', () => {
  // **Validates: Requirements 1.2, 1.3**
  // For any valid tile, converting it to world coordinates and back yields the
  // same tile.
  it('worldToTile(tileToWorld(tile)) === tile for every in-bounds tile', () => {
    const grid = makeGrid();
    fc.assert(
      fc.property(anyTile(grid), ({ col, row }) => {
        const world = grid.tileToWorld(col, row);
        const back = grid.worldToTile(world.x, world.y);
        expect(back.col).toBe(col);
        expect(back.row).toBe(row);
      }),
    );
  });

  it('a tile center is reported as tile-centered', () => {
    const grid = makeGrid();
    fc.assert(
      fc.property(anyTile(grid), ({ col, row }) => {
        const { x, y } = grid.tileToWorld(col, row);
        expect(grid.isTileCentered(x, y)).toBe(true);
      }),
    );
  });
});

describe('MazeGrid — Property 7: Eating a pellet removes it and scores', () => {
  // **Validates: Requirements 1.4**
  // For any pellet tile occupied by Math Man, eating removes exactly that pellet
  // (count drops by one) and increases the score by the pellet's value.
  it('eating a live pellet drops the count by one and returns its point value', () => {
    const grid = makeGrid();
    // All pellet coordinates present in the fresh layout.
    const pelletTiles = Array.from(grid.pellets.keys()).map((k) => {
      const [c, r] = k.split(',').map(Number);
      return { col: c, row: r };
    });
    fc.assert(
      fc.property(fc.constantFrom(...pelletTiles), ({ col, row }) => {
        // Fresh grid each run so pellet state is independent between samples.
        const g = makeGrid();
        const before = g.pelletCount();
        const code = g.pellets.get(tileKey(col, row));
        const expectedPoints = code === TILE.POWER_PELLET ? POINTS.powerPellet : POINTS.pellet;

        const gained = g.eatPelletAt(col, row);

        expect(gained).toBe(expectedPoints);
        expect(g.pelletCount()).toBe(before - 1);
        expect(g.isPelletAt(col, row)).toBe(false);

        // Eating the same tile again yields nothing and no further count change.
        expect(g.eatPelletAt(col, row)).toBe(0);
        expect(g.pelletCount()).toBe(before - 1);
      }),
    );
  });

  it('eating an empty (non-pellet) tile scores nothing and changes no count', () => {
    const grid = makeGrid();
    fc.assert(
      fc.property(anyTile(grid), ({ col, row }) => {
        const g = makeGrid();
        if (g.isPelletAt(col, row)) return; // only exercise non-pellet tiles
        const before = g.pelletCount();
        expect(g.eatPelletAt(col, row)).toBe(0);
        expect(g.pelletCount()).toBe(before);
      }),
    );
  });
});

describe('MazeGrid — Property 8: Clearing all pellets advances the level', () => {
  // **Validates: Requirements 1.5**
  // For any maze state where the pellet count reaches 0, the level increments
  // and the pellet layer is rebuilt.
  it('eating every pellet clears the level; reset rebuilds pellets and bumps the level', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (startLevel) => {
        const g = new MazeGrid({ level: startLevel });
        const startingPellets = g.pelletCount();
        expect(startingPellets).toBeGreaterThan(0);

        // Eat every pellet.
        for (const key of Array.from(g.pellets.keys())) {
          const [c, r] = key.split(',').map(Number);
          g.eatPelletAt(c, r);
        }
        expect(g.pelletCount()).toBe(0);
        expect(g.isLevelCleared()).toBe(true);

        // Advancing rebuilds the pellet layer and increments the level. The
        // layout now varies by level (level 1 = base, 2 = circular, 3+ = the
        // Shining maze), so the rebuilt pellet count matches a FRESH grid at the
        // new level — a non-empty, level-appropriate pellet layer — rather than
        // the previous level's count. The invariant that matters: clearing all
        // pellets flips isLevelCleared, and reset() bumps the level and rebuilds
        // a fresh, non-empty pellet layer (Req 1.5).
        g.reset();
        expect(g.level).toBe(startLevel + 1);
        const fresh = new MazeGrid({ level: startLevel + 1 });
        expect(g.pelletCount()).toBe(fresh.pelletCount());
        expect(g.pelletCount()).toBeGreaterThan(0);
        expect(g.isLevelCleared()).toBe(false);
      }),
    );
  });
});
