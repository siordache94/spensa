// EVERY TanStack Query key in the app lives here. Pages and api modules never write a key literal.
// Keys are hierarchical: invalidating a prefix (e.g. keys.household.all()) also invalidates its children.
// The values are persisted to localStorage with the query cache, so changing one empties users' caches
// and breaks paused offline mutations. Treat them as a stable format.
export const keys = {
  auth: {
    uid: () => ['auth', 'uid'] as const,
    session: () => ['auth', 'session'] as const,
  },
  household: {
    /** Prefix: the household row, settings and members. */
    all: () => ['household'] as const,
    /** The household row itself (same literal as `all`: the row is the root of the household keys). */
    row: () => ['household'] as const,
    settings: () => ['household', 'settings'] as const,
    members: () => ['household', 'members'] as const,
    slotEndTimes: () => ['household', 'slot_end_times'] as const,
  },
  ingredients: {
    all: () => ['ingredients'] as const,
    usage: (id: string | undefined) => ['ingredient-usage', id] as const,
  },
  recipes: {
    all: () => ['recipes'] as const,
    options: () => ['recipes', 'options'] as const,
    planned: (recipeId: string) => ['recipe-planned', recipeId] as const,
  },
  plan: {
    plannedMeals: () => ['planned_meals'] as const,
  },
  pantry: {
    /** Raw facts: batches, meals, adjustments, snapshot, ingredients. Planner, Pantry and Shop derive from it. */
    all: () => ['pantry'] as const,
  },
  shop: {
    items: () => ['shopping_items'] as const,
  },
  checkins: {
    all: () => ['checkins'] as const,
    unread: () => ['checkins', 'unread'] as const,
  },
  push: {
    all: () => ['push'] as const,
    device: () => ['push', 'device'] as const,
    prefsAll: () => ['push', 'prefs'] as const,
    prefs: (me: string | null | undefined) => ['push', 'prefs', me] as const,
  },
  /** Mutation keys (not query keys). Paused offline mutations find their mutationFn again through these. */
  mutations: {
    shop: () => ['shop'] as const,
    buy: () => ['shop', 'buy'] as const,
    onHand: () => ['shop', 'on-hand'] as const,
    check: () => ['shop', 'check'] as const,
    unbuy: () => ['shop', 'unbuy'] as const,
    unOnHand: () => ['shop', 'un-on-hand'] as const,
    uncheck: () => ['shop', 'uncheck'] as const,
  },
}
