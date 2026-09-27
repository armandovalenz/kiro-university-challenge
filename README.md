# Math Man

Math Man is an educational, browser-based maze arcade game inspired by Pac-Man. Guide **Math Man** through a maze collecting pellets while avoiding a colorful quartet of **Einstein ghosts**. The twist: when a ghost catches you, instead of an instant loss you're given a grade-appropriate **math or science** question — answer correctly to survive. Fruits grant an extra life and a short math or science micro-lesson.

Built with **Phaser 3** and **Vite**, it runs entirely in the browser with no backend and no login — all records (high score, difficulty preference, mute state, quiz stats) are saved in `localStorage`.

## Features

- **Classic maze gameplay** — grid-locked movement, wall collisions, pellets, and level progression.
- **Educational core** — Einstein ghosts trigger quizzes matched to a selected grade (5th, 6th, or 7th).
- **120-question bank** — bundled math and science questions (40 per grade, even math/science split, easy/medium/hard) with per-question explanations; loaded from JSON with a built-in fallback.
- **Fruits & micro-lessons** — collecting a fruit grants an extra life and shows a short math/science fun fact.
- **Lives system** — start with 6 lives, capped at a maximum of 10.
- **Colorful Einstein ghosts** — red, pink, cyan, and orange, each with classic Pac-Man-style AI personalities.
- **Grade selection** — 5th, 6th, or 7th grade difficulty, remembered between sessions.
- **Splash screen & branding** — Math Man logo intro, start menu, pause, and game-over screens.
- **Arcade audio** — background music and sound effects for every game event, with a persistent mute toggle.
- **Local high scores** — a single global high score persisted in `localStorage`, with an in-memory fallback.
- **Accessible modals** — quiz and lesson dialogs are DOM overlays that are keyboard-navigable and high-contrast.
- **First-person 3D mode (in progress)** — an optional Three.js WebGL layer that lets you walk the *same* maze in first person, reusing all shared game logic, with a graceful fallback to the 2D view when WebGL is unavailable.

## Tech Stack

| Concern | Choice | Mode |
|---------|--------|------|
| Rendering + game loop | Phaser 3 (`Phaser.AUTO` — WebGL with Canvas fallback) | 2D |
| First-person 3D layer | Three.js (WebGL) — optional FP3D mode, in progress | 3D |
| Bundler / dev server | Vite | Shared |
| State flow | Phaser Scene Manager | 2D |
| Physics / overlap | Phaser Arcade Physics | 2D |
| Maze | Phaser Tilemap | 2D |
| Audio | Phaser Sound Manager (Web Audio API) | Shared |
| Accessible modals | DOM overlays (HTML/CSS) | Shared |
| Persistence | `localStorage` (+ in-memory fallback) | Shared |
| Tests | Vitest + `fast-check` (property-based tests are mandatory) | Shared |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm

### Installation

```bash
npm install
```

### Development

Start the Vite dev server with hot-reload:

```bash
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`) in your browser.

