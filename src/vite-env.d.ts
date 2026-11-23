/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Link to this deployment's privacy notice (Settings page). Defaults to the template in the repo. */
  readonly VITE_PRIVACY_URL?: string
  /** VAPID public key for web push (base64url). Without it the notification prompts are hidden. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare const __BUILD__: string
