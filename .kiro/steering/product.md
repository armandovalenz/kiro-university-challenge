# Product

**Math Man** is an educational, browser-based maze arcade game inspired by Pac-Man.

- Guide **Math Man** through a maze collecting pellets while avoiding a colorful quartet of **Einstein ghosts** (red, pink, cyan, orange).
- When an Einstein ghost catches Math Man, gameplay pauses and a **grade-appropriate math or science question** appears. Answer correctly to survive; a wrong answer costs a life and shows the explanation.
- **Fruits** grant an extra life and a short math/science micro-lesson.
- Lives start at **6** and are capped at **10**.
- Difficulty is chosen by grade: **5th, 6th, or 7th**.
- Opens with a **splash screen** (Math Man logo), then a start menu with grade selection.
- **No login/accounts.** All records (single global high score, difficulty preference, mute, quiz stats) persist in `localStorage` with an in-memory fallback.

## First-person 3D mode (in progress)

An optional **first-person 3D mode (FP3D_Mode)** is being added: the player walks the **same maze** from a first-person camera (Three.js WebGL layer) instead of the top-down 2D view. It is a rendering + input layer only — it reuses the exact maze, ghosts, quiz-on-capture, fruit rewards, lives (start 6, cap 10), scoring, difficulty-by-grade, and `mathman.v1` persistence. If WebGL or the maze data is unavailable, it falls back to the 2D view with a visible notice. It is specified in `.kiro/specs/first-person-3d-mode/` and supported by the `fps3d-architect` / `fps3d-asset-forge` agents and the `fps3d-webgl` / `fps3d-assets` skills.

## Audience & intent

Students in grades 5-7 (and anyone brushing up). The game is an educational homage, not a commercial product.

## Source of truth

Specs live in `.kiro/specs/`:
- `math-man/` — the base 2D game (`requirements.md`, `design.md`, `tasks.md`).
- `first-person-3d-mode/` — the FP3D_Mode feature (`requirements.md`, `design.md`, `tasks.md`).

Each spec's `requirements.md` carries user stories + EARS acceptance criteria, `design.md` the architecture and module design, and `tasks.md` the incremental plan. When requirements and code disagree, treat the relevant spec as authoritative and reconcile explicitly.
