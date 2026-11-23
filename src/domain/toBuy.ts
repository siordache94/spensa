// What is on the still-to-buy list, as stable keys. The Shop tab's rows use these same keys (needKey/itemKey),
// and the push server uses this module to tell what a partner's change added or removed (ADR 0004).
import { shoppingList, type Day, type Ingredient, type PantryEvents } from './replay.ts'

export const needKey = (ingredientId: string) => `need-${ingredientId}`
export const itemKey = (itemId: string) => `item-${itemId}`

export type ShoppingItem = {
  id: string
  ingredientId: string | null // null = free text
  checked: boolean
  boughtBatchId: string | null
}

type Input = {
  events: PantryEvents
  ingredients: Ingredient[]
  items: ShoppingItem[] // live (not soft-deleted) items
  from: Day
  to: Day
  mealIds: ReadonlySet<string>
  today: Day
}

/**
 * Keys on the list: computed needs (for the trip's meals, staples, to-taste items marked out) and manual items
 * not yet bought. A ticked free-text item and an item bound to a batch are in the cart, not on the list.
 */
export function toBuyKeys({ events, ingredients, items, from, to, mealIds }: Input): string[] {
  const known = new Set(ingredients.map((i) => i.id))
  const keys = shoppingList(events, ingredients, from, to, mealIds).filter((n) => known.has(n.ingredientId)).map((n) => needKey(n.ingredientId))
  for (const it of items) {
    if (it.boughtBatchId) continue
    if (it.ingredientId ? known.has(it.ingredientId) : !it.checked) keys.push(itemKey(it.id))
  }
  return keys
}

/**
 * Keys that leave the list because they were bought (or marked on hand), not because they were dropped:
 * they must not count as "removed" (same rule as the in-app toast, diffToBuy in src/lib/trip.ts).
 */
export function resolvedKeys({ events, ingredients, items, today }: Pick<Input, 'events' | 'ingredients' | 'items' | 'today'>): Set<string> {
  return new Set([
    ...events.batches.filter((b) => b.addedOn === today).map((b) => needKey(b.ingredientId)),
    ...ingredients.filter((i) => i.onHand).map((i) => needKey(i.id)),
    ...items.filter((i) => i.checked || i.boughtBatchId).map((i) => itemKey(i.id)),
  ])
}
