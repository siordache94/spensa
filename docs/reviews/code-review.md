# Code review: Spensa

Date: 2026-11-24. Scope: the whole app (`src/`, `supabase/migrations/`, `supabase/functions/`, `public/`), not a single diff. Read-only: no source was changed.

Sources for **Spec**: `PRODUCT.md`, `CONTEXT.md`, `README.md`, `PRIVACY.md`, and `docs/adr/0001`–`0005`.
Sources for **Standards**: `CONTEXT.md`, `DESIGN.md`, `README.md`, `src/lib/api/README.md`, `.oxlintrc.json`, and the conventions visible in the existing code (the API seam, command/keys discipline, pure domain modules).

Severity: **blocker** = data loss or a promised feature that cannot work; **major** = wrong behaviour, integrity, privacy, or an untrustworthy test seam; **minor** = limited or edge-case impact; **nit** = clarity/consistency.

## Verdict

The core model is strong: the replay, snapshot, soft-delete/RLS and check-in designs match the ADRs closely, the SQL smoke suites pass, and the API seam is real. The most serious problems are at the two edges where the app meets reality: **the supermarket touch path** (a held-row tap un-ticks the partner's purchase; Undo/Finish can race queued ticks) and **the browser/server boundary** (CORS makes account deletion and push tests fail). Two multi-writer integrity gaps (double-buying one list item, finishing a trip from a stale snapshot) can silently corrupt stock.

---

## Spec

### Blocker

#### S1. Acknowledging a partner-ticked cart row also un-ticks it

`src/pages/ShopPage.tsx:442-464`, `:547-560`; `src/pages/shop.css:53`; `DESIGN.md:226-227`.

The held row has `onClick={() => runUntick(c.untick)}`. The visible `.sp-ack` button is a child of that row and its click handler only calls `onAck`; it does not stop propagation. React bubbles the click to the row, so one tap on the yellow "ticked by partner" overlay:

1. acknowledges the highlight (`acknowledge(c.id)`), then
2. runs `unbuy` / `unOnHand` / `uncheck` on the partner's item.

For a partner's batch, `unbuy` soft-deletes the batch and puts the list item back — the partner's purchase disappears from the pantry. This directly contradicts `DESIGN.md:227` ("An invisible full-row button acknowledges it, which clears the highlight") and PRODUCT principle 3 ("forgiving of mis-taps"). The keyboard path already branches correctly (`:452`), which confirms the intended behaviour.

Fix: make the row handler branch on `c.held` (`if (c.held) acknowledge(c.id); else runUntick(c.untick)`), or `ev.stopPropagation()` in `AckButton` and remove the row's untick for held rows. The overlay is also a `<button>` nested inside a `role="button"` row (same for the pencil on every row), which is invalid ARIA; making it a sibling/absolute button outside the row's clickable region fixes both. Add a component test that clicks the overlay and asserts exactly one ack call and **no** `shop.unbuy`.

#### S2. `delete-account` and `push-test` fail browser CORS preflight

`supabase/functions/delete-account/index.ts:7-15`; `supabase/functions/_shared/push.ts:13-18`; `supabase/functions/push-test/index.ts:5`.

Both functions answer `OPTIONS` with a headers object that has `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers` but **no `Access-Control-Allow-Methods`**. `supabase.functions.invoke()` sends `Authorization` (and a JSON content type when there is a body), so the browser always preflights a cross-origin POST. A preflight response without `POST` in `Access-Control-Allow-Methods` is rejected by the Fetch spec; the request never reaches the function. `checkin-answer/index.ts:8` already does this correctly, which shows the intended shape.

Impact: Settings → "Delete my account" and "Send me a test notification" are both unusable in a browser. The deletion path is also the GDPR right promised by `PRIVACY.md:45` and `README.md:79`. The README's note that the button works once the function is deployed is therefore inaccurate.

Fix: add `'Access-Control-Allow-Methods': 'POST, OPTIONS'` to the shared `cors` object and to `delete-account`'s local copy (or import the shared one). A quick `curl -i -X OPTIONS` against the served function should show it.

### Major

#### S3. Two phones can buy the same manual item twice, creating two batches

`supabase/migrations/20261123180000_bought_items.sql:12-36`; redefined in `20261124100000_soft_delete_and_authorship.sql:318-341`.

`buy_shopping_item` is idempotent only on `batch_id`. It inserts the batch unconditionally, then updates the item only `where bought_batch_id is null`. If both phones tick the same list item at the same time, each client generates a different `batch_id`; both inserts succeed, one link wins, and the pantry gains two batches (double stock). `item_found` still returns true for the losing call, so the client sees success. This is exactly the "two people, one pantry" case in `PRODUCT.md:50` and `CONTEXT.md:28`.

Proven locally in a rolled-back transaction: two calls with different `batch_id`s produced `batches = 2`, with the item linked to the first.

Fix: lock the item (`select bought_batch_id ... for update`), and if it is already bought, return `{ item_found: true, already_bought: true }` without inserting. Also validate that `ingredient_id` equals the item's `ingredient_id` (today the RPC trusts the client's ingredient). Add a second smoke assertion for two different batch ids.

