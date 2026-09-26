# Kiro University Challenge Eligibility

This project ([Math Man](README.md)) was built as an entry for the Kiro University Challenge. The table below maps each of the Challenge's disqualification criteria to the corresponding evidence in this repository.

| Criterion | Status | Evidence |
|-----------|--------|----------|
| GitHub repository is public | ✅ | Repo is public (`"private": false`, `"visibility": "public"`). |
| `.kiro` folder and required files present | ✅ | `.kiro/` includes `specs/` (`math-man/` and `first-person-3d-mode/`, each with `requirements.md`, `design.md`, `tasks.md`), `steering/` (`product.md`, `tech.md`, `structure.md`, `testing.md`), `agents/`, `hooks/`, and `skills/`. |
| Project functions as described | ✅ | `npm run build` produces a static `dist/` build; `npm run test -- --run` passes all tests (65 tests across 12 files, including mandatory `fast-check` property-based tests). Both specs' task lists are complete. |
| Meaningful Kiro usage | ✅ | Two structured specs, four steering docs, custom sub-agents (`fps3d-architect`, `fps3d-asset-forge`), a hook, and skills — all consistent with the shipped source. |

## Lesson 1 — Spec-driven development

This project uses Kiro's structured spec workflow. Both features are built as full specs under `.kiro/specs/`, each with the complete three-artifact structure:

| Spec | `requirements.md` | `design.md` | `tasks.md` |
|------|-------------------|-------------|------------|
| [`math-man/`](.kiro/specs/math-man/) (base 2D game) | 13 requirements, user stories + EARS acceptance criteria | Architecture, scene diagrams, data models, Correctness Properties | 19 discrete, tracked tasks (all complete) |
| [`first-person-3d-mode/`](.kiro/specs/first-person-3d-mode/) (FP3D mode) | User stories + EARS acceptance criteria | Three.js rendering/input layer design | 19 discrete, tracked tasks (all complete) |

- **EARS notation** is used throughout — the `math-man` requirements alone contain ~76 `WHEN/WHILE/IF/THEN/SHALL` clauses, giving testable acceptance criteria.
- **Requirement → property → task → test traceability**: testable criteria are captured as numbered Correctness Properties in `design.md`, referenced by tasks, and validated by mandatory `fast-check` property-based tests.
- Tasks are trackable and were executed through the spec workflow (both task lists fully checked off).

## Lesson 2 — Steering documents

The project ships persistent workspace steering in [`.kiro/steering/`](.kiro/steering/) so Kiro follows its conventions without repetition:

| File | Purpose |
|------|---------|
| [`product.md`](.kiro/steering/product.md) | Product overview — what Math Man is, audience, and the source-of-truth specs |
| [`tech.md`](.kiro/steering/tech.md) | Tech stack + conventions (Phaser 3, Vite, Three.js, framework-agnostic logic rules) |
| [`structure.md`](.kiro/steering/structure.md) | File organization, placement rules, and naming conventions |
| [`testing.md`](.kiro/steering/testing.md) | Testing policy — property-based tests are mandatory, with intent and enforcement |

These enforce concrete standards (e.g., "keep logic framework-agnostic — no Phaser/Three.js imports in `QuestionBank`, `ScoreSystem`, `Storage`, `mazeLogic`") with the rationale and code-level expectations behind each rule, matching the Lesson 2 best-practice pattern of *convention + intent + example*.

## Lesson 3 — Hooks

The project ships a Kiro agent hook at [`.kiro/hooks/lint-on-save-debounced.json`](.kiro/hooks/lint-on-save-debounced.json):

| Field | Value |
|-------|-------|
| Name | Lint on Save (src, 15s debounce) |
| Trigger | `PostFileSave` |
| Matcher | `/src/.*\.(js|mjs|jsx|ts|tsx)$` (JS/TS files under `src/`) |
| Action | `command` — runs `npm run lint` after a 15-second debounce (token-file guard so only the last save in a burst triggers a lint) |
| Enabled | `false` (opt-in; disabled by default to avoid unprompted runs) |

