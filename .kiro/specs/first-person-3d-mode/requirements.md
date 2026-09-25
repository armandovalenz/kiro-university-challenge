# Requirements Document

## Introduction

This feature adds a **first-person 3D mode** to Math Man, the existing Phaser 3 educational maze arcade game. Instead of the top-down 2D view, the player navigates the **same maze** from a first-person camera positioned at Math Man's location, walking corridors as walls rise around them, collecting pellets and fruit, and being pursued by the four Einstein ghosts.

The 3D mode is not a separate game. It renders the **existing maze layout** (`src/maze/mazeData.js`, 28×31 tile grid) and preserves the game's core educational loop: when a ghost catches the player, a grade-appropriate math or science quiz appears; a correct answer lets play resume, a wrong answer costs a life and shows an explanation. Fruit still grants an extra life and a micro-lesson. Lives (start 6, cap 10), scoring, difficulty-by-grade, and `localStorage` persistence remain shared with the existing 2D game.

A key constraint: the tech steering pins the stack to **Phaser 3 + Vite + vanilla ES modules**, with framework-agnostic logic kept portable and unit-testable. First-person 3D rendering is not something Phaser 3 provides natively, so a 3D rendering layer is a new concern. This document specifies **what** the 3D mode must do; the **how** (specific 3D library vs. hand-rolled WebGL/raycaster, and whether to add a dependency) is a design decision flagged in Requirement 9 and deferred to `design.md`.

## Glossary

- **Math_Man_Game**: The existing 2D Phaser game and its shared systems (scenes, entities, quiz, scoring, storage).
- **FP3D_Mode**: The new first-person 3D rendering and interaction mode being specified here.
- **FP3D_Renderer**: The component that draws the maze, collectibles, and ghosts as a first-person 3D scene.
- **FP3D_Controller**: The component that maps player input to grid-locked movement and camera orientation in FP3D_Mode.
- **Maze_Data**: The framework-agnostic tile-code layout and helpers in `src/maze/mazeData.js` / `src/maze/mazeLogic.js` (the shared source of truth for wall, pellet, power-pellet, spawn, fruit, and tunnel tiles).
- **Player**: The human user controlling Math Man.
- **Ghost**: One of the four Einstein enemy characters (red, pink, cyan, orange).
- **Quiz_System**: The existing capture-triggered question flow (`src/systems/QuizSystem.js`, `QuestionBank.js`).
- **Score_System**: The existing scoring and lives logic (`src/systems/ScoreSystem.js`).
- **Storage**: The existing `localStorage`-backed persistence (`src/systems/Storage.js`, key `mathman.v1`) with an in-memory fallback.
- **Grade**: The selected difficulty level, one of 5, 6, or 7.
- **Tile**: One cell of the maze grid; `TILE_SIZE` = 24 in 2D units.
- **Tunnel_Row**: A maze row flagged for horizontal wrap-around (left edge connects to right edge).
- **Render_Mode**: The active presentation of the game, either `2d` (existing top-down) or `3d` (FP3D_Mode).
- **WebGL_Context**: The browser rendering context required to draw hardware-accelerated 3D.

## Requirements

### Requirement 1: Reuse the existing maze as the single source of truth

**User Story:** As a player, I want the 3D mode to use the exact same maze as the 2D game, so that the level I know is faithfully represented in first person.

#### Acceptance Criteria

1. WHEN FP3D_Mode is initialized, THE FP3D_Renderer SHALL construct its 3D scene from the Maze_Data object returned by the existing `getLevelLayout` function, and SHALL leave the tile-code layout array byte-for-byte identical to the value returned by `getLevelLayout`.
2. WHERE a Tile holds a wall code, THE FP3D_Renderer SHALL render one solid 3D wall segment whose horizontal footprint equals that Tile's TILE_SIZE-by-TILE_SIZE grid cell.
3. WHERE a Tile holds a path, pellet, power-pellet, spawn, fruit, or tunnel code, THE FP3D_Renderer SHALL render that Tile as a traversable floor cell that contains no wall segment.
4. WHEN FP3D_Mode is initialized, THE FP3D_Renderer SHALL place Math_Man, each of the 4 Ghosts, and the fruit at the grid coordinates of their respective spawn Tiles defined in Maze_Data.
5. THE FP3D_Mode SHALL derive all wall, pellet, coordinate, and tunnel decisions from the framework-agnostic Maze_Data helpers, and SHALL NOT read from any maze definition other than the one returned by `getLevelLayout`.
6. IF Maze_Data fails validation on load, THEN THE FP3D_Mode SHALL switch to the existing 2D Render_Mode and SHALL display a user-visible notice indicating that 3D mode is unavailable, while preserving the unmodified Maze_Data layout.

