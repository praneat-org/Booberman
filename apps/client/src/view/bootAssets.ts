/** Required asset keys that failed to load (Phaser still completes preload when a file 404s). */
export function failedRequiredAssets(
  failedKeys: ReadonlySet<string>,
  required: readonly string[],
): string[] {
  return required.filter((key) => failedKeys.has(key));
}
