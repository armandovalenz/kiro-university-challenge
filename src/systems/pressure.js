// Pressure music logic — framework-agnostic (no Phaser / Three.js).
//
// "Pressure" is when a ghost is close to Math Man by WALKING distance through
// the maze (walls block it; the tunnel wraps), not straight-line distance, so a
// ghost behind a wall doesn't count. Instead of switching tracks, the score
// music speeds up (playback rate, which also raises the pitch) the closer the
// nearest ghost gets, and eases back when it leaves. The ramp is rate-limited
// so the change is always gradual. Property-tested in `pressure.test.js`.

import { DIRECTIONS } from '../maze/mazeLogic.js';

const DIRS = Object.keys(DIRECTIONS);

/**
 * Shortest walking distance (in tiles) from `from` to the nearest ghost, found
 * by breadth-first search over enterable tiles using the grid's own move rules
 * (`MazeGrid.attemptMove`, which handles walls and tunnel wrap). The search
 * stops after `maxSteps`; no ghost within that range → `Infinity`.
 * @param {import('../maze/mazeLogic.js').MazeGrid} grid
 * @param {{col:number,row:number}} from Math Man's tile
 * @param {Array<{col:number,row:number}>} ghosts ghost tiles
 * @param {number} maxSteps search radius in tiles (>= 0)
 * @returns {number} 0..maxSteps, or Infinity
 */
export function nearestGhostPathDistance(grid, from, ghosts, maxSteps) {
  if (!ghosts || ghosts.length === 0) return Infinity;
  const targets = new Set(ghosts.map((g) => `${g.col},${g.row}`));
  const startKey = `${from.col},${from.row}`;
  if (targets.has(startKey)) return 0;

  const seen = new Set([startKey]);
  let frontier = [{ col: from.col, row: from.row }];
  for (let d = 1; d <= maxSteps && frontier.length; d++) {
    const next = [];
    for (const t of frontier) {
      for (const dir of DIRS) {
        const m = grid.attemptMove(t.col, t.row, dir);
        if (!m.moved) continue;
        const key = `${m.col},${m.row}`;
        if (seen.has(key)) continue;
        if (targets.has(key)) return d;
        seen.add(key);
        next.push({ col: m.col, row: m.row });
      }
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * Target playback rate for the score music given the nearest ghost's walking
 * distance: 1 (normal) at or beyond `startTiles`, rising to `maxRate` as the
 * ghost closes to 0 tiles. The rise follows `closeness ^ curve`: with
 * `curve > 1` it barely moves while the ghost is still a few tiles off, then
 * climbs steeply in the last tile or two before it touches Math Man.
 * @param {number} distance tiles (Infinity when no ghost is in range)
 * @param {{startTiles:number, maxRate:number, curve?:number}} cfg
 *   `startTiles > 0`, `maxRate >= 1`, `curve >= 1` (default 1 = linear)
 * @returns {number} in [1, maxRate]
 */
export function pressureTargetRate(distance, cfg) {
  if (!(distance < cfg.startTiles)) return 1; // also handles Infinity / NaN
  const closeness = 1 - Math.max(0, distance) / cfg.startTiles; // 0 → 1
  const curve = cfg.curve && cfg.curve > 0 ? cfg.curve : 1;
  return 1 + (cfg.maxRate - 1) * closeness ** curve;
}

/**
 * Move `current` toward `target` by at most `upPerSec` (speeding up) or
 * `downPerSec` (slowing down) per second over `dtMs`, never overshooting. This
 * is what makes the tempo change gradual.
 * @param {number} current
 * @param {number} target
 * @param {number} dtMs frame time (>= 0)
 * @param {{rampUpPerSec:number, rampDownPerSec:number}} cfg
 * @returns {number}
 */
export function approachRate(current, target, dtMs, cfg) {
  const dt = Math.max(0, dtMs) / 1000;
  if (target > current) return Math.min(target, current + cfg.rampUpPerSec * dt);
  if (target < current) return Math.max(target, current - cfg.rampDownPerSec * dt);
  return current;
}
