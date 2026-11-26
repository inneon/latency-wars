import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Replay, RUNS_PATH, runLibrary, type RunStore, type RunSummary } from '@latency-wars/playtest-replay';

/**
 * Play-test runs for the replay viewer: the list, and one run as a replay. Both carry an entity tag, and a request that
 * sends the current one back (If-None-Match) is answered 304 without the log being read, so a page can poll cheaply for
 * new runs and new turns.
 */
export default async function playtestRunsRoute(fastify: FastifyInstance, { store }: { store: RunStore }) {
  const library = runLibrary(store);

  /** Answers 304 if the asker already has `tag`; otherwise sets it on the reply. */
  const unchanged = (request: FastifyRequest, reply: FastifyReply, tag: string | undefined): boolean => {
    void reply.header('Cache-Control', 'no-cache');
    if (tag === undefined) return false;
    const etag = `"${tag}"`;
    void reply.header('ETag', etag);
    return request.headers['if-none-match'] === etag;
  };

  fastify.get(RUNS_PATH, async (request, reply): Promise<RunSummary[] | undefined> => {
    if (unchanged(request, reply, await library.listTag())) return reply.code(304).send();
    const { tag, runs } = await library.list();
    unchanged(request, reply, tag);
    return runs;
  });

  fastify.get<{ Params: { id: string } }>(`${RUNS_PATH}/:id`, async (request, reply): Promise<Replay | undefined> => {
    const id = request.params.id;
    if (unchanged(request, reply, await library.tag(id))) return reply.code(304).send();
    const { tag, loaded } = await library.load(id);
    if (!loaded.ok) {
      // 404: no such run. 422: it is there, but not in a format this code reads.
      return reply.code(loaded.missing ? 404 : 422).send({ message: loaded.reason });
    }
    unchanged(request, reply, tag);
    return loaded.replay;
  });
}