#### S4. Shop mutations are not ordered: Undo can overtake the tick, and Finish can overtake ticks

`src/lib/shopMutations.ts:121-165`; `src/pages/ShopPage.tsx:243-249`, `:296-317`, `:469-473`.

All shop writes are plain mutations with distinct keys (`buy`, `unbuy`, `check`, ...), and the shop mutations themselves have no `scope`. TanStack runs unscoped mutations in parallel; after a reload, `resumePausedMutations()` resumes every paused mutation with `Promise.all` (`@tanstack/query-core` `MutationCache.resumePausedMutations`). Therefore:

- tick → Undo can send `unbuy` before `buy` has created its batch. `unbuy` is a no-op on an unknown batch and then `buy` inserts it; the Undo toast disappears but the item stays bought.
- tick → "Done shopping" can send `finish_shopping` before the batch exists; the snapshot then references an unknown `batch_id` and the whole RPC fails on the `snapshot_batches` FK.
- When offline, both are paused and resume in parallel, so the race is deterministic-ish rather than rare.

This undermines "one or two taps, undo over confirm" (`PRODUCT.md:49`) and the offline queue story. The header even shows "Offline — n waiting" while Finish remains enabled.

Fix: give every shop mutation (including `finish_shopping`) `scope: { id: 'shop' }` so TanStack serialises them; additionally disable Finish while `useWaitingShopMutations() > 0` or make `saveSnapshot` await the queue. Add a test with a delayed `shop.buy` and an immediate `unbuy`/`finish`.

#### S5. `finish_shopping` trusts a client-computed snapshot and can silently drop stock

`supabase/migrations/20261123143248_atomic_snapshot_and_buy.sql:5-21`; `supabase/migrations/20261127100000_meal_checkins.sql:304-321`; `src/pages/ShopPage.tsx:268-273`.

`save_snapshot` inserts exactly the `batch_id`s the client sends. Replay treats a batch as covered by a snapshot when `recorded_at <= snapshot.taken_at` and the snapshot does not list it (`src/domain/replay.ts:160-167`, ADR 0001 "Ordering"). Two races follow:

- **Unseen partner batch → lost stock.** The partner ticks milk at 10:00; this phone's cache is stale; this phone finishes at 10:01. The new snapshot omits milk, and milk's `recorded_at` (10:00) is not after `taken_at` (10:01), so the replay never adds it. Milk vanishes from stock even though nobody unbought it.
- **Optimistic/queued batch → FK failure.** If a tick is still queued or in flight, its batch may not exist when the snapshot line is inserted; the whole `finish_shopping` transaction rolls back with an opaque FK error.

ADR 0001 says `finish_shopping` writes the snapshot "in one transaction with the batches it covers"; the server currently has no way to know that the list is complete. ADR 0005 also notes that `not_cooked` answers must be applied to the snapshot; that part is correct (answers are applied before the snapshot in `finish_shopping`).

Fix: make the snapshot server-authoritative (compute `remaining` inside the RPC, or accept a `seen_at` baseline and reject/merge any batch recorded after it), and/or block Finish until the shop queue is empty (S4). At minimum, reject unknown batch ids with a clear message rather than an FK error.

#### S6. Timezone is not editable anywhere, but it drives every day boundary

`CONTEXT.md:30`; `src/pages/SettingsPage.tsx:46-106`; `src/lib/api/household.ts:36-40`; `supabase/migrations/20261123140033_init.sql:13`.

`CONTEXT.md` lists timezone among the shared settings, and `HouseholdUpdate` supports it, but Settings has no timezone control. The database default is `Europe/Rome`, and `create_household` does not set the creator's zone. For a household outside Rome, "today", replay day boundaries, check-in due times, expiry reminders and `addedOn` are all wrong, with no in-app way to correct them. This is more than cosmetic: it changes what is short and when check-ins are created.

Fix: add a timezone picker (e.g. `Intl.supportedValuesOf('timeZone')` or a small curated list) to Settings, saved through `updateHousehold`; initialise new households from `Intl.DateTimeFormat().resolvedOptions().timeZone`, or prompt on first run. Add a command test asserting the pantry is invalidated when timezone changes (see ST3).

#### S7. Household data survives sign-out in localStorage; `useMyId` can stay on the previous user

`src/main.tsx:21-46`; `src/lib/api/keys.ts:60-68`; `src/App.tsx:215-234`; `src/pages/HouseholdPage.tsx:35`; `src/lib/api/auth.ts:43-46`; `PRIVACY.md:15`.

