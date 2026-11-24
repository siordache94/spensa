# Spensa — Product & Backlog Report

**Snapshot:** 24 November 2026  
**Code revision:** `a19f56c`  
**Scope:** implemented product behaviour verified against repository documentation and source, plus every open GitHub issue at the snapshot date.

## Executive summary

- **Product:** a shared household meal planner, pantry tracker and computed shopping list for two people.
- **Core promise:** plan meals, let Spensa derive pantry stock and shopping needs, then correct reality cheaply.
- **Core loop:** plan meals → replay stock → calculate shortfalls → shop → purchases become pantry batches → “Done shopping” saves a snapshot → check-ins correct meals that differed from plan.
- **Current state:** the full v1 loop is implemented, including invite-only accounts, recipes, planning, pantry replay, shopping, offline ticks, shared check-ins, web push, settings, PWA support and account data controls.
- **Backlog:** 29 open issues, all labelled `backlog`, with no assignees or milestones.
- **Triage note:** #17, “Push notifications for expiring items”, appears stale because daily expiry reminders are already implemented.
- **No official priority order:** the issue tracker records ideas, not sequencing or estimates.

---

## 1. What the app can do now

### 1.1 Accounts and household

- Email/password authentication and configured Google OAuth.
- Persistent Supabase session that can reopen the app from cached state after a network failure.
- Invite-only signup, enforced server-side by either:
  - An allowlisted email; or
  - A valid household invite code.
- `/?invite=CODE` prefills signup/setup.
- New Google users must be allowlisted because OAuth cannot carry an invite code.
- Create a household or join one with a code.
- Exactly one household per user.
- Household-scoped Postgres RLS and composite foreign keys.
- Invite-code copy, invite link, QR code and native sharing.
- Invite rotation invalidates the previous code, link and QR.
- Editable member display name.
- Per-meal cook assignment.
- Sign-out.
- JSON data export.
- Permanent account deletion with typed confirmation.

**Current limitations**

- No owner/admin roles.
- No member removal or leave-household flow.
- No password-reset UI.
- No household-rename UI.
- Any member can rotate the invite.
- The product targets two people, but the database does not enforce a two-member maximum.

### 1.2 Recipes and weekly planning

**Recipes**

- Create, edit, search and delete recipes.
- Name, tags and instructions.
- Ingredient amounts stored per portion.
- Base serving choices: `1`, `2`, `3`, `4`, `6`, `8`.
- Searchable ingredient picker with inline ingredient creation.
- To-taste ingredients without numeric quantities.
- Recipe deletion is blocked while a future planned meal still uses it.
- Older planned meals retain a removed-recipe reference.
- Instructions accept Markdown but are currently rendered as plain pre-wrapped text.

**Planner**

- Monday-first seven-day view.
- Previous, next and “This week” navigation.
- Past and future weeks are editable.
- Multiple meals per slot.
- Household-defined, reorderable slots; lunch and dinner by default.
- Whole-number meal portions of at least one.
- Move meals by drag/drop or menu.
- Existing single-meal copy via Alt-drop or “Copy to…”.
- Existing copy preserves recipe and portions only.
- Assign “I’ll cook”, another member, or nobody.
- Planned meals are assumed eaten on their date.
- Reversible “Didn’t cook” state.
- Per-meal ingredient overrides:
  - Replace the recipe’s lines for that meal.
  - Can change amounts, add ingredients or omit ingredients.
  - To-taste overrides use an on/off-style null value.
  - Portion changes do not rescale an existing override.
- Planner markers for shortfalls and ingredients expiring soon.
- Recipe view shows planned dates after the latest snapshot and supports removing one or all dates with Undo.

### 1.3 Pantry and stock

- Searchable ingredient catalogue.
- One canonical unit per ingredient: `g`, `ml`, `count` or `to_taste`.
- Optional category, pack size, shelf life and minimum stock.
- To-taste on-hand/out switch.
- Stock stored as batches with quantity, date added and optional expiry.
- Pantry read mode shows current totals and batch sub-lines.
- Pantry edit mode supports:
  - Changing batch quantities.
  - Changing expiry dates.
  - Adding batches.
  - Removing a batch as “Finished” or “Threw it away”.
- Pantry “Save changes” writes only a diff:
  - `set` adjustments for amount changes.
  - `finished` or `discard` adjustments for removals.
  - New batches and expiry corrections.
