# Implementation Plan

## Overview

This plan adds **one-thumb mobile gesture controls**, an accessible **Fullscreen_Toggle**, and the **3D-only launch** decision on top of the existing FP3D_Mode, as an input-mapping layer that never forks gameplay logic. It is ordered so the new **framework-agnostic** gesture logic and its mandatory `fast-check` property tests come first, then the DOM/Phaser wiring that consumes those intents through the *existing* `fp3dLogic` seam (`resolveMove`, `turnLeft`, `turnRight`, `resolveTunnel`, `InputBuffer`) and the existing `lineOfSight`. Each task is coding-only and builds on prior tasks.

Two hard boundaries drive the ordering:

- **Dependency isolation (Req 11.1):** `src/systems/fp3d/gestureClassifier.js` and `src/systems/fp3d/gestureResolve.js` import neither Phaser nor Three.js — only `config.js` and (for turn delegation) the framework-agnostic `fp3dLogic.js`. Touch DOM/event wiring, the Crosshair/Interaction_Indicator, and the Fullscreen_Toggle live only in the Phaser/DOM layer (`FP3DScene`, `FP3DRenderer`, `FullscreenToggle`).
- **Mandatory property-based testing (`.kiro/steering/testing.md`, Req 11):** each of the six **Correctness Properties** (`Property 1`–`Property 6` in `design.md`) gets a dedicated `fast-check` property test under Vitest, run at ≥100 cases, tagged with the feature name and a `Validates: Requirements x.y` comment. These property-test sub-tasks are **required** — none is optional. A pure-logic task is not complete until its property tests exist and pass (`npm run test -- --run`), and touched tasks end by confirming `npm run build` still succeeds.

**No new runtime dependency is added by this plan.** The Fullscreen API and touch/pointer events are browser built-ins, and the gesture modules are plain ES modules; `three` stays pinned exactly as-is. There is intentionally no dependency-install task.

Property tasks carry a `_Properties:_` line linking them to the design's Core Properties, preserving the requirement → property → task → test trace.

## Tasks

- [x] 1. Add GESTURE threshold constants to `config.js`
  - Add the `GESTURE` constants block to `src/config.js` with the finalized values from `design.md`: `movementDeadzonePx = 18`, `flickDurationMs = 150`, `flickDistanceDip = 48`, `flickAngleBandDeg = 30`, `forwardAssistConeDeg = 25`, `cardinalSectorDeg = 45`, `tapDurationMs = 200`, `tapMoveToleranceDip = 12`, `doubleTapIntervalMs = 300`, `longPressMs = 500`, `interactionRangeTiles = 3` — no hardcoded gesture numbers anywhere in the resolver/classifier/scene/renderer.
  - Confirm `DEFAULT_RENDER_MODE` stays `'2d'` in `config.js`, now describing only the fallback target (not a launch default).
  - No new runtime dependency is introduced by this task; the thresholds are plain constants.
  - _Requirements: 2.8, 3.1, 3.3, 4.1, 5.8, 5.9, 5.10, 6.1, 6.5, 10.4_

