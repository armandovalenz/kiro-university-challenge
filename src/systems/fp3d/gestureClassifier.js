// Framework-agnostic gesture classifier for FP3D_Mode one-thumb touch controls.
//
// NO Phaser and NO Three.js imports (Req 11.1) — this module turns an ordered
// sequence of raw touch samples ({x, y, t} in device-independent pixels and
// milliseconds) into exactly ONE classified Gesture, so it stays unit- and
// property-testable without a browser, Phaser, or Three.js runtime. It imports
// only the shared `config.js` thresholds. The touch DOM/event wiring that
// produces the samples lives in the Phaser/DOM layer (`FP3DScene`), never here.
//
// The classifier is PURE and DETERMINISTIC: the same `samples`/`thresholds`/
// `ctx` inputs always yield the same output (design Property 6, Req 11.7), and
// every completed interaction maps to exactly one `GESTURES` member (design
// Property 5, Req 11.6).

import { GESTURE } from '../../config.js';

/**
 * The complete, closed set of Gestures a completed touch interaction can be
 * classified as (design Data Models; Req 11.6). `classifyGesture` returns
 * exactly one of these on its `gesture` field.
 * @type {readonly ['Touch_Hold','Drag','Flick','Tap','Double_Tap','Long_Press','Release']}
 */
export const GESTURES = ['Touch_Hold', 'Drag', 'Flick', 'Tap', 'Double_Tap', 'Long_Press', 'Release'];

/**
 * Live Movement_Vector during a Touch_Hold: the displacement from the
 * Floating_Joystick origin (`anchor`) to the current touch `point` (Req 1.3).
 * Screen coordinates, so up is -y. Pure and side-effect free.
 * @param {{x:number,y:number}} anchor Floating_Joystick origin
 * @param {{x:number,y:number}} point current touch point
 * @returns {{x:number,y:number}} Movement_Vector (point - anchor)
 */
export function movementVector(anchor, point) {
  return { x: point.x - anchor.x, y: point.y - anchor.y };
}

/**
 * Classify one completed touch interaction from its ordered samples into
 * exactly one member of {@link GESTURES}.
 *
 * Given `dt = last.t - first.t` (elapsed ms) and `dist` = straight-line travel
 * from the first to the last sample (dip), the decision order is (Req 4, 5, 11.6):
 *
 *  1. Empty / single-sample sequence -> `Touch_Hold` (pressed, not yet resolved).
 *  2. Moving interaction (`dist >= Tap_Move_Tolerance`):
 *       - `Flick` iff `dt <= Flick_Duration_Threshold` AND
 *         `dist >= Flick_Distance_Threshold` AND the travel direction is within
 *         `Flick_Angle_Band` of horizontal; `direction` is 'left'|'right' by the
 *         sign of dx. Otherwise -> `Drag` (Req 4.1, 4.5, 4.6).
 *  3. Stationary interaction (`dist < Tap_Move_Tolerance`):
 *       - `Long_Press` iff held `>= Long_Press_Duration` (Req 5.10);
 *       - `Tap` iff `dt <= Tap_Duration_Threshold` (Req 5.8), promoted to
 *         `Double_Tap` when the previous Tap (via `ctx`) started within
 *         `Double_Tap_Interval` and within `Tap_Move_Tolerance` (Req 5.9);
 *       - otherwise a stationary hold that is neither a Tap nor a Long_Press ->
 *         `Touch_Hold` (still-pressed rest state, Req 1.1).
 *
 * Pure and deterministic — no randomness, no clock reads, no mutation of the
 * inputs (Req 11.7).
 *
 * @param {{x:number,y:number,t:number}[]} samples ordered touch samples (dip + ms)
 * @param {typeof GESTURE} [thresholds=GESTURE] gesture thresholds from config
 * @param {{prevTapAt:number|null, prevTapPos:({x:number,y:number}|null)}} [ctx]
 *   classifier context carrying the previous Tap for Double_Tap detection
 * @returns {{gesture:string, vector?:{x:number,y:number}, direction?:('left'|'right')}}
 */