It follows the Lesson 3 schema exactly (`version`, `hooks[]`, `trigger`, `matcher`, `action.type` + `action.command`) and demonstrates a non-trivial pattern — a debounced `PostFileSave` command hook rather than the bare example.

## Lesson 4 — Property-based testing

Property-based testing is a **mandatory** part of the definition of done here (enforced by [`.kiro/steering/testing.md`](.kiro/steering/testing.md)), and it is wired through the full spec workflow exactly as the lesson describes:

- **Properties extracted from requirements** — each spec's `design.md` has a "Correctness Properties" section: `math-man` defines **Properties 1–24** and `first-person-3d-mode` defines **Properties 1–7**, each stated as a universal rule with a `Validates: Requirements x.y` trace back to its EARS acceptance criteria.
- **Properties → tests** — every Core Property has a matching `fast-check` property test whose name carries its `Validates: Requirements` link, preserving requirement → property → test traceability. Test files cover `ScoreSystem`, `QuestionBank`, `QuizSystem`, `LessonBank`, `Storage`, `AudioBus`, `mazeLogic`, `ghostAI`, ghost movement, and the FP3D logic (`fp3dLogic`, `lineOfSight`, scoring reuse).
- **Tooling** — tests run under **Vitest** with **`fast-check`** (a `devDependency`), each property at ≥100 generated cases. Run non-interactively with `npm run test -- --run`.
- **Scope discipline** — PBT targets framework-agnostic logic; purely visual, scene-flow, DOM/ARIA, and WebGL-wiring behaviors stay example-based, as the lesson recommends.

> Note: Property-based testing is IDE-only. This repository was authored in the Kiro IDE (or with its `.kiro` configuration), so the generated properties and tests are present and runnable here.

## Lesson 5 — Powers

