// Property-based tests for the framework-agnostic FP3D coordinate logic
// (mandatory PBT — see .kiro/steering/testing.md). Uses Vitest + fast-check,
// runs at >= 100 cases, and carries the requirement trace on the property.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid } from '../../maze/mazeLogic.js';
import { getLevelLayout } from '../../maze/mazeData.js';
import {
  tileToWorld3D,
  worldToTile3D,
  resolveMove,
  resolveTunnel,
  turnLeft,
  turnRight,
  setFacing,
  InputBuffer,
  CARDINALS,
  CARDINAL_TO_DIR,
} from './fp3dLogic.js';

describe('fp3dLogic — Property 1: Tile → world3D → tile round-trip', () => {
  // Feature: first-person-3d-mode, Property 1: Tile → world3D → tile round-trip — Validates: Requirements 10.1, 1.1
  it('recovers col/row through world3D for any in-bounds tile and leaves the layout unchanged', () => {
    const layout = getLevelLayout();
    const grid = new MazeGrid({ layout });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: grid.cols - 1 }),
        fc.integer({ min: 0, max: grid.rows - 1 }),
        (col, row) => {
          const world = tileToWorld3D(grid, col, row);
          const recovered = worldToTile3D(grid, ...Object.values(world));

          expect(recovered.col).toBe(col);
          expect(recovered.row).toBe(row);

          // The grid's tile-code layout must stay identical to the source.
          expect(grid.grid).toEqual(getLevelLayout());
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('fp3dLogic — Property 2: Movement resolution respects walls', () => {
  // Feature: first-person-3d-mode, Property 2: Movement resolution respects walls — Validates: Requirements 10.2, 2.3
  it('returns the start tile when the target is not enterable and the neighbor when it is', () => {
    const layout = getLevelLayout();
    const grid = new MazeGrid({ layout });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: grid.cols - 1 }),
        fc.integer({ min: 0, max: grid.rows - 1 }),
        fc.constantFrom(...CARDINALS),
        (col, row, facing) => {
          const result = resolveMove(grid, col, row, facing);

          // Cross-check against the underlying MazeGrid.attemptMove: resolveMove
          // must return it verbatim, never forking the wall/tunnel rules.
          const expected = grid.attemptMove(col, row, CARDINAL_TO_DIR[facing]);
          expect(result).toEqual(expected);

          if (!result.moved) {
            // Not enterable (wall / out of bounds on a non-tunnel row): the
            // tile is unchanged.
            expect(result.col).toBe(col);
            expect(result.row).toBe(row);
          } else {
            // Enterable: the returned tile is a genuinely enterable neighbor.
            expect(grid.canEnter(result.col, result.row)).toBe(true);
            expect(result.col === col && result.row === row).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('fp3dLogic — Property 3: Facing resolution yields exactly one cardinal', () => {
  // Feature: first-person-3d-mode, Property 3: Facing resolution yields exactly one cardinal — Validates: Requirements 10.3, 2.4
  it('turnLeft/turnRight/setFacing always return exactly one of north/south/east/west', () => {
    const CARDINAL_SET = new Set(['north', 'south', 'east', 'west']);

    fc.assert(
      fc.property(
        fc.constantFrom(...CARDINALS),
        fc.constantFrom(turnLeft, turnRight, setFacing),
        (facing, op) => {
          const result = op(facing);
          // Exactly one cardinal: a single string that is a member of the set.
          expect(typeof result).toBe('string');
          expect(CARDINAL_SET.has(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('fp3dLogic — Property 5: Input buffering keeps at most one', () => {
  // Feature: first-person-3d-mode, Property 5: Input buffering keeps at most one — Validates: Requirements 2.7
  it('never exceeds size 1 and take() returns the single retained intent (or null)', () => {
    fc.assert(
      fc.property(
        // Any sequence of intents pushed during one traversal; null models a
        // clearing push, other values model real move/turn intents.
        fc.array(fc.oneof(fc.constantFrom(...CARDINALS), fc.constant(null)), {
          maxLength: 20,
        }),
        (intents) => {
          const buffer = new InputBuffer();

          // The last non-null push wins; a trailing null clears the buffer.
          let expected = null;
          for (const intent of intents) {
            buffer.push(intent);
            expected = intent ?? null;
            // size is always 0 or 1, never more.
            expect(buffer.size === 0 || buffer.size === 1).toBe(true);
            expect(buffer.size).toBe(expected === null ? 0 : 1);
          }

          // take() returns the single retained intent (or null) and clears.
          expect(buffer.take()).toBe(expected);
          expect(buffer.size).toBe(0);
          expect(buffer.take()).toBe(null);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('fp3dLogic — Property 4: Tunnel-wrap resolution', () => {
  // Feature: first-person-3d-mode, Property 4: Tunnel-wrap resolution — Validates: Requirements 10.4, 2.5
  it('wraps a tunnel-row edge step to the opposite in-bounds edge, same row, facing preserved', () => {
    const layout = getLevelLayout();
    const grid = new MazeGrid({ layout });

    // The level must actually have tunnel rows for this property to be meaningful.
    const tunnelRows = [...grid.tunnelRows];
    expect(tunnelRows.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        // Pick a tunnel row and an edge to step off:
        //  - 'west' from col 0        -> should wrap to cols - 1
        //  - 'east' from col cols - 1 -> should wrap to 0
        fc.constantFrom(...tunnelRows),
        fc.constantFrom('west', 'east'),
        (row, facing) => {
          const startCol = facing === 'west' ? 0 : grid.cols - 1;
          const result = resolveTunnel(grid, startCol, row, facing);

          // Row unchanged (entry row).
          expect(result.row).toBe(row);
          // Facing preserved.
          expect(result.facing).toBe(facing);

          // Column equals the opposite in-bounds edge per MazeGrid wrap logic:
          // stepping off left edge -> cols - 1; off right edge -> 0. Mirror the
          // rule via the underlying MazeGrid.attemptMove for a cross-check.
          const expectedCol = facing === 'west' ? grid.cols - 1 : 0;
          expect(result.col).toBe(expectedCol);

          const wrapped = grid.attemptMove(
            startCol,
            row,
            CARDINAL_TO_DIR[facing],
          );
          // attemptMove computes the wrapped target column identically; when
          // that wrapped tile is enterable it moves there, confirming the edge
          // column resolveTunnel produced.
          if (wrapped.moved) {
            expect(result.col).toBe(wrapped.col);
            expect(result.row).toBe(wrapped.row);
          }

          // The resolved column is always in bounds.
          expect(result.col).toBeGreaterThanOrEqual(0);
          expect(result.col).toBeLessThan(grid.cols);
        },
      ),
      { numRuns: 100 },
    );
  });
});
