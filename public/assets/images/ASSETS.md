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

## Runtime optimization (Req 11.3, 13.6)

The originals in this directory are 1448-2172 px on the long edge and ~1.5-2 MB
each. The game canvas is only 672×744, so shipping the originals wastes
bandwidth. The build therefore loads **resized runtime copies** from
`optimized/` (long edge ~1000 px) for the images that are drawn scaled-to-fit,
while the **full-resolution originals stay here** for provenance and future
re-exports.

| Runtime file (`optimized/`)          | Source original                      | Loaded as | Used by                     |
| ------------------------------------ | ------------------------------------ | --------- | --------------------------- |
| `optimized/02_logo.png`              | `02_logo.png`                        | image     | `SplashScene`, `MenuScene`  |
| `optimized/03_app_icon.png` (256 px) | `03_app_icon.png`                    | favicon   | `index.html` `<link rel=icon>` |
| `optimized/06_ui_kit.png`            | `06_ui_kit.png`                      | image     | `UIScene` HUD bars          |
| `optimized/08_poster_einstein_enemies.png` | `08_poster_einstein_enemies.png` | image  | preloaded (reserved)        |
| `optimized/09_hero_einstein_enemies.png`   | `09_hero_einstein_enemies.png`   | image  | `MenuScene` background      |

Approximate savings from the resize: logo 1.45 MB → ~0.45 MB, ui-kit 1.96 MB →
~1.25 MB, hero 1.93 MB → ~0.9 MB, poster 1.63 MB → ~1.0 MB, favicon 1.67 MB →
~0.12 MB.

The two **sprite sheets** (`04_mascot_sprite_sheet.png`,
`05_collectibles_and_math_icons.png`) are intentionally **loaded from the
originals** so their frame geometry is preserved for when a frame map is wired;
the game currently renders drawn fallbacks for both, so their download size does
not yet affect gameplay.

To regenerate the runtime copies (macOS `sips`; longest side 1000 px, icon
256 px):

```sh
mkdir -p public/assets/images/optimized
for f in 02_logo 06_ui_kit 08_poster_einstein_enemies 09_hero_einstein_enemies; do
  sips -Z 1000 "public/assets/images/$f.png" --out "public/assets/images/optimized/$f.png"
done
sips -Z 256 public/assets/images/03_app_icon.png --out public/assets/images/optimized/03_app_icon.png
```

> Further gains are possible with a PNG palette-quantizer (e.g. `pngquant`) or by
> exporting to WebP; not done here to avoid adding a build-time dependency.
> Keys/paths are centralized in `src/config.js` (`IMAGE_ASSETS`), so swapping in
> further-optimized files is a one-line change.

## Provenance & attribution

- These images were **generated with ChatGPT (OpenAI image generation)**.
- Under OpenAI's Terms of Use, the user who created the images owns the output and may use it, including commercially.
- Note: in some jurisdictions (e.g., the U.S.), purely AI-generated images may receive **limited or no copyright protection**. Treat them as project assets rather than assuming exclusive rights.
- Unlike the Pac-Man audio in `../audio/`, these images are **not** third-party copyrighted material and are safe to ship with this project.
