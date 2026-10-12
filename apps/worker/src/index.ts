import { PROTOCOL_VERSION } from '@booberman/protocol';

export default {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ ok: true, service: 'booberman-worker', protocol: PROTOCOL_VERSION });
  },
} satisfies ExportedHandler;
