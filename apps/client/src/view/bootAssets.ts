/** Required asset keys that failed to load (Phaser still completes preload when a file 404s). */
export function failedRequiredAssets(
  failedKeys: ReadonlySet<string>,
  required: readonly string[],
): string[] {
  return required.filter((key) => failedKeys.has(key));
}

export interface BootState {
  /** Set when the manifest / base URL / an asset name was rejected (message ready to show). */
  bootError: string | null;
  /** True when assets come from a bucket, i.e. manifest.json has to be fetched and parsed first. */
  usesManifest: boolean;
  /** True once manifest.json was fetched and parsed successfully. */
  manifestReady: boolean;
  failedKeys: ReadonlySet<string>;
  required: readonly string[];
}

/**
 * Why the boot must stop (empty = continue to Lobby). In bucket mode a manifest that never became ready is a failure
 * even if the loader reported nothing: a missing `manifest.json` can come back as `index.html` with status 200 (SPA
 * fallback), which is not a failed file. Phaser also completes preload when a file 404s.
 */
export function bootFailures(state: BootState): string[] {
  if (state.bootError) return [state.bootError];
  if (state.usesManifest && !state.manifestReady) {
    return ['manifest.json is missing or could not be loaded'];
  }
  return failedRequiredAssets(state.failedKeys, state.required);
}
