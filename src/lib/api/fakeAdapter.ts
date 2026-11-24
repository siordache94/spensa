// In-memory DataPort for tests: the second adapter that makes the seam real. No network, no React.
// It mirrors the server rules the app relies on (soft delete hides rows, unique names, FK-style delete guard),
// not the SQL. Add behaviour here only when a test needs it, and keep it as dumb as the real thing is smart.
import type { Tables } from '../database.types.ts'
import type { FinishAnswer } from '../../domain/checkinAnswers.ts'
import type { PantryEdits } from '../../domain/pantryEdits.ts'
import { mealLinesPayload } from '../../domain/mealLines.ts'
import type { MealAmount } from '../../domain/replay.ts'
import type { CheckinAnswer } from '../checkin.ts'
import {
  ApiError, PANTRY_CHANGED_MESSAGE, VERSION_CONFLICT, type AuthSession, type DataPort, type HouseholdRow, type HouseholdSettings, type Member, type PantryMealRow, type PantrySnapshotRow,
  type PushPrefsRow, type PushTestResult, type Recipe, type SnapshotBatch, type UnreadCheckinRow,
} from './port.ts'

export type FakeState = {
  userId: string | null
  household: HouseholdSettings
  /** The household row (name, invite code), null before the user joins or creates one. */
  householdRow: HouseholdRow | null
  members: Member[]
  /** The user's push prefs row, null until they turn notifications on. */
  prefs: PushPrefsRow | null
  /** Endpoints of the devices with a saved push subscription. */
  pushEndpoints: string[]
  /** What push.test() answers. */
  pushTest: PushTestResult
  ingredients: Tables<'ingredients'>[]
  /** Live recipes' ingredient lines: what `ingredients.usage` and the delete guard look at. */
  recipeLines: { ingredientId: string; recipeName: string }[]
  batches: Tables<'batches'>[]
  meals: PantryMealRow[]
  adjustments: Tables<'adjustments'>[]
  snapshot: PantrySnapshotRow | undefined
  shoppingItems: Tables<'shopping_items'>[]
  recipes: Recipe[]
  /** Unread meal check-ins, oldest first (what checkins.unread returns). */
  unreadCheckins: UnreadCheckinRow[]
  /** Unread check-ins of soft-deleted meals, kept so a restore brings them back (the server's soft cascade). */
  deletedUnreadCheckins: UnreadCheckinRow[]
  /** What pantry.saveEdits was called with, in order. */
  savedEdits: PantryEdits[]
  /** What checkins.finishShopping was called with, in order. */
  finishedShopping: { onDate: string; batches: SnapshotBatch[]; answers: FinishAnswer[]; expectedAt: string | null }[]
  /** What auth.signUp returns: true with Confirm email on (a user was created, no session). */
  signUpNeedsConfirmation: boolean
  /** Emails auth.signUp was called with, in order. */
  signUpEmails: string[]
  /** Emails auth.resendConfirmation was called with, in order. */
  resendEmails: string[]
  /** Password reset requests, in order. */
  resetRequests: { email: string; redirectTo: string }[]
  /** The password auth.updatePassword last set. */
  password: string
  /** True after a recovery link fires, until the password is set or the user signs out. */
  recoveryPending: boolean
  /**
   * The household event clock (`household_events.at`), undefined until the first write. finishShopping refuses a
   * different expectedAt, as the server does (MR-005); bump it to simulate a partner write.
   */
  version: string | undefined
}

export type FakeApi = DataPort & {
  state: FakeState
  /** Every port call as 'group.method', in order. Assert on it to see what a page did. */
  calls: string[]
  /** Makes the household events feed fire, as a partner's write would. `by` = the writer's user id. */
  emitHouseholdEvent(by: string | null): void
  /** Makes the session feed fire, as a sign-in or sign-out would. */
  emitSessionChange(signedIn: boolean): void
  /** Makes the password-recovery feed fire, as opening a reset link would. */
  emitPasswordRecovery(): void
  /** Make the next call of 'group.method' throw. Fires once. */
  failNext(call: string, error?: Error): void
}

const NOW = '2026-01-01T00:00:00Z'
let seq = 0
const id = () => `fake-${++seq}`
const ANSWERS: readonly CheckinAnswer[] = ['planned', 'changed', 'not_cooked', 'dismissed']