- [x] 2. Implement the vector-to-direction resolver (`gestureResolve.js`)
  - [x] 2.1 Implement `resolveMovementVector` and `resolveFlickTurn`
    - Create `src/systems/fp3d/gestureResolve.js` (framework-agnostic — imports only `config.js` and, for turn delegation, the framework-agnostic `fp3dLogic.js`; never Phaser or Three.js).
    - Export `MOVE_INTENTS` and implement `resolveMovementVector(vector, thresholds)` (screen coords, up = `-y`, angle from straight up) returning **exactly one** outcome: `{ kind:'steer', toward }` when magnitude is below `movementDeadzonePx`; otherwise `{ kind:'move', intent, steps }` where the forward-assist cone (±25°, boundary inside) snaps to `forward`, the ±45° cardinal sectors map to forward/backward/strafe-left/strafe-right, and any remaining direction is `diagonal` with `steps` = the two nearest cardinal moves ordered dominant-axis-first.
    - Implement `resolveFlickTurn(facing, direction)` delegating to the existing `fp3dLogic.turnLeft`/`turnRight` so it returns exactly one cardinal (counter-clockwise for `left`, clockwise for `right`).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 3.1, 3.2, 3.3, 4.2, 4.3, 4.4, 7.1, 7.2, 11.1_
    - _Properties: Property 1, Property 2, Property 3, Property 4_

  - [x]* 2.2 Write property test: movement resolution is total and single-valued at or above the deadzone
    - Add `src/systems/fp3d/gestureResolve.test.js` with a `fast-check` property (≥100 cases) drawing vectors as `{ angleDeg ∈ [0,360), magnitude ∈ [deadzone, large] }` and asserting exactly one `move` outcome whose `intent` is exactly one of `MOVE_INTENTS`, with `diagonal` carrying its two nearest-cardinal `steps` dominant-axis-first. Include ±45° boundary angles from the generator.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 1: Movement-vector resolution is total and single-valued at or above the deadzone — Validates: Requirements 11.2, 2.1, 2.2, 2.3, 2.4, 3.2` and run `npm run test -- --run`.
    - **Property 1: Movement-vector resolution is total and single-valued at or above the deadzone**
    - **Validates: Requirements 11.2, 2.1, 2.2, 2.3, 2.4, 3.2**

  - [x]* 2.3 Write property test: below the deadzone resolves to steer, never a move
    - In `gestureResolve.test.js`, add a `fast-check` property (≥100 cases) drawing vectors with magnitude `[0, deadzone)` (including zero-length) and asserting the outcome is always `{ kind:'steer' }` toward a nearest cardinal and never a `move` intent.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 2: Below the deadzone resolves to steer, never a move — Validates: Requirements 11.3, 2.8` and run `npm run test -- --run`.
    - **Property 2: Below the deadzone resolves to steer, never a move**
    - **Validates: Requirements 11.3, 2.8**

  - [x]* 2.4 Write property test: forward-assist cone snaps to forward
    - In `gestureResolve.test.js`, add a `fast-check` property (≥100 cases) drawing vectors with magnitude at/above the deadzone and angular deviation from straight up within ±25° (boundary inside) and asserting the outcome is the `forward` move intent and never diagonal or strafe.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 3: Forward-assist cone snaps to forward — Validates: Requirements 11.4, 3.1, 3.3` and run `npm run test -- --run`.
    - **Property 3: Forward-assist cone snaps to forward**
    - **Validates: Requirements 11.4, 3.1, 3.3**

  - [x]* 2.5 Write property test: turn resolution yields exactly one cardinal
    - In `gestureResolve.test.js`, add a `fast-check` property (≥100 cases) drawing facings from `{north, east, south, west}` × directions `{left, right}` and asserting `resolveFlickTurn` returns exactly one cardinal, advancing counter-clockwise for `left` and clockwise for `right` by one step.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 4: Turn resolution yields exactly one cardinal — Validates: Requirements 11.5, 4.2, 4.3, 4.4` and run `npm run test -- --run`.
    - **Property 4: Turn resolution yields exactly one cardinal**
    - **Validates: Requirements 11.5, 4.2, 4.3, 4.4**

- [x] 3. Implement the gesture classifier (`gestureClassifier.js`)
  - [x] 3.1 Implement `classifyGesture` and `movementVector`
    - Create `src/systems/fp3d/gestureClassifier.js` (framework-agnostic — imports only `config.js`; never Phaser or Three.js).
    - Export `GESTURES` and implement `classifyGesture(samples, thresholds, ctx)` mapping one completed interaction to exactly one `GESTURES` member: **Flick** iff `dt <= flickDurationMs` **and** `dist >= flickDistanceDip` **and** direction within `flickAngleBandDeg` of horizontal (`direction` from sign of `dx`), otherwise a moving interaction is a **Drag**; **Tap** iff `dt <= tapDurationMs` and `dist < tapMoveToleranceDip`; **Double_Tap** when two Taps start within `doubleTapIntervalMs` at positions within `tapMoveToleranceDip` (via `ctx`); **Long_Press** iff stationary held `>= longPressMs`; plus `Touch_Hold`/`Release`. Keep it pure and deterministic.
    - Implement `movementVector(anchor, point)` returning `{ x: point.x - anchor.x, y: point.y - anchor.y }`.
    - _Requirements: 1.3, 4.1, 4.5, 4.6, 5.8, 5.9, 5.10, 11.1, 11.6, 11.7_
    - _Properties: Property 5, Property 6_

  - [x]* 3.2 Write property test: classification is single-valued with a sharp Flick/Drag boundary
    - Add `src/systems/fp3d/gestureClassifier.test.js` with a `fast-check` property (≥100 cases) generating synthetic sample sequences parameterized by `{ duration, distance, angleFromHorizontal }` plus stationary/tap/double-tap variants, asserting exactly one `GESTURES` member is returned and that a moving interaction is a `Flick` iff duration ≤ bound AND distance ≥ bound AND angle within band, else a `Drag`. Include exact-bound edge cases from the generator.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 5: Gesture classification is single-valued with a sharp Flick/Drag boundary — Validates: Requirements 11.6, 4.1, 4.5, 4.6` and run `npm run test -- --run`.
    - **Property 5: Gesture classification is single-valued with a sharp Flick/Drag boundary**
    - **Validates: Requirements 11.6, 4.1, 4.5, 4.6**

  - [x]* 3.3 Write property test: classification is deterministic
    - In `gestureClassifier.test.js`, add a `fast-check` property (≥100 cases) that evaluates `classifyGesture` twice on the identical sample sequence and context and asserts identical output.
    - Tag: `// Feature: mobile-gestures-fullscreen, Property 6: Gesture classification is deterministic — Validates: Requirements 11.7` and run `npm run test -- --run`.
    - **Property 6: Gesture classification is deterministic**
    - **Validates: Requirements 11.7**

