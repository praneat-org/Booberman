import { describe, expect, it } from 'vitest';
import { IMMUTABLE_CACHE_CONTROL } from '../lib/assets.ts';
import { verifyPublicAssets } from '../lib/verify.ts';

const ORIGIN = 'https://booberman-dev.example.workers.dev';
const manifest = { 'a.png': 'a.0123456789.png', 'b.ogg': 'b.0123456789.ogg' };

function fakeFetch(headers: Record<string, string>, status = 200) {
  const urls: string[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    urls.push(`${init.method} ${url} origin=${(init.headers as Record<string, string>).Origin}`);
    return new Response(null, { status, headers });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const good = { 'cache-control': IMMUTABLE_CACHE_CONTROL, 'access-control-allow-origin': ORIGIN };
const run = (impl: typeof fetch, retries = 0) =>
  verifyPublicAssets({
    manifest,
    baseUrl: 'https://pub.example.r2.dev/',
    origin: ORIGIN,
    fetchImpl: impl,
    retries,
    sleep: async () => {},
  });

describe('verifyPublicAssets', () => {
  it('passes when every file has the immutable header and the game origin allowed', async () => {
    const f = fakeFetch(good);
    await run(f.impl);
    expect(f.urls).toEqual([
      `HEAD https://pub.example.r2.dev/a.0123456789.png origin=${ORIGIN}`,
      `HEAD https://pub.example.r2.dev/b.0123456789.ogg origin=${ORIGIN}`,
    ]);
  });

  it('fails on a wrong Cache-Control, missing or wildcard CORS, a foreign origin or a 404', async () => {
    await expect(run(fakeFetch({ ...good, 'cache-control': 'max-age=60' }).impl)).rejects.toThrow(
      /Cache-Control/,
    );
    await expect(run(fakeFetch({ 'cache-control': IMMUTABLE_CACHE_CONTROL }).impl)).rejects.toThrow(
      /Allow-Origin/,
    );
    await expect(
      run(fakeFetch({ ...good, 'access-control-allow-origin': 'https://evil.example' }).impl),
    ).rejects.toThrow(/Allow-Origin/);
    await expect(
      run(fakeFetch({ ...good, 'access-control-allow-origin': '*' }).impl),
    ).rejects.toThrow(/Allow-Origin/);
    await expect(run(fakeFetch(good, 404).impl)).rejects.toThrow(/HTTP 404/);
  });

  it('retries, then passes once the edge has the new headers', async () => {
    let n = 0;
    const impl = (async () =>
      new Response(null, { headers: n++ < 2 ? {} : good })) as unknown as typeof fetch;
    await run(impl, 3);
  });

  it('an empty manifest is fine (nothing to check)', async () => {
    await verifyPublicAssets({
      manifest: {},
      baseUrl: 'https://x',
      origin: ORIGIN,
      fetchImpl: fakeFetch({}).impl,
    });
  });
});
