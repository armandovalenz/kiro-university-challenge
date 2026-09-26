// Property-based test for FP3D_Mode scoring/lives reuse (Task 10).
//
// FP3D_Mode is a rendering + input layer only: it MUST reuse the existing 2D
// scoring/lives systems rather than fork them. This test pins that contract by
// exercising the SAME modules the 2D game uses — `MazeGrid.pointsFor`,
// `ScoreSystem`, and `lifeCostFor` — with no FP3D-specific logic of its own.
//
// Framework-agnostic (no Phaser / Three.js): runs under Vitest with fast-check.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { POINTS, LIVES_START, LIVES_MAX } from '../../config.js';
import ScoreSystem from '../ScoreSystem.js';
import { lifeCostFor } from '../QuizSystem.js';
import { MazeGrid } from '../../maze/mazeLogic.js';
import { TILE, getLevelLayout } from '../../maze/mazeData.js';

// Feature: first-person-3d-mode, Property 7: Scoring and lives reuse matches the 2D rules — Validates: Requirements 5.1, 5.3, 5.4, 5.5
describe('Property 7: Scoring and lives reuse matches the 2D rules', () => {
  it('awards the existing POINTS value per item type via MazeGrid.pointsFor + ScoreSystem.addScore', () => {
    const grid = new MazeGrid({ layout: getLevelLayout() });

    // The two collectible tile codes MazeGrid.pointsFor discriminates on. A
    // pellet ('.') is worth POINTS.pellet; a power pellet ('o') POINTS.powerPellet.
    const pelletCodes = [TILE.PELLET, TILE.POWER_PELLET];

    fc.assert(
      fc.property(
        // A random sequence of collected items so the score must accumulate the
        // pointsFor value for EACH one exactly, not just for a single pickup.
        fc.array(fc.constantFrom(...pelletCodes), { minLength: 0, maxLength: 50 }),
        (codes) => {
          const score = new ScoreSystem();
          let expected = 0;

          for (const code of codes) {
            const points = grid.pointsFor(code);
            // pointsFor must return the existing POINTS value for the type.
            const expectedPoints =
              code === TILE.POWER_PELLET ? POINTS.powerPellet : POINTS.pellet;
            expect(points).toBe(expectedPoints);

            expected += points;
            const after = score.addScore(points);
            // addScore accumulates exactly the pointsFor value each time.
            expect(after).toBe(expected);
          }

          expect(score.score).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps lives within [0, LIVES_MAX] over any gainLife/loseLife sequence, starting at LIVES_START', () => {
    fc.assert(
      fc.property(
        // Random interleaving of life gains (fruit) and losses (wrong answers).
        fc.array(fc.constantFrom('gain', 'lose'), { minLength: 0, maxLength: 60 }),
        (ops) => {
          const score = new ScoreSystem();
          // Lives start at 6 (LIVES_START).
          expect(score.lives).toBe(LIVES_START);

          for (const op of ops) {
            if (op === 'gain') score.gainLife();
            else score.loseLife();
            // Invariant after every op: never above 10, never below 0.
            expect(score.lives).toBeLessThanOrEqual(LIVES_MAX);
            expect(score.lives).toBeGreaterThanOrEqual(0);
          }

          expect(score.lives).toBeLessThanOrEqual(LIVES_MAX);
          expect(score.lives).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('costs 0 lives for a correct answer and exactly 1 for a wrong answer (bounded at 0)', () => {
    fc.assert(
      fc.property(
        // A sequence of quiz outcomes (true = correct, false = wrong).
        fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
        (outcomes) => {
          const score = new ScoreSystem();
          let expected = LIVES_START;

          for (const correct of outcomes) {
            const cost = lifeCostFor(correct);
            // lifeCostFor: correct -> 0, wrong -> 1.
            expect(cost).toBe(correct ? 0 : 1);

            // Applying loseLife() `cost` times reduces lives by exactly that
            // amount, bounded at 0 (never negative).
            const before = score.lives;
            for (let i = 0; i < cost; i++) score.loseLife();

            expected = Math.max(0, before - cost);
            expect(score.lives).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
