# Requirements Document

## Introduction

This feature extends the existing **first-person 3D mode** (FP3D_Mode) of Math Man with three related capabilities: **one-thumb mobile gesture controls**, a **fullscreen toggle**, and a decision to make FP3D_Mode the **only player-facing mode**. It builds directly on `.kiro/specs/first-person-3d-mode/` and reuses that spec's terminology, glossary, and EARS style. All existing FP3D_Mode behavior — grid-locked cardinal movement, the quiz-on-capture loop, fruit rewards, lives (start 6, cap 10), difficulty-by-grade, and `mathman.v1` persistence — remains in force unless explicitly overridden here.

**Part A — One-thumb mobile gesture controls.** On touch devices the Player must control both first-person movement and camera facing with a single thumb, without requiring simultaneous inputs. The scheme is **Touch → Drag → Flick → Tap**: touching and holding anywhere anchors an invisible Floating_Joystick at the touch point; dragging resolves to grid-locked movement (forward/back/strafe/diagonal) and gentle steering; a short fast horizontal Flick resolves to a cardinal camera turn; a Tap interacts with the object under the Crosshair; a double tap dashes forward; a Long_Press inspects. Because FP3D_Mode is grid-locked and turns only to the four cardinal directions, the analog-feeling gestures are **resolved to discrete grid moves and cardinal turns** — the gesture layer is an input-mapping concern, not a new movement model.

> **Design update — visible Virtual_Joystick on touch devices.** This document now specifies a **visible on-screen Virtual_Joystick** (plus visible turn controls) on touch/Coarse_Pointer devices as the primary discoverable mobile control, together with full mobile responsiveness (Requirement 12). **This supersedes the earlier "no persistent on-screen joystick" decision for touch devices** (previously in Requirement 1.2). The touch-anywhere invisible Floating_Joystick behavior remains as an additional gesture path, and the visible Virtual_Joystick's vector feeds the **same** grid-locked movement resolution as the keyboard and gesture paths. On non-touch (fine-pointer/desktop) devices, no on-screen joystick or turn controls are shown, and the keyboard path is unchanged and remains fully operable.

**Part B — Fullscreen support.** A clearly labeled, accessible Fullscreen_Toggle lets the Player enter and exit browser fullscreen, reflects the current state, and degrades gracefully when the Fullscreen API is unavailable or a request is rejected.

**Part C — FP3D_Mode as the only player-facing mode.** The menu no longer presents a 2D/3D selection to the Player; the game always launches in FP3D_Mode. **This supersedes the 2D-default menu-selection behavior of the first-person-3d-mode spec's Requirement 6** (specifically 6.1, 6.2, 6.3, and 6.6 as player-facing menu choices). The 2D Render_Mode is **retained internally solely as the automatic fallback path** when a WebGL_Context or Maze_Data is unavailable — the fallback behavior and progress preservation of that spec's Requirements 1.6, 8.1, and 8.5 are kept unchanged. In short: hide 2D as a selectable option, always launch 3D, but preserve the internal 2D fallback.

Consistent with the existing spec's Requirement 10 and the mandatory testing steering (`.kiro/steering/testing.md`), the framework-agnostic gesture-classification and vector-to-direction logic must be covered by property-based tests (Vitest + `fast-check`, at least 100 generated cases per property) and must import neither Phaser nor Three.js. The gesture layer is an additional input path and must not remove the keyboard operability guaranteed by the existing spec's Requirement 7.

## Glossary

Reused from `.kiro/specs/first-person-3d-mode/` (same meaning):

