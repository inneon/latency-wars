import { runPlaytest } from './core/game';
import { readRunConfig, USAGE } from './input';
import { createAgents } from './llm/create-agents';
import { RunWriter } from './output/run-writer';

// input (read + validate) → core (game loop, no I/O) → output (render + write)
async function main() {
  const config = await readRunConfig(process.argv.slice(2));
  if (!config) {
    console.log(USAGE);
    return;
  }

  const output = new RunWriter(config);
  const backend = createAgents(config);
  try {
    await runPlaytest({ scenario: config.scenario, agents: backend.agents, maxRounds: config.maxRounds, emit: output.event });
  } finally {
    backend.close();
    output.finish(backend.usage());
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