/** Row factories: fill in the boring columns so a test states only what matters. */
export const row = {
  ingredient: (o: Partial<Tables<'ingredients'>> = {}): Tables<'ingredients'> => ({
    archived: false, category: null, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    min_stock: null, name: 'pasta', on_hand: false, pack_size: null, shelf_life_days: null, unit: 'g', updated_at: null, updated_by: null, ...o,
  }),
  batch: (o: Partial<Tables<'batches'>> = {}): Tables<'batches'> => ({
    added_at: NOW, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, expires_on: null, household_id: 'h1', id: id(),
    ingredient_id: 'i1', qty: 0, recorded_at: NOW, shopping_item_id: null, updated_at: null, updated_by: null, ...o,
  }),
  shoppingItem: (o: Partial<Tables<'shopping_items'>> = {}): Tables<'shopping_items'> => ({
    bought_batch_id: null, checked: false, created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    ingredient_id: null, qty: null, text: null, updated_at: null, updated_by: null, ...o,
  }),
  recipe: (o: Partial<Tables<'recipes'>> & { recipe_ingredients?: Recipe['recipe_ingredients'] } = {}): Recipe => ({
    created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(), instructions: '', name: 'soup',
    serves: 2, tags: [], updated_at: null, updated_by: null, recipe_ingredients: [], ...o,
  }),
  plannedMeal: (o: Partial<Tables<'planned_meals'>> = {}): PantryMealRow => ({
    cook_id: null, created_at: NOW, created_by: null, date: '2026-01-05', deleted_at: null, deleted_by: null, household_id: 'h1', id: id(),
    not_cooked: false, portions: 2, position: 0, recipe_id: null, skip_shopping: false, slot: 'dinner', updated_at: null, updated_by: null,
    planned_meal_lines: [], recipes: null, ...o,
  }),
  snapshot: (o: Partial<PantrySnapshotRow> = {}): PantrySnapshotRow => ({
    created_at: NOW, created_by: null, deleted_at: null, deleted_by: null, household_id: 'h1', id: id(), on_date: '2026-01-05',
    taken_at: NOW, updated_at: null, updated_by: null, snapshot_batches: [], ...o,
  }),
}

