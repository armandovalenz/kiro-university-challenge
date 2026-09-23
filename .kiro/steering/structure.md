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
  entities/                # MathMan, Ghost, Fruit  (Phaser sprites)
  maze/                    # mazeData.js, Maze.js   (tilemap + helpers)
  systems/                 # QuizSystem, QuestionBank, LessonBank, ScoreSystem, Storage, AudioBus
  ui/                      # QuizModal, LessonModal  (DOM overlay builders)
.kiro/
  specs/math-man/          # requirements.md, design.md, tasks.md
  steering/                # product.md, tech.md, structure.md
  skills/game-engine/      # imported game-engine skill (Phaser/maze references)
```

## Placement rules

- **New game logic** that doesn't touch Phaser → `src/systems/` (keep it framework-agnostic and testable).
- **New on-screen actors** → `src/entities/` (Phaser sprite classes).
- **New screens/states** → `src/scenes/` (register in `src/main.js`).
- **New accessible HTML UI** (forms/panels) → `src/ui/` as DOM builders used by an overlay scene.
- **Tunable numbers** (speeds, sizes, timings, lives, colors, asset keys) → `src/config.js`, not hardcoded.
- **Runtime assets** go under `public/assets/<images|audio|questions>/`; reference them via keys defined in config/BootScene.

## Asset schema references

- Question record: `{ id, grade(5|6|7), subject('math'|'science'), topic, difficulty('easy'|'medium'|'hard'), question, choices[], answer(value), explanation }`. Answers match by value, not index.
- Storage shape (`mathman.v1`): `{ highScore, lastDifficulty, audioMuted, quizStats:{ answered, correct } }`.

## Asset attribution (do not lose this)

- **Audio** (`public/assets/audio/`) are Namco Pac-Man sounds — DEMO/NON-COMMERCIAL only, NOT covered by the project MIT license. See `audio/NOTICE.md`.
- **Images** (`public/assets/images/`) are AI-generated (ChatGPT/OpenAI); usable by the creator. See `images/ASSETS.md`.
- Project source code is MIT licensed (`LICENSE`).

## Naming

- Modules and classes: PascalCase files for classes (`GameScene.js`, `MathMan.js`); lowercase for data/helpers (`mazeData.js`, `config.js`).
- Keep one class/scene per file where practical.