### Production Build

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve the production build locally
```

The build produces plain static files that deploy to any static host — no server required.

### Tests

Framework-agnostic logic is covered by Vitest with **`fast-check`** property-based tests, which are a required part of the definition of done (see [`.kiro/steering/testing.md`](.kiro/steering/testing.md)).

```bash
npm run test            # watch mode
npm run test -- --run   # single non-watch run
```

### Linting & security checks

Source under `src/` is linted with a flat-config ESLint setup (`eslint.config.js`). This is also what the `lint-after-edit` agent hook runs automatically after edits and saves:

```bash
npm run lint
```

The lint config also surfaces **code-level security issues**:

- [`eslint-plugin-security`](https://github.com/eslint-community/eslint-plugin-security) — flags risky patterns (unsafe regex, `eval`-like calls, non-literal `fs`/`require`, timing attacks). The high-false-positive `detect-object-injection` rule is disabled because it fires on ordinary array/grid indexing.
- [`eslint-plugin-no-unsanitized`](https://github.com/mozilla/eslint-plugin-no-unsanitized) — flags XSS sinks (`innerHTML`, `insertAdjacentHTML`, `document.write`, …) with non-literal input, aimed at the DOM overlay modals.

Dependency (CVE) vulnerabilities are checked separately with `npm audit`. Run both at once:

```bash
npm run audit       # dependency CVEs (fails on high/critical)
npm run security    # lint + audit together
```

## Controls

| Action | Keys |
|--------|------|
| Move | Arrow keys or `W` `A` `S` `D` |
| Pause / resume | `P` or `Esc` |
| Toggle mute | `M` |
| Answer quiz | Number keys `1`–`4` / arrows, then `Enter` |
| Dismiss lesson | `Enter` / `Esc` |

## How to Play

1. Move Math Man through the maze to eat all the pellets and clear the level.
2. Avoid the Einstein ghosts. If one catches you, answer the math or science question:
   - **Correct** → keep your life and resume playing.
   - **Incorrect** → lose a life (the correct answer and a short explanation are shown).
3. Collect fruits for an extra life and a quick math/science lesson.
4. The game ends when your lives reach 0. Beat your high score!

## Project Structure

```
index.html                 # Vite entry; hosts the #game container + DOM overlay root
package.json               # phaser (pinned), vite, vitest + fast-check (mandatory PBT), eslint
vite.config.js
eslint.config.js           # flat ESLint config (npm run lint)
public/
  assets/
    images/                # logo, sprite sheets, UI kit (+ ASSETS.md)
    audio/                 # music + sound effects (+ NOTICE.md)
    questions/             # math_man_question_bank_120.json
src/
  main.js                  # Phaser.Game config; registers the scene list
  config.js                # Constants: tile size, speeds, LIVES_START=6, LIVES_MAX=10, colors, asset keys
  scenes/                  # Boot, Splash, Menu, Game, UI, Quiz, Lesson, Pause, GameOver
  entities/                # MathMan, Ghost, Fruit (+ framework-agnostic ghostAI helpers)
  maze/                    # mazeData, mazeLogic (pure helpers), Maze (tilemap)
  systems/                 # QuizSystem, QuestionBank, LessonBank, ScoreSystem, Storage, AudioBus
  ui/                      # QuizModal, LessonModal (DOM overlays)
.kiro/
  specs/
    math-man/              # requirements.md, design.md, tasks.md (base 2D game)
    first-person-3d-mode/  # requirements.md, design.md, tasks.md (FP3D first-person mode)
  steering/                # product.md, tech.md, structure.md, testing.md (project guidance)
  agents/                  # fps3d-architect, fps3d-asset-forge (FP3D specialist sub-agents)
  hooks/                   # lint-after-edit (auto-lint after agent edits + file saves)
  skills/
    game-engine/           # thin pointer → powers/game-engine (content moved there)
    fps3d-webgl/           # Three.js first-person playbook for FP3D mode
    fps3d-assets/          # asset-generation pipeline (Blender MCP + Draw Things)
powers/
  game-engine/             # game-engine Kiro Power (full SKILL.md + assets + references)
