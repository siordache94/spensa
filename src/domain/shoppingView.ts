// The Shop tab's logic, as pure functions over plain data. ShopPage keeps state, rendering and mutation wiring only.
import type { Tables } from '../lib/database.types.ts'
import type { Buy, ShoppingItemRow } from '../lib/api/port.ts'
import { round1, round3 } from '../lib/format.ts'
import { toBuy } from '../lib/shopList.ts'
import { finishAnswers, markNotCooked, type FinishAnswer } from './checkinAnswers.ts'
import { itemKey, needKey } from './toBuy.ts'
import { addDays, replay, type Batch, type Day, type Need, type PantryEvents } from './replay.ts'

/**
 * The "Done shopping" snapshot: what is left of every batch, and the answers for the unread check-ins.
 * A meal answered "didn't cook" consumes nothing, so the quantities are replayed without it. With no such answer, the
 * replay already on screen (`remaining`) is the same one, and is used as is.
 */
export function snapshotPlan({ events, today, remaining, unreadMealIds, notCooked }: {
  events: PantryEvents
  today: Day
  remaining: ReadonlyMap<string, number>
  unreadMealIds: readonly string[]
  notCooked: ReadonlySet<string>
}): { answers: FinishAnswer[]; batches: { batch_id: string; qty: number }[] } {
  const answers = finishAnswers(unreadMealIds, notCooked)
  const skipped = new Set(answers.filter((a) => a.answer === 'not_cooked').map((a) => a.meal_id))
  const left = skipped.size === 0 ? remaining : replay(markNotCooked(events, skipped), today).remaining
  const batches = [...left].filter(([, qty]) => qty > 0).map(([batch_id, qty]) => ({ batch_id, qty: round3(qty) }))
  return { answers, batches }
}

// ---- The list the Shop tab shows: rows, aisles, and the cart ---------------------------------------------------------

/** The order of the aisles in the store. Categories not in it come after these, then uncategorised ("Other") last. */
export const STORE_WALK = ['produce', 'dairy', 'meat', 'fish', 'dry goods', 'frozen']

/** What the screen does when a row is ticked. The page turns it into a mutation (the offline ones use shopMutations keys). */
export type Tick =
  | { kind: 'buy'; buy: BuyDraft }
  | { kind: 'toTaste'; ingredientId: string }
  | { kind: 'checkText'; itemId: string }

/** A row's untick, for the cart. */
export type Untick = { kind: 'unbuy'; batchId: string } | { kind: 'unOnHand'; ingredientId: string } | { kind: 'uncheck'; itemId: string }

/** A purchase as the UI builds it: the batch id and time are added when it is ticked (see shopMutations.ts). */
export type BuyDraft = Omit<Buy, 'batchId' | 'addedAt'>

/** One row on the list. `buy` is set for rows with a quantity (the pencil at the row end changes it). */
export type Entry = {
  key: string
  name: string
  category: string | null // null = uncategorised
  note?: string
  figure?: string
  unit?: string
  free?: string // text in the amount column instead of a figure, e.g. "to taste"
  pack?: string
  buy?: BuyDraft
  tick: Tick
}

export type CartRow = {
  key: string
  id: string
  name: string
  figure?: string
  unit?: string
  free?: string
  /** Bought by the partner and not yet acknowledged on this phone. */
  held: boolean
  /** When the partner bought it (only for partner rows). */
  at?: string
  untick: Untick
}

export type ShoppingView = {
  groups: [string | null, Entry[]][]
  /** Every row on the list, sorted by name (the "Left" count). */
  entries: Entry[]
  cart: CartRow[]
  /** The newest purchase by the partner today, if any. */
  partnerLast: { name: string; addedAt: string } | undefined
  /** Free-text items ticked in the cart, which "Clear checked" removes. */
  checkedTextCount: number
}

/** The ingredient columns the list reads. */
export type ViewIngredient = Pick<Tables<'ingredients'>, 'id' | 'name' | 'unit' | 'category' | 'pack_size' | 'shelf_life_days' | 'on_hand'>

export type ShoppingViewInput = {
  /** What the trip needs (replay's shoppingList over the trip's meals). */
  needs: Need[]
  /** Ingredients that are staples below their minimum stock, for the note on the row. */
  stapleIds: ReadonlySet<string>
  ingredients: ViewIngredient[]
  /** The manual list, bought and checked items included (the view filters). */
  items: ShoppingItemRow[]
  /** Pantry batches (the replay's events.batches); the cart is today's of them. */
  batches: Batch[]
  /** Who bought each batch (null = unknown). */
  authors: Record<string, string | null>
  today: Day
  /** The signed-in user, or null when not known yet. */
  me: string | null
  /** Batches the partner's purchase was already acknowledged for on this phone. */
  acked: readonly string[]
  /** To-taste ingredients ticked on this visit (only those still on hand make the cart). */
  tasted: readonly string[]
}

export const packLabel = (packs: number | null) => (packs ? `≈ ${packs} ${packs === 1 ? 'pack' : 'packs'}` : undefined)

