interface ImportMetaEnv {
  /** Supabase project URL. Public; set at build time. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key. Public by design; access is enforced by the API. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