The project ships a self-authored Kiro Power at [`powers/game-engine/`](powers/game-engine/), packaged to the [agent-plugins](https://agent-plugins.org) spec:

```
powers/game-engine/
├── plugin.json                      # required manifest ($schema, name, version, description, keywords, license)
├── LICENSE
└── skills/
    └── game-engine/
        ├── SKILL.md                 # game-engine skill
        ├── assets/                  # 5 starter templates (2D maze, platformer, paddle, engine, base repo)
        └── references/              # 9 reference docs (basics, techniques, 3D web games, publishing, …)
```

- The manifest declares keywords (`game-engine`, `phaser`, `three-js`, `webgl`, `2d-games`, `3d-games`, …) so Kiro loads the packaged skill and best-practice references on demand when a matching topic comes up.
- `.kiro/skills/game-engine/` is a thin pointer into this Power, keeping the packaged content in one place.
- This demonstrates the Lesson 5 pattern: a power as a directory with a required manifest plus optional skills/reference components, usable with any stack.

## Lesson 6 — Model Context Protocol (MCP)

MCP is wired into the FP3D asset pipeline via the [`fps3d-asset-forge`](.kiro/agents/fps3d-asset-forge.json) custom agent, which registers a **Blender MCP** server scoped to that agent:

```json
"mcpServers": {
  "blender": {
    "command": "uvx",
    "args": ["--python", "3.11", "mcp-for-blender"],
    "env": {
      "BLENDER_HOST": "localhost",
      "BLENDER_PORT": "9876",
      "BLENDER_MCP_SAFE_MODE": "1",
      "DISABLE_TELEMETRY": "true"
    },
    "timeout": 180000
  }
}
```

- Follows the Lesson 6 schema (`mcpServers` → `command`/`args`/`env`) and demonstrates the advanced pattern of **scoping an MCP server to a specific agent** rather than globally, so only `fps3d-asset-forge` can call the Blender tools.
- The server is used to generate web-ready GLB 3D models for the first-person mode, with `@blender` in the agent's `tools` and **no MCP tool auto-approved** (every call prompts) — a security-conscious configuration, consistent with the lesson's guidance to only run trusted MCP servers.
- Safety hardening: `BLENDER_MCP_SAFE_MODE=1` (blocks file/network/process access), telemetry disabled, and the socket bound to `localhost`.
- The companion texture/image pipeline (Draw Things) is intentionally **not** an MCP server — it is a local HTTP API driven by `curl` — which the agent prompt and the `fps3d-assets` skill document explicitly.

> Note: the Blender MCP server (`mcp-for-blender` via `uvx`) requires a local Blender install with the MCP bridge and is invoked on demand by the agent; it is not needed to build or play the game.

## Lesson 7 — Custom agents

The project ships **two purpose-built custom agents** under [`.kiro/agents/`](.kiro/agents/), each a complete configuration with scoped tools, permissions, context, and instructions:

| Agent | Role | Key configuration |
|-------|------|-------------------|
| [`fps3d-architect`](.kiro/agents/fps3d-architect.json) | Designs & builds FP3D mode on Phaser 3 + Vite + Three.js, reusing shared logic | `tools` scoped to read/write/shell/grep/glob/code/web; `allowedTools` pre-approves read-only ops; `toolsSettings.write.allowedPaths` limited to `src/**`, `tests/**`, the FP3D spec/skill, `public/assets/**`, and build config; `shell.allowedCommands`/`deniedCommands` gate builds/tests and block `npm run dev`, force-push, and destructive commands; `resources` preload the spec, steering, and skills; `hooks.agentSpawn` prints tool versions; custom `model`, `keyboardShortcut`, and `welcomeMessage` |
| [`fps3d-asset-forge`](.kiro/agents/fps3d-asset-forge.json) | Sandboxed asset producer (GLB models + textures) | Writes **only** under `public/assets/**` (explicit `deniedPaths` for `src/**`, `.kiro/**`, `package.json`, …); `shell` restricted to `curl` on `localhost:7860`, `lsof`, `gltf-validator`, `cwebp`, and asset file ops; registers a per-agent **Blender MCP** server (see Lesson 6); no MCP tool auto-approved |

These demonstrate the full Lesson 7 feature set: **limiting tool access**, **pre-approving trusted tools**, **capability-scoped path/command permissions**, **including context** via `resources` (files + `skill://` + steering), **connecting MCP servers** to an agent, and **wiring hooks** — all in shareable, version-controlled config files.

## Bonus Lesson — Kiro Web / cloud sessions

Part of the security review and hardening was performed in a **Kiro cloud session**, with results delivered back through the source provider as pull requests — the standard cloud-session workflow. The git history shows this directly: two commits were both authored and committed by the **Kiro Agent** server identity, then merged into `main` via PRs:

| Commit | Author & committer | Delivered via |
|--------|--------------------|---------------|
| `2f5e605` — `docs: add security review evidence document` | `Kiro Agent <244629292+kiro-agent@users.noreply.github.com>` | PR #5 (`docs/security-review`) |
| `bce0e15` — `fix(security): resolve all 4 infra security findings` | `Kiro Agent <244629292+kiro-agent@users.noreply.github.com>` | PR #6 (`fix/security-issues`) |

(Verify with `git log --pretty='%h %an <%ae> | %cn | %s'`.) The `Kiro Agent` committer identity is the cloud sandbox committing server-side, distinct from the local `Armando Valenzuela` commits made in the IDE.

The project configuration is also fully **cloud-portable**: all `.kiro/` project config (specs, steering, the two custom agents, the hook, skills, and the per-agent MCP server) is committed to the repo, so it travels automatically into a cloud session's sandbox when the repo is cloned.

## Requirements verified outside this repository

The following Challenge requirements live outside the codebase and must be confirmed separately by the submitter:

- **Social post** — must include the required Kiro tag, hashtags, and links.
- **Lesson-specific required files** — confirm the specific deliverables for the lesson/track this project is submitted under.
- **Other challenge-specific requirements** — any per-track rules from the entry.

## Notes

- The production build emits a chunk-size warning (a single ~1.9 MB JS bundle). It builds and runs correctly; this does not affect eligibility.
