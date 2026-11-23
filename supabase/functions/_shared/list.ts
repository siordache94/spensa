// The end of a list-change window: diff the list against the window's baseline and push the partner.
import { listChangePush, listRecipients } from '../../../src/lib/notify.ts'
import { loadHousehold, loadMembers, sendPush, type Admin, type SendResult } from './push.ts'

export type FlushResult = { flushed: false } | { flushed: true; message: string | null; recipients: string[]; result?: SendResult }

/** Closes the household's window if it is at least 30 s old (a no-op otherwise, or if another call got there first). */
export async function flushList(admin: Admin, hid: string): Promise<FlushResult> {
  const { data, error } = await admin.rpc('push_list_take', { hid })
  if (error) throw new Error(error.message)
  const win = (data as { window_keys: string[]; authors: string[] }[] | null)?.[0]
  if (!win) return { flushed: false }

  const [hh, members] = await Promise.all([loadHousehold(admin, hid), loadMembers(admin, hid)])
  const keys = hh.keys()
  await admin.rpc('push_list_refresh', { hid, keys })

  const author = members.find((m) => m.user_id === win.authors[0])
  const push = listChangePush(author?.display_name?.trim() || 'Your partner', win.window_keys, keys, hh.resolved())
  const recipients = listRecipients(members.map((m) => m.user_id), win.authors)
    .filter((u) => members.find((m) => m.user_id === u)?.list_changes)
  if (!push || recipients.length === 0) return { flushed: true, message: push?.body ?? null, recipients }
  return { flushed: true, message: push.body, recipients, result: await sendPush(admin, recipients, push) }
}
