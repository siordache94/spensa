// The seam. DataPort is everything the app asks of its backend, grouped per aggregate.
// Two adapters: supabaseAdapter.ts (production) and fakeAdapter.ts (in-memory, for tests).
// Rules: methods are plain async functions with plain arguments, they throw ApiError (never return {data, error}),
// and they carry no React or TanStack Query. Keep this as small as the pages need: add a method when a page needs it.
import type { Tables, TablesInsert } from '../database.types.ts'
import type { Day, MealAmount } from '../../domain/replay.ts'
import type { FinishAnswer } from '../../domain/checkinAnswers.ts'
import type { PantryEdits } from '../../domain/pantryEdits.ts'
import type { CheckinAnswer } from '../checkin.ts'

/** Thrown by every adapter. `code` is the Postgres error code when there is one (23505 unique, 23503 foreign key). */
export class ApiError extends Error {
  code: string | undefined
  /** HTTP status, auth errors only (403 on a refused sign-up). */
  status: number | undefined
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/**
 * The SQLSTATE finish_shopping raises when the household changed since the client computed the snapshot (MR-005).
 * The client refetches, keeps the dialog open and asks for one more tap.
 */
export const VERSION_CONFLICT = '40001'
/** What the person sees on a version conflict. */
export const PANTRY_CHANGED_MESSAGE = 'The pantry changed on the other phone — review and finish again'

export type Ingredient = Tables<'ingredients'>
export type IngredientInput = TablesInsert<'ingredients'>

/** Tables a client may soft-delete from. Nothing in the app hard-deletes (docs/adr/0003-soft-delete-and-authorship.md). */
export type SoftTable =
  | 'ingredients'
  | 'recipes'
  | 'recipe_ingredients'
  | 'planned_meals'
  | 'batches'
  | 'adjustments'
  | 'snapshots'
  | 'shopping_items'

export type HouseholdSettings = Pick<
  Tables<'households'>,
  'id' | 'timezone' | 'expiring_days' | 'horizon_days' | 'expiry_reminder_days' | 'slots' | 'slot_end_times'
>
/** The household row the signed-in user belongs to (null before they join or create one). */
export type HouseholdRow = Pick<Tables<'households'>, 'id' | 'name' | 'invite_code'>
/** What the settings screen can change on the household row. */
export type HouseholdUpdate = Partial<Pick<Tables<'households'>, 'name' | 'timezone' | 'expiring_days' | 'horizon_days' | 'expiry_reminder_days' | 'slots'>>
export type Member = { user_id: string; display_name: string | null }
/** The locally stored session, as far as the app reads it. */
export type AuthSession = { userId: string; metadata: Record<string, unknown> }
export type PushPrefsRow = Pick<Tables<'push_prefs'>, 'list_changes' | 'meal_checkins' | 'expiry_time'>
/** The push service's answer to a test notification. */
export type PushTestResult = { sent: number; gone: number; failed: number }

export type Recipe = Tables<'recipes'> & {
  recipe_ingredients: {
    ingredient_id: string
    qty_per_portion: number | null // null = to taste
    ingredients: { name: string; unit: Tables<'ingredients'>['unit'] }
  }[]
}
export type RecipeOption = Pick<Tables<'recipes'>, 'id' | 'name' | 'serves'>
/** What the recipe form saves. `id` null = a new recipe. `lines` are per portion; qty_per_portion null = to taste. */
export type RecipeSave = {
  id: string | null
  name: string
  instructions: string
  tags: string[]
  serves: number
  lines: { ingredient_id: string; qty_per_portion: number | null }[]
}
export type PlannedMeal = Tables<'planned_meals'>
export type PlannedMealInput = TablesInsert<'planned_meals'>

export type PantryMealRow = Tables<'planned_meals'> & {
  planned_meal_lines: { ingredient_id: string; qty_total: number | string | null }[]
  recipes: { id: string; name: string; recipe_ingredients: { ingredient_id: string; qty_per_portion: number | string | null }[] } | null
}
export type PantrySnapshotRow = Tables<'snapshots'> & { snapshot_batches: { batch_id: string; qty: number | string }[] }

/** A row of the shopping list with its ingredient (null for free text). */
export type ShoppingItemRow = Tables<'shopping_items'> & { ingredients: Pick<Tables<'ingredients'>, 'name' | 'unit' | 'category'> | null }
/** What a manual list item is: an ingredient from the catalogue, or free text (one of the two). */
export type ShoppingItemInput = Pick<TablesInsert<'shopping_items'>, 'ingredient_id' | 'text'>

/** An unread check-in with its planned meal (null when the meal was deleted). */
export type UnreadCheckinRow = {
  id: string
  created_at: string
  planned_meals: { id: string; date: string; slot: string; portions: number; cook_id: string | null; recipes: { name: string } | null } | null
}
export type SlotSettings = Pick<Tables<'households'>, 'slots' | 'slot_end_times'>
/** One batch of the "Done shopping" snapshot. */
export type SnapshotBatch = { batch_id: string; qty: number }

/** What the pantry needs from the database: raw rows, soft-deleted ones already hidden. */
export type PantryRows = {
  batches: Tables<'batches'>[]
  meals: PantryMealRow[]
  adjustments: Tables<'adjustments'>[]
  /** The latest snapshot, if any. */
  snapshot: PantrySnapshotRow | undefined
  ingredients: Tables<'ingredients'>[]
  /**
   * The household's event clock (`household_events.at`) when these rows were read, undefined until the first write.
   * "Done shopping" sends it back so the server can refuse a snapshot computed from stale facts (MR-005).
   */
  version: string | undefined
}

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

/** What a tick bought. `alreadyPurchased` is true when the partner had bought the same list item first (MR-003). */
export type BuyResult = {
  batchId: string
  alreadyPurchased: boolean
}

export interface DataPort {
  auth: {
    /** From the locally stored session, so it works offline. */
    currentUserId(): Promise<string | null>
    /** The locally stored session (null when signed out). */
    session(): Promise<AuthSession | null>
    /** Throws ApiError (with status) when the server refuses. */
    signIn(email: string, password: string): Promise<void>
    /**
     * `inviteCode` undefined when the page has none. Throws ApiError with status 403 when the sign-up is refused.
     * `needsConfirmation` is true when Supabase created the user but returned no session (Confirm email on).
     */
    signUp(email: string, password: string, inviteCode: string | undefined): Promise<{ needsConfirmation: boolean }>
    /** Sends the sign-up confirmation email again (no invite code needed). */
    resendConfirmation(email: string): Promise<void>
    /** Sends the password reset email; `redirectTo` is where the recovery link opens the app. */
    requestPasswordReset(email: string, redirectTo: string): Promise<void>
    /** Sets the password of the signed-in (recovery) session. */
    updatePassword(password: string): Promise<void>
    /** True while a password-recovery link is open: the app must show the set-password screen, not the shell. */
    recoveryPending(): Promise<boolean>
    /** Starts the Google redirect. `redirectTo` is where Google sends the user back. */
    signInWithGoogle(redirectTo: string): Promise<void>
    /** 'local' clears this device only (the server session is already gone). Errors are ignored, as before. */
    signOut(scope: 'global' | 'local'): Promise<void>
    /** Asks the server whether the session's user still exists. 'invalid' only when the server says so. */
    verifyUser(): Promise<'ok' | 'invalid' | 'unreachable'>
  }
  household: {
    settings(): Promise<HouseholdSettings>
    /** The household row of the signed-in user, or null. */
    current(): Promise<HouseholdRow | null>
    update(patch: HouseholdUpdate): Promise<void>
    /** Gives the household a new invite code; the old code, link and QR stop working. */
    rotateInviteCode(): Promise<void>
    /** Throws ApiError with the server message when the name or the code is refused. `timezone` undefined keeps the default. */
    create(name: string, displayName: string | undefined, timezone: string | undefined): Promise<void>
    join(code: string, displayName: string | undefined): Promise<void>
    members(): Promise<Member[]>
    setMemberName(userId: string, displayName: string): Promise<void>
  }
  recipes: {
    list(): Promise<Recipe[]>
    /** Id, name and serves of every live recipe, for the planner's recipe picker. */
    options(): Promise<RecipeOption[]>
    /** Planned meals of one recipe after the latest snapshot (all of them when there is none). */
    planned(recipeId: string): Promise<PlannedMeal[]>
    /** Throws ApiError with the server code when the RPC refuses. */
    save(input: RecipeSave): Promise<void>
  }
  plan: {
    /** Adds a planned meal (a copy, or a new one from the planner). */
    add(row: PlannedMealInput): Promise<void>
    move(id: string, to: { date: string; slot: string; position: number }): Promise<void>
    setPortions(id: string, portions: number): Promise<void>
    /** null = nobody cooks it. */
    setCook(id: string, cookId: string | null): Promise<void>
  }
  ingredients: {
    list(): Promise<Ingredient[]>
    /** Names of the live recipes that use this ingredient. */
    usage(ingredientId: string): Promise<string[]>
    /** `id` set = update, null = insert. Throws ApiError code 23505 when the name is taken. */
    save(id: string | null, row: IngredientInput): Promise<void>
    /** Inserts an ingredient and returns its id. Throws ApiError code 23505 when the name is taken. */
    create(row: Pick<IngredientInput, 'name' | 'unit'>): Promise<string>
    setOnHand(id: string, onHand: boolean): Promise<void>
  }
  pantry: {
    rows(): Promise<PantryRows>
    /** Adjustments, new batches and expiry fixes from the pantry editor. Only what changed is sent. */
    saveEdits(edits: PantryEdits): Promise<void>
  }
  shop: {
    /** The shopping list items, oldest first, bought and checked ones included (the page filters). */
    list(): Promise<ShoppingItemRow[]>
    /** Adds a manual item (an ingredient or free text). */
    addItem(item: ShoppingItemInput): Promise<void>
    /** Whether a meal is left off the trip's shopping (it is still planned and eaten). */
    setMealSkip(mealId: string, skip: boolean): Promise<void>
    /**
     * Turns a tick into a batch. Idempotent on `batchId`. The RPC reads the ingredient from the list item (it is not
     * sent), refuses a free-text item with code 22023 and an item that is gone with 23503. `alreadyPurchased` is true
     * when another live purchase of the same item existed first, so the page can offer Keep both / Put one back.
     */
    buy(b: Buy): Promise<BuyResult>
    setChecked(itemId: string, checked: boolean): Promise<void>
    unbuy(batchId: string): Promise<void>
  }
  checkins: {
    /** Unread check-ins of the household, oldest first. */
    unread(): Promise<UnreadCheckinRow[]>
    /** Answers one check-in. True when it cleared an unread check-in, false when already answered (retry-safe). */
    answer(mealId: string, answer: CheckinAnswer): Promise<boolean>
    /** "Didn't cook" on or off. Turning it on also answers the meal's unread check-in (a database trigger). */
    setNotCooked(mealId: string, notCooked: boolean): Promise<void>
    /** Replaces a meal's own amounts. An empty array removes them (the meal follows its recipe again). */
    saveMealLines(mealId: string, lines: MealAmount[]): Promise<void>
    /** The slots with their stored end times. */
    slotEndTimes(): Promise<SlotSettings>
    /** End time ('HH:MM') per slot name. */
    saveSlotEndTimes(times: Record<string, string>): Promise<void>
    /**
     * "Done shopping": snapshot + answers in one transaction. `expectedAt` is the household version the snapshot was
     * computed from (`usePantryState().version`); the server refuses a stale one with code 40001, unknown batches with
     * 23503, and a date other than the household's today with 22023 (the message names the expected date).
     */
    finishShopping(onDate: Day, batches: SnapshotBatch[], answers: FinishAnswer[], expectedAt: string | null): Promise<void>
  }
  live: {
    /** Calls `onEvent` for every change to the household's events row (`by` = who wrote it, null if unknown). Returns the unsubscribe. */
    subscribeHouseholdEvents(topic: string, onEvent: (by: string | null) => void): () => void
    /** Calls `onChange` with whether a session exists after every sign-in, sign-out and token refresh. Returns the unsubscribe. */
    onSessionChange(onChange: (signedIn: boolean) => void): () => void
    /**
     * Calls `cb` when a password recovery link opens the app (Supabase PASSWORD_RECOVERY). If the link was already
     * consumed before the page subscribed, `cb` runs on subscribe. Returns the unsubscribe.
     */
    onPasswordRecovery(cb: () => void): () => void
  }
  account: {
    /** Everything the household holds about the user, as the server returns it. */
    exportData(): Promise<unknown>
    /** Deletes the account on the server (the delete-account edge function). */
    deleteAccount(): Promise<void>
  }
  push: {
    saveSubscription(endpoint: string, p256dh: string, auth: string): Promise<void>
    deleteSubscription(endpoint: string): Promise<void>
    /** The signed-in user's prefs row, or null when there is none yet. */
    prefs(): Promise<PushPrefsRow | null>
    /** Stores the defaults only if the user has no prefs yet (never overwrites). */
    ensurePrefs(defaults: PushPrefsRow): Promise<void>
    savePrefs(prefs: PushPrefsRow): Promise<void>
    /** Sends a test notification to the user's devices. Throws ApiError with the server's message when it cannot. */
    test(): Promise<PushTestResult>
  }
  trash: {
    /** Soft-deletes rows (children go with their parent). Throws ApiError code 23503 when something live still uses them. */
    softDelete(table: SoftTable, ids: string[]): Promise<void>
    /** Undo of softDelete. */
    restore(table: SoftTable, ids: string[]): Promise<void>
  }
}
