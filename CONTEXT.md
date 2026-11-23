# Spensa

A meal planner and pantry tracker for one household (two people). You plan meals for the week, Spensa works out what's in the pantry and what to buy.

Stack: Vite + React + TypeScript, Mantine, TanStack Query, React Router, Supabase (Postgres + Auth + Realtime). Static SPA, mobile-first PWA. English UI only.

## Glossary

- **Household**: the unit that owns all data. A user belongs to exactly one household and joins it with an **invite code**. Every table is scoped to a household by RLS.
- **Ingredient**: a household catalog entry, named whatever the user likes ("pasta", "penne"). It has one **unit**: `g`, `ml`, `count` or `to_taste`. Optional fields: **category** (used to group the shopping list), **pack size** (for "≈ 1 pack" hints), **shelf life** in days (pre-fills expiry), **min stock** (makes it a **staple**).
- **To-taste ingredient**: unit `to_taste` (salt, oil). It has no quantity, only an **on hand / out** flag.
- **Recipe**: name, markdown instructions, optional tags, and **recipe ingredients**. Amounts are entered for a chosen **serves N** (1, 2, 3, 4, 6, 8; default 2) and stored **per portion**.
- **Slot**: a meal time in a day (default: lunch, dinner; configurable per household).
- **Planned meal**: date + slot + recipe + portions. A slot can hold several. A planned meal counts as **eaten on its date**, whether or not it was cooked. Past days can be edited.
- **Batch**: one purchase of an ingredient: quantity, date added, optional expiry. The pantry page lists batches per ingredient and edits them in place.
- **Adjustment**: a manual stock change: `used X`, `set remaining to X`, `finished`, or `discard` (recorded as waste). Applies to the batch that expires soonest unless a batch is picked.
- **Snapshot**: the recorded remaining quantity of every batch at a moment. Saved by an **inventory check** (the Pantry page's "Save changes"), or by "confirm the rest?" at the end of a shopping trip. A snapshot is the truth: events before it no longer change stock.
- **Replay**: how stock is computed. Start from the latest snapshot, then apply batches, planned meals and adjustments in date order. Meals use the batches that expire soonest first (FEFO). Nothing derived is stored. See [ADR 0001](docs/adr/0001-stock-by-replay.md).
- **Current stock**: the replay up to today. **Projected stock**: the replay including future planned meals.
- **Shortfall**: a past planned meal needed more than the replay had. Shown as "short by X"; stock never goes negative.
- **Expiring soon**: a batch that expires within the household threshold (default 3 days).
- **Shopping list**: computed for a date range (default next 7 days). For each ingredient, need = planned amount − stock usable on the meal's day (after earlier meals, excluding batches expired by then). It also includes staples below min stock, to-taste ingredients marked out, and **manual items** (free text, or an ingredient added by hand). **Ticking** an ingredient item creates a batch, with the quantity pre-filled as max(need, pack size) and expiry from shelf life. Ticks sync live between phones and are queued while offline.

## Rules

- An ingredient can't be deleted while a recipe uses it. Its page lists those recipes.
- A recipe can't be deleted while a planned meal after the latest snapshot uses it. Its page lists those meals.
- Quantities are decimals in the ingredient's unit. Metric only, no unit conversion.

## Out of v1

Tracked as GitHub issues labelled `backlog`.