### Requirement 2: First-person camera and grid-locked movement

**User Story:** As a player, I want to walk through the maze from a first-person viewpoint, so that I experience the maze from inside it.

#### Acceptance Criteria

1. WHILE FP3D_Mode is active, THE FP3D_Renderer SHALL anchor the camera to the center of the Player's current Tile at a fixed eye height and orient it along the Player's current facing direction.
2. WHEN the Player presses a movement input AND the target Tile in the requested cardinal direction is enterable per Maze_Data, THE FP3D_Controller SHALL move the Player one Tile into that target Tile within 250 milliseconds.
3. IF the Player presses a movement input AND the target Tile in the requested cardinal direction is not enterable per Maze_Data, THEN THE FP3D_Controller SHALL keep the Player at the current Tile and SHALL preserve the current facing direction.
4. WHEN the Player presses a turn input, THE FP3D_Controller SHALL set the camera facing to exactly one of the four cardinal directions {north, south, east, west} with no intermediate facing value.
5. WHEN the Player traverses a Tunnel_Row past a horizontal edge, THE FP3D_Controller SHALL place the Player on the opposite in-bounds edge Tile of the same row using the Maze_Data tunnel-wrap logic and SHALL preserve the current facing direction.
6. THE FP3D_Controller SHALL accept Player movement input through both keyboard controls and on-screen touch controls.
7. IF a movement or turn input is received during an in-progress Tile traversal, THEN THE FP3D_Controller SHALL buffer at most one such input and SHALL discard any additional inputs until the traversal completes.

### Requirement 3: Rendering collectibles and enemies in 3D

**User Story:** As a player, I want pellets, fruit, and ghosts to be visible and readable in the 3D view, so that I can play the game effectively.

#### Acceptance Criteria

1. WHILE a pellet remains at a Tile, THE FP3D_Renderer SHALL render a pellet marker at that Tile's floor position.
2. WHILE a power-pellet remains at a Tile, THE FP3D_Renderer SHALL render a power-pellet marker that differs from a standard pellet marker in at least one observable attribute (larger size, distinct color, or distinct shape).
3. WHEN the Player enters a Tile containing a pellet or power-pellet, THE FP3D_Mode SHALL remove that pellet marker from the scene.
4. WHEN the Player enters a Tile containing a pellet or power-pellet, THE FP3D_Mode SHALL award the item's points through the existing Score_System exactly once for that pellet.
5. WHILE a fruit is present, THE FP3D_Renderer SHALL render a fruit marker at the fruit spawn Tile.
6. THE FP3D_Renderer SHALL render each of the four Ghosts as a distinct entity, and no two Ghosts SHALL use the same identifying color.
7. WHILE a Ghost is within the Player's field of view AND no wall Tile lies on the straight line between the Player Tile and the Ghost Tile, THE FP3D_Renderer SHALL display that Ghost to the Player.
8. WHILE a wall Tile lies on the straight line between the Player Tile and the Ghost Tile, OR the Ghost is outside the Player's field of view, THE FP3D_Renderer SHALL NOT display that Ghost.

### Requirement 4: Preserve the quiz-on-capture mechanic

**User Story:** As a student, I want the educational quiz to trigger when a ghost catches me in 3D mode, so that the learning goal is preserved.

#### Acceptance Criteria

1. WHEN a Ghost occupies the same Tile as the Player in FP3D_Mode, THE FP3D_Mode SHALL pause first-person movement within 100 milliseconds and open the existing Quiz_System question flow for the current Grade.
2. WHILE the Quiz_System question flow is open, THE FP3D_Controller SHALL ignore all movement and turn inputs such that Player position and facing direction remain unchanged.
3. WHEN the Player answers a quiz question correctly, THE FP3D_Mode SHALL close the question flow, resume first-person movement, and preserve the current lives count unchanged.
4. IF the Player answers a quiz question incorrectly, THEN THE FP3D_Mode SHALL reduce the lives count by 1 through the existing Score_System, display the question explanation, and resume first-person movement only after the explanation is dismissed.
5. THE Quiz_System question flow SHALL present the identical question content, choices, and accessible markup used by the 2D Render_Mode for the selected Grade.
6. IF reducing lives through the Score_System causes the lives count to reach 0, THEN THE FP3D_Mode SHALL end the game session through the existing Score_System flow instead of resuming first-person movement.

