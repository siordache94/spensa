// Permanently deletes the calling user's account.
// Why an edge function: auth.admin.deleteUser needs the service-role key, which must never reach
// the browser. The data purge itself is plain SQL (public.purge_user), so it is covered by
// supabase/tests/gdpr_smoke.sql; this function only authenticates the caller and orders the steps.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cors, reply } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'Not signed in' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The user comes from the verified token, never from the request body.
  const { data, error: authError } = await admin.auth.getUser(token)
  if (authError || !data.user) return reply(401, { error: 'Not signed in' })
  const uid = data.user.id

  const { error: purgeError } = await admin.rpc('purge_user', { uid })
  if (purgeError) {
    console.error('purge_user failed', purgeError)
    return reply(500, { error: 'Could not delete your data. Nothing was removed from your account; try again.' })
  }
  // Hard delete: auth.users cascades to identities/sessions, and the authorship FKs set null.
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid, false)
  if (deleteError) {
    console.error('deleteUser failed', deleteError)
    return reply(500, { error: 'Your data was removed but the account was not. Try again.' })
  }
  return reply(200, { deleted: true })
})
