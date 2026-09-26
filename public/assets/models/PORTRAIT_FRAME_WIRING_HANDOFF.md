it# FP3D Portrait Frame Wiring Handoff

Instruction for the fps3d-architect / main developing agent to add hangable
picture-frame decorations to walls in FP3D_Mode. This handoff covers **only
the frame** (`portrait_frame.glb`, already generated, textured, and
committed). The matching picture/canvas insert that sits in the frame's
inner opening is a separate asset, not yet modeled — treat frame placement
as usable/final now, and expect a follow-up handoff once the picture insert
exists. This is asset integration only — no new dependencies, no changes to
shared game logic (Maze helpers, ScoreSystem, QuizSystem, Storage).

## Asset available

`public/assets/models/portrait_frame.glb` (~438 KB, glTF 2.0 binary,
verified structurally valid — magic/header/JSON chunk checked, 1 mesh /
1 material / 1 embedded image).

- **Geometry**: stepped rectangular gilded moulding ring (outer/raised/inner
  border bands at increasing depth) with 4 corner pyramid ornament bumps
  seated on the raised band, flat-shaded, 40 verts / 37 faces.
- **Material**: `PortraitFrame_OldGold`, a `Principled BSDF` with
  `old_gold_frame_01.png` (512×512, embedded) as Base Color,
  `Metallic = 0.85`, `Roughness = 0.4`.
- **Dimensions** (Blender units == game world units, `TILE_SIZE = 24`):
  - Outer footprint: **14.88 × 18.72** units (width × height).
  - Total border/moulding width (from outer edge to the inner opening):
    **3.6** units per side (outer band 1.2 + raised band 1.68 + inner band 0.72).
  - Inner opening (where a picture would sit): **≈7.68 × 11.52** units.
  - Moulding depth: **2.4** units; corner ornament bumps project further
    forward, giving a total bounding depth of **≈5.64** units.
- **Origin**: at the back-center of the frame, at local `(0, 0, 0)`, facing
  +Z. This means placing the object's origin flush against a wall's inner
  face and orienting +Z outward (into the corridor) should hang it correctly
  with no manual offset needed on the depth axis.
- Logged with full provenance in `public/assets/models/ASSETS.md` and the
  matching texture entry in `public/assets/images/ASSETS.md`.

## Where to wire this in

`src/render/FP3DRenderer.js`, following the same GLB-loading pattern already
used for `GHOST_MODEL_URL` and the fruit models (see
`ASSET_WIRING_HANDOFF.md` for that pattern). Suggested approach:

```js
const PORTRAIT_FRAME_MODEL_URL = '/assets/models/portrait_frame.glb';
```

Load once with `GLTFLoader` and clone the loaded scene/group for each wall
placement (`SkeletonUtils.clone` or `object.clone()` since there's no
skinning) rather than reloading the GLB per instance.

### Suggested placement approach

1. Decide which wall tiles should carry a frame. A reasonable rule: pick
   wall segments adjacent to open path tiles, spaced apart (e.g., every Nth
   eligible wall run, or a fixed curated list of tile coordinates) so frames
   don't cluster. This is a design/level-dressing decision left to the
   implementer — the maze layout itself (`getLevelLayout()`) is unchanged
   and must stay the single source of truth for wall/path tiles per the
   project's steering rules; only *where on top of* an existing wall segment
   to hang a decorative prop is being decided here.
2. For a chosen wall tile at grid `(col, row)` facing direction `dir`
   (north/south/east/west, matching the existing wall-segment orientation
   logic in the renderer), compute the wall segment's inner-face world
   position and outward normal the same way the renderer already does for
   wall texturing/geometry (reuse whatever helper already converts tile
   coordinates + orientation to world position/rotation for wall meshes —
   do not duplicate that math).
3. Position the cloned frame's origin at that inner-face point, offset
   slightly *away* from the wall along the wall's plane if desired (the
   frame is flat against the wall, so generally no depth offset is needed
   beyond flush placement), and orient it so its local +Z points along the
   wall's outward normal (into the corridor, toward the player).
4. A vertical offset to center the frame at a pleasant eye-level height on
   the wall face (rather than centered on the full wall height) is likely
   desirable — tune against the existing `FP3D_Renderer` eye-height/wall-
   height constants already in the file.
5. Scale: the frame's world-unit dimensions (14.88×18.72) are already
   authored against `TILE_SIZE = 24`, so it should be placed at `scale = 1`
   if the renderer's wall segments are also built at 1 world-unit = 1
   Blender unit. Verify against however the existing wall geometry is scaled
   in this file and adjust a single scale constant if needed — do not
   rescale the source GLB.

## Fallback requirement (Req 8.2)

If the GLTFLoader fails or exceeds a 10-second timeout, fall back to a
simple drawn placeholder (e.g., a flat rectangular plane or box mesh with a
plain gold/tan `MeshStandardMaterial`, no texture) at the same wall position
so a missing/broken asset never blocks play. Wrap the load in a try/catch or
use the loader's `onError` callback, matching the pattern already used for
ghosts and fruit.

## Constraints (do not violate)