- **Math_Man_Game**: The existing Phaser game and its shared systems.
- **FP3D_Mode**: The first-person 3D rendering and interaction mode.
- **FP3D_Renderer**: The component that draws the maze, collectibles, and ghosts as a first-person 3D scene.
- **FP3D_Controller**: The component that maps Player input to grid-locked movement and cardinal camera orientation in FP3D_Mode.
- **Maze_Data**: The framework-agnostic tile-code layout and helpers (`src/maze/mazeData.js` / `src/maze/mazeLogic.js`), the shared source of truth.
- **Player**: The human user controlling Math Man.
- **Grade**: The selected difficulty level, one of 5, 6, or 7.
- **Tile**: One cell of the maze grid; `TILE_SIZE` = 24 in 2D units.
- **Render_Mode**: The active presentation, either `2d` or `3d` (FP3D_Mode).
- **WebGL_Context**: The browser rendering context required to draw hardware-accelerated 3D.
- **Storage**: The existing `localStorage`-backed persistence (key `mathman.v1`) with an in-memory fallback.

New terms introduced by this feature:

- **Gesture**: A classified touch interaction produced by the touch input layer — one of {Touch_Hold, Drag, Flick, Tap, Double_Tap, Long_Press, Release}.
- **Gesture_Classifier**: The framework-agnostic component that consumes raw touch samples (position and timestamp) and emits a Gesture together with any derived vector, importing neither Phaser nor Three.js.
- **Floating_Joystick**: An invisible movement origin anchored at the point where the current Touch_Hold began; the Drag vector is measured relative to this origin. It is not a permanently visible on-screen control. It remains available as an additional touch gesture path alongside the visible Virtual_Joystick.
- **Virtual_Joystick**: A visible, draggable on-screen movement control shown on touch/Coarse_Pointer devices, anchored bottom-left, whose output vector feeds the same grid-locked movement resolution as the keyboard and gesture (Floating_Joystick) paths. It is the primary discoverable mobile movement control and is hidden on fine-pointer/desktop devices.
- **Coarse_Pointer**: A device whose primary pointer is touch, as reported by `matchMedia('(pointer: coarse)')`. Used to decide when the visible Virtual_Joystick and on-screen turn controls are shown.
- **Drag**: A slow, continuous touch movement (below the Flick velocity threshold) that resolves to grid-locked movement or gentle steering.
- **Flick**: A short, fast, predominantly horizontal swipe (duration at or below the Flick_Duration_Threshold and distance at or above the Flick_Distance_Threshold) that resolves to a cardinal camera turn.
- **Tap**: A touch that begins and ends within the Tap_Duration_Threshold and moves less than the Tap_Move_Tolerance.
- **Double_Tap**: Two Taps whose starts fall within the Double_Tap_Interval at approximately the same location.
- **Long_Press**: A stationary touch held at least the Long_Press_Duration without exceeding the Tap_Move_Tolerance.
- **Release**: The lifting of the active touch, ending the current Touch_Hold.
- **Movement_Vector**: The 2D vector from the Floating_Joystick origin to the current touch point, used to derive a movement intent.
- **Forward_Assist_Cone**: The angular tolerance (±25 degrees from straight up) within which a Movement_Vector is snapped to pure forward movement rather than a diagonal.
- **Crosshair**: The fixed center-screen reticle indicating the Tile or object the Tap interaction targets.
- **Interactable**: An in-world object the Player can act on under the Crosshair (for example a door, ladder, dialogue trigger, or pickup).
- **Interaction_Indicator**: The subtle centered affordance (a dot plus a short label such as "OPEN") shown when an Interactable is under the Crosshair.
- **Fullscreen_Toggle**: The Player-selectable control that requests entering or exiting browser fullscreen and reflects the current fullscreen state.
- **Fullscreen_API**: The browser Fullscreen API (`requestFullscreen` / `exitFullscreen` and related `fullscreenchange` / `fullscreenElement` state).
- **Reduced_Motion**: The Player or system preference (`prefers-reduced-motion: reduce`) that suppresses non-essential camera motion, as defined by the existing spec's Requirement 7.4/7.5.

**Configurable thresholds** (exact values to be finalized in design; defaults given here as testable criteria):

