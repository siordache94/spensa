import { notifications } from '@mantine/notifications'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateKeys } from './api/command.ts'
import { keys } from './api/keys.ts'
import { localDay } from './api/pantry.ts'
import { ApiError, type Buy, type BuyResult, type DataPort } from './api/port.ts'
import { markBought, restoreBought } from './shopList.ts'

// A purchase: becomes a batch, and marks the manual item it came from as bought (list -> cart -> pantry).
// An unsynced batch has no server time yet. It will be recorded after every existing snapshot, so sort it last.
const UNSYNCED = '9999-12-31T00:00:00Z'

/**
 * TanStack Query runs mutations of one scope one after another, in the order they were made — including the paused
 * ones `resumePausedMutations()` continues after a reload. Every shop write (ticks, their undos, the trip setup and
 * "Done shopping") joins it, so an undo can never reach the server before the tick it undoes and a finish can never
 * overtake a queued tick (MR-004).
 */
export const SHOP_SCOPE = { id: 'shop' } as const

export type { Buy }

export const SHOP_KEY = keys.mutations.shop()
export const BUY_KEY = keys.mutations.buy()
export const ON_HAND_KEY = keys.mutations.onHand()
export const CHECK_KEY = keys.mutations.check()
export const UNBUY_KEY = keys.mutations.unbuy()
export const UN_ON_HAND_KEY = keys.mutations.unOnHand()
export const UNCHECK_KEY = keys.mutations.uncheck()

export type Pantry = {
  events: { batches: { id: string; ingredientId: string; qty: number; addedOn: string; addedAt: string; recordedAt: string; expiresOn: string | null }[] }
  domainIngredients: { id: string; onHand: boolean }[]
  ingredients: { id: string; on_hand: boolean }[]
  batchAuthors?: Record<string, string | null>
}
export type Items = { id: string; checked: boolean; bought_batch_id?: string | null }[]
type Snapshot = [pantry: Pantry | undefined, items: Items | undefined]
type Batch = Pantry['events']['batches'][number]

// ---- Pure cache reducers: what the screen shows the moment a tick is made, before the write lands ----------------
export const setOnHandInPantry = (p: Pantry, ingredientId: string, onHand: boolean): Pantry => ({
  ...p,
  domainIngredients: p.domainIngredients.map((i) => (i.id === ingredientId ? { ...i, onHand } : i)),
  ingredients: p.ingredients.map((i) => (i.id === ingredientId ? { ...i, on_hand: onHand } : i)),
})

export const setCheckedInItems = (items: Items | undefined, itemId: string, checked: boolean): Items | undefined =>
  items?.map((i) => (i.id === itemId ? { ...i, checked } : i))

export const addBatchToPantry = (p: Pantry, batch: Batch, author: string | null): Pantry => ({
  ...p,
  events: { ...p.events, batches: [...p.events.batches, batch] },
  batchAuthors: { ...p.batchAuthors, [batch.id]: author },
})

export const removeBatchFromPantry = (p: Pantry, batchId: string): Pantry => ({
  ...p,
  events: { ...p.events, batches: p.events.batches.filter((b) => b.id !== batchId) },
})

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

/** After any shop tick settles, refetch the pantry and the list. Not while other ticks are still queued: that would undo them. */
const refreshAfterTick = (qc: QueryClient) => {
  if (qc.isMutating({ mutationKey: SHOP_KEY }) > 1) return
  void invalidateKeys(qc, [keys.pantry.all(), keys.shop.items()])
}

/**
 * A reversible tick: the write, and the cache change it shows at once. The pair of a tick and its undo is one
 * `switch(on)` with the boolean flipped, so each pair is built by one helper and registered under its own key.
 */
type Switch = {
  write: (api: DataPort, id: string) => Promise<void>
  change: (p: Pantry, items: Items | undefined, id: string) => [Pantry, Items | undefined]
}

/** The on-hand switch on the Shop tab: ticking a "to taste" row marks the ingredient on hand. `on` = true for the tick, false for the undo. */
export const onHandSwitch = (on: boolean): Switch => ({
  write: (api, id) => api.ingredients.setOnHand(id, on),
  change: (p, _items, id) => [setOnHandInPantry(p, id, on), undefined],
})

/** The tick on a free-text item (checked = in the cart) and its undo ("put back"). */
export const checkSwitch = (checked: boolean): Switch => ({
  write: (api, id) => api.shop.setChecked(id, checked),
  change: (p, items, id) => [p, setCheckedInItems(items, id, checked)],
})

const defineSwitch = (qc: QueryClient, api: DataPort, s: Switch) => ({
  scope: SHOP_SCOPE,
  mutationFn: (id: string) => s.write(api, id),
  onMutate: (id: string) => optimistic(qc, (p, items) => s.change(p, items, id)),
  onError: (e: Error, _id: string, old: Snapshot | undefined) => {
    rollback(qc, old)
    fail(e)
  },
  onSettled: () => refreshAfterTick(qc),
})

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
  qc.setMutationDefaults(BUY_KEY, {
    scope: SHOP_SCOPE,
    mutationFn: async (b: Buy): Promise<BuyResult> => {
      try {
        return await api.shop.buy(b)
      } catch (e) {
        // The item is gone (the partner deleted it, or the trip finished) before this tick synced. The RPC reads the
        // ingredient from the item, so it cannot buy it any more; say so instead of showing the raw FK error (MR-003).
        if (e instanceof ApiError && e.code === '23503') {
          notifications.show({ message: `${b.name} is no longer on the list. Nothing was bought.` })
          return { batchId: b.batchId, alreadyPurchased: false }
        }
        throw e
      }
    },
    onMutate: async (b: Buy) => {
      // The local session is read from storage, so this works offline.
      const me = await api.auth.currentUserId()
      return optimistic(qc, (p, items) => {
        const tz = qc.getQueryData<{ timezone: string }>(keys.household.settings())?.timezone ?? 'UTC'
        const batch = { id: b.batchId, ingredientId: b.ingredientId, qty: b.qty, addedOn: localDay(new Date(), tz), addedAt: b.addedAt, recordedAt: UNSYNCED, expiresOn: b.expiresOn }
        return [
          addBatchToPantry(p, batch, me),
          b.shoppingItemId ? markBought(items ?? [], b.shoppingItemId, b.batchId) : undefined,
        ]
      })
    },
    onError: (e: Error, _b: Buy, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: () => refreshAfterTick(qc),
  })

  // Untick: undo a tick done by mistake. Removes that one batch (its snapshot rows and adjustments go with it) and
  // puts the item back on the list only when no other live purchase points at it (MR-003).
  qc.setMutationDefaults(UNBUY_KEY, {
    scope: SHOP_SCOPE,
    mutationFn: async (batchId: string) => {
      await api.shop.unbuy(batchId)
    },
    onMutate: (batchId: string) =>
      optimistic(qc, (p, items) => [removeBatchFromPantry(p, batchId), items && restoreBought(items, batchId)]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: () => refreshAfterTick(qc),
  })

  qc.setMutationDefaults(ON_HAND_KEY, defineSwitch(qc, api, onHandSwitch(true)))
  qc.setMutationDefaults(UN_ON_HAND_KEY, defineSwitch(qc, api, onHandSwitch(false)))
  qc.setMutationDefaults(CHECK_KEY, defineSwitch(qc, api, checkSwitch(true)))
  qc.setMutationDefaults(UNCHECK_KEY, defineSwitch(qc, api, checkSwitch(false)))
}