- Pantry saves do not create snapshots.
- Current stock is replayed through today.
- Projected stock includes future planned meals.
- “Use soon” includes expired and soon-to-expire batches.
- Expiry does not automatically remove stock.
- Soft delete and restore across household records.
- Server-maintained authorship and timestamps.

**Replay rules**

- Start from the latest snapshot.
- Apply later batches, planned meals and adjustments in date order.
- Meals consume soonest-expiring batches first: FEFO.
- Expired batches cannot be consumed on or after their expiry.
- Stock never goes negative.
- Uncovered demand becomes a shortfall.
- Same-day meal order uses configured slot order, then position, then ID.
- Per-meal overrides replace recipe amounts.
- “Didn’t cook” consumes nothing.

**Current limitations**

- `used X` exists in the domain/database but has no Pantry UI.
- No standalone projected-stock screen.
- No user-facing “short by X” display.
- No history/audit UI.
- The UI says “Delete for good”, although normal deletion is soft delete.
- Client pantry loading has no pagination and can encounter Supabase’s 1,000-row response limit as history grows.

### 1.4 Shopping

- The current trip is inferred, not stored.
- Trip range: today through `today + horizon − 1`.
- Default horizon is seven days; configurable from one to fourteen.
- “Edit trip” toggles each meal’s shared `skip_shopping` flag.
- Skipped meals remain planned and still consume stock; only their direct shopping needs are omitted.
- Computed list combines:
  - Selected-meal shortfalls.
  - Staples below minimum stock.
  - To-taste ingredients used by selected meals and marked out.
  - Manual ingredient or free-text extras.
- Aisle grouping includes produce, dairy, meat, fish, dry goods and frozen, followed by custom categories and “Other”.
- Manual entries link to an existing ingredient on an exact case-insensitive name match; otherwise they remain free text.
- Ticking a quantified row creates a pantry batch.
- Purchase quantity defaults to `max(need, pack size)`.
- Manual rows use their quantity, then pack size, then one.
- Expiry defaults to today plus shelf life.
- Amount and expiry are editable before buying.
- Tick, untick and four-second Undo are supported.
- Cart contains today’s purchased batches, ticked to-taste items and checked free text.
- Partner purchases receive a temporary held highlight and relative timestamp.
- Per-device acknowledgement clears partner highlights locally.
- Trip dock shows items left, items in cart, latest partner purchase and offline queue state.
- Live household signals refetch changed data.
- Partner list changes produce a combined in-app toast after a short delay.
- Own echoes and purchases are not reported as partner removals.

**“Done shopping” currently performs one global transaction**

1. Applies selected unread check-in answers.
2. Saves the client-supplied snapshot quantities.
3. Soft-deletes bought manual shopping items.
4. Clears every household `skip_shopping` flag.
5. Answers every remaining unread check-in as `planned`.

Unbought manual items remain. Checked free-text items require “Clear checked”.

### 1.5 Meal check-ins

- Server cron creates a check-in for an eligible meal:
  - Dated today or yesterday.
  - Slot has ended, plus a 30-minute delay.
  - Replay found a shortfall.
  - Meal existed before the due time.
  - Meal is not marked “Didn’t cook”.
- Creation runs on a 15-minute cron, typically 30–45 minutes after slot end.
- Check-ins are shared unread household items.
- First answer wins and clears the item for both members.
- Answers:
  - **Planned**
  - **Changed it** — saves per-meal amounts, then marks changed
  - **Didn’t cook** — removes stock consumption
  - **Dismissed**
- Unread count appears in plan navigation and the app icon where supported.
- “Done shopping” shows unread check-ins one final time.
- Unanswered check-ins at finish count as cooked as planned.

### 1.6 Notifications

- **List-change push**
  - Sent to the partner, never the author.
  - Combines changes within a 30-second window.
  - Bought/on-hand items are not counted as removals.
- **Expiry reminder**
  - Daily at each person’s chosen household-local time.
  - Default 09:00.
  - Lists unexpired batches with stock inside the reminder window.
  - One entry per ingredient, with a compact “and N more” summary.
- **Meal check-in push**
  - Silent notification to the assigned cook, or everyone if no valid cook.
  - Android supports “Cooked as planned” and “Changed it” actions.
  - iOS receives a normal notification without action buttons.
  - Signed token is bound to the user and meal and expires after 30 days.