- **Flick_Duration_Threshold**: 150 milliseconds — a swipe at or below this duration is a candidate Flick.
- **Flick_Distance_Threshold**: a minimum swipe travel distance distinguishing a Flick from touch jitter.
- **Flick_Turn_Range**: a cardinal camera turn of between 45 and 90 degrees produced by a Flick.
- **Tap_Duration_Threshold**, **Tap_Move_Tolerance**, **Double_Tap_Interval**, **Long_Press_Duration**: gesture-timing bounds defined above.
- **Forward_Assist_Cone**: ±25 degrees from straight up.
- **Movement_Deadzone**: the minimum Movement_Vector magnitude at or above which a Drag requests a Tile move and below which it is treated as gentle steering (exact value finalized in design).
- **Cardinal_Sectors**: the four 90-degree sectors (±45 degrees around up, down, left, and right) used to classify Movement_Vector direction; the Forward_Assist_Cone (±25 degrees from up) takes precedence for the pure-forward snap.

## Requirements

### Requirement 1: One-thumb touch activates movement via a Floating_Joystick

**User Story:** As a player on a touch device, I want to start moving by touching and holding anywhere on the screen, so that I can control movement with one thumb without hunting for a fixed on-screen joystick.

#### Acceptance Criteria

1. WHEN the Player begins a Touch_Hold on the FP3D_Mode play surface at a point that is not over an interactive on-screen control (such as the Fullscreen_Toggle), THE FP3D_Controller SHALL anchor a Floating_Joystick origin at that touch point and enter movement mode, such that a subsequent Drag produces movement per Requirement 2.
2. WHERE the device is a touch/Coarse_Pointer device, THE FP3D_Controller MAY display a visible Virtual_Joystick anchored bottom-left as the primary movement control, positioned so that it does not obscure the Crosshair; WHERE the device is a fine-pointer/desktop device, THE FP3D_Controller SHALL NOT display any on-screen joystick control. The invisible Floating_Joystick origin (Requirement 1.1) remains an additional touch gesture path: WHILE no Touch_Hold is active, THE FP3D_Controller SHALL display no Floating_Joystick origin marker, and WHILE a Touch_Hold is active, any Floating_Joystick origin marker SHALL be rendered only at the anchored touch point (within the area occluded by the touching finger) and SHALL NOT obscure the Crosshair.
3. WHILE a Touch_Hold is active, THE Gesture_Classifier SHALL compute the Movement_Vector as the displacement from the Floating_Joystick origin to the current touch point.
4. WHEN the Player performs a Release, THE FP3D_Controller SHALL stop Player movement and SHALL clear the Floating_Joystick origin.
5. THE FP3D_Controller SHALL require no simultaneous second touch input to move, turn, or interact, such that all controls specified in this document are operable with a single active touch.
6. IF a second touch begins WHILE a Touch_Hold is already active, THEN THE FP3D_Controller SHALL retain the original Touch_Hold as the active Floating_Joystick origin and SHALL NOT re-anchor the Floating_Joystick or change Player movement in response to the second touch.

### Requirement 2: Drag resolves to grid-locked movement and steering

**User Story:** As a player, I want dragging my thumb in a direction to move me that way through the maze, so that movement feels natural even though the maze is grid-locked.

#### Acceptance Criteria