- [x] 4. Checkpoint - pure gesture logic verified
  - Run `npm run test -- --run` and confirm Properties 1–6 all pass at ≥100 cases each; add a check (test or lint assertion) that `gestureClassifier.js` and `gestureResolve.js` import neither Phaser nor Three.js (only `config.js` and the framework-agnostic `fp3dLogic.js`).
  - Run `npm run build` to confirm the pure modules ship cleanly. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 11.1, 11.8, 11.9_

- [x] 5. Implement the accessible `FullscreenToggle` DOM control
  - [x] 5.1 Build `createFullscreenToggle`
    - Create `src/ui/FullscreenToggle.js` exporting `createFullscreenToggle(surfaceEl, { onError })` returning `{ el, destroy }`, or `null` when `document.fullscreenEnabled`/`requestFullscreen` is absent (graceful removal, no error). No new dependency — uses the built-in Fullscreen API only.
    - Render a real `<button>` with `role=button`, an accessible name of "Enter fullscreen"/"Exit fullscreen", and `aria-pressed` reflecting state; activate on click / Enter / Space to call `requestFullscreen(surfaceEl)` or `exitFullscreen()`; listen for `fullscreenchange` to relabel and resync `aria` within 100 ms; catch a rejected/failed request, leave display state unchanged, and resync the label to `document.fullscreenElement`; provide a visible `:focus-visible` focus indicator.
    - Treat an orientation change while fullscreen as a resize that leaves the control and its state intact.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [ ]* 5.2 Write example tests for `FullscreenToggle`
    - Add `src/ui/FullscreenToggle.test.js` covering accessible name/role/`aria-pressed` and label swap within 100 ms (Req 9.1, 9.4), enter/exit requests (Req 9.2, 9.3), keyboard operability via Enter/Space (Req 9.7), `null` return when the API is unavailable (Req 9.5), and label resync on a rejected request (Req 9.6), using a stubbed Fullscreen API.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 6. Add Crosshair and Interaction_Indicator to `FP3DRenderer`
  - [x] 6.1 Implement `setCrosshair` and `setInteractionIndicator`
    - Edit `src/render/FP3DRenderer.js` (the only Three.js importer). Extend/confirm `setCrosshair(visible)` for the fixed center reticle, and implement `setInteractionIndicator(label|null)` drawing a centered dot plus an action label of ≤24 characters when an Interactable is under the Crosshair within the 3-tile range; hide it within 100 ms when none is targeted, out of range, or the target is removed; update the label within 100 ms on target change; suppress non-essential animation under Reduced_Motion.
    - Ensure the Floating_Joystick has **no** persistent on-screen control — any origin marker is drawn only under the touching finger and never obscures the Crosshair.
    - Run `npm run build`.
    - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.2 Write example tests for the Interaction_Indicator
    - Add example tests asserting the indicator shows a dot + label (≤24 chars) within range, hides within 100 ms when none/out-of-range/removed, updates on target change, and drops non-essential animation under Reduced_Motion.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 7. Wire touch input and gesture dispatch into `FP3DScene`
  - [x] 7.1 Attach touch/pointer listeners and sampling
    - Edit `src/scenes/FP3DScene.js`: in `create()` attach `touchstart`/`touchmove`/`touchend` (with a Pointer Events fallback) on the game surface and construct the `FullscreenToggle`. `onTouchStart` ignores a point over an interactive control (the FullscreenToggle) and otherwise anchors a Floating_Joystick origin, ignoring a second concurrent touch. `onTouchMove` records `{x,y,t}` samples and computes the Movement_Vector via `movementVector`; `onTouchEnd` clears the origin and stops movement on Release.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 7.2 Route classified gestures through the existing `fp3dLogic` seam
    - Implement `dispatchGesture(gesture, facing)`: **Drag** → `resolveMovementVector` → a `move` intent pushed into the existing `InputBuffer` (diagonal `steps` fed one at a time, skipping a blocked leg), or a `steer` applied via `fp3dLogic.setFacing(nearest)` with no move; **Flick** → `resolveFlickTurn` pushed into `InputBuffer`; **Double_Tap** → forward dash intent pushed into `InputBuffer`; **Tap** → `interactUnderCrosshair()`; **Long_Press** → `inspectUnderCrosshair()`. Apply buffered intents on traversal-complete through the existing `resolveMove`/`resolveTunnel`, keeping the player put and preserving facing on a blocked target (at most one buffered intent, extras dropped).
    - Freeze all gesture-derived move/turn intents while a quiz/lesson overlay is open; under Reduced_Motion still apply grid-locked position/cardinal facing while suppressing non-essential camera motion.
    - _Requirements: 2.4, 2.6, 2.7, 2.8, 4.7, 5.4, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.3 Implement interaction targeting under the Crosshair
    - Implement `interactUnderCrosshair()` and `inspectUnderCrosshair()` using the existing `lineOfSight` walk to pick the nearest Interactable along the Crosshair line within `interactionRangeTiles`; a Tap triggers the primary interaction (nearest when several are targeted) and does nothing when none is targeted; a Long_Press triggers the secondary (inspect) interaction; neither changes position/facing when nothing is targeted.
    - Drive `FP3DRenderer.setInteractionIndicator(...)` from the currently targeted Interactable.
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 6.1, 6.5_

  - [ ]* 7.4 Write example/integration tests for touch wiring and dispatch
    - Add tests that a Touch_Hold anchors an origin only off interactive controls, Release clears it, a second concurrent touch is ignored (Req 1.1, 1.4, 1.6); that a resolved move/turn intent is applied through `fp3dLogic.resolveMove`/`turnLeft`/`turnRight`/`resolveTunnel`/`InputBuffer` with a blocked target keeping the player put and a diagonal skipping a blocked leg and at most one intent buffered (Req 2.6, 2.7, 7.3, 7.4, 7.5); that Tap/Double_Tap/Long_Press behave per Req 5.1–5.7; that keyboard input stays interchangeable with gestures and overlay-open freezes intents (Req 8.1–8.4).
    - _Requirements: 1.1, 1.4, 1.6, 2.6, 2.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

