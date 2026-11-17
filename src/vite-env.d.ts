/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface WoodmoBuildInfo {
  commit: string;
  builtAt: string;
  title: string;
  notes: string[];
}
declare const __WOODMO_BUILD__: WoodmoBuildInfo;
