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

| Concern | Choice |
|---------|--------|
| Rendering + game loop | Phaser 3 (`Phaser.AUTO` — WebGL with Canvas fallback) |
| Bundler / dev server | Vite |
| State flow | Phaser Scene Manager |
| Physics / overlap | Phaser Arcade Physics |
| Maze | Phaser Tilemap |
| Audio | Phaser Sound Manager (Web Audio API) |
| Accessible modals | DOM overlays (HTML/CSS) |
| Persistence | `localStorage` (+ in-memory fallback) |
| First-person 3D layer | Three.js (WebGL) — optional FP3D mode, in progress |
| Tests | Vitest + `fast-check` (property-based tests are mandatory) |

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
package.json               # phaser (pinned), vite, vitest + fast-check (mandatory PBT)
vite.config.js
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
  hooks/                   # lint-on-save-debounced (disabled by default)
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
- **Hooks** ([`.kiro/hooks/`](.kiro/hooks/)) — `lint-on-save-debounced` runs `npm run lint` after a debounced save of a `src/**` file (disabled by default).

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

### Other

- Built with [Phaser 3](https://phaser.io/) and [Vite](https://vitejs.dev/); the optional first-person 3D mode uses [Three.js](https://threejs.org/).
- Inspired by Namco's Pac-Man. Pac-Man is a trademark of its respective owner; this project is an educational, non-commercial homage and is not affiliated with or endorsed by Namco / Bandai Namco.

## Kiro University Challenge Eligibility

This project was built as an entry for the Kiro University Challenge. The full eligibility mapping — disqualification criteria plus lesson-by-lesson evidence (Lessons 1–7 and the cloud-session bonus) — lives in [CHALLENGE.md](CHALLENGE.md).

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

> Note: the MIT license covers this project's own source code. It does not grant rights to third-party assets bundled for prototyping (e.g., the Pac-Man sound effects noted above), which remain the property of their respective owners.