The persisted TanStack cache contains all household queries for seven days. `shouldPersistQuery` excludes only `['auth','session']`. The only ordinary sign-out that clears it is the household menu (`App.tsx:66`); `useDeleteAccount` also clears after a successful deletion. The other sign-out paths do **not** clear it:

- `verifyUser()` returning `invalid` calls `api.auth.signOut('global')` directly (`App.tsx:227`, `:230`).
- `HouseholdPage`'s "Sign out" uses the bare `signOut` command (`HouseholdPage.tsx:35`).
- A server-side session expiry triggers `onSessionChange(false)` but no clear.

After that, the next person who signs in on the same browser can briefly see the previous household's cached shell/pantry before refetch, and while offline can read it from localStorage. `useMyId` is cached with `staleTime: Infinity` and persisted, so partner highlighting, cook actions and push-prefs keys can use the old user's id after an account switch. `PRIVACY.md:15` lists device settings (theme, density) as the browser-only data and does not disclose the persisted query cache.

Fix: centralise teardown on every transition to signed-out (including session expiry): `queryClient.clear()` plus `persister.removeClient()` (or the equivalent raw remove), then let sign-in repopulate. Invalidate or remove `keys.auth.uid` on session changes, and namespace user-scoped query keys by user id if the cache must survive. Update the privacy notice to disclose the offline cache and its lifetime.

#### S8. Offline access ends when the Supabase access token expires; the cached app becomes unreachable

`src/lib/api/supabaseAdapter.ts:21-24`; `supabase/config.toml:166`; installed `@supabase/auth-js` `GoTrueClient.__loadSession` (returns `{ session: null }` when the stored token is past expiry and the refresh call fails).

`App` gates the whole shell on `api.auth.session()`. `getSession()` refreshes an expiring token; offline the refresh fails, and once `expires_at` has really passed auth-js returns `null`. The user is then shown the sign-in page even though the query cache is persisted. With `jwt_expiry = 3600`, a shopping trip that starts more than an hour after the last successful refresh, with no connectivity, cannot open the cached list. This contradicts the offline emphasis of `PRODUCT.md:11`/`:32` and `CONTEXT.md:28`.

This is a product decision, not a one-line bug: offline use of an expired session has a security trade-off. Options: a deliberate offline grace period (keep using the last session until connectivity returns), a longer JWT for the hosted project, or document that offline only works within the token lifetime. In any case, add a device test: go offline, wait past expiry, reload, confirm the intended behaviour.

### Minor

#### S9. Markdown instructions are stored but rendered as plain text

`src/pages/RecipeView.tsx:18-19`, `:101`; `src/pages/RecipeForm.tsx:212`; `PRODUCT.md:29`; `CONTEXT.md:12`.

The spec says recipes hold **markdown** instructions; the form even says "Markdown is fine", but the view renders the raw string with `whiteSpace: pre-wrap` and a `// shortcut:` comment. Users see `##`, `**`, lists and links literally. This is a partial implementation of a stated capability. Fix: render sanitised markdown (e.g. `react-markdown` + `rehype-sanitize`; the repo currently has no `dangerouslySetInnerHTML`, keep it that way) or change the spec and placeholder to plain text. If rendering is added, test a malicious `<img onerror>`/script payload.

#### S10. Sign-up with "Confirm email" on leaves the page with no feedback

`src/pages/AuthPage.tsx:26-38`, `:82-84`; `src/lib/api/supabaseAdapter.ts:30-34`; `README.md:72`.

`auth.signUp` discards `{ user, session }`. When the hosted project has "Confirm email" enabled (recommended in the README), the call succeeds but returns no session; `signedIn` stays false and the form looks unchanged. The user has no "check your email" message and may retry, creating duplicate attempts. Fix: return `{ needsConfirmation: boolean }` from the port, and show a success state when `session === null`. Also add a resend-confirmation action if the project keeps confirmations on.

#### S11. A reminder time after the last 15-minute tick but before midnight is silently skipped

`src/lib/notify.ts:63-69`; `supabase/migrations/20261126100000_push.sql:193`.

`reminderDue` computes minutes since midnight for the current local day and requires `minutes >= at && minutes < at + 180`. The window is truncated at 1440 when the clock wraps. The cron runs at `:00/:15/:30/:45`; a time such as `23:50` falls between the 23:45 and 00:00 ticks, and at 00:00 the day has rolled over, `minutes` is 0, and the condition is false. The reminder is skipped for that day (and the next chance is the following day). A time of 23:30 still catches the 23:30 tick, so this is not every late time, but it is a real hole. Default 09:00 is fine.

