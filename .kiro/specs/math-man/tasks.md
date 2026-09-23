# Implementation Plan

## Overview

This plan implements Math Man as a Phaser 3 + Vite browser game, ordered so the game is runnable early and grows incrementally. Each task is coding-only and builds on prior tasks. Foundational modules (project scaffold, Storage, ScoreSystem) come first, followed by scenes and gameplay, then the educational systems (quiz/lesson), and finally audio, mandatory property-based tests, and verification. Task 18 covers the required property-based test coverage for the pure logic modules; additional example-based unit tests are discretionary.

The testable acceptance criteria are captured as universal **Correctness Properties** (`Property 1`–`Property 24`) in `design.md` and validated with **property-based testing** (Vitest + `fast-check`) in task 18. Tasks that own a pure-logic module list the properties they must satisfy via a `_Properties:_` line, preserving the requirement → property → task → test trace. Property tests are **mandatory** per `.kiro/steering/testing.md`: task 18 must be executed (not skipped or deferred), and a pure-logic task is not done until its associated property tests exist and pass.

## Tasks

- [ ] 1. Scaffold the Phaser + Vite project
  - Create `package.json` with pinned `phaser` and `vite`, plus `vitest` + `fast-check` as `devDependencies` for the mandatory property-based tests in task 18.
  - Add `vite.config.js` and an `index.html` that hosts a `#game` container and a DOM overlay root for modals, and references `public/assets/images/03_app_icon.png` as the favicon.
  - Create `src/main.js` with the `Phaser.Game` config (`Phaser.AUTO`, Arcade physics, FIT scale mode) and an empty scene list placeholder.
  - Create `src/config.js` with core constants: `TILE_SIZE`, entity speeds, `LIVES_START = 6`, `LIVES_MAX = 10`, ghost colors, timings, storage key `mathman.v1`, and asset key/path definitions for the images in `public/assets/images/` (see `ASSETS.md`).
  - Verify `npm install` and `npm run dev` serve a blank Phaser canvas.
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 11.5_

- [ ] 2. Implement the Storage module with in-memory fallback
  - Create `src/systems/Storage.js` wrapping `localStorage` under the `mathman.v1` key.
  - Implement `load()`, `save(patch)`, and `updateHighScore(score)` with try/catch and an in-memory fallback object when storage is unavailable or JSON is malformed.
  - Model the shape: `highScore`, `lastDifficulty`, `audioMuted`, `quizStats { answered, correct }`.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.5, 10.6, 12.4_
  - _Properties: Property 15, Property 16, Property 17, Property 18, Property 19_

- [ ] 3. Implement the ScoreSystem module
  - Create `src/systems/ScoreSystem.js` with `score`, `lives` (init 6), `level`.
  - Implement `addScore`, `loseLife`, `gainLife` (clamped to `LIVES_MAX = 10`), `isGameOver()` (lives === 0), and `nextLevel()`.
  - Emit change events (or expose getters) for the HUD to read.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - _Properties: Property 1, Property 2, Property 3_

- [ ] 4. Build the BootScene and asset preload pipeline
  - Create `src/scenes/BootScene.js` that preloads the image assets from `public/assets/images/` — `02_logo.png`, `09_hero_einstein_enemies.png`, `06_ui_kit.png` as images, and `04_mascot_sprite_sheet.png` + `05_collectibles_and_math_icons.png` as spritesheets/atlases (define frame size or a JSON atlas) — plus the audio keys from the mapping (WAV files in `public/assets/audio/`).
  - Register a Phaser loader error handler that marks missing assets so later code can fall back to drawn shapes/text.
  - Load and validate the question bank (`public/assets/questions/math_man_question_bank_120.json`) via `QuestionBank.load()`.
  - Initialize `Storage` and `AudioBus`, then transition to `SplashScene`.
  - _Requirements: 8.2, 11.1, 12.3, 12.7, 13.1, 13.2, 13.5, 4.2, 4.9_

- [ ] 5. Build the SplashScene with the Math Man logo
  - Create `src/scenes/SplashScene.js` that centers the `02_logo.png` logo with a short intro tween.
  - Auto-advance to `MenuScene` after ~2s, or immediately on key/click.
  - Render a styled text title as a fallback if the logo asset failed to load.
  - _Requirements: 7.1, 7.2, 11.1, 11.3, 13.5_

