import { HEALTH_PATH, isHealthResponse, type HealthStatus } from '@latency-wars/contracts';

/** Asks the API how it is. Any failure (network, bad shape, non-2xx) counts as unhealthy. */
export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthStatus> {
  try {
    const res = await fetchFn(HEALTH_PATH);
    if (!res.ok) return 'unhealthy';
    const body: unknown = await res.json();
    return isHealthResponse(body) ? body.status : 'unhealthy';
  } catch {
    return 'unhealthy';
  }
}
