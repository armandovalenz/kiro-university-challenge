# Math Man

Math Man is an educational, browser-based maze arcade game inspired by Pac-Man. Guide **Math Man** through a maze collecting pellets while avoiding a colorful quartet of **Einstein ghosts**. The twist: when a ghost catches you, instead of an instant loss you're given a grade-appropriate math question — answer correctly to survive. Fruits grant an extra life and a short math or science micro-lesson.

Built with **Phaser 3** and **Vite**, it runs entirely in the browser with no backend and no login — all records (high score, difficulty preference, mute state, quiz stats) are saved in `localStorage`.

## Features

- **Classic maze gameplay** — grid-locked movement, wall collisions, pellets, and level progression.
- **Educational core** — Einstein ghosts trigger math quizzes matched to a selected grade (5th, 6th, or 7th).
- **Fruits & micro-lessons** — collecting a fruit grants an extra life and shows a short math/science fun fact.
- **Lives system** — start with 6 lives, capped at a maximum of 10.
- **Colorful Einstein ghosts** — red, pink, cyan, and orange, each with classic Pac-Man-style AI personalities.
- **Grade selection** — 5th, 6th, or 7th grade difficulty, remembered between sessions.
- **Splash screen & branding** — Math Man logo intro, start menu, pause, and game-over screens.
- **Arcade audio** — background music and sound effects for every game event, with a persistent mute toggle.
- **Local high scores** — a single global high score persisted in `localStorage`, with an in-memory fallback.
- **Accessible modals** — quiz and lesson dialogs are DOM overlays that are keyboard-navigable and high-contrast.

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
| Unit tests (optional) | Vitest |

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

### Tests (optional)

```bash
npm run test
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
2. Avoid the Einstein ghosts. If one catches you, answer the math question:
   - **Correct** → keep your life and resume playing.
   - **Incorrect** → lose a life (the correct answer and a short explanation are shown).
3. Collect fruits for an extra life and a quick math/science lesson.
4. The game ends when your lives reach 0. Beat your high score!

## Project Structure

```
index.html                 # Vite entry; hosts the #game container + DOM overlay root
package.json               # phaser (pinned), vite, (optional) vitest
vite.config.js
public/
  assets/
    images/                # logo, sprites, tiles
    audio/                 # music + sound effects
src/
  main.js                  # Phaser.Game config; registers the scene list
  config.js                # Constants: tile size, speeds, LIVES_START=6, LIVES_MAX=10, colors
  scenes/                  # Boot, Splash, Menu, Game, UI, Quiz, Lesson, Pause, GameOver
  entities/                # MathMan, Ghost, Fruit
  maze/                    # mazeData, Maze (tilemap + helpers)
  systems/                 # QuizSystem, QuestionBank, LessonBank, ScoreSystem, Storage, AudioBus
  ui/                      # QuizModal, LessonModal (DOM overlays)
.kiro/
  specs/math-man/          # requirements.md, design.md, tasks.md
```

`QuestionBank`, `LessonBank`, `ScoreSystem`, `Storage`, and the pure helpers in `Maze` are framework-agnostic (no Phaser imports) so they stay unit-testable.

## Browser Support

Runs in current versions of Chrome, Firefox, Safari, and Edge. If `localStorage` is unavailable, the game falls back to in-memory records for the session. If audio is blocked by autoplay policy, it starts after the first user interaction.

## Documentation

Detailed design and requirements live under [`.kiro/specs/math-man/`](.kiro/specs/math-man/):

- [`requirements.md`](.kiro/specs/math-man/requirements.md) — user stories and acceptance criteria
- [`design.md`](.kiro/specs/math-man/design.md) — architecture and technical design
- [`tasks.md`](.kiro/specs/math-man/tasks.md) — the incremental implementation plan
