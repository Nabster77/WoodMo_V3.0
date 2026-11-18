/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface WoodmoBuildInfo {
  /** „3.27“ = Version 3, zuletzt gemergter PR #27. Ältere version.json haben das Feld nicht. */
  version?: string;
  commit: string;
  builtAt: string;
  title: string;
  notes: string[];
}
declare const __WOODMO_BUILD__: WoodmoBuildInfo;
