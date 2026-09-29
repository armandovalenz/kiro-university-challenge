// Property-based tests for the framework-agnostic FP3D gesture classifier
// (mandatory PBT — see .kiro/steering/testing.md). Uses Vitest + fast-check,
// runs at >= 100 cases per property, and carries the requirement trace on each
// property. Covers design Correctness Properties 5 and 6 for
// `gestureClassifier.classifyGesture`.
//
// These tests never mock: they drive the real classifier with synthetic
// {x, y, t} sample sequences and assert the specified universal behavior. The
// expected Flick/Drag split is recomputed from the SAME quantities the
// implementation uses (elapsed dt, straight-line dist, angle-from-horizontal)
// so the sharp-boundary assertion stays exact at the threshold edges rather
// than drifting on floating-point rounding.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GESTURE } from '../../config.js';
import { GESTURES, classifyGesture } from './gestureClassifier.js';

const GESTURE_SET = new Set(GESTURES);
const DEG = Math.PI / 180;

/**
 * Build an ordered two-sample sequence (first + last) that realizes a chosen
 * elapsed time, travel distance, and angle-from-horizontal. Screen coords, so a
 * positive/negative dx picks the horizontal side; the angle magnitude sets how
 * far off horizontal the travel is. A start point and timestamp offset keep the
 * generator from always anchoring at the origin / t=0.
 */
function buildMovingSamples({ startX, startY, startT, duration, distance, angleFromHorizontalDeg, side }) {
  const a = angleFromHorizontalDeg * DEG;
  const dx = Math.cos(a) * distance * (side < 0 ? -1 : 1);
  const dy = Math.sin(a) * distance; // sign of dy is irrelevant to the classifier's angle test
  return [
    { x: startX, y: startY, t: startT },
    { x: startX + dx, y: startY + dy, t: startT + duration },
  ];
}

/**
 * Recompute the classifier's own decision quantities from a sample pair, so the
 * test's expectation is derived from identical math (no re-derivation drift).
 */
function decisionQuantities(samples) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = Math.hypot(dx, dy);
  const dt = last.t - first.t;
  const angleFromHorizontalDeg = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
  return { dx, dy, dist, dt, angleFromHorizontalDeg };
}