1. WHILE a Drag is active AND the Movement_Vector magnitude is at or above the Movement_Deadzone AND the Movement_Vector lies within ±45 degrees of straight up, THE FP3D_Controller SHALL request forward movement into the Tile ahead of the Player's current facing.
2. WHILE a Drag is active AND the Movement_Vector magnitude is at or above the Movement_Deadzone AND the Movement_Vector lies within ±45 degrees of straight down, THE FP3D_Controller SHALL request backward movement into the Tile behind the Player's current facing.
3. WHILE a Drag is active AND the Movement_Vector magnitude is at or above the Movement_Deadzone AND the Movement_Vector lies within ±45 degrees of straight left or straight right, THE FP3D_Controller SHALL request strafe movement into the Tile to the corresponding side of the Player's current facing.
4. WHILE a Drag is active AND the Movement_Vector magnitude is at or above the Movement_Deadzone AND the Movement_Vector points diagonally outside the Forward_Assist_Cone and outside every cardinal sector defined in criteria 1 through 3, THE FP3D_Controller SHALL resolve the diagonal to a sequence of the two nearest cardinal grid moves ordered dominant-axis-first (the axis with the larger Movement_Vector component first), rather than an off-grid movement.
5. THE FP3D_Controller SHALL resolve every Drag-derived movement request to a discrete grid-locked move through the existing FP3D_Mode movement resolution, such that the Player position after resolution is a valid Tile center.
6. IF a Drag-derived movement request targets a Tile that is not enterable per Maze_Data, THEN THE FP3D_Controller SHALL keep the Player at the current Tile and SHALL preserve the current facing direction.
7. IF any single move within a diagonal sequence resolved per criterion 4 targets a Tile that is not enterable per Maze_Data, THEN THE FP3D_Controller SHALL skip that move and SHALL attempt the remaining move in the sequence.
8. WHILE a Drag is active AND the Movement_Vector magnitude is below the Movement_Deadzone, THE FP3D_Controller SHALL treat the Drag as gentle steering and SHALL adjust the Player facing toward the nearest cardinal direction indicated by the Movement_Vector without requesting a Tile move.

### Requirement 3: Magnetic forward assist

**User Story:** As a player, I want small sideways wobble while pushing forward to still move me straight ahead, so that I do not veer into unwanted diagonals.

#### Acceptance Criteria

1. WHILE a Drag is active AND the angular deviation of the Movement_Vector from straight up is at or within the Forward_Assist_Cone of ±25 degrees, THE FP3D_Controller SHALL request pure forward movement and SHALL NOT request a diagonal or strafe move.
2. IF the angular deviation of the Movement_Vector from straight up is strictly greater than the Forward_Assist_Cone of ±25 degrees, THEN THE FP3D_Controller SHALL classify the movement intent by the nearest movement sector (forward, backward, strafe-left, strafe-right, or diagonal) without applying the forward snap.
3. THE Forward_Assist_Cone SHALL be ±25 degrees measured from the straight-up direction of the Movement_Vector, with the 25-degree boundary treated as inside the cone, such that a Movement_Vector is classified into exactly one of the forward-snap path (deviation at or within 25 degrees) or the nearest-sector path (deviation greater than 25 degrees).

### Requirement 4: Flick resolves to a cardinal camera turn

**User Story:** As a player, I want a quick horizontal flick to turn my view, so that I can change facing fast without a separate look control.

#### Acceptance Criteria

1. WHEN the Gesture_Classifier observes a touch movement whose duration is at or below the Flick_Duration_Threshold (150 milliseconds) AND whose travel distance is at or above the Flick_Distance_Threshold (default 48 device-independent pixels) AND whose direction is within 30 degrees of horizontal, THE Gesture_Classifier SHALL classify the Gesture as a Flick.
2. WHEN a Flick is classified with a leftward direction, THE FP3D_Controller SHALL turn the camera facing counter-clockwise by exactly one step to the adjacent cardinal direction.
3. WHEN a Flick is classified with a rightward direction, THE FP3D_Controller SHALL turn the camera facing clockwise by exactly one step to the adjacent cardinal direction.
4. WHEN a Flick produces a camera turn, THE FP3D_Renderer SHALL rotate the view by an angle between 45 and 90 degrees inclusive and SHALL settle on exactly one of the four cardinal directions {north, south, east, west}.
5. IF a touch movement's duration exceeds the Flick_Duration_Threshold OR its travel distance is below the Flick_Distance_Threshold OR its direction is more than 30 degrees from horizontal, THEN THE Gesture_Classifier SHALL NOT classify it as a Flick and SHALL treat it as a Drag.
6. THE Gesture_Classifier SHALL classify a movement as a Flick only when it satisfies both the Flick_Duration_Threshold and Flick_Distance_Threshold bounds, such that a movement whose duration exceeds the Flick_Duration_Threshold or whose travel distance is below the Flick_Distance_Threshold is classified as a Drag.
7. WHERE Reduced_Motion is enabled, WHEN a Flick produces a camera turn, THE FP3D_Renderer SHALL apply the resulting cardinal facing without non-essential turn animation.