- No new npm dependencies — `GLTFLoader` is already imported and pinned.
- Do not modify framework-agnostic modules (`mazeLogic.js`, `ScoreSystem.js`,
  `QuizSystem.js`, `Storage.js`, etc.) — this task is scoped to the Three.js
  rendering layer only. Frame placement is purely decorative and must not
  affect tile occupancy, collision, or the maze layout array.
- Keep the 2D Render_Mode's build and behavior unchanged (Req 9.3).

## Follow-up (not part of this handoff)

A separate "picture" object — a flat plane/canvas sized to the frame's inner
opening (≈7.68 × 11.52 units) — is still to be modeled and textured, kept as
its own GLB so frame and picture remain independently composable per the
original design intent. Once that exists, a follow-up handoff will describe
nesting it inside the frame's opening at the same wall placement.

## Verification before calling this done

1. `npm run build` succeeds with no errors.
2. Load FP3D mode in the browser; confirm the frame renders on the chosen
   wall tile(s), flush against the wall, right-side-up, with the gold
   texture visible and correctly oriented (no obvious stretching/seams).
3. Confirm walking near/through the frame's wall tile behaves exactly as
   before (no new collision, no change to path/wall tile classification).
4. Temporarily rename or 404 `portrait_frame.glb` to confirm the fallback
   placeholder renders without a console-breaking error or blocked scene.
5. Run `npm run test -- --run` — no framework-agnostic logic should be
   touched, so this should be a no-op/pass-through, but confirm nothing
   broke.

---

## Correction addendum (as wired, measured from the GLB)

Added after integration. The original text above is kept as written. The
"origin at back-centre, facing +Z, hang at scale 1" guidance didn't match
`portrait_frame.glb`. Following it produced frames that tumbled, turned
sideways, or sank into the brick across many attempts. The numbers below come
from reading the GLB directly.

### What the file actually contains

| Handoff claim | Measured in the GLB |
| --- | --- |
| Facing +Z, height along Y | Raw **X ±7.44** is the width (14.88), raw **Z ±9.36** is the height (18.72), and raw **Y [0, 5.64]** is the depth. |
| Back at the origin | The flat back is at **raw y = 0**. The corner ornaments peak at y = 5.64. |
| No node transform mentioned | The mesh node has a **baked quaternion** `[-0.478, -0.546, -0.435, 0.534]`, about 10° off-axis. It must be discarded. |
| Opening ≈ 7.68 × 11.52 | Confirmed. The inner lip sits at **raw y = 1.44**. |

### Orientation as wired (`src/render/FP3DRenderer.js`, `_orientPortrait`)

- The baked transform is reset on **every** node of the clone. The quaternion
  lives on the child mesh node, not on the `scene.clone()` wrapper.
- One `makeBasis` rotation maps the raw axes to the group frame (det = +1):
  raw X → −X (along the wall), raw Y → +Z (out of the wall), raw Z → +Y (up).
  The flat back lands at local z = 0 with no depth offset.
- The group sits on the wall's inner face with yaw north π, south 0,
  east π/2, west −π/2.
- Do not reuse `FACING_TO_YAW`. That is the camera convention and has the
  opposite sign.
- All earlier roll, pitch and face correction knobs were removed.
- Scale is derived from `authoredHeight 18.72` and `targetHeightFrac 0.62`
  (not 1), with the frame centred at `centerYFrac 0.95`.

### Placement

Uses the shared `src/systems/fp3d/wallDecor.js` helpers, which are seeded and
place at most one frame per wall tile (`placeEvery 7`, `seed 0x9e3779b1`).
Portrait wall tiles are recorded so that torches avoid them.

### Picture insert (the "follow-up" above, now implemented without a GLB)

- The picture is a `PlaneGeometry`, not a separate GLB. It is added to the
  same group, about 12% larger than the opening (`pictureOverlap 1.12`) and
  set just behind the lip at z = 1.2.
- Photos are chosen at random with the seeded RNG from
  `einstein_photo1.jpg`, `copernicus_photo3.jpg` and `beakman_photo2.jpg`.
- Each photo is cover-cropped with the pure, property-tested
  `coverCropRect` (`src/systems/fp3d/imageCrop.js`). The crop is drawn onto a
  512 × 768 canvas with high-quality smoothing, so nothing is stretched, and
  wrapped in a `CanvasTexture` with mipmaps and anisotropy.
  `pictureFocusY 0.3` keeps faces in frame.
- The photo texture is also the emissive map at 0.25, so photos stay readable
  in dim corridors. A dark placeholder shows until each photo loads.
- Photo provenance is logged in `public/assets/images/ASSETS.md`. That entry
  still has an open TODO.

### Related fix

Frames looked about 2× too wide because the renderer was sized from Phaser's
`scale.displaySize`. `FP3DScene._syncRendererSize` now sizes from the host
container's `clientWidth` / `clientHeight`.

### Requested export fixes (for the asset author)

1. Apply all transforms before export, so there is no node rotation.
2. Put the flat back at z = 0, the front along +Z and the height along +Y.
3. In future handoffs, state the measured extents and axis directions from
   the exported file.