- Per-person preferences:
  - List changes.
  - Meal check-ins.
  - Expiry reminder on/off and time.
- Per-device push subscriptions.
- Disabled subscriptions self-resync on load.
- 404/410 responses remove stale subscriptions.
- Install prompts support Android/desktop and iPhone Home Screen instructions.
- “Not now” snoozes prompts for 14 days.
- Test notification action.

**Operational dependencies**

- Edge functions must be deployed separately.
- VAPID keys, `push_config`, `pg_cron` and `pg_net` must be configured.
- Notification UI is hidden without `VITE_VAPID_PUBLIC_KEY`.
- The service worker is production-build-only.
- Without cron configuration, check-ins are not created even if nobody has enabled push.

### 1.7 Settings, PWA and privacy

**Shared household settings**

- Shopping horizon: 1–14 days.
- Expiring-soon threshold: 0–60 days.
- Expiry-reminder window: 0–14 days.
- Meal slots.
- Slot end times.
- Timezone, default `Europe/Rome`.

**Per-device settings**

- Light, dark and AMOLED themes.
- Compact and airy density.
- System theme until an explicit choice is made.
- Prompt dismissals.
- Partner-tick acknowledgements.

**PWA**

- Installable standalone web app.
- Icons, maskable icon and Apple touch icon.
- Generated auto-update service worker.
- Precached shell/assets.
- Google Fonts runtime cache.
- SPA navigation fallback.
- Deployed as Cloudflare Workers static assets.
- Settings displays build SHA and timestamp.

**Privacy and account data**

- JSON export includes account, household/members, live and soft-deleted household facts, check-ins, notification preferences and subscription endpoints.
- Export excludes subscription keys and the invite code.
- Account deletion requires typing `DELETE`.
- Last-member deletion erases the household.
- Otherwise household data remains and membership/authorship/cook references are removed or anonymised.

**Current limitations**

- No UI for household timezone or household name, despite database/API support.
- `PRIVACY.md` is still a placeholder template.
- Successful TanStack queries persist for seven days.
- The persisted household query includes the invite code.
- Account deletion is two-step; a partial failure can leave an auth account after household data has already been removed.
- The delete-account edge function must be deployed separately.

### 1.8 Offline and sync

- Successful query data persists in `localStorage` for seven days.
- Auth-session query data is excluded.
- Cached Plan, Pantry and Shop data remains visible after a failed refresh.
- Inline errors and Retry actions are shown.
- Service worker caches the app shell and fonts.
- Six shopping mutations queue offline:
  - Buy.
  - Unbuy.
  - Mark on hand.
  - Un-mark on hand.
  - Check free text.
  - Uncheck free text.
- Offline ticks use optimistic cache updates and rollback on failure.
- Refetch is deferred while other ticks remain queued.
- Batch UUID and `added_at` are generated at action time, making retries idempotent.
- Server `recorded_at` determines replay order.
- Mutation functions register before cache restoration and resume after restart.
- Header and trip dock show paused queue count.
- If a partner deletes a manual item before an offline tick syncs, the batch is still created and kept in the pantry.

**Current limitations**

- This is not general offline editing.
- Recipes, planning, pantry edits, manual extras, trip toggles, settings, check-in answers, snapshots and authentication require connectivity.
- No offline conflict-resolution policy; tracked by #20.
- Cached data is only as fresh as the last successful fetch.

### 1.9 Interface and accessibility

- Mobile-first, one-handed layouts with safe-area insets.
- Bottom tabs on phones.
- Side rail from `48em` and wider.
- Responsive planner and shopping layouts.
- Core rows and controls commonly use 44px or larger targets.
- Compact rows are 44px; airy rows are 72px.
- Visible focus rings.
- Labelled controls.
- Keyboard-activatable shopping rows.
- Semantic alert/status regions.
- Text cues accompany colour.
- Three themes and two densities.
- High-contrast palettes designed around WCAG AA targets.
- Drag/drop has menu-based Move/Copy alternatives.

**Constraints**

- English-only UI.
- Browser-locale date formatting, but no i18n layer.
- Metric quantities only; no unit conversion.
- Modern-browser PWA; no native app.
- iPhone web push requires Home Screen installation and iOS 16.4+.
- Push requires HTTPS and a production service worker.
- No explicit `prefers-reduced-motion` handling was found.
- Accessibility has been reviewed from source/design commitments, not a runtime assistive-technology audit.

