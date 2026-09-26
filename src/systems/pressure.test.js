// Property-based tests for the pressure-music logic (mandatory PBT — see
// .kiro/steering/testing.md). Owns math-man Property 28 (walking distance to
// the nearest ghost) and Property 29 (gradual score speed-up).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid } from '../maze/mazeLogic.js';
import { nearestGhostPathDistance, pressureTargetRate, approachRate } from './pressure.js';

const grid = new MazeGrid();
const open = [];
for (let row = 0; row < grid.rows; row++) {
  for (let col = 0; col < grid.cols; col++) {
    if (grid.canEnter(col, row)) open.push({ col, row });
  }
}
const openTile = fc.constantFrom(...open);
const DIRS = ['left', 'right', 'up', 'down'];

describe('Property 28: Pressure uses walking distance to the nearest ghost — Validates: Requirements 12.9', () => {
  it('is 0 on the same tile, and Infinity or within [0, maxSteps] otherwise', () => {
    fc.assert(
      fc.property(openTile, fc.array(openTile, { maxLength: 4 }), fc.integer({ min: 0, max: 20 }),
        (from, ghosts, maxSteps) => {
          const d = nearestGhostPathDistance(grid, from, ghosts, maxSteps);
          if (ghosts.some((g) => g.col === from.col && g.row === from.row)) expect(d).toBe(0);
          else if (Number.isFinite(d)) {
            expect(d).toBeGreaterThanOrEqual(1);
            expect(d).toBeLessThanOrEqual(maxSteps);
          } else expect(d).toBe(Infinity);
        }),
    );
  });

  it('a ghost one legal move away is at distance 1; the nearest ghost wins', () => {
    fc.assert(
      fc.property(openTile, fc.constantFrom(...DIRS), openTile, (from, dir, far) => {
        const m = grid.attemptMove(from.col, from.row, dir);
        fc.pre(m.moved);
        // A "far" ghost on Math Man's own tile would correctly make it 0.
        fc.pre(!(far.col === from.col && far.row === from.row));
        const near = { col: m.col, row: m.row };
        expect(nearestGhostPathDistance(grid, from, [near], 5)).toBe(1);
        expect(nearestGhostPathDistance(grid, from, [far, near], 5)).toBe(1);
      }),
    );
  });

  it('adding ghosts never increases the distance, and a larger radius never loses a ghost', () => {
    fc.assert(
      fc.property(openTile, fc.array(openTile, { maxLength: 3 }), openTile, fc.integer({ min: 0, max: 15 }),
        (from, ghosts, extra, maxSteps) => {
          const d = nearestGhostPathDistance(grid, from, ghosts, maxSteps);
          expect(nearestGhostPathDistance(grid, from, ghosts.concat([extra]), maxSteps)).toBeLessThanOrEqual(d);
          if (Number.isFinite(d)) {
            expect(nearestGhostPathDistance(grid, from, ghosts, maxSteps + 5)).toBe(d);
          }
        }),
    );
  });

  it('walls block it: walking distance is never shorter than the non-wrapping Manhattan distance off the tunnel', () => {
    fc.assert(
      fc.property(openTile, openTile, (from, g) => {
        fc.pre(!grid.tunnelRows.has(from.row) && !grid.tunnelRows.has(g.row));
        const d = nearestGhostPathDistance(grid, from, [g], 60);
        // Wrapping can only shorten horizontal travel via a tunnel row, which a
        // path may still use; bound by the wrap-aware Manhattan distance.
        const dx = Math.abs(from.col - g.col);
        const manhattan = Math.min(dx, grid.cols - dx) + Math.abs(from.row - g.row);
        expect(d).toBeGreaterThanOrEqual(manhattan);
      }),
    );
  });
});

describe('Property 29: Score music speeds up gradually as a ghost closes in — Validates: Requirements 12.9', () => {
  const cfgArb = fc.record({
    startTiles: fc.integer({ min: 1, max: 20 }),
    maxRate: fc.double({ min: 1, max: 2, noNaN: true }),
    rampUpPerSec: fc.double({ min: 0.01, max: 2, noNaN: true }),
    rampDownPerSec: fc.double({ min: 0.01, max: 2, noNaN: true }),
    curve: fc.double({ min: 1, max: 5, noNaN: true }),
  });
  const distArb = fc.oneof(fc.double({ min: 0, max: 40, noNaN: true }), fc.constant(Infinity));

  it('target rate is 1 at/after startTiles, maxRate at 0, within [1, maxRate], and never slower when closer', () => {
    fc.assert(
      fc.property(cfgArb, distArb, distArb, (cfg, a, b) => {
        const ra = pressureTargetRate(a, cfg);
        expect(ra).toBeGreaterThanOrEqual(1);
        expect(ra).toBeLessThanOrEqual(cfg.maxRate + 1e-12);
        if (!(a < cfg.startTiles)) expect(ra).toBe(1);
        const [near, far] = a <= b ? [a, b] : [b, a];
        expect(pressureTargetRate(near, cfg)).toBeGreaterThanOrEqual(pressureTargetRate(far, cfg) - 1e-12);
      }),
    );
    fc.assert(fc.property(cfgArb, (cfg) => {
      expect(pressureTargetRate(0, cfg)).toBeCloseTo(cfg.maxRate, 12);
    }));
  });

  it('a curve >= 1 is subtle: never faster than the linear ramp at the same distance', () => {
    fc.assert(
      fc.property(cfgArb, distArb, (cfg, d) => {
        const linear = pressureTargetRate(d, { ...cfg, curve: 1 });
        expect(pressureTargetRate(d, cfg)).toBeLessThanOrEqual(linear + 1e-12);
      }),
    );
  });

  it('approachRate never overshoots and changes by at most the ramp limit per frame', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 2, noNaN: true }), fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }), cfgArb, (cur, target, dt, cfg) => {
          const next = approachRate(cur, target, dt, cfg);
          const lo = Math.min(cur, target);
          const hi = Math.max(cur, target);
          expect(next).toBeGreaterThanOrEqual(lo - 1e-12);
          expect(next).toBeLessThanOrEqual(hi + 1e-12);
          const limit = (target > cur ? cfg.rampUpPerSec : cfg.rampDownPerSec) * (dt / 1000);
          expect(Math.abs(next - cur)).toBeLessThanOrEqual(limit + 1e-12);
          if (Math.abs(target - cur) <= limit) expect(next).toBe(target);
        }),
    );
  });
});
