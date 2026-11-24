import { describe, expect, it } from 'vitest'
import { initialSlotTimes, slotTimeEdit, slotTimesChanged, slotTimesPayload, slotTimesValid, type SlotTimeChangeEvent } from './slotTimesForm'

const saved = { lunch: '14:00', dinner: '21:30' }

describe('meal end times form', () => {
  it('edits both slots before saving, even when React runs the updaters after the event is gone', () => {
    // React may run a setState updater in a later render, when the change event has been released and
    // e.currentTarget is null: reading it then throws "Cannot read properties of null (reading 'value')" and
    // unmounts the app. The updater must therefore carry the value read during dispatch, not the event.
    const event: { currentTarget: { value: string } | null } = { currentTarget: { value: '13:15' } }
    const lunch = slotTimeEdit(event as SlotTimeChangeEvent, 'lunch')
    event.currentTarget = { value: '20:45' }
    const dinner = slotTimeEdit(event as SlotTimeChangeEvent, 'dinner')
    event.currentTarget = null // what React does once dispatch returns

    const times = [lunch, dinner].reduce((t, edit) => edit(t), initialSlotTimes(saved))

    expect(times).toEqual({ lunch: '13:15', dinner: '20:45' })
    expect(slotTimesValid(['lunch', 'dinner'], times)).toBe(true)
    expect(slotTimesChanged(['lunch', 'dinner'], times, saved)).toBe(true)
    expect(slotTimesPayload(['lunch', 'dinner'], times)).toEqual({ lunch: '13:15', dinner: '20:45' })
  })

  it('opens on the resolved times without aliasing the server object', () => {
    const times = initialSlotTimes(saved)
    expect(times).toEqual(saved)
    const edited = slotTimeEdit({ currentTarget: { value: '12:00' } }, 'lunch')(times)
    expect(times).toEqual(saved)
    expect(edited).toEqual({ lunch: '12:00', dinner: '21:30' })
  })

  it('Save sends every slot, including the ones that did not change', () => {
    const times = slotTimeEdit({ currentTarget: { value: '20:45' } }, 'dinner')(initialSlotTimes(saved))
    expect(slotTimesPayload(['lunch', 'dinner'], times)).toEqual({ lunch: '14:00', dinner: '20:45' })
  })

  it('is unchanged only when every slot matches the stored value, and invalid for a bad time', () => {
    expect(slotTimesChanged(['lunch', 'dinner'], saved, saved)).toBe(false)
    expect(slotTimesChanged(['lunch', 'dinner'], { ...saved, lunch: '13:15' }, saved)).toBe(true)
    expect(slotTimesValid(['lunch', 'dinner'], { lunch: '25:00', dinner: '' })).toBe(false)
    expect(slotTimesValid(['lunch', 'dinner'], { lunch: '13:15' })).toBe(false) // a missing slot has no time
  })
})