- [ ] 6. Build the MenuScene with grade selection and high score
  - Create `src/scenes/MenuScene.js` showing the logo (`02_logo.png`) over the `09_hero_einstein_enemies.png` hero background, a Play button, a 5/6/7 grade selector, and the current high score from `Storage`. Style controls with the UI kit (`06_ui_kit.png`) where practical.
  - Default the grade selection to the persisted `lastDifficulty` (or 5th grade), and persist changes.
  - Starting a game passes the chosen grade to `GameScene`.
  - _Requirements: 7.3, 7.4, 10.1, 10.2, 10.5, 11.2, 13.3_

- [ ] 7. Implement the Maze model and tilemap
  - Create `src/maze/mazeData.js` (tile-code rows) and `src/maze/Maze.js` that builds a Phaser Tilemap with a wall collision layer.
  - Implement helpers: `isWall`, `tileToWorld`, `worldToTile`, `wrapIfTunnel`, `pelletCount`, `eatPelletAt`, and `reset(level)`.
  - Spawn pellets and fruit points as sprite groups from the tile codes, using icons from `05_collectibles_and_math_icons.png`.
  - _Requirements: 1.1, 1.3, 1.5, 13.2_
  - _Properties: Property 5, Property 6, Property 7, Property 8_

- [ ] 8. Implement Math Man with grid-locked movement and input
  - Create `src/entities/MathMan.js` as a Phaser sprite using frames from `04_mascot_sprite_sheet.png`, with `direction`/`nextDirection`/`speed`.
  - Define the sprite-sheet frame config/animations; fall back to a drawn wedge if the sheet is missing.
  - Implement turn-buffered grid movement: change direction only when tile-centered and the target tile is not a wall; block on walls; wrap tunnels.
  - Wire arrow keys / WASD in `GameScene` to set the queued direction; play the movement/mouth animation facing the direction.
  - _Requirements: 1.2, 1.3, 8.4, 13.1, 13.5_

- [ ] 9. Wire pellet collection, scoring, and the HUD (UIScene)
  - Create `src/scenes/GameScene.js` that builds the maze and Math Man and runs the gameplay `update()`.
  - Use Arcade overlap to eat pellets, remove them, and call `ScoreSystem.addScore`.
  - Create `src/scenes/UIScene.js` run in parallel to display score, lives (life icons from `05_collectibles_and_math_icons.png`), and level, styled with the UI kit (`06_ui_kit.png`) and updating on `ScoreSystem` events.
  - _Requirements: 1.1, 1.4, 1.6, 13.2, 13.3_

- [ ] 10. Implement Einstein ghosts and AI
  - Create `src/entities/Ghost.js` as a Phaser sprite with a color and a Pac-Man-style `personality` (red chase, pink ahead, cyan vector, orange chase/scatter).
  - Spawn four ghosts in distinct colors from the ghost house; compute non-reversing direction toward each ghost's target tile at tile centers.
  - Render the Einstein motif (hair/mustache) per color, consistent with the concept art (`08_poster_einstein_enemies.png` / `09_hero_einstein_enemies.png`), with a tinted drawn-ghost fallback; scale speed/cadence by selected grade.
  - _Requirements: 3.1, 3.2, 3.5, 3.6, 10.4, 13.4, 13.5_
  - _Properties: Property 23, Property 24 (optional)_

- [ ] 11. Implement ghost/Math Man collision and reset
  - Add Arcade overlap between ghosts and Math Man that emits a `mathman-caught` event.
  - On catch, pause `GameScene` and prepare to launch the quiz; after a resolved quiz, reset Math Man and ghosts to spawn positions when lives remain.
  - _Requirements: 3.3, 3.4_

- [ ] 12. Implement the QuestionBank (load the bundled JSON bank)
  - Create `src/systems/QuestionBank.js` with `load()` that fetches and validates `public/assets/questions/math_man_question_bank_120.json` (fields: `id`, `grade`, `subject`, `topic`, `difficulty`, `question`, `choices`, `answer`, `explanation`).
  - Validate each record (required fields present; `answer` is one of `choices`), drop invalid ones, and index by `grade` (sub-grouped by `subject`/`difficulty`). Provide a small built-in fallback set if the file fails to load/parse.
  - Implement `next(grade, { subject, difficulty } = {}, recentIds = [])` that returns a grade-matched question, avoids repeating the immediately previous `id`, and avoids `recentIds` where possible.
  - _Requirements: 4.2, 4.3, 4.8, 4.9_
  - _Properties: Property 9, Property 10, Property 12, Property 13_