### Requirement 5: Preserve scoring, lives, fruit rewards, and persistence

**User Story:** As a player, I want my score, lives, and records to work the same way in 3D mode, so that switching modes does not change the rules or lose my progress.

#### Acceptance Criteria

1. WHEN the Player collects a pellet, power-pellet, or fruit in FP3D_Mode, THE FP3D_Mode SHALL award points using the same Score_System point value assigned to that item type in the 2D Render_Mode.
2. WHEN the Player collects a fruit in FP3D_Mode AND current lives are below 10, THE FP3D_Mode SHALL grant one extra life through the Score_System and present the associated micro-lesson.
3. IF the Player collects a fruit in FP3D_Mode WHILE current lives equal 10, THEN THE Score_System SHALL leave lives unchanged at 10 and THE FP3D_Mode SHALL present the associated micro-lesson.
4. WHEN a new FP3D_Mode game starts, THE Score_System SHALL set lives to 6.
5. THE Score_System SHALL cap lives in FP3D_Mode at a maximum of 10.
6. WHEN lives reach 0 in FP3D_Mode, THE FP3D_Mode SHALL end the current game and transition to the game-over flow.
7. WHEN an FP3D_Mode game ends with a final score greater than the stored high score, THE Storage SHALL persist the final score as the new high score under key `mathman.v1`.
8. IF an FP3D_Mode game ends with a final score less than or equal to the stored high score, THEN THE Storage SHALL leave the stored high score under key `mathman.v1` unchanged.
9. THE FP3D_Mode SHALL read and write the selected Grade, mute state, and quiz statistics through the same Storage records under key `mathman.v1` used by the 2D Render_Mode.
10. IF a Storage read or write fails in FP3D_Mode, THEN THE Storage SHALL fall back to in-memory records for the current session and THE FP3D_Mode SHALL continue without interrupting gameplay.

### Requirement 6: Entering, switching, and exiting 3D mode

**User Story:** As a player, I want a clear way to start the game in first-person 3D and return to 2D, so that I can choose how I want to play.

#### Acceptance Criteria

1. THE Math_Man_Game menu SHALL present a Player-selectable control that toggles between the 2D Render_Mode and FP3D_Mode before a game starts.
2. WHEN the Player selects FP3D_Mode from the menu and starts a game, THE Math_Man_Game SHALL begin gameplay in the 3D Render_Mode using the current Grade selection.
3. IF the Player starts a game while no Render_Mode has been explicitly selected, THEN THE Math_Man_Game SHALL start gameplay in the 2D Render_Mode as the default.
4. WHILE FP3D_Mode is active, THE FP3D_Mode SHALL provide a Player-selectable control that ends the current game and returns the Player to the menu within 1 second of activation.
5. WHEN the Player selects the most recently used Render_Mode, THE Math_Man_Game SHALL persist that Render_Mode value through Storage so it is preselected on the next visit.
6. IF Storage is unavailable or contains no previously persisted Render_Mode, THEN THE Math_Man_Game SHALL preselect the 2D Render_Mode as the default.
7. WHILE FP3D_Mode is active AND the game is paused, THE FP3D_Mode SHALL suspend first-person movement input and ghost activity until the Player resumes play.

### Requirement 7: Accessibility

**User Story:** As a player who relies on assistive technology or has motion sensitivity, I want the 3D mode to remain usable, so that the educational content is accessible to me.

#### Acceptance Criteria

1. THE Quiz_System and micro-lesson interfaces used in FP3D_Mode SHALL be presented as DOM overlays that are fully operable using only the keyboard, with every interactive control reachable via Tab/Shift+Tab and activatable via Enter or Space.
2. THE Quiz_System and micro-lesson DOM overlays used in FP3D_Mode SHALL expose to assistive technologies an accessible name and role for every interactive control and for the overlay container.
3. WHERE the Player has not enabled a pointer-lock or mouse-look interaction, THE FP3D_Controller SHALL allow full play (moving to any reachable maze tile and turning to all four cardinal directions) using discrete keyboard turn and move controls, without requiring any pointing-device input.
4. WHEN the Player enables the reduced-motion setting, THE FP3D_Mode SHALL suppress all non-essential camera motion (camera bob, view sway, and transition animations) while preserving grid-locked position changes required for play.
5. IF the operating system or browser reports a reduced-motion preference at FP3D_Mode start, THEN THE FP3D_Mode SHALL initialize with the reduced-motion setting enabled.
6. WHILE the mute setting is enabled, THE FP3D_Mode SHALL silence all audio output so that no sound is produced.
7. WHEN FP3D_Mode opens the Quiz_System overlay, THE FP3D_Mode SHALL move keyboard focus to the first interactive control within the overlay within 500 milliseconds so the Player can answer without a pointing device.
8. WHILE the Quiz_System overlay is open, THE FP3D_Mode SHALL confine keyboard focus to controls within the overlay so that Tab and Shift+Tab do not move focus to elements behind the overlay.

