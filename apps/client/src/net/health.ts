import { HEALTH_PATH, type HealthResponse, isHealthResponse } from '@booberman/protocol';

export type HealthResult =
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; reason: string };

/** Calls the worker through the same origin (Vite proxy in dev, Workers in production). */
export async function checkHealth(fetchFn: typeof fetch = fetch): Promise<HealthResult> {
  try {
    const res = await fetchFn(HEALTH_PATH);
    if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` };
    const body: unknown = await res.json();
    if (!isHealthResponse(body)) return { status: 'error', reason: 'unexpected body' };
    return { status: 'ok', health: body };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}