- [ ] 13. Build the QuizScene, QuizModal, and QuizSystem
  - Create `src/ui/QuizModal.js` (accessible DOM form: prompt, multiple-choice options, numeric entry where needed, keyboard 1-4/arrows + Enter), styled with UI-kit cues from `06_ui_kit.png`.
  - Create `src/scenes/QuizScene.js` that pauses `GameScene`, opens the modal with a `QuestionBank.next(grade)` question (drawing from both math and science by default), and blocks movement while open.
  - Create `src/systems/QuizSystem.js` to check the answer by comparing the selected choice string to the record's `answer` value: correct -> resume with no life lost; wrong -> highlight the correct answer + show its `explanation`, `loseLife()`, then resume or go to game over; update `quizStats` in `Storage`.
  - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 6.6_
  - _Properties: Property 11_

- [ ] 14. Implement fruit, LessonBank, and the LessonScene
  - Create `src/entities/Fruit.js` that spawns at an `F` tile on a timer or pellet threshold, drawn from a fruit icon in `05_collectibles_and_math_icons.png`.
  - Create `src/systems/LessonBank.js` with tagged math/science micro-lessons that vary between showings.
  - On fruit overlap, call `ScoreSystem.gainLife()` (capped at 10) and launch `src/scenes/LessonScene.js` (DOM panel via `src/ui/LessonModal.js`) that pauses the game and resumes on dismiss.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 2.4, 2.5_
  - _Properties: Property 14, Property 2_

- [ ] 15. Implement level progression and level-clear handling
  - Detect when `pelletCount()` reaches 0, play the level-clear transition, call `ScoreSystem.nextLevel()`, and rebuild the maze via `Maze.reset(level)`.
  - Preserve score/lives and selected difficulty across levels.
  - _Requirements: 1.5, 7.7_

- [ ] 16. Build the PauseScene and GameOverScene
  - Create `src/scenes/PauseScene.js` toggled by `P`/`Esc` that pauses `GameScene` and halts movement.
  - Create `src/scenes/GameOverScene.js` shown when `isGameOver()` is true, displaying final score and high score, updating the stored high score, and offering restart or return-to-menu (preserving difficulty on restart).
  - _Requirements: 7.5, 7.6, 7.7, 6.2, 6.4_
  - _Properties: Property 4, Property 15_

- [ ] 17. Implement the AudioBus and wire all event sounds
  - Create `src/systems/AudioBus.js` over the Phaser Sound Manager: `sfx(key)`, `music(key, {loop})` with crossfade, `stopMusic`, `setMuted`, `isMuted`.
  - Handle the autoplay-unlock flow (start music after Phaser `unlocked`/first gesture) and per-asset missing-sound no-ops.
  - Trigger each mapped cue (title/menu/game music, intro, pellet, fruit spawn/collect, 1-up, caught, correct, wrong, death, level clear, game over, high score, menu select, pause).
  - Wire `M` to toggle mute and persist `audioMuted` via `Storage`; ensure muting never affects game logic.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 9.4_
  - _Properties: Property 20, Property 21, Property 22_

- [ ] 18. Add property-based tests for pure logic modules (mandatory)
  - Configure Vitest (the `vitest` + `fast-check` devDependencies are added in task 1) and add a `test` script that runs the suite once (non-watch).
  - Implement the **Core Properties** (`Property 1`–`Property 24` in `design.md`) as `fast-check` properties, each generating many randomized inputs and shrinking counterexamples on failure. Name every test after its property and include its `Validates: Requirements x.y` link so the requirement → property → test trace is explicit.
  - Group by module: `ScoreSystem` — Properties 1, 2, 3, 4 (lives start at six, lives bounds 0..10, game-over at zero, restart reset); `Maze` helpers — Properties 5, 6, 7, 8 (movement respects walls, tile/world round-trip, pellet eat, level clear); `QuestionBank` — Properties 9, 10, 12, 13 (grade/filter match, record validity, no immediate repeat, fallback set); `QuizSystem` — Property 11 (answer checking + life cost); `LessonBank` — Property 14 (lessons vary); `Storage` — Properties 15, 16, 17, 18, 19 (persisted monotonic high score, in-memory fallback, quiz stats, difficulty default/persist, single global high score); `AudioBus` map — Properties 20, 21, 22 (event→sound totality, mute persistence + no gameplay effect, missing-asset no-op). Include Property 23 (ghost legal-move invariant) and Property 24 (optional difficulty scaling) where the config/AI helpers are pure.
  - Run them with `npm run test -- --run`; these tests are required (not optional) and must pass before the owning pure-logic tasks are marked done. A failing property signals a fix to the implementation, the property, or the requirement — decide per case rather than weakening or deleting the test.
  - The example-based acceptance criteria (see the Correctness Properties "Example-based criteria" table) stay covered by the manual/integration and cross-browser checks in task 19, not here.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 4.3, 4.5, 4.6, 4.8, 4.9, 5.5, 6.4, 6.5, 6.6, 10.2, 10.5, 10.6, 12.2, 12.4, 12.5_
  - _Properties: Property 1–Property 22 (Property 23, Property 24 where pure)_

