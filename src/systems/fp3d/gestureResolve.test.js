// Property-based tests for the framework-agnostic FP3D gesture resolver
// (mandatory PBT — see .kiro/steering/testing.md). Uses Vitest + fast-check,
// runs at >= 100 cases each, and carries the requirement trace on every
// property. Covers design Correctness Properties 1–4 for `gestureResolve.js`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GESTURE } from '../../config.js';
import {
  MOVE_INTENTS,
  resolveMovementVector,
  resolveFlickTurn,
} from './gestureResolve.js';
import { turnLeft, turnRight, CARDINALS } from './fp3dLogic.js';

const DEG_TO_RAD = Math.PI / 180;
const CARDINAL_SET = new Set(['north', 'east', 'south', 'west']);

// Screen-coordinate convention of the module under test: x grows right, y grows
// DOWN, so straight up is -y and every angle is the deviation from straight up.
// Convert a compass angle measured clockwise FROM straight up into {x, y}:
//   angleDeg = 0   -> straight up    (0, -mag)
//   angleDeg = 90  -> right          (+mag, 0)
//   angleDeg = 180 -> straight down  (0, +mag)
//   angleDeg = 270 -> left           (-mag, 0)
// This matches the module's deviationFromUp = |atan2(x, -y)|.
function vectorFromUp(angleDeg, magnitude) {
  const rad = angleDeg * DEG_TO_RAD;
  return {
    x: magnitude * Math.sin(rad),
    y: -magnitude * Math.cos(rad),
  };
}

const { movementDeadzonePx, forwardAssistConeDeg, cardinalSectorDeg } = GESTURE;

