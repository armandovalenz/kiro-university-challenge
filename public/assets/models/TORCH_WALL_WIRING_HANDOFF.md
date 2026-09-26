# FP3D Wall Torch Wiring Handoff

Instruction for the fps3d-architect / main developing agent to add
wall-mounted torch decorations to corridor walls in FP3D_Mode. This handoff
covers the already-generated, committed asset (`torch_wall_01.glb`). This is
asset integration only — no new dependencies, no changes to shared game
logic (Maze helpers, ScoreSystem, QuizSystem, Storage).

## Asset available

`public/assets/models/torch_wall_01.glb` (~11 KB, glTF 2.0 binary, 1 mesh,
5 material slots, no embedded textures).

- **Geometry**: a wall-mount bracket (tapered box), a wooden shaft
  (cylinder), a wrapped/pitch-soaked head (short wide cylinder), and a
  two-tone flame (two stacked cones), joined into a single mesh, low-poly.
- **Materials**: 5 solid-color `Principled BSDF` slots, no textures —
  `Torch_Iron` (dark grey, metallic 0.85, for the bracket), `Torch_Wood`
  (brown, roughness 0.8, for the shaft), `Torch_Cloth` (dark brown, for the
  wrapped head), `Torch_FlameOuter` (orange, emissive strength 4.0),
  `Torch_FlameCore` (yellow, emissive strength 8.0, brighter inner flame).
  Because the flame materials are emissive, this model can double as a
  **light-emitting** decoration if the renderer wants to pair it with a
  `THREE.PointLight` at the flame position (optional — see below).
- **Dimensions** (Blender units == game world units, `TILE_SIZE = 24`):
  approx. **0.11 × 0.32 × 0.92** units (width × depth × height). This is
  much smaller than a full tile — it's meant to sit flush against a wall
  face partway up, not fill a tile.
- **Origin**: at the wall-mount point — the back face of the bracket, at
  local `(0, 0, 0)`. Placing the object's origin flush against a wall's
  inner face should mount it correctly with no manual depth offset needed,
  the same convention used by `portrait_frame.glb`.
- No embedded texture — texture generation was attempted (Draw Things,
  `sd3_large_turbo_3.5_q8p.ckpt`) but produced unusable vertical-stripe
  artifacts across repeated attempts; shipped with flat materials instead.
  See `public/assets/models/ASSETS.md` for the full provenance note.

## Where to wire this in

`src/render/FP3DRenderer.js`, following the same GLB-loading pattern already
used for `GHOST_MODEL_URL`, the fruit models, and `portrait_frame.glb` (see
`ASSET_WIRING_HANDOFF.md` and `PORTRAIT_FRAME_WIRING_HANDOFF.md` for that
pattern).

```js
const TORCH_WALL_MODEL_URL = '/assets/models/torch_wall_01.glb';
```

Load once with `GLTFLoader` and clone the loaded scene/group for each wall
placement (`object.clone()`, no skinning) rather than reloading the GLB per
instance.

### Suggested placement approach

1. Reuse the exact same wall-segment-to-world-position/orientation helper
   already used for wall texturing and for `portrait_frame.glb` placement —
   do not duplicate that math. Torches are typically placed more densely
   than frames (e.g., at regular intervals along corridors, or at
   intersections/dead-ends) since they're meant to light the space; a
   reasonable default is one torch per N wall segments along straight
   runs, alternating walls, tunable via a single constant.
2. Position the cloned torch's origin at the wall segment's inner-face
   point (flush against the wall), oriented so its local +Z points along
   the wall's outward normal (into the corridor).
3. Apply a vertical offset so the torch sits at a believable height on the
   wall (roughly eye-level or a bit above), not at floor or ceiling level —
   tune against the existing `FP3D_Renderer` eye-height/wall-height
   constants already in the file, the same way `portrait_frame.glb`
   placement tunes its own vertical offset.
4. Scale: dimensions are authored against `TILE_SIZE = 24`, so place at
   `scale = 1` if the renderer's wall geometry is also built at 1 world-unit
   = 1 Blender unit. Verify against the existing wall geometry scale and
   adjust a single scale constant if needed — do not rescale the source GLB.
5. **Optional light pairing**: if the renderer wants torches to visibly
   light the corridor (not required by any spec requirement, purely a
   visual enhancement), add a `THREE.PointLight` (warm orange, modest
   intensity/range) positioned at the flame's local offset within the torch
   group. Keep this optional and gated behind a single easy-to-remove
   constant/flag — do not let per-torch lights silently multiply into a
   performance problem if many torches are placed; consider a max-lights
   cap or baked-lighting-only fallback if torch count is high.

## Fallback requirement (Req 8.2)

If the GLTFLoader fails or exceeds a 10-second timeout, fall back to a
simple drawn placeholder (e.g., a thin box or cone with a plain
`MeshStandardMaterial`, no texture) at the same wall position so a
missing/broken asset never blocks play. Wrap the load in a try/catch or use
the loader's `onError` callback, matching the pattern already used for
ghosts, fruit, and the portrait frame.

## Constraints (do not violate)

