import { createClient } from '@supabase/supabase-js'

// A local stack URL means "the machine serving this page", so a phone on the LAN reaches the laptop.
const url = new URL(import.meta.env.VITE_SUPABASE_URL)
if (['127.0.0.1', 'localhost'].includes(url.hostname)) url.hostname = window.location.hostname

export const supabase = createClient(url.origin, import.meta.env.VITE_SUPABASE_ANON_KEY)
