// Household aggregate: the shared settings row (slots, horizon, expiry), the invite code, joining or creating a
// household, and the members. Pages import from here.
import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { defineCommand, invalidateKeys } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import type { HouseholdRow, HouseholdSettings, HouseholdUpdate, Member } from './port.ts'

export type { HouseholdRow, HouseholdSettings, HouseholdUpdate, Member }

export const memberLabel = (m: Member) => m.display_name ?? 'Someone'

/** The device's IANA zone, sent when creating a household and prefilled by "Use this device's zone". */
export const deviceTimeZone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone || undefined

// ---- Queries ---------------------------------------------------------------------------------------------------
/** Retry for the household row (and everything under it). */
export const refreshHousehold = (qc: QueryClient) => invalidateKeys(qc, [keys.household.all()])

/** The household row of the signed-in user. null = they have not joined or created one yet. */
export function useHouseholdRow() {
  const api = useApi()
  return useQuery({ queryKey: keys.household.row(), queryFn: () => api.household.current() })
}

/** Settings every member shares: they live on the household row and sync to both phones. */
export function useHouseholdSettings() {
  const api = useApi()
  return useQuery({ queryKey: keys.household.settings(), queryFn: () => api.household.settings() })
}

export function useMembers() {
  const api = useApi()
  return useQuery({ queryKey: keys.household.members(), queryFn: () => api.household.members() })
}

// ---- Commands --------------------------------------------------------------------------------------------------
/** Changes any of the shared settings (horizon, expiry, reminder, slots, timezone). */
export const updateHousehold = defineCommand<HouseholdUpdate>({
  name: 'household.update',
  run: (api, patch) => api.household.update(patch),
  // A new zone or new slots moves "today", the replay order, slot end times and check-in due times, so the
  // pantry and the unread check-ins go stale too (keys.household.all() also covers the settings and end times).
  invalidates: (patch) =>
    patch.timezone !== undefined || patch.slots !== undefined
      ? [keys.household.all(), keys.pantry.all(), keys.checkins.all()]
      : [keys.household.settings()],
})

/** The meal slots, in day order. Same-day meal order depends on them, hence the pantry too. */
export const saveSlots = defineCommand<{ slots: string[] }>({
  name: 'household.saveSlots',
  run: (api, { slots }) => api.household.update({ slots }),
  invalidates: () => [keys.household.settings(), keys.pantry.all()],
})

export const rotateInviteCode = defineCommand<void>({
  name: 'household.rotateInviteCode',
  run: (api) => api.household.rotateInviteCode(),
  invalidates: () => [keys.household.all()],
})

const joinFailure = (message: string) => (message.includes('invalid invite code') ? "That invite code doesn't match any household." : 'Something went wrong. Try again.')

export const createHousehold = defineCommand<{ name: string; displayName: string | undefined }>({
  name: 'household.create',
  run: async (api, { name, displayName }) => {
    try {
      await api.household.create(name, displayName, deviceTimeZone())
    } catch (e) {
      throw new Error(joinFailure((e as Error).message))
    }
  },
  invalidates: () => [keys.household.all()],
})

export const joinHousehold = defineCommand<{ code: string; displayName: string | undefined }>({
  name: 'household.join',
  run: async (api, { code, displayName }) => {
    try {
      await api.household.join(code, displayName)
    } catch (e) {
      throw new Error(joinFailure((e as Error).message))
    }
  },
  invalidates: () => [keys.household.all()],
})

/** Your own name in the household (shown as the cook). */
export const saveYourName = defineCommand<{ userId: string; displayName: string }>({
  name: 'household.setMemberName',
  run: (api, { userId, displayName }) => api.household.setMemberName(userId, displayName),
  invalidates: () => [keys.household.members()],
})
