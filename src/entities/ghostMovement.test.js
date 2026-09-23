// Framework-agnostic simulation test for the ghost grid-lock movement model
// (no Phaser). This guards the Bug A fix: with the corrected "move toward the
// next tile center, clamp on overshoot, then re-decide" loop, a ghost leaving
// the ghost house must PROGRESS a full tile per crossing and roam the maze —
// never oscillate/snap backward and stay pinned on its spawn tile.
//
// The step model mirrored here is exactly the one implemented in
// `Ghost.tick(delta)` / `MathMan.tick(delta)`, but expressed purely against
// the framework-agnostic `MazeGrid` + `ghostAI` helpers so it runs under Vitest
// with no Phaser runtime (matching the codebase's testing conventions).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MazeGrid, DIRECTIONS, tileKey, nextCenterAhead } from '../maze/mazeLogic.js';
import {
  computeTargetTile,
  chooseGhostDirection,
  houseRegionFromGrid,
  isHouseTile,
  ghostHouseExitTile,
  blockHouseReentry,
} from './ghostAI.js';
import { SPEEDS, TILE_SIZE } from '../config.js';

/**
 * Pure re-implementation of the fixed grid-lock update loop for one entity.
 * Returns the set of distinct tiles visited across `frames` steps.
 *
 * @param {MazeGrid} grid
 * @param {{col:number,row:number}} spawn spawn tile
 * @param {object} [opts]
 * @param {number} [opts.speed]   pixels/second
 * @param {number} [opts.dtMs]    per-frame delta (ms)
 * @param {number} [opts.frames]  number of frames to simulate
 * @param {string} [opts.personality]
 */
function simulateGhost(grid, spawn, opts = {}) {
  const {
    speed = SPEEDS.ghost,
    dtMs = 16,
    frames = 600,
    personality = 'chase',
  } = opts;

  const center = grid.tileToWorld(spawn.col, spawn.row);
  const ent = { x: center.x, y: center.y };
  let direction = null;
  let moving = false;
  const visited = new Set();

  // Fixed Math Man target for the chase personality (lower-center spawn tile).
  const mathManTile = { col: 14, row: 23 };

  const decide = (col, row) => {
    const target = computeTargetTile(personality, {
      mathManTile,
      mathManDir: 'left',
      ghostTile: { col, row },
      redGhostTile: { col: 13, row: 13 },
      scatterCorner: { col: grid.cols - 2, row: 1 },
    });
    const dir = chooseGhostDirection(grid, { col, row }, direction, target);
    if (dir) {
      direction = dir;
      moving = true;
    } else {
      moving = false;
    }
  };

  // Seed an initial heading like Ghost._initDirection (first legal move).
  {
    const { col, row } = grid.worldToTile(ent.x, ent.y);
    for (const dir of ['up', 'left', 'right', 'down']) {
      if (grid.attemptMove(col, row, dir).moved) {
        direction = dir;
        moving = true;
        break;
      }
    }
  }

  for (let f = 0; f < frames; f += 1) {
    {
      const { col, row } = grid.worldToTile(ent.x, ent.y);
      visited.add(tileKey(col, row));
    }

    // Budget-based grid-lock loop — the exact algorithm shipped in
    // `Ghost.tick(delta)`: no centerEpsilon snap; advance toward successive
    // tile centers and re-decide each time a center is reached.
    const dt = Math.min(dtMs, 100) / 1000;
    let budget = speed * dt;

    // Exact-center re-decide (tiny 0.01px tolerance, not epsilon).
    {
      const { col, row } = grid.worldToTile(ent.x, ent.y);
      const c = grid.tileToWorld(col, row);
      if (Math.abs(ent.x - c.x) < 0.01 && Math.abs(ent.y - c.y) < 0.01) {
        ent.x = c.x;
        ent.y = c.y;
        decide(col, row);
      }
    }

    let guard = 0;
    while (budget > 1e-6 && moving && direction && guard++ < 8) {
      // At-center legality re-validation — mirrors the shipped `tick`: only
      // step into the tile ahead if it is enterable; otherwise re-decide, and
      // stop this frame if still blocked so the entity never enters a wall or
      // leaves the maze.
      {
        const { col, row } = grid.worldToTile(ent.x, ent.y);
        const c = grid.tileToWorld(col, row);
        const onCenter = Math.abs(ent.x - c.x) < 0.01 && Math.abs(ent.y - c.y) < 0.01;
        if (onCenter && !grid.attemptMove(col, row, direction).moved) {
          decide(col, row);
          if (!direction || !grid.attemptMove(col, row, direction).moved) {
            moving = false;
            break;
          }
        }
      }

      const targetCenter = nextCenterAhead(grid, ent.x, ent.y, direction);
      const remaining = Math.hypot(targetCenter.x - ent.x, targetCenter.y - ent.y);
      if (remaining <= budget) {
        ent.x = targetCenter.x;
        ent.y = targetCenter.y;
        grid.wrapIfTunnel(ent);
        budget -= remaining;
        const reached = grid.worldToTile(ent.x, ent.y);
        visited.add(tileKey(reached.col, reached.row));
        decide(reached.col, reached.row);
      } else {
        const d = DIRECTIONS[direction];
        ent.x += d.dx * budget;
        ent.y += d.dy * budget;
        grid.wrapIfTunnel(ent);
        budget = 0;
      }
    }
  }

  return visited;
}

