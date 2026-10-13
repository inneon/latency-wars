# Agent notes

## Rule IDs

Game rules live in [docs/game-mechanics.md](docs/game-mechanics.md) with stable IDs such as `TURN-03`. Code, tests and prompts under `apps/` and `libs/` cite them. Each cited ID must be a live rule in that doc.

- **Before you call a change done**, run:
  `pnpm exec vitest run --config tools/rule-refs/vitest.config.mts`
  The same check runs on pre-commit (lefthook).
- **To retire a rule**, move its row into section 13 (Retired Rule IDs) and fill in *Replaced by*. Then update every citation the test reports.
- **Never** renumber a rule, reuse a retired ID, or invent an ID that isn't in the doc.
- **Don't** get past a failure with `--no-verify`, or by adding an ID back to the doc just to make the test pass. Rules change only when the user decides.
