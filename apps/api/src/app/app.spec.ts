import Fastify from 'fastify';
import { HEALTH_PATH, isHealthResponse } from '@latency-wars/contracts';
import { app } from './app';

describe('GET /api/health', () => {
  it('returns a healthy HealthResponse', async () => {
    const server = Fastify();
    await server.register(app);
    const res = await server.inject({ method: 'GET', url: HEALTH_PATH });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(isHealthResponse(body)).toBe(true);
    expect(body.status).toBe('healthy');
    await server.close();
  });
});