---

## 2. Core domain rules

| Rule | Meaning |
|---|---|
| **The plan is the truth** | Planned meals consume stock unless marked “Didn’t cook”. |
| **Snapshots are the truth** | Events before the latest snapshot no longer change current stock. |
| **FEFO** | Meals consume batches that expire soonest first. |
| **No negative stock** | Shortfalls become shopping needs rather than negative quantities. |
| **Skipping shopping is not skipping dinner** | A skipped meal remains planned and still consumes replay stock. |
| **Per-meal amounts replace recipe amounts** | A meal with live override lines does not also consume the recipe’s default lines. |
| **One ingredient, one canonical unit** | `g`, `ml`, `count` or `to_taste`; no general conversion. |
| **Soft delete** | Deleted records are hidden and restorable, not hard-deleted. |
| **Household isolation** | Data and mutations are scoped to the user’s household. |
| **Derived, not stored** | Current stock, projected stock, shortfalls and the shopping list are computed by replay. |

---

## 3. Known limitations and operational risks

### Product gaps

- No barcode scanning, receipt import, voice input or natural-language grocery entry.
- No free-text plan notes or cook-once/eat-twice meal links.
- No store tags, per-store checkout or item snoozing.
- No ingredient merge or bulk expiry cleanup.
- No arbitrary recipe scaling or deterministic cook-now filter.
- No activity/history feed.
- No AI suggestions, URL recipe import, nutrition, recipe photos or leftovers tracking.
- English only.
- One household per user.

### Reliability and scalability

- General offline editing is not supported.
- Offline mutation ordering and conflict resolution remain undefined.
- “Done shopping” is global; it cannot yet represent partial or per-store checkout.
- A stale client snapshot can omit a partner’s batch and lose stock unless the transaction is redesigned.
- Concurrent phones can buy the same manual item twice.
- Client pantry loading can hit the 1,000-row response cap.
- The server does not recompute or validate snapshot completeness.

### Operations and privacy

- Push and check-in scheduling require manual edge-function and cron setup.
- Account deletion can partially fail after household data has already been erased.
- Household timezone and name lack UI despite database support.
- The privacy notice is still a template.
- Invite codes are present in persisted browser query data.
- Current authorship fields record the latest change, not a complete audit trail.

---

## 4. Backlog overview

- **29 open issues:** #12–#40.
- **All labelled:** `backlog`.
- **Assignees:** none.
- **Milestones:** none.
- **Priority/order:** not encoded in GitHub.
- **Likely stale:** #17.

### Dependency clusters

- **Smart capture:** #28 is the shared natural-language parser; #26 depends on it. #27 and #25 share OCR/barcode infrastructure with #12.
- **Partial shopping:** #34 and #35 both require changes to the global “Done shopping” transaction.
- **Recipe intelligence:** #31 is a deterministic precursor to #13.
- **Recipe scaling:** #36 is temporary uniform scaling; #19 is persistent ingredient-specific ratio adjustment.
- **Batch meals vs leftovers:** #38 is planning-level; #22 models actual leftover quantity and expiry.
- **Waste and history:** #32 feeds #16; #40 benefits from #29 for intelligible merge history.
- **Restock and snooze:** #33’s explicit restock requests intersect #34’s deferred-item state.

---

## 5. Detailed backlog register

### 5.1 Smart capture and grocery input

#### [#12 — Barcode scanning](https://github.com/siordache94/spensa/issues/12)

- Scan a product barcode to add a pantry batch without typing.
- Base capture flow for later receipt and guided-photo work.
- Should share product metadata lookup rather than creating isolated scanner logic.

#### [#25 — Guided sequential product photos](https://github.com/siordache94/spensa/issues/25)

- Guided capture of:
  1. Product front/name.
  2. Expiry date.
  3. Optional barcode.
- Combine OCR results into one editable ingredient/batch draft.
- Allow retaking an individual image.
- Require confirmation for ambiguous dates such as `03/04`.
- No ingredient or batch is written before review.
- Define image retention and offline behaviour.
- Shares OCR and barcode infrastructure with #27 and #12.

#### [#26 — Whisper-powered voice annotations](https://github.com/siordache94/spensa/issues/26)

