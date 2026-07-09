# Deployment Engine — working notes for coding agents

## UI refactor branch rule
All UI-refactor work (Fortis Design System restyle per `DESIGN_SPEC.md`) stays on branch
**`peter-ui-refactor`** until Peter approves a merge. Never commit UI-refactor work to `main`,
never merge, never push to `main`. Commit after every phase with a message prefixed
`ui-refactor(phase-N):`.

(The design handoff spec references a `peter.ui.refactor` branch name; the actual branch in this
repo is `peter-ui-refactor` — use the existing one.)
