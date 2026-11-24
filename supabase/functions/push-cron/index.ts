// Called every 15 minutes by pg_cron (public.push_cron_tick). For every household with a subscribed device it:
//   1. sends list-change windows older than 30 s that push-list's own timer did not get to,
//   2. refreshes the to-buy baseline (time moves the list too),
//   3. sends each member's daily expiry reminder when their chosen time has come.
import { adminClient, hasWebhookSecret, loadHousehold, loadMembers, sendPush } from '../_shared/push.ts'
import { reply } from '../_shared/http.ts'
import { runCheckins } from '../_shared/checkin.ts'
import { flushList } from '../_shared/list.ts'
import { expiringForReminder, expiryPush, reminderDue } from '../../../src/lib/notify.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  if (!hasWebhookSecret(req)) return reply(401, { error: 'Unauthorized' })
  // `now` is only for testing the schedule by hand (the caller already holds the secret).
  const body = await req.json().catch(() => ({})) as { now?: string }
  const now = body.now ? new Date(body.now) : new Date()

  const admin = adminClient()
  const { data: subs, error } = await admin.from('push_subscriptions').select('user_id')
  if (error) return reply(500, { error: 'failed' })
  const { data: mem } = await admin.from('household_members').select('household_id').in('user_id', [...new Set((subs ?? []).map((s) => s.user_id))])
  const households = [...new Set((mem ?? []).map((m) => m.household_id))]
  // Check-ins (ADR 0005) exist whether or not anyone has push on, so also visit households with a meal today or yesterday
  // (a day either side of UTC covers every timezone).
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10)
  const { data: recent } = await admin.from('planned_meals').select('household_id').is('deleted_at', null).eq('not_cooked', false)
    .gte('date', day(-2)).lte('date', day(1))
  const withMeals = [...new Set((recent ?? []).map((m) => m.household_id))]
  const visit = [...new Set([...households, ...withMeals])]

  const report: unknown[] = []
  for (const hid of visit) {
    const subscribed = households.includes(hid)
    try {
      if (!subscribed) {
        const hh = await loadHousehold(admin, hid, now)
        const checkins = await runCheckins(admin, hh, await loadMembers(admin, hid), now)
        if (checkins.length) report.push({ household: hid, checkins })
        continue
      }
      const swept = await flushList(admin, hid)
      const hh = await loadHousehold(admin, hid, now)
      const members = await loadMembers(admin, hid)
      await admin.rpc('push_list_refresh', { hid, keys: hh.keys() })

      const reminders: unknown[] = []
      for (const m of members) {
        if (!reminderDue(now, hh.tz, m.expiry_time, m.expiry_checked_on)) continue
        const items = expiringForReminder(hh.events, hh.remaining(), hh.names, hh.today, hh.reminderDays)
        const push = expiryPush(items, hh.today)
        const result = push ? await sendPush(admin, [m.user_id], push) : null
        // Handled for today unless every device failed for a reason that may pass (then the next tick retries).
        const retry = !!result && result.sent === 0 && result.failed > 0
        if (!retry) await admin.from('push_prefs').upsert({ user_id: m.user_id, expiry_checked_on: hh.today }, { onConflict: 'user_id' })
        reminders.push({ user: m.user_id, items: items.length, result, retry })
      }
      const checkins = await runCheckins(admin, hh, members, now)
      report.push({ household: hid, swept, reminders, checkins })
    } catch (e) {
      console.error('push-cron household failed', hid, e)
      report.push({ household: hid, error: String(e) })
    }
  }
  return reply(200, { at: now.toISOString(), report })
})
