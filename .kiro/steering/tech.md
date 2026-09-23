# Tech Stack & Conventions

## Stack

- **Phaser 3** (`Phaser.AUTO` — WebGL with Canvas fallback) for rendering, scenes, physics, audio.
- **Vite** for the dev server and static production build.
- **Vanilla ES modules** (no framework beyond Phaser). Pin `phaser` and `vite` to exact versions in `package.json`.
- **DOM overlays** (HTML/CSS) for the accessible quiz and lesson modals, layered above the canvas.
- **localStorage** for persistence (namespaced key `mathman.v1`), with an in-memory fallback.
- **Vitest** for tests of framework-agnostic logic, with **`fast-check`** for property-based tests. Property-based tests are mandatory — see `.kiro/steering/testing.md`.

## Common commands

- Install: `npm install`
- Dev server (do NOT run in the agent shell; it is long-running): `npm run dev`
- Production build: `npm run build`  → outputs static files to `dist/`
- Preview build: `npm run preview`
- Tests (property-based tests are mandatory, see `.kiro/steering/testing.md`): `npm run test` (use `--run` for a single non-watch run)

> Long-running processes (`npm run dev`, watchers) must be started by the user in their own terminal, not via blocking agent commands.

## Conventions

- **Keep logic framework-agnostic.** `QuestionBank`, `LessonBank`, `ScoreSystem`, `Storage`, and the pure helpers in `Maze` must NOT import Phaser, so they stay unit-testable and portable. Phaser-specific code lives in scenes and entities.
- **Grid-locked movement** with turn buffering for Math Man and ghosts; use Arcade Physics only for cheap overlap detection.
- **Scenes drive state flow** (Boot → Splash → Menu → Game + UI; overlays Quiz/Lesson/Pause/GameOver launched over a paused GameScene). Freeze `GameScene` while an overlay is open.
- **AudioBus** wraps the Phaser Sound Manager; reference sounds by stable keys (see design event→sound map). Handle the autoplay-unlock flow; persist mute in `Storage`.
- **Graceful fallbacks are required:** missing image → drawn shape/text; missing audio → silent no-op; blocked/absent `localStorage` → in-memory; bad question bank → built-in fallback set.
- **Verify after changes:** run `npm run build` (and tests if present) before declaring a task done.
- Prefer exact/pinned dependency versions; avoid adding new dependencies without reason.

## Browser targets

Current Chrome, Firefox, Safari, Edge. Do not use features unavailable in these evergreen browsers.
