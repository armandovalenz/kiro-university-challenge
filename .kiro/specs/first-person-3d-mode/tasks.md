# Implementation Plan

## Overview

This plan adds a **first-person 3D mode** (FP3D_Mode) to the existing Math Man game as a rendering + input layer, ordered so the framework-agnostic logic and its mandatory property-based tests come first, then the isolated Three.js renderer, then the Phaser scene that wires everything to the *existing* shared systems (`MazeGrid`, `ScoreSystem`, `QuizSystem`, `QuestionBank`, `LessonBank`, `Storage`). Each task is coding-only and builds on prior tasks; no logic is forked from the 2D game.

Two hard boundaries drive the ordering:

- **Dependency isolation (Req 9.1):** `src/systems/fp3d/fp3dLogic.js` and `src/systems/fp3d/lineOfSight.js` import neither Phaser nor Three.js — only `mazeData.js`/`mazeLogic.js` and `config.js`. Three.js is confined to `src/render/FP3DRenderer.js`; Phaser lives in `src/scenes/FP3DScene.js`.
- **Mandatory property-based testing (`.kiro/steering/testing.md`, Req 10):** the seven **Correctness Properties** (`Property 1`–`Property 7` in `design.md`) each get a dedicated `fast-check` property test under Vitest, run at ≥100 cases, with a `Validates: Requirements x.y` comment. These property-test tasks are **required** — none is optional. A pure-logic task is not complete until its property tests exist and pass (`npm run test -- --run`), and every task ends by confirming `npm run build` still succeeds with the 2D mode unchanged.

Property tasks carry a `_Properties:_` line linking them to the design's Core Properties, preserving the requirement → property → task → test trace.

## Tasks

- [ ] 1. Add the Three.js dependency and FP3D configuration
  - Add `"three": "0.186.0"` (exact pin, no range/wildcard) under `dependencies` in `package.json`, alongside the existing pinned `phaser`/`vite`/`vitest`/`fast-check`, and run `npm install`. This modifies `package.json` and `package-lock.json` — disclose the dependency addition when executing this task rather than installing silently.
  - Add the `FP3D` constants block to `src/config.js` (`eyeHeight`, `dprCap = 2`, `tileTraversalMs = 220`, `turnAnimMs = 120`, `fovDegrees = 75`, `webglTimeoutMs = 5000`, `assetTimeoutMs = 10000`) and `DEFAULT_RENDER_MODE = '2d'` — no hardcoded numbers in scenes/renderer.
  - Run `npm run build` to confirm the dependency install and config change leave the existing 2D build working.
  - _Requirements: 9.2, 6.3, 6.6_

- [ ] 2. Implement FP3D coordinate mapping in `fp3dLogic.js`
  - Create `src/systems/fp3d/fp3dLogic.js` (framework-agnostic — imports only `mazeData.js`/`mazeLogic.js` and `config.js`, never Phaser or Three.js).
  - Export `CARDINALS`, `CARDINAL_TO_DIR`, and implement `tileToWorld3D(grid, col, row)`, `worldToTile3D(grid, x, z)` (floors each axis by `TILE_SIZE`, matching `MazeGrid.worldToTile`), and `eyePosition(grid, col, row, eyeHeight)`, all delegating tile-size/grid questions to the passed `MazeGrid` instance.
  - _Requirements: 2.1, 1.1, 9.1_
  - _Properties: Property 1_

- [ ]* 3. Write property test for coordinate round-trip
  - Add `src/systems/fp3d/fp3dLogic.test.js` with a `fast-check` property (≥100 cases) that builds a `MazeGrid` from `getLevelLayout()`, draws any in-bounds tile, and asserts `worldToTile3D(...tileToWorld3D(...))` recovers `col`/`row`, and that the grid's tile-code layout stays identical to `getLevelLayout()`.
  - Comment the test `// Property 1: Tile → world3D → tile round-trip — Validates: Requirements 10.1, 1.1` and run `npm run test -- --run`.
  - **Property 1: Tile → world3D → tile round-trip**
  - **Validates: Requirements 10.1, 1.1**