describe('gestureResolve — Property 1: movement resolution is total and single-valued at/above the deadzone', () => {
  // Feature: mobile-gestures-fullscreen, Property 1: Movement-vector resolution is total and single-valued at or above the deadzone — Validates: Requirements 11.2, 2.1, 2.2, 2.3, 2.4
  it('returns exactly one move outcome whose intent is one of MOVE_INTENTS, diagonal steps dominant-axis-first', () => {
    fc.assert(
      fc.property(
        // Full circle of directions, including the ±45° sector boundaries that
        // separate cardinal from diagonal, expressed as a compass angle from up.
        fc.oneof(
          fc.double({ min: 0, max: 360, noNaN: true, noDefaultInfinity: true }),
          fc.constantFrom(45, 135, 225, 315, 90, 180, 270, 0, 360),
        ),
        // Magnitude at or above the deadzone, up to a large drag.
        fc.double({
          min: movementDeadzonePx,
          max: 5000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (rawAngle, magnitude) => {
          const angleDeg = rawAngle % 360;
          const { x, y } = vectorFromUp(angleDeg, magnitude);
          const outcome = resolveMovementVector({ x, y });

          // Exactly one MOVE outcome (never steer) at/above the deadzone.
          expect(outcome.kind).toBe('move');
          // Single-valued intent drawn from the declared MOVE_INTENTS set.
          expect(MOVE_INTENTS).toContain(outcome.intent);
          expect(Array.isArray(outcome.steps)).toBe(true);

          if (outcome.intent === 'diagonal') {
            // A diagonal carries exactly its two nearest cardinal move steps,
            // neither of which is 'diagonal'.
            expect(outcome.steps).toHaveLength(2);
            for (const step of outcome.steps) {
              expect(MOVE_INTENTS).toContain(step);
              expect(step).not.toBe('diagonal');
            }
            // Dominant axis first: the leading step matches the axis with the
            // larger absolute component (vertical -> forward/backward,
            // horizontal -> strafe-left/strafe-right).
            const vertical = y <= 0 ? 'forward' : 'backward';
            const horizontal = x < 0 ? 'strafe-left' : 'strafe-right';
            const expected =
              Math.abs(x) > Math.abs(y)
                ? [horizontal, vertical]
                : [vertical, horizontal];
            expect(outcome.steps).toEqual(expected);
          } else {
            // A cardinal move carries a single step equal to its own intent.
            expect(outcome.steps).toEqual([outcome.intent]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('gestureResolve — Property 2: below the deadzone resolves to steer, never a move', () => {
  // Feature: mobile-gestures-fullscreen, Property 2: Below the deadzone resolves to steer, never a move — Validates: Requirements 11.3, 2.8
  it('always returns a steer toward a nearest cardinal for any sub-deadzone vector, including zero-length', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true, noDefaultInfinity: true }),
        // Strictly below the deadzone, including zero-length. Cap just under the
        // deadzone so the generated magnitude can never reach it.
        fc.double({
          min: 0,
          max: movementDeadzonePx,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        fc.boolean(),
        (rawAngle, rawMag, forceZero) => {
          // Ensure the magnitude is strictly below the deadzone; the generator's
          // inclusive max is nudged below and zero is exercised explicitly.
          const magnitude = forceZero
            ? 0
            : Math.min(rawMag, movementDeadzonePx * (1 - 1e-9));
          const angleDeg = rawAngle % 360;
          const { x, y } = vectorFromUp(angleDeg, magnitude);

          // Guard: the constructed magnitude must truly be below the deadzone.
          expect(Math.hypot(x, y)).toBeLessThan(movementDeadzonePx);

          const outcome = resolveMovementVector({ x, y });

          expect(outcome.kind).toBe('steer');
          expect(outcome.intent).toBeUndefined();
          expect(CARDINAL_SET.has(outcome.toward)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('gestureResolve — Property 3: forward-assist cone snaps to forward', () => {
  // Feature: mobile-gestures-fullscreen, Property 3: Forward-assist cone snaps to forward — Validates: Requirements 11.4, 3.1, 3.3
  it('resolves any at/above-deadzone vector within ±cone of straight up to the forward move intent', () => {
    fc.assert(
      fc.property(
        // Deviation from straight up within ±cone, boundary inside. Signed so
        // both sides of straight up are exercised; ±cone exact bounds included.
        fc.oneof(
          fc.double({
            min: -forwardAssistConeDeg,
            max: forwardAssistConeDeg,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          fc.constantFrom(
            -forwardAssistConeDeg,
            forwardAssistConeDeg,
            0,
          ),
        ),
        fc.double({
          min: movementDeadzonePx,
          max: 5000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (deviationDeg, magnitude) => {
          // A signed deviation from up maps directly to a compass angle: a
          // negative deviation swings to the left of up (equivalent compass
          // angle 360 + deviation), a positive one to the right.
          const angleDeg = (deviationDeg + 360) % 360;
          const { x, y } = vectorFromUp(angleDeg, magnitude);
          const outcome = resolveMovementVector({ x, y });

          expect(outcome.kind).toBe('move');
          expect(outcome.intent).toBe('forward');
          expect(outcome.intent).not.toBe('diagonal');
          expect(outcome.intent).not.toBe('strafe-left');
          expect(outcome.intent).not.toBe('strafe-right');
          expect(outcome.steps).toEqual(['forward']);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('gestureResolve — Property 4: turn resolution yields exactly one cardinal', () => {
  // Feature: mobile-gestures-fullscreen, Property 4: Turn resolution yields exactly one cardinal — Validates: Requirements 11.5, 4.2, 4.3, 4.4
  it('resolveFlickTurn returns exactly one cardinal: counter-clockwise for left, clockwise for right, by one step', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CARDINALS),
        fc.constantFrom('left', 'right'),
        (facing, direction) => {
          const result = resolveFlickTurn(facing, direction);

          // Exactly one cardinal: a single string from the cardinal set.
          expect(typeof result).toBe('string');
          expect(CARDINAL_SET.has(result)).toBe(true);

          // One step in the correct rotational sense, matching the existing
          // fp3dLogic turn helpers the resolver delegates to.
          const expected =
            direction === 'left' ? turnLeft(facing) : turnRight(facing);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
