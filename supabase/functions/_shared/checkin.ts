// Meal check-ins (ADR 0005), run by push-cron every tick for every household with a meal today or yesterday:
// create the check-in once per short meal when it is due (so the in-app unread exists even with push off),
// then push it, silent, to the cook or to everyone, to those who have the switch on.
import { checkinDueAt, checkinPush, checkinRecipients, dueCheckins } from '../../../src/lib/checkin.ts'
import { signCheckinToken } from '../../../src/lib/checkinToken.ts'
import { addDays } from '../../../src/domain/replay.ts'
import { sendPush, type Admin, type HouseholdData, type Member, type SendResult } from './push.ts'

export type CheckinReport = { meal: string; created: boolean; recipients: string[]; result?: SendResult; payload?: unknown }

/** Where the service worker posts "Cooked as planned": an override for a different public URL, else the one the database calls. */
async function answerUrl(admin: Admin): Promise<string | null> {
  const env = Deno.env.get('CHECKIN_ANSWER_URL')
  if (env) return env
  const { data } = await admin.from('push_config').select('functions_url').maybeSingle()
  return data?.functions_url ? `${data.functions_url}/checkin-answer` : null
}

export async function runCheckins(admin: Admin, hh: HouseholdData, members: Member[], now: Date): Promise<CheckinReport[]> {
  const recent = hh.checkinMeals.filter((m) => m.date === hh.today || m.date === addDays(hh.today, -1))
  if (recent.length === 0) return []
  // Cheap exits first: nothing is due before the earliest slot end, and the replay is only needed for what is due.
  if (!recent.some((m) => now >= checkinDueAt(m.date, m.slot, hh.slotEndTimes, hh.tz))) return []

  // includes soft-deleted rows (the service role sees them), so a meal that was deleted and restored is not re-announced
  const { data: have, error } = await admin.from('meal_checkins').select('planned_meal_id').in('planned_meal_id', recent.map((m) => m.id))
  if (error) throw new Error(error.message)
  const due = dueCheckins({
    now, timeZone: hh.tz, meals: recent, endTimes: hh.slotEndTimes, shortMealIds: hh.shortMealIds(),
    existing: new Set((have ?? []).map((r) => r.planned_meal_id)),
  })
  if (due.length === 0) return []

  const { data: made, error: e2 } = await admin.rpc('checkin_create', { hid: hh.id, meal_ids: due.map((m) => m.id) })
  if (e2) throw new Error(e2.message)
  const created = new Set(made as string[])
  const { data: unread } = await admin.rpc('checkin_unread_count', { hid: hh.id })
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
  const url = await answerUrl(admin)

  const report: CheckinReport[] = []
  for (const m of due) {
    if (!created.has(m.id)) continue // another tick got there first
    const recipients = checkinRecipients(m.cookId, members.map((x) => x.user_id)).filter((u) => members.find((x) => x.user_id === u)?.meal_checkins)
    const entry: CheckinReport = { meal: m.id, created: true, recipients, payload: checkinPush(m, (unread as number) ?? 1) } // no token: the report ends up in net._http_response
    try {
      const results = await Promise.all(recipients.map(async (u) => {
        const payload = checkinPush(m, (unread as number) ?? 1)
        if (url && secret.length >= 16) payload.answer = { url, token: await signCheckinToken(secret, u, m.id, now) }
        return sendPush(admin, [u], payload)
      }))
      entry.result = results.reduce((a, r) => ({ sent: a.sent + r.sent, gone: a.gone + r.gone, failed: a.failed + r.failed }), { sent: 0, gone: 0, failed: 0 })
    } catch (e) {
      console.error('check-in push failed', m.id, e) // the check-in exists; it is still unread in the app
    }
    report.push(entry)
  }
  return report
}
