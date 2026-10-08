/**
 * Wire contract for the API health endpoint.
 * Shared by the API (producer) and the web UI (consumer) so neither
 * side can drift without a type error.
 */
export const HEALTH_PATH = '/api/health' as const;

export type HealthStatus = 'healthy' | 'unhealthy';

export interface HealthResponse {
  status: HealthStatus;
  /** ISO-8601 timestamp of when the check ran. */
  checkedAt: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['status'] === 'healthy' || v['status'] === 'unhealthy') &&
    typeof v['checkedAt'] === 'string'
  );
}
