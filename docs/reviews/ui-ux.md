# Spensa — UI/UX and interface-quality review

Reviewed: 24 Nov 2026. Read-only: no source or design files were changed; this report is the only deliverable.

## Scope and method

- Read `PRODUCT.md`, `DESIGN.md`, `CONTEXT.md`, the Shop surface brief, `.impeccable/design.json`, and all UI source under `src/` (`App.tsx`, pages, components, `theme.ts`, `theme.css`, `shell.css`, `pages/*.css`, `index.html`, `vite.config.ts`, `public/push-sw.js`).
- Served the current `dist/` build and reviewed the unauthenticated surface at 390 × 844 and 1000 × 700, with live DOM measurements.
- Built a small CSS harness using the current built stylesheet to measure focus outlines, the Pantry edit grid at 360 px, and the 320 px tab bar. The committed screenshots in `.impeccable/review/` were not used as primary evidence: they date from 17:10–18:54 on 23 Nov, before the 23:47 design changes (`314e28d`, `4eef987`), and show an older Shop header and older tag styling.
- The authenticated surfaces (Plan, Shop, Pantry, Recipes, Settings) could not be opened without credentials. Those findings are grounded in the current source and tokens, with screenshots used only where a layout pattern still matches the code.

**Severity:** Critical = data-destructive or blocks a core trip; High = fails an explicit product/design commitment or a WCAG AA requirement; Medium = real friction/confusion with a local fix; Low = polish and consistency.

## Verdict

The gate-board world is coherent and unusually well carried through: flat tonal panels, a real figure column, a strong trip pass, useful density variables, and a good undo-over-confirm instinct. The remaining risk is not the visual concept. It is the interaction layer around it: a held partner row can silently put the partner's purchase back, light-theme keyboard focus is close to invisible, most controls are 36 px rather than the promised 44 px, and several mobile/persistence edges lose context or data. Fix those before adding more surface.

---

## 0. Cross-cutting foundations

### X-1 · High · Focus rings disappear on the light theme
`src/theme.css:82` sets an Ink focus ring for light, but Mantine's own rules out-cascade it: `.mantine-focus-auto:focus-visible` uses `--mantine-primary-color-filled` (`src/theme.ts:22-23`), which is yellow in every theme. Live proof on the built Auth page in light mode: the “Continue with Google” and “Sign in” buttons focused with a **yellow** `rgb(245,204,59)` outline. The same happens to SegmentedControl labels, switches and radios (measured yellow label outline in the harness). Yellow on the light ground is **1.26:1**; on white it is **1.55:1**. This fails WCAG 1.4.11 non-text contrast and makes keyboard use guesswork. Inputs are the exception because `.sp-input:focus` wins.

Fix: add a light-theme focus layer after Mantine, e.g. `:root[data-spensa-theme='light'] .mantine-focus-auto:focus-visible, ... .mantine-focus-always:focus { outline-color: var(--sp-focus); }`, plus the adjacent-label rules for SegmentedControl/Switch/Radio (the built stylesheet sets those on `input:focus-visible + label`). Add the classNames in `theme.ts` so the overrides do not depend on Mantine hash classes.

### X-2 · High · The 44 px tap-target commitment is broadly unmet
Measured in the built app/stylesheet: default Mantine buttons and text inputs are **36 px** high; `size="md"` is **42 px**; `<SegmentedControl>` labels are **40 px** (`theme.css:118`); a modal close button is **28 px**; `CloseButton size={36}` is 36; `Button size="compact-sm"` is **26 px**. Examples:
- Shop: “Edit trip” (`ShopPage.tsx:378`), Add input/button (`:385-386`), “Clear checked” (`:435`), finish SegmentedControls (`:517`).
- Forms: Recipe create/Cancel (`RecipeForm.tsx:167,182,197`), line remove (`:151`); Ingredient unit control (40 px); Settings save/time controls (`SettingsPage.tsx:123`, `NotificationSettings.tsx:79`); every modal close.
- Household menu: Copy / Copy link / Share / New invite code (`App.tsx:101,116,122,127`).

This is below the product's explicit “tap targets of at least 44px” (`PRODUCT.md:54`) and the one-handed supermarket context, though most are above the WCAG 2.5.8 24 px floor. The Plan week buttons, Stepper buttons, Pantry row buttons, Menu items and tab bar are already correctly 44 px (see “Checked and cleared”).

Fix: introduce `--sp-control-min: 44px` and apply `min-height: 44px` to Button/Input/TimeInput/CloseButton and `min-height: 44px` to segmented labels; make compact menu buttons full 44 px rows. Do not rely on per-call `size` props for safety-critical controls.

### X-3 · Medium · Most routes start at h2, and Plan/Pantry use a different page-title face
Shop is the only route with an `<h1>` (`ShopPage.tsx:377`). Plan (`PlanPage.tsx:145`) and Pantry (`PantryPage.tsx:108`) use Mantine `<Title order={2}>`, which takes the heading face from `theme.ts:28` (Barlow) and Mantine's default h2 size; Recipes/Ingredients/Settings/Auth/Household use `<h2 className="sp-title">` (`RecipesPage.tsx:33`, `IngredientsPage.tsx:30`, `SettingsPage.tsx:147`, `AuthPage.tsx:47`, `HouseholdPage.tsx:42`). ErrorState also uses `<Title order={2}>` (`ErrorState.tsx:28`). So most pages have no h1, and two page titles do not use the Schibsted 24 px display style.

Confirmed live: the Auth title is an `<h2 class="sp-title">` at 24 px/700 Schibsted. Plan/Pantry are the outliers. Fix: one `PageTitle` component rendering `<h1 className="sp-title">`; use it on every route (including setup and full-page errors), keep section heads at h2/h3. Plan's visible date range can remain, with a visually hidden “Plan” or an h1 of “Plan, 23–29 Nov”.

