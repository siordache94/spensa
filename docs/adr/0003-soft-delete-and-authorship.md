# 0003: Soft delete and authorship on every fact

## Status

Accepted, 2026-11-24.

## Context

Two people edit one pantry and plan, and mistakes happen: a recipe deleted by accident, a tick undone on the wrong phone. We want to go back and see who did what and when, and to fix it. Hard deletes (and `on delete cascade`) destroy exactly that history. Replay (ADR 0001) also needs a stable set of facts.

## Decision

### Soft delete, always

Every household table (ingredients, recipes, recipe_ingredients, planned_meals, batches, adjustments, snapshots, snapshot_batches, shopping_items) has `deleted_at` and `deleted_by`. Join rows are soft-deleted too. Nothing the app does removes a row.

- **Mechanism: a `BEFORE DELETE` trigger plus explicit RPCs.** The trigger turns any `DELETE` by a signed-in user into `deleted_at = now()` and skips the real delete. It is the safety net: a stale PWA build, a new code path or a hand-written query cannot destroy data. The app itself calls `soft_delete(tbl, ids)` and `restore(tbl, ids)` (`src/lib/softDelete.ts`) so intent is explicit. A trigger alone would hide what the code does; an RPC alone would not stop a stray `.delete()`. Only sessions with no `auth.uid()` (service role, SQL console, cascades from deleting a household or user) hard-delete, which keeps an admin purge possible.
- **Why RPCs and not a plain `UPDATE`:** Postgres checks an UPDATE's new row against the SELECT policy, and a deleted row fails it. `soft_delete` and `restore` are `security definer` with an explicit `household_id = my_household()` filter and a whitelist of tables.
- Triggers stamp the data: `deleted_at` is always the server's `now()`, `deleted_by` is `auth.uid()`; a client cannot set either.

### Reads exclude deleted rows by RLS

Each table's select policy is `household_id = my_household() and deleted_at is null` (insert, update and delete policies also require it). So `fetchPantry`, every page query, embedded selects (a meal's `recipes(...)`, a snapshot's `snapshot_batches`) and every invoker RPC (`save_snapshot`, `buy_shopping_item`, `save_pantry_edits`, ...) ignore deleted rows with no per-query filter to forget. The domain types in `src/domain/replay.ts` stay free of deleted fields: the replay never sees a deleted fact. A History screen will read deleted rows through a separate `security definer` function or view, not by widening these policies.

### Uniqueness among live rows

`unique (household_id, name)` on ingredients is now a partial unique index `where deleted_at is null`, so a deleted name can be reused. `recipe_ingredients` gets a surrogate `id`, with `unique (recipe_id, ingredient_id) where deleted_at is null` replacing its primary key.

### Soft cascade replaces FK actions

Because rows are never deleted, `on delete cascade / restrict / set null` no longer fire for the app (they remain as a backstop for admin hard deletes). Triggers replace them:

- Soft-deleting an **ingredient** is refused (`foreign_key_violation`) while a live recipe line uses it; otherwise its batches, adjustments and shopping items go with it.
- Soft-deleting a **batch** soft-deletes its adjustments and snapshot lines (so replay and the snapshot ignore it), and sets `bought_batch_id` to null on the list item that bought it (the old `set null`).
- Soft-deleting a **snapshot** soft-deletes its lines; the previous snapshot becomes the latest.
- Soft-deleting a **recipe** soft-deletes its lines and is refused while a live meal after the latest snapshot uses it (as before). **Planned meals are not cascaded**: they keep their `recipe_id`, the recipe reads as missing (the embed is null, as the old `set null` made it), and restoring the recipe reconnects them.
- **Restore** clears `deleted_at` on the row and on the children whose `deleted_at` equals the parent's (deleted in the same transaction). Children deleted earlier on their own stay deleted. A row cannot be restored or inserted under a deleted parent (`check_parents_live`, replacing the FK check, which cannot see `deleted_at`). Restoring an ingredient whose name is taken fails with a unique violation.

### Authorship on every fact

Every table has `created_at`, `created_by` (default and `BEFORE INSERT` trigger from `auth.uid()`), `updated_at`, `updated_by` (`BEFORE UPDATE` trigger), `deleted_at`, `deleted_by`. Triggers overwrite whatever the client sends, so none of it can be spoofed, and `created_*` cannot change. An update that changes nothing leaves `updated_*` alone. Restore shows up as `updated_at/by`. These are separate from `recorded_at` and `added_at`, which keep their ordering and display roles (ADR 0001).

## Consequences

- Any mistake is recoverable, and the data answers "who created, changed or deleted this, and when". The History UI is a later wave; nothing more is needed in the schema.
- `updated_*` records only the last change, not a full audit log.
- Tables only grow. For two people that is small; a purge job (service role) can hard-delete old rows later.
- Realtime: a soft delete is an UPDATE to a row the other phone can no longer select, so Supabase Realtime `postgres_changes` does not push it (hard deletes were pushed; verified locally: an INSERT of a `shopping_items` row arrives, its soft delete does not). Row events therefore cannot drive live sync. Instead a statement-level trigger on every household table touches one `household_events` row per household (`by` = writer, `at`), which stays visible under RLS, is not client-writable, and is the only table in the realtime publication. The Shop tab subscribes to it, refetches on any event, and uses `by` to tell the partner's changes from its own echoes. This also covers tables with no row events at all (`planned_meals`, `recipes`, `households`). Gotcha: subscribing to a table that is not in the publication silently breaks every binding on the channel.
- `household_events` is the one household table without soft delete or authorship columns: it is a signal, not a fact.
- RPCs that delete (`unbuy`, `finish_shopping`, `save_recipe`) call `soft_delete`. `save_recipe` now diffs recipe lines (update, soft-delete removed, insert new) instead of replacing them, so unchanged lines keep their row and history.
- Every new household table must be added to the trigger and policy loop in the migration.
