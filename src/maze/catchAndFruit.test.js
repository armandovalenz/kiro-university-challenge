// Property-based tests for the catch-resolution and random-fruit rules
// (mandatory PBT — see .kiro/steering/testing.md). Owns math-man Property 25
// (a saved life keeps Math Man in place; ghosts go home) and Property 26
// (fruit appears on a random playable corridor tile).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MazeGrid, resolveCatchPositions, fruitCandidateTiles, pickFruitTile,
  tileQuadrant, pickQuadrantFruitTiles, FRUIT_QUADRANTS,
} from './mazeLogic.js';
import { TILE } from './mazeData.js';
import { POINTS } from '../config.js';

const tileArb = fc.record({
  col: fc.integer({ min: 0, max: 27 }),
  row: fc.integer({ min: 0, max: 30 }),
});
const unitArb = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

describe('Property 25: A saved life keeps Math Man in place; ghosts return to spawn — Validates: Requirements 3.4, 4.5', () => {
  it('correct → player keeps his tile; wrong → player to spawn; ghosts always to their spawns', () => {
    fc.assert(
      fc.property(fc.boolean(), tileArb, tileArb, fc.array(tileArb, { maxLength: 6 }),
        (correct, player, playerSpawn, ghostSpawns) => {
          const before = JSON.stringify({ player, playerSpawn, ghostSpawns });
          const out = resolveCatchPositions({ correct, player, playerSpawn, ghostSpawns });

          expect(out.player).toEqual(correct ? player : playerSpawn);
          expect(out.ghosts).toEqual(ghostSpawns);
          // Fresh copies; inputs untouched.
          expect(out.player).not.toBe(player);
          expect(out.player).not.toBe(playerSpawn);
          out.ghosts.forEach((g, i) => expect(g).not.toBe(ghostSpawns[i]));
          expect(JSON.stringify({ player, playerSpawn, ghostSpawns })).toBe(before);
        }),
    );
  });
});

describe('Property 26: Fruit appears on a random playable corridor tile — Validates: Requirements 5.1, 5.6', () => {
  const grid = new MazeGrid();
  const candidates = fruitCandidateTiles(grid);
  const house = new Set(grid.ghostSpawns.map((g) => `${g.col},${g.row}`));

  it('candidates are enterable corridor tiles, never walls, the ghost house or the tunnel row', () => {
    expect(candidates.length).toBeGreaterThan(50);
    for (const t of candidates) {
      expect(grid.canEnter(t.col, t.row)).toBe(true);
      expect(house.has(`${t.col},${t.row}`)).toBe(false);
      expect(grid.tunnelRows.has(t.row)).toBe(false);
      expect([TILE.PELLET, TILE.POWER_PELLET, TILE.FRUIT_SPAWN, TILE.MATH_MAN_SPAWN])
        .toContain(grid.codeAt(t.col, t.row));
    }
  });

  it('every pick is a candidate, and respects the avoid distance whenever that is possible', () => {
    const key = (t) => `${t.col},${t.row}`;
    const candKeys = new Set(candidates.map(key));
    fc.assert(
      fc.property(unitArb, fc.array(tileArb, { maxLength: 5 }), fc.integer({ min: 0, max: 8 }),
        (r, avoid, minDistance) => {
          const pick = pickFruitTile(grid, () => r, { avoid, minDistance });
          expect(pick).not.toBeNull();
          expect(candKeys.has(key(pick))).toBe(true);
          const far = (t) => avoid.every((a) => Math.abs(a.col - t.col) + Math.abs(a.row - t.row) >= minDistance);
          if (candidates.some(far)) expect(far(pick)).toBe(true);
        }),
    );
  });

  it('is spread across the maze (not stuck on the F tile): many distinct tiles over RNG values', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const t = pickFruitTile(grid, () => i / 200);
      seen.add(`${t.col},${t.row}`);
    }
    expect(seen.size).toBeGreaterThan(Math.min(100, candidates.length / 2));
  });
});

describe('Property 27: Four fruits, one in each quadrant — Validates: Requirements 5.1, 5.6, 5.7', () => {
  const grid = new MazeGrid();
  const key = (t) => `${t.col},${t.row}`;
  const candKeys = new Set(fruitCandidateTiles(grid).map(key));

  it('tileQuadrant splits the grid at its centre lines into exactly 4 regions', () => {
    fc.assert(
      fc.property(tileArb, (t) => {
        const q = tileQuadrant(grid, t);
        expect([0, 1, 2, 3]).toContain(q);
        expect(q % 2 === 1).toBe(t.col >= grid.cols / 2);
        expect(q >= 2).toBe(t.row >= grid.rows / 2);
      }),
    );
  });

  it('returns one valid pick per quadrant, each inside its own quadrant, honouring avoid when possible', () => {
    fc.assert(
      fc.property(unitArb, fc.array(tileArb, { maxLength: 5 }), fc.integer({ min: 0, max: 8 }),
        (r, avoid, minDistance) => {
          const picks = pickQuadrantFruitTiles(grid, () => r, { avoid, minDistance });
          expect(picks).toHaveLength(FRUIT_QUADRANTS);
          picks.forEach((p, q) => {
            // The real maze has corridors in every quadrant.
            expect(p).not.toBeNull();
            expect(candKeys.has(key(p))).toBe(true);
            expect(tileQuadrant(grid, p)).toBe(q);
            const far = (t) => avoid.every((a) => Math.abs(a.col - t.col) + Math.abs(a.row - t.row) >= minDistance);
            const quadrantHasFar = fruitCandidateTiles(grid)
              .some((t) => tileQuadrant(grid, t) === q && far(t));
            if (quadrantHasFar) expect(far(p)).toBe(true);
          });
          // Four distinct tiles (different quadrants can't share a tile).
          expect(new Set(picks.map(key)).size).toBe(FRUIT_QUADRANTS);
        }),
    );
  });
});

describe('Big (power) pellets pay x2 their old 50 — Validates: Requirements 1.7', () => {
  it('a power pellet scores 100 through MazeGrid.pointsFor; a pellet stays 10', () => {
    const grid = new MazeGrid();
    expect(POINTS.powerPellet).toBe(100);
    expect(grid.pointsFor(TILE.POWER_PELLET)).toBe(POINTS.powerPellet);
    expect(grid.pointsFor(TILE.PELLET)).toBe(POINTS.pellet);
  });
});
