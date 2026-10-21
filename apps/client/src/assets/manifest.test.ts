import { describe, expect, it } from 'vitest';
import {
  AssetNotFoundError,
  createResolver,
  localResolver,
  ManifestError,
  normalizeBaseUrl,
  parseManifest,
  parseManifestText,
} from './manifest';

/** `tiles/tileset.png` -> `tiles/tileset.<hash>.png`, built here so no hashed file name sits in the source text. */
function hashed(name: string, hash = 'a1b2c3d4e5'): string {
  const dot = name.lastIndexOf('.');
  return `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
}

describe('parseManifest', () => {
  it('accepts the flat logical -> hashed object CI writes', () => {
    const json = { 'tiles/tileset.png': hashed('tiles/tileset.png') };
    expect(parseManifest(json)).toEqual(json);
  });

  it('accepts an empty object (CI writes {} when there is nothing to upload)', () => {
    expect(parseManifest({})).toEqual({});
  });

  it.each([null, undefined, 'x', 5, ['a']])('rejects %j (not an object)', (json) => {
    expect(() => parseManifest(json)).toThrow(ManifestError);
  });

  it('rejects a value that is not a string', () => {
    expect(() => parseManifest({ 'a.png': 1 })).toThrow(/bad value for "a.png"/);
  });

  it.each([
    'https://evil.example/a.png',
    '//evil.example/a.png',
    '/a.png',
    '../a.png',
    'x/../../a.png',
    'a b.png',
    '',
  ])('rejects value %j (must stay inside the bucket)', (value) => {
    expect(() => parseManifest({ 'a.png': value })).toThrow(ManifestError);
  });
});

describe('parseManifestText', () => {
  it('parses the text of a manifest', () => {
    const json = { 'tiles/tileset.png': hashed('tiles/tileset.png') };
    expect(parseManifestText(JSON.stringify(json))).toEqual(json);
  });

  it('rejects the index.html an SPA fallback returns for a missing manifest.json', () => {
    expect(() => parseManifestText('<!doctype html><html><body></body></html>')).toThrow(
      ManifestError,
    );
    expect(() => parseManifestText('<!doctype html><html></html>')).toThrow(/manifest\.json/);
  });

  it.each(['', '   ', '{', undefined, null, 5])('rejects %j (not JSON text)', (text) => {
    expect(() => parseManifestText(text)).toThrow(ManifestError);
  });

  it('still checks the shape after parsing', () => {
    expect(() => parseManifestText('[]')).toThrow(/not a JSON object/);
    expect(() => parseManifestText('{"a.png":"https://evil.example/a.png"}')).toThrow(/bad value/);
  });
});

describe('normalizeBaseUrl', () => {
  it.each([undefined, '', '   '])('%j means no bucket', (raw) => {
    expect(normalizeBaseUrl(raw)).toBeNull();
  });

  it('strips trailing slashes and keeps a path prefix', () => {
    expect(normalizeBaseUrl('https://pub-1.r2.dev/')).toBe('https://pub-1.r2.dev');
    expect(normalizeBaseUrl(' https://cdn.example/assets// ')).toBe('https://cdn.example/assets');
  });

  it.each([
    'pub-1.r2.dev',
    'ftp://x.example',
    'javascript:alert(1)',
    'https://x.example/?a=1',
    'https://x.example/#a',
  ])('rejects %j', (raw) => {
    expect(() => normalizeBaseUrl(raw)).toThrow(ManifestError);
  });
});

describe('createResolver', () => {
  const manifest = parseManifest({
    'tiles/tileset.png': hashed('tiles/tileset.png'),
    'audio/bomb-place.ogg': hashed('audio/bomb-place.ogg', 'ffffffffff'),
  });

  it('returns <base>/<hashed name>', () => {
    const resolve = createResolver(manifest, 'https://pub-1.r2.dev');
    expect(resolve('tiles/tileset.png')).toBe(
      `https://pub-1.r2.dev/${hashed('tiles/tileset.png')}`,
    );
    expect(resolve('audio/bomb-place.ogg')).toBe(
      `https://pub-1.r2.dev/${hashed('audio/bomb-place.ogg', 'ffffffffff')}`,
    );
  });

  it('does not double the slash of a base with a trailing slash', () => {
    const resolve = createResolver(manifest, 'https://pub-1.r2.dev/');
    expect(resolve('tiles/tileset.png').startsWith('https://pub-1.r2.dev/tiles/')).toBe(true);
  });

  it('throws a clear error naming the key when it is not in the manifest', () => {
    const resolve = createResolver(manifest, 'https://pub-1.r2.dev');
    expect(() => resolve('maps/arena.json')).toThrow(AssetNotFoundError);
    expect(() => resolve('maps/arena.json')).toThrow(/"maps\/arena.json" is not in manifest.json/);
  });

  it('does not treat inherited object keys as assets', () => {
    const resolve = createResolver(manifest, 'https://pub-1.r2.dev');
    expect(() => resolve('toString')).toThrow(AssetNotFoundError);
    expect(() => resolve('__proto__')).toThrow(AssetNotFoundError);
  });

  it('does not guess a file name for an unknown key', () => {
    const resolve = createResolver({}, 'https://pub-1.r2.dev');
    expect(() => resolve('tiles/tileset.png')).toThrow(AssetNotFoundError);
  });
});

describe('localResolver', () => {
  it('maps a logical name to itself (the loader baseURL makes it a same-origin URL)', () => {
    expect(localResolver('tiles/tileset.png')).toBe('tiles/tileset.png');
  });
});