Fix: compare an absolute instant (build the reminder instant with the same `zonedInstant` helper as check-ins) or wrap the minute comparison across 1440 and handle the day rollover/`expiry_checked_on` carefully. Add tests at 22:00, 23:30, 23:50 and 00:10.

#### S12. "Done shopping" leaves per-trip UI state behind

`src/pages/ShopPage.tsx:203`, `:209`, `:263-266`, `:522-527`.

On a successful finish, only the dialog and edit mode close. `notCooked`, `tasted` and `undo` are not reset. `notCooked` is mostly dead state today because an answered check-in cannot become unread again (`meal_checkins.planned_meal_id` is unique), but it keeps meal ids from a finished trip and would silently pre-select one if that id ever became unread again (e.g. a restore/import path). `tasted` keeps to-taste rows in the cart after the trip ended, and `undo` can still remove a batch that was just included in the saved snapshot. Fix: clear all three in `finishShopping`'s `onSuccess` (and optionally when the finish dialog opens).

#### S13. Deletions are reversible in the model but "for good" and without undo in the UI

`src/pages/RecipeView.tsx:143`; `src/pages/IngredientForm.tsx:139`; `src/pages/PlanPage.tsx:222`; `src/lib/api/recipes.ts:55-60`; `PRODUCT.md:49`; `CONTEXT.md:22`; ADR 0003.

The app calls `trash.softDelete`, `restoreRecipe` exists but is commented "Not used by a page yet", and Ingredient/Recipe deletion is a two-step confirm labelled "Delete for good". That wording is false: the rows are retained (and `PRIVACY.md:36` says so). It also goes against PRODUCT's "undo over confirm". ADR 0003 explicitly defers a History screen, so this may be acceptable for now, but the label should not claim permanence; a small "Deleted — Undo" toast using the existing restore command would close the gap for the common mis-tap.

### Nit

- **S14. `BuyModal pending={false}`** (`src/pages/ShopPage.tsx:502`, prop at `:42`, used at `:76`). The Buy button can never show loading because the modal is closed immediately and `withIds` is fire-and-forget. Either remove the prop or `await buy.mutateAsync` and close on success/keep open on failure.
- **S15. `snapshotPlan`'s `skipped` holds meal ids, not skipped batches** (`src/domain/shoppingView.ts:23`). Rename to `notCookedMealIds`; no behaviour change.
- **S16. `fefo(ingredientId, null)` includes expired batches** (`src/domain/replay.ts:128-131`, `:153`). ADR 0001 only constrains meals to unexpired batches; the app always passes a `batch_id` for pantry adjustments, so this is latent. Document/test the intended auto-target policy or filter expired batches for `used`/`set`; today a null-targeting `used` would consume expired stock first.
- **S17. Deleting an ingredient silently drops live per-meal overrides** (`supabase/migrations/20261127100000_meal_checkins.sql:174-185`; guard at `20261124100000:157-160` only checks `recipe_ingredients`). `CONTEXT.md:16` says per-meal amounts can add/replace ingredients; deleting one of those ingredients cascades the line, so the meal silently falls back to the recipe or loses the ingredient. Either refuse the delete while a live meal line uses it (and list those meals) or document the cascade.
- **S18. `push-cron` loads the member list twice per subscribed household** (`supabase/functions/push-cron/index.ts:45`, `:55`; `flushList` also loads them). One load can serve the reminder loop and `runCheckins`. Minor cost per 15-minute tick, but easy to remove.
- **S19. `purge_user` leaves the user id in `push_list_state.window_authors`** (`supabase/migrations/20261126100000_push.sql:83`; purge at `20261125100000_closed_signups_and_gdpr.sql:69-84`). `household_events.by` is cleared, but the open-window author array is not. Remove the uid from that array too (or rely on the next window), for consistency with the anonymity promise.
- **S20. `save_snapshot` trusts the client's `on_date`** (`supabase/migrations/20261123143248:5-21`). A phone with a wrong clock (or a bug) can save a future-dated snapshot and hide meals/stock. Validate against the server's household-local date (the household row is available) or at least enforce monotonic, sane dates.

---

## Standards

### Major

#### ST1. The fake adapter silently succeeds where the server would not; the test seam can hide production bugs

`src/lib/api/fakeAdapter.ts:259-265`, `:279-282`, `:240-247`, `:307-331`, `:225`, `:315-320`; `src/lib/api/checkins.test.ts:64-75`; `src/lib/api/api.test.ts:54-64`.

Concrete divergences:

- `checkins.answer` ignores the `answer` value (`:260`), so a test cannot distinguish `planned`, `not_cooked` or `dismissed`.
- `checkins.finishShopping` only records the call and clears the unread list (`:279-282`). It does not write the snapshot, clear `skip_shopping`, apply `not_cooked` answers, or answer remaining check-ins as the real `finish_shopping` does. The test at `checkins.test.ts:64-75` only asserts the recorded arguments and the unread list, so the central transaction is effectively untested.
- `shop.buy` sets `checked = true` on the bought item (`:245`); the real RPC only sets `bought_batch_id` (`20261123180000:30-32`). Production does not check ingredient-bound items; a test that relies on the fake's `checked` can pass while production UI behaves differently.
- `pantry.saveEdits` only records (`:225`); `shop.setChecked` etc. are correct, but edits never reach the fake's batches.
- `trash.softDelete` is a no-op for batches/adjustments/snapshots/recipe_ingredients/snapshot_batches (`:324`), and `restore` does not cascade to children or check parents (`:326-331`). The recipe delete guard also blocks **any** live meal, whereas the server only blocks meals after the latest snapshot (`:315-320` vs `20261124100000:161-167`).
- `pantry.rows` does not filter deleted snapshot lines (`:217-225`), unlike the server's cascade.

`src/lib/api/README.md` rule 3 and step 5 require the fake to mirror the rules the page relies on; a silent success is worse than a missing method. The architecture review (`docs/reviews/architecture.md`, finding 4) already flagged this; it is still open.

Fix: implement the visible effects of `finish_shopping` and `softDelete` for the tables the UI touches; make unsupported branches throw `ApiError('not faked: ...')`; correct `shop.buy`; add one contract test per aggregate that asserts observable state, not just `api.calls`.

### Minor

#### ST2. `src/domain` depends on the transport/database types, creating a type-level cycle

`src/domain/shoppingView.ts:2-5` imports `Tables` from `src/lib/database.types.ts` and `Buy`/`ShoppingItemRow` from `src/lib/api/port.ts` (plus `src/lib/shopList.ts` and `src/lib/format.ts`). `src/lib/api/port.ts:5-9` imports domain types. ADR 0004 relies on the domain being pure TypeScript that Deno can import; the runtime works, but the dependency arrow points outward and `ViewIngredient` exposes snake_case database columns inside the domain.

Fix (staged): define the small read models the domain needs (`CatalogueIngredient` with camelCase fields, `ShoppingItem`, `BuyDraft`) in `src/domain`, map once in the adapters/`fetchPantry`, and have `port.ts` import those. Move the pure `round*` helpers to a dependency-free module (or keep them shared but not via the API layer). A small import-boundary test can prevent recurrence.

#### ST3. Invalidation lists are incomplete; tests encode the gap and rely on the global realtime signal

`src/lib/api/household.ts:37-48`; `src/lib/api/checkins.ts:104-109`; `src/lib/api/household.test.ts:33-44`; `src/App.tsx:140`/`src/lib/api/checkins.ts:55-57`.

`updateHousehold` invalidates only `keys.household.settings()` even though it accepts `timezone`, and the pantry's `addedOn`/shortfall days depend on it. `saveSlots` does not invalidate `keys.household.slotEndTimes()`. The command test explicitly asserts that `updateHousehold` does **not** invalidate the pantry (`household.test.ts:33-44`). Today the mounted `useCheckinsSync` invalidates `pantry` + all household keys on every `household_events` change, so online users are rescued; that is an accidental global dependency, not a declared contract. Offline, or if the signal is disconnected, the stale value is visible.

Fix: include `keys.pantry.all()` in `updateHousehold` (at least for timezone/slots), include `keys.household.slotEndTimes()` in `saveSlots` (or invalidate `keys.household.all()`), and update the tests. If the global signal is intended as the only refresh mechanism, document that instead of asserting the gap.

#### ST4. Household updates rely on RLS instead of naming the row

`src/lib/api/supabaseAdapter.ts:69-72`, `:288-290`.

`.update(patch).not('id', 'is', null)` relies on the update policy matching exactly one row. With one household per user today it works, but a zero-row update is silently reported as success (e.g. no household / future multi-household membership), and `saveSlotEndTimes` repeats the trick. When `household_members.user_id` uniqueness is ever relaxed (ADR 0002 says that is the plan for multiple households), these calls would update every household the user belongs to.

Fix: update by the known id (`eq('id', ...)`) or through a security-definer RPC that resolves `my_household()`, and check the affected row count.

#### ST5. `usePantry`'s `tz!` hides a dependency and the query key does not encode its inputs

`src/lib/api/pantry.ts:30-35`.

The pantry query is disabled until settings load and then uses `tz!`; the key is only `['pantry']`, while the value depends on `timezone` and `slots`. If the settings query fails permanently, the pantry never starts; if settings change, only the realtime signal/declared invalidations refresh it (see ST3). The composed `error` masks the first case on the page, but the assertion is fragile.

Fix: key the query by its inputs (`['pantry', tz, slots.join('|')]`) or read the household row in one query so the dependency is explicit; keep the persisted key format stable if offline ticks depend on it.