```

`QuestionBank`, `LessonBank`, `ScoreSystem`, `Storage`, the pure helpers in `mazeLogic`/`Maze`, and the `ghostAI` helpers are framework-agnostic (no Phaser or Three.js imports) so they stay unit-testable.

## Browser Support

Runs in current versions of Chrome, Firefox, Safari, and Edge. If `localStorage` is unavailable, the game falls back to in-memory records for the session. If audio is blocked by autoplay policy, it starts after the first user interaction.

## Documentation

Detailed design and requirements live under [`.kiro/specs/`](.kiro/specs/):

- **Base 2D game** — [`math-man/`](.kiro/specs/math-man/): [`requirements.md`](.kiro/specs/math-man/requirements.md) (user stories + acceptance criteria), [`design.md`](.kiro/specs/math-man/design.md) (architecture, diagrams, module design), and [`tasks.md`](.kiro/specs/math-man/tasks.md) (implementation plan).
- **First-person 3D mode** — [`first-person-3d-mode/`](.kiro/specs/first-person-3d-mode/): the FP3D first-person rendering + input layer over the same maze and shared logic.

Project conventions are captured as Kiro steering in [`.kiro/steering/`](.kiro/steering/): `product.md`, `tech.md`, `structure.md`, and `testing.md` (mandatory property-based testing policy).

### Kiro agents, skills & hooks

The workspace ships Kiro automation to support the FP3D mode:

- **Agents** ([`.kiro/agents/`](.kiro/agents/)) — `fps3d-architect` (designs/builds FP3D mode on the Phaser 3 + Vite + Three.js stack, reusing shared logic) and `fps3d-asset-forge` (sandboxed producer of web-ready GLB models via Blender MCP and textures via the local Draw Things HTTP API; writes only under `public/assets/**`).
- **Skills** ([`.kiro/skills/`](.kiro/skills/)) — `fps3d-webgl` (Three.js first-person patterns), `fps3d-assets` (asset pipeline), and `game-engine` (pointer into the `powers/game-engine` Power).
- **Hooks** ([`.kiro/hooks/`](.kiro/hooks/)) — `lint-after-edit` ships two enabled agent hooks that keep the source clean automatically: a `PostToolUse` hook (matcher `fs_write|str_replace|fs_append`) that runs `npm run lint` after the agent edits a file, and a `PostFileSave` hook (matcher `\.js$`) that runs it when you save a JS file. Both fix findings at the source rather than disabling rules.

### Question bank

Quiz content is bundled at [`public/assets/questions/math_man_question_bank_120.json`](public/assets/questions/math_man_question_bank_120.json) — 120 questions. Each record:

```json
{
  "id": "MM-G5-MATH-001",
  "grade": 5,
  "subject": "math",
  "topic": "whole-number-operations",
  "difficulty": "easy",
  "question": "A game awards 36 stars equally across 6 levels. How many stars are in each level?",
  "choices": ["5", "6", "7", "8"],
  "answer": "6",
  "explanation": "Divide 36 by 6. Each level receives 6 stars."
}
```

`answer` holds the correct choice **value** (not an index). To extend the bank, add records following this schema; `QuestionBank` validates each one and drops any whose `answer` is not among its `choices`.

## Credits & Attribution

### Audio — demo use only (non-commercial)

The sound effects and music are the original **Namco Pac-Man** arcade sounds, sourced from [The Spriters Resource](https://sounds.spriters-resource.com/arcade/pacman/asset/404131/).

- These audio files are **© Namco / Bandai Namco Entertainment** and remain the property of their respective owner.
- They are included here **strictly for demonstration, educational, and prototyping purposes only**.
- **Do NOT use these audio assets for any commercial purpose.** They are not covered by this project's MIT license.
- Before any public or commercial release, **replace them with original or appropriately licensed audio**. The `AudioBus` uses stable keys, so swapping files is a drop-in change (see [`design.md`](.kiro/specs/math-man/design.md)).

See [`public/assets/audio/NOTICE.md`](public/assets/audio/NOTICE.md) for the attribution that ships alongside the audio files.

### Images

The game's visual assets (logo, app icon, mascot sprite sheet, collectibles, UI kit, posters, and hero images in `public/assets/images/`) were **generated with ChatGPT (OpenAI image generation)**. Under OpenAI's Terms of Use, the creator owns and may use these outputs, including commercially. Note that purely AI-generated images may have limited copyright protection in some jurisdictions. Per-file details are in [`public/assets/images/ASSETS.md`](public/assets/images/ASSETS.md).

### Kiro-generated skills, agents & references

The Kiro automation in this workspace (steering, specs, agents, skills, hooks, and the `game-engine` Power) was authored with **Kiro** (AI-assisted). The knowledge baked into those artifacts is distilled from the public documentation and tools listed below. Each artifact also carries its own inline `Source:` attribution; this table is the consolidated view. Content from these sources was rephrased and summarized for compliance with their licensing.

| Kiro artifact | Purpose | Primary sources it draws on |
|---------------|---------|-----------------------------|
| `powers/game-engine` references — `basics.md`, `techniques.md`, `game-control-mechanisms.md`, `web-apis.md`, `3d-web-games.md` | General game-engine, controls, Web API, and 3D theory | [MDN Web Docs — Games](https://developer.mozilla.org/en-US/docs/Games) (CC-BY-SA 2.5) |
| `powers/game-engine` reference — `algorithms.md` | Raycasting, collision, physics, vector math | [deepnight.net](https://deepnight.net/tutorial/bresenham-magic-raycasting-line-of-sight-pathfinding/), [gamedev.net](https://www.gamedev.net/), [winter.dev](https://winter.dev/articles/physics-engine) |
| `powers/game-engine` reference — `game-engine-core-principles.md` | Engine architecture principles | [gamedev.net — Making a Game Engine: Core Design Principles](https://www.gamedev.net/articles/programming/general-and-gameplay-programming/making-a-game-engine-core-design-principles-r3210/) |
| `powers/game-engine` reference — `terminology.md` | Game-dev glossary | [Game Industry Career Guide — glossary](https://www.gameindustrycareerguide.com/video-game-development-terms-glossary/) |
| `powers/game-engine` reference — `game-publishing.md` | Distribution, promotion, monetization | [MDN Web Docs — Publishing games](https://developer.mozilla.org/en-US/docs/Games/Publishing_games) |
| `.kiro/skills/fps3d-webgl` | Three.js first-person patterns | [Three.js docs](https://threejs.org/docs/), [three.js `PointerLockControls`](https://threejs.org/docs/#examples/en/controls/PointerLockControls), [sbcode.net Three.js tutorials](https://sbcode.net/threejs/pointerlock-controls/), [MDN — 3D on the web](https://developer.mozilla.org/en-US/docs/Games/Techniques/3D_on_the_web) |
| `.kiro/skills/fps3d-assets` | 3D/texture asset pipeline | [Poly Haven](https://polyhaven.com/) (CC0), [Poly Pizza](https://poly.pizza/) (CC0/CC-BY), [Blender MCP](https://github.com/ahujasid/blender-mcp), [Draw Things](https://drawthings.ai/) (local Stable Diffusion), [glTF/GLB spec](https://www.khronos.org/gltf/) |
| `.kiro/skills/game-engine` | Pointer into the `game-engine` Power | See the `powers/game-engine` reference rows above |
| `.kiro/agents/fps3d-architect` | Builds FP3D mode | The `fps3d-webgl` + `game-engine` skills; trusts [threejs.org](https://threejs.org/), [MDN](https://developer.mozilla.org/), [sbcode.net](https://sbcode.net/), [vitejs.dev](https://vitejs.dev/), [phaser.io](https://phaser.io/) |
| `.kiro/agents/fps3d-asset-forge` | Produces FP3D assets | The `fps3d-assets` skill; [Blender MCP](https://github.com/ahujasid/blender-mcp), [Poly Haven](https://polyhaven.com/), [Poly Pizza](https://poly.pizza/), [Draw Things API](https://drawthings.ai/) |

The Kiro-authored artifacts (steering, specs, agents, skills, hooks, and the `game-engine` Power source) are covered by this project's **MIT license**. Third-party documentation and tools linked above remain under their own licenses (e.g., MDN text is [CC-BY-SA 2.5](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license)); the assets those tools produce are attributed per-file in the relevant `ASSETS.md`.

### Other

- Built with [Phaser 3](https://phaser.io/) and [Vite](https://vitejs.dev/); the optional first-person 3D mode uses [Three.js](https://threejs.org/).
- Inspired by Namco's Pac-Man. Pac-Man is a trademark of its respective owner; this project is an educational, non-commercial homage and is not affiliated with or endorsed by Namco / Bandai Namco.

## Kiro University Challenge Eligibility

This project was built as an entry for the Kiro University Challenge. The full eligibility mapping — disqualification criteria plus lesson-by-lesson evidence (Lessons 1–7 and the cloud-session bonus) — lives in [CHALLENGE.md](CHALLENGE.md).

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

> Note: the MIT license covers this project's own source code. It does not grant rights to third-party assets bundled for prototyping (e.g., the Pac-Man sound effects noted above), which remain the property of their respective owners.
