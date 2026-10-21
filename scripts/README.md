# scripts: asset upload (BE-37 / CAR-3789)

CI hashes the game files in `apps/client/public/` (the same paths the client loads), uploads the ones the R2 bucket does not have yet, and writes
`manifest.json` into the client build (`apps/client/dist/manifest.json`, served by the Worker's static assets).

## manifest.json (the contract for FE-16 / BootScene)

Flat JSON object, **logical name -> name in the bucket**. Keys are paths relative to `apps/client/public/`
with `/`, sorted; values are the same path with a content hash before the last extension:

```json
{
  "audio/bomb-place.ogg": "audio/bomb-place.b8bd6fa216.ogg",
  "tiles/tileset.png": "tiles/tileset.3f0aadd166.png"
}
```

- Hash = first 10 hex chars of the sha256 of the file. Same bytes = same name, so it never needs to be purged.
- The file URL is `<public base URL of the bucket>/<value>`. The base URL is **not** in the manifest (the
  format is fixed by CAR-3789); the client gets it from its own config (FE-16 decides how).
- Game code only knows logical names (`tiles/tileset.png`) and looks them up here. A name that is not a key
  is a bug: fail loudly, do not fall back to guessing a file name.
- Load images with `crossOrigin = 'anonymous'`: the bucket answers CORS only for the game origins listed in
  `r2-cors.<env>.json` (GET / HEAD).
- Only these extensions are uploaded: png jpg jpeg gif webp svg ogg mp3 wav json. Anything else in `public/`
  (e.g. `_headers`, `LICENSE.txt`) is ignored and logged.

## Headers

| What | Where it is set | Value |
| --- | --- | --- |
| R2 objects (hashed names) | `wrangler r2 object put --cache-control` | `public, max-age=31536000, immutable` |
| `manifest.json` | Workers Static Assets `_headers` rule `/*` (not in R2) | `no-cache`, so a new deploy reaches players |
| CORS | `r2-cors.dev.json` / `r2-cors.production.json`, applied by the deploy workflows | GET, HEAD from the game origin(s) only, no `*` |

## Commands

```sh
# what would be uploaded (no network, no manifest written)
node scripts/upload-assets.ts sync --bucket booberman-assets-dev --dry-run

# real run (CI does this): needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
node scripts/upload-assets.ts sync --bucket booberman-assets-dev

# whole flow offline against wrangler's local R2 simulator
node scripts/upload-assets.ts sync --bucket x --local --persist-to /tmp/r2-local --out /tmp/manifest.json

# what a browser sees (HEAD every file with an Origin header; retries a few times for edge propagation)
node scripts/upload-assets.ts verify --manifest apps/client/dist/manifest.json \
  --base-url https://<public-url-of-the-bucket> --origin https://booberman-dev.miryn.workers.dev
```

Run 2 with unchanged assets prints `uploaded 0 file(s), N already in <bucket>`. `manifest.json` is written
only after every upload succeeded; any failure exits non-zero, which stops the deploy job.

## One-time setup (human, per env)

1. R2 buckets `booberman-assets-dev` and `booberman-assets`; make each publicly readable (r2.dev URL or a custom domain).
2. API token with **R2 edit** on those buckets (bucket CORS needs it) in addition to Workers / KV / D1.
3. GitHub Environment variable `ASSETS_PUBLIC_URL` (not a secret) on `dev` and `production` = the public base URL.
4. Check the origin in `r2-cors.*.json` matches the real `*.workers.dev` URL (or the custom domain).
