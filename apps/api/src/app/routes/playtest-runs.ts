import type { FastifyInstance } from 'fastify';
import { listRuns, loadReplay, type Replay, RUNS_PATH, type RunStore, type RunSummary } from '@latency-wars/playtest-replay';

/** Play-test runs for the replay viewer: the list, and one run as a replay. */
export default async function playtestRunsRoute(fastify: FastifyInstance, { store }: { store: RunStore }) {
  fastify.get(RUNS_PATH, async (): Promise<RunSummary[]> => listRuns(store));

  fastify.get<{ Params: { id: string } }>(`${RUNS_PATH}/:id`, async (request, reply): Promise<Replay> => {
    const loaded = await loadReplay(store, request.params.id);
    if (loaded.ok) return loaded.replay;
    // 404: no such run. 422: it is there, but not in a format this code reads.
    return reply.code(loaded.missing ? 404 : 422).send({ message: loaded.reason });
  });
}
