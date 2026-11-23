// Production adapter: DataPort over the Supabase client. All `supabase.` calls in the app belong in this file.
import { supabase } from '../supabase.ts'
import { ApiError, type DataPort, type PantryRows } from './port.ts'

const check = (error: { message: string; code?: string } | null) => {
  if (error) throw new ApiError(error.message, error.code)
}

const RECIPE_SELECT = '*, recipe_ingredients(ingredient_id, qty_per_portion, ingredients(name, unit))'

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
    async saveSlots(slots) {
      // household_id is not needed: RLS limits the update to the member's own household row
      const { error } = await supabase.from('households').update({ slots }).not('id', 'is', null)
      check(error)
    },
  },

  recipes: {
    async list() {
      const { data, error } = await supabase.from('recipes').select(RECIPE_SELECT).order('name')
      check(error)
      return data!
    },
    async options() {
      const { data, error } = await supabase.from('recipes').select('id, name, serves').order('name')
      check(error)
      return data!
    },
    async planned(recipeId) {
      const { data: snapshots, error: snapshotError } = await supabase
        .from('snapshots')
        .select('on_date')
        .order('on_date', { ascending: false })
        .limit(1)
      check(snapshotError)
      const cutoff = snapshots![0]?.on_date

      let query = supabase.from('planned_meals').select('*').eq('recipe_id', recipeId).order('date').order('slot')
      if (cutoff) query = query.gt('date', cutoff)
      const { data, error } = await query
      check(error)
      return data!
    },
    async save(input) {
      const { error } = await supabase.rpc('save_recipe', {
        // Generated types omit null for uuid args; the RPC takes null to mean "insert".
        recipe_id: (input.id ?? null) as string,
        name: input.name,
        instructions: input.instructions,
        tags: input.tags,
        serves: input.serves,
        lines: input.lines,
      })
      check(error)
    },
    async createIngredient(row) {
      const { data, error } = await supabase.from('ingredients').insert({ name: row.name, unit: row.unit }).select().single()
      check(error)
      return data!
    },
  },

  plan: {
    async add(row) {
      const { error } = await supabase.from('planned_meals').insert(row)
      check(error)
    },
    async move(id, to) {
      const { error } = await supabase.from('planned_meals').update(to).eq('id', id)
      check(error)
    },
    async setPortions(id, portions) {
      const { error } = await supabase.from('planned_meals').update({ portions }).eq('id', id)
      check(error)
    },
    async setCook(id, cookId) {
      const { error } = await supabase.from('planned_meals').update({ cook_id: cookId }).eq('id', id)
      check(error)
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