- [ ] 4. Implement movement resolution, facing, and input buffering in `fp3dLogic.js`
  - Add `resolveMove(grid, col, row, facing)` that wraps `MazeGrid.attemptMove(col, row, CARDINAL_TO_DIR[facing])` and returns its `{ col, row, moved }` verbatim (unchanged tile when the target is a wall/out of bounds).
  - Add `turnLeft(facing)`, `turnRight(facing)`, and `setFacing(facing)` that each return exactly one `CARDINALS` member (validated pass-through / default `'north'`).
  - Add an `InputBuffer` class with `push(intent)` (retains at most one pending intent, drops extras), `take()` (returns + clears the single intent or null), and a `size` getter that is always 0 or 1.
  - _Requirements: 2.2, 2.3, 2.4, 2.7, 9.1_
  - _Properties: Property 2, Property 3, Property 5_

- [ ]* 5. Write property tests for movement, facing, and buffering
  - In `fp3dLogic.test.js`, add three `fast-check` properties (≥100 cases each), each with its `Validates` comment, and run `npm run test -- --run`.
  - **Property 2: Movement resolution respects walls** — wall/out-of-bounds target yields `{ moved: false }` with the start tile; enterable target yields that neighbor. **Validates: Requirements 10.2, 2.3**
  - **Property 3: Facing resolution yields exactly one cardinal** — `turnLeft`/`turnRight`/`setFacing` always return exactly one of `{north, south, east, west}`. **Validates: Requirements 10.3, 2.4**
  - **Property 5: Input buffering keeps at most one** — over any push sequence, `size` never exceeds 1 and `take()` returns the single retained intent (or null). **Validates: Requirements 2.7**

- [ ] 6. Implement tunnel-wrap resolution in `fp3dLogic.js`
  - Add `resolveTunnel(grid, col, row, facing)` that, for a player on a Tunnel_Row stepping off a horizontal edge, returns `{ col, row, facing }` with the same row, the opposite in-bounds edge column (from the `MazeGrid` tunnel-wrap logic / `tunnelRows`/`cols`), and the facing preserved.
  - _Requirements: 2.5, 9.1_
  - _Properties: Property 4_

- [ ]* 7. Write property test for tunnel-wrap resolution
  - In `fp3dLogic.test.js`, add a `fast-check` property (≥100 cases) generating tunnel-row positions that step off an edge, asserting the resolved row equals the entry row, the column equals the opposite in-bounds edge per `MazeGrid` wrap logic, and facing is unchanged. Run `npm run test -- --run`.
  - **Property 4: Tunnel-wrap resolution**
  - **Validates: Requirements 10.4, 2.5**

- [ ] 8. Implement `lineOfSight.js` grid line-of-sight
  - Create `src/systems/fp3d/lineOfSight.js` (framework-agnostic) with `hasLineOfSight(grid, fromCol, fromRow, toCol, toRow)` — a pure supercover/Bresenham grid walk over `MazeGrid`, checking `WALL_CODES` via `grid.isWall`, endpoints excluded, symmetric in its tile arguments — and `isGhostVisible(grid, player, facing, ghost, fovDegrees)` combining LOS with a field-of-view test.
  - _Requirements: 3.7, 3.8, 9.1_
  - _Properties: Property 6_

- [ ]* 9. Write property test for line-of-sight
  - Add `src/systems/fp3d/lineOfSight.test.js` with a `fast-check` property (≥100 cases): if any wall tile lies on the straight segment between two tiles then `hasLineOfSight` is false, and `hasLineOfSight(grid, a, b) === hasLineOfSight(grid, b, a)` for any two tiles. Run `npm run test -- --run`.
  - **Property 6: Line-of-sight is wall-blocked and symmetric**
  - **Validates: Requirements 3.7, 3.8**

- [ ]* 10. Write property test for scoring/lives reuse
  - In `fp3dLogic.test.js` (or a colocated pure-logic test), add a `fast-check` property (≥100 cases) asserting that item collection awards the existing `POINTS` value per type via `MazeGrid.pointsFor` + `ScoreSystem.addScore`, and that over any run lives start at 6, `gainLife` never exceeds 10, `loseLife` never drops below 0, a correct answer costs 0 lives, and a wrong answer costs exactly 1 (`lifeCostFor`). Run `npm run test -- --run`.
  - **Property 7: Scoring and lives reuse matches the 2D rules**
  - **Validates: Requirements 5.1, 5.3, 5.4, 5.5**

- [ ] 11. Checkpoint - pure FP3D logic verified
  - Run `npm run test -- --run` and confirm Properties 1–7 all pass; run `npm run build` and confirm the 2D build is unchanged. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 10.5, 10.6, 9.3_

