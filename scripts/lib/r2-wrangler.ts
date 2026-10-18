// R2Client backed by `wrangler r2 object get|put`. Auth comes from CLOUDFLARE_API_TOKEN /
// CLOUDFLARE_ACCOUNT_ID in the environment (GitHub Environment secrets); nothing is logged or passed
// as an argument. No shell is involved: names go to wrangler as separate argv entries.
import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import type { AssetFile } from './assets.ts';
import type { R2Client } from './sync.ts';

const execFileAsync = promisify(execFile);

export interface WranglerR2Options {
  /** path of the wrangler executable (apps/worker/node_modules/.bin/wrangler) */
  wranglerBin: string;
  bucket: string;
  /** use wrangler's local R2 simulator instead of Cloudflare (offline check of the whole flow) */
  local?: { persistTo: string };
  /** injectable for tests */
  run?: (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

// What wrangler prints when the key is simply not in the bucket (remote: R2 error 10007 NoSuchKey).
const MISSING = /does not exist|NoSuchKey|10007/i;

export function createWranglerR2Client(opts: WranglerR2Options): R2Client {
  const run =
    opts.run ??
    ((bin, args) =>
      execFileAsync(bin, args, {
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      }));
  const target = opts.local ? ['--local', '--persist-to', opts.local.persistTo] : ['--remote'];

  return {
    async exists(hashedKey) {
      try {
        // --pipe: the body goes to stdout (discarded), nothing is written to disk
        await run(opts.wranglerBin, [
          'r2',
          'object',
          'get',
          `${opts.bucket}/${hashedKey}`,
          '--pipe',
          ...target,
        ]);
        return true;
      } catch (err) {
        const text = `${(err as { stderr?: string }).stderr ?? ''}${(err as { stdout?: string }).stdout ?? ''}${(err as Error).message}`;
        if (MISSING.test(text)) return false;
        // auth / network / unknown bucket: stop here instead of re-uploading blindly
        throw new Error(`wrangler r2 object get failed: ${firstLine(text)}`);
      }
    },
    async put(file: AssetFile, meta) {
      try {
        await run(opts.wranglerBin, [
          'r2',
          'object',
          'put',
          `${opts.bucket}/${file.hashedKey}`,
          '--file',
          file.absPath,
          '--content-type',
          meta.contentType,
          '--cache-control',
          meta.cacheControl,
          ...target,
        ]);
      } catch (err) {
        const text = `${(err as { stderr?: string }).stderr ?? ''}${(err as Error).message}`;
        throw new Error(`wrangler r2 object put failed: ${firstLine(text)}`);
      }
    },
  };
}

function firstLine(text: string): string {
  // wrangler output is colourised and may start with warnings or echo the command line: keep the first
  // line that carries the actual error, at most 300 chars (never a secret: auth comes from env, not argv)
  const plain = stripVTControlCharacters(text);
  const lines = plain
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Command failed') && !/WARNING\]/.test(l));
  return (
    lines.find((l) => /error|fail|denied|authenticat|token/i.test(l)) ??
    lines[0] ??
    'unknown error'
  ).slice(0, 300);
}
