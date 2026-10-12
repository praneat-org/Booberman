import { HEALTH_PATH, type HealthResponse, PROTOCOL_VERSION } from '@booberman/protocol';
import { createRouter } from './http/router';

// biome-ignore lint/complexity/noBannedTypes: bindings are added by later issues (KV, DO, D1)
export type Env = {};

const handle = createRouter<Env>({
  [HEALTH_PATH]: {
    GET: () => Response.json({ ok: true, protocol: PROTOCOL_VERSION } satisfies HealthResponse),
  },
});

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
} satisfies ExportedHandler<Env>;