- Hands-free grocery notes using Whisper or a compatible model.
- Explicit start/stop/cancel and visible recording/transcribing states.
- Transcript remains editable.
- Transcript feeds the #28 parser and review flow.
- Handle microphone denial, no speech, transcription failure and network failure.
- Audio is not retained by default; cloud processing must be disclosed.
- Depends on #28.

#### [#27 — Receipt photo reconciliation](https://github.com/siordache94/spensa/issues/27)

- Photograph/upload a receipt and run OCR.
- Match line items to the current shopping list and ingredient catalogue.
- Use barcodes where available for trusted product metadata.
- Review matched, unmatched and uncertain items.
- Edit quantities, units and expiry before confirmation.
- Confirmed shopping matches behave like normal ticks.
- No writes during OCR/matching.
- Do not silently save a snapshot or end the trip.
- Avoid duplicate stock for already-ticked items.
- Define OCR provider, product catalogue, privacy and duplicate-receipt handling.

#### [#28 — Natural-language grocery and pantry entry](https://github.com/siordache94/spensa/issues/28)

- Numi-inspired phrases such as “add 2 kg tomatoes”.
- Parse intent, ingredient, quantity, canonical unit and optional expiry.
- Reuse existing household ingredients where the match is clear.
- Show an editable structured preview before saving.
- Ask for missing or ambiguous details; never silently guess.
- Keep manual forms as fallback.
- Structured parser output is shared by #26, #27 and #25.
- Decide cloud versus on-device implementation within free-tier constraints.

---

### 5.2 Planning friction

#### [#30 — Duplicate meals and copy previous weeks](https://github.com/siordache94/spensa/issues/30)

- Existing meal copy preserves only recipe and portions.
- Extend it to preserve cook and per-meal overrides.
- Add day/week copying into a selected target range.
- Preserve weekday and slot placement.
- Offer collision handling: add, replace after confirmation, skip or cancel.
- New meals receive new IDs and fresh check-in state.
- Never copy batches, snapshots, answered check-ins or consumption history.
- Bulk copy must be atomic.
- Define how future meal links are copied.
- Related: #38.

#### [#37 — Free-text plan notes and non-cooking meals](https://github.com/siordache94/spensa/issues/37)

- Add note-only entries such as “Eating out”, “Takeaway” or “At parents’ house”.
- Use an explicit meal kind/title; do not overload a missing recipe reference.
- Notes consume no stock.
- Notes create no shopping need, shortfall or check-in.
- Notes remain visible in the correct day/slot.
- Support edit, move and delete.
- “Didn’t cook” remains a correction for an existing recipe meal.

#### [#38 — Linked cook-once, eat-twice meals](https://github.com/siordache94/spensa/issues/38)

- Link later meals to a cooking-source meal.
- Allocate portions of the source meal to linked entries.
- Consume ingredients once, on the source date.
- Linked entries consume zero additional ingredients.
- Linked entries do not create duplicate cooking check-ins.
- Validate chronology, household ownership and cycles.
- Require an explicit decision if the source is marked “Didn’t cook”.
- Unlinking must distinguish:
  - Keep as a non-consuming note; or
  - Become an independent stock-consuming meal.
- Coordinate with #22 without modelling pantry leftovers here.

---

### 5.3 Shopping and checkout edge cases

#### [#34 — Partial trips and snooze shopping items](https://github.com/siordache94/spensa/issues/34)

- Add “Snooze to next trip” to still-to-buy items.
- Persist snooze separately because computed needs have no item rows.
- Snoozed items:
  - Are not bought.
  - Create no batch or snapshot purchase.
  - Remain visible in a deferred section.
  - Return next trip while the need exists.
- Allow cancelling a snooze.
- Resolve the item if bought elsewhere.
- Survive reload and offline queue recovery.
- Prevent Finish from overtaking queued snooze/buy actions.
- Make Finish snooze-aware.
- Related: #35 and #20.

#### [#35 — Shopping list store tags and per-store trips](https://github.com/siordache94/spensa/issues/35)

- Optional store on ingredients as a default shopping location.
- Trip-specific store override.
- Group/filter by store, with “Unassigned / Other”.
- Preserve aisle/category grouping within each store.
- Checking out one store must not buy or clear other stores’ items.
- Requires a scoped replacement for the current global Finish RPC.
- Define shared versus per-device store preferences.
- Computed needs need persistent store/snooze override state.
- Related: #34 and #16.

