// "Send me a test notification" in Settings: pushes to the caller's own devices only.
import { adminClient, sendPush } from '../_shared/push.ts'
import { cors, reply } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'Not signed in' })
  const admin = adminClient()
  // The user comes from the verified token, never from the request body.
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return reply(401, { error: 'Not signed in' })

  try {
    const result = await sendPush(admin, [data.user.id], {
      title: 'Spensa', body: 'Notifications work. This is a test.', kind: 'test', url: '/settings',
    })
    if (result.sent + result.gone + result.failed === 0) return reply(404, { error: 'No device is subscribed. Turn notifications on first.' })
    return reply(200, result)
  } catch (e) {
    console.error('push-test failed', e)
    return reply(500, { error: 'Could not send the test notification.' })
  }
})
