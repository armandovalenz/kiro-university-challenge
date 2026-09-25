---
name: fps3d-webgl
description: >
  First-person 3D web-browser game playbook for the Math Man stack (Phaser 3 +
  Vite + vanilla ES modules) using Three.js for the WebGL 3D layer. Use when
  designing or implementing FP3D_Mode: Three.js scene/camera/renderer setup,
  PointerLockControls, grid-locked first-person movement over an existing
  tilemap, occlusion-aware rendering of pellets/fruit/ghosts, performance
  budgeting, WebGL/reduced-motion fallbacks, and keeping game logic
  framework-agnostic and testable.
---

# First-Person 3D Web Game Playbook (Three.js on the Math Man stack)

Authoritative goal: a **fine-tuned first-person 3D mode** that renders the
**existing** Math Man maze (`src/maze/mazeData.js`, 28×31, `TILE_SIZE = 24`)
from inside it, while reusing all existing framework-agnostic systems
(`QuizSystem`, `QuestionBank`, `LessonBank`, `ScoreSystem`, `Storage`, `Maze`
helpers). This is a rendering + input concern layered on top of shared logic —
not a new game.

The full spec is the source of truth: `.kiro/specs/first-person-3d-mode/`.
When code and spec disagree, the spec wins; reconcile explicitly.

## 1. Library decision (per Requirement 9)

- **Use Three.js** for the WebGL layer. The project's own reference
  (`powers/game-engine/.../references/3d-web-games.md`) recommends it, it is the
  de-facto standard for first-person web games, and it installs cleanly into the
  existing Vite build.
- **Pin the version exactly** in `package.json` (`tech.md` requires pinned
  deps): add `"three": "<exact-version>"` under `dependencies`. Do not add other
  new runtime deps without a stated reason.
- Keep the 3D renderer **isolated behind an interface** (`FP3D_Renderer`,
  `FP3D_Controller`) so the rest of the game never imports Three.js directly and
  logic stays portable/testable. Phaser and Three.js coexist: Phaser owns scene
  flow, DOM overlays, audio, and 2D; Three.js owns only the 3D viewport.

## 2. Architecture seams

- `FP3D_Renderer` — builds the scene from `getLevelLayout()`, draws walls
  (instanced boxes), floor, pellet/power-pellet/fruit markers, and ghosts;
  handles occlusion visibility. Owns the Three.js `WebGLRenderer`, `Scene`,
  `PerspectiveCamera`.
- `FP3D_Controller` — maps input to **grid-locked** cardinal movement and
  camera facing; buffers at most one input during a traversal; handles tunnel
  wrap via `Maze` helpers.
- **Shared, untouched:** `ScoreSystem`, `QuizSystem`, `Storage`, quiz/lesson DOM
  overlays. FP3D calls the same methods the 2D `GameScene` calls. Pellet points,
  fruit extra-life (cap 10, start 6), quiz-on-capture, and `mathman.v1`
  persistence must go through these — never reimplemented.
- **Render_Mode** (`'2d' | '3d'`) persisted through `Storage`; default `'2d'`.

## 3. Three.js first-person setup (canonical shape)

```js
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR for perf
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
// Eye height at tile center; TILE_SIZE=24 → half a tile is a sane eye height.
```

- **Camera:** anchor to the center of the player's current tile at a fixed eye
  height; face one of {north, south, east, west} only (no intermediate yaw for
  grid-locked turns). If using mouse-look, `PointerLockControls` is the standard
  API (`sbcode.net/threejs/pointerlock-controls`, three.js docs) — but the spec
  requires **cardinal** facing, so either snap yaw to 90° increments or animate
  a discrete turn.
- **Movement:** interpolate position over ≤250 ms per tile (Req 2.2). Enterable
  check comes from `Maze` helpers, not a new maze source.
- **Walls:** one solid segment per wall tile, footprint = tile cell. Use
  `InstancedMesh` for all wall boxes (one draw call) — key perf win on a
  28×31 grid.

## 4. Occlusion-aware entities (Requirement 3.7–3.8)

Ghosts render only when in FOV **and** no wall tile lies on the straight grid
line between player tile and ghost tile. Implement the line-of-sight test in a
**pure, testable** helper over `Maze_Data` (grid Bresenham/supercover walk
checking wall codes) — do not rely on Three.js raycasting for the gameplay
visibility rule. Three.js raycasting may still be used for cosmetic effects.

- 4 ghosts, 4 distinct colors (reuse existing ghost palette from `config.js`).
- Pellets/power-pellets/fruit as billboard sprites or small meshes at floor
  position; remove marker on collect and award points via `ScoreSystem` exactly
  once per tile.

## 5. Performance budget

- One `InstancedMesh` per repeated element type (walls, pellets).
- Reuse geometries/materials; dispose them on scene teardown to avoid GPU leaks.
- Cap `devicePixelRatio` at 2; `renderer.setSize` on resize.
- Frustum culling is automatic; keep the far plane tight.
- Target a stable 60 fps on evergreen desktop browsers; degrade gracefully on
  mobile (lower DPR, simpler materials).

## 6. Fallbacks & accessibility (hard requirements)

- **No WebGL / context lost:** fall back to the existing 2D Render_Mode with a
  visible notice; keep `Maze_Data` unmodified (Req 1.6).
- **Missing asset:** drawn shape/text; **missing audio:** silent no-op;
  **blocked `localStorage`:** in-memory (`tech.md`).
- **Reduced motion / motion sensitivity:** honor `prefers-reduced-motion` —
  shorten or disable camera-turn animation; offer instant snap turns.
- Movement input via **keyboard and on-screen touch** (Req 2.6). Quiz/lesson
  overlays remain the same accessible DOM overlays as 2D.
- While an overlay (quiz/lesson/pause) is open, ignore all movement/turn input
  and freeze ghosts (Req 4.2, 6.7).

## 7. Testing (mandatory PBT — see steering/testing.md)

Property-based tests (Vitest + `fast-check`) are required for all new
**framework-agnostic** logic. Candidates that MUST get Core Properties + tests:

- Grid movement: a move only lands on an enterable neighbor or stays put.
- Tunnel wrap: wrapping preserves row and facing, lands in-bounds on the
  opposite edge.
- Input buffering: at most one buffered input survives a traversal.
- Line-of-sight: no visibility through any wall tile on the segment; symmetric.
- Scoring/lives reuse: point values and life cap (max 10, start 6) match 2D.

Keep Three.js-touching code (renderer/controller wiring, scene flow, DOM) as
example-based/integration checks — not forced into PBT — but still verified.
Traceability: each Core Property in `design.md` → one `fast-check` test named
with `Validates: Requirements x.y`.

## 8. Definition of done for an FP3D task

1. Behavior matches the cited `requirements.md` acceptance criteria.
2. New pure logic has passing `fast-check` properties (`npm run test -- --run`).
3. `npm run build` succeeds (do NOT run `npm run dev` in the agent shell).
4. Fallbacks (WebGL/asset/audio/storage) exercised or reasoned about.
5. No Three.js import leaked into framework-agnostic modules.