#### [#39 — Shopping-unit display hints](https://github.com/siordache94/spensa/issues/39)

- Optional secondary label such as bottle, jar, punnet, bunch or pack.
- Ingredient default plus trip-specific override.
- Show beside canonical amount and pack hint.
- Never change stored units or replay mathematics.
- Do not introduce general unit conversion.
- Do not invent a conversion without pack size.
- Keep recipe and pantry displays canonical.
- Define where override provenance lives after checkout.

---

### 5.4 Pantry and ingredient management

#### [#32 — Bulk discard expired batches](https://github.com/siordache94/spensa/issues/32)

- Add “Discard all expired”.
- Eligible batches expire before household-local today and still have stock.
- Preview affected batches and totals before confirmation.
- Record discard adjustments for every affected batch.
- Retain batch rows, purchase facts and snapshot references.
- Do not soft-delete batches.
- Apply atomically and idempotently.
- Attribute each discard to the acting member.
- Undo uses a compensating correction that respects later snapshots.
- Waste feeds #16.

#### [#33 — Quick mark-out for pantry ingredients](https://github.com/siordache94/spensa/issues/33)

- One-tap “Mark out” on pantry ingredient rows.
- Append `set 0` adjustments for every remaining batch.
- Do not discard or soft-delete batches.
- Create a separate explicit restock request.
- Restock appears on the next trip even for non-staples.
- Restock amount remains editable.
- Restock can be cancelled independently of stock.
- Buying or snoozing resolves the request.
- Reuse the existing immediate switch for to-taste ingredients.
- Undo uses a compensating stock correction.
- Related: #34.

#### [#40 — Merge duplicate ingredients](https://github.com/siordache94/spensa/issues/40)

- Choose source and target within the same household.
- Require identical canonical units.
- Preview all affected records.
- Use a household-scoped server RPC with row locks.
- Re-point:
  - `recipe_ingredients`.
  - `planned_meal_lines`.
  - `batches`.
  - `adjustments`.
  - Ingredient-bound `shopping_items`.
- Preserve batch IDs, quantities, expiry, `recorded_at` and snapshot references.
- Resolve live-line unique-index collisions before re-pointing:
  - Sum numeric recipe/meal quantities.
  - Collapse duplicate to-taste lines by an explicit rule.
- Keep adjustment/shopping-item ingredient references consistent with batch references.
- Any failure rolls back everything.
- Decide metadata precedence and source restore/undo behaviour.
- Decide whether soft-deleted historical references are rewritten.
- Related: #29.

---

### 5.5 Recipes and food intelligence

#### [#13 — AI recipe suggestions](https://github.com/siordache94/spensa/issues/13)

- Suggest recipes, for example from ingredients expiring soon.
- AI generation remains separate from #31’s deterministic availability evaluator.

#### [#14 — Import recipes from URL](https://github.com/siordache94/spensa/issues/14)

- Create a recipe from a web page URL.
- Requires extraction, ingredient normalisation and review before saving.

#### [#18 — Nutrition info](https://github.com/siordache94/spensa/issues/18)

- Show nutrition information for ingredients and recipes.
- Requires a trusted data source and clear handling of missing values.

#### [#19 — Per-recipe ratio tweaks](https://github.com/siordache94/spensa/issues/19)

- Persist ingredient-specific adjustments, such as 20% more potatoes.
- Distinct from #36’s temporary uniform scaling.
- Needs a strategy for versions/effective dates so past uncovered planned meals are not silently rewritten.

#### [#23 — Recipe photos](https://github.com/siordache94/spensa/issues/23)

- Attach a photo to a recipe.
- Requires image storage, upload constraints and deletion/privacy behaviour.

#### [#31 — “What can I cook right now?” filter](https://github.com/siordache94/spensa/issues/31)

- Deterministic recipe availability using current replay.
- Classify:
  - Can cook now.
  - Almost.
  - Missing items.
- Require sufficient quantities, not just ingredient presence.
- Exclude expired stock even if pantry totals still include it.
- To-taste ingredients require the on-hand flag.
- Show exact missing ingredients and short quantities.
- Allow target servings.
- Prioritise expiring ingredients deterministically.
- Decide whether “right now” includes all of today’s planned meals.
- Read-only and separate from #13.

