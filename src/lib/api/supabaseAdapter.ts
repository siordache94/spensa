// Production adapter: DataPort over the Supabase client. All `supabase.` calls in the app belong in this file.
import { supabase } from '../supabase.ts'
import { ApiError, type DataPort, type PantryRows } from './port.ts'

const check = (error: { message: string; code?: string } | null) => {
  if (error) throw new ApiError(error.message, error.code)
}

export const supabaseAdapter: DataPort = {
  auth: {
    // The local session is read from storage, so this works offline.
    currentUserId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  },

  household: {
    async settings() {
      const { data, error } = await supabase.from('households').select('id, timezone, expiring_days, horizon_days, slots, slot_end_times').single()
      check(error)
      return data!
    },
  },

  ingredients: {
    async list() {
      const { data, error } = await supabase.from('ingredients').select('*').order('name')
      check(error)
      return data!
    },
    async usage(ingredientId) {
      const { data, error } = await supabase.from('recipe_ingredients').select('recipes(name)').eq('ingredient_id', ingredientId)
      check(error)
      return data!.map((row) => row.recipes.name)
    },
    async save(id, row) {
      const { error } = id ? await supabase.from('ingredients').update(row).eq('id', id) : await supabase.from('ingredients').insert(row)
      check(error)
    },
    async setOnHand(id, onHand) {
      const { error } = await supabase.from('ingredients').update({ on_hand: onHand }).eq('id', id)
      check(error)
    },
  },

  pantry: {
    async rows(): Promise<PantryRows> {
      // Soft-deleted rows never arrive: RLS select policies hide them (ADR 0003), so replay sees only live facts.
      // shortcut: fetches every row since forever; filter by the latest snapshot date when history grows
      const [batches, meals, adjustments, snapshots, ingredients] = await Promise.all([
        supabase.from('batches').select('*'),
        supabase.from('planned_meals').select('*, planned_meal_lines(ingredient_id, qty_total), recipes(id, name, recipe_ingredients(ingredient_id, qty_per_portion))'),
        supabase.from('adjustments').select('*'),
        supabase
          .from('snapshots')
          .select('*, snapshot_batches(batch_id, qty)')
          .order('on_date', { ascending: false })
          .order('taken_at', { ascending: false })
          .limit(1),
        supabase.from('ingredients').select('*'),
      ])
      for (const r of [batches, meals, adjustments, snapshots, ingredients]) check(r.error)
      return {
        batches: batches.data!,
        meals: meals.data!,
        adjustments: adjustments.data!,
        snapshot: snapshots.data![0],
        ingredients: ingredients.data!,
      }
    },
  },

  shop: {
    async buy(b) {
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
        check(error)
        return { itemFound: (data as { item_found?: boolean } | null)?.item_found !== false }
      }
      const { error } = await supabase
        .from('batches')
        .upsert({ id: b.batchId, ingredient_id: b.ingredientId, qty: b.qty, expires_on: b.expiresOn, added_at: b.addedAt }, { onConflict: 'id', ignoreDuplicates: true })
      check(error)
      return { itemFound: true }
    },
    async setChecked(itemId, checked) {
      const { error } = await supabase.from('shopping_items').update({ checked }).eq('id', itemId)
      check(error)
    },
    async unbuy(batchId) {
      // Deletes the batch (cascading its snapshot rows and adjustments) and puts its list item, if any, back on the list.
      const { error } = await supabase.rpc('unbuy', { batch_id: batchId })
      check(error)
    },
  },

  trash: {
    async softDelete(table, ids) {
      const { error } = await supabase.rpc('soft_delete', { tbl: table, ids })
      check(error)
    },
    async restore(table, ids) {
      const { error } = await supabase.rpc('restore', { tbl: table, ids })
      check(error)
    },
  },
}