- No new npm dependencies — `GLTFLoader` is already imported and pinned.
- Do not modify framework-agnostic modules (`mazeLogic.js`, `ScoreSystem.js`,
  `QuizSystem.js`, `Storage.js`, etc.) — this task is scoped to the Three.js
  rendering layer only. Torch placement is purely decorative and must not
  affect tile occupancy, collision, or the maze layout array.
- Keep the 2D Render_Mode's build and behavior unchanged (Req 9.3).
- If reduced-motion is enabled (Req 7.4), any flame flicker/animation added
  later must be suppressed or reduced — not relevant to this handoff since
  no animation is included yet, but keep in mind before adding any.

## Verification before calling this done

1. `npm run build` succeeds with no errors.
2. Load FP3D mode in the browser; confirm torches render on the chosen wall
   tile(s), flush against the wall, right-side-up, with the flame visible
   and readable against the corridor lighting.
3. Confirm walking near/through a torch's wall tile behaves exactly as
   before (no new collision, no change to path/wall tile classification).
4. Temporarily rename or 404 `torch_wall_01.glb` to confirm the fallback
   placeholder renders without a console-breaking error or blocked scene.
5. If a point light was added per the optional step above, confirm frame
   rate stays acceptable with the expected torch count for a full maze
   before keeping it enabled by default.
6. Run `npm run test -- --run` — no framework-agnostic logic should be
   touched, so this should be a no-op/pass-through, but confirm nothing
   broke.

---

## Correction addendum (as wired, measured from the GLB)

Added after integration. The original text above is kept as written. Several
claims about the file did not match `torch_wall_01.glb`. The numbers below
come from reading the GLB directly (JSON `nodes[]` plus the `POSITION`
accessor min/max), not from the Blender scene.

### What the file actually contains

| Handoff claim | Measured in the GLB |
| --- | --- |
| ~0.11 × 0.32 × 0.92, height along Z | About 0.925 tall along **raw Y** (−0.045 → 0.88). The flame is on top. |
| Origin at the bracket back, flush at (0, 0, 0) | The bracket back sits at **raw z = +0.09**, not at 0. |
| Local +Z points out of the wall | The torch leans out along **raw −Z**. The flame centre is at raw (0, 0.72, −0.17). |
| No node transform mentioned | The mesh node has an **arbitrary baked rotation**. It must be discarded. |
| `scale = 1` fits `TILE_SIZE = 24` | `scale = 1` is about **50× too small**. FP3D walls are roughly 53 units tall. |

### Orientation and scale as wired (`src/render/FP3DRenderer.js`)

- The baked transform is reset on every node of the clone, not just the
  wrapper: `model.traverse(o => { o.quaternion.identity(); o.position.set(0,0,0); o.scale.set(1,1,1); })`.
- An inner pivot gets `rotation.y = π`, which turns the raw −Z lean into +Z
  (into the corridor), and `position.z = TORCH.authoredBackZ` (0.09), which
  seats the bracket back at local z = 0.
- The outer group sits on the wall's inner face with the shared per-wall yaw
  (north π, south 0, east π/2, west −π/2).
- Scale is `tile * targetHeightFrac / authoredHeight`, so the torch is half a
  tile tall. The bracket is mounted at `tile * mountYFrac`.

`TORCH` config as shipped: `authoredHeight 0.925`, `authoredBackZ 0.09`,
`flameRaw {0, 0.72, −0.17}`, `targetHeightFrac 0.5`, `mountYFrac 0.8`,
`placeEvery 3`, `minSpacing 5`, `seed 0x7f4a7c15`.

### Placement

- Uses the shared, property-tested helper `src/systems/fp3d/wallDecor.js`
  (`wallFaces`, `seededRandom`, `pickSpacedFaces`), which is the same one the
  portraits use.
- Wall tiles that already carry a portrait are excluded.
- On the current maze this places 34 torches.

### Lights (the optional step, implemented with a cap)

- Uses a **fixed pool of 4 `PointLight`s**, created once and reassigned every
  200 ms to the torches nearest the camera. Unused lights stay at intensity 0.
- There are no per-torch lights. The light count never changes, so there are
  no shader recompiles and shader cost stays flat.
- Each torch's flame world position is computed once with
  `group.localToWorld` from `flameRaw`, after the 180° turn and back seat:
  `(−x, y, −z + backZ)`.
- Settings: colour `0xff9a3c`, intensity 14, distance 5 tiles, decay 1.
- Everything is gated by `TORCH.lights`. Set it to `false` to remove the
  lights entirely.
- There is no flicker. If flicker is added later, it must be suppressed when
  `reducedMotion` is on (Req 7.4).

### Fallback

A drawn shaft and cone placeholder shows until the GLB loads, and stays if the
load fails or times out (Req 8.2). Late loads are ignored if the maze has been
rebuilt.

### Requested export fixes (for the asset author)

1. Apply all transforms before export, so the node has no rotation, translation
   or scale.
2. Put the origin at the bracket back and point the torch out along +Z.
3. Author at game scale, about 12 units tall (half of `TILE_SIZE = 24`), or
   state the real extents.
4. In future handoffs, list the measured extents and axis directions from the
   exported file, not the Blender dimensions panel.

If the file is re-exported with these fixes, update `TORCH.authoredHeight`,
`authoredBackZ`, `flameRaw` and the pivot turn to match.
