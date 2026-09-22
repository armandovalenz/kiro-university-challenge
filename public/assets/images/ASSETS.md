# Math Man — Image Assets

Reference for the image assets in this directory and their intended use in the game and marketing.

| File                                 | Asset                   | Intended use                                  |
| ------------------------------------ | ----------------------- | --------------------------------------------- |
| `01_poster_original.png`             | Original game poster    | Marketing, concept art, game overview         |
| `02_logo.png`                        | **Math Man** logo       | Header, title screen, website/navbar          |
| `03_app_icon.png`                    | Square app icon         | PWA icon, app shortcut, favicon source        |
| `04_mascot_sprite_sheet.png`         | Math Man poses          | Player animation, reactions, power-ups        |
| `05_collectibles_and_math_icons.png` | Numbers & math items    | Maze collectibles, operators, bonuses, lives  |
| `06_ui_kit.png`                      | Buttons & HUD elements  | Score, lives, questions, menus, progress      |
| `07_hero_original.png`               | Original 16:9 hero      | Landing page / title screen                   |
| `08_poster_einstein_enemies.png`     | Einstein version poster | Updated concept with colored Einstein enemies |
| `09_hero_einstein_enemies.png`       | Einstein 16:9 hero      | **Recommended current landing/title screen**  |

## Notes for implementation

- **Logo** (`02_logo.png`) — used by `SplashScene` and `MenuScene` (design Req 11). Consider exporting an SVG or trimmed/optimized PNG for crisp scaling; source files here are large (~1.5-2 MB each).
- **App icon** (`03_app_icon.png`) — source for the favicon and any PWA icons.
- **Mascot sprite sheet** (`04_mascot_sprite_sheet.png`) — slice into frames for Math Man's movement/mouth animation; define frame size when wiring Phaser animations.
- **Collectibles/math icons** (`05_...png`) — pellets, fruit, operators, and life icons.
- **UI kit** (`06_ui_kit.png`) — HUD (score/lives/level), buttons, and quiz/lesson modal styling cues.
- **Hero** (`09_hero_einstein_enemies.png`) — recommended title/landing image (matches the colored Einstein-ghost design).
- Optimize (compress/resize) before shipping to reduce load time; the originals are high-resolution.

## Provenance & attribution

- These images were **generated with ChatGPT (OpenAI image generation)**.
- Under OpenAI's Terms of Use, the user who created the images owns the output and may use it, including commercially.
- Note: in some jurisdictions (e.g., the U.S.), purely AI-generated images may receive **limited or no copyright protection**. Treat them as project assets rather than assuming exclusive rights.
- Unlike the Pac-Man audio in `../audio/`, these images are **not** third-party copyrighted material and are safe to ship with this project.