### Requirement 5: Tap, Double_Tap, and Long_Press interactions

**User Story:** As a player, I want to tap to interact with what I am looking at and use a double tap or long press for other actions, so that I can operate the world with one thumb.

#### Acceptance Criteria

1. WHEN the Gesture_Classifier classifies a Tap AND exactly one Interactable is under the Crosshair, THE FP3D_Controller SHALL trigger the primary interaction for that Interactable (for example opening a door, advancing dialogue, collecting a pickup, or using a ladder).
2. WHEN the Gesture_Classifier classifies a Tap AND more than one Interactable is under the Crosshair, THE FP3D_Controller SHALL trigger the primary interaction for the nearest Interactable along the Crosshair line.
3. IF a Tap is classified WHILE no Interactable is under the Crosshair, THEN THE FP3D_Controller SHALL take no interaction action and SHALL leave Player position and facing unchanged.
4. WHEN the Gesture_Classifier classifies a Double_Tap, THE FP3D_Controller SHALL request a forward dash of exactly one grid move in the Player's current facing, resolved through the existing grid-locked movement resolution.
5. IF a Double_Tap dash targets a Tile that is not enterable per Maze_Data, THEN THE FP3D_Controller SHALL keep the Player at the current Tile and SHALL preserve the current facing direction.
6. WHEN the Gesture_Classifier classifies a Long_Press AND an Interactable is under the Crosshair, THE FP3D_Controller SHALL trigger that Interactable's secondary interaction (inspect).
7. IF a Long_Press is classified WHILE no Interactable is under the Crosshair, THEN THE FP3D_Controller SHALL take no interaction action and SHALL leave Player position and facing unchanged.
8. THE Gesture_Classifier SHALL classify a touch as a Tap only when its duration is at or below the Tap_Duration_Threshold and its total movement is below the Tap_Move_Tolerance.
9. THE Gesture_Classifier SHALL classify a Double_Tap only when two Taps occur within the Double_Tap_Interval at locations within the Tap_Move_Tolerance of each other.
10. THE Gesture_Classifier SHALL classify a Long_Press only when a stationary touch is held for at least the Long_Press_Duration without exceeding the Tap_Move_Tolerance.

### Requirement 6: Interaction affordance under the Crosshair

**User Story:** As a player, I want a subtle prompt when something I am looking at can be used, so that I know when to tap.

#### Acceptance Criteria

1. WHILE an Interactable is under the Crosshair and within the interaction activation range of 3 tiles or fewer from the camera, THE FP3D_Renderer SHALL display a centered Interaction_Indicator consisting of a dot and an action label of 24 characters or fewer that prompts a Tap.
2. WHILE no Interactable is under the Crosshair, THE FP3D_Renderer SHALL hide the Interaction_Indicator within 100 milliseconds.
3. WHEN the Interactable under the Crosshair changes, THE FP3D_Renderer SHALL update the Interaction_Indicator label within 100 milliseconds to match the single highest-priority interaction available for the newly targeted Interactable.
4. WHERE Reduced_Motion is enabled, THE FP3D_Renderer SHALL present the Interaction_Indicator without non-essential animation while still showing and hiding it based on the targeted Interactable.
5. IF an Interactable is under the Crosshair but beyond the interaction activation range of 3 tiles from the camera, THEN THE FP3D_Renderer SHALL keep the Interaction_Indicator hidden.
6. IF the Interactable that the Interaction_Indicator refers to is removed or becomes unavailable while under the Crosshair, THEN THE FP3D_Renderer SHALL hide the Interaction_Indicator within 100 milliseconds so no stale prompt remains.

### Requirement 7: Gestures resolve to the existing grid-locked model

**User Story:** As a maintainer, I want the analog-feeling gestures to map onto the existing grid-locked movement and cardinal-turn model, so that FP3D_Mode does not gain a second movement system.

#### Acceptance Criteria

