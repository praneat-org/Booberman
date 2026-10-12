export const HEALTH_PATH = '/api/health';

/** Response body of `GET /api/health`. */
export interface HealthResponse {
  ok: true;
  /** PROTOCOL_VERSION the worker speaks; the client compares it with its own. */
  protocol: number;
}

/** Shape check for an untrusted JSON value (zod arrives with Protocol v1). */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.ok === true && typeof v.protocol === 'number';
}
