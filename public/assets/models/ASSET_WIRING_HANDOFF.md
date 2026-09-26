# FP3D Asset Wiring Handoff

Instruction for the fps3d-architect / main developing agent to wire the newly
generated FP3D textures and fruit models into the Three.js rendering layer
(`src/render/FP3DRenderer.js`), with graceful fallback to the existing
procedural placeholders if any asset fails to load. This is asset
integration only — no new dependencies, no changes to shared game logic
(Maze helpers, ScoreSystem, QuizSystem, Storage).

## Assets available (already generated, logged, and committed under `public/assets/**`)

Textures (`public/assets/images/textures/`):
- `wall_stone_01.png` — wall surface, 512×512
- `floor_stone_01.png` — floor surface, 512×512
- `ceiling_panel_01.png` — ceiling surface, 512×512
- `ghost_red_01.png`, `ghost_pink_01.png`, `ghost_orange_01.png` — flat ghost face icons, 512×512, plain white background
- `ghost_cyan_01.png` — same style, but background is a dark stripe pattern, NOT plain white. **Needs a crop/chroma-key/alpha pass before use as a sprite texture** — do not treat its background as transparent without handling this first.
- `cherry_skin_01.png`, `banana_peel_01.png`, `orange_rind_01.png` — abstract color-field object textures, 256×256, already applied as the base-color map baked into the corresponding GLBs below (only needed again if re-texturing).

Models (`public/assets/models/`):
- `ghost_red.glb` — existing, solid-color materials (already wired for ghosts per `GHOST_MODEL_URL`)
- `cherry.glb` (~122 KB), `banana.glb` (~124 KB), `orange.glb` (~128 KB) — low-poly fruit props, UV-unwrapped, each with its matching texture already embedded as the base-color map. No further texture work needed on these — just load and place.

All assets are logged with source/license in `public/assets/images/ASSETS.md` and `public/assets/models/ASSETS.md` (project-original / locally generated via Draw Things, no third-party license, no attribution required).

## Required changes in `src/render/FP3DRenderer.js`

### 1. Wall / floor / ceiling textures

Add URL constants next to the existing `GHOST_MODEL_URL`:

```js
const WALL_TEXTURE_URL = '/assets/images/textures/wall_stone_01.png';
const FLOOR_TEXTURE_URL = '/assets/images/textures/floor_stone_01.png';
const CEILING_TEXTURE_URL = '/assets/images/textures/ceiling_panel_01.png';
```

Load with `THREE.TextureLoader`, set `texture.wrapS = texture.wrapT = THREE.RepeatWrapping` and a sensible `repeat` (tune per tile size / wall segment size), then assign as the `map` on the existing wall/floor/ceiling `MeshStandardMaterial` (or whatever material type is currently used for those flat-color surfaces). Keep the current flat colors as the fallback (`onError` callback on the loader, or a timeout per Req 8.2 — 10s), so if the texture fails to load the surfaces keep their current solid color and play is not blocked.

### 2. Ghost face textures

Add:

```js
const GHOST_FACE_TEXTURE_URLS = {
  red: '/assets/images/textures/ghost_red_01.png',
  pink: '/assets/images/textures/ghost_pink_01.png',
  cyan: '/assets/images/textures/ghost_cyan_01.png',
  orange: '/assets/images/textures/ghost_orange_01.png',
};
```

Apply as a decal/billboard face texture on the existing ghost geometry (or as an additional plane facing the camera on the ghost model), matching whichever approach fits the current `ghost_red.glb` dome+skirt setup. Before shipping the cyan variant, crop or alpha-key its background so the dark stripe pattern doesn't render — either preprocess the PNG (outside this task, flag back to asset-forge if needed) or handle it in-shader/material (e.g., treat near-black as transparent) if that's simpler given the current pipeline. If you can't clean it up here, it's fine to reuse the red/pink/orange textures now and file a follow-up for cyan.

### 3. Fruit models

Add:

```js
const FRUIT_MODEL_URLS = {
  cherry: '/assets/models/cherry.glb',
  banana: '/assets/models/banana.glb',
  orange: '/assets/models/orange.glb',
};
```

Replace the current procedural glowing-sphere fruit marker (see `setFruit()` and the `MARKER.fruit` constant, roughly lines 83-90 and 639-670) with a `GLTFLoader` load of one of the fruit GLBs (pick one, e.g. cherry, or rotate between them per spawn — implementer's call), following the same loading pattern already used for `GHOST_MODEL_URL`. Preserve all existing behavior: fruit still floats/bobs at the spawn tile, still shows the glow/halo effect if desired (can be layered on top of the model), and `setFruit(col, row, present)` keeps its current signature and removal logic.

**Fallback requirement (Req 8.2):** if the GLTFLoader fails or exceeds a 10-second timeout, fall back to the current procedural glowing-sphere fruit marker so a missing/broken asset never blocks play. Wrap the load in a try/catch or use the loader's `onError` callback.

## Constraints (do not violate)

- No new npm dependencies — Three.js and `GLTFLoader` (`three/examples/jsm/loaders/GLTFLoader.js`) are already imported and pinned; this is pure asset wiring.
- Do not modify framework-agnostic modules (`mazeLogic.js`, `ScoreSystem.js`, `QuizSystem.js`, `Storage.js`, etc.) — this task is scoped to the Three.js rendering layer only.
- Every new texture/model load must degrade gracefully per the existing tech steering rule: missing/failed asset → drawn/procedural fallback, never a blocked or broken scene.
- Keep the 2D Render_Mode's build and behavior unchanged (Req 9.3).

## Verification before calling this done

1. `npm run build` succeeds with no errors.
2. Manually load FP3D mode in the browser and confirm: walls/floor/ceiling show the new textures; ghosts still render (face texture applied, cyan acceptable as a known follow-up); fruit renders as a 3D model instead of a glowing sphere.
3. Temporarily rename or 404 one texture path to confirm the fallback (solid color / procedural sphere) still renders without a console-breaking error or blocked scene.
4. Run `npm run test -- --run` — no framework-agnostic logic should be touched, so this should be a no-op/pass-through, but confirm nothing broke.
