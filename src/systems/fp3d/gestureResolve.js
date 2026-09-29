// Framework-agnostic vector-to-direction resolver for FP3D_Mode gestures.
//
// NO Phaser and NO Three.js imports (Req 11.1) — this module maps an analog
// Movement_Vector to exactly one discrete grid-movement intent (or a steer
// intent below the deadzone), and maps a classified Flick to exactly one
// cardinal camera turn by delegating to the existing framework-agnostic
// `fp3dLogic` turn helpers. It imports only `config.js` and `fp3dLogic.js`, so
// it stays unit- and property-testable without a WebGL or Phaser runtime.
//
// Coordinate convention (screen space): x grows right, y grows DOWN, so
// straight up is the -y direction. Every angle below is the angular deviation
// from straight up, measured in degrees in [0, 180]. The four screen cardinals
// map to movement intents / facings as:
//   up    -> forward       / facing 'north'
//   down  -> backward      / facing 'south'
//   left  -> strafe-left   / facing 'west'
//   right -> strafe-right  / facing 'east'

import { GESTURE } from '../../config.js';
import { turnLeft, turnRight } from './fp3dLogic.js';

/**
 * The five movement intents `resolveMovementVector` can emit for a Drag whose
 * magnitude is at or above the deadzone (Req 2.1–2.4, 11.2).
 * @type {readonly ['forward','backward','strafe-left','strafe-right','diagonal']}
 */
export const MOVE_INTENTS = ['forward', 'backward', 'strafe-left', 'strafe-right', 'diagonal'];

/**
 * Screen cardinal directions used internally, ordered so the angle each spans
 * from straight up is easy to reason about. Each carries the movement intent it
 * maps to (for moves) and the facing it maps to (for steer).
 */
const SCREEN_CARDINALS = /** @type {const} */ ([
  { key: 'up', intent: 'forward', facing: 'north' },
  { key: 'down', intent: 'backward', facing: 'south' },
  { key: 'left', intent: 'strafe-left', facing: 'west' },
  { key: 'right', intent: 'strafe-right', facing: 'east' },
]);

/** Radians -> degrees. */
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Angular deviation, in degrees [0, 180], of a screen vector from straight up
 * (the -y axis). Uses atan2 so it is stable for every non-zero vector.
 * @param {number} x screen x (grows right)
 * @param {number} y screen y (grows down)
 * @returns {number} deviation from straight up in degrees
 */
function deviationFromUp(x, y) {
  // Straight up is (0, -1). The angle between (x, y) and (0, -1):
  //   cosθ = (x·0 + y·-1) / |v| = -y / |v|
  // atan2(horizontal, vertical-toward-up) gives a signed angle; abs() folds it
  // into the unsigned [0, 180] deviation.
  return Math.abs(Math.atan2(x, -y)) * RAD_TO_DEG;
}

/**
 * The screen cardinal a vector points most strongly toward — the nearest of
 * up/down/left/right by dominant axis. Ties (|x| === |y|) resolve to the
 * vertical axis so a perfect 45° drag snaps to forward/backward rather than a
 * strafe, keeping the nearest-cardinal choice deterministic.
 * @param {number} x screen x
 * @param {number} y screen y
 * @returns {typeof SCREEN_CARDINALS[number]}
 */
function nearestCardinal(x, y) {
  if (Math.abs(y) >= Math.abs(x)) {
    return y <= 0 ? SCREEN_CARDINALS[0] /* up */ : SCREEN_CARDINALS[1] /* down */;
  }
  return x < 0 ? SCREEN_CARDINALS[2] /* left */ : SCREEN_CARDINALS[3] /* right */;
}

/**
 * The two nearest cardinal MOVE intents for a diagonal vector, ordered
 * dominant-axis-first: the intent for the axis with the larger absolute
 * component comes first (Req 2.4). A diagonal is, by construction, outside every
 * cardinal ±45° sector, so |x| and |y| are both non-zero and unequal here; the
 * tie branch is defensive only.
 * @param {number} x screen x
 * @param {number} y screen y
 * @returns {string[]} exactly two members of MOVE_INTENTS (never 'diagonal')
 */
function diagonalSteps(x, y) {
  const vertical = y <= 0 ? 'forward' : 'backward';
  const horizontal = x < 0 ? 'strafe-left' : 'strafe-right';
  // Dominant axis first: larger absolute component leads.
  return Math.abs(x) > Math.abs(y) ? [horizontal, vertical] : [vertical, horizontal];
}

