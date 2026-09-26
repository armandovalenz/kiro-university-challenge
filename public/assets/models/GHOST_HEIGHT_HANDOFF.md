# FP3D Ghost Height Adjustment Handoff

Instruction for the fps3d-architect / main developing agent: make the ghost
models 40% taller in the FP3D scene. This is a rendering-layer tweak only —
no new assets, no changes to shared game logic.

## Where

`src/render/FP3DRenderer.js`, in the ghost GLB `finish` callback (the code
that scales the loaded `ghost_red.glb` model to fit the tile — currently
around line 1027-1035, right after the `GHOST_TEXTURES` cyan-skip comment
block).

## Why a simple scale multiply is wrong here

The current code applies a **uniform** scale:

```js
const targetH = this.grid.tileSize * (GHOST_SIZE.radiusFrac * 2.4);
const scale = size.y > 0 ? targetH / size.y : 1;
model.scale.setScalar(scale);
```

`model.scale.setScalar(scale)` scales X, Y, and Z by the same factor. If you
just multiply `targetH` by 1.4, the ghost becomes 40% bigger in *every*
direction (wider and deeper too), not just taller. To make it read as
taller/thinner rather than uniformly bigger, scale the Y axis by the boosted
factor while keeping X/Z at the original (un-boosted) footprint.

## Change

Add a constant near the top of the file, next to the existing `GHOST_SIZE`
declaration:

```js
/** Extra vertical stretch applied to the ghost GLB model (Y-axis only). */
const GHOST_HEIGHT_BOOST = 1.4; // +40% taller
```

Then update the scaling block inside the `finish` callback:

```js
const finish = (tex) => {
  applyTexture(tex);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const targetH = this.grid.tileSize * (GHOST_SIZE.radiusFrac * 2.4) * GHOST_HEIGHT_BOOST;
  const scale = size.y > 0 ? targetH / size.y : 1;
  // Non-uniform scale: keep the horizontal footprint at the un-boosted size
  // so the ghost reads taller/thinner rather than uniformly bigger.
  const scaleXZ = scale / GHOST_HEIGHT_BOOST;
  model.scale.set(scaleXZ, scale, scaleXZ);
  model.position.y = -targetH / 2; // center vertically on the group anchor
  group.add(model);
  group.userData.model = model;
  const ph = group.userData.placeholder;
  if (ph) ph.visible = false;
};
```

Only two lines actually change inside `finish`: the `targetH` calculation
gains the `* GHOST_HEIGHT_BOOST` factor, and `model.scale.setScalar(scale)`
is replaced by the `scaleXZ` calculation + `model.scale.set(scaleXZ, scale, scaleXZ)`.
Everything else in the callback (texture application, positioning, placeholder
hide) stays the same.

## Notes

- This only affects the GLB-model ghost rendering path. The procedural
  placeholder mesh (used as a fallback when the GLB fails to load, per
  Req 8.2) is untouched by this change — if the placeholder should also be
  40% taller for consistency, that's a separate, smaller tweak to wherever
  the placeholder's dome/skirt geometry is built (search for
  `GHOST_SIZE.radiusFrac` near line 899 and the placeholder mesh
  construction).
- `GHOST_HEIGHT_BOOST` is a single tunable constant — easy to adjust or
  revert later without touching the scaling math again.

## Verification

1. `npm run build` succeeds with no errors.
2. Load FP3D mode in the browser; ghosts should appear visibly taller and
   thinner than before, without their footprint/width changing.
3. Confirm the ghost's collision/position logic (tile occupancy, quiz-trigger
   on same-tile) is unaffected — this change only touches the visual `Mesh`
   scale/position within its `group`, not the tile coordinates the group
   itself is placed at.
4. Run `npm run test -- --run` — no framework-agnostic logic is touched, so
   this should pass unchanged.
