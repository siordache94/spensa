import { notifications } from '@mantine/notifications'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateKeys } from './api/command.ts'
import { keys } from './api/keys.ts'
import { localDay } from './api/pantry.ts'
import type { Buy, DataPort } from './api/port.ts'
import { markBought, restoreBought } from './shopList.ts'

// A purchase: becomes a batch, and marks the manual item it came from as bought (list -> cart -> pantry).
// An unsynced batch has no server time yet. It will be recorded after every existing snapshot, so sort it last.
const UNSYNCED = '9999-12-31T00:00:00Z'

export type { Buy }

export const SHOP_KEY = keys.mutations.shop()
export const BUY_KEY = keys.mutations.buy()
export const ON_HAND_KEY = keys.mutations.onHand()
export const CHECK_KEY = keys.mutations.check()
export const UNBUY_KEY = keys.mutations.unbuy()
export const UN_ON_HAND_KEY = keys.mutations.unOnHand()
export const UNCHECK_KEY = keys.mutations.uncheck()

type Pantry = {
  events: { batches: { id: string; ingredientId: string; qty: number; addedOn: string; addedAt: string; recordedAt: string; expiresOn: string | null }[] }
  domainIngredients: { id: string; onHand: boolean }[]
  ingredients: { id: string; on_hand: boolean }[]
  batchAuthors?: Record<string, string | null>
}
type Items = { id: string; checked: boolean; bought_batch_id?: string | null }[]
type Snapshot = [pantry: Pantry | undefined, items: Items | undefined]

/** Cancel in-flight fetches, apply `change` to both caches, and return the old values for rollback. */
async function optimistic(qc: QueryClient, change: (p: Pantry, items: Items | undefined) => [Pantry, Items | undefined]): Promise<Snapshot> {
  await Promise.all([qc.cancelQueries({ queryKey: keys.pantry.all() }), qc.cancelQueries({ queryKey: keys.shop.items() })])
  const old: Snapshot = [qc.getQueryData<Pantry>(keys.pantry.all()), qc.getQueryData<Items>(keys.shop.items())]
  if (old[0]) {
    const [p, i] = change(old[0], old[1])
    qc.setQueryData(keys.pantry.all(), p)
    if (i) qc.setQueryData(keys.shop.items(), i)
  }
  return old
}

const rollback = (qc: QueryClient, old: Snapshot | undefined) => {
  if (!old) return
  qc.setQueryData(keys.pantry.all(), old[0])
  qc.setQueryData(keys.shop.items(), old[1])
}

const fail = (e: Error) => notifications.show({ color: 'red', message: e.message })

/**
 * Registers the mutationFn of every shop mutation on the client, by mutation key.
 *
 * Offline: a tick made without a connection is a *paused* mutation. TanStack persists it (key + variables only,
 * never the function) and after a reload main.tsx calls resumePausedMutations(), which looks the function up
 * from these defaults. So registration must happen on every boot, before the persisted cache is restored, and
 * the functions must not depend on anything that only exists after React renders. That is why they take the
 * `api` argument here (one adapter object built at boot, shared with <ApiProvider>) and never call useApi().
 * Tests pass the fake adapter.
 */
export function registerShopMutations(qc: QueryClient, api: DataPort) {
  const settled = () => {
    // Refetching while other ticks are still queued would briefly undo them.
    if (qc.isMutating({ mutationKey: SHOP_KEY }) > 1) return
    void invalidateKeys(qc, [keys.pantry.all(), keys.shop.items()])
  }

  qc.setMutationDefaults(BUY_KEY, {
    mutationFn: async (b: Buy) => {
      const { itemFound } = await api.shop.buy(b)
      // The partner deleted the item before this tick synced. The batch exists anyway: you have it.
      if (!itemFound) notifications.show({ message: `${b.name} was removed from the list by your partner. Kept it in the pantry.` })
    },
    onMutate: async (b: Buy) => {
      // The local session is read from storage, so this works offline.
      const me = await api.auth.currentUserId()
      return optimistic(qc, (p, items) => {
        const tz = qc.getQueryData<{ timezone: string }>(keys.household.settings())?.timezone ?? 'UTC'
        const batch = { id: b.batchId, ingredientId: b.ingredientId, qty: b.qty, addedOn: localDay(new Date(), tz), addedAt: b.addedAt, recordedAt: UNSYNCED, expiresOn: b.expiresOn }
        return [
          { ...p, events: { ...p.events, batches: [...p.events.batches, batch] }, batchAuthors: { ...p.batchAuthors, [b.batchId]: me } },
          b.shoppingItemId ? markBought(items ?? [], b.shoppingItemId, b.batchId) : undefined,
        ]
      })
    },
    onError: (e: Error, _b: Buy, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })

  qc.setMutationDefaults(ON_HAND_KEY, {
    mutationFn: async (ingredientId: string) => {
      await api.ingredients.setOnHand(ingredientId, true)
    },
    onMutate: (id: string) =>
      optimistic(qc, (p) => [
        {
          ...p,
          domainIngredients: p.domainIngredients.map((i) => (i.id === id ? { ...i, onHand: true } : i)),
          ingredients: p.ingredients.map((i) => (i.id === id ? { ...i, on_hand: true } : i)),
        },
        undefined,
      ]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })

  qc.setMutationDefaults(CHECK_KEY, {
    mutationFn: async (id: string) => {
      await api.shop.setChecked(id, true)
    },
    onMutate: (id: string) => optimistic(qc, (p, items) => [p, items?.map((i) => (i.id === id ? { ...i, checked: true } : i))]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })

  // Untick: undo a tick done by mistake.
  qc.setMutationDefaults(UNBUY_KEY, {
    // Deletes the batch (cascading its snapshot rows and adjustments) and puts its list item, if any, back on the list.
    mutationFn: async (batchId: string) => {
      await api.shop.unbuy(batchId)
    },
    onMutate: (batchId: string) =>
      optimistic(qc, (p, items) => [
        { ...p, events: { ...p.events, batches: p.events.batches.filter((b) => b.id !== batchId) } },
        items && restoreBought(items, batchId),
      ]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })

  qc.setMutationDefaults(UN_ON_HAND_KEY, {
    mutationFn: async (ingredientId: string) => {
      await api.ingredients.setOnHand(ingredientId, false)
    },
    onMutate: (id: string) =>
      optimistic(qc, (p) => [
        {
          ...p,
          domainIngredients: p.domainIngredients.map((i) => (i.id === id ? { ...i, onHand: false } : i)),
          ingredients: p.ingredients.map((i) => (i.id === id ? { ...i, on_hand: false } : i)),
        },
        undefined,
      ]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })

  qc.setMutationDefaults(UNCHECK_KEY, {
    mutationFn: async (id: string) => {
      await api.shop.setChecked(id, false)
    },
    onMutate: (id: string) => optimistic(qc, (p, items) => [p, items?.map((i) => (i.id === id ? { ...i, checked: false } : i))]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })
}
