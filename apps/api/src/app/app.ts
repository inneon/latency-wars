import type { FastifyInstance } from 'fastify';
import { runFiles } from '@latency-wars/playtest-run-files';
import sensible from './plugins/sensible';
import healthRoute from './routes/health';
import playtestRunsRoute from './routes/playtest-runs';

export interface AppOptions {
  /** The folder play-test runs are kept in. Defaults to `PLAYTEST_RUNS_DIR`, then to the play-test's own output folder. */
  runsDir?: string;
}

/**
 * Composition root for the API. Register adapters (routes, plugins) here;
 * keep domain logic in libs/.
 */
export async function app(fastify: FastifyInstance, options: AppOptions = {}) {
  await fastify.register(sensible);
  await fastify.register(healthRoute);
  const runsDir = options.runsDir ?? process.env['PLAYTEST_RUNS_DIR'] ?? 'apps/playtest/runs';
  await fastify.register(playtestRunsRoute, { store: runFiles(runsDir) });
}
