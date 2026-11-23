-- Security hardening (docs/adr/0002-household-scoping.md).
-- Supersedes the "-- shortcut:" note in 20261123140033_init.sql: referenced ids are now checked to belong
-- to the same household by composite foreign keys, and invite codes change only through rotate_invite_code().
-- Needs Postgres 15+ for `on delete set null (column)`; supabase/config.toml targets 17.

-- 1. Composite foreign keys. Parents get unique (household_id, id); children reference (household_id, <ref>_id).
-- household_id is not null on every child, and a null <ref>_id skips the check (MATCH SIMPLE), so optional refs stay optional.
alter table public.ingredients add constraint ingredients_household_id_id_key unique (household_id, id);
alter table public.recipes add constraint recipes_household_id_id_key unique (household_id, id);
alter table public.batches add constraint batches_household_id_id_key unique (household_id, id);
alter table public.snapshots add constraint snapshots_household_id_id_key unique (household_id, id);

alter table public.recipe_ingredients
  drop constraint recipe_ingredients_recipe_id_fkey,
  drop constraint recipe_ingredients_ingredient_id_fkey,
  add constraint recipe_ingredients_recipe_fkey
    foreign key (household_id, recipe_id) references public.recipes (household_id, id) on delete cascade,
  add constraint recipe_ingredients_ingredient_fkey
    foreign key (household_id, ingredient_id) references public.ingredients (household_id, id) on delete restrict;

-- set null would also null household_id (not null), so name the column to clear.
alter table public.planned_meals
  drop constraint planned_meals_recipe_id_fkey,
  add constraint planned_meals_recipe_fkey
    foreign key (household_id, recipe_id) references public.recipes (household_id, id) on delete set null (recipe_id);

alter table public.batches
  drop constraint batches_ingredient_id_fkey,
  add constraint batches_ingredient_fkey
    foreign key (household_id, ingredient_id) references public.ingredients (household_id, id) on delete cascade;

alter table public.adjustments
  drop constraint adjustments_ingredient_id_fkey,
  drop constraint adjustments_batch_id_fkey,
  add constraint adjustments_ingredient_fkey
    foreign key (household_id, ingredient_id) references public.ingredients (household_id, id) on delete cascade,
  add constraint adjustments_batch_fkey
    foreign key (household_id, batch_id) references public.batches (household_id, id) on delete cascade;

alter table public.snapshot_batches
  drop constraint snapshot_batches_snapshot_id_fkey,
  drop constraint snapshot_batches_batch_id_fkey,
  add constraint snapshot_batches_snapshot_fkey
    foreign key (household_id, snapshot_id) references public.snapshots (household_id, id) on delete cascade,
  add constraint snapshot_batches_batch_fkey
    foreign key (household_id, batch_id) references public.batches (household_id, id) on delete cascade;

alter table public.shopping_items
  drop constraint shopping_items_ingredient_id_fkey,
  drop constraint shopping_items_bought_batch_id_fkey,
  add constraint shopping_items_ingredient_fkey
    foreign key (household_id, ingredient_id) references public.ingredients (household_id, id) on delete cascade,
  add constraint shopping_items_bought_batch_fkey
    foreign key (household_id, bought_batch_id) references public.batches (household_id, id) on delete set null (bought_batch_id);

-- (planned_meals.cook_id -> auth.users is already checked by the check_cook_is_member trigger.)

-- 2. Members update only everyday settings directly. invite_code (and id, created_at) are not updatable.
revoke update on public.households from authenticated;
grant update (name, slots, timezone, expiring_days) on public.households to authenticated;

-- security definer because invite_code is no longer updatable by members; it only touches the caller's own
-- household (my_household()), so it grants nothing beyond "a member rotates their own code".
create function public.rotate_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if public.my_household() is null then raise exception 'not in a household'; end if;
  update public.households h
    set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where h.id = public.my_household()
    returning h.invite_code into code;
  return code;
end $$;

revoke execute on function public.rotate_invite_code() from public, anon;
grant execute on function public.rotate_invite_code() to authenticated;