- [ ] 19. Accessibility, fallbacks, and final verification
  - Ensure quiz/lesson modals are keyboard-operable and dismissible, with sufficient contrast; add visible life gain/loss feedback.
  - Confirm graceful fallbacks: missing logo/sprite art -> drawn shapes/text, missing audio -> silent, blocked/absent `localStorage` -> in-memory records.
  - Produce optimized/resized copies of the large source PNGs for runtime to keep load times reasonable.
  - Verify `public/assets/images/ASSETS.md` documents each provided image asset and its intended in-game use.
  - Run `npm run build` and smoke-test the production build on Chrome, Firefox, Safari, and Edge.
  - _Requirements: 9.1, 9.2, 9.3, 6.5, 11.3, 11.6, 13.5, 13.6, 8.1, 8.5_

## Task Dependency Graph

Tasks grouped into waves; tasks within the same wave can be worked in parallel once the previous waves are complete.

```json
{
  "waves": [
    { "wave": 1, "tasks": [1], "description": "Project scaffold (foundation for everything)." },
    { "wave": 2, "tasks": [2, 3, 4, 7, 12], "description": "Independent core modules that only need the scaffold." },
    { "wave": 3, "tasks": [5, 8, 17, 18], "description": "Splash, Math Man movement, audio bus, mandatory property-based tests." },
    { "wave": 4, "tasks": [6], "description": "Menu (needs splash flow and storage)." },
    { "wave": 5, "tasks": [9], "description": "GameScene + pellets + HUD (needs maze, movement, score, menu entry)." },
    { "wave": 6, "tasks": [10, 14, 15], "description": "Ghosts, fruit/lesson, and level progression on top of gameplay." },
    { "wave": 7, "tasks": [11], "description": "Ghost collision + reset (needs ghosts)." },
    { "wave": 8, "tasks": [13, 16], "description": "Quiz flow and pause/game-over (need collision + question bank)." },
    { "wave": 9, "tasks": [19], "description": "Accessibility, fallbacks, and cross-browser verification." }
  ]
}
```

```mermaid
graph TD
  T1[1. Scaffold Phaser + Vite]
  T2[2. Storage]
  T3[3. ScoreSystem]
  T4[4. BootScene + preload]
  T5[5. SplashScene]
  T6[6. MenuScene]
  T7[7. Maze + tilemap]
  T8[8. Math Man movement]
  T9[9. Pellets + HUD/UIScene]
  T10[10. Einstein ghosts + AI]
  T11[11. Ghost collision + reset]
  T12[12. QuestionBank]
  T13[13. Quiz scene/modal/system]
  T14[14. Fruit + Lesson]
  T15[15. Level progression]
  T16[16. Pause + GameOver]
  T17[17. AudioBus + event sounds]
  T18[18. Property-based tests - mandatory]
  T19[19. Accessibility + verification]

  T1 --> T2
  T1 --> T3
  T1 --> T4
  T1 --> T7
  T1 --> T12
  T4 --> T5
  T5 --> T6
  T2 --> T6
  T7 --> T8
  T3 --> T9
  T7 --> T9
  T8 --> T9
  T6 --> T9
  T9 --> T10
  T10 --> T11
  T12 --> T13
  T11 --> T13
  T3 --> T13
  T2 --> T13
  T9 --> T14
  T3 --> T14
  T9 --> T15
  T3 --> T16
  T11 --> T16
  T4 --> T17
  T2 --> T17
  T2 --> T18
  T3 --> T18
  T12 --> T18
  T7 --> T18
  T13 --> T19
  T14 --> T19
  T16 --> T19
  T17 --> T19
```

## Notes

- Requirement references map back to `requirements.md`; the design details each module in `design.md`.
- The game should be manually runnable after task 9 (maze, movement, pellets, HUD); ghosts and the educational loop layer on top.
- Task 18 is mandatory (per `.kiro/steering/testing.md`): it applies property-based testing (Vitest + `fast-check`) against the `Property 1`–`Property 24` Correctness Properties in `design.md`. The `_Properties:_` line on each implementation task links that module's code to the properties it must satisfy, and those properties must have passing tests before the owning task is done.
- Audio (task 17) is wired near the end so each event cue can attach to working game events, but placeholder MP3s can be dropped in earlier.
- Final art and audio assets can start as placeholders; the BootScene load-error handling keeps the game runnable until real assets are supplied.
