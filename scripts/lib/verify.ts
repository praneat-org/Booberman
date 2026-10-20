// Check the PUBLIC side of the bucket the way a browser would (BE-37 "เสร็จเมื่อ"): every file in
// manifest.json must come back with the immutable Cache-Control and a CORS header for the game origin.
import { IMMUTABLE_CACHE_CONTROL, type Manifest } from './assets.ts';

export interface VerifyOptions {
  manifest: Manifest;
  /** public base URL of the bucket, e.g. https://pub-xxxx.r2.dev (no trailing slash needed) */
  baseUrl: string;
  /** a game origin that must be allowed, e.g. https://booberman-dev.miryn.workers.dev */
  origin: string;
  fetchImpl?: typeof fetch;
  /** extra attempts: R2 public URL / CORS changes can take a moment to reach the edge */
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export async function verifyPublicAssets(opts: VerifyOptions): Promise<void> {
  const {
    manifest,
    origin,
    fetchImpl = fetch,
    retries = 3,
    retryDelayMs = 5000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = () => {},
  } = opts;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const keys = Object.values(manifest).sort();
  if (keys.length === 0) {
    log('verify: manifest is empty, nothing to check');
    return;
  }

  let problems: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    problems = [];
    for (const key of keys) {
      problems.push(...(await checkOne(`${base}/${key}`, origin, fetchImpl)));
    }
    if (problems.length === 0) {
      log(`verify: ${keys.length} file(s) OK (Cache-Control + CORS for ${origin})`);
      return;
    }
    log(`verify: attempt ${attempt + 1} found ${problems.length} problem(s)`);
  }
  throw new Error(`public asset check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

async function checkOne(url: string, origin: string, fetchImpl: typeof fetch): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'HEAD', headers: { Origin: origin } });
  } catch (err) {
    return [`${url}: request failed (${err instanceof Error ? err.message : String(err)})`];
  }
  const problems: string[] = [];
  if (res.status !== 200) problems.push(`${url}: HTTP ${res.status}`);
  const cc = res.headers.get('cache-control');
  if (cc !== IMMUTABLE_CACHE_CONTROL) problems.push(`${url}: Cache-Control is "${cc ?? ''}"`);
  const acao = res.headers.get('access-control-allow-origin');
  if (acao !== origin) {
    problems.push(`${url}: Access-Control-Allow-Origin is "${acao ?? ''}" (want ${origin})`);
  }
  return problems;
}