- [ ] 12. Implement the Three.js renderer core (`FP3DRenderer.js`)
  - Create `src/render/FP3DRenderer.js` — the **only** module that imports Three.js. Construct `WebGLRenderer` (`antialias: true`, `powerPreference: 'high-performance'`, `setPixelRatio(Math.min(devicePixelRatio, dprCap))`, tight far plane), a `Scene`, and a `PerspectiveCamera` using `FP3D.fovDegrees`; throw `NoWebGLContextError` when a context cannot be obtained.
  - Attach a `webglcontextlost` listener on the renderer's canvas at construction time that invokes an injected `onContextLost` callback — this is the MID-SESSION context-loss path (distinct from the construction-time `NoWebGLContextError` throw) and is what lets `FP3DScene` (Task 16) fall back to 2D after a context loss during play, not just on startup (Req 8.1, 8.5).
  - Implement `buildMaze(grid)` — one `InstancedMesh` of wall boxes sized to `TILE_SIZE` cells for wall tiles (one draw call, Req 1.2) plus a floor plane over traversable tiles (Req 1.3) — and `setCamera(col, row, facing)` placing the camera at `eyePosition` with yaw snapped to a cardinal.
  - Implement `dispose()` releasing geometries/materials/renderer and removing the `webglcontextlost` listener, plus `render(state)`.
  - Run `npm run build` to confirm the 3D code ships in the Vite build.
  - _Requirements: 1.2, 1.3, 2.1, 2.4, 8.1, 8.5, 9.4_

- [ ] 13. Implement renderer markers, ghosts, and occlusion
  - Add `setPelletVisible(col, row, visible)` (pellet markers, Req 3.1) with power-pellet markers differing in size/color/shape (Req 3.2), `setFruit(col, row, present)` (Req 3.5), `animateMove(from, to, ms)` / `animateTurn(from, to)` (instant snap when `reducedMotion`), and `setReducedMotion(enabled)` — a **live** toggle (not constructor-only) so Task 17's mid-session `prefers-reduced-motion` handling can flip it after construction and have it apply to the next `animateTurn`/`animateMove` call (Req 7.4, 7.5).
  - Add `setGhosts(ghostStates, visibilityFn)` rendering four ghosts in distinct `GHOST_COLORS` (Req 3.6) and hiding each ghost per the **injected** `visibilityFn` (backed by `lineOfSight` + FOV) — never via raycasting (Req 3.7, 3.8). Each ghost state MUST carry `personality` (from `GHOST_PERSONALITIES`) alongside `key`/`color`/`col`/`row` — `ghostAI.computeTargetTile`/`chooseGhostDirection` (Task 14) branch on it, so omitting it here would silently default every ghost to the same target-tile rule.
  - Run `npm run build`.
  - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 7.4, 7.5_

- [ ] 14. Implement `FP3DScene` gameplay loop and collectible collection
  - Create `src/scenes/FP3DScene.js` (Phaser). In `create()`, build a `MazeGrid` from `getLevelLayout()`, construct `FP3DRenderer`, place Math Man / 4 ghosts / fruit at their spawn tiles (Req 1.4), and wire input. Each ghost's in-memory state carries `{ key, color, personality, col, row }` from `GHOST_PERSONALITIES` (config.js) — `personality` is required by `ghostAI`, not optional decoration.
  - In `update(t, dt)`, step tile-to-tile movement interpolation (≤250 ms via `FP3D.tileTraversalMs`), apply `resolveMove`/`resolveTunnel`, advance ghosts via a thin per-tick wrapper around the EXISTING, already framework-agnostic `src/entities/ghostAI.js` exports (`chooseGhostDirection`, `computeTargetTile`, `ghostSpeedForGrade`) — never `src/entities/Ghost.js` (the Phaser sprite class) and never a forked copy of the personality/target-tile logic — collect pellets/power-pellets/fruit via `MazeGrid.eatPelletAt` → `ScoreSystem.addScore` (each pellet scored once, Req 3.4) and `setPelletVisible(false)`, then call `FP3DRenderer.render(state)`.
  - _Requirements: 1.4, 2.2, 2.5, 3.3, 3.4, 5.1, 5.2, 9.1_

