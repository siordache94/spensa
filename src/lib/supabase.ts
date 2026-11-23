import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

function create(): SupabaseClient<Database> {
  // A local stack URL means "the machine serving this page", so a phone on the LAN reaches the laptop.
  const url = new URL(import.meta.env.VITE_SUPABASE_URL)
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) url.hostname = window.location.hostname
  return createClient<Database>(url.origin, import.meta.env.VITE_SUPABASE_ANON_KEY)
}

// Created on first use, not on import, so modules that merely import the Supabase adapter (every api/ module, via
// useApi's default) can be loaded in node tests without env vars or a window.
// Regenerate types after schema changes: npm run db:types
let client: SupabaseClient<Database> | undefined
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get: (_, prop) => Reflect.get((client ??= create()), prop),
})