### Requirement 8: Graceful fallbacks

**User Story:** As a player on a device or browser that cannot render 3D, I want the game to keep working, so that I am never blocked from playing.

#### Acceptance Criteria

1. IF a WebGL_Context cannot be created within 5 seconds of a 3D render attempt, THEN THE Math_Man_Game SHALL start in the 2D Render_Mode and SHALL display a Player-visible message indicating that 3D rendering is unavailable.
2. IF a required 3D texture or model asset fails to load within 10 seconds or returns a load error, THEN THE FP3D_Renderer SHALL substitute a drawn placeholder shape for the missing asset and SHALL continue play without interrupting the current session.
3. IF an audio clip referenced by a stable sound key is missing or fails to load while in FP3D_Mode, THEN THE FP3D_Mode SHALL treat that sound as a silent no-op and SHALL continue play without displaying an error to the Player.
4. WHERE Storage is unavailable, THE FP3D_Mode SHALL use the in-memory persistence fallback and SHALL retain all persisted values for the duration of the active session.
5. WHEN the Math_Man_Game falls back to the 2D Render_Mode after a failed WebGL_Context creation, THE Math_Man_Game SHALL preserve the current Player progress, including lives count, score, and selected grade difficulty.

### Requirement 9: Technical approach and dependency constraints

**User Story:** As a maintainer, I want the 3D mode to fit the project's pinned stack and conventions, so that it stays maintainable and testable.

#### Acceptance Criteria

1. THE FP3D_Mode SHALL keep maze interpretation, movement, coordinate, pellet, and tunnel-wrap logic in framework-agnostic modules that import neither Phaser nor any 3D rendering library.
2. WHERE FP3D_Mode requires a new 3D rendering dependency, THE design document SHALL identify the dependency by name, state its justification, and pin it to an exact version with no range or wildcard qualifier, consistent with the existing dependency policy.
3. WHEN the existing Vite build command is run, THE FP3D_Mode SHALL leave the 2D Render_Mode building and running with no change to its existing observable behavior.
4. WHEN the existing Vite production build completes, THE build output SHALL include the FP3D_Mode code.
5. IF the Vite production build fails with FP3D_Mode included, THEN the failure SHALL be surfaced via the build command's non-success exit result.

### Requirement 10: Testing the framework-agnostic 3D logic

**User Story:** As a maintainer, I want the new framework-agnostic logic to be covered by property-based tests, so that the feature meets the project's mandatory testing policy.

#### Acceptance Criteria

1. THE first-person coordinate mapping SHALL provide a function that converts a Tile to a 3D world position and an inverse that recovers the Tile, such that for every in-bounds Tile — column in [0, cols-1] and row in [0, rows-1] tied to the Maze_Data dimensions — converting the Tile to a world position and back yields a Tile whose column and row both equal the original (round-trip property).
2. FOR every wall Tile requested as a move target, THE FP3D_Controller movement resolution SHALL produce a resolved Player position whose column and row both equal the Player's prior position (invariant property).
3. FOR every turn input, THE FP3D_Controller camera-facing resolution SHALL produce exactly one direction from the set {north, south, east, west} — never zero directions and never more than one (invariant property).
4. WHEN the Player crosses a Tunnel_Row edge, THE tunnel-wrap resolution SHALL produce a resolved Tile whose row equals the entry row and whose column equals the opposite in-bounds edge column determined by the Maze_Data wrap logic (metamorphic property against Maze_Data wrap logic).
5. THE property-based tests for the framework-agnostic 3D logic SHALL run under Vitest with `fast-check` using at least 100 generated cases per property.
6. IF a property-based test for the framework-agnostic 3D logic fails or is absent, THEN the owning implementation task SHALL NOT be considered complete, and the failure SHALL be surfaced via the test runner's non-success exit result.