/** Rows grouped by aisle: STORE_WALK order, then other named categories A-Z, then uncategorised (and "other") last. */
export function groupByAisle(entries: Entry[]): [string | null, Entry[]][] {
  const byCategory = new Map<string | null, Entry[]>()
  // Categories are free text: "Produce" and "produce" are one aisle, labelled by the first spelling seen.
  const label = new Map<string, string>()
  for (const e of entries) {
    const category = e.category?.trim() ?? ''
    // a real "other" category and uncategorised items share the one closing group
    const key = category === '' || category.toLowerCase() === 'other' ? null : category.toLowerCase()
    if (key !== null && !label.has(key)) label.set(key, category)
    byCategory.set(key, [...(byCategory.get(key) ?? []), e])
  }
  const walk = (c: string) => STORE_WALK.indexOf(c)
  const known = (c: string) => (walk(c) === -1 ? STORE_WALK.length : walk(c))
  const named = [...byCategory.keys()]
    .filter((c): c is string => c !== null)
    .sort((a, b) => known(a) - known(b) || label.get(a)!.localeCompare(label.get(b)!))
    .map((key) => [label.get(key)!, byCategory.get(key)!] as [string, Entry[]])
  const other = byCategory.get(null)
  return [...named, ...(other ? [[null, other] as [null, Entry[]]] : [])]
}

/**
 * The Shop tab's rows and cart. Needs from the trip, manual list items, and today's purchases.
 * Buy quantity: the need, at least one pack. A list item: its own quantity, else one pack, else 1.
 * Expiry: today + the ingredient's shelf life, or none.
 */
export function buildShoppingView(input: ShoppingViewInput): ShoppingView {
  const { needs, stapleIds, ingredients, items, batches, authors, today, me, acked, tasted } = input
  const byId = new Map(ingredients.map((i) => [i.id, i]))
  const expiryFor = (shelfLifeDays: number | null) => (shelfLifeDays ? addDays(today, shelfLifeDays) : null)
  const entries: Entry[] = []

  for (const n of needs) {
    const ing = byId.get(n.ingredientId)
    if (!ing) continue
    if (n.qty === null) {
      entries.push({ key: needKey(n.ingredientId), name: ing.name, category: ing.category, free: 'to taste', tick: { kind: 'toTaste', ingredientId: n.ingredientId } })
      continue
    }
    const buy: BuyDraft = {
      ingredientId: n.ingredientId,
      name: ing.name,
      unit: ing.unit,
      qty: round3(Math.max(n.qty, ing.pack_size ?? 0)),
      expiresOn: expiryFor(ing.shelf_life_days),
    }
    entries.push({
      key: needKey(n.ingredientId),
      name: ing.name,
      category: ing.category,
      note: stapleIds.has(n.ingredientId) ? 'Staple, below min stock' : undefined,
      figure: `${round1(n.qty)}`,
      unit: ing.unit,
      pack: packLabel(n.packs),
      buy,
      tick: { kind: 'buy', buy },
    })
  }

  for (const item of toBuy(items)) {
    if (item.ingredient_id) {
      const ing = byId.get(item.ingredient_id)
      if (!ing || !item.ingredients) continue
      const buy: BuyDraft = {
        ingredientId: item.ingredient_id,
        name: item.ingredients.name,
        unit: item.ingredients.unit,
        qty: round3(item.qty ?? ing.pack_size ?? 1),
        expiresOn: expiryFor(ing.shelf_life_days),
        shoppingItemId: item.id,
      }
      entries.push({
        key: itemKey(item.id),
        name: item.ingredients.name,
        category: item.ingredients.category,
        figure: item.qty ? `${round1(item.qty)}` : undefined,
        unit: item.qty ? item.ingredients.unit : undefined,
        buy,
        tick: { kind: 'buy', buy },
      })
    } else if (!item.checked) {
      entries.push({ key: itemKey(item.id), name: item.text ?? '', category: null, tick: { kind: 'checkText', itemId: item.id } })
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))

  // Cart: today's purchases (newest first), to-taste items ticked this visit, and free-text items ticked.
  const checkedTexts = items.filter((i) => !i.ingredient_id && i.checked)
  const todaysBatches = batches
    .filter((b) => b.addedOn === today && byId.has(b.ingredientId))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const byPartner = (id: string) => !!me && !!authors[id] && authors[id] !== me
  const cart: CartRow[] = [
    ...todaysBatches.map((b) => {
      const ing = byId.get(b.ingredientId)!
      const partner = byPartner(b.id)
      return {
        key: `batch-${b.id}`,
        id: b.id,
        name: ing.name,
        figure: `${round1(b.qty)}`,
        unit: ing.unit,
        held: partner && !acked.includes(b.id),
        at: partner ? b.addedAt : undefined,
        untick: { kind: 'unbuy' as const, batchId: b.id },
      }
    }),
    ...tasted
      .filter((id) => byId.get(id)?.on_hand)
      .map((id) => ({
        key: `taste-${id}`,
        id,
        name: byId.get(id)!.name,
        free: 'to taste',
        held: false,
        untick: { kind: 'unOnHand' as const, ingredientId: id },
      })),
    ...checkedTexts.map((i) => ({
      key: `text-${i.id}`,
      id: i.id,
      name: i.text ?? '',
      held: false,
      untick: { kind: 'uncheck' as const, itemId: i.id },
    })),
  ]
  const lastPartner = todaysBatches.find((b) => byPartner(b.id))

  return {
    groups: groupByAisle(entries),
    entries,
    cart,
    partnerLast: lastPartner ? { name: byId.get(lastPartner.ingredientId)!.name, addedAt: lastPartner.addedAt } : undefined,
    checkedTextCount: checkedTexts.length,
  }
}