### X-4 · Medium · Error and empty-state copy is generic on non-shop surfaces
`ErrorState` defaults are list-specific: title “Couldn't load your list” and inline “Can't refresh. Showing your saved list.” (`ErrorState.tsx:7-17`). The inline default is used on Plan, Pantry, Recipes and Ingredients (`PlanPage.tsx:140`, `PantryPage.tsx:116`, `RecipesPage.tsx:37`, `IngredientsPage.tsx:34`). “Saved list” is wrong on the planner and recipe pages. Empty states are hand-rolled per page (`ShopPage.tsx:394`, `RecipesPage.tsx:41-47`, `IngredientsPage.tsx:38-44`, `PantryPage.tsx:129-136`, `UseSoon.tsx`), so tone, action placement and spacing differ.

Fix: pass an explicit `message` per surface (e.g. “Can't refresh. Showing your saved plan.”) or make the default neutral (“Showing saved data.”); add a shared `EmptyState` with a one-line explanation + one primary action, and use it in Recipes, Ingredients, Pantry and search-no-results.

### X-5 · Medium · Date locale is inconsistent
Plan uses `toLocaleDateString(undefined, …)` (`PlanPage.tsx:34-35`, `:146`, `:168`); RecipeView also uses `undefined` (`RecipeView.tsx:25-27`); Pantry hardcodes `en-GB` (`PantryPage.tsx:33`); Shop uses dayjs English (`ShopPage.tsx:40`). A non-English phone therefore mixes translated day names on Plan/Recipe with English elsewhere, in an English-only UI. Week start is not the problem: Mantine Dates defaults to Monday and the explicit `firstDayOfWeek={1}` props agree.

Fix: add a Mantine `DatesProvider` with `locale="en-gb"` in `main.tsx`, and format dates through one helper (`en-GB`) everywhere. Remove ad-hoc `undefined` locales; the explicit `firstDayOfWeek` props can then be dropped.

### X-6 · Medium · Route changes do not reset scroll or document title; unknown paths render blank
`App.tsx:170-177` has no catch-all route and no scroll restoration. The tab bar swaps pages while the window keeps its previous scroll position, so switching from a scrolled Pantry to Recipes can land mid-list and in the wrong context. `<title>` stays “Spensa” for every route (`index.html:12`). A typo path renders the shell with an empty main.

Fix: a small `RouteEffects` in the Shell: scroll to top on pathname change (except explicit back/restore), set `document.title` from the route, move focus to the page h1/main, and add a `path="*"` 404 page with a link home.

### X-7 · Medium · Form errors can appear off-screen
RecipeForm places its save/add errors at the top of a long full-screen form (`RecipeForm.tsx:100-106`) while Save is at the bottom (`:219`). Pantry places `save.error` at the top of the list (`PantryPage.tsx:128`) while the save bar is fixed at the bottom (`:260-265`). A failed save can therefore look like nothing happened for sighted users (Mantine Alerts already carry `role="alert"`, so the announcement happens, but the visual error is off-screen). Fix: toast the error, scroll the alert into view/focus it, or put the error adjacent to the action that failed.

### X-8 · Medium · Quantity/unit formatting drifts between surfaces
Shop shows `4 count` (`shoppingView.ts` unit passthrough + `ShopPage.tsx:413`); RecipeView shows `2 count` (`RecipeView.tsx:95`); UseSoon shows `2 count` (`UseSoon.tsx:33`); Pantry suppresses the count unit (`PantryPage.tsx:141,156`). “Count” is the storage unit, not language. Fix: one formatter that renders `count` as nothing, “×4” or “4 items” depending on context, and applies tabular figures only in figure columns.

### X-9 · Low · Reduced motion is not respected
The app's own CSS has no finite transitions, but Mantine modals, menus, segmented indicators and button presses animate by default; the `respectReducedMotion`/`data-respect-reduced-motion` path is not enabled. The Plan “scroll to today” is a hard jump, which is fine, but the surrounding chrome still animates. Set `respectReducedMotion: true` in the Mantine theme and add a `prefers-reduced-motion` block for app transitions.

### X-10 · High · Destructive red fails AA, and switch/disabled states lose their boundary
The theme sets `autoContrast: true` with `luminanceThreshold: 0.4` (`theme.ts:25-26`) and maps both `--mantine-color-red-filled` and red text to `#ff4d4d` in dark/AMOLED (`theme.css:21,47-50`). For a red filled button, Mantine therefore chooses **white** text on `#ff4d4d`: **3.27:1** — below AA for normal text. This affects “Delete for good”, “Remove from all dates”, “Delete forever” and the GuardedModal “Discard”. The red-light variant (enabled “Delete” on a recipe/ingredient) puts `#ff4d4d` text on Mantine's dark `--mantine-color-red-light` (#651515): **3.84:1**, dropping to **2.76:1** on hover. Separately, the Mantine Switch off track stays `gray-3` (#dee2e6) on the light ground (#e6e8eb): **1.06:1**, so the control boundary is effectively invisible; disabled buttons fall back to Mantine gray (#adb5bd on #e9ecef, 1.75:1), which is exempt but off-world and barely legible.

Fix: separate `--sp-red-text` (bright on dark) from `--sp-red-fill`/`--sp-red-contrast` (use a darker fill with white text, or keep bright red with Ink text; both pass in dark). Make the red-light destructive button an outline/white-text treatment (white on #651515 is about 10.6:1) or darken its background until the red text clears 4.5:1. Map `--switch-bg` and the disabled variables through the theme tokens.

---

## 1. Plan

### PL-1 · Medium · First-run plan has no route to a recipe
A household with no recipes opens Plan, taps any “+”, and gets a Meal modal with an empty Recipe Select and a disabled Save (`PlanEntryModals.tsx:52-77`). There is no “Add a recipe” action or explanation. The user must guess that Recipes is the prerequisite. Fix: empty-state inside MealModal: “No recipes yet. Add one first.” with a link/button that opens the Recipes form (or inline mini-create), and disable the + slots with a single setup prompt if there are zero recipes.

### PL-2 · Medium · The meal menu is the touch path, but nothing advertises it
The meal row is a button that opens a Menu (`PlanPage.tsx:181-224`); drag-and-drop is desktop-pointer-only (`:188-195`) and its instruction lives only in a `title` attribute (“hold Alt while dropping to copy”). There is no kebab/chevron, no drop-target highlight, and no keyboard drag alternative. The menu exists and works, but its discoverability is low, especially one-handed. Fix: add a small persistent “⋯”/chevron affordance on meal rows, add a drag-over/drop indicator and a short “Drag to move · Alt to copy” hint in empty slots, and keep the menu as the canonical accessible path.

### PL-3 · Medium · Destructive plan and check-in actions have no undo
“Delete” deletes the meal immediately (`PlanPage.tsx:222`) with no confirmation or toast. Check-in answers fire on tap and close the sheet (`CheckinModals.tsx:38-41`), so a mis-tap on “Didn't cook” silently strikes a meal through and changes stock. RecipeView already sets the right pattern: inline confirm plus a 5 s Undo toast (`RecipeView.tsx:50-62,126-135`). Fix: reuse an undo toast for meal delete and check-in answers; or confirm “Didn't cook” only when it changes future stock.

### PL-4 · Medium · The 7-column planner is cramped at 1024 px
At `64em` the week becomes `64px + repeat(7, 1fr)` (`plan.css:57-60`), so a 1024 px viewport gives roughly 100 px per day. Meal names wrap; the cook chip is `white-space: nowrap` + ellipsis (`theme.css:159-173`) and the committed 1024 screenshot shows `COOK · d…`, which no longer identifies the cook. In a two-person household that cue is the point. Fix: keep the 2-day layout until ~1200 px, or shorten the chip to initials/“You” with the full name in an accessible label; allow the chip to wrap if needed.

### PL-5 · Low · Add-meal title exposes an ISO date and lowercase slot
`PlanEntryModals.tsx:49` renders `Add to ${target.slot}, ${target.date}` → “Add to lunch, 2026-11-24”. Use `slotLabel(slot)` + the shared day formatter (“Add to Lunch, Tue 24 Nov”).

### PL-6 · Low · Week navigation and today's scroll
“This week” remains enabled when already on this week; changing weeks does not reset scroll to the new week (only initial mount scrolls today into view, `PlanPage.tsx:267-271`). A blank week has seven empty day bands with no “Nothing planned” explanation. Fix: disable “This week” at offset 0, scroll the new week into view, and add a one-line empty state.

### PL-7 · Low · Slots editing can orphan meals without warning
SlotsModal saves a renamed/removed slot list (`PlanEntryModals.tsx:126-147`) without telling the user that meals in a removed slot still exist; they continue to render via the union in `PlanPage.tsx:136` but can no longer be added to. A long or duplicate slot name also has no validation. Fix: warn when a removed slot has planned meals, cap/trim slot names, and offer to move those meals.

---

## 2. Shop

### SP-1 · Critical · Tapping a held partner row acknowledges it **and** puts the partner's purchase back
The cart row's `onClick` always runs `runUntick(c.untick)` (`ShopPage.tsx:448`). A held row renders a transparent `<button class="sp-ack">` over everything after the tick (`ShopPage.tsx:546-560`, `shop.css:53`). Its click handler calls `acknowledge` but does not stop propagation, so the same tap bubbles to the row and deletes the purchase batch (`unbuy`). Tapping the tick cell itself calls `runUntick` directly without acknowledging (`ShopPage.tsx:456`). On a partner-held row the UI therefore has three different outcomes on adjacent pixels, and two of them are destructive. This contradicts `DESIGN.md:225-226` (“An invisible full-row button acknowledges it, which clears the highlight”). Keyboard Enter/Space acknowledges correctly (`ShopPage.tsx:449-454`), so pointer and keyboard diverge.

Fix: in the row handler, `c.held ? acknowledge(c.id) : runUntick(c.untick)`; in `AckButton`, `onClick={(e) => { e.stopPropagation(); onAck() }}`; remove the direct untick from the held row's tick (or make it an explicit “Put back” action with confirmation). Add a regression test that a held-row tap acknowledges and leaves the batch intact.

### SP-2 · High · Shop rows are buttons containing buttons, and their accessible name drops the useful data
Every list row is `<div role="button" tabIndex={0} aria-label={`Bought ${e.name}`}>` containing a decorative checkbox, a name with note + pack, a figure, and a nested `<ActionIcon>` for amount editing (`ShopPage.tsx:402-425`). Cart rows do the same and add the nested `AckButton` (`:442-464`). ARIA makes descendants of a `button` presentational, so the pencil/ack controls are at best inconsistently exposed; they are also separate tab stops with duplicate/ambiguous labels. The row's `aria-label` overrides the visible text, so screen-reader users never hear “160 g”, “≈ 3 packs” or “Staple, below min stock”. Category bands are plain divs, not headings/lists (`:396-398`), so aisles cannot be navigated.

Fix: stop using `role="button"` on a container with interactive children. Use a list (`ul/li`) per aisle with an explicit row button that contains only name + figure, and sibling buttons for the amount editor and acknowledgment. Include amount/unit/pack/note in the row's accessible name, or use `aria-describedby` for the note. Make each category band an h2/h3 or give the list an accessible name.

### SP-3 · Medium · Partner highlights vanish after three seconds, contrary to “stays lit”
`AckButton` starts a 3 s acknowledgement timer when 60 % of the row is visible (`ShopPage.tsx:546-560`). The surface brief says “a partner's tick arrives and stays lit”; `DESIGN.md:225-226` calls it a signature that clears on acknowledgement. Auto-clearing makes it easy to miss and removes the only row-level cue while the partner cell is off-screen. Fix: require the explicit tap/Enter (or auto-ack only after a much longer dwell, e.g. 30 s, and only while the row is actually on screen).

### SP-4 · Medium · The PACK column and its header were dropped without a design decision
`DESIGN.md:191` and the Shop brief specify a five-column board with ITEM / AMOUNT / PACK and a 60 px pack column. Current code has only two header cells, `<span>Item</span><span>Amount</span>` (`ShopPage.tsx:392`), and puts the pack hint inside the name (`.sp-packline`, `shop.css:42`). The grid still reserves `--c-unit` and `--c-edit` (`shop.css:5-7`), so the header leaves the unit/edit area unlabeled and pack hints no longer align for scanning. This is a real regression against `DESIGN.md` and the committed screenshots (which show PACK). Fix: restore a PACK header and a consistent pack cell (or update DESIGN.md and move pack into a documented name sub-line with a deliberate header treatment). Do not leave the two representations half-and-half.

### SP-5 · Medium · Finish-trip dialog uses system jargon, hides the default, and gives no success feedback
The dialog says “Saves what is left of every batch today” (`ShopPage.tsx:507`); “batch” is a model term, not kitchen language. Unread meals default to “As planned” (`:521-529`) but the copy does not say unanswered meals count as cooked. `snapshot` success only closes the dialog (`:263-266`); there is no “Pantry saved” confirmation or route to Pantry. The per-meal `SegmentedControl size="xs"` is 40 px. Fix: rewrite in household language (“Saves the pantry as it stands today; unanswered meals count as cooked”), confirm with a toast + “View pantry” action, and use a 44 px control.

### SP-6 · Medium · Undo is single-use and several destructive actions have none
Only the last tick is undoable and only for 4 s (`ShopPage.tsx:207,492-499`; `UndoToast.tsx:3`). “Clear checked” soft-deletes checked text items permanently from the UI (`ShopPage.tsx:434-438`; `shop.ts:27-31`) with no confirm/undo. Product principle 3 says “undo over confirm”; a shopper who ticks three items and realises the first was wrong cannot undo it. Fix: keep a small undo stack or a single “Undo last” plus an explicit “Clear checked” confirmation/undo; increase the time limit for destructive undo.

### SP-7 · Medium · Buy modal has no pending state
`BuyModal` is passed `pending={false}` (`ShopPage.tsx:502`) and its Buy button calls `mutateBuy` then closes immediately. A double tap can enqueue two purchases with different batch IDs. Fix: pass the mutation's `isPending`, disable/close-guard while pending, or make the modal's submit await the mutation. The same applies to “Done shopping” while a snapshot is in flight (`:534-539` can be closed by backdrop/Escape).

### SP-8 · Medium · Long partner names can clip the relative time in the trip pass
The partner cell is 1.5fr with `overflow: hidden` (`shop.css:79-84`); `.sp-pname` has ellipsis but no `min-width: 0`, so as a flex child it refuses to shrink and the “N min” span is pushed out/clipped. Also the Queue value sneaks in an inline `fontSize: 15` (`ShopPage.tsx:488`) instead of the 19 px figure token. Fix: `min-width: 0` on the name, allow the time to stay visible or drop it on narrow widths, and use a token for the synced value.

### SP-9 · Low · Setting copy and date ranges
- The setup note points to Settings but has no link (`ShopPage.tsx:125`).
- “The next 1 day” reads badly (`:119`).
- The trip summary uses `dayName` = `ddd D` for both ends (`:40,372`); a trip crossing months reads “Mon 30 – Sun 12” without months. Use the shared month-aware formatter when the endpoints differ.
- “Staple, below min stock” exposes “min stock”; “Staple, running low” would be plainer.

### SP-10 · Low · Case-insensitive duplicate aisles
`groupByAisle` keys by exact category (`shoppingView.ts:112-124`) while ingredient categories are free text (`IngredientForm.tsx:33,65,113-119`). “Produce” and “produce” become two adjacent aisles with the same meaning. Normalise category case on save or group case-insensitively, preserving the first display spelling.

### SP-11 · Low · Offline badge wording
`OfflineBadge` says “Offline — n waiting” whenever the local shop queue is non-empty (`App.tsx:50-54`), including after reconnecting while the queue flushes, and shows nothing when the device is offline but no tick is queued. Fix: “n waiting to sync” when `navigator.onLine` is true, and optionally a separate quiet “Offline” state.

---

## 3. Pantry

### PA-1 · High · Read mode has no quick corrections, against the product's 1–2 tap principle
Read mode is a flat list with only a pencil into full edit mode (`PantryPage.tsx:107-113,142-158`). To record “used 200 g”, the user taps pencil, scrolls to the ingredient, edits a stepper, then taps Save: four or more actions. `PRODUCT.md:47` explicitly asks for one or two taps for pantry corrections, and `PRODUCT.md:25` lists used / set remaining / finished / discard as the kitchen actions. Fix: make each read row open a compact action sheet (Used…, Set remaining…, Finished, Threw away), or expose a row stepper/long-press menu. Keep the pencil for full inventory.

### PA-2 · High · Unsaved pantry edits are lost when leaving the tab
The draft lives only in component state (`PantryPage.tsx:46-68`) and the only guard is `beforeunload` (`:82-87`). Switching to Plan/Shop through the bottom bar unmounts the page and discards every change without a prompt. Fix: persist the draft (session storage/store) keyed by household, or add a route blocker using the existing GuardedModal pattern when `dirty`; do not rely on `beforeunload` for in-app navigation.

### PA-3 · Medium · The edit row collides at 360 px
At 360 px the `.sp-inv-row` grid resolves to `204px 72px 44px` (`pantry.css:14-17`) while the date input has `min-width: 96px` (`:48`). Measured in the browser with the current built CSS: the date field is 96 px wide in a 72 px cell, overlapping the 44 px remove button by **16 px** at 360 px. The layout only fits from roughly 384 px upward. Fix: stack the date under the amount on narrow screens, let the date shrink below 96, or give the remove button its own row; test 320/360 explicitly.

### PA-4 · Medium · Ingredient names are forced uppercase in edit mode
`.sp-inv-band` applies `text-transform: uppercase` to the whole band (`pantry.css:5-10`), and the ingredient name is its first child (`PantryPage.tsx:162-164`). This directly violates “names and amounts are never set in caps” (`DESIGN.md:186`) and makes long names harder to read and truncate. Fix: remove text-transform from the name; keep caps only for the unit/total metadata or a separate structural label.

### PA-5 · Medium · Adding an item is at the bottom and has no visible result
The “Add item” Select is rendered after every ingredient section (`PantryPage.tsx:234-249`). With a full pantry the user must scroll to the bottom, choose an ingredient, and the new row appears far above with no scroll or toast. Fix: make “Add item” a sticky/top action next to the pencil, or after adding, scroll the new row into view and focus its amount.

### PA-6 · Medium · Empty pantry is a dead end when no ingredients exist
“Add items” enters edit mode, but the Add item select has no options and nothing links to Ingredients (`PantryPage.tsx:129-135,236-243`). A first-run household cannot stock the pantry from this page. Fix: if the ingredient catalog is empty, show “Add ingredients first” with a link/button to `/ingredients` (or an inline quick-create).

### PA-7 · Medium · Search has no accessible label
`<TextInput placeholder="Search" …>` (`PantryPage.tsx:120`) has no label or `aria-label`, unlike Recipes and Ingredients (`RecipesPage.tsx:39`, `IngredientsPage.tsx:36`). Placeholder text is not a reliable name. Fix: add `aria-label="Search pantry"` and a clear button.

### PA-8 · Medium · To-taste switches save outside the draft
In edit mode, the to-taste switches mutate immediately (`PantryPage.tsx:253-257,270-279`) while the rest of the page waits for “Save changes”. A user who edits amounts and then flips a to-taste switch, then taps “Discard”, keeps the switch change. Fix: include to-taste flags in the draft, or label them “saved immediately” and place them outside the edit surface.

### PA-9 · Low · False dirty state and duplicate sub-lines
- `dirty = draft !== null` (`PantryPage.tsx:67`), so changing a value and changing it back still enables Save and shows “Discard”. Compare `diffEdits(origin, lines)` instead.
- A single batch with an expiry shows both the total on the right and “400 ml · expires 29 Nov” below the name (`:146-156`), duplicating the amount. Show the expiry-only sub-line when there is one batch.
- “Finished” vs “Threw it away” (`:214-215`) is the only explanation of the waste distinction; add a short helper or icons/wording in the menu.

---

## 4. Recipes and Recipe

### RC-1 · High · Markdown instructions are rendered as raw text
`PRODUCT.md:29` and `CONTEXT.md:12` promise markdown instructions; the form says “Markdown is fine” (`RecipeForm.tsx:210-217`); but `RecipeView` renders the string into a `<Text>` with `whiteSpace: pre-wrap` and an explicit shortcut comment (`RecipeView.tsx:18-19,101`). Users see `##`, `-`, `**` literally, and lists/links never render. Fix: render with a sanitized markdown component (`react-markdown` + `remark-gfm` + `rehype-sanitize`, or a deliberately limited renderer) styled with the prose tokens; keep a plain-text fallback for malformed input.

### RC-2 · High · Changing “Serves” in the form silently changes per-portion quantities, while the view scales
RecipeForm initialises line amounts as `qty_per_portion × recipe.serves` (`RecipeForm.tsx:49-55`) but does not rescale them when the serves SegmentedControl changes (`:112-119`); on save it divides the same number by the new serves (`:95`). So changing 2 → 4 servings keeps “200 g” on screen but stores 50 g/portion instead of 100 g/portion. RecipeView, by contrast, scales displayed amounts by the selected serves (`RecipeView.tsx:79-96`), reinforcing the expectation that serves is a scaling control. This is a silent data-quality trap that feeds the shopping list. Fix: either scale all line amounts when serves changes (old total × new/old), or prompt “Keep quantities / Scale to new serving count” and show the resulting per-portion amount. In RecipeView, label the control “Scale for” and state that it does not save.

### RC-3 · Medium · Recipe ingredient rows ignore the figure-column and hairline rules
Rows use a 1 px `--mantine-color-default-border` (= `--sp-edge` #6b7178) rather than the hairline `--sp-rule` (`RecipeView.tsx:91-97`), and amounts are right-aligned text without tabular figures or the shared figure column. The design reads much heavier than the rest of the board. Fix: use the hairline rule, a fixed right-aligned figure column with `tnum`, and the unit in secondary text.

### RC-4 · Medium · RecipeForm can be saved-blocked with no explanation
`canSave` requires a name, no duplicate ingredient IDs, and an amount on every non-to-taste line (`RecipeForm.tsx:76-82`), but only the amount Stepper shows an error, and only after a value exists (`:162`). A blank amount, duplicate line or missing ingredient leaves Save disabled with no message. Fix: show an inline summary/field errors (“Add an amount for 2 ingredients”, “Remove the duplicate ingredient”), and validate on blur/submit.

### RC-5 · Medium · Repeated accessible labels and unassociated Stepper errors
Every line uses `aria-label="Ingredient"`, every amount Stepper `aria-label="Amount"`, and every remove button “Remove ingredient” (`RecipeForm.tsx:139-151,155`). Screen-reader users cannot tell which line is which. The Stepper is a custom input inside `Input.Wrapper` (`Stepper.tsx:49-85`) with no `id`/`aria-describedby`, so its description/error text is not associated and clicking the visible label does not focus the field. Fix: suffix labels with the ingredient/line (“Amount for Parmesan”), give the input an id and `aria-describedby`/`aria-errormessage`.

### RC-6 · Low · Empty and search states
Recipes renders two “Add recipe” CTAs when empty (header and empty state, `RecipesPage.tsx:34,41-46`); search has no clear action and the searchable tags are not explained. Same pattern in Ingredients. Pick one primary CTA and add a clearable search.

---

## 5. Ingredients

### IN-1 · Medium · The locked-unit explanation is invisible on touch
The disabled unit SegmentedControl is covered by a transparent button labelled “Unit locked. Why?” (`IngredientForm.tsx:92-103`). On touch there is no visible lock or “Why?” text; users must discover a tap on a control that looks disabled. The dashed border (`theme.css:124`) is a hint, but not an affordance. Fix: show a lock icon/“Locked — why?” next to the control, or a persistent helper line when `inUse`.

### IN-2 · Medium · Optional numbers hide their “blank vs 0” rule
Pack size, shelf life and min stock are “Optional” Steppers (`IngredientForm.tsx:121-127`) where blank and 0 both mean “none” (`:46-53`), but the UI never says so. The Stepper placeholder is an en dash, and the error text is not associated (see RC-5). Fix: add a short helper (“Leave blank for none; 0 also means none”) and make the blank state explicit.

### IN-3 · Low · Raw units and category casing
The list prints `i.unit.replace('_', ' ')` (`IngredientsPage.tsx:53`), so users see “count” and “to taste” as columns; category casing is free text and can spawn duplicate aisles in Shop (SP-10). Fix: use the same display-unit formatter as the rest of the app and normalise category display.

---

## 6. Settings

### SE-1 · Medium · Timezone is not editable
The household row stores `timezone` (default `Europe/Rome`, `supabase/migrations/…init.sql:13`) and it drives slot-end check-ins and expiry reminders, but Settings exposes no timezone control (only horizon, expiring days, reminder days, end times). A household outside Rome gets check-ins and reminders at the wrong wall-clock time. `CONTEXT.md:30` lists timezone as a shared setting. Fix: add a searchable timezone Select (IANA zones) to the Household settings, show the current zone next to the reminder copy, and default new households to the device zone where possible.

### SE-2 · Medium · “Today and the next N days” is off by one
`tripRange` returns today through today + N − 1 (`trip.ts:20-22`), but the Household settings description says “A shopping trip covers today and the next N days” (`SettingsPage.tsx:62-64`). For N=7 the app covers today + 6 days. Fix: say “today plus the following N−1 days” or define the setting as “days ahead” and align both copy and code.

### SE-3 · Medium · Three set-state-in-effect forms can flicker or clobber typing
YourName (`SettingsPage.tsx:22-23`), HouseholdSettings (`:49-54`) and SlotEndTimes (`:112-115`) copy server state into local state in effects; lint flags all three. They render placeholder defaults (7/3/2) before the query resolves, then jump, and if a refetch resolves while the user is typing, the effect overwrites the draft. Fix: key the form by the loaded row and initialise once, use `defaultValue`+uncontrolled fields, or keep the draft unless untouched; show a loading state for the fields.

### SE-4 · Medium · The notification cross-reference points to the wrong section
NotificationSettings says “Slot times are under Household” (`NotificationSettings.tsx:68`), but slot end times are their own “Meal end times” section below Household and above Notifications. Fix: “Slot times are under Meal end times above” (or make it a link/scroll action).

### SE-5 · Medium · There is no way back to “follow the phone” for the theme
The theme copy says “Follows your phone until you pick one” (`SettingsPage.tsx:163`), but the only values are Light/Dark/AMOLED; once picked, `stored.theme` is always set and the system listener no longer applies (`settings.ts:35-36,55`). Fix: add an “Auto”/“System” option that clears the stored theme, or change the copy to say the choice is permanent until changed.

### SE-6 · Low · Mixed save models and the notification-prefs race
Settings has three explicit Save buttons, instant theme/density, and auto-saving notification switches. Rapidly toggling two notification switches can lose one: each `patch` spreads the same server snapshot `p` (`NotificationSettings.tsx:36,60-91`), so the second request can overwrite the first before refetch. Fix: keep a local prefs draft and save on blur/explicit Save, or apply a functional patch and disable switches while a save is pending. Also add a success confirmation to the long “Save household settings” action.

### SE-7 · Low · Household name cannot be changed
The household menu shows the name (`App.tsx:90-92`), but Settings has no field to rename it. A typo in onboarding is permanent without SQL. Add it alongside the other household settings.

---

## 7. Auth and Household

### AU-1 · High · Sign-up is silent when email confirmation is enabled
The adapter discards the `signUp` result and only checks for an error (`supabaseAdapter.ts:30-33`); AuthPage has no success handler (`AuthPage.tsx:25-28,82-84`). With “Confirm email” on — which the README recommends (`README.md:72`) — Supabase creates the user but returns no session, so the button stops loading and the page does not change. The person has no “check your email” message, no resend, and may assume sign-up failed. Fix: return `{ needsConfirmation }` from the port; show a clear Alert (“Check your email to confirm, then sign in”) with a resend action, and switch to sign-in mode. Add a test for both confirmation-on and auto-confirm.

### AU-2 · Medium · No password reset
There is no “Forgot password?” or reset screen anywhere (no `resetPasswordForEmail` in `src/`). A forgotten password locks a household member out; the only recovery is the Supabase dashboard. Fix: add a reset request on AuthPage and a “set a new password” state for the recovery redirect, using the existing error/redirect handling patterns.

### AU-3 · Medium · No privacy/terms link at the point of sign-up
The privacy notice lives only in Settings (`AccountData.tsx:87-89`), after an account exists. Sign-up asks for an email and creates a household; the notice should be visible before submitting. Fix: add a small “Privacy” link on the Auth card and the Household setup page.

### AU-4 · Low · Household create/join share one loading flag
Both submit buttons use `loading={busy}` (`HouseholdPage.tsx:33-37,61,76`), so submitting “Join” also spins “Create household”. Fix: use each command's own `isPending`.

### AU-5 · Low · “Scan their QR code” implies an in-app scanner
The join description says “or scan their QR code” (`HouseholdPage.tsx:72`), but the app has no scanner; the QR is meant for the phone camera. Fix: “scan it with your phone camera”.

### AU-6 · Low · Sign-up heading semantics and field size
The title is an h2 (`AuthPage.tsx:47`; see X-3), and the fields/buttons are 36 px (X-2). The Auth page is otherwise clean and well centred; the live 390 px capture shows the card fitting with comfortable margins.

---

## 8. Shell, navigation and PWA

### PW-1 · High · Full-screen modals ignore the iOS safe area
`Modal fullScreen` is used for RecipeForm, IngredientForm, AmountsModal and RecipeView (`RecipeForm.tsx:103`, `IngredientForm.tsx:81`, `CheckinModals.tsx:112`, `RecipeView.tsx:69`). Mantine's full-screen content is `100dvh` with zero inner offset (built CSS), while only the AppShell header/footer add `env(safe-area-inset-*)` (`shell.css:1-4,13`). In an installed iPhone app (`viewport-fit=cover`), the modal header/close button sits under the status bar/Dynamic Island and the bottom actions can sit under the home indicator. Fix: add safe-area padding to the modal content/header/body (with a theme classNames hook, not hash selectors) and a bottom safe inset for full-screen footers; verify installed iOS.

### PW-2 · Medium · Toasts sit on the tab bar and vanish too fast
Mantine Notifications defaults to **bottom-right**, 16 px from the bottom, with a 4 s auto-close (`node_modules/@mantine/notifications` defaults; app never overrides). That overlaps the fixed tab bar on phones (and sits below the trip pass), while error toasts also disappear in 4 s. Fix: position notifications above the dock/tab bar on phones (or top-centre with a safe-area offset), use a persistent/longer duration for errors, and theme the notification chrome with the panel/rule tokens.

### PW-3 · Medium · The household menu is the only Settings door and the invite block is cramped
The menu uses `shadow="md"` (`App.tsx:88`) although the design allows shadows only on floating dock elements (`DESIGN.md:199-202`), and the invite URL is `truncate="end"` in a 260 px menu with 26 px Copy/Share buttons (`App.tsx:107-124`). The committed menu capture shows the URL reduced to `http://l…` and the Copy button tight against the menu edge. Settings is only discoverable after opening the household name. Fix: remove the shadow; give the invite URL its own full-width line and 44 px actions; add a visible gear/Settings affordance in the header or menu trigger.

### PW-4 · Low · PWA boot and manifest polish
The built manifest has name/short_name/start_url/display/lang/scope/icons, which is good. It lacks a description and screenshots; `theme-color` is static dark (`index.html:6`, `vite.config.ts:20`) until settings.ts runs, and the initial paint can flash the wrong ground because no inline boot script sets `data-spensa-theme` before CSS. Fix: add description/screenshots, and a tiny inline theme-boot script that sets the data attributes and meta color from `localStorage` before first paint.

### PW-5 · Low · Header and tab bar at the narrowest widths
The header is `nowrap` with brand + optional offline badge + household button; with a long household name and a queued badge, it can overflow around 320 px (`App.tsx:150-157`). At 320 px the “INGREDIENTS” tab label is about 67–72 px against a 64 px cell even after the 0.02em tracking adjustment (`shell.css:20`), so it overflows into Shop; at 390 px it fits. Fix: allow the household label to truncate, shorten the tab label or widen the grid below 340 px, and test 320 px.

### PW-6 · Low · Offline coverage is only the shop queue
The shell has no general offline state; if the device is offline without queued shop ticks, the UI looks normal until a request fails. ErrorState covers cached data, but the user cannot tell whether new ticks are queued or lost. Consider a small connection state in the household menu or offline badge, and make the queue copy specific (SP-11).

---

## 9. Checked and cleared

These candidate findings were investigated and either do not hold or are already correct:

- **“Shop error state has no title”** — it falls back to ErrorState's default “Couldn't load your list” (`ShopPage.tsx:336`, `ErrorState.tsx:17`). The title exists; the copy issue is the *inline* default on non-shop pages (X-4).
- **Plan week controls are 44 px** — `size="xs"` is overridden by `plan.css:106-111`; chevrons are explicitly `size={44}`. No issue.
- **Shop rows, Stepper buttons, Pantry row actions, Menu items, tab cells** — rows use `--row-h` (44 compact / 72 airy), Stepper uses 44/52, Pantry action icons are 44, Menu items have `min-height: 44px` (`theme.css:130`), and tabs are inside a 60 px footer. The tap-target failure is the *other* controls in X-2, not these.
- **Text contrast in all three themes** — normal text and secondary text pass AA: Ink on light ground 15.85:1; light secondary 6.63:1 (8.14:1 on white); dark board white 17.34:1, secondary 6.15:1 (7.38:1 on ground); AMOLED secondary 13.62:1; dark red on panel 4.95:1; light red on ground 5.27:1. Yellow is not used as text on light in app CSS (the cue/chip overrides are correct). The contrast failures are the light focus ring, the dark destructive-red states and the switch track (see X-1 and X-10).
- **Pantry save bar / Shop dock bottom clearance** — the 150 px Shop padding clears the fixed pass; the Pantry save bar is sticky at the end on desktop and fixed on phones, and the 80 px body padding plus main padding keeps the last row reachable. A sticky-at-end check confirmed it remains visible while scrolling. Not flagged.
- **Density and 380 px behaviour** — the density variables are used for rows/ticks/amounts, and the tab-label tracking media query exists. The only confirmed narrow-width failures are the Pantry edit row at 360 (PA-3) and the 320 px tab/header crowding (PW-5).
- **Settings `TimeInput width 160`** — the width itself is fine for `HH:MM`; the issue is its 36 px height and the lack of a timezone setting, not the width.
- **Pack hint / long names / figure alignment** — long names wrap (`overflow-wrap: anywhere`), figures are tabular and right-aligned in their column, and the unit is left-aligned. The problem is that the PACK column/header was removed (SP-4), not the figure alignment.

## 10. Concentrated contrast and control measurements

| Pair / state | Ratio | Verdict |
|---|---:|---|
| Ink on light ground | 15.85:1 | pass |
| Light secondary on ground / panel | 6.63 / 8.14 | pass |
| Light red on ground / panel | 5.27 / 6.47 | pass |
| Dark board white on ground | 17.34:1 | pass |
| Dark secondary on panel / ground | 6.15 / 7.38 | pass |
| Dark red text on panel | 4.95:1 | pass |
| AMOLED secondary on black | 13.62:1 | pass |
| Yellow focus on light ground | **1.26:1** | fail 1.4.11 |
| Yellow focus on white | **1.55:1** | fail 1.4.11 |
| White text on dark filled red (`#ff4d4d`) | **3.27:1** | fail AA text |
| Dark red text on dark red-light (#651515) | **3.84:1** (2.76 hover) | fail AA text |
| Switch off track (`#dee2e6`) on light ground | **1.06:1** | control boundary nearly invisible |
| Disabled light button (`#adb5bd` on `#e9ecef`) | 1.75:1 | exempt, but visually dead / off-world |

Live measurements: default Button/TextInput height **36 px**; `size="md"` **42 px**; SegmentedControl label **40 px**; modal CloseButton **28 px**; `compact-sm` **26 px**. At 360 px the Pantry grid is `204 / 72 / 44` with a 96 px date field overlapping the remove button by 16 px.

## 11. Prioritized punch list

| Priority | Work | Effort |
|---|---|---|
| P0 | Fix SP-1 held-row tap: acknowledge without unticking; stop propagation; add regression test. | S |
| P0 | Fix X-1 light focus rings (buttons, segmented, switch, radio). | S |
| P0 | Meet 44 px on all controls in X-2; check modal close, compact menu, xs segmented, default buttons/inputs. | M |
| P0 | Guard Pantry drafts on in-app navigation (PA-2); keep or persist the draft. | M |
| P0 | Add iOS safe-area padding to full-screen modals (PW-1). | S |
| P0 | Resolve dark destructive-red and switch/disabled contrast (X-10): darker fill or ink text; map switch/disabled tokens. | S |
| P0 | Show sign-up confirmation state and resend (AU-1). | S |
| P1 | Render markdown instructions safely (RC-1). | M |
| P1 | Decide and implement serves scaling / explicit prompt (RC-2). | M |
| P1 | Restructure Shop rows to remove nested interactive controls and expose amount/pack/note (SP-2). | M |
| P1 | Add Pantry quick actions (PA-1) and move/add-item affordance (PA-5). | L |
| P1 | Fix Pantry 360 px collision (PA-3). | S |
| P1 | Shared PageTitle/h1 + route scroll/title/404 (X-3, X-6). | M |
| P1 | Fix held highlight auto-clear (SP-3) and finish-dialog copy/feedback (SP-5). | S |
| P1 | Toast placement above dock, longer errors (PW-2). | S |
| P1 | Settings timezone, horizon copy, Section cross-ref, Auto theme, notification race (SE-1,2,4,5,6). | M |
| P2 | Restore/decide PACK column (SP-4); error/empty copy (X-4); date provider (X-5). | M |
| P2 | Plan onboarding/date-title/delete undo, desktop planner density (PL-1,3,4,5). | M |
| P2 | Switch/disabled/menu/notification theming (gaps below). | M |
| P2 | 320 px header/tab fit (PW-5), manifest boot polish (PW-4). | S |

## 12. Design-system gaps

**Tokens**
- `--sp-control-min: 44px` (and a `--sp-control-lg` for dock/primary actions); apply through component defaults, not call sites.
- A focus layer that cannot be lost to Mantine: `--sp-focus` must drive `.mantine-focus-auto`, segmented/switch/radio adjacent labels, and the row/pencil/ack states. Add a contrast assertion for yellow-on-light at build/review time.
- Separate destructive tokens: `--sp-red-text` (bright on dark, dark on light) vs `--sp-red-fill` + `--sp-red-contrast` (choose a fill/text pair that passes 4.5:1 in dark and AMOLED).
- `--sp-switch-off`, `--sp-disabled-bg`, `--sp-disabled-text`; map Mantine's disabled variables away from its default gray palette.
- Safe-area tokens for portals: `--sp-safe-top`, `--sp-safe-bottom`, and a toast/dock offset.
- `--sp-pack-col` and a documented pack placement, or remove the pack column from `DESIGN.md` deliberately.

**Components**
- `PageTitle` (h1 + `.sp-title`, optional week range/subtitle) used by every route, setup and full-page error.
- `EmptyState` (one-line reason + one primary action) and `ErrorState` variants with per-context messages.
- A quantity/unit formatter and a `Figure` component that owns tabular figures, the unit, and count/to-taste suppression.
- A safe `Markdown` component with prose styles and sanitisation.
- `SafeAreaModal`/`SafeAreaSheet` or a theme `Modal` content class that applies insets; `ToastRegion` positioned above the dock.
- A destructive-action pattern: inline confirm for irreversible table deletes, undo toast for everything soft-deletable, and a guard for inline drafts.
- A date/format provider (`DatesProvider` en-GB Monday-first) and route title/scroll/focus effects.
- An `AddItem` control that is reachable at the top of Pantry, with scroll/focus to the new row.

**Theme mappings missing**
- Switch off/on track and thumb; Radio; Notifications; TagsInput/Combobox option hover; modal CloseButton size; Alert contrast; disabled Button/Input. These currently inherit Mantine defaults and visibly leave the gate-board world (pale gray fills, default rounded chips, default shadows).
- Remove the one-off `shadow="md"` on the household Menu (`App.tsx:88`).
- Pantry edit bands must stop uppercasing names (`pantry.css:5-10`).

**Documentation drift to reconcile**
- Pack column/header (DESIGN says 5 columns with PACK; code has 4 used columns and pack under the name).
- Side rail 200 px vs DESIGN's 208; desktop dock max-width/centring.
- Red used for destructive buttons while DESIGN says “red is only for shortfall and error” — either document destructive red or move destructive actions to an outlined/neutral treatment.
- `DESIGN.md:186` “names and amounts are never set in caps” is violated by the Pantry edit band.
- `DESIGN.md:199-202` “only floating dock elements have a shadow” is violated by the household Menu.
- `DESIGN.md:260` 44 px rows is met, but controls are not; state the control rule explicitly in DESIGN.
- `DESIGN.md` says segmented control label height 40; the product tap rule says 44. Resolve to 44.

## 13. Suggested review matrix next time

- 320, 360, 390, 768, 1024, 1440 widths; compact and airy; light, dark, AMOLED.
- Keyboard-only pass: tab through every route and both modals, capturing focus-ring contrast and focus order; especially Shop rows, segmented controls, switches and the held-row ack.
- Installed iOS PWA: status bar/Dynamic Island and home indicator over full-screen RecipeForm/AmountsModal; notification tap and check-in deep link.
- Two-device Shop test: partner ticks while the other phone is on the list, both phones backgrounded/foregrounded, offline queue flush, and held-row acknowledge/put-back.
- Pantry path: 50 ingredients, add an item from the bottom, leave the tab mid-edit, change a value and revert, remove/undo a batch.
