# Architecture review: Spensa — deepening opportunities

Date: 2026-11-24. Read-only review: no source, `CONTEXT.md` or ADR was changed.

Scope: `src/domain`, `src/lib`, `src/lib/api`, `src/pages`, `src/components`, `supabase/functions`.

Method: read `CONTEXT.md`, `README.md`, all five ADRs, `src/lib/api/README.md`, the domain and data-access modules, every page, both Adapters, and the edge functions. Ran `npx vitest run` (31 files, 249 tests, all pass) and `npx oxlint` (0 errors, warnings only). The lint warnings cluster on the `ShopPage` acknowledgement/refs path and the `PlanPage` marker and deep-link effects — the same places candidates 2, 3 and 9 point at. Vocabulary is the skill's: **Module**, **Interface**, **Implementation**, **Depth**, **Seam**, **Adapter**, **Leverage**, **Locality**; domain terms are `CONTEXT.md`'s (Household, Planned meal, Trip, Snapshot, Replay, current stock, shortfall, expiring soon, Done shopping, Didn't cook, per-meal amounts, check-in).

Ranking is by impact per unit of effort, not by impact alone. Each candidate applies the deletion test, and its dependency is classified with `DEEPENING.md`: in-process, local-substitutable, remote but owned, or true external.

## Verdict

The center is strong. `replay.ts` and `pantryRows.ts` are genuinely deep, pure Modules shared by the phone and the edge functions; the `DataPort` Seam is real (two Adapters, not a hypothetical one); and the rules that `CONTEXT.md` describes (Snapshot truth, FEFO, inferred Trip, soft delete) sit in the right place. The friction is at the edges of that center: derived stock is recomputed by each screen, the Shop tab's behaviour lives in a page no test renders, the value under the Pantry query key is an unnamed Interface written by three Modules, and the fake Adapter resolves successfully where it does not honour the Interface. Those are the places where a small change forces coordinated edits.

## Ranking

| # | Candidate | Impact | Effort | Dependency (`DEEPENING.md`) |
|---|-----------|--------|--------|------------------------------|
| 1 | The fake Adapter does not honour the port Interface | High | S (loud failures) – M (contract suite) | in-process, plus local-substitutable for the real Adapter |
| 2 | Stock for the Trip is recomputed per screen | High | M | in-process |
| 3 | The Shop tab's orchestration has no Module | High | M–L | in-process, plus the boot-time offline Seam |
| 4 | The `['pantry']` cache value is an unnamed Interface | Med–High | M | in-process, with a persisted cache |
| 5 | One Household row, three keys, and five refresh helpers restating invalidation | Med | S | in-process |
| 6 | The domain depends outward on the port and database rows | Med | S | in-process, plus a build-time rule |
| 7 | Trip and list-change rules are split; device state rides along | Low–Med | S | in-process |
| 8 | `DataPort` and the planned-meal read model speak persistence | High long-term | L | remote but owned (existing Ports & Adapters) |
| 9 | The check-in's compound write has no Module | Low–Med | S | in-process |
| 10 | The facts loader is implemented twice | Med | M | remote but owned, two Adapters over the same facts |

## Corrections to the brief

- **`shop.buy` in the fake is idempotent.** It checks for an existing batch id before inserting (`fakeAdapter.ts:240-243`), and `api.test.ts:67-81` asserts a retry does not double-insert. The offline invariant is honoured. The divergence is elsewhere: the fake also sets `checked = true` on the item (`:245`), while `buy_shopping_item` only sets `bought_batch_id` (`supabase/migrations/20261123180000_bought_items.sql:30-32`).
- **Recipes have no unique-name rule.** `unique (household_id, name)` is on ingredients (`20261123140033_init.sql:40`); recipes have no such constraint and `save_recipe` does not add one. The fake's "no unique-name check on recipes" comment is stale, not a fidelity gap.
- **`finishShopping` is partial, not a no-op.** The fake records the call and clears the unread list (`fakeAdapter.ts:279-282`); it omits the Snapshot, the `skip_shopping` reset, the cart clear and the answers that the real transaction performs (`20261127100000_meal_checkins.sql:303-318`).
- **`ShopPage` is a documented exception, not an oversight.** `src/lib/api/README.md` says the page is "still on the old way" and that `useMutation({ mutationKey })` is by design for offline ticks. The candidate is therefore about where the behaviour lives, not about a missing migration step.

---

## 1. The fake Adapter does not honour the port Interface

**Files:** `src/lib/api/fakeAdapter.ts`; every `src/lib/api/*.test.ts`; `src/lib/shopMutations.test.ts`; the rules it is meant to mirror in `supabase/migrations/20261127100000_meal_checkins.sql` and `20261123180000_bought_items.sql`.

**Problem.** The second Adapter is what makes the `DataPort` Seam real, but several methods resolve successfully while violating the Interface's invariants.

- `checkins.finishShopping` (`fakeAdapter.ts:279`) records the call and clears the unread list. The real `finish_shopping` writes the Snapshot, clears every `skip_shopping`, soft-deletes the bought shopping items, and answers the remaining check-ins as `planned`, all in one transaction. A test of the actual outcome of "Done shopping" cannot pass against the fake today; a test that asserts `state.finishedShopping` passes while the real path differs.
- `checkins.answer` (`:260-265`) ignores the answer. `'not_cooked'` is supposed to set the Planned meal's `not_cooked` and thereby change the Replay; in the fake, all four answers are the same `splice`. The port's doc comment only promises the true/false retry result, so the stock consequence is an invariant the fake silently drops.
- `shop.buy` (`:240-247`) sets `checked = true` on the item, unlike the RPC. The Shop tab's list/cart rules then differ between the fake and production for ingredient-bound items.
- `trash.softDelete` (`:307-331`) silently succeeds for batches, adjustments, snapshots and recipe lines; the real RPC cascades them (ADR 0003). `shop.unbuy` hard-removes the batch instead of soft-deleting it and cascading its adjustments and Snapshot lines.
- The `// shortcut:` comments are honest, but a comment is not an Interface. "Two Adapters means a real Seam" also means the test Adapter must fail loudly when it cannot satisfy the Interface. Silent success turns "not covered" into "covered and passing".

**Solution.** Treat the fake as a contract Adapter. Make every branch that is not emulated throw a recognizable error instead of resolving, and implement the observable effects of the two central transactions: the Snapshot, Trip reset, cart clear and answers in `finishShopping`, and the answer semantics in `answer`. Then add one contract suite per aggregate whose assertions run against the fake in-process and against the Supabase Adapter on the local stack (the repository already has `supabase start` and SQL smoke tests). Do not weaken production rules to match the fake.

**Deletion test.** Delete the fake and every command test loses its Adapter, the `DataPort` becomes a one-Adapter hypothetical Seam, and the offline path loses its only injectable test stand-in. It earns its keep; the problem is fidelity, not existence.

**Benefits.**
- **Locality:** the server rules live once, in the contract suite, instead of in comments and migration memory.
- **Leverage:** every aggregate test gets stronger without new fixtures, and the fake can be extended on demand with a failing test rather than a silent branch.
- **Tests:** "Done shopping" can assert Snapshot quantities, cleared `skip_shopping`, an empty cart and answered check-ins; `answer('not_cooked')` can assert the meal's effect on current stock; `softDelete` on a batch stops passing while doing nothing.

---

## 2. Stock for the Trip is recomputed per screen

**Files:** `src/domain/replay.ts`; `src/lib/api/pantry.ts` (`usePantry`, `usePantryState`, `fetchPantry`); `src/pages/ShopPage.tsx:218-292`; `src/pages/PlanPage.tsx:67-86`; `src/pages/PantryPage.tsx:51-64`; `src/pages/UseSoon.tsx:9-19`.

**Problem.** `replay` is deep, but the Seam above it is shallow: every screen re-learns how to call it and what to do with the result.

- `ShopPage` calls `shoppingList` for the Trip's needs and then calls `shoppingList` **again** with an empty meal set to learn which needs are staples (`ShopPage.tsx:229-237`). Each call runs a full Replay internally; the second exists only to name a note on the row.
- `PlanPage` runs `replay(events, end)` to find batches that expire while a Planned meal eats them (`PlanPage.tsx:67-86`), re-deriving the "expiring soon" rule for a future day that `expiringSoon` already owns.
- `PantryPage` rebuilds per-Batch lines from `events.batches` plus `remaining` (`PantryPage.tsx:51-64`); `UseSoon` joins `expiring` back to Ingredients (`UseSoon.tsx:11-19`).
- `usePantryState` memoizes current stock for today only, so the Trip cannot use it for a future day. With Plan and UseSoon mounted, the same facts are replayed several times per screen.
- `usePantry` (`pantry.ts:32-41`) hides a dependency: the Pantry query function closes over `settings.timezone` and `settings.slots`, while its key is `['pantry']`. Its inputs are not part of its Interface, which is why `refreshPantry` has to remember to invalidate the settings row too.

The domain rule "a skipped meal is still eaten; it is only left off the shopping list" is applied in `shoppingList` and in `selectedMealIds`, but the *Trip* as a whole — range, selected meals, needs, staples, markers — has no Module. Its pieces are spread over `lib/trip.ts`, `domain/replay.ts`, `domain/toBuy.ts` and the pages.

**Solution.** Deepen one stock-for-the-Trip Module that answers the household's stock questions from the facts: current stock, stock usable on a day or over the Trip's range, shortfalls, expiring soon, the Trip's needs and which of them are staples, and the Plan's expiring markers. It owns the memoization and takes the Household Settings (timezone, `expiring_days`, horizon, slots) as explicit inputs rather than reading them ambiently. Keep `replay` and `shoppingList` as internal seams; callers should not have to know that `shoppingList` replays again. This is in-process work; no Adapter is needed at the new Seam.

**Deletion test.** Delete `shoppingList` and the Snapshot cut-off, FEFO, to-taste, per-meal amounts and min-stock rules reappear in `ShopPage`, `toBuy.ts` and the edge functions. It earns its keep. The missing piece is the Module callers meet: today they meet `replay` and then reinvent the rest.

**Benefits.**
- **Locality:** the staple rule and the expiring-marker rule become testable in one place; today both live in render code and no page has a test.
- **Leverage:** Plan, Pantry, UseSoon and Shop stop learning Replay's inputs and stop recomputing them.
- **Tests:** one fixture of facts plus Settings can assert needs, staple notes, markers, expiring batches and shortfalls through the Module's Interface; today the staple and marker rules have no direct tests, and the page-level results are only covered indirectly through the pure view.

**ADR check.** This does not conflict with ADR 0001; ADR 0001 says one pure Module computes current and projected stock, shortfalls, expiring soon and the shopping list. This candidate completes that intent at the caller Seam.

---

## 3. The Shop tab's orchestration has no Module

**Files:** `src/pages/ShopPage.tsx` (561 lines); `src/lib/shopMutations.ts`; `src/lib/api/shop.ts`; `src/domain/shoppingView.ts`; `src/lib/api/README.md`.

**Problem.** `buildShoppingView` is a deep pure Module (240 lines, 259 lines of tests) and `shopMutations` is a real offline Module, but the page owns the collaboration between them and the cache:

- the partner list-change signal: a baseline ref, a key ref, a resolved-key ref updated by three effects, a 3-second timer, the diff and the wording (`ShopPage.tsx:166-197`, `:319-330`);
- tick and untick routing across six mutation keys and to-taste device state (`:295-317`);
- device acknowledgements (`loadAcked`/`saveAcked`) plus an `IntersectionObserver` auto-ack (`:200`, `:347-355`, `:546-560`);
- the Trip inputs and the view (`:218-292`), the Setup screen's meal ordering (`:104-151`), two dialogs, and a handler that re-derives the checked item ids for "Clear checked" (`:435`).

The behaviours most likely to break — the partner toast, undo, offline tick ordering, the auto-ack — exist only inside a page that no test renders. `shopMutations` owns the writes but not when they run or what the screen shows; the page owns the other half. The offline design requires registration at boot, outside React, so the page cannot simply use the ordinary command path. That constraint is real; the missing thing is a Module with two Seams: the boot-time registration and the React-facing behaviour.

**Solution.** Deepen a Shop Module that owns the Shop tab's behaviour: the partner list-change signal, tick/untick/undo, the device acknowledgements, and the cache transitions those writes cause. It should expose intent-level operations to the page, with `shopMutations` as the offline Adapter behind it rather than a parallel owner. Keep the registration callable at boot with the one Adapter object, as the README describes. The page keeps layout, the dialogs' local state, and nothing else.

**Deletion test.** Delete `shopMutations` and six mutation functions, the optimistic reducers, rollback, boot registration and the "do not refetch while ticks are queued" rule reappear in the page and the aggregates. It earns its keep. But it is only the write half; the page still owns the behaviour.

**Benefits.**
- **Locality:** one place to change the toast window, undo, or tick ordering; `ShopPage` shrinks to rendering and dialog state.
- **Leverage:** Plan and Pantry do not need to know about mutation keys or the ack list; the Shop Module is the one caller of the offline Adapter.
- **Tests:** fake timers for the partner toast; order tests for tick → undo → tick; an offline-resume test through the Module, without rendering; a test that a partner's purchase is acknowledged by the observer. Today only the pure view and the registered functions are tested.

**ADR check.** No ADR conflicts. The README's "ShopPage is still on the old way" is a documented exception to a convention, not an ADR; the candidate preserves the boot-time registration the offline design needs.

---

## 4. The `['pantry']` cache value is an unnamed Interface

**Files:** `src/lib/api/pantry.ts:20-27` (owner); `src/lib/shopMutations.ts:23-31` and `:54-78` (second writer); `src/pages/ShopPage.tsx:255-259` (third writer); `src/lib/shopMutations.test.ts:11-18` (hand-built fixture).

**Problem.** `fetchPantry` returns a composite object and `usePantry` stores it under `keys.pantry.all()`. That object is the implementation of one query, but it behaves as an Interface for two other Modules: `shopMutations` restates its shape structurally as `Pantry`, reads and writes it with `getQueryData`/`setQueryData`, builds new batches into `events.batches` and `batchAuthors`; `ShopPage` casts the same entry to `{ meals: Meal[] }` to flip `skip_shopping` optimistically. Because the type is structural and the writes are generic, adding a field to `fetchPantry` does not produce a compiler error in the reducers. The contract is enforced by convention and one test that constructs the cache value by hand.

This is also the most delicate path in the app: offline ticks are paused mutations that replay after a reload, and the cache value is persisted. Drift here is expensive.

**Solution.** Name the cache value once, next to `fetchPantry`. Move the optimistic cache transitions (buy, unbuy, on-hand, checked, meal-skip) into one Module that owns that shape and is testable without React or TanStack Query. Have `shopMutations` and the Shop Module (candidate 3) call intent-level transitions instead of assembling `events` and `ingredients` themselves. Keep the persisted query key and its value format stable.

**Deletion test.** Delete the reducers and both the page and the mutation defaults have to build cache objects themselves; the complexity is not concentrated, it is duplicated. The Module earns its keep once it exists; today the cache shape is a pass-through that every writer must know.

**Benefits.**
- **Locality:** one place to change how Pantry facts are represented, enforced by the compiler.
- **Leverage:** three writers share one transition vocabulary, and the boot path does not import a React-bearing aggregate module (`shopMutations.ts:5` currently imports `localDay` through `api/pantry.ts`).
- **Tests:** the reducers become a Module with a named input, and the meal-skip optimistic edit — currently untested — gets a test; the offline path gains a test that a paused tick leaves the same cache shape as a live one.

---

## 5. One Household row, three keys, and five refresh helpers restating invalidation

**Files:** `src/lib/api/keys.ts:10-18`, `:28-30`; `src/lib/api/household.ts:16`, `:37-48`; `src/lib/api/checkins.ts:104-136`; `src/lib/api/pantry.ts:17`; `src/lib/api/shop.ts:12`; `src/lib/api/recipes.ts:21`; `src/lib/api/ingredients.ts:18`; `src/pages/PlanEntryModals.tsx:130`; `src/pages/SettingsPage.tsx:108-141`.

**Problem.** The same Household row is read through `['household']`, `['household','settings']` and `['household','slot_end_times']`, by `useHouseholdRow`, `useHouseholdSettings` and `useSlotEndTimes` (the last through the check-ins aggregate). The invalidation graph for that row is spread across four aggregate modules and three granularities:

- `updateHousehold` invalidates settings only, although it accepts `timezone` and the Pantry query closes over the timezone;
- `saveSlots` invalidates settings and the Pantry, but not `slotEndTimes`, which Settings renders;
- `saveSlotEndTimes` invalidates all of the Household;
- `refreshPantry` invalidates settings and the Pantry;
- `refreshShop` invalidates the Pantry, the shopping items and settings.

The same pattern repeats for every aggregate: `refreshHousehold`, `refreshPantry`, `refreshShop`, `refreshRecipes` and `refreshIngredients` are the retry and live-sync path, and each restates what its readers are. A refetch is not a write, so a command cannot express it; but the knowledge is now in two places per aggregate, and the copies can disagree. `keys.plan.plannedMeals` is invalidated by the recipe commands but no query reads it; it is a dead key that suggests an owner which does not exist.

The consequence is not always a permanently wrong value — TanStack refetches on mount by default — but correctness depends on mount and refetch timing rather than on the invalidation graph. Changing slots on the Plan tab can show Settings a stale slot list from the persisted cache until its refetch lands; a future `staleTime` or a second mounted screen would turn that into a visible bug.

**Solution.** Read the Household once and derive settings and slot end times from it; the row is small. Make the Pantry's inputs explicit in its Interface (it already receives the timezone and slots in `fetchPantry`), so a timezone or slot change is expressed as a dependency, not remembered by a helper. Declare each aggregate's readers in one place, so a command's `invalidates` and the retry helper cannot disagree; the retry path then asks for "everything this aggregate feeds" instead of restating the keys. Delete the dead key or give it a reader. Keep persisted key values stable where a paused mutation depends on them.

**Deletion test.** Delete `refreshShop` and `ShopPage` writes invalidation literals, breaking the README rule; the helper earns its keep. The problem is that each screen re-decides the set, so the knowledge is duplicated across the helpers and the commands.

**Benefits.**
- **Locality:** one staleness table for one row.
- **Leverage:** a new Household setting gets one invalidation edit instead of three to five coordinated ones.
- **Tests:** a matrix test that every writer's declared stale keys cover its readers, including the timezone → Pantry and slots → slot-end-times edges. Today the Household tests assert the two lists that exist, not the missing edges.

**ADR check.** ADR 0005 puts `slot_end_times` on the Household row and ADR 0002 keeps settings on that row; reading the row once is consistent with both. No conflict.

---

## 6. The domain depends outward on the port and database rows

**Files:** `src/domain/shoppingView.ts:2-8`, `:86`; `src/lib/api/port.ts:5-9`; `src/domain/pantryEdits.ts:1`; `src/pages/RecipeView.tsx:16`, `:21-23`; `src/pages/RecipeForm.tsx:13`; `src/pages/IngredientForm.tsx:19`; `src/pages/PantryPage.tsx:28`.

**Problem.** `shoppingView` is a domain Module, but it imports `Tables` from `lib/database.types`, `Buy`/`ShoppingItemRow` from `lib/api/port`, and pure helpers from `lib`. `port.ts` already type-imports `domain/replay`, `domain/checkinAnswers` and `domain/pantryEdits`, so the dependency is a type-level cycle, and the domain's own input type exposes snake_case database columns (`ViewIngredient`). The Module that ADR 0001 treats as the home of the logic is not independent of transport.

Small rules are duplicated at the same time: `SERVES` in `RecipeForm` and `RecipeView`, `round1` in `RecipeView` while `lib/format` exports it, `EPS` in `PantryPage` and `replay`, and the store categories in `IngredientForm` versus `STORE_WALK` in `shoppingView`. Each copy is a pass-through; together they show that the domain is not the single owner of its vocabulary.

**Solution.** Give the domain its own view input types (camelCase, only the fields the view reads) and map rows once where they enter the domain. Keep the purchase draft on the domain side and have the port import it, not the reverse. Move the small constants to their domain owners and reuse the formatting helper. Add a build-time import rule so `src/domain` cannot import `src/lib/api` or `database.types` again. This is in-process work with a build-time guard; no runtime Adapter is involved.

**Deletion test.** Delete the domain view types and the database row shape propagates into every caller of the view; the mapping is real work that belongs at one Seam. Deleting a duplicated constant concentrates nothing, which is why the constants are a symptom rather than the candidate.

**Benefits.**
- **Locality:** a row-shape change is handled at the mapping Seam, not throughout the domain.
- **Leverage:** the domain becomes testable with plain fixtures and stays reusable by the edge functions, which ADR 0004 already relies on.
- **Tests:** fixtures stop importing `Tables`; an import test prevents regression; the two `SERVES` copies and the two category lists cannot drift.

**ADR check.** No conflict; this strengthens ADR 0001's "the logic lives in one tested module".

---

## 7. Trip and list-change rules are split; device state rides along

**Files:** `src/lib/trip.ts` (54 lines); `src/domain/toBuy.ts`; `src/domain/toBuy.test.ts:4`; `src/lib/notify.ts:4`; `src/pages/ShopPage.tsx:26`, `:200`, `:347-355`; `supabase/functions/_shared/push.ts:10`; `supabase/functions/_shared/list.ts`.

**Problem.** `trip.ts` earns its keep: `tripRange`, `selectedMealIds`, `diffToBuy` and `changeMessage` are imported by the phone, the toast and the edge functions (ADR 0004 depends on the server and the phone agreeing by construction). But the Module bundles three kinds of thing:

- the pure Trip and list-change rules: `tripRange`, `selectedMealIds`, `diffToBuy`, `changeMessage`;
- per-device state: `loadAcked`/`saveAcked`, a localStorage list of acknowledged batch ids, capped at 200 and never pruned against live batches;
- UI formatting: `relativeTime`.

The shared rules are also split across the domain and the library: `toBuyKeys` and `resolvedKeys` live in `domain/toBuy.ts`, while `diffToBuy` — the same "resolved keys are not removed" rule — lives in `lib/trip.ts`, and the domain test imports it from the library. The edge path imports `trip.ts` through `notify.ts`, dragging the device-state module into Deno (the access is guarded, but unnecessary).

**Solution.** Put the pure Trip and list-change rules together in the domain, using the `CONTEXT.md` vocabulary (Trip, shopping list, resolved keys), and leave per-device acknowledgements in the device-state Module that the Shop Module consumes. Move `relativeTime` to the formatting Module. Do not move the diff or the wording out of the shared pure Module: ADR 0004 depends on the server and the phone producing the same message.

**Deletion test.** Delete `trip.ts` and the four pure rules reappear in `ShopPage`, `notify.ts` and the edge list, and the toast wording would be written twice. It earns its keep. The split is about what each caller needs, not about deleting it.

**Benefits.**
- **Locality:** the Trip rule the server and the phone share is isolated from device state and presentation.
- **Leverage:** the edge loader imports a dependency-free domain Module, and the phone and server share one definition of "what changed".
- **Tests:** `trip.test.ts` keeps the pure rules; ack storage gets a storage test; `relativeTime` gets a format test; `toBuy.test.ts` stops importing from `lib`.

---

## 8. `DataPort` and the planned-meal read model speak persistence

**Files:** `src/lib/api/port.ts:24-114`, `:116-235`; both Adapters; `src/lib/api/pantry.ts:20-27`; `src/domain/replay.ts:27-40`; `src/pages/PlanPage.tsx:22`; `src/pages/ShopPage.tsx:36`; `src/pages/CheckinModals.tsx:17-25`; `src/domain/toBuy.ts:8-13`; `supabase/functions/_shared/push.ts:137`.

**Problem.** `DataPort` has 12 groups and roughly 56 methods. Some are intent-shaped (`savePantryEdits`, `finishShopping`), some are single-column writes (`plan.setPortions`, `plan.setCook`, `shop.setChecked`), and the argument and return types are generated rows (`Tables<'...'>`, `PantryMealRow`, `ShoppingItemRow`) plus one UI-shaped type (`Buy` carries `name` and `unit`, which no Adapter reads; the page still adds the batch id and time). A page therefore has to learn Postgres column names and embed shapes, while the domain has its own camelCase `Meal` and `Ingredient`. The "Planned meal with recipe" shape is declared five times: `PantryMealRow`, the domain `Meal`, `PlanPage`'s `NonNullable<ReturnType<typeof usePantry>['meals']>[number]`, `ShopPage`'s `Meal`, and `CheckinModals`' `CheckinMeal`.

The Seam is real — two Adapters, command tests, an offline path — so this is not "remove the port". It is the Depth problem: the Interface is nearly as complex as the Implementation. Every new screen pays the mapping cost again, and adding a Planned meal field touches five declarations plus both loaders.

**Solution.** Stage it. First, one named read model for a Planned meal in the port, with the narrower page views derived from it and the UI-only fields removed from the purchase draft. Then shrink the port toward intent methods per aggregate and have both Adapters return the read models, so row mapping happens once per Adapter; keep `buy` and `unbuy` intent-shaped because offline idempotence depends on them. Finally, move the row-to-facts mapping behind the port so pages never see `PantryRows`. Update `src/lib/api/README.md` rule 3, which currently tells contributors to add `Tables<'...'>` types; otherwise the convention regrows. This is a remote-but-owned dependency, and the existing production and in-memory Adapters are the two that make the Seam real.

**Deletion test.** Delete the port and every page imports Supabase directly, the fake disappears as a test surface, and the offline resume path has no injectable Adapter. It earns its keep. Delete `PantryMealRow` without a replacement and the five meal shapes remain; naming one read model is the concentrating move.

**Benefits.**
- **Locality:** one row-to-read-model mapping per aggregate.
- **Leverage:** a page learns the Household's terms, not columns; a new screen does not re-map the same rows.
- **Tests:** fixtures stop importing `database.types`; the contract suite from candidate 1 can assert read models; a page test can build one Planned meal fixture instead of five shapes.

**Note.** The `src/lib/api/README.md` rule is a documented convention, not an ADR. This candidate asks to revise it explicitly, which is why it is called out rather than assumed.

---

## 9. The check-in's compound write has no Module

**Files:** `src/lib/checkin.ts`; `src/lib/api/checkins.ts`; `src/pages/CheckinModals.tsx:71-109`; `src/pages/ShopPage.tsx:263-273`; `src/domain/shoppingView.ts:15-27`; `src/domain/checkinAnswers.ts`; `supabase/functions/_shared/checkin.ts`.

**Problem.** The check-in Seam is mostly right. `src/lib/checkin.ts` is a deep pure Module (slot end time, due time, DST, recipients, payload, URL) shared by the phone, the push worker and `push-cron`; `src/lib/api/checkins.ts` is the aggregate Module; `_shared/checkin.ts` is the edge Adapter. The friction is the phone-side compound write: `AmountsModal.finish` saves the per-meal amounts and then answers the check-in `'changed'` as two separate commands, with the "only when unread" condition in the dialog and the failure path split (`CheckinModals.tsx:98-109`). `ShopPage.saveSnapshot` separately joins `snapshotPlan`, the unread list and the `not_cooked` set before calling `finishShopping` (`ShopPage.tsx:263-273`).

The rule "editing the amounts answers changed, after the lines are saved" is an invariant of the check-in, but it lives in a dialog. The ordering is correct today only because the dialog awaits the save before answering; no test covers a failed save that leaves the check-in unread, or an answer sent twice.

**Solution.** Deepen a phone-side check-in Module that owns the answer-after-edit flow and the "Done shopping" answer set as intent-level operations, so the dialogs collect input and render errors while the ordering, the only-if-unread rule and the failure path sit in one place. Leave the pure rules and the edge Adapter as they are; this candidate does not move check-in creation, the table, or the signed token.

**Deletion test.** Delete the pure `checkin.ts` and the app, the push worker and `push-cron` would each re-implement due time, DST and recipients; it earns its keep. The compound-write Module does not exist yet, so its complexity is not concentrated anywhere.

**Benefits.**
- **Locality:** one place for "amounts, then answer".
- **Leverage:** Plan, Shop and the notification deep link share one flow instead of three call sequences.
- **Tests:** "amounts save fails → no answer", "already answered → no second answer", and "the finish dialog's `not_cooked`" become Module tests; today they are dialog code with no coverage.

---

## 10. The facts loader is implemented twice

**Files:** `src/lib/api/supabaseAdapter.ts:183-206` (`pantry.rows`); `src/lib/api/pantry.ts:20-27` (`fetchPantry`); `supabase/functions/_shared/push.ts:114-152` (`loadHousehold`); ADR 0004; ADR 0003.

**Problem.** The pure pipeline is shared, which is the good part: both sides call `buildEvents`, `buildIngredients`, `toBuyKeys`, `resolvedKeys`, the Replay and the Trip rules. The loading is not. The client Adapter selects its embeds and relies on RLS to hide soft-deleted rows; the edge loader selects a different column list, adds `.is('deleted_at', null)` to every table and embed, and pages past the 1000-row cap. Shopping items are mapped to the domain `ShoppingItem` in the edge loader and again in `ShopPage`.

A schema change — a new soft-deleted child, a new embed the Replay needs — must be made in both, with different failure modes. The client cannot silently include deleted rows because RLS filters them; the edge loader that bypasses RLS can forget one filter and include deleted facts in a push or a check-in decision.

**Solution.** Extract the facts-loading Interface — the column and embed spec plus the row-to-facts mapping — into one Module that both the client Adapter and the edge Adapter import, with the deletion filter expressed once. Keep ADR 0004's decision that the edge function loads live rows and runs the shared Replay; do not move derived stock into the database. A database-side facts function is the alternative, but it centralizes the filter in SQL and changes where the facts are assembled, so it would need its own ADR.

**Deletion test.** Delete `loadHousehold` and the push functions cannot see the Household; it earns its keep. The duplication is inside it and `pantry.rows`.

**Benefits.**
- **Locality:** one spec for "what the Household's facts are".
- **Leverage:** both loaders receive a schema change at once.
- **Tests:** a contract test that loads one seed through both Adapters against the local stack and compares the resulting `PantryEvents`; today only the shared pure functions are tested, not their inputs.

**ADR check.** No conflict. ADR 0004 explicitly keeps row loading and the Replay in the edge function; this candidate shares the loader, not the decision. A derived table would contradict ADR 0001 and is not proposed.

---

## What's already good

- **`replay.ts` is a deep Module.** A small Interface hides the Snapshot cut-off, FEFO, expiry filtering, same-day Slot ordering, to-taste, per-meal amounts, min stock and packing; it is pure, tested (353 lines of tests) and cited by ADR 0001. Protect it.
- **`pantryRows.ts` is the model for shared mapping.** It owns its own row types, builds the same `PantryEvents` on the phone and in Deno, and has no dependency on the port. It is the pattern candidate 6 should copy, not a thing to re-suggest.
- **The `DataPort` Seam is real.** Two Adapters satisfy it; the fake supports call traces, `failNext`, event emitters and row factories; command tests cross the Seam without network or React. 249 tests run in about 1.5 s.
- **The command and key discipline mostly holds.** Pages do not import Supabase, do not write query-key literals, and declare invalidations next to the write; `keys.ts` centralizes the persisted key values, and the README documents the migration recipe.
- **The offline design is thoughtful.** Client-generated batch ids and times make buying idempotent, mutation defaults are registered before the cache is restored, optimistic reducers roll back, and `refreshAfterTick` avoids undoing queued ticks.
- **The pure Shop and check-in rules are strong.** `buildShoppingView`, `snapshotPlan`, `toBuy`, `checkinAnswers`, `dueCheckins`, `checkinPush` and the signed token are pure, tested and shared with the edge functions (ADR 0004, ADR 0005). The weakness around them is orchestration and fidelity, not the rules.
- **Soft delete, RLS, authorship and household scoping stay out of the UI.** The client reads live rows and never writes audit columns; the edge loader that bypasses RLS compensates explicitly and compares the shared secret in constant time.

## Assessed and not raised

- **Brief #10 (check-in rules split):** the split itself is not the problem. The pure rules, the aggregate Module and the edge Adapter are the correct three pieces; only the phone-side compound write is a real deepening, and that is candidate 9.
- **Brief #11 (`usePantry` couples settings to the Pantry):** the dependency itself is sound — timezone and slots are inputs to the facts. The friction is that the Pantry key does not name those inputs and the refresh helpers have to remember them; that is folded into candidates 2 and 5.
- **Brief #12 (`pantryRows.ts`):** already a good deep Module; noted above and not re-suggested.
- **Brief #8 (refresh helpers):** folded into candidate 5, which treats the whole invalidation graph rather than the helpers alone.
- **Brief #9 (type leaks):** folded into candidate 8; the five meal shapes have one root (the port's row-shaped read model) and one cheap first slice (one named Planned meal read model).

## Which of these would you like to explore?

The smallest high-value first step is candidate 1 (make the fake fail loudly, then add the contract suite), and the deepest is candidate 3 (the Shop tab's behaviour). Candidate 2 is the one that removes the most repeated work from the screens. Which candidate should we take into the design conversation?
