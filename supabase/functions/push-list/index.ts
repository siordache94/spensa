// Called by the database (pg_net, trigger on household_events) after a household write.
// If the write changed the to-buy list it opens a 30-second window; when the window ends the combined change
// is pushed to the other member(s). Design and trade-offs: docs/adr/0004-web-push.md.
import { adminClient, hasWebhookSecret, reply } from '../_shared/push.ts'
import { loadHousehold } from '../_shared/push.ts'
import { flushList } from '../_shared/list.ts'
import { LIST_WINDOW_SECONDS } from '../../../src/lib/notify.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  if (!hasWebhookSecret(req)) return reply(401, { error: 'Unauthorized' })
  const body = await req.json().catch(() => null) as { household_id?: string; by?: string | null } | null
  if (!body?.household_id) return reply(400, { error: 'household_id required' })

  const admin = adminClient()
  try {
    const hid = body.household_id
    const keys = (await loadHousehold(admin, hid)).keys()
    // Generated RPC arg types omit null; the function takes null for "no author".
    const by = (body.by ?? null) as string
    const { data: opened, error } = await admin.rpc('push_list_observe', { hid, by, keys })
    if (error) throw new Error(error.message)
    if (opened) {
      // Keep the worker alive for the window, then send. If this is lost (restart), push-cron's sweep sends it.
      EdgeRuntime.waitUntil(
        new Promise((r) => setTimeout(r, (LIST_WINDOW_SECONDS + 1) * 1000))
          .then(() => flushList(admin, hid))
          .then((r) => console.log('push-list flush', JSON.stringify(r)))
          .catch((e) => console.error('push-list flush failed', e)),
      )
    }
    return reply(202, { windowOpened: !!opened })
  } catch (e) {
    console.error('push-list failed', e)
    return reply(500, { error: 'failed' })
  }
})
