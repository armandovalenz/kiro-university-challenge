---
name: fps3d-webgl
description: >
  First-person 3D web-browser game playbook for the Math Man stack (Phaser 3 +
  Vite + vanilla ES modules) using Three.js for the WebGL 3D layer. Use when
  designing or implementing FP3D_Mode: Three.js scene/camera/renderer setup,
  PointerLockControls, grid-locked first-person movement over an existing
  tilemap, occlusion-aware rendering of pellets/fruit/ghosts, performance
  budgeting, WebGL/reduced-motion fallbacks, orienting and wall-mounting GLB
  props (portrait frames, torches, signs) via the shared wallDecor placement
  helper, pooled point lights for light-emitting props, fitting photos into frames without
  stretching (cover-crop + antialiased canvas textures), viewport/aspect
  sizing, and keeping game logic framework-agnostic and testable.
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

> **Sources & attribution.** This playbook was authored with Kiro (AI-assisted)
> and distills public documentation, rephrased and summarized for licensing
> compliance:
> [Three.js documentation](https://threejs.org/docs/),
> [three.js `PointerLockControls`](https://threejs.org/docs/#examples/en/controls/PointerLockControls),
> [sbcode.net Three.js tutorials](https://sbcode.net/threejs/pointerlock-controls/), and
> [MDN Web Docs — 3D on the web](https://developer.mozilla.org/en-US/docs/Games/Techniques/3D_on_the_web)
> (MDN text: CC-BY-SA 2.5). The project's own
> `powers/game-engine/.../references/3d-web-games.md` reference is also drawn on.
> Each linked source remains under its own license.

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
- **Size the renderer from the box the canvas fills.** The FP3D canvas is
  styled `100% × 100%` of its host container, so `renderer.setSize()` and
  `camera.aspect` must use that container's `clientWidth` / `clientHeight`
  (`FP3DScene._syncRendererSize`). Phaser's `scale.displaySize` has the maze's
  aspect, not the container's. Using it once stretched the whole 3D view about
  2× horizontally: frames looked wider than tall and pellets looked squashed.
  If geometry you know the proportions of looks off, check the aspect before
  touching the model.

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

## 7. Wall-mounted GLB props (lessons from the portrait frame)

Hanging a decorative GLB (portrait frame, sign, plaque) on a wall face took
many failed attempts. Hand-derived Euler angles and stacked
"fix" rotations kept coming out tumbled, sideways, or buried in the brick. The
method below worked first time. Use it for any wall prop.

### 7.1 Inspect the GLB before writing any rotation

Never guess a model's axes from the handoff prose or from a Blender screenshot.
Read the file itself with a small Node script:

- **Node transforms:** parse the JSON chunk and print `nodes[]`. A `rotation`
  quaternion on the mesh node is a **baked rotation**. It is often arbitrary
  and slightly tilted (the portrait frame's was about 10° off-axis).
- **Raw geometry:** read the `POSITION` accessor `min`/`max` for the extents,
  then group vertices by their value on the thinnest axis. That tells you which
  side is the flat back (the full-size rectangle) and which is the front (the
  ornaments or smaller profile).

```js
// Minimal GLB reader: JSON chunk + BIN chunk.
const buf = fs.readFileSync('public/assets/models/portrait_frame.glb');
let o = 12, json, bin;
while (o < buf.length) {
  const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4); o += 8;
  if (type === 0x4E4F534A) json = JSON.parse(buf.slice(o, o + len));
  else if (type === 0x004E4942) bin = buf.slice(o, o + len);
  o += len;
}
console.log(json.nodes); // baked rotation/translation/scale live here
```

Portrait-frame facts, for reference: raw X ∈ ±7.44 (width 14.88), raw Z ∈ ±9.36
(height 18.72), raw Y ∈ [0, 5.64] (depth). The flat back is at y = 0 and the
ornaments peak at y = 5.64.

### 7.2 Discard the baked rotation and place from raw geometry

- **Reset every node, not just the root.** `gltf.scene.clone()` returns a
  wrapper, and the baked quaternion sits on the child mesh node. Clearing
  `model.quaternion` on the wrapper does nothing. Traverse the whole clone:

  ```js
  model.traverse((o) => { o.quaternion.identity(); o.position.set(0, 0, 0); o.scale.set(1, 1, 1); });
  ```

- **Map raw axes to the wall frame with one basis matrix.** Use the group's
  local convention X = along the wall, Y = up, Z = out of the wall into the
  corridor. Build the rotation directly from where each raw axis should go, and
  keep det = +1 (flip the width axis if needed):

  ```js
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), // raw X (width)           → −X
    new THREE.Vector3(0, 0, 1),  // raw Y (back → front)    → +Z
    new THREE.Vector3(0, 1, 0),  // raw Z (height)          → +Y
  );
  pivot.quaternion.setFromRotationMatrix(basis);
  ```

- **Seat the flat back at local z = 0.** With the back at raw y = 0 it lands on
  the wall face automatically, with no depth offset. Recentre only if the raw
  mesh is not already centred on the other two axes.

### 7.3 Put the wall frame on the group

- Position the group on the wall tile's **inner face**: the wall tile centre
  (`tileToWorld3D`) pushed `tile / 2` toward the open neighbour, minus a small
  offset to avoid z-fighting.
- Give the group a yaw that sends local +Z along the outward normal. Rotating
  +Z by yaw θ gives (sin θ, 0, cos θ), so north (−Z) is π, south (+Z) is 0,
  east (+X) is π/2 and west (−X) is −π/2. Do **not** reuse `FACING_TO_YAW`.
  That table is the camera convention, where the camera looks down −Z, and its
  sign is the opposite of what a prop needs.
- Keep **two levels**: the group handles wall placement and yaw, and an inner
  pivot handles model orientation. When the result is consistent across all
  wall directions, the group is right and any remaining error is in the pivot.

### 7.4 Debugging orientation

- Add a temporary `THREE.AxesHelper` to each prop group (red = along the wall,
  green = up, blue = out) behind a config flag. A screenshot of the axes shows
  which level is wrong. Turn the flag off when you're done.
- **Don't stack correction knobs** (roll, pitch or face rotations applied in
  sequence). Each one changes the axes the next one acts on, and they compound
  unpredictably. If you need a correction, fix the basis matrix instead.
- Check any rotation you do derive numerically (a short Node script that
  applies it to the three axis vectors) before building. "Should be right" is
  not enough.

### 7.5 Picture inserts (photos inside frames)

The frame and its photo are separate: the frame is a GLB, and the photo is a
plane added to the same group after the frame loads
(`_attachPortraitPicture`).

- **Size the plane from the real opening, not the prose.** Read the inner-lip
  vertices from the GLB. For the portrait frame the opening is 7.68 × 11.52,
  the lip sits at raw y = 1.44, and the back is at 0. Make the plane about 12%
  larger than the opening and set it just behind the lip (z = 1.2). That hides
  its edges at any viewing angle without cutting into the moulding.
- **Place it in the group's frame.** Use X along the wall, Y up and Z out. An
  unrotated `PlaneGeometry` already faces +Z with the image upright and not
  mirrored, so it needs no rotation.
- **Cover-crop, never stretch.** Use `coverCropRect(srcW, srcH, targetAspect,
  focusX, focusY)` from `src/systems/fp3d/imageCrop.js`. It is pure and
  property-tested, and returns the largest source rectangle with the target
  aspect. Draw that rectangle onto a canvas of the opening's aspect (512 × 768
  for 2:3) with `imageSmoothingQuality = 'high'`, then wrap the canvas in a
  `CanvasTexture`. Set sRGB colour space, clamp-to-edge wrapping,
  `LinearMipmapLinearFilter` and max anisotropy. Resampling on the canvas is
  the antialiasing step; dispose the raw image texture afterwards.
  - Use `focusY` below 0.5 to keep heads in frame when a photo is taller than
    the opening. Centre horizontally.
  - Don't crop with `texture.repeat` / `offset`. It works, but you lose control
    over the resampling quality.
- **One texture per photo.** Cache it in a promise map, load it through the
  timeout-guarded `loadTexture` seam, and share it across frames. Give each
  plane its own `MeshStandardMaterial`, which `_disposeMaze` frees when the
  maze is rebuilt. Disposing a material doesn't dispose its map, so shared
  textures survive until `dispose()`.
- **Readable in dim corridors.** Set `emissiveMap` to the photo texture at a
  low `emissiveIntensity` (about 0.25).
- **Fallback (Req 8.2).** The plane starts as a plain dark canvas colour and
  switches to the photo on load. Before applying a late load, check that the
  material still exists (`this._materials.has(mat)`), in case the maze was
  rebuilt in the meantime.
- **Photo choice.** Pick the photo with the same seeded RNG as the placement,
  after the placement picks are drawn, so adding photos doesn't reshuffle
  where frames hang. Avoid the same photo twice in a row.

### 7.6 Placement and fallback rules

- **Use the shared helper. Don't write per-prop placement maths.**
  `src/systems/fp3d/wallDecor.js` is pure and property-tested, and portraits
  and torches both use it:
  - `wallFaces(grid)` returns every wall face bordering an open corridor tile,
    with its outward normal and group yaw (`WALL_NEIGHBORS`).
  - `seededRandom(seed)` is a mulberry32 RNG.
  - `pickSpacedFaces(faces, { rand, every, minSpacing, excludeWalls })` keeps
    about 1 in `every` faces, at most one per wall tile, at least
    `minSpacing` tiles apart, and skips `excludeWalls`.
- Use a separate seed for each prop type, so tuning one never reshuffles the
  other.
- Build props in a fixed order and pass the earlier ones' wall tiles
  (`wallKey(col, row)`) as `excludeWalls`. Torches skip `_portraitWalls`, for
  example.
- Never mutate `getLevelLayout()`, since props are decorative and don't affect
  collision.
- Load the GLB **once** into a cached promise and `clone(true)` it for each
  placement. Use a `FP3D.assetTimeoutMs` race, and fall back to a drawn box
  placeholder seated the same way (Req 8.2).
- Props are static maze dressing, so track them in `_meshes`. `_disposeMaze`
  must traverse groups to release cloned child geometry and materials, which
  aren't in the tracked sets.

### 7.7 Torches and pooled lights (second wall prop)

The torch (`torch_wall_01.glb`) confirmed that §7.1–7.2 generalise. It had
the same export faults as the frame, plus a scale fault:

- **Scale from a target tile fraction, not `scale = 1`.** The model is about
  0.925 units tall, and walls are about 53 units tall (`TILE_SIZE = 24`). Use
  `scale = tile * targetHeightFrac / authoredHeight`, with `authoredHeight`
  read from the raw extents. Never rescale the source GLB.
- **Seat the back from measured numbers.** The bracket back was at raw
  z = +0.09, not at the origin, and the torch leaned out along raw −Z. After
  the traverse reset, use a pivot with `rotation.y = π` (raw −Z → +Z; this
  also maps raw X → −X, so det stays +1) and `position.z = authoredBackZ`.
  When the lean axis is simple, a single yaw is enough and no basis matrix is
  needed.
- **Compute the light position once.** Store the raw flame centre in config,
  map it through the same pivot transform (`(−x, y, −z + backZ)`), then call
  `group.updateMatrixWorld(true)` and `group.localToWorld(v)`. Cache
  `flameWorld` for each torch. Don't wait for the GLB, because the placeholder
  and the model share the frame.
- **Use a fixed light pool, never one light per prop.** Every
  `PointLight` adds per-fragment cost to every lit material, and changing the
  light count forces shader recompiles. Create `maxLights` (4) lights once and
  reassign them every `lightReassignMs` (200 ms) to the props nearest the
  camera, sorted by `distanceToSquared`. Leave spares at intensity 0 rather
  than removing them. Set `castShadow = false`. Gate the whole feature behind
  a single flag (`TORCH.lights`).
- **Flicker (if added) must honour `reducedMotion`** (Req 7.4). Hold the
  intensity steady, or change it only slowly.
- **Tune density with `placeEvery` and `minSpacing`.** Torches use
  `placeEvery 3` and `minSpacing 5`, which gives 34 torches on the current
  maze. Compute the count with the pure helper in Node before judging it in
  the browser.

## 8. Testing (mandatory PBT — see steering/testing.md)

Property-based tests (Vitest + `fast-check`) are required for all new
**framework-agnostic** logic. Candidates that MUST get Core Properties + tests:

- Grid movement: a move only lands on an enterable neighbor or stays put.
- Tunnel wrap: wrapping preserves row and facing, lands in-bounds on the
  opposite edge.
- Input buffering: at most one buffered input survives a traversal.
- Line-of-sight: no visibility through any wall tile on the segment; symmetric.
- Scoring/lives reuse: point values and life cap (max 10, start 6) match 2D.
- Image cover-crop (`imageCrop.test.js`): the crop stays inside the image, has
  exactly the target aspect (so nothing is stretched), spans one full side, and
  is centred at focus 0.5.
- Wall-prop placement (`wallDecor.test.js`): every face borders an open tile
  with a correct outward normal and yaw, there is at most one pick per wall
  tile, spacing and exclusions are respected, and `seededRandom` is
  deterministic for a given seed.

When renderer work needs non-trivial maths (crop rectangles, placement
selection, facing tables), move it into a pure module under
`src/systems/fp3d/` and property-test it there. Keep the Three.js file for
wiring only.

Keep Three.js-touching code (renderer/controller wiring, scene flow, DOM) as
example-based/integration checks — not forced into PBT — but still verified.
Traceability: each Core Property in `design.md` → one `fast-check` test named
with `Validates: Requirements x.y`.

## 9. Definition of done for an FP3D task

1. Behavior matches the cited `requirements.md` acceptance criteria.
2. New pure logic has passing `fast-check` properties (`npm run test -- --run`).
3. `npm run build` succeeds (do NOT run `npm run dev` in the agent shell).
4. Fallbacks (WebGL/asset/audio/storage) exercised or reasoned about.
5. No Three.js import leaked into framework-agnostic modules.