1. THE FP3D_Controller SHALL resolve every Gesture-derived movement intent to a discrete grid move through the same FP3D_Mode movement resolution used for keyboard input, such that the Player position after resolution is a valid Tile center and no Gesture produces off-grid Player positions.
2. THE FP3D_Controller SHALL resolve every Gesture-derived turn intent to exactly one of the four cardinal directions {north, south, east, west}, with no intermediate facing value retained after the turn settles.
3. IF a Gesture-derived movement or turn intent is received during an in-progress Tile traversal, THEN THE FP3D_Controller SHALL buffer at most one such intent, SHALL discard any further intents until the traversal completes, and SHALL apply the single buffered intent through the standard movement resolution at the moment the traversal completes, matching the existing FP3D_Mode input-buffering behavior.
4. WHEN a Gesture-derived move crosses a Maze_Data tunnel edge (a maze-boundary Tile that Maze_Data marks as wrapping to the opposite side of the same row), THE FP3D_Controller SHALL apply the Maze_Data tunnel-wrap logic and SHALL preserve the current facing direction.
5. IF any Gesture-derived movement intent, including a Double_Tap dash, targets a Tile that is not enterable per Maze_Data, THEN THE FP3D_Controller SHALL keep the Player at the current Tile center and SHALL preserve the current facing direction.

### Requirement 8: Gestures are an additional input path, not a replacement

**User Story:** As a player who uses a keyboard, I want the new touch gestures to add to the controls rather than remove keyboard play, so that FP3D_Mode stays accessible.

#### Acceptance Criteria

1. THE FP3D_Controller SHALL continue to accept keyboard movement and turn controls in FP3D_Mode while the gesture input path is present.
2. WHERE the Player uses only the keyboard, THE FP3D_Controller SHALL allow full play — moving to any reachable Tile and turning to all four cardinal directions {north, south, east, west} — without requiring any touch input.
3. THE FP3D_Controller SHALL accept keyboard input and Gesture input interchangeably within a single session, with no input-mode lock that disables one path after the other is used.
4. WHILE the Quiz_System or micro-lesson overlay is open, THE FP3D_Controller SHALL ignore all Gesture-derived movement and turn intents so that Player position and facing remain unchanged, consistent with the existing FP3D_Mode freeze-while-overlay-open behavior.
5. WHILE Reduced_Motion is enabled, THE FP3D_Renderer SHALL suppress non-essential camera motion arising from gesture steering and Flick turns while still applying the resulting grid-locked position and cardinal facing changes.

### Requirement 9: Fullscreen toggle

**User Story:** As a player, I want a clearly labeled button to enter and exit fullscreen, so that I can play immersively on my device.

#### Acceptance Criteria

1. THE Math_Man_Game SHALL present a Fullscreen_Toggle control bearing a visible text or icon label whose accessible name states the action it will perform ("Enter fullscreen" when not in fullscreen, "Exit fullscreen" when in fullscreen).
2. WHEN the Player activates the Fullscreen_Toggle WHILE the game is not in fullscreen, THE Math_Man_Game SHALL request entering fullscreen through the Fullscreen_API for the game surface element.
3. WHEN the Player activates the Fullscreen_Toggle WHILE the game is in fullscreen, THE Math_Man_Game SHALL request exiting fullscreen through the Fullscreen_API.
4. WHEN the fullscreen state changes, THE Fullscreen_Toggle SHALL update its label and accessible state within 100 milliseconds to indicate whether the game is currently in fullscreen.
5. IF the Fullscreen_API is unavailable in the current browser, THEN THE Math_Man_Game SHALL remove the Fullscreen_Toggle from the interface and SHALL continue gameplay without error.
6. IF a fullscreen request is rejected or fails, THEN THE Math_Man_Game SHALL remain in its current display state, restore the Fullscreen_Toggle label and accessible state to match the actual fullscreen state, and continue gameplay without error.
7. THE Fullscreen_Toggle SHALL be operable using only the keyboard, reachable via Tab/Shift+Tab and activatable via Enter or Space, and SHALL expose an accessible name and role to assistive technologies.
8. WHILE the Fullscreen_Toggle holds keyboard focus, THE Math_Man_Game SHALL display a visible focus indicator on the Fullscreen_Toggle.
9. WHERE the device supports orientation control AND the game is in fullscreen on a mobile device, WHEN the device orientation changes, THE Math_Man_Game SHALL continue rendering FP3D_Mode with the maze and Player state unchanged and SHALL retain all Player progress.

