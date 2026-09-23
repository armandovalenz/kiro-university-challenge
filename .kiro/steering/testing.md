# Testing Policy — Property-Based Tests Are Mandatory

Property-based testing (PBT) is a **required** part of every squad's definition of done, not an optional extra. This rule overrides any "optional", "run on demand", or "skip unless requested" language found in specs, task lists, or older steering.

## Rules

- **Always execute property-test tasks.** When a spec's `tasks.md` contains a property-based testing task (e.g., the `fast-check` task), treat it as required work. Complete and run it — never skip it, defer it indefinitely, or leave it unchecked as "optional".
- **Do not mark property tests optional.** Do not add "(optional)", "if time permits", or similar qualifiers to property-test tasks. If you find such wording on a property-test task, remove it. (An individual *property* may still be labeled optional when its underlying requirement uses EARS "MAY" — that is about requirement scope, not about whether tests run.)
- **Every Core Property gets a test.** Each Core Property in a spec's `design.md` (the `Property N` entries under "Correctness Properties") must have a corresponding `fast-check` property test whose name carries its `Validates: Requirements x.y` link. Requirement → property → test traceability is required.
- **New testable criteria require new properties.** When you add or change an EARS acceptance criterion that is testable (not purely visual/scene/browser/example-based), add or update the matching Core Property and its property test in the same change.
- **Tests must pass before a task is done.** A task that owns pure logic is not complete until its associated property tests exist and pass. Do not check off such a task with failing or missing property tests.
- **Handling failures.** A shrunk counterexample is a signal to fix the implementation, tighten the property, or refine the requirement — decided per case. Do not silence a failing property by weakening or deleting the test just to make it pass.

## Tooling

- Property-based tests run under **Vitest** using **`fast-check`** (kept as a `devDependency`).
- Run them non-interactively: `npm run test -- --run`. Run this after changes to any framework-agnostic logic module (`ScoreSystem`, `QuestionBank`, `LessonBank`, `Storage`, `Maze` helpers, `AudioBus` map) and before declaring a task complete.

## Scope

- PBT applies to the **framework-agnostic** logic (plain-data modules that need no Phaser runtime).
- Purely visual, scene-flow, DOM/UI, browser-environment, or non-deterministic behaviors remain **example-based** (manual/integration/cross-browser checks) and are not forced into properties — but they are still verified, just not via PBT.
