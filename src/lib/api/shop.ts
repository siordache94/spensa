// Shopping list aggregate: the list's reads and the commands that change it. The offline-capable ticks
// (buy, check, on hand) are registered by key in src/lib/shopMutations.ts, not here.
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { defineCommand, invalidateKeys } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import type { ShoppingItemInput } from './port.ts'

export type { ShoppingItemInput }

/** Refetches what a household change can move on the Shop tab: pantry, the list and the settings (slots). */
export const refreshShop = (qc: QueryClient) => invalidateKeys(qc, [keys.pantry.all(), keys.shop.items(), keys.household.settings()])

export function useShoppingItems() {
  const api = useApi()
  return useQuery({ queryKey: keys.shop.items(), queryFn: () => api.shop.list() })
}

export const addShoppingItem = defineCommand<ShoppingItemInput>({
  name: 'shop.addItem',
  run: (api, item) => api.shop.addItem(item),
  invalidates: () => [keys.shop.items()],
  when: 'settled',
})

/** Soft-deletes the checked list items (ids come from the page's list). */
export const clearCheckedItems = defineCommand<{ ids: string[] }>({
  name: 'shop.clearChecked',
  run: (api, { ids }) => api.trash.softDelete('shopping_items', ids),
  invalidates: () => [keys.shop.items()],
  when: 'settled',
})

/** Leaves a meal off (or back on) the trip's shopping. Meals are still eaten in the replay. */
export const setMealSkipShopping = defineCommand<{ mealId: string; skip: boolean }>({
  name: 'shop.setMealSkip',
  run: (api, { mealId, skip }) => api.shop.setMealSkip(mealId, skip),
  invalidates: () => [keys.pantry.all()],
  when: 'settled',
})

/** The on-hand switch on the Pantry tab (not the offline shop tick): no optimistic update, refetch after. */
export const setPantryOnHand = defineCommand<{ id: string; onHand: boolean }>({
  name: 'pantry.setOnHand',
  run: (api, { id, onHand }) => api.ingredients.setOnHand(id, onHand),
  invalidates: () => [keys.pantry.all()],
  when: 'settled',
})
