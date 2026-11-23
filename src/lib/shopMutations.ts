import { notifications } from '@mantine/notifications'
import type { QueryClient } from '@tanstack/react-query'
import type { Tables } from './database.types.ts'
import { invalidatePantry, localDay } from './pantry.ts'
import { markBought, restoreBought } from './shopList.ts'
import { supabase } from './supabase.ts'
import type { Day } from '../domain/replay.ts'

// A purchase: becomes a batch, and marks the manual item it came from as bought (list -> cart -> pantry).
// An unsynced batch has no server time yet. It will be recorded after every existing snapshot, so sort it last.
const UNSYNCED = '9999-12-31T00:00:00Z'

// batchId and addedAt are generated when ticking, so a retry can't double-insert.
export type Buy = {
  ingredientId: string
  name: string
  unit: Tables<'ingredients'>['unit']
  qty: number
  expiresOn: Day | null
  shoppingItemId?: string
  batchId: string
  addedAt: string
}

export const SHOP_KEY = ['shop'] as const
export const BUY_KEY = ['shop', 'buy'] as const
export const ON_HAND_KEY = ['shop', 'on-hand'] as const
export const CHECK_KEY = ['shop', 'check'] as const
export const UNBUY_KEY = ['shop', 'unbuy'] as const
export const UN_ON_HAND_KEY = ['shop', 'un-on-hand'] as const
export const UNCHECK_KEY = ['shop', 'uncheck'] as const

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
  await Promise.all([qc.cancelQueries({ queryKey: ['pantry'] }), qc.cancelQueries({ queryKey: ['shopping_items'] })])
  const old: Snapshot = [qc.getQueryData<Pantry>(['pantry']), qc.getQueryData<Items>(['shopping_items'])]
  if (old[0]) {
    const [p, i] = change(old[0], old[1])
    qc.setQueryData(['pantry'], p)
    if (i) qc.setQueryData(['shopping_items'], i)
  }
  return old
}

const rollback = (qc: QueryClient, old: Snapshot | undefined) => {
  if (!old) return
  qc.setQueryData(['pantry'], old[0])
  qc.setQueryData(['shopping_items'], old[1])
}

const fail = (e: Error) => notifications.show({ color: 'red', message: e.message })

export function registerShopMutations(qc: QueryClient) {
  const settled = () => {
    // Refetching while other ticks are still queued would briefly undo them.
    if (qc.isMutating({ mutationKey: SHOP_KEY }) > 1) return
    invalidatePantry(qc)
    qc.invalidateQueries({ queryKey: ['shopping_items'] })
  }

  qc.setMutationDefaults(BUY_KEY, {
    mutationFn: async (b: Buy) => {
      if (b.shoppingItemId) {
        const { data, error } = await supabase.rpc('buy_shopping_item', {
          item_id: b.shoppingItemId,
          batch_id: b.batchId,
          ingredient_id: b.ingredientId,
          qty: b.qty,
          // Generated types omit null for date args; the RPC takes null to mean "no expiry".
          expires_on: b.expiresOn as string,
          added_at: b.addedAt,
        })
        // The RPC is idempotent on batch_id, so a retry is a plain success.
        if (error) throw new Error(error.message)
        // The partner deleted the item before this tick synced. The batch exists anyway: you have it.
        if ((data as { item_found?: boolean } | null)?.item_found === false) {
          notifications.show({ message: `${b.name} was removed from the list by your partner. Kept it in the pantry.` })
        }
        return
      }
      const { error } = await supabase
        .from('batches')
        .upsert({ id: b.batchId, ingredient_id: b.ingredientId, qty: b.qty, expires_on: b.expiresOn, added_at: b.addedAt }, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },
    onMutate: async (b: Buy) => {
      // The local session is read from storage, so this works offline.
      const me = (await supabase.auth.getSession()).data.session?.user.id ?? null
      return optimistic(qc, (p, items) => {
        const tz = qc.getQueryData<{ timezone: string }>(['household', 'settings'])?.timezone ?? 'UTC'
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
      const { error } = await supabase.from('ingredients').update({ on_hand: true }).eq('id', ingredientId)
      if (error) throw new Error(error.message)
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
      const { error } = await supabase.from('shopping_items').update({ checked: true }).eq('id', id)
      if (error) throw new Error(error.message)
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
      const { error } = await supabase.rpc('unbuy', { batch_id: batchId })
      if (error) throw new Error(error.message)
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
      const { error } = await supabase.from('ingredients').update({ on_hand: false }).eq('id', ingredientId)
      if (error) throw new Error(error.message)
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
      const { error } = await supabase.from('shopping_items').update({ checked: false }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onMutate: (id: string) => optimistic(qc, (p, items) => [p, items?.map((i) => (i.id === id ? { ...i, checked: false } : i))]),
    onError: (e: Error, _id: string, old: Snapshot | undefined) => {
      rollback(qc, old)
      fail(e)
    },
    onSettled: settled,
  })
}
