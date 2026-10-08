import type { FastifyInstance } from 'fastify';
import sensible from './plugins/sensible';
import healthRoute from './routes/health';

/**
 * Composition root for the API. Register adapters (routes, plugins) here;
 * keep domain logic in libs/.
 */
export async function app(fastify: FastifyInstance) {
  await fastify.register(sensible);
  await fastify.register(healthRoute);
}
