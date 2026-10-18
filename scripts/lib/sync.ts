// Upload step of BE-37: put the files the bucket does not have yet. The R2 client is injected so this
// logic is tested without Cloudflare (scripts/test/sync.test.ts); the real one is lib/r2-wrangler.ts.
import { type AssetFile, IMMUTABLE_CACHE_CONTROL } from './assets.ts';

export interface R2Client {
  /** true = the object is there. Must THROW on auth / network errors, never answer false for them. */
  exists(hashedKey: string): Promise<boolean>;
  put(file: AssetFile, meta: { cacheControl: string; contentType: string }): Promise<void>;
}

export interface SyncResult {
  uploaded: string[];
  skipped: string[];
}

export interface SyncOptions {
  files: readonly AssetFile[];
  client: R2Client;
  /** no R2 call at all: every file is reported as "would upload" */
  dryRun?: boolean;
  concurrency?: number;
  log?: (line: string) => void;
}

/**
 * Names are content hashes, so "exists" means "same bytes" and re-running is safe: a second run with
 * unchanged assets uploads 0 files. Fails (throws) if any file fails; the caller must not write
 * manifest.json or deploy after that.
 */
export async function syncAssets(opts: SyncOptions): Promise<SyncResult> {
  const { files, client, dryRun = false, concurrency = 4, log = () => {} } = opts;
  const result: SyncResult = { uploaded: [], skipped: [] };
  const queue = [...files];
  let failure: unknown;

  async function worker(): Promise<void> {
    for (let f = queue.shift(); f && failure === undefined; f = queue.shift()) {
      try {
        if (dryRun) {
          result.uploaded.push(f.hashedKey);
          log(`would upload ${f.hashedKey} (${f.bytes} bytes)`);
        } else if (await client.exists(f.hashedKey)) {
          result.skipped.push(f.hashedKey);
          log(`exists   ${f.hashedKey}`);
        } else {
          await client.put(f, {
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            contentType: f.contentType,
          });
          result.uploaded.push(f.hashedKey);
          log(`uploaded ${f.hashedKey} (${f.bytes} bytes)`);
        }
      } catch (err) {
        failure ??= new Error(
          `${f.hashedKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (failure !== undefined) throw failure;
  result.uploaded.sort();
  result.skipped.sort();
  return result;
}
