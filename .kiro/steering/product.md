# Product

**Math Man** is an educational, browser-based maze arcade game inspired by Pac-Man.

- Guide **Math Man** through a maze collecting pellets while avoiding a colorful quartet of **Einstein ghosts** (red, pink, cyan, orange).
- When an Einstein ghost catches Math Man, gameplay pauses and a **grade-appropriate math or science question** appears. Answer correctly to survive; a wrong answer costs a life and shows the explanation.
- **Fruits** grant an extra life and a short math/science micro-lesson.
- Lives start at **6** and are capped at **10**.
- Difficulty is chosen by grade: **5th, 6th, or 7th**.
- Opens with a **splash screen** (Math Man logo), then a start menu with grade selection.
- **No login/accounts.** All records (single global high score, difficulty preference, mute, quiz stats) persist in `localStorage` with an in-memory fallback.

## Audience & intent

Students in grades 5-7 (and anyone brushing up). The game is an educational homage, not a commercial product.

## Source of truth

The full spec lives in `.kiro/specs/math-man/`:
- `requirements.md` — user stories + EARS acceptance criteria
- `design.md` — architecture, diagrams, module design
- `tasks.md` — incremental implementation plan

When requirements and code disagree, treat the spec as authoritative and reconcile explicitly.