describe('Ghost movement (Bug A) — grid-lock loop lets ghosts leave the house', () => {
  const grid = new MazeGrid();

  it('a chase ghost from each spawn visits many distinct tiles (no snap-back)', () => {
    expect(grid.ghostSpawns.length).toBeGreaterThan(0);
    for (const spawn of grid.ghostSpawns) {
      const visited = simulateGhost(grid, spawn, { frames: 600 });
      // Previously the ghost oscillated and visited only its spawn tile (1).
      expect(visited.size).toBeGreaterThan(5);
    }
  });

  it('ghost spawns are inside the house interior, off the tunnel/wrap row', () => {
    for (const spawn of grid.ghostSpawns) {
      // No ghost may spawn on a tunnel row (that row is the horizontal-wrap
      // corridor, not the ghost house).
      expect(grid.tunnelRows.has(spawn.row)).toBe(false);
    }
  });

  it('is frame-rate independent: a chase ghost roams at 30/60/120/240 Hz (property) — Validates: Requirements 1.2, 1.3', () => {
    // Regression guard for the high-refresh movement bug. The OLD epsilon-based
    // snap-and-decide oscillated when the per-frame step fell below the 1px
    // centerEpsilon: at ~120 Hz (delta≈8.33ms) and ~240 Hz (delta≈4.17ms) a
    // ghost snapped to its spawn center every frame and visited only 1 tile.
    // The budget-based grid-lock loop must let a real chase ghost roam many
    // distinct tiles at EVERY refresh rate.
    const deltas = [
      33.3, // ~30 Hz
      16.7, // ~60 Hz
      8.33, // ~120 Hz
      4.17, // ~240 Hz
    ];
    expect(grid.ghostSpawns.length).toBeGreaterThan(0);
    for (const dtMs of deltas) {
      for (const spawn of grid.ghostSpawns) {
        // Simulate a fixed WALL-CLOCK window so slower frames don't get an
        // unfair advantage: more (smaller) frames at higher refresh rates.
        const frames = Math.round(10000 / dtMs); // ~10s of play
        const visited = simulateGhostRelease(grid, spawn, {
          personality: 'chase',
          dtMs,
          frames,
        });
        expect(
          visited.distinctTiles,
          `chase @ (${spawn.col},${spawn.row}) dt=${dtMs}ms distinctTiles`,
        ).toBeGreaterThan(10);
      }
    }
  });

  it('never enters a wall or leaves the maze at any refresh rate (property) — Validates: Requirements 3.1', () => {
    // Regression guard for the wall/bounds bug: the budget loop must re-validate
    // the heading at each tile center and refuse to step into a wall or off the
    // grid. Across real spawns and deltas the ghost must still ROAM (> 10
    // distinct tiles) yet every tile it ever occupies must be in-bounds and NOT
    // a wall — i.e. wallHits === 0 and outOfBounds === 0.
    const deltas = [33.3, 16.7, 8.33, 4.17];
    expect(grid.ghostSpawns.length).toBeGreaterThan(0);
    for (const dtMs of deltas) {
      for (const spawn of grid.ghostSpawns) {
        const frames = Math.round(10000 / dtMs); // ~10s of play
        const { distinctTiles, visited } = simulateGhostRelease(grid, spawn, {
          personality: 'chase',
          dtMs,
          frames,
        });

        // Still moves at every refresh rate.
        expect(
          distinctTiles,
          `chase @ (${spawn.col},${spawn.row}) dt=${dtMs}ms distinctTiles`,
        ).toBeGreaterThan(10);

        // Every occupied tile is legal.
        let wallHits = 0;
        let outOfBounds = 0;
        for (const key of visited) {
          const [col, row] = key.split(',').map(Number);
          if (!grid.inBounds(col, row)) outOfBounds += 1;
          else if (grid.isWall(col, row)) wallHits += 1;
        }
        expect(
          outOfBounds,
          `chase @ (${spawn.col},${spawn.row}) dt=${dtMs}ms outOfBounds`,
        ).toBe(0);
        expect(
          wallHits,
          `chase @ (${spawn.col},${spawn.row}) dt=${dtMs}ms wallHits`,
        ).toBe(0);
      }
    }
  });

  it('progresses a full tile per crossing at the configured speed (property)', () => {
    // For any legal heading from a walkable tile, one crossing must reach the
    // adjacent tile center — never remain pinned on the starting tile.
    const walkable = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        if (!grid.isWall(col, row)) walkable.push({ col, row });
      }
    }
    fc.assert(
      fc.property(fc.constantFrom(...walkable), (spawn) => {
        // A single-tile crossing at ghost speed takes TILE_SIZE/stepLen frames;
        // simulate a generous window and require it left the spawn tile.
        const stepLen = SPEEDS.ghost * (16 / 1000);
        const framesForOneTile = Math.ceil(TILE_SIZE / stepLen) + 2;
        const visited = simulateGhost(grid, spawn, { frames: framesForOneTile });
        // If the ghost had any legal move, it must have visited > 1 tile.
        const hasMove = ['up', 'left', 'down', 'right'].some(
          (d) => grid.attemptMove(spawn.col, spawn.row, d).moved,
        );
        if (hasMove) expect(visited.size).toBeGreaterThan(1);
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// Bug B: ghosts must LEAVE the house and roam. Greedy chase alone never heads
// UP through the door (Math Man is below, so "up" always increases distance),
// so the ghost freezes at the doorway. The fix is a two-phase release in the
// framework-agnostic AI layer: (1) target the exit tile above the door using
// the normal grid until the ghost clears the house, then (2) target the
// personality tile using a re-entry-blocking grid view so it can't ping-pong
// back through the door. This simulation mirrors that exact logic (the same one
// wired into `Ghost._decideAtTile`) purely against MazeGrid + ghostAI helpers.
// -----------------------------------------------------------------------------

/**
 * Pure re-implementation of the fixed grid-lock loop WITH the two-phase house
 * release, matching `Ghost._decideAtTile`. Returns roam statistics.
 *
 * @param {MazeGrid} grid
 * @param {{col:number,row:number}} spawn spawn tile (inside the house)
 * @param {object} [opts]
 * @param {string} [opts.personality]
 * @param {number} [opts.frames]
 * @returns {{exited:boolean, distinctTiles:number, minRow:number, maxRow:number}}
 */
function simulateGhostRelease(grid, spawn, opts = {}) {
  const { personality = 'chase', frames = 2000, speed = SPEEDS.ghost, dtMs = 16 } = opts;

  const house = houseRegionFromGrid(grid);
  const exitTile = ghostHouseExitTile(house);
  const noReentry = blockHouseReentry(grid, house);

  const center = grid.tileToWorld(spawn.col, spawn.row);
  const ent = { x: center.x, y: center.y };
  let direction = null;
  let moving = false;
  let exited = false;
  const visited = new Set();
  let minRow = Infinity;
  let maxRow = -Infinity;

  // Math Man sits lower-center (below the house) — the case that defeats greedy
  // chase, because "up" toward the door always increases distance to him.
  const mathManTile = { col: 14, row: 23 };

  const decide = (col, row) => {
    if (!exited && !isHouseTile(house, col, row)) exited = true;

    let target;
    let gridView;
    if (!exited) {
      target = exitTile;
      gridView = grid;
    } else {
      target = computeTargetTile(personality, {
        mathManTile,
        mathManDir: 'left',
        ghostTile: { col, row },
        redGhostTile: { col: 13, row: 13 },
        scatterCorner: { col: grid.cols - 2, row: 1 },
      });
      gridView = noReentry;
    }

    const dir = chooseGhostDirection(gridView, { col, row }, direction, target);
    if (dir) {
      direction = dir;
      moving = true;
    } else {
      moving = false;
    }
  };

  // Seed an initial heading like Ghost._initDirection (first legal move).
  {
    const { col, row } = grid.worldToTile(ent.x, ent.y);
    for (const dir of ['up', 'left', 'right', 'down']) {
      if (grid.attemptMove(col, row, dir).moved) {
        direction = dir;
        moving = true;
        break;
      }
    }
  }

  const record = (col, row) => {
    visited.add(tileKey(col, row));
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  };

  for (let f = 0; f < frames; f += 1) {
    {
      const { col, row } = grid.worldToTile(ent.x, ent.y);
      record(col, row);
    }

    // Budget-based grid-lock loop with two-phase house release — the exact
    // algorithm shipped in `Ghost.tick(delta)` + `Ghost._decideAtTile`.
    const dt = Math.min(dtMs, 100) / 1000;
    let budget = speed * dt;

    // Exact-center re-decide (tiny 0.01px tolerance, not epsilon).
    {
      const { col, row } = grid.worldToTile(ent.x, ent.y);
      const c = grid.tileToWorld(col, row);
      if (Math.abs(ent.x - c.x) < 0.01 && Math.abs(ent.y - c.y) < 0.01) {
        ent.x = c.x;
        ent.y = c.y;
        decide(col, row);
      }
    }

    let guard = 0;
    while (budget > 1e-6 && moving && direction && guard++ < 8) {
      // At-center legality re-validation — mirrors the shipped `tick`: only
      // step into the tile ahead if it is enterable; otherwise re-decide, and
      // stop this frame if still blocked so the entity never enters a wall or
      // leaves the maze.
      {
        const { col, row } = grid.worldToTile(ent.x, ent.y);
        const c = grid.tileToWorld(col, row);
        const onCenter = Math.abs(ent.x - c.x) < 0.01 && Math.abs(ent.y - c.y) < 0.01;
        if (onCenter && !grid.attemptMove(col, row, direction).moved) {
          decide(col, row);
          if (!direction || !grid.attemptMove(col, row, direction).moved) {
            moving = false;
            break;
          }
        }
      }

      const targetCenter = nextCenterAhead(grid, ent.x, ent.y, direction);
      const remaining = Math.hypot(targetCenter.x - ent.x, targetCenter.y - ent.y);
      if (remaining <= budget) {
        ent.x = targetCenter.x;
        ent.y = targetCenter.y;
        grid.wrapIfTunnel(ent);
        budget -= remaining;
        const reached = grid.worldToTile(ent.x, ent.y);
        record(reached.col, reached.row);
        decide(reached.col, reached.row);
      } else {
        const d = DIRECTIONS[direction];
        ent.x += d.dx * budget;
        ent.y += d.dy * budget;
        grid.wrapIfTunnel(ent);
        budget = 0;
      }
    }
  }

  return { exited, distinctTiles: visited.size, minRow, maxRow, visited };
}

describe('Ghost house release (Bug B) — every ghost leaves the house and roams', () => {
  const grid = new MazeGrid();
  const personalities = ['chase', 'ambush', 'vector', 'scatter'];

  it('every personality from every real spawn exits and roams well beyond the house', () => {
    expect(grid.ghostSpawns.length).toBeGreaterThan(0);
    for (const personality of personalities) {
      for (const spawn of grid.ghostSpawns) {
        const { exited, distinctTiles, maxRow } = simulateGhostRelease(grid, spawn, {
          personality,
          frames: 2000,
        });
        // (a) it must clear the house, and (b) roam far below it and broadly.
        expect(exited, `${personality} @ (${spawn.col},${spawn.row}) exited`).toBe(true);
        expect(
          distinctTiles,
          `${personality} @ (${spawn.col},${spawn.row}) distinctTiles`,
        ).toBeGreaterThan(20);
        expect(
          maxRow,
          `${personality} @ (${spawn.col},${spawn.row}) maxRow`,
        ).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe('Ghost-house pure helpers', () => {
  const grid = new MazeGrid();
  const house = houseRegionFromGrid(grid);

  it('houseRegionFromGrid derives the enclosing region from the real spawns', () => {
    // Spawns are cols 12 & 15, rows 13 & 15 → expanded by one to 11..16 / 12..16.
    expect(house).toEqual({ minCol: 11, maxCol: 16, minRow: 12, maxRow: 16 });
  });

  it('isHouseTile is true inside the house and false outside', () => {
    // A spawn tile and the door interior are inside.
    expect(isHouseTile(house, 12, 13)).toBe(true);
    expect(isHouseTile(house, 15, 15)).toBe(true);
    expect(isHouseTile(house, 13, 12)).toBe(true); // door row
    // Tiles above the door and far away are outside.
    expect(isHouseTile(house, 13, 11)).toBe(false); // exit tile
    expect(isHouseTile(house, 1, 1)).toBe(false);
    expect(isHouseTile(house, 14, 23)).toBe(false); // Math Man spawn
  });

  it('ghostHouseExitTile returns the tile directly above the door', () => {
    const exit = ghostHouseExitTile(house);
    expect(exit).toEqual({ col: 13, row: 11 });
    // It must lie OUTSIDE the house so targeting it drives the ghost out.
    expect(isHouseTile(house, exit.col, exit.row)).toBe(false);
  });

  it('blockHouseReentry blocks a step INTO the house but delegates elsewhere', () => {
    const view = blockHouseReentry(grid, house);
    // From the exit tile (13,11), stepping DOWN would re-enter the house door
    // (13,12) — must be blocked (moved:false, position unchanged).
    const back = view.attemptMove(13, 11, 'down');
    expect(back).toEqual({ col: 13, row: 11, moved: false });

    // A normal legal step in open maze must pass through unchanged, matching
    // the real grid's result exactly.
    const openFrom = { col: 1, row: 1 };
    const real = grid.attemptMove(openFrom.col, openFrom.row, 'right');
    expect(real.moved).toBe(true);
    const viaView = view.attemptMove(openFrom.col, openFrom.row, 'right');
    expect(viaView).toEqual(real);

    // Passthrough of grid dimensions.
    expect(view.cols).toBe(grid.cols);
    expect(view.rows).toBe(grid.rows);
  });
});
