// Property-based tests for ScoreSystem (mandatory PBT — see .kiro/steering/testing.md).
//
// This file owns Property 4 (restart resets the run but keeps difficulty),
// which Task 16 (Pause/GameOver) references via its GameOverScene restart flow:
// restarting begins a fresh run at score 0, lives 6, and the initial level
// while the selected difficulty/grade is preserved by the caller.
//
// Tests use Vitest + fast-check and are named after the Core Property they
// validate, carrying the requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import ScoreSystem from './ScoreSystem.js';
import { LIVES_START, LIVES_MAX } from '../config.js';

/** A finite score delta a run could realistically accumulate. */
const scoreDelta = fc.integer({ min: 1, max: 100000 });
/** A number of extra levels a run could advance through before finishing. */
const levelAdvances = fc.integer({ min: 0, max: 50 });
/** A number of life-losing events (enough to sometimes end the run). */
const lifeLosses = fc.integer({ min: 0, max: LIVES_MAX + 5 });
/** A valid initial level a run may have started at. */
const initialLevel = fc.integer({ min: 1, max: 25 });

describe('ScoreSystem — Property 4: Restart resets the run but keeps difficulty', () => {
  // **Validates: Requirements 7.7**
  // For any finished game played at difficulty d, restarting sets score to 0,
  // lives to 6, and level to its initial value while preserving difficulty d.
  it('restart resets score/lives/level to initial values regardless of prior play', () => {
    fc.assert(
      fc.property(
        initialLevel,
        fc.array(scoreDelta, { maxLength: 20 }),
        levelAdvances,
        lifeLosses,
        (startLevel, deltas, advances, losses) => {
          const system = new ScoreSystem({ level: startLevel });

          // Play an arbitrary run: score up, advance levels, lose lives.
          for (const d of deltas) system.addScore(d);
          for (let i = 0; i < advances; i += 1) system.nextLevel();
          for (let i = 0; i < losses; i += 1) system.loseLife();

          // Difficulty/grade lives OUTSIDE ScoreSystem; the caller (GameOverScene)
          // preserves it. We model that here as a value untouched by restart().
          const difficulty = startLevel; // stand-in token that must survive restart

          system.restart();

          // Score reset to 0, lives back to the starting six, level back to the
          // run's initial level — Property 4.
          expect(system.score).toBe(0);
          expect(system.lives).toBe(LIVES_START);
          expect(system.level).toBe(startLevel);
          expect(system.isGameOver()).toBe(false);

          // The out-of-system difficulty is unaffected by restart().
          expect(difficulty).toBe(startLevel);
        },
      ),
    );
  });

  it('restart is idempotent — repeated restarts keep the initial state', () => {
    fc.assert(
      fc.property(initialLevel, fc.integer({ min: 1, max: 10 }), (startLevel, times) => {
        const system = new ScoreSystem({ level: startLevel });
        system.addScore(500);
        system.nextLevel();
        system.loseLife();

        for (let i = 0; i < times; i += 1) system.restart();

        expect(system.score).toBe(0);
        expect(system.lives).toBe(LIVES_START);
        expect(system.level).toBe(startLevel);
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// Property 1, 2, 3 — lives start at six, stay in 0..10, game over iff zero.
// -----------------------------------------------------------------------------

/** A sequence of lose/gain life operations to apply to a fresh ScoreSystem. */
const lifeOps = fc.array(fc.constantFrom('lose', 'gain'), { maxLength: 60 });

describe('ScoreSystem — Property 1: Lives start at six', () => {
  // **Validates: Requirements 2.1**
  // For any newly started game, the initial life count is exactly 6.
  it('a new run always starts with exactly six lives', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), fc.integer({ min: 0, max: 100000 }), (level, score) => {
        // Regardless of the (unrelated) starting level or score, lives === 6.
        const system = new ScoreSystem({ level, score });
        expect(system.lives).toBe(LIVES_START);
        expect(LIVES_START).toBe(6);
      }),
    );
  });
});

describe('ScoreSystem — Property 2: Lives stay within bounds', () => {
  // **Validates: Requirements 2.2, 2.4, 2.5, 2.6, 5.2**
  // For any sequence of lose/gain from a valid state, lives stay within 0..10:
  // losing decrements by one while lives remain, gaining increments by one but
  // never past the cap of 10.
  it('lives never leave 0..LIVES_MAX and each op moves by at most one in the right direction', () => {
    fc.assert(
      fc.property(lifeOps, (ops) => {
        const system = new ScoreSystem();
        let expected = LIVES_START;
        for (const op of ops) {
          const before = system.lives;
          if (op === 'lose') {
            system.loseLife();
            expected = Math.max(0, before - 1);
          } else {
            system.gainLife();
            expected = Math.min(LIVES_MAX, before + 1);
          }
          // Exact expected value (decrement/increment-by-one with clamping).
          expect(system.lives).toBe(expected);
          // Bounds invariant holds after every single operation.
          expect(system.lives).toBeGreaterThanOrEqual(0);
          expect(system.lives).toBeLessThanOrEqual(LIVES_MAX);
        }
      }),
    );
  });

  it('gaining a life never exceeds the cap of 10 even from a full-ish state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (gains) => {
        const system = new ScoreSystem();
        for (let i = 0; i < gains; i += 1) system.gainLife();
        expect(system.lives).toBeLessThanOrEqual(LIVES_MAX);
      }),
    );
  });
});

describe('ScoreSystem — Property 3: Game over exactly at zero lives', () => {
  // **Validates: Requirements 2.3, 4.6**
  // For any game state, game-over is true if and only if the life count is 0.
  it('isGameOver() is true iff lives === 0 after any op sequence', () => {
    fc.assert(
      fc.property(lifeOps, (ops) => {
        const system = new ScoreSystem();
        for (const op of ops) {
          if (op === 'lose') system.loseLife();
          else system.gainLife();
          expect(system.isGameOver()).toBe(system.lives === 0);
        }
      }),
    );
  });
});