#### ST6. Lint is clean of errors but leaves actionable warnings, including refs read during render

`src/pages/PlanPage.tsx:101`, `:67`, `:86`, `:106`; `src/components/UndoToast.tsx:17`; `src/pages/ShopPage.tsx:550`; `src/pages/SettingsPage.tsx:23`, `:53`, `:115`; `src/components/Stepper.tsx:29`.

`npm run lint` exits 0 with 18 warnings: 8 `only-export-components` (fast-refresh only), 5 `set-state-in-effect` (form drafts synced to server data — acceptable), 2 React Compiler memoization warnings in `PlanPage`, 2 `refs` warnings and 1 `exhaustive-deps`.

The two ref writes during render (`ack.current = onAck`, `expire.current = onExpire`) are the pattern React 19's compiler warns about; move them to `useEffect`/callback refs, or use `useEffectEvent`. The `PlanPage` missing `answer` dependency is **not** a stale-closure bug today: `useCommand`'s `mutate` is stable and the effect is ref-guarded; including `answer` would satisfy the rule but re-run the effect (guarded). Fix it for clarity. The compiler warnings mean PlanPage is not being optimized; they are not correctness bugs.

#### ST7. Tests are strong on pure logic, weak on the seams where the serious bugs live

`src/lib/api/checkins.test.ts:64-75`; `src/lib/api/api.test.ts:54-64`; `src/lib/pantry.test.ts:1-11`; `src/domain/toBuy.test.ts:57-60`.

249 Vitest tests pass and cover replay, shopping view, check-ins, tokens, notify, push worker and command invalidation well. Missing:

- no adapter contract tests for `supabaseAdapter` (it is never exercised; only the fake is);
- no page/component tests, so S1 (held row), S4 (queue ordering) and the Finish dialog are untested;
- no test for the double-buy RPC or the snapshot completeness race (the SQL smoke tests cover the happy paths only);
- `src/lib/pantry.test.ts` has no `src/lib/pantry.ts`. It is a leftover from before the API migration: it dynamically imports `./api/pantry` just to test `localDay`, which now lives in `src/domain/pantryRows.ts` and is already covered by `src/domain/toBuy.test.ts:57-60`. The `vi.mock('./supabase')` exists only to keep the old import graph loadable. Delete it or move the assertion to a `pantryRows` test.

Also add the new `checkin_smoke` to the README loop (`README.md:49` currently runs only `rls_smoke rpc_smoke gdpr_smoke push_smoke`).

#### ST8. Design-system conformance: tap targets, red usage, and a menu shadow

`DESIGN.md:199-202`, `:247`, `:253`, `:264-270`; `PRODUCT.md:54`; `src/pages/PlanPage.tsx:149`, `:155`; `src/pages/ShopPage.tsx:378`; `src/pages/PantryPage.tsx:262-263`; `src/pages/SettingsPage.tsx:97-103`; `src/pages/RecipeForm.tsx:151`; `src/pages/RecipeView.tsx:143`; `src/pages/IngredientForm.tsx:139`; `src/pages/AccountData.tsx:59`, `:73`; `src/App.tsx:88`.

- DESIGN specifies 44px tap targets and explicitly calls the "Slots" and "This week" controls 44px text buttons; both are `Button size="xs"` (Mantine ~22px) with no `mih`. "Edit trip" is `size="sm"`. Several Settings/Notification buttons are `sm`, the recipe close button is 36px, and the Pantry save bar's Save/Discard (`PantryPage.tsx:262-263`) and Settings' Save are default `md` (~36px). The shop's main tick targets are correctly 44px, but many secondary/primary form actions are below the documented floor. Fix with `mih={44}` or a theme-level minimum for buttons above a certain importance.
- DESIGN says red is *only* shortfall/error, but destructive buttons use `color="red"` ("Delete for good", "Delete forever", meal Delete). Either use a neutral destructive treatment or amend DESIGN to allow red for destructive actions.
- `Menu` defaults to no shadow (`src/theme.ts:50-52`) but `HouseholdMenu` passes `shadow="md"` (`App.tsx:88`), breaking "no shadows except the trip pass/dock".

#### ST9. Board-row tap semantics drift from DESIGN

`src/pages/ShopPage.tsx:400-424`; `DESIGN.md:217`.

DESIGN says the whole row ticks, and **tapping the name opens the amount editor**. The implementation makes the whole row tick and only the explicit pencil opens the editor (the code comment explains that label forwarding was unreliable on touch). The pencil-only affordance is arguably better for mis-taps, but the design document now describes a different interaction. Decide which is the standard and update the other; if the row stays as-is, update DESIGN.md so future UI work does not reintroduce the ambiguous name-tap.

