---
name: fps3d-assets
description: >
  Asset-generation pipeline for the Math Man first-person 3D browser mode.
  Use when generating or integrating 3D models, textures/images, or audio for
  the game via the Blender MCP (models -> GLB for Three.js, plus CC0 Poly Haven /
  Poly Pizza) and the Draw Things MCP (local Stable Diffusion textures/images on
  macOS). Covers export settings, texture sizing, licensing/attribution rules,
  where files must land, and the audio-replacement note.
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

## 3D models — Blender MCP

- **Export to GLB** (`export_scene`); Three.js loads `.glb` via `GLTFLoader`
  out of the box. Prefer GLB over FBX for the web (smaller, single-file,
  embedded textures).
- **Keep it low-poly.** This is a browser maze game. Target a few hundred to a
  few thousand triangles per entity; reuse materials; bake where possible.
- **Free asset sources built into Blender MCP (no key, no cost):**
  - **Poly Haven** — CC0 HDRIs, textures, models. No attribution required.
  - **Poly Pizza** — low-poly models; ~69% are **CC-BY (attribution REQUIRED)**.
    Filter with `licence="CC0"` to avoid attribution, or record the
    `polypizza_attribution` credit line in `ASSETS.md` when using CC-BY.
- **Do NOT use** Blender MCP's paid AI generators (Hyper3D Rodin, Hunyuan3D) —
  they need paid cloud keys. Use CC0 sources or hand/AI-assisted modeling only.
- After import, verify scale (normalize to game units), origin, and that the
  GLB opens in a Three.js `GLTFLoader` smoke test before committing.

## Textures / images — Draw Things MCP (local, macOS)

- Runs 100% locally on Apple Silicon via the Draw Things app + Stable Diffusion.
  No cloud, no key. Enable the Draw Things API server (port 7860) first.
- **Power-of-two sizes** for GPU textures (256, 512, 1024). Default 512 is fine
  for walls/floors; go 1024 only for hero/close-up surfaces.
- Use `.webp` or compressed `.png` to keep the web bundle small.
- Generated images land in `DRAWTHINGS_OUTPUT_DIR`; move the keepers into
  `public/assets/images/**` and log them in `ASSETS.md`.
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

1. File is web-ready (GLB for models; PoT-sized compressed image for textures).
2. It lives under `public/assets/**` and is logged with license in `ASSETS.md`.
3. License is CC0 or properly attributed; no unknown-license assets.
4. A quick Three.js load smoke test passes for models.
5. No change to shared game logic or the pinned dependency set.