### Requirement 10: FP3D_Mode is the only player-facing mode; 2D retained as internal fallback

**User Story:** As a player, I want the game to always start in first-person 3D without a mode toggle, while the game still protects me if 3D cannot run, so that the experience is simple and never broken.

#### Acceptance Criteria

1. THE Math_Man_Game menu SHALL NOT present a Player-selectable 2D/3D Render_Mode toggle. (Supersedes first-person-3d-mode Requirement 6.1.)
2. WHEN the Player starts a game from the menu, THE Math_Man_Game SHALL begin gameplay in the 3D Render_Mode (FP3D_Mode) using the current Grade selection. (Supersedes first-person-3d-mode Requirements 6.2 and 6.3.)
3. THE Math_Man_Game SHALL default the launch Render_Mode to `3d` regardless of any previously persisted Render_Mode value. (Supersedes first-person-3d-mode Requirement 6.6.)
4. THE Math_Man_Game SHALL retain the 2D Render_Mode internally solely as the automatic fallback path and SHALL NOT expose it as a Player-selectable menu option.
5. IF a WebGL_Context cannot be created within 5 seconds of a 3D render attempt, THEN THE Math_Man_Game SHALL start in the 2D Render_Mode and SHALL display a Player-visible notice with a dismissal control indicating that 3D rendering is unavailable, preserving the existing fallback behavior. (Retains first-person-3d-mode Requirements 8.1 and 1.6.)
6. WHEN the Math_Man_Game falls back to the 2D Render_Mode after a failed WebGL_Context creation or a Maze_Data validation failure, THE Math_Man_Game SHALL preserve the current Player progress — including lives count, score, and selected Grade — without restarting the game session. (Retains first-person-3d-mode Requirement 8.5.)
7. IF Maze_Data fails validation on load, THEN THE Math_Man_Game SHALL switch to the 2D Render_Mode as the internal fallback and SHALL display a Player-visible notice with a dismissal control indicating that 3D mode is unavailable, while preserving the unmodified Maze_Data layout. (Retains first-person-3d-mode Requirement 1.6.)
8. IF the WebGL_Context is lost during an active FP3D_Mode session, THEN THE Math_Man_Game SHALL switch to the 2D Render_Mode fallback and SHALL preserve the current Player progress without restarting the game session.
9. WHILE the game is running in the internal 2D fallback, THE Math_Man_Game SHALL preserve the same scoring, lives, quiz-on-capture, and persistence behavior defined for FP3D_Mode.

### Requirement 11: Testing the framework-agnostic gesture logic

**User Story:** As a maintainer, I want the gesture-classification and vector-to-direction logic covered by property-based tests, so that the feature meets the project's mandatory testing policy.

#### Acceptance Criteria

