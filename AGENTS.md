# Agent notes

## Rule IDs

Game rules live in [docs/game-mechanics.md](docs/game-mechanics.md) with stable IDs such as `TURN-03`. Code, tests and prompts under `apps/` and `libs/` cite them. Each cited ID must be a live rule in that doc.

- **Before you call a change done**, run:
  `pnpm exec vitest run --config tools/rule-refs/vitest.config.mts`
  The same check runs on pre-commit (lefthook).
- **To retire a rule**, move its row into section 13 (Retired Rule IDs) and fill in *Replaced by*. Then update every citation the test reports.
- **Never** renumber a rule, reuse a retired ID, or invent an ID that isn't in the doc.
- **Cite, don't restate.** A comment, docstring or README names the rule it implements (`implements LIGHT-03`) and says what the code does; it does not repeat the rule's formula, thresholds or wording. The rules are in flux, and a paraphrase goes stale without the test noticing. The behaviour belongs in the spec file, which fails when the rule changes. The same goes for section numbers ("see section 10"): they shift when sections are added, so refer to a rule ID or the section's name instead.
- Tunable parameters (`C`, `TRACK_DECAY`, `SENSOR_*`) are named in `CODE_CASE` in the doc's parameters table. Cite them by that name; the test doesn't check them, so grep when one is renamed.
- **Don't** get past a failure with `--no-verify`, or by adding an ID back to the doc just to make the test pass. Rules change only when the user decides.
