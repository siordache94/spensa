// "Cooked as planned" tapped on a check-in notification: answers with the signed token that came in the push
// (src/lib/checkinToken.ts), so the service worker needs no session. It can only answer 'planned', for the person
// the token was issued to, on one meal, and only while the token lives. Replies with the household's unread count.
import { adminClient } from '../_shared/push.ts'
import { cors, reply } from '../_shared/http.ts'
import { verifyCheckinToken } from '../../../src/lib/checkinToken.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  const body = await req.json().catch(() => null) as { meal_id?: unknown; token?: unknown } | null
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
  if (!body || typeof body.meal_id !== 'string' || typeof body.token !== 'string' || secret.length < 16) return reply(400, { error: 'Bad request' })
  const user = await verifyCheckinToken(secret, body.token, body.meal_id)
  if (!user) return reply(401, { error: 'Invalid or expired token' })
  const { data, error } = await adminClient().rpc('checkin_answer_as', { p_user: user, p_meal: body.meal_id })
  if (error) { console.error('checkin-answer failed', error.message); return reply(500, { error: 'failed' }) }
  if (data === null) return reply(404, { error: 'Not found' })
  return reply(200, { unread: data })
})
