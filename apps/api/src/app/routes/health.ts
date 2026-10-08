import type { FastifyInstance } from 'fastify';
import { HEALTH_PATH, type HealthResponse } from '@latency-wars/contracts';

export default async function healthRoute(fastify: FastifyInstance) {
  fastify.get(HEALTH_PATH, async (): Promise<HealthResponse> => ({
    status: 'healthy',
    checkedAt: new Date().toISOString(),
  }));
}
