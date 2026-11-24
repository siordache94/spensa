// The "Meal end times" form on Settings: one 'HH:MM' per slot, edited together and saved in one go. Pure, so the
// form's rules (every slot valid, Save only when something changed, save every slot) are testable in Node.
import { isEndTime, type SlotEndTimes } from './checkin.ts'

/** What React hands `onChange` while the event is being dispatched. */
export type SlotTimeChangeEvent = { currentTarget: { value: string } }
export type SlotTimeUpdater = (times: SlotEndTimes) => SlotEndTimes

/** The form opens on the resolved times, so a slot with no stored value shows its default instead of an empty field. */
export const initialSlotTimes = (resolved: SlotEndTimes): SlotEndTimes => ({ ...resolved })

/**
 * The state updater for one field edit. The value is read now, not inside the updater: React may run a state
 * updater in a later render, when the change event has been released and `e.currentTarget` is null, and reading
 * it then throws "Cannot read properties of null (reading 'value')" (React 19 unmounts the whole app for that).
 */
export function slotTimeEdit(event: SlotTimeChangeEvent, slot: string): SlotTimeUpdater {
  const value = event.currentTarget.value
  return (times) => ({ ...times, [slot]: value })
}

/** Save is allowed only when every slot reads as 'HH:MM'. */
export const slotTimesValid = (slots: string[], times: SlotEndTimes): boolean =>
  slots.every((s) => isEndTime(times[s] ?? ''))

/** ...and something changed from what the server has. */
export const slotTimesChanged = (slots: string[], times: SlotEndTimes, saved: SlotEndTimes): boolean =>
  slots.some((s) => times[s] !== saved[s])

/** Save sends every slot (not only the edited ones), so the stored JSONB never depends on which fields were touched. */
export const slotTimesPayload = (slots: string[], times: SlotEndTimes): SlotEndTimes =>
  Object.fromEntries(slots.map((s) => [s, times[s]]))
