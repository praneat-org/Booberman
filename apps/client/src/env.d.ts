interface ImportMetaEnv {
  /** Public base URL of the R2 asset bucket (set by the deploy build). Empty = load assets from the same origin. */
  readonly VITE_ASSETS_BASE_URL?: string;
}
