// Property-based tests for the framework-agnostic cover-crop helper used by the
// FP3D portrait pictures (mandatory PBT — see .kiro/steering/testing.md).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { coverCropRect } from './imageCrop.js';

const dim = fc.integer({ min: 1, max: 8000 });
const aspect = fc.double({ min: 0.05, max: 20, noNaN: true });
const focus = fc.double({ min: 0, max: 1, noNaN: true });

describe('coverCropRect — crop keeps the target aspect, stays in bounds, and is maximal', () => {
  it('never stretches, never leaves the image, and spans one full side', () => {
    fc.assert(
      fc.property(dim, dim, aspect, focus, focus, (w, h, a, fx, fy) => {
        const { sx, sy, sw, sh } = coverCropRect(w, h, a, fx, fy);
        const eps = 1e-6 * Math.max(w, h);

        // Inside the image.
        expect(sx).toBeGreaterThanOrEqual(-eps);
        expect(sy).toBeGreaterThanOrEqual(-eps);
        expect(sx + sw).toBeLessThanOrEqual(w + eps);
        expect(sy + sh).toBeLessThanOrEqual(h + eps);

        // Exact target aspect (no stretching when drawn to a target-sized canvas).
        expect(Math.abs(sw / sh - a)).toBeLessThanOrEqual(1e-9 * Math.max(1, a));

        // Maximal: one side uses the full image dimension.
        const fullW = Math.abs(sw - w) <= eps;
        const fullH = Math.abs(sh - h) <= eps;
        expect(fullW || fullH).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('centres the crop at focus 0.5', () => {
    fc.assert(
      fc.property(dim, dim, aspect, (w, h, a) => {
        const { sx, sy, sw, sh } = coverCropRect(w, h, a);
        const eps = 1e-6 * Math.max(w, h);
        expect(Math.abs(sx - (w - (sx + sw)))).toBeLessThanOrEqual(eps);
        expect(Math.abs(sy - (h - (sy + sh)))).toBeLessThanOrEqual(eps);
      }),
      { numRuns: 200 },
    );
  });
});