- [x] 8. Make FP3D_Mode the only player-facing mode in `MenuScene`
  - [x] 8.1 Remove the Render_Mode toggle and always launch '3d'
    - Edit `src/scenes/MenuScene.js` to remove the player-facing Render_Mode toggle UI and its handlers (`_buildRenderModeToggle`, `_selectRenderMode`, `_toggleRenderMode`, `_refreshRenderModeButtons`, `_loadPersistedRenderMode`). Starting a game always launches `FP3DScene` in `'3d'` with the current Grade, ignoring any persisted `renderMode` value.
    - Leave the internal 2D fallback path to `GameScene` unchanged — reached only on a WebGL_Context or Maze_Data failure — preserving lives/score/Grade, the dismissible "3D unavailable" notice, and unmodified Maze_Data (retaining FP3D Req 1.6/8.1/8.5).
    - Run `npm run build`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [ ]* 8.2 Write example tests for the 3D-only launch and retained fallback
    - Add example tests that no Render_Mode toggle is presented (Req 10.1), that Start always launches `'3d'` regardless of persisted `renderMode` (Req 10.2, 10.3), and that the internal 2D fallback still fires on WebGL/context-loss/Maze_Data failure with lives/score/Grade preserved (Req 10.5–10.9).
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 10.7, 10.8, 10.9_

- [x] 9. Final checkpoint - full verification
  - Run the complete property suite with `npm run test -- --run` and confirm Properties 1–6 pass at ≥100 cases each; run `npm run build` and confirm it succeeds with the gesture layer, Fullscreen_Toggle, Crosshair/Interaction_Indicator, and the 3D-only menu change included, and the internal 2D fallback build unchanged.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 11.8, 11.9, 10.5, 10.6_

## Notes

- Requirement references map back to `requirements.md`; `design.md` details each module and the dependency boundaries.
- The `_Properties:_` line on each pure-logic task links its code to the Core Properties it must satisfy; those properties (1–6) must have passing `fast-check` tests before the owning task is done (`.kiro/steering/testing.md`).
- Property-test sub-tasks (2.2–2.5, 3.2, 3.3) are **mandatory**, not optional — the `*` marker only signals they are test sub-tasks the executor writes alongside the owning implementation task; they must be executed and must pass.
- `gestureClassifier.js` and `gestureResolve.js` stay free of Phaser and Three.js imports (Req 11.1); `FP3DRenderer.js` remains the sole Three.js importer, and touch DOM/event wiring plus the Fullscreen_Toggle live only in the Phaser/DOM layer.
- No new runtime dependency is added — the Fullscreen API and touch/pointer events are browser built-ins and `three` stays pinned exactly; there is intentionally no install task.
- Never run `npm run dev` in the agent shell — it is long-running and must be started by the user in their own terminal.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "6.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "3.3", "5.2", "6.2", "8.2"] },
    { "id": 3, "tasks": ["7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3"] },
    { "id": 5, "tasks": ["7.4"] }
  ]
}
```