describe('gestureClassifier — Property 5: single-valued with a sharp Flick/Drag boundary', () => {
  // Feature: mobile-gestures-fullscreen, Property 5: Gesture classification is single-valued with a sharp Flick/Drag boundary — Validates: Requirements 11.6, 4.1, 4.5, 4.6
  it('returns exactly one GESTURES member, and a moving interaction is Flick iff duration<=bound AND distance>=bound AND angle within band, else Drag', () => {
    const t = GESTURE;

    // A generator that spans stationary (tap/hold/long-press) and moving
    // (flick/drag) interactions, and — critically — lands ON the exact bounds
    // (duration == flickDurationMs, distance == flickDistanceDip,
    // angle == flickAngleBandDeg) so the sharp boundary is exercised.
    const movingArb = fc.record({
      startX: fc.integer({ min: -500, max: 500 }),
      startY: fc.integer({ min: -500, max: 500 }),
      startT: fc.integer({ min: 0, max: 100000 }),
      // durations straddling flickDurationMs (150), including the exact bound.
      duration: fc.oneof(
        fc.constant(t.flickDurationMs), // exact bound
        fc.integer({ min: 0, max: t.flickDurationMs }), // <= bound
        fc.integer({ min: t.flickDurationMs + 1, max: 4000 }), // > bound
      ),
      // distances straddling flickDistanceDip (48) but always >= move tolerance
      // (12) so the interaction is genuinely "moving".
      distance: fc.oneof(
        fc.constant(t.flickDistanceDip), // exact bound
        fc.double({ min: t.tapMoveToleranceDip, max: t.flickDistanceDip, noNaN: true }),
        fc.double({ min: t.flickDistanceDip, max: 1500, noNaN: true }),
      ),
      // angles straddling flickAngleBandDeg (30), including the exact bound.
      angleFromHorizontalDeg: fc.oneof(
        fc.constant(t.flickAngleBandDeg), // exact bound
        fc.double({ min: 0, max: t.flickAngleBandDeg, noNaN: true }),
        fc.double({ min: t.flickAngleBandDeg, max: 90, noNaN: true }),
      ),
      side: fc.constantFrom(-1, 1),
    });

    // Stationary variants: taps, holds, and long presses (dist < move tolerance).
    const stationaryArb = fc.record({
      startX: fc.integer({ min: -500, max: 500 }),
      startY: fc.integer({ min: -500, max: 500 }),
      startT: fc.integer({ min: 0, max: 100000 }),
      jitter: fc.double({ min: 0, max: t.tapMoveToleranceDip, noNaN: true }),
      duration: fc.integer({ min: 0, max: 2000 }),
    });

    // Double-tap context: a previous tap near this interaction's start.
    const ctxArb = fc.option(
      fc.record({
        prevTapAt: fc.integer({ min: 0, max: 100000 }),
        offX: fc.double({ min: -20, max: 20, noNaN: true }),
        offY: fc.double({ min: -20, max: 20, noNaN: true }),
      }),
      { nil: null },
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ kind: fc.constant('moving'), spec: movingArb, ctx: ctxArb }),
          fc.record({ kind: fc.constant('stationary'), spec: stationaryArb, ctx: ctxArb }),
        ),
        ({ kind, spec, ctx }) => {
          let samples;
          if (kind === 'moving') {
            samples = buildMovingSamples(spec);
          } else {
            // A stationary interaction: last point within move tolerance of the
            // first, so dist < tapMoveToleranceDip regardless of the classifier.
            const angle = 0; // direction is irrelevant when it stays within tolerance
            const dx = Math.cos(angle) * spec.jitter;
            const dy = Math.sin(angle) * spec.jitter;
            samples = [
              { x: spec.startX, y: spec.startY, t: spec.startT },
              { x: spec.startX + dx, y: spec.startY + dy, t: spec.startT + spec.duration },
            ];
          }

          // Materialize the double-tap context relative to this sample's start.
          const start = samples[0];
          const realCtx = ctx
            ? { prevTapAt: ctx.prevTapAt, prevTapPos: { x: start.x + ctx.offX, y: start.y + ctx.offY } }
            : null;

          const result = classifyGesture(samples, t, realCtx);

          // (a) Single-valued: exactly one member of GESTURES.
          expect(typeof result.gesture).toBe('string');
          expect(GESTURE_SET.has(result.gesture)).toBe(true);

          // (b) Sharp Flick/Drag boundary for a MOVING interaction.
          const { dx, dist, dt, angleFromHorizontalDeg } = decisionQuantities(samples);
          if (dist >= t.tapMoveToleranceDip) {
            const shouldFlick =
              dt <= t.flickDurationMs &&
              dist >= t.flickDistanceDip &&
              angleFromHorizontalDeg <= t.flickAngleBandDeg;

            if (shouldFlick) {
              expect(result.gesture).toBe('Flick');
              // direction follows the sign of dx.
              expect(result.direction).toBe(dx < 0 ? 'left' : 'right');
            } else {
              expect(result.gesture).toBe('Drag');
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('gestureClassifier — Property 6: classification is deterministic', () => {
  // Feature: mobile-gestures-fullscreen, Property 6: Gesture classification is deterministic — Validates: Requirements 11.7
  it('yields deeply-equal output when classifyGesture is evaluated twice on identical input', () => {
    // Arbitrary ordered sample sequences of any length (including empty and
    // single-sample), spanning the full input space.
    const sampleArb = fc.record({
      x: fc.double({ min: -2000, max: 2000, noNaN: true }),
      y: fc.double({ min: -2000, max: 2000, noNaN: true }),
      t: fc.integer({ min: 0, max: 200000 }),
    });

    const ctxArb = fc.option(
      fc.record({
        prevTapAt: fc.option(fc.integer({ min: 0, max: 200000 }), { nil: null }),
        prevTapPos: fc.option(
          fc.record({
            x: fc.double({ min: -2000, max: 2000, noNaN: true }),
            y: fc.double({ min: -2000, max: 2000, noNaN: true }),
          }),
          { nil: null },
        ),
      }),
      { nil: null },
    );

    fc.assert(
      fc.property(fc.array(sampleArb, { maxLength: 40 }), ctxArb, (samples, ctx) => {
        const a = classifyGesture(samples, GESTURE, ctx);
        const b = classifyGesture(samples, GESTURE, ctx);
        expect(a).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });
});
