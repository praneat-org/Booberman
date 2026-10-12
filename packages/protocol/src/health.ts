import { z } from 'zod';

export const HEALTH_PATH = '/api/health';

/** Response body of `GET /api/health`. */
export const HealthResponse = z.object({
  ok: z.literal(true),
  /** PROTOCOL_VERSION the worker speaks; the client compares it with its own. */
  protocol: z.number().int(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export function isHealthResponse(value: unknown): value is HealthResponse {
  return HealthResponse.safeParse(value).success;
}