#### [#36 — Recipe serving-scale preview](https://github.com/siordache94/spensa/issues/36)

- Existing recipe preview supports only stored serving choices.
- Add arbitrary target servings or multiplier on the Recipe view.
- Recalculate from per-portion amounts.
- Keep to-taste ingredients qualitative.
- Use adaptive rounding so small quantities do not disappear.
- Do not mutate the recipe, stock or plan.
- Optional separate “Plan these portions” action.
- Distinct from #19.

---

### 5.6 Household, insights and platform

#### [#15 — Price tracking](https://github.com/siordache94/spensa/issues/15)

- Record item costs over time.
- Requires purchase-price capture and store/item normalisation.

#### [#16 — Insights dashboard](https://github.com/siordache94/spensa/issues/16)

- Waste from discards.
- Spending.
- Frequently bought items.
- Depends on richer data from #15, #32 and potentially #35.
- Related activity context: #29.

#### [#17 — Push notifications for expiring items](https://github.com/siordache94/spensa/issues/17)

- **Likely stale.**
- Daily expiry reminders are already implemented in code and documented behaviour.
- Recommended triage: close, or narrow to a specific missing delivery/reliability requirement.

#### [#20 — Offline conflict resolution](https://github.com/siordache94/spensa/issues/20)

- Define how conflicting offline ticks are amended after sync.
- Needed before expanding offline mutation coverage.
- Related: #34.

#### [#21 — Multiple households per user](https://github.com/siordache94/spensa/issues/21)

- Let one user belong to more than one household.
- Add a current-household selector.
- Affects RLS assumptions, composite keys, invites, caching and account deletion.

#### [#22 — Leftovers tracking](https://github.com/siordache94/spensa/issues/22)

- Track cooked leftovers and how long they keep.
- Models actual leftover quantity, provenance and expiry.
- Coordinate with #38 to avoid double stock deductions.

#### [#24 — Translations (i18n)](https://github.com/siordache94/spensa/issues/24)

- Translate the UI beyond English.
- Requires message extraction, locale handling and translated date/number conventions.

#### [#29 — Household activity and audit feed](https://github.com/siordache94/spensa/issues/29)

- Read-only chronological household activity.
- Show actor/system, action, object, useful details and time.
- Cover creations, edits, deletes/restores, batches, adjustments, snapshots, ticks, check-ins and important settings where data supports them.
- Current metadata records only the latest change.
- Implement append-only events going forward.
- Optionally combine with a clearly labelled baseline derived from current rows.
- Preserve safe labels for soft-deleted objects.
- Keep household-private through RLS.
- Define retention, grouping and payload detail.
- Related: #16 and #40.

---

## 6. Technical follow-ups outside the GitHub backlog

A repository architecture review identifies additional engineering work. These are **not** current GitHub backlog issues.

| Area | Opportunity |
|---|---|
| **Test adapter fidelity** | Make the in-memory adapter match production transaction behaviour or fail loudly instead of silently passing incomplete operations. |
| **Repeated replay** | Centralise stock-for-trip calculations instead of replaying independently on multiple screens. |
| **Shop orchestration** | Extract partner-diff, tick routing, undo and acknowledgement behaviour from the large Shop page into a tested module. |
| **Pantry cache contract** | Give the persisted `['pantry']` cache value a named interface and centralise optimistic transitions. |
| **Household invalidation** | Read the household row once and declare its readers centrally instead of spreading invalidation knowledge across helpers. |
| **Check-in compound writes** | Put “save amounts, then answer” and finish-time answer selection behind intent-level operations. |
| **Duplicate facts loader** | Share column/embed selection and row-to-facts mapping between client and edge loaders. |

---

## 7. Sources

- `PRODUCT.md`
- `CONTEXT.md`
- `README.md`
- `DESIGN.md`
- `docs/adr/0001-stock-by-replay.md`
- `docs/adr/0002-household-scoping.md`
- `docs/adr/0003-soft-delete-and-authorship.md`
- `docs/adr/0004-web-push.md`
- `docs/adr/0005-meal-check-ins.md`
- `docs/reviews/architecture.md`
- `src/domain`, `src/lib/api`, `src/pages`, `src/components`
- `supabase/migrations`
- `supabase/functions`
- Open GitHub issues #12–#40, retrieved 24 November 2026
