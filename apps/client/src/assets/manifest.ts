/**
 * Asset manifest (CAR-3789 / BE-37 / FE-16). CI hashes every file in `public/`, uploads it to R2 and
 * writes `manifest.json`: a flat `{ "<logical name>": "<name in the bucket>" }` object (format in
 * `scripts/README.md`). Game code only knows logical names (`tiles/tileset.png`); this module turns
 * them into URLs. The base URL of the bucket is not in the manifest, it comes from `VITE_ASSETS_BASE_URL`.
 *
 * Pure (no Phaser, no DOM) so it is unit-tested; `BootScene` only calls it.
 */

export type AssetManifest = Readonly<Record<string, string>>;
/** logical name -> URL to hand to the Phaser loader. Throws `AssetNotFoundError` for an unknown name. */
export type ResolveAsset = (logicalName: string) => string;

export class ManifestError extends Error {
  override name = 'ManifestError';
}

export class AssetNotFoundError extends Error {
  override name = 'AssetNotFoundError';
  constructor(readonly logicalName: string) {
    super(`asset "${logicalName}" is not in manifest.json (a code name that CI did not publish)`);
  }
}

/** A value is a path inside the bucket: no scheme, no leading slash, no `..`, so a manifest can never point off the bucket. */
const BUCKET_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

function isBucketPath(value: string): boolean {
  return BUCKET_PATH.test(value) && !value.split('/').includes('..');
}

/**
 * Parses the raw text of a fetched `manifest.json`. The text is parsed here (not by the Phaser JSON loader)
 * because a host with an SPA fallback answers a missing manifest with `index.html` and status 200: the loader
 * would throw from inside its XHR handler and never report a failed file. Here that is an ordinary `ManifestError`.
 */
export function parseManifestText(text: unknown): AssetManifest {
  if (typeof text !== 'string') throw new ManifestError('manifest.json could not be read');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ManifestError(
      'manifest.json is not valid JSON (missing, or the host answered with a page)',
    );
  }
  return parseManifest(json);
}

/** Checks the shape of a fetched `manifest.json`. An empty object is valid (CI writes `{}` when there is nothing to upload). */
export function parseManifest(json: unknown): AssetManifest {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ManifestError('manifest.json is not a JSON object');
  }
  const manifest: Record<string, string> = {};
  for (const [name, value] of Object.entries(json)) {
    if (typeof value !== 'string' || !isBucketPath(value)) {
      throw new ManifestError(`manifest.json: bad value for "${name}"`);
    }
    manifest[name] = value;
  }
  return manifest;
}

/**
 * The public base URL of the asset bucket from the build env. Empty / unset = `null` = no bucket:
 * files are loaded by their plain names from the same origin (dev, `?mock=1`, a build before the
 * deploy sets the variable). A set value must be an absolute http(s) URL.
 */
export function normalizeBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ManifestError(`VITE_ASSETS_BASE_URL is not a URL: "${trimmed}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ManifestError('VITE_ASSETS_BASE_URL must be an http(s) URL');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ManifestError('VITE_ASSETS_BASE_URL must not have a query or fragment');
  }
  return trimmed.replace(/\/+$/, '');
}

/** `<baseUrl>/<name in the bucket>` for every logical name; an unknown name is an error, never a guess. */
export function createResolver(manifest: AssetManifest, baseUrl: string): ResolveAsset {
  const base = baseUrl.replace(/\/+$/, '');
  return (logicalName) => {
    const hashed = Object.hasOwn(manifest, logicalName) ? manifest[logicalName] : undefined;
    if (hashed === undefined) throw new AssetNotFoundError(logicalName);
    return `${base}/${hashed}`;
  };
}

/** No bucket: the logical name is the file name next to the page (the loader's `baseURL` does the rest). */
export const localResolver: ResolveAsset = (logicalName) => logicalName;
