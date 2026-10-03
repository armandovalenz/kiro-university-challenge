// Property-based tests for KnowledgePower — the Knowledge Power charge meter
// (mandatory PBT — see .kiro/steering/testing.md).
//
// Feature: Knowledge Power — book projectile charge meter.
// Owns KP-1..KP-4: the level is always an integer in [0, max]; a throw below
// cost never goes negative and reports it did not fire; a successful throw
// subtracts exactly `cost`; refill/reset always yield exactly max and a new
// meter starts at max. Vitest + fast-check, named after the property.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import KnowledgePower, { KNOWLEDGE_MAX, KNOWLEDGE_THROW_COST } from './KnowledgePower.js';
import { KNOWLEDGE } from '../config.js';

// A sequence of operations to apply to a meter: throw, refill, or reset.
const opArb = fc.constantFrom('throw', 'refill', 'reset');
const opsArb = fc.array(opArb, { minLength: 0, maxLength: 60 });

/** Apply one op to a KnowledgePower instance. */
function applyOp(kp, op) {
  if (op === 'throw') return kp.throw();
  if (op === 'refill') return kp.refillToMax();
  return kp.reset();
}

describe('KnowledgePower — KP-4: a new meter starts full at max — Validates: Knowledge Power', () => {
  it('starts at max (default = config KNOWLEDGE.max) and exposes cost', () => {
    const kp = new KnowledgePower();
    expect(kp.level).toBe(kp.max);
    expect(kp.max).toBe(KNOWLEDGE.max);
    expect(KNOWLEDGE_MAX).toBe(KNOWLEDGE.max);
    expect(kp.cost).toBe(KNOWLEDGE.throwCost);
    expect(KNOWLEDGE_THROW_COST).toBe(KNOWLEDGE.throwCost);
  });

  it('starts full for any valid custom max/cost', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 10 }), (max, cost) => {
        const kp = new KnowledgePower({ max, throwCost: cost });
        expect(kp.max).toBe(max);
        expect(kp.level).toBe(max);
        expect(kp.cost).toBe(cost);
      }),
    );
  });
});

describe('KnowledgePower — KP-1: level is always an integer in [0, max] — Validates: Knowledge Power', () => {
  it('holds for any sequence of throw/refill/reset', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 5 }), opsArb,
        (max, cost, ops) => {
          const kp = new KnowledgePower({ max, throwCost: cost });
          for (const op of ops) {
            applyOp(kp, op);
            expect(Number.isInteger(kp.level)).toBe(true);
            expect(kp.level).toBeGreaterThanOrEqual(0);
            expect(kp.level).toBeLessThanOrEqual(max);
            // fraction() tracks the level and stays in [0,1].
            expect(kp.fraction()).toBeCloseTo(kp.level / max, 10);
            expect(kp.fraction()).toBeGreaterThanOrEqual(0);
            expect(kp.fraction()).toBeLessThanOrEqual(1);
          }
        }),
    );
  });

  it('a bad/clamped starting level is coerced into [0, max] as an integer', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.double({ min: -50, max: 100, noNaN: true }),
        (max, start) => {
          const kp = new KnowledgePower({ max, level: start });
          expect(Number.isInteger(kp.level)).toBe(true);
          expect(kp.level).toBeGreaterThanOrEqual(0);
          expect(kp.level).toBeLessThanOrEqual(max);
        }),
    );
  });
});

describe('KnowledgePower — KP-2: a throw below cost never goes negative and does not fire — Validates: Knowledge Power', () => {
  it('canThrow() ⇔ level >= cost, and a throw at < cost is a no-op returning false', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 6 }), opsArb,
        (max, cost, ops) => {
          const kp = new KnowledgePower({ max, throwCost: cost });
          for (const op of ops) applyOp(kp, op);

          const could = kp.canThrow();
          expect(could).toBe(kp.level >= cost);

          const before = kp.level;
          const fired = kp.throw();
          expect(fired).toBe(could);
          if (!could) {
            // Below cost: nothing changed and it never went negative.
            expect(kp.level).toBe(before);
            expect(kp.level).toBeGreaterThanOrEqual(0);
          }
        }),
    );
  });

  it('throwing repeatedly from empty never drops below 0 and always reports false', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 30 }),
        (max, cost, extra) => {
          const kp = new KnowledgePower({ max, throwCost: cost, level: 0 });
          for (let i = 0; i < extra; i++) {
            expect(kp.canThrow()).toBe(false);
            expect(kp.throw()).toBe(false);
            expect(kp.level).toBe(0);
          }
        }),
    );
  });
});

describe('KnowledgePower — KP-3: a successful throw subtracts exactly cost — Validates: Knowledge Power', () => {
  it('each firing throw lowers the level by exactly cost', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 5 }), opsArb,
        (max, cost, ops) => {
          const kp = new KnowledgePower({ max, throwCost: cost });
          for (const op of ops) applyOp(kp, op);
          const before = kp.level;
          const fired = kp.throw();
          if (fired) expect(kp.level).toBe(before - cost);
          else expect(kp.level).toBe(before);
        }),
    );
  });
});

describe('KnowledgePower — KP-4: refill/reset always yield exactly max — Validates: Knowledge Power', () => {
  it('refillToMax() and reset() set the level to exactly max, never exceeding it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 5 }), opsArb, fc.boolean(),
        (max, cost, ops, useReset) => {
          const kp = new KnowledgePower({ max, throwCost: cost });
          for (const op of ops) applyOp(kp, op);
          const result = useReset ? kp.reset() : kp.refillToMax();
          expect(result).toBe(max);
          expect(kp.level).toBe(max);
          expect(kp.fraction()).toBe(1);
        }),
    );
  });
});
