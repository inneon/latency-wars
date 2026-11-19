# playtest-run-files

The file-system `RunStore` for `@latency-wars/playtest-replay`: `runFiles(dir)` lists the run folders under `dir` and reads each one's `events.jsonl`. A run's id is its folder name; an id that isn't a plain folder name is never read, so a request can't reach outside `dir`. A `dir` that doesn't exist holds no runs.

Import with `@latency-wars/playtest-run-files`. Node only. Consumer: `apps/api`, which points it at `PLAYTEST_RUNS_DIR` (by default `apps/playtest/runs`).

Run `nx test playtest-run-files` for the unit tests.
