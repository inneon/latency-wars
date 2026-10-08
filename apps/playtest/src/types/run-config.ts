import type { Effort } from './agent';
import type { Scenario } from './scenario';

/** Validated inputs for one run, with every default resolved. */
export interface RunConfig {
  workspaceRoot: string;
  scenario: Scenario;
  maxRounds: number;
  gm: { model: string; effort: Effort };
  players: { model: string; effort: Effort };
  outDir: string;
}
