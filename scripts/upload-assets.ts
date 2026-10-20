// BE-37 / CAR-3789: hash assets/, upload what the bucket does not have, write manifest.json.
//
//   node scripts/upload-assets.ts sync   --bucket <name> [--src apps/client/assets]
//                                        [--out apps/client/dist/manifest.json] [--dry-run]
//   node scripts/upload-assets.ts verify --manifest <file> --base-url <https://...> --origin <https://...>
//
// Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment for the real (remote) run.
// Offline check of the whole flow: add --local --persist-to <dir> (wrangler's R2 simulator).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildManifest, type Manifest, scanAssets, serializeManifest } from './lib/assets.ts';
import { createWranglerR2Client } from './lib/r2-wrangler.ts';
import { syncAssets } from './lib/sync.ts';
import { verifyPublicAssets } from './lib/verify.ts';

const root = resolve(import.meta.dirname, '..');
const log = (line: string) => console.log(line);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    bucket: { type: 'string' },
    src: { type: 'string', default: resolve(root, 'apps/client/assets') },
    out: { type: 'string', default: resolve(root, 'apps/client/dist/manifest.json') },
    'dry-run': { type: 'boolean', default: false },
    local: { type: 'boolean', default: false },
    'persist-to': { type: 'string' },
    wrangler: { type: 'string', default: resolve(root, 'apps/worker/node_modules/.bin/wrangler') },
    concurrency: { type: 'string', default: '4' },
    manifest: { type: 'string' },
    'base-url': { type: 'string' },
    origin: { type: 'string' },
  },
});

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function sync(): Promise<void> {
  const dryRun = values['dry-run'];
  const bucket = need('bucket', values.bucket);
  const { files, skipped } = await scanAssets(resolve(values.src));
  for (const s of skipped) log(`ignored  ${s} (extension not in the upload allow-list)`);
  log(`found ${files.length} asset(s) in ${values.src}`);

  const client = createWranglerR2Client({
    wranglerBin: values.wrangler,
    bucket,
    local: values.local ? { persistTo: need('persist-to', values['persist-to']) } : undefined,
  });
  const result = await syncAssets({
    files,
    client,
    dryRun,
    concurrency: Number.parseInt(values.concurrency, 10) || 4,
    log,
  });
  log(
    dryRun
      ? `dry run: ${result.uploaded.length} file(s) would be uploaded to ${bucket} (nothing was sent)`
      : `uploaded ${result.uploaded.length} file(s), ${result.skipped.length} already in ${bucket}`,
  );
  if (dryRun) return; // a dry run must not leave a manifest that points at files nobody uploaded

  // Written only after every upload succeeded; temp file + rename so a crash never leaves half a file.
  const out = resolve(values.out);
  await mkdir(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  await writeFile(tmp, serializeManifest(buildManifest(files)));
  await rename(tmp, out);
  log(`wrote ${out}`);
}

async function verify(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(resolve(need('manifest', values.manifest)), 'utf8'),
  ) as Manifest;
  await verifyPublicAssets({
    manifest,
    baseUrl: need('base-url', values['base-url']),
    origin: need('origin', values.origin),
    log,
  });
}

try {
  const command = positionals[0];
  if (command === 'sync') await sync();
  else if (command === 'verify') await verify();
  else
    throw new Error(
      'usage: upload-assets.ts <sync|verify> [options] (see the header of this file)',
    );
} catch (err) {
  console.error(`::error::${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  if (err instanceof Error && err.message.includes('\n')) console.error(err.message);
  process.exitCode = 1;
}
