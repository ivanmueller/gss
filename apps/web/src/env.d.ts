interface ImportMetaEnv {
  /** Supabase project URL. Public; set at build time. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key. Public by design; access is enforced by the API. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Mapbox public token (pk.), restricted to the app's addresses in Mapbox; set at build time. */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