export function createFakeAdapter(seed: Partial<FakeState> = {}): FakeApi {
  const state: FakeState = {
    userId: 'u1',
    household: { id: 'h1', timezone: 'UTC', expiring_days: 3, horizon_days: 7, expiry_reminder_days: 2, slots: ['lunch', 'dinner'], slot_end_times: {} },
    householdRow: { id: 'h1', name: 'Casa', invite_code: 'INVITE1' },
    members: [], prefs: null, pushEndpoints: [], pushTest: { sent: 1, gone: 0, failed: 0 },
    ingredients: [], recipeLines: [], batches: [], meals: [], adjustments: [], snapshot: undefined, shoppingItems: [], recipes: [],
    unreadCheckins: [], deletedUnreadCheckins: [], savedEdits: [], finishedShopping: [], version: undefined,
    signUpNeedsConfirmation: false, signUpEmails: [], resendEmails: [], resetRequests: [], password: 'password1', recoveryPending: false,
    ...seed,
  }
  const calls: string[] = []
  const listeners = new Set<(by: string | null) => void>()
  const sessionListeners = new Set<(signedIn: boolean) => void>()
  const recoveryListeners = new Set<() => void>()
  const failures = new Map<string, Error>()
  /** Wraps every method of one port group: logs the call, can be made to fail, and returns a promise. Methods may be sync. */
  const track = <K extends keyof DataPort>(
    group: K,
    methods: { [M in keyof DataPort[K]]: DataPort[K][M] extends (...a: infer A) => Promise<infer R> ? (...a: A) => R | Promise<R> : never },
  ): DataPort[K] =>
    Object.fromEntries(
      Object.entries(methods as Record<string, (...a: unknown[]) => unknown>).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          const call = `${group}.${name}`
          calls.push(call)
          const err = failures.get(call)
          if (err) { failures.delete(call); throw err }
          return fn(...args)
        },
      ]),
    ) as DataPort[K]

  const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at)

  const now = () => new Date().toISOString()
  const liveSnapshot = () => (state.snapshot && !state.snapshot.deleted_at ? state.snapshot : undefined)
  /** What the server's SELECT policy lets through: the snapshot with only its live batch lines. */
  const visibleSnapshot = () => {
    const snapshot = liveSnapshot()
    return snapshot
      ? { ...snapshot, snapshot_batches: snapshot.snapshot_batches.filter((line) => live(state.batches).some((b) => b.id === line.batch_id)) }
      : undefined
  }

  /** The first live purchase of a list item (the server's sync_item_purchase picks by recorded_at, then id). */
  const firstLivePurchase = (itemId: string, exclude?: string) =>
    live(state.batches).find((b) => b.shopping_item_id === itemId && b.id !== exclude)

  /**
   * An answer, as `answer_checkin` does it: "not cooked" also flags the meal (so the replay skips it), and the first
   * answer clears the shared check-in. Returns whether it cleared an unread one (a retry is false).
   */
  const answerCheckin = (mealId: string, answer: CheckinAnswer) => {
    if (!ANSWERS.includes(answer)) throw new ApiError(`unknown answer ${answer}`, '22023')
    if (answer === 'not_cooked') {
      const meal = state.meals.find((m) => m.id === mealId)
      if (meal) meal.not_cooked = true
    }
    const idx = state.unreadCheckins.findIndex((c) => c.planned_meals?.id === mealId)
    if (idx < 0) return false
    state.unreadCheckins.splice(idx, 1)
    return true
  }

  /** `recipeLines` is what usage and the ingredient delete guard read. Keeps it in step with a recipe. Matches by name (shortcut). */
  const syncRecipeLines = (recipe: Recipe, previousName = recipe.name) => {
    state.recipeLines = state.recipeLines.filter((l) => l.recipeName !== previousName)
    if (!recipe.deleted_at) {
      state.recipeLines.push(...recipe.recipe_ingredients.map((ri) => ({ ingredientId: ri.ingredient_id, recipeName: recipe.name })))
    }
  }

  // ---- Soft delete and its cascade (docs/adr/0003, migrations 20261124100000 and 20261127100000) -------------------
  const softDeleteBatch = (batch: Tables<'batches'>, stamp: string) => {
    if (batch.deleted_at) return
    batch.deleted_at = stamp
    for (const a of state.adjustments) if (a.batch_id === batch.id && !a.deleted_at) a.deleted_at = stamp
    // the item that bought this batch goes back to "not bought", or to another live purchase of the same item
    for (const item of state.shoppingItems) {
      if (item.deleted_at || item.bought_batch_id !== batch.id) continue
      item.bought_batch_id = firstLivePurchase(item.id, batch.id)?.id ?? null
    }
  }

  const restoreBatch = (batch: Tables<'batches'>, stamp: string) => {
    batch.deleted_at = null
    for (const a of state.adjustments) if (a.batch_id === batch.id && a.deleted_at === stamp) a.deleted_at = null
    // restoring a purchase marks its item bought again when nothing else bought it
    for (const item of state.shoppingItems) {
      if (!item.deleted_at && item.bought_batch_id === null && batch.shopping_item_id === item.id) item.bought_batch_id = batch.id
    }
  }

  const softDeleteMeal = (meal: PantryMealRow, stamp: string) => {
    if (meal.deleted_at) return
    meal.deleted_at = stamp
    // the meal's own lines and check-in go with it; lines are embedded in the meal so hiding the meal hides them
    const gone = state.unreadCheckins.filter((c) => c.planned_meals?.id === meal.id)
    state.unreadCheckins = state.unreadCheckins.filter((c) => !gone.includes(c))
    state.deletedUnreadCheckins.push(...gone)
  }

  const restoreMeal = (meal: PantryMealRow) => {
    meal.deleted_at = null
    const back = state.deletedUnreadCheckins.filter((c) => c.planned_meals?.id === meal.id)
    state.deletedUnreadCheckins = state.deletedUnreadCheckins.filter((c) => !back.includes(c))
    state.unreadCheckins.push(...back)
  }

  const api: DataPort = {
    auth: track('auth', {
      currentUserId: () => state.userId,
      session: (): AuthSession | null => (state.userId ? { userId: state.userId, metadata: {} } : null),
      // shortcut: no password check; the fake accepts any sign-in (a test that needs a refusal uses failNext)
      signIn: () => { state.recoveryPending = false },
      signUp: (email) => {
        state.signUpEmails.push(email)
        // Confirm email on: the account exists, but there is no session to sign in with.
        if (state.signUpNeedsConfirmation) {
          state.userId = null
          return { needsConfirmation: true }
        }
        return { needsConfirmation: false }
      },
      resendConfirmation: (email) => { state.resendEmails.push(email) },
      requestPasswordReset: (email, redirectTo) => { state.resetRequests.push({ email, redirectTo }) },
      updatePassword: (password) => {
        if (!state.userId) throw new ApiError('not signed in', '401')
        state.password = password
        state.recoveryPending = false
      },
      recoveryPending: () => state.recoveryPending,
      signInWithGoogle: () => {},
      signOut: () => { state.userId = null; state.recoveryPending = false },
      // shortcut: the fake's user always exists
      verifyUser: () => 'ok' as const,
    }),
    household: track('household', {
      settings: () => state.household,
      current: () => state.householdRow,
      update: (patch) => { Object.assign(state.household, patch) },
      rotateInviteCode: () => {
        if (state.householdRow) state.householdRow.invite_code = `ROTATED-${++seq}`
      },
      create: (name, _displayName, timezone) => {
        state.householdRow = { id: 'h-new', name, invite_code: 'NEWCODE' }
        state.household.timezone = timezone ?? 'Europe/Rome'
      },
      join: (code) => {
        if (code !== state.householdRow?.invite_code) throw new ApiError('invalid invite code')
      },
      members: () => [...state.members].sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '')),
      setMemberName: (userId, displayName) => {
        const m = state.members.find((x) => x.user_id === userId)
        if (m) m.display_name = displayName
      },
    }),
    recipes: track('recipes', {
      list: () => [...live(state.recipes)].sort((a, b) => a.name.localeCompare(b.name)),
      options: () => [...live(state.recipes)].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: r.name, serves: r.serves })),
      planned: (recipeId) => {
        const cutoff = liveSnapshot()?.on_date
        return live(state.meals)
          .filter((m) => m.recipe_id === recipeId && (!cutoff || m.date > cutoff))
          .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot))
      },
      save: (input) => {
        const lines = input.lines.map((l) => {
          const ing = state.ingredients.find((i) => i.id === l.ingredient_id)
          return { ingredient_id: l.ingredient_id, qty_per_portion: l.qty_per_portion, ingredients: { name: ing?.name ?? '', unit: ing?.unit ?? 'g' } }
        })
        const existing = input.id ? state.recipes.find((r) => r.id === input.id) : undefined
        const previousName = existing?.name
        const target = existing ?? row.recipe({ name: input.name })
        Object.assign(target, { name: input.name, instructions: input.instructions, tags: input.tags, serves: input.serves, recipe_ingredients: lines })
        if (!existing) state.recipes.push(target)
        // shortcut: no unique-name check on recipes (the real RPC's rules are not known to the fake)
        syncRecipeLines(target, previousName)
      },
    }),
    plan: track('plan', {
      add: (input) => { state.meals.push(row.plannedMeal(input)) },
      move: (id, to) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) Object.assign(m, to)
      },
      setPortions: (id, portions) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) m.portions = portions
      },
      setCook: (id, cookId) => {
        const m = state.meals.find((x) => x.id === id)
        if (m) m.cook_id = cookId
      },
    }),
    ingredients: track('ingredients', {
      list: () => [...live(state.ingredients)].sort((a, b) => a.name.localeCompare(b.name)),
      usage: (ingredientId) => state.recipeLines.filter((l) => l.ingredientId === ingredientId).map((l) => l.recipeName),
      save: (ingredientId, input) => {
        if (live(state.ingredients).some((i) => i.id !== ingredientId && i.name.toLowerCase() === input.name?.toLowerCase())) {
          throw new ApiError('duplicate key value violates unique constraint', '23505')
        }
        const existing = state.ingredients.find((i) => i.id === ingredientId)
        if (existing) Object.assign(existing, input)
        else state.ingredients.push(row.ingredient(input))
      },
      create: (input) => {
        if (live(state.ingredients).some((i) => i.name.toLowerCase() === input.name?.toLowerCase())) {
          throw new ApiError('duplicate key value violates unique constraint', '23505')
        }
        const created = row.ingredient({ name: input.name, unit: input.unit })
        state.ingredients.push(created)
        return created.id
      },
      setOnHand: (ingredientId, onHand) => {
        const i = state.ingredients.find((x) => x.id === ingredientId)
        if (i) i.on_hand = onHand
      },
    }),
    pantry: track('pantry', {
      rows: () => ({
        batches: live(state.batches),
        meals: live(state.meals),
        adjustments: live(state.adjustments),
        snapshot: visibleSnapshot(),
        ingredients: live(state.ingredients),
        version: state.version,
      }),
      saveEdits: (edits) => {
        state.savedEdits.push(edits)
        // validate before writing, as the RPC does
        if (edits.newBatches.some((b) => !(b.qty > 0))) throw new ApiError('amount must be more than zero', '22023')
        const stamp = now()
        for (const a of edits.adjustments) {
          // adjustments for a batch deleted meanwhile are skipped, as the RPC's live-batch check does
          if (!live(state.batches).some((b) => b.id === a.batch_id)) continue
          state.adjustments.push({
            at: stamp, batch_id: a.batch_id, created_at: stamp, created_by: state.userId, deleted_at: null, deleted_by: null,
            household_id: state.household.id, id: id(), ingredient_id: a.ingredient_id, kind: a.kind,
            qty: a.kind === 'set' ? a.qty : null, recorded_at: stamp, updated_at: null, updated_by: null,
          })
        }
        for (const b of edits.newBatches) {
          state.batches.push(row.batch({
            added_at: stamp, created_at: stamp, expires_on: b.expires_on, ingredient_id: b.ingredient_id, qty: b.qty, recorded_at: stamp,
          }))
        }
        for (const e of edits.expiries) {
          const batch = state.batches.find((b) => b.id === e.batch_id)
          if (batch) batch.expires_on = e.expires_on
        }
      },
    }),
    shop: track('shop', {
      list: () =>
        live(state.shoppingItems).map((i) => {
          const ing = state.ingredients.find((x) => x.id === i.ingredient_id)
          return { ...i, ingredients: ing ? { name: ing.name, unit: ing.unit, category: ing.category } : null }
        }),
      addItem: (item) => {
        state.shoppingItems.push(row.shoppingItem(item))
      },
      setMealSkip: (mealId, skip) => {
        const m = state.meals.find((x) => x.id === mealId)
        if (m) m.skip_shopping = skip
      },
      buy: (b) => {
        // Mirrors buy_shopping_item (MR-003): the item names the ingredient, and it must be a live ingredient item.
        if (!(b.qty > 0)) throw new ApiError('amount must be more than zero', '22023')
        const item = b.shoppingItemId ? live(state.shoppingItems).find((i) => i.id === b.shoppingItemId) : undefined
        if (b.shoppingItemId && !item) throw new ApiError(`shopping item ${b.shoppingItemId} is missing or deleted`, '23503')
        if (item && !item.ingredient_id) throw new ApiError('free-text shopping item has no ingredient to buy', '22023')
        if (!state.batches.some((x) => x.id === b.batchId)) {
          state.batches.push(row.batch({
            id: b.batchId,
            ingredient_id: item ? item.ingredient_id! : b.ingredientId,
            shopping_item_id: item?.id ?? null,
            qty: b.qty,
            expires_on: b.expiresOn,
            added_at: b.addedAt,
          }))
        }
        // The partner bought it first when another live purchase points at the same item (a retry of this batch does not count).
        const alreadyPurchased = !!item && live(state.batches).some((x) => x.shopping_item_id === item.id && x.id !== b.batchId)
        const own = state.batches.find((x) => x.id === b.batchId)
        if (item) {
          // The RPC only moves the bought pointer: a purchase does not tick the item's `checked` box.
          // A retried buy of a batch that was returned must not relink it (the server only links a live batch).
          if (!item.bought_batch_id && own && !own.deleted_at) item.bought_batch_id = b.batchId
        }
        return { batchId: b.batchId, alreadyPurchased }
      },
      setChecked: (itemId, checked) => {
        const i = state.shoppingItems.find((x) => x.id === itemId)
        if (i) i.checked = checked
      },
      unbuy: (batchId) => {
        // Mirrors unbuy + sync_item_purchase: the item stays bought while another live purchase points at it, and goes
        // back on the list only when the last one is returned. `checked` is the user's box, not the purchase pointer.
        const batch = state.batches.find((b) => b.id === batchId)
        if (!batch || batch.deleted_at) return
        batch.deleted_at = NOW
        for (const i of state.shoppingItems) {
          if (i.bought_batch_id !== batchId && batch.shopping_item_id !== i.id) continue
          const other = firstLivePurchase(i.id)
          i.bought_batch_id = other?.id ?? null
        }
      },
    }),
    checkins: track('checkins', {
      unread: () => [...state.unreadCheckins],
      answer: (mealId, answer) => answerCheckin(mealId, answer),
      setNotCooked: (mealId, notCooked) => {
        const m = state.meals.find((x) => x.id === mealId)
        if (m) m.not_cooked = notCooked
        // the database trigger: "didn't cook" answers the meal's unread check-in
        if (notCooked) state.unreadCheckins = state.unreadCheckins.filter((c) => c.planned_meals?.id !== mealId)
      },
      saveMealLines: (mealId, lines: MealAmount[]) => {
        const m = state.meals.find((x) => x.id === mealId)
        const payload = mealLinesPayload(lines)
        if (m) m.planned_meal_lines = payload.map((l) => ({ ingredient_id: l.ingredient_id, qty_total: l.qty_total }))
      },
      slotEndTimes: () => ({ slots: state.household.slots, slot_end_times: state.household.slot_end_times }),
      saveSlotEndTimes: (times) => { state.household.slot_end_times = times },
      finishShopping: (onDate, batches, answers, expectedAt) => {
        // Mirrors the server transaction (MR-005, MR-003): stale version, unknown batch, then answers, snapshot,
        // trip reset, bought-item sweep and every check-in still unread counting as cooked as planned.
        if ((expectedAt ?? undefined) !== state.version) throw new ApiError(PANTRY_CHANGED_MESSAGE, VERSION_CONFLICT)
        const unknown = batches.find((b) => !live(state.batches).some((x) => x.id === b.batch_id))
        if (unknown) throw new ApiError(`snapshot names unknown batch ${unknown.batch_id}`, '23503')
        // validate every answer before touching anything, as the transaction does
        for (const a of answers) if (!ANSWERS.includes(a.answer)) throw new ApiError(`unknown answer ${a.answer}`, '22023')
        for (const a of answers) answerCheckin(a.meal_id, a.answer)
        state.snapshot = row.snapshot({
          id: id(),
          on_date: onDate,
          taken_at: now(),
          snapshot_batches: batches.map((b) => ({ batch_id: b.batch_id, qty: b.qty })),
        })
        // Clear the cart: every live item that is bought or has a live purchase pointing at it.
        for (const item of state.shoppingItems) {
          if (item.deleted_at) continue
          if (item.bought_batch_id || live(state.batches).some((b) => b.shopping_item_id === item.id)) item.deleted_at = now()
        }
        for (const m of state.meals) if (m.skip_shopping) m.skip_shopping = false
        // everything still unread counts as cooked as planned
        state.unreadCheckins = []
        // the transaction touches the household clock, so a retry with the old version conflicts
        state.version = `${now()}#${++seq}`
        state.finishedShopping.push({ onDate, batches, answers, expectedAt })
      },
    }),
    live: {
      subscribeHouseholdEvents: (_topic: string, onEvent: (by: string | null) => void) => {
        listeners.add(onEvent)
        return () => { listeners.delete(onEvent) }
      },
      onSessionChange: (onChange: (signedIn: boolean) => void) => {
        sessionListeners.add(onChange)
        return () => { sessionListeners.delete(onChange) }
      },
      onPasswordRecovery: (cb: () => void) => {
        recoveryListeners.add(cb)
        return () => { recoveryListeners.delete(cb) }
      },
    },
    account: track('account', {
      // shortcut: the export is a stub; the page only needs it to be a JSON-able value
      exportData: () => ({ user: state.userId }),
      deleteAccount: () => { state.userId = null },
    }),
    push: track('push', {
      saveSubscription: (endpoint) => { if (!state.pushEndpoints.includes(endpoint)) state.pushEndpoints.push(endpoint) },
      deleteSubscription: (endpoint) => { state.pushEndpoints = state.pushEndpoints.filter((e) => e !== endpoint) },
      prefs: () => state.prefs,
      ensurePrefs: (defaults) => { state.prefs ??= defaults },
      savePrefs: (prefs) => { state.prefs = prefs },
      test: () => state.pushTest,
    }),
    trash: track('trash', {
      softDelete: (table, ids) => {
        const stamp = now()
        if (table === 'ingredients') {
          for (const ingredientId of ids) {
            if (state.recipeLines.some((l) => l.ingredientId === ingredientId)) throw new ApiError('still referenced', '23503')
          }
          for (const ingredient of state.ingredients) {
            if (!ids.includes(ingredient.id) || ingredient.deleted_at) continue
            ingredient.deleted_at = stamp
            // the server's cascade: batches, adjustments and shopping items go with the ingredient
            for (const batch of state.batches) if (batch.ingredient_id === ingredient.id) softDeleteBatch(batch, stamp)
            for (const a of state.adjustments) if (a.ingredient_id === ingredient.id && !a.deleted_at) a.deleted_at = stamp
            for (const item of state.shoppingItems) if (item.ingredient_id === ingredient.id && !item.deleted_at) item.deleted_at = stamp
          }
        } else if (table === 'recipes') {
          // a live planned meal still points at the recipe: the FK refuses, as in the database
          for (const recipeId of ids) {
            if (live(state.meals).some((m) => m.recipe_id === recipeId)) throw new ApiError('still referenced', '23503')
          }
          for (const r of state.recipes) if (ids.includes(r.id)) { r.deleted_at = stamp; syncRecipeLines(r) }
        } else if (table === 'planned_meals') {
          for (const meal of state.meals) if (ids.includes(meal.id)) softDeleteMeal(meal, stamp)
        } else if (table === 'batches') {
          for (const batch of state.batches) if (ids.includes(batch.id)) softDeleteBatch(batch, stamp)
        } else if (table === 'adjustments') {
          for (const a of state.adjustments) if (ids.includes(a.id) && !a.deleted_at) a.deleted_at = stamp
        } else if (table === 'snapshots') {
          if (state.snapshot && ids.includes(state.snapshot.id) && !state.snapshot.deleted_at) state.snapshot.deleted_at = stamp
        } else if (table === 'shopping_items') {
          for (const item of state.shoppingItems) if (ids.includes(item.id) && !item.deleted_at) item.deleted_at = stamp
        } else {
          // recipe_ingredients has no addressable rows here: its lines live inside their recipe (and hide with it)
          throw new ApiError('not faked: trash.softDelete')
        }
      },
      restore: (table, ids) => {
        if (table === 'ingredients') {
          for (const ingredient of state.ingredients) {
            if (!ids.includes(ingredient.id) || !ingredient.deleted_at) continue
            const stamp = ingredient.deleted_at
            ingredient.deleted_at = null
            for (const batch of state.batches) if (batch.ingredient_id === ingredient.id && batch.deleted_at === stamp) restoreBatch(batch, stamp)
            for (const a of state.adjustments) if (a.ingredient_id === ingredient.id && a.deleted_at === stamp) a.deleted_at = null
            for (const item of state.shoppingItems) if (item.ingredient_id === ingredient.id && item.deleted_at === stamp) item.deleted_at = null
          }
        } else if (table === 'recipes') {
          for (const r of state.recipes) if (ids.includes(r.id)) { r.deleted_at = null; syncRecipeLines(r) }
        } else if (table === 'planned_meals') {
          for (const meal of state.meals) if (ids.includes(meal.id)) restoreMeal(meal)
        } else if (table === 'batches') {
          for (const batch of state.batches) {
            if (!ids.includes(batch.id) || !batch.deleted_at) continue
            restoreBatch(batch, batch.deleted_at)
          }
        } else if (table === 'adjustments') {
          for (const a of state.adjustments) if (ids.includes(a.id)) a.deleted_at = null
        } else if (table === 'snapshots') {
          if (state.snapshot && ids.includes(state.snapshot.id)) state.snapshot.deleted_at = null
        } else if (table === 'shopping_items') {
          for (const item of state.shoppingItems) if (ids.includes(item.id)) item.deleted_at = null
        } else {
          throw new ApiError('not faked: trash.restore')
        }
      },
    }),
  }

  return {
    ...api,
    state,
    calls,
    emitHouseholdEvent: (by) => { for (const l of listeners) l(by) },
    emitSessionChange: (signedIn) => { for (const l of sessionListeners) l(signedIn) },
    emitPasswordRecovery: () => { state.recoveryPending = true; for (const l of recoveryListeners) l() },
    failNext: (call, error = new Error(`fake failure: ${call}`)) => void failures.set(call, error) }
}
