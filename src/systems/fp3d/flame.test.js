// Property-based tests for the framework-agnostic torch flame maths
// (mandatory PBT — see .kiro/steering/testing.md). Visual quality of the
// flame is checked in the browser; these pin the numeric contract the
// renderer relies on (bounded, looping, fading, reduced-motion safe).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { makeFlameSeeds, flameParticle, flameColor, flicker } from './flame.js';
import { seededRandom } from './wallDecor.js';

const unit = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
const time = fc.double({ min: 0, max: 1e5, noNaN: true });
const seedArb = fc.record({
  phase: unit,
  speed: fc.double({ min: 0.1, max: 5, noNaN: true }),
  angle: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
  spread: fc.double({ min: 0, max: 1, noNaN: true }),
});
const shapeArb = fc.record({
  height: fc.double({ min: 0.01, max: 100, noNaN: true }),
  radius: fc.double({ min: 0, max: 50, noNaN: true }),
  sway: fc.double({ min: 0, max: 20, noNaN: true }),
});

describe('flameParticle — particles stay inside the flame envelope', () => {
  it('life is in [0, 1), height follows life, and sideways offset is bounded', () => {
    fc.assert(
      fc.property(seedArb, time, shapeArb, (seed, t, shape) => {
        const p = flameParticle(seed, t, shape);
        expect(p.life).toBeGreaterThanOrEqual(0);
        expect(p.life).toBeLessThan(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(shape.height);
        expect(p.y).toBeCloseTo(shape.height * p.life, 6);
        const eps = 1e-9 * (1 + shape.radius + shape.sway);
        // Radius tapers with life; sway peaks at 0.5 * sway mid-flame.
        const bound = shape.radius * (1 - p.life) + shape.sway * 0.5;
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(bound + eps);
      }),
    );
  });

  it('is a pure function of time (same inputs → same particle)', () => {
    fc.assert(
      fc.property(seedArb, time, shapeArb, (seed, t, shape) => {
        expect(flameParticle(seed, t, shape)).toEqual(flameParticle(seed, t, shape));
      }),
    );
  });
});

describe('flameColor — fades out and never brightens over a life', () => {
  it('components are in [0, 1] and each is non-increasing with life', () => {
    fc.assert(
      fc.property(unit, unit, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const c0 = flameColor(lo);
        const c1 = flameColor(hi);
        for (const k of ['r', 'g', 'b']) {
          expect(c0[k]).toBeGreaterThanOrEqual(0);
          expect(c0[k]).toBeLessThanOrEqual(1);
          expect(c1[k]).toBeLessThanOrEqual(c0[k] + 1e-12);
        }
      }),
    );
  });

  it('is fully faded (black, invisible when additive) at the end of life', () => {
    const c = flameColor(1);
    expect(c.r + c.g + c.b).toBe(0);
  });
});

describe('flicker — bounded, and exactly steady under reduced motion', () => {
  it('stays within [1 − amount, 1 + amount]', () => {
    fc.assert(
      fc.property(time, fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }), (t, off, amt) => {
          const f = flicker(t, off, amt);
          expect(f).toBeGreaterThanOrEqual(1 - amt - 1e-12);
          expect(f).toBeLessThanOrEqual(1 + amt + 1e-12);
        }),
    );
  });

  it('returns 1 when reduced motion is on (Req 7.4)', () => {
    fc.assert(
      fc.property(time, fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }), (t, off, amt) => {
          expect(flicker(t, off, amt, true)).toBe(1);
        }),
    );
  });
});

describe('makeFlameSeeds — valid, deterministic per-particle constants', () => {
  it('returns `count` seeds in range, identical for the same RNG seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 64 }), fc.integer(), (count, s) => {
        const a = makeFlameSeeds(count, seededRandom(s));
        const b = makeFlameSeeds(count, seededRandom(s));
        expect(a).toEqual(b);
        expect(a).toHaveLength(count);
        for (const k of a) {
          expect(k.phase).toBeGreaterThanOrEqual(0);
          expect(k.phase).toBeLessThan(1);
          expect(k.speed).toBeGreaterThan(0);
          expect(k.spread).toBeGreaterThanOrEqual(0);
          expect(k.spread).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});