export function classifyGesture(samples, thresholds = GESTURE, ctx = null) {
  // Defensive: an absent or empty sequence is a not-yet-resolved hold.
  if (!Array.isArray(samples) || samples.length === 0) {
    return { gesture: 'Touch_Hold' };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];

  // A single sample means the finger is down but nothing has resolved yet.
  if (samples.length === 1) {
    return { gesture: 'Touch_Hold' };
  }

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = Math.hypot(dx, dy);
  const dt = last.t - first.t;

  const moveTolerance = thresholds.tapMoveToleranceDip;

  // --- Moving interaction: Flick vs Drag ------------------------------------
  if (dist >= moveTolerance) {
    if (isFlick(dx, dy, dist, dt, thresholds)) {
      return {
        gesture: 'Flick',
        vector: { x: dx, y: dy },
        direction: dx < 0 ? 'left' : 'right',
      };
    }
    return { gesture: 'Drag', vector: { x: dx, y: dy } };
  }

  // --- Stationary interaction: Long_Press / Double_Tap / Tap / hold ---------
  if (dt >= thresholds.longPressMs) {
    return { gesture: 'Long_Press' };
  }

  if (dt <= thresholds.tapDurationMs) {
    if (isDoubleTap(first, ctx, thresholds)) {
      return { gesture: 'Double_Tap' };
    }
    return { gesture: 'Tap' };
  }

  // Stationary, but too long to be a Tap and too short to be a Long_Press:
  // the finger is simply still pressed — a plain Touch_Hold.
  return { gesture: 'Touch_Hold' };
}

/**
 * Whether a moving interaction satisfies all three Flick bounds: quick enough,
 * far enough, and close enough to horizontal (Req 4.1, 4.6). The angle test
 * measures the deviation from the horizontal axis using |dy| against |dx|; a
 * band of `flickAngleBandDeg` around horizontal admits the Flick, and the
 * boundary angle is treated as inside the band.
 * @param {number} dx horizontal travel
 * @param {number} dy vertical travel
 * @param {number} dist straight-line travel distance
 * @param {number} dt elapsed ms
 * @param {typeof GESTURE} thresholds gesture thresholds
 * @returns {boolean}
 */
function isFlick(dx, dy, dist, dt, thresholds) {
  if (dt > thresholds.flickDurationMs) return false;
  if (dist < thresholds.flickDistanceDip) return false;
  // Angle from horizontal, in [0, 90]. atan2(|dy|, |dx|) is 0 for pure
  // horizontal and 90 for pure vertical.
  const angleFromHorizontalDeg = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
  return angleFromHorizontalDeg <= thresholds.flickAngleBandDeg;
}

/**
 * Whether a Tap should be promoted to a Double_Tap: a previous Tap exists in
 * `ctx`, this Tap starts within `Double_Tap_Interval` of it, and within
 * `Tap_Move_Tolerance` of its position (Req 5.9). Uses each interaction's
 * START (the first sample) as the reference point/time.
 * @param {{x:number,y:number,t:number}} first this interaction's first sample
 * @param {{prevTapAt:number|null, prevTapPos:({x:number,y:number}|null)}|null} ctx
 * @param {typeof GESTURE} thresholds gesture thresholds
 * @returns {boolean}
 */
function isDoubleTap(first, ctx, thresholds) {
  if (!ctx || ctx.prevTapAt == null || ctx.prevTapPos == null) return false;
  const interval = first.t - ctx.prevTapAt;
  if (interval < 0 || interval > thresholds.doubleTapIntervalMs) return false;
  const posDist = Math.hypot(first.x - ctx.prevTapPos.x, first.y - ctx.prevTapPos.y);
  return posDist < thresholds.tapMoveToleranceDip;
}