/**
 * Resolve a Movement_Vector to exactly one outcome (totality, Req 11.2, 11.3).
 *
 * Screen coords: up = -y; the angle is the deviation from straight up.
 *   - magnitude < `movementDeadzonePx`        -> `{ kind:'steer', toward }`   (Req 2.8, 11.3)
 *   - deviation from up <= `forwardAssistConeDeg` (boundary inside)
 *                                              -> `{ kind:'move', intent:'forward', steps:['forward'] }` (Req 3.1, 3.3, 11.4)
 *   - within a cardinal ±`cardinalSectorDeg` sector
 *                                              -> forward/backward/strafe-left/strafe-right (Req 2.1–2.3)
 *   - otherwise                                -> `{ kind:'move', intent:'diagonal', steps:[...] }` (Req 2.4)
 *
 * @param {{ x:number, y:number }} vector Movement_Vector in screen dip (up = -y)
 * @param {typeof GESTURE} [thresholds] gesture thresholds (defaults to config GESTURE)
 * @returns {{ kind:'move', intent:string, steps:string[] } | { kind:'steer', toward:string }}
 */
export function resolveMovementVector(vector, thresholds = GESTURE) {
  const { x, y } = vector;
  const magnitude = Math.hypot(x, y);

  // Below the deadzone: gentle steering toward the nearest cardinal facing;
  // never a Tile move (Req 2.8, 11.3). A zero-length vector defaults to 'north'.
  if (magnitude < thresholds.movementDeadzonePx) {
    const toward = magnitude === 0 ? 'north' : nearestCardinal(x, y).facing;
    return { kind: 'steer', toward };
  }

  const deviation = deviationFromUp(x, y);

  // Forward-assist cone (±cone from up, boundary inside) takes precedence over
  // the cardinal sectors and snaps to pure forward (Req 3.1, 3.3, 11.4).
  if (deviation <= thresholds.forwardAssistConeDeg) {
    return { kind: 'move', intent: 'forward', steps: ['forward'] };
  }

  // Cardinal sectors: ±cardinalSectorDeg (±45°) around each screen cardinal.
  // The nearest cardinal is within its sector iff the vector's deviation from
  // that cardinal is <= the sector half-width. Because the four sectors tile the
  // circle, "within a sector" is equivalent to being no farther than the sector
  // half-width from the nearest cardinal's axis.
  const near = nearestCardinal(x, y);
  const deviationFromNear = angularDistanceToCardinal(x, y, near.key);
  if (deviationFromNear <= thresholds.cardinalSectorDeg) {
    return { kind: 'move', intent: near.intent, steps: [near.intent] };
  }

  // Anything remaining is a diagonal: two nearest cardinals, dominant-axis-first.
  return { kind: 'move', intent: 'diagonal', steps: diagonalSteps(x, y) };
}

/**
 * Angular distance in degrees [0, 180] from a screen vector to a given screen
 * cardinal axis (up/down/left/right).
 * @param {number} x screen x
 * @param {number} y screen y
 * @param {'up'|'down'|'left'|'right'} cardinal target axis
 * @returns {number} deviation in degrees
 */
function angularDistanceToCardinal(x, y, cardinal) {
  const up = deviationFromUp(x, y); // deviation from up
  switch (cardinal) {
    case 'up':
      return up;
    case 'down':
      return 180 - up;
    case 'left':
    case 'right': {
      // Deviation from the horizontal axis is 90° minus deviation from vertical.
      return Math.abs(90 - up);
    }
    default:
      return up;
  }
}

/**
 * Resolve a classified Flick to exactly one cardinal turn intent (Req 4.2, 4.3,
 * 11.5) by delegating to the existing framework-agnostic `fp3dLogic` turn
 * helpers, so a turn always settles on exactly one cardinal and no intermediate
 * facing is introduced.
 *   - `'left'`  -> counter-clockwise one step (`fp3dLogic.turnLeft`)
 *   - `'right'` -> clockwise one step (`fp3dLogic.turnRight`)
 *
 * @param {'north'|'east'|'south'|'west'} facing current cardinal facing
 * @param {'left'|'right'} direction Flick direction
 * @returns {'north'|'east'|'south'|'west'} the single resulting cardinal
 */
export function resolveFlickTurn(facing, direction) {
  return direction === 'left' ? turnLeft(facing) : turnRight(facing);
}
