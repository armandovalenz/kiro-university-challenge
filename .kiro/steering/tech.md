# Tech Stack & Conventions

## Stack

- **Phaser 3** (`Phaser.AUTO` — WebGL with Canvas fallback) for rendering, scenes, physics, audio.
- **Vite** for the dev server and static production build.
- **Vanilla ES modules** (no framework beyond Phaser). Pin `phaser` and `vite` to exact versions in `package.json`.
- **DOM overlays** (HTML/CSS) for the accessible quiz and lesson modals, layered above the canvas.
- **localStorage** for persistence (namespaced key `mathman.v1`), with an in-memory fallback.
- **Vitest** for tests of framework-agnostic logic, with **`fast-check`** for property-based tests. Property-based tests are mandatory — see `.kiro/steering/testing.md`.
- **Three.js** is the WebGL 3D layer for the optional first-person mode (FP3D_Mode), pinned to an exact version in `package.json`. It is a rendering concern only — do not let Three.js (or Phaser) imports leak into framework-agnostic modules, and do not add other runtime frameworks (React, Babylon, A-Frame) without an explicit, approved reason. See `.kiro/specs/first-person-3d-mode/` and the `fps3d-webgl` skill.

## Common commands

- Install: `npm install`
- Dev server (do NOT run in the agent shell; it is long-running): `npm run dev`
- Production build: `npm run build`  → outputs static files to `dist/`
- Preview build: `npm run preview`
- Tests (property-based tests are mandatory, see `.kiro/steering/testing.md`): `npm run test` (use `--run` for a single non-watch run)

> Long-running processes (`npm run dev`, watchers) must be started by the user in their own terminal, not via blocking agent commands.

## Conventions

- **Keep logic framework-agnostic.** `QuestionBank`, `LessonBank`, `ScoreSystem`, `Storage`, the pure helpers in `mazeLogic.js`/`Maze`, and the `ghostAI` helpers must NOT import Phaser or Three.js, so they stay unit-testable and portable. Phaser-specific code lives in scenes and entities; Three.js-specific code lives behind the FP3D renderer/controller layer.
- **Grid-locked movement** with turn buffering for Math Man and ghosts; use Arcade Physics only for cheap overlap detection.
- **Scenes drive state flow** (Boot → Splash → Menu → Game + UI; overlays Quiz/Lesson/Pause/GameOver launched over a paused GameScene). Freeze `GameScene` while an overlay is open.
- **AudioBus** wraps the Phaser Sound Manager; reference sounds by stable keys (see design event→sound map). Handle the autoplay-unlock flow; persist mute in `Storage`.
- **Graceful fallbacks are required:** missing image → drawn shape/text; missing audio → silent no-op; blocked/absent `localStorage` → in-memory; bad question bank → built-in fallback set; no WebGL / lost context / invalid maze data → fall back from FP3D_Mode to the 2D view with a visible notice and unmodified maze data. Honor `prefers-reduced-motion` in FP3D_Mode.
- **Verify after changes:** run the mandatory property tests (`npm run test -- --run`) for any framework-agnostic logic you touch, and `npm run build`, before declaring a task done. See `.kiro/steering/testing.md`.
- Prefer exact/pinned dependency versions; avoid adding new dependencies without reason.

## Browser targets

Current Chrome, Firefox, Safari, Edge. Do not use features unavailable in these evergreen browsers.
