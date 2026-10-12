export type Handler<E> = (
  request: Request,
  env: E,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Exact-path routes: { '/api/health': { GET: handler } }. Later issues add entries here. */
export type Routes<E> = Record<string, Partial<Record<Method, Handler<E>>>>;

export function jsonError(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

export function createRouter<E>(routes: Routes<E>): Handler<E> {
  return (request, env, ctx) => {
    const { pathname } = new URL(request.url);
    const route = routes[pathname];
    if (!route) return jsonError(404, 'NOT_FOUND');
    const handler = route[request.method as Method];
    if (!handler) {
      return jsonError(405, 'METHOD_NOT_ALLOWED', { Allow: Object.keys(route).join(', ') });
    }
    return handler(request, env, ctx);
  };
}
