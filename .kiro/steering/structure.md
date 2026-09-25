# Project Structure

```
index.html                 # Vite entry; #game container + DOM overlay root; favicon from 03_app_icon.png
package.json               # phaser (pinned), vite, vitest + fast-check (mandatory PBT)
vite.config.js
public/
  assets/
    images/                # AI-generated art (see images/ASSETS.md)
    audio/                 # Pac-Man WAV music + sfx (see audio/NOTICE.md)
    questions/
      math_man_question_bank_120.json   # 120 grade-tagged math/science questions
src/
  main.js                  # Phaser.Game config; registers the scene list
  config.js                # Constants: TILE_SIZE, speeds, LIVES_START=6, LIVES_MAX=10, colors, asset keys
  scenes/                  # BootScene, SplashScene, MenuScene, GameScene, UIScene, QuizScene, LessonScene, PauseScene, GameOverScene
  entities/                # MathMan, Ghost, Fruit  (Phaser sprites) + ghostAI helpers
  maze/                    # mazeData.js, mazeLogic.js, Maze.js   (tilemap + framework-agnostic helpers)
  systems/                 # QuizSystem, QuestionBank, LessonBank, ScoreSystem, Storage, AudioBus (+ *.test.js)
  ui/                      # QuizModal, LessonModal  (DOM overlay builders)
.kiro/
  specs/
    math-man/              # requirements.md, design.md, tasks.md (base 2D game)
    first-person-3d-mode/  # requirements.md, design.md, tasks.md (FP3D_Mode — Three.js first-person layer)
  steering/                # product.md, tech.md, structure.md, testing.md
  agents/                  # fps3d-architect.json, fps3d-asset-forge.json (FP3D specialist sub-agents)
  hooks/                   # lint-on-save-debounced.json (PostFileSave lint, disabled by default)
  skills/
    game-engine/           # thin pointer → powers/game-engine (content moved there)
    fps3d-webgl/           # Three.js first-person playbook for FP3D_Mode
    fps3d-assets/          # asset-generation pipeline (Blender MCP + Draw Things) for FP3D_Mode
powers/
  game-engine/             # game-engine Kiro Power (full SKILL.md + assets + references)
```

## Placement rules

- **New game logic** that doesn't touch Phaser → `src/systems/` (keep it framework-agnostic and testable).
- **New on-screen actors** → `src/entities/` (Phaser sprite classes).
- **New screens/states** → `src/scenes/` (register in `src/main.js`).
- **New accessible HTML UI** (forms/panels) → `src/ui/` as DOM builders used by an overlay scene.
- **Tunable numbers** (speeds, sizes, timings, lives, colors, asset keys) → `src/config.js`, not hardcoded.
- **Runtime assets** go under `public/assets/<images|audio|questions>/`; reference them via keys defined in config/BootScene.
- **First-person 3D mode (FP3D_Mode)** — the Three.js WebGL layer is a rendering + input concern, not new game logic. Keep the 3D layer isolated behind `FP3D_Renderer` / `FP3D_Controller` so it reuses the shared systems (Maze helpers, QuizSystem, ScoreSystem, Storage) and never forks scoring, lives, quiz-on-capture, or persistence. No Three.js or Phaser imports may leak into the framework-agnostic modules. `getLevelLayout()` (via `mazeData.js` / `mazeLogic.js`) is the single source of maze truth. See `.kiro/specs/first-person-3d-mode/` and the `fps3d-webgl` skill.
- **3D / texture assets** for FP3D_Mode go under `public/assets/<models|images|audio>/`; log every file in the matching `ASSETS.md` with source, license, and attribution. See the `fps3d-assets` skill.

## Asset schema references

- Question record: `{ id, grade(5|6|7), subject('math'|'science'), topic, difficulty('easy'|'medium'|'hard'), question, choices[], answer(value), explanation }`. Answers match by value, not index.
- Storage shape (`mathman.v1`): `{ highScore, lastDifficulty, audioMuted, quizStats:{ answered, correct } }`.

## Asset attribution (do not lose this)

- **Audio** (`public/assets/audio/`) are Namco Pac-Man sounds — DEMO/NON-COMMERCIAL only, NOT covered by the project MIT license. See `audio/NOTICE.md`.
- **Images** (`public/assets/images/`) are AI-generated (ChatGPT/OpenAI); usable by the creator. See `images/ASSETS.md`.
- Project source code is MIT licensed (`LICENSE`).

## Agents, skills & specs

- **Specs** (`.kiro/specs/`): `math-man/` is the base 2D game; `first-person-3d-mode/` specifies FP3D_Mode (a first-person 3D rendering + input layer over the same maze and shared logic, using Three.js). Treat the relevant spec as authoritative when it disagrees with code.
- **Agents** (`.kiro/agents/`):
  - `fps3d-architect` — designs and builds FP3D_Mode on the Phaser 3 + Vite + Three.js stack; reuses all framework-agnostic logic and keeps the 3D layer isolated. Writes under `src/**`, `tests/**`, the FP3D spec, the `fps3d-webgl` skill, and build config.
  - `fps3d-asset-forge` — sandboxed asset producer for FP3D_Mode. Generates web-ready GLB models (Blender MCP, safe mode) and textures/images (local Draw Things HTTP API on :7860 via curl). Writes ONLY under `public/assets/**`; never touches game source, specs, or steering.
- **Skills** (`.kiro/skills/`): `fps3d-webgl` (Three.js first-person patterns) and `fps3d-assets` (asset pipeline) back the FP3D agents; `game-engine` is a thin pointer into the `powers/game-engine` Kiro Power.
- **Hooks** (`.kiro/hooks/`): `lint-on-save-debounced` runs `npm run lint` after a debounced `src/**` save (disabled by default).

## Naming

- Modules and classes: PascalCase files for classes (`GameScene.js`, `MathMan.js`); lowercase for data/helpers (`mazeData.js`, `mazeLogic.js`, `config.js`).
- Keep one class/scene per file where practical.