1. THE Gesture_Classifier and the vector-to-direction resolution SHALL be implemented in framework-agnostic modules that import neither Phaser nor Three.js.
2. FOR every Movement_Vector whose magnitude is at or above the Movement_Deadzone, THE vector-to-direction resolution SHALL produce exactly one movement intent from the set {forward, backward, strafe-left, strafe-right, diagonal} — never zero and never more than one (invariant property).
3. FOR every Movement_Vector whose magnitude is below the Movement_Deadzone, THE vector-to-direction resolution SHALL produce the steer intent and SHALL NOT request a Tile move (below-threshold boundary property).
4. FOR every Movement_Vector whose angular deviation from straight up is at or within the Forward_Assist_Cone, THE vector-to-direction resolution SHALL produce the forward movement intent (forward-assist property).
5. FOR every classified turn intent, THE turn resolution SHALL produce exactly one direction from the set {north, south, east, west} — never zero directions and never more than one (invariant property).
6. FOR every touch sample sequence, THE Gesture_Classifier SHALL classify the sequence as exactly one Gesture from the set {Touch_Hold, Drag, Flick, Tap, Double_Tap, Long_Press, Release} per completed interaction, such that a movement at or below the Flick_Duration_Threshold, at or above the Flick_Distance_Threshold, and within 30 degrees of horizontal is classified as a Flick, and a movement that exceeds the duration bound, falls below the distance bound, or exceeds the horizontal-angle bound is classified as a Drag (classification-boundary property).
7. FOR every touch sample sequence, THE Gesture_Classifier SHALL be deterministic, such that evaluating the identical input sequence more than once yields identical classification output (determinism property).
8. THE property-based tests for the framework-agnostic gesture logic SHALL run under Vitest with `fast-check` using at least 100 generated cases per property.
9. IF a property-based test for the framework-agnostic gesture logic fails or is absent, THEN the owning implementation task SHALL NOT be considered complete, and the failure SHALL be surfaced via the test runner's non-success exit result.

### Requirement 12: Mobile responsiveness and visible on-screen controls

**User Story:** As a player on a phone or tablet, I want the game to fill my screen and its controls to scale to my device, so that FP3D_Mode is comfortable to play in either orientation.

#### Acceptance Criteria

1. THE Math_Man_Game SHALL size the FP3D_Mode game surface to fill the mobile viewport using the dynamic viewport height (`100dvh`) so that mobile browser chrome does not clip the game surface.
2. THE Math_Man_Game SHALL respect the device safe-area insets (`env(safe-area-inset-*)`) so that the Virtual_Joystick, turn controls, and HUD are not occluded by notches, rounded corners, or system bars.
3. THE Math_Man_Game SHALL size the Virtual_Joystick, the on-screen turn controls, and the HUD relative to the viewport (using viewport-relative units) so that each remains usable on a small screen of 360 device-independent pixels in the shorter dimension.
4. WHEN the device orientation changes between portrait and landscape, THE Math_Man_Game SHALL re-flow the layout of the game surface, Virtual_Joystick, turn controls, and HUD to the new viewport and SHALL retain all Player state, including position, facing, lives count, score, and selected Grade.
5. WHERE the device is a Coarse_Pointer device in portrait orientation on a small screen of 480 device-independent pixels or fewer in width, THE Math_Man_Game MAY display a non-blocking hint suggesting landscape orientation that does not pause gameplay and does not block input.
6. WHERE the device is a touch/Coarse_Pointer device, THE Math_Man_Game SHALL show the visible on-screen controls (Virtual_Joystick and turn controls); WHERE the device is a fine-pointer/desktop device, THE Math_Man_Game SHALL hide the visible on-screen controls.
7. WHEN the Player drags the Virtual_Joystick, THE FP3D_Controller SHALL derive a Movement_Vector from the Virtual_Joystick displacement and SHALL resolve it to grid-locked movement through the same movement resolution used for the keyboard and Floating_Joystick paths, such that the Player position after resolution is a valid Tile center.
8. WHEN the Player activates an on-screen turn control, THE FP3D_Controller SHALL turn the camera facing to exactly one of the four cardinal directions {north, south, east, west} through the same turn resolution used for keyboard and Flick turns.

**Testability note (consistent with Requirement 11):** The visible-joystick rendering, safe-area handling, viewport sizing, orientation re-flow, and control show/hide behaviors are DOM/browser/visual concerns and remain **example-based / integration** checks (manual and cross-browser), not property-based tests. The Virtual_Joystick's vector-to-intent path (criterion 12.7) reuses the existing framework-agnostic vector-to-direction resolution already covered by the Requirement 11 Core Properties, so no new property is required. IF any new pure logic is added to map the Virtual_Joystick displacement to a Movement_Vector, THEN that mapping SHALL reuse the existing framework-agnostic resolver rather than introduce a second movement model, and SHALL be covered by the existing Requirement 11 properties.