### Nit

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| N1 | Domain/UI micro-rules duplicated: `round1`, `SERVES`, categories, `EPS` | `RecipeView.tsx:16`,`:21-23`; `RecipeForm.tsx:13`; `IngredientForm.tsx:19`; `shoppingView.ts:32`; `PantryPage.tsx:28`; `replay.ts:87` | One `SERVES`/`round1`/category constant; import it everywhere |
| N2 | `keys.plan.plannedMeals` is declared and invalidated but no query reads it | `keys.ts:28-30`; `recipes.ts:64` | Delete it or make the planner read it |
| N3 | `save_inventory_check` is still granted to authenticated but the app no longer calls it | `20261123162602_inventory_check.sql:7-51`; `20261123200000_save_pantry_edits.sql:5` | Remove it or document a planned use; it expands the RPC surface |
| N4 | `fakeAdapter`'s "no unique-name check on recipes" comment implies a server rule that does not exist | `fakeAdapter.ts:174`; no recipe-name unique constraint in any migration | Correct the comment (or add the rule in both places if desired) |
| N5 | `PantryPage`'s edit-mode total counts rows marked "Removed" | `PantryPage.tsx:29`, `:164` | Skip `l.removed` in `total` |
| N6 | `.sp-short` style is unused; Plan rows never show the red short marker DESIGN describes | `plan.css:28`; `PlanPage.tsx:197-205`; `DESIGN.md:235` | Render the marker or delete the rule |
| N7 | `userChecked` ref never resets, so after a sign-out/sign-in in one tab the new session is not re-verified | `App.tsx:213-234` | Reset on `signedIn === false`, or key the effect by user |
| N8 | Every household event invalidates pantry twice (ShopPage's `refreshShop` and `useCheckinsSync`) | `ShopPage.tsx:186`; `checkins.ts:56`; `shop.ts:12` | Let one owner invalidate; the other subscribe/skip |
| N9 | Production JS is 1.06 MB (307 KB gzip) in one chunk; no lazy routes | `npm run build` output; `App.tsx:170-177` | Route-level `lazy()` for Settings/Recipes at least, or accept and raise the warning limit |

---

## What's solid

- **The replay is the design centre and is ADR-faithful.** `src/domain/replay.ts` handles snapshot coverage by server time (`recorded_at`), FEFO with expiry, same-day slot order, per-meal overrides, shortfall capping, staples and packing. The tests cover the subtle parts (equality at snapshot time, offline adjustments, expiry on the meal day).
- **Soft delete, authorship and household scoping are done properly.** Composite FKs, partial unique indexes, the `BEFORE DELETE` conversion, `security definer` soft_delete/restore with explicit household filters, live-only RLS policies, and the `household_events` signal all match ADR 0002/0003. The SQL smoke suites exercise them well.
- **The signup hook is correctly placed and correct in substance.** `hook_before_user_created` reads `user_metadata.invite_code` (the field `signUp({ options: { data } })` writes), lowercases the email for the allowlist, and OAuth cannot smuggle an invite code; `README.md` correctly documents that Google sign-ups need the allowlist.
- **The check-in design is coherent.** `meal_checkins` as its own table, unique `planned_meal_id`, service-role creation, first-answer-wins, the `not_cooked` trigger, the signed-token path limited to one idempotent action, and the finish-dialog answers all line up with ADR 0005. SQL tests prove the cascade/restore and token cases.
- **Push plumbing is careful.** The 30-second window is atomic in SQL, the secret comparison is constant-time, `push-cron` sweeps stale windows, service-role reads filter `deleted_at` explicitly, PostgREST's 1000-row cap is handled by `all()`, and soft-deleted embed filtering was verified to preserve meals with deleted recipes (as intended). Unread counts and per-recipient tokens are consistent.
- **The DataPort seam is real and mostly disciplined.** Two adapters, command/`keys` centralisation, no page `supabase` imports, and offline registration at boot before cache restoration are good. 249 tests run in ~2 s.
- **The UI is much closer to the design system than typical.** Themes/density tokens, the yellow-on-ink rule, held-row wash, trip pass, focus rings, and the 44px rows/ticks are implemented consistently; the remaining conformance issues are listed above.

## Checks run

| Check | Result |
|-------|--------|
| `npm run lint` (`oxlint`) | exit 0, 18 warnings, 0 errors (see ST6) |
| `npx tsc -b --noEmit` | exit 0 |
| `npx vitest run` | 31 files, 249 tests passed |
| `npm run build` | exit 0; one 1.06 MB JS chunk (307 KB gzip) warning |
| `npm run check:functions` (`deno check`) | exit 0 |
| `supabase/tests/rls_smoke.sql` | passed |
| `supabase/tests/rpc_smoke.sql` | passed |
| `supabase/tests/gdpr_smoke.sql` | passed |
| `supabase/tests/push_smoke.sql` | passed |
| `supabase/tests/checkin_smoke.sql` | passed |
| Local REST experiment: two `buy_shopping_item` calls for one item with different batch ids | produced **2 batches** (S3 confirmed); rolled back |
| Local REST experiment: embedded `recipes.deleted_at=is.null` without `!inner` | parent meal retained with `recipes:null`; with `!inner` the meal disappears — the edge loader's choice is correct; test rows removed |

Not run: a live hosted-browser CORS reproduction (the static header evidence in S2 is conclusive), and a real phone/offline session-expiry test (S8 is based on the installed auth-js behaviour and should be verified on a device).

## Verification of the earlier signals

| Earlier signal | Status |
|---|---|
| Lint warnings at Stepper 29, SettingsPage 23/53/115, PlanPage 106, missing-deps PlanPage 101, refs UndoToast 17 / ShopPage 550, only-export files, PlanPage 67/86 | **Confirmed**; 18 warnings total, zero errors |
| `tsc -b --noEmit` clean | **Confirmed** |
| Pages never import `supabase`; ShopPage uses `useMutation`/`useQueryClient` under a documented exception | **Confirmed.** The exception is **not stale**: the offline ticks still need `mutationKey` with no `mutationFn`. Other pages use `useQueryClient` only to pass it to the `refresh*` helpers, which the API README sanctions |
| delete-account/push-test CORS lacks `Access-Control-Allow-Methods` | **Confirmed**, and it breaks the features (S2) |
| `BuyModal pending={false}` | **Confirmed** (S14) |
| Held cart row: row click always untickes; overlay should acknowledge | **Confirmed and worse**: the overlay click bubbles to the row, so it acks *and* untickes (S1) |
| `notCooked` is never cleared | **Confirmed**; today it is dead state rather than a wrong answer (check-ins cannot become unread again), but it adds to the stale per-trip state (S12) |
| PlanPage's deep-link effect omits `answer` | **Confirmed as a lint issue, not a stale-closure bug**: `useCommand`'s `mutate` is stable and the effect is ref-guarded |
| Fake adapter divergences (`answer` ignored, `finishShopping` records only, `shop.buy` sets `checked`, no recipe unique name) | **Confirmed** except the recipe-name point: there is **no** recipe unique-name rule on the server, so the fake's behaviour matches; its comment is misleading (N4) |
| RecipeView renders markdown as plain text | **Confirmed** (S9) |
| `UNSYNCED` sentinel and replay ordering | **Confirmed.** `9999-12-31` correctly forces an offline batch after any snapshot in the optimistic cache, but the server later replaces `addedOn` with the sync day, so a tick made offline yesterday changes the day it counts on after refetch; it does not fix the snapshot-completeness race (S5) |
| `household.update` uses `.not('id','is',null)` | **Confirmed**; latent multi-household/silent-zero-row risk (ST4) |
| finish snapshot race / ADR 0005 not_cooked consistency | **not_cooked is consistent** (answers are applied before `save_snapshot`); the **snapshot completeness race is real** (S5) |
| `fefo(..., null)` includes expired batches | **Confirmed.** ADR 0001 only requires meals to skip expired batches; the app always targets a batch id, so no user-facing impact today (S16) |
| `shoppingView` imports DB/transport types | **Confirmed** (ST2) |
| `snapshotPlan`'s `skipped` holds meal ids | **Confirmed** (S15) |
| Auth signup hook reads invite code; OAuth cannot bypass | **Confirmed** |
| push-cron double `loadMembers`, unread count, embed filters, `all()` paging, service-role filters | **Double load confirmed** (S18); unread count is consistent; embed filters and paging are correct (verified by experiment); every service-role read filters `deleted_at` |
| Migrations security/integrity | No RLS/composite-FK/hook bypass found. The gaps are multi-writer integrity (S3/S5), per-meal override cascade (S17), `purge` list-state residue (S19), and client-chosen snapshot date (S20) |
| `src/lib/pantry.test.ts` without `src/lib/pantry.ts` | **Confirmed orphan**; explained in ST7 |

## Suggested order

1. **S1, S2** — both are small, user-visible, and one loses data; ship first.
2. **S4, S5** — serialise shop mutations and make the finish snapshot complete/validated; add the missing tests.
3. **S3** — lock the item in `buy_shopping_item`; add the two-batch smoke assertion.
4. **S7, S8** — decide and implement the session/cache teardown and the offline-token policy; update PRIVACY.
5. **S6** — add the timezone setting (it silently affects every calculation).
6. **ST1** — make the fake adapter loud and correct, before writing the page/S4/S5 tests on top of it.
7. Everything else: batch by area (settings, recipe view, design conformance, small nits).
