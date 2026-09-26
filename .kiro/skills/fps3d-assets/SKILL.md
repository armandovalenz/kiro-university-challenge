---
name: fps3d-assets
description: >
  Asset-generation pipeline for the Math Man first-person 3D browser mode.
  Use when integrating 3D models, textures/images, or audio for the game.
  SEARCH-FIRST: prefer finding and reusing existing CC0 models via the Blender
  MCP (Poly Haven primary, Poly Pizza secondary) exported to GLB for Three.js,
  and only model/generate from scratch as a fallback. Textures/images come from
  the Draw Things HTTP API (local Stable Diffusion on macOS). Covers search and
  export settings (apply transforms, verify the exported GLB's axes/extents),
  texture sizing, photos for picture frames, licensing/attribution rules, where
  files must land, and the audio-replacement note.
---

# FP3D Asset-Generation Pipeline

Goal: produce web-ready, correctly-licensed assets for Math Man's first-person
3D mode WITHOUT breaking the pinned stack or the existing gameplay contract.
FP3D reuses the existing maze/entities; generated assets are an **enhancement**
(nicer ghost/fruit/collectible meshes, wall/floor textures, skybox), never a
replacement for maze-driven geometry or shared logic.

## Where generated files must land

- 3D models: `public/assets/models/**` (create if missing) as **`.glb`**.
- Textures/images: `public/assets/images/**` as `.png` / `.webp`.
- Audio: `public/assets/audio/**` (keep existing `AudioBus` keys).
- Every generated file gets an entry in the matching manifest:
  `public/assets/images/ASSETS.md` or a new `public/assets/models/ASSETS.md`,
  recording source tool, prompt/asset id, license, and attribution.

## 3D models — Blender MCP (SEARCH-FIRST: reuse existing CC0 models)

**Default policy: search for and reuse an existing, correctly-licensed model
before modeling or generating anything new.** Building new geometry is the
fallback, used only when no suitable existing asset can be found.

### Step 1 — search Poly Haven (primary source)

- **Poly Haven is the primary, MCP-searchable source** — CC0 HDRIs, textures,
  and models, **no attribution required**. Its search/download is wired into
  Blender MCP, so the agent can query it directly (no browser, no key, no cost).
- **Workflow:**
  1. Search Poly Haven via the Blender MCP asset-search tool using keywords
     that describe the game entity (e.g. `ghost`, `spirit`, `cherry`, `fruit`,
     `banana`, `orange`, `lamp`, `crate`).
  2. Review the candidates for fit: recognizable silhouette, low-poly-ish
     triangle budget, and a clean single mesh that reads well in first person.
  3. Download/import the chosen asset into Blender via the MCP download tool.
     (This is a network+file operation — see the safe-mode note below.)
  4. In Blender: normalize scale to game units, center the origin, strip unused
     data, and reuse/simplify materials.
  5. **Export to GLB** (`export_scene`) into `public/assets/models/`; Three.js
     loads `.glb` via `GLTFLoader` out of the box (prefer GLB over FBX — smaller,
     single-file, embedded textures).
  6. Run a Three.js `GLTFLoader` smoke test and confirm scale/origin.
  7. Log the file in `public/assets/models/ASSETS.md` with source
     `Poly Haven (CC0)`, the Poly Haven asset id/slug, license `CC0`, and
     attribution `None required`.

### Step 2 — Poly Pizza (secondary, watch the license)

- If Poly Haven has no fit, try **Poly Pizza** (also MCP-searchable): low-poly
  models, but ~69% are **CC-BY (attribution REQUIRED)**. Filter with
  `licence="CC0"` to avoid attribution, or record the exact
  `polypizza_attribution` credit line in `ASSETS.md` when using CC-BY.

### Step 3 — model from scratch (fallback only)

- Only if no suitable existing CC0/CC-BY asset is found, hand-build low-poly
  geometry in Blender (primitives + simple ops) and export GLB, as the current
  `ghost_red`/fruit assets were made. Note this clearly in `ASSETS.md`.

### Always

- **Keep it low-poly.** This is a browser maze game. Target a few hundred to a
  few thousand triangles per entity; reuse materials; bake where possible.
- **Do NOT use** Blender MCP's paid AI generators (Hyper3D Rodin, Hunyuan3D) —
  they need paid cloud keys. Use CC0/CC-BY search results or hand modeling only.
- **Safe mode blocks downloads.** Blender MCP runs with
  `BLENDER_MCP_SAFE_MODE=1`, which blocks the network+file operations needed to
  download a Poly Haven / Poly Pizza asset and export a GLB. Search may return
  metadata, but fetching/exporting requires the user to authorize a session with
  safe mode off — ask first, never bypass it silently.
- After import, verify scale (normalize to game units), origin, and that the
  GLB opens in a Three.js `GLTFLoader` smoke test before committing.

### Export orientation — apply transforms, then verify the file itself

The portrait frame shipped with an arbitrary, slightly tilted rotation baked
onto its mesh node, and it took many renderer iterations to hang it correctly.
Avoid that for every new model:

- **Apply rotation and scale before export** (Blender: Object → Apply → All
  Transforms). The exported mesh node should have **no `rotation`**, no
  non-unit `scale`, and translation 0 unless the offset is intentional.
- **Author in Three.js axes:** +Y up, and the model's front facing **+Z**. For
  wall props, put the **flat back at z = 0** and the origin at the back-centre,
  so the renderer can hang it with zero offset.
- **Verify the exported GLB, not the Blender view.** Read the JSON chunk (for
  node transforms) and the `POSITION` accessor `min`/`max` (for extents) with a
  short Node script. See the minimal GLB reader in the `fps3d-webgl` skill,
  §7.1. Confirm:
  - there is no baked node rotation,
  - the extents match the stated dimensions,
  - the flat back really is at the expected coordinate.
- **Write facts, not intentions, in the handoff.** Report the measured extents
  per axis, where the back and front are, the node transforms, and the inner
  opening size and depth for anything that holds an insert. Prose like
  "origin at back-centre, facing +Z" was wrong for the frame, and only the
  measured numbers made it placeable.

### Scale and origin in game units (lessons from the wall torch)

`torch_wall_01.glb` repeated the frame's baked-rotation fault and added two
more. Check all three on every export:

- **Author at game scale.** One Blender unit is one world unit, `TILE_SIZE` is
  24, and FP3D walls are about 53 units tall. The torch was about 0.925 units
  tall, so the handoff's "scale = 1" would have made it about 50× too small.
  Size props to their in-game height: a torch is about 12 units (half a tile),
  and the frame is about 18.72. If you can't, state the real extents so the
  renderer can derive a scale.
- **Put the origin exactly at the mounting back.** The torch's bracket back was
  at z = +0.09, not at 0, and the torch leaned out along −Z instead of +Z.
  Either mistake breaks "flush with no offset".
- **Record points the renderer needs** in the handoff, such as the flame centre
  for a light, measured in the exported file's raw coordinates.
- When a handoff turns out to be wrong, append a **correction addendum** with
  the measured values and the as-wired config. Don't rewrite the original.
  See the addenda in `PORTRAIT_FRAME_WIRING_HANDOFF.md` and
  `TORCH_WALL_WIRING_HANDOFF.md`.

## Photos and picture inserts

- Photos shown inside frames live in `public/assets/images/` as `.jpg` / `.png`
  and are listed in `PORTRAIT.pictures` in `FP3DRenderer.js`. Any aspect ratio
  works. The renderer cover-crops each photo to the frame opening (2:3) at load
  time, so don't pre-stretch or pad them. Use at least ~512 px on the short
  side for a sharp result. Very small images (e.g. 250 px) look soft.
- **Always give the file a real extension** (`.jpg`, `.png`, `.webp`). A file
  without one may be served with the wrong MIME type.
- Log every photo in `public/assets/images/ASSETS.md` with its size, subject,
  source URL and license. Photos of real people or TV characters can carry
  copyright and likeness rights. Treat unverified ones as demo-only, like the
  Pac-Man audio, until the source is recorded.

## Textures / images — Draw Things HTTP API (local, macOS)

- Runs 100% locally on Apple Silicon via the Draw Things app + Stable Diffusion.
  No cloud, no key. This is NOT an MCP server — it is the app's HTTP API on port
  7860, driven with `curl`. Enable Settings -> API Server (HTTP, localhost:7860)
  in the Draw Things app first.
- **Flow:** health-check `GET http://127.0.0.1:7860/`, read the loaded checkpoint
  via `GET /sdapi/v1/options` (never guess/switch models over the API), then
  `POST /sdapi/v1/txt2img` (or `/img2img`) with JSON: `prompt`, `negative_prompt`,
  `width`/`height` (power-of-two), `steps`, `guidance_scale` (NOT cfg_scale),
  `seed` (-1 = random). The response is base64 image data — decode and save it.
- **Power-of-two sizes** for GPU textures (256, 512, 1024). Default 512 is fine
  for walls/floors; go 1024 only for hero/close-up surfaces.
- Use `.webp` or compressed `.png` to keep the web bundle small.
- Save generated images under `public/assets/images/_generated`; move the keepers
  into `public/assets/images/**` and log them in `ASSETS.md`.
- Purely AI-generated images may have limited copyright protection in some
  jurisdictions — note this (as the project already does for its ChatGPT art).

## Audio (note — no local MCP wired)

There is no vetted free/local audio-generation MCP in this setup. The bundled
Pac-Man sounds are **demo/non-commercial only** and must be replaced before any
public release (see `public/assets/audio/NOTICE.md`). Replace with CC0/original
audio (e.g. jsfxr for arcade SFX, Freesound/OpenGameArt CC0). `AudioBus` uses
stable keys, so swapping files is a drop-in change — keep the same keys.

## Licensing checklist (do not skip)

1. Prefer **CC0** (no attribution) wherever possible.
2. If **CC-BY**, record the required credit in the asset `ASSETS.md`.
3. Never commit an asset whose license you can't name.
4. Keep the project's existing attribution rules intact (`structure.md`):
   audio = Namco, non-commercial; images = AI-generated, creator-owned.

## Safety (Blender MCP)

- Blender MCP can run arbitrary Python in Blender. The agent runs it with
  `BLENDER_MCP_SAFE_MODE=1` (blocks file/network/process/persistent code) and
  `DISABLE_TELEMETRY=true`. Keep the Blender socket on `localhost` only.
- MCP tools are NOT auto-approved — every generation/import step prompts.
  Save Blender work before running any code-executing tool.

## Definition of done for an asset task

1. For models: an existing-asset search (Poly Haven first, then Poly Pizza) was
   attempted and either a fitting CC0/CC-BY asset was reused, or the search is
   noted as exhausted before falling back to modeling from scratch.
2. File is web-ready (GLB for models; PoT-sized compressed image for textures).
3. It lives under `public/assets/**` and is logged with source + license in
   `ASSETS.md` (Poly Haven asset id/slug recorded for reused models).
4. License is CC0 or properly attributed; no unknown-license assets.
5. A quick Three.js load smoke test passes for models.
6. For models, the exported GLB was checked with a script: no baked node
   rotation, correct extents at game scale (not ~50× too small), and front /
   back / origin where the handoff says. The measured numbers are written into
   the handoff.
7. No change to shared game logic or the pinned dependency set.