- [ ] 15. Wire the capture → quiz and fruit → lesson loops with freeze
  - On a ghost occupying the player's tile, within 100 ms `sfx('sfx_caught')`, freeze the scene, and launch the existing `QuizScene(grade)`; on correct resume with lives unchanged; on wrong call `ScoreSystem.loseLife()`, show the explanation, then resume — or route to `GameOverScene` (updating `Storage` high score) when `isGameOver()` (Req 4.1, 4.3, 4.4, 4.6, 5.6, 5.7).
  - On fruit overlap call `ScoreSystem.gainLife()` (cap 10) and launch the existing `LessonScene`; while any overlay is open, ignore movement/turn input and suspend ghost activity (Req 4.2, 6.7).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 6.7_

- [ ] 16. Add the menu Render_Mode toggle, scene registration, and WebGL fallback
  - Add a 2D/3D Render_Mode toggle to `MenuScene` that persists the choice through `Storage` under `mathman.v1` (`renderMode`, `Storage.normalize` coerces invalid values to `'2d'`), defaulting to `'2d'` when unset/unavailable; register `FP3DScene` in `src/main.js`'s scene list.
  - Starting a game with `renderMode === '3d'` launches `FP3DScene` with the current grade; if `FP3DRenderer` reports no WebGL context (or context loss), stop, show a visible "3D unavailable" notice, set the `renderMode` intent to `'2d'`, and start `GameScene` preserving lives/score/grade — leaving `Maze_Data` unmodified.
  - Run `npm run build`.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 1.6, 8.1, 8.5_

- [ ] 17. Implement accessibility controls and reduced-motion
  - Support both keyboard and on-screen touch controls for move/turn; ensure full play is possible with discrete keyboard controls without pointer-lock (Req 2.6, 7.3).
  - Initialize reduced-motion from `matchMedia('(prefers-reduced-motion: reduce)')` and honor the user setting by snapping turn/move animations while keeping grid-locked position changes (Req 7.4, 7.5); ensure mute silences all FP3D audio (Req 7.6).
  - Ensure the FP3D-launched quiz/lesson overlays move focus to the first control within 500 ms and trap focus until closed (reusing the existing DOM overlays and their roles/names) (Req 7.1, 7.2, 7.7, 7.8).
  - _Requirements: 2.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [ ] 18. Implement asset, audio, and storage fallbacks
  - Substitute a drawn placeholder mesh for any 3D texture/model that fails to load within `assetTimeoutMs`, continuing play (Req 8.2).
  - Route FP3D sounds through the existing `AudioBus` so a missing sound key is a silent no-op (Req 8.3); ensure a blocked/absent `localStorage` degrades the `renderMode` record (and all others) to the existing in-memory fallback for the session (Req 8.4).
  - Run `npm run build`.
  - _Requirements: 8.2, 8.3, 8.4_

- [ ] 19. Final checkpoint - full verification
  - Run the complete property suite with `npm run test -- --run` and confirm Properties 1–7 pass at ≥100 cases each; run `npm run build` and confirm it succeeds with FP3D included and the 2D mode's observable behavior unchanged.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 9.3, 9.4, 9.5, 10.5, 10.6_

## Notes

- Requirement references map back to `requirements.md`; `design.md` details each module and the dependency boundaries.
- The `_Properties:_` line on each pure-logic task links its code to the Core Properties it must satisfy; those properties (1–7) must have passing `fast-check` tests before the owning task is done (`.kiro/steering/testing.md`).
- Property-test sub-tasks (3, 5, 7, 9, 10) are **mandatory**, not optional — the `*` marker only signals they are test sub-tasks the executor writes alongside the owning implementation task; they must be executed and must pass.
- `fp3dLogic.js` and `lineOfSight.js` stay free of Phaser and Three.js imports (Req 9.1); `FP3DRenderer.js` is the sole Three.js importer, `FP3DScene.js` the sole new Phaser scene.
- Never run `npm run dev` in the agent shell — it is long-running and must be started by the user in their own terminal.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3", "4"] },
    { "id": 3, "tasks": ["5", "6"] },
    { "id": 4, "tasks": ["7", "8", "10"] },
    { "id": 5, "tasks": ["9", "12"] },
    { "id": 6, "tasks": ["13"] },
    { "id": 7, "tasks": ["14"] },
    { "id": 8, "tasks": ["15", "16"] },
    { "id": 9, "tasks": ["17", "18"] },
    { "id": 10, "tasks": ["19"] }
  ]
}
```
