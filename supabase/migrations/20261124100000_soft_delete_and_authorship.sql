-- Soft delete and authorship on every household table (docs/adr/0003-soft-delete-and-authorship.md).
-- Nothing is ever hard-deleted by a signed-in user: a DELETE becomes deleted_at/deleted_by, RLS hides deleted
-- rows from normal reads, and every fact records who created / updated / deleted it and when.

-- 1. Columns -----------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('alter table public.%I
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists created_by uuid default auth.uid() references auth.users on delete set null,
      add column if not exists updated_at timestamptz,
      add column if not exists updated_by uuid references auth.users on delete set null,
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by uuid references auth.users on delete set null', t);
  end loop;
end $$;

-- Existing rows: the best creation time we have.
update public.batches set created_at = recorded_at;
update public.adjustments set created_at = recorded_at;
update public.snapshots set created_at = taken_at;

-- 2. Uniqueness only among live rows ------------------------------------------------------------------------
alter table public.ingredients drop constraint ingredients_household_id_name_key;
create unique index ingredients_household_name_live on public.ingredients (household_id, name) where deleted_at is null;

-- recipe_ingredients gets a surrogate key so a removed line and a re-added one can coexist.
alter table public.recipe_ingredients drop constraint recipe_ingredients_pkey;
alter table public.recipe_ingredients add column id uuid not null default gen_random_uuid() primary key;
create unique index recipe_ingredients_live on public.recipe_ingredients (recipe_id, ingredient_id) where deleted_at is null;

-- 3. RLS: deleted rows are invisible and immutable to clients -----------------------------------------------
-- Postgres also checks an UPDATE's new row against the SELECT policy, so a client UPDATE can't set deleted_at
-- (the row would become invisible). Soft delete and restore therefore go through soft_delete() / restore() below,
-- or through a plain DELETE, which a trigger converts.
do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('drop policy "household rows" on public.%I', t);
    execute format('create policy "live rows read" on public.%I for select to authenticated
                    using (household_id = public.my_household() and deleted_at is null)', t);
    execute format('create policy "live rows insert" on public.%I for insert to authenticated
                    with check (household_id = public.my_household() and deleted_at is null)', t);
    execute format('create policy "live rows update" on public.%I for update to authenticated
                    using (household_id = public.my_household() and deleted_at is null)
                    with check (household_id = public.my_household() and deleted_at is null)', t);
    execute format('create policy "live rows delete" on public.%I for delete to authenticated
                    using (household_id = public.my_household() and deleted_at is null)', t);
  end loop;
end $$;

-- 4. Authorship triggers ------------------------------------------------------------------------------------
-- Clients (auth.uid() not null) can't choose created_*/updated_*/deleted_*. Admin/service sessions (uid null)
-- may write created_by (seeding) and are the only ones allowed to hard-delete.
create function public.audit_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  new.updated_at := null; new.updated_by := null; new.deleted_at := null; new.deleted_by := null;
  return new;
end $$;

create function public.audit_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  requested timestamptz := new.deleted_at;
begin
  new.created_at := old.created_at;
  if uid is not null then new.created_by := old.created_by; end if; -- uid null: lets ON DELETE SET NULL through
  if old.deleted_at is null and requested is not null then
    new.deleted_at := now(); new.deleted_by := uid;           -- soft delete
  elsif old.deleted_at is not null and requested is null then
    new.deleted_at := null; new.deleted_by := null;           -- restore
  else
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
  end if;
  -- an update that changes nothing leaves no trace
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := old.updated_at; new.updated_by := old.updated_by;
  else
    new.updated_at := now(); new.updated_by := uid;
  end if;
  return new;
end $$;

-- 5. DELETE becomes soft delete -----------------------------------------------------------------------------
-- Security definer so the conversion works whatever the caller's policies; the DELETE itself was already
-- filtered by RLS, so only rows the caller may delete reach this trigger. ctid identifies the row for tables
-- without a single-column key.
create function public.soft_delete_on_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return old; end if; -- admin/service role, or a cascade from deleting a household/user
  execute format('update public.%I set deleted_at = now() where ctid = $1', tg_table_name) using old.ctid;
  return null; -- skip the real delete
end $$;

-- 6. Integrity that FKs used to give us -------------------------------------------------------------------------
-- A soft-deleted row never gets hard-deleted, so ON DELETE RESTRICT/CASCADE/SET NULL no longer fire. They stay
-- as the backstop for admin hard deletes; the rules below replace them for the app.
create function public.require_live(tbl text, rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  if rid is null then return; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and deleted_at is null)', tbl) into ok using rid;
  if not ok then
    raise exception 'referenced % is deleted or missing', tbl using errcode = 'foreign_key_violation';
  end if;
end $$;

-- Parents of a new/restored/re-pointed row must be live.
create function public.check_parents_live() returns trigger
language plpgsql set search_path = '' as $$
declare
  fresh boolean := tg_op = 'INSERT';
  restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
begin
  if new.deleted_at is not null then return new; end if;
  case tg_table_name
    when 'recipe_ingredients' then
      if fresh or restoring or new.recipe_id is distinct from old.recipe_id then perform public.require_live('recipes', new.recipe_id); end if;
      if fresh or restoring or new.ingredient_id is distinct from old.ingredient_id then perform public.require_live('ingredients', new.ingredient_id); end if;
    when 'planned_meals' then
      -- a meal may outlive its recipe (shown as "recipe removed"); only pointing at a deleted recipe is refused
      if fresh or new.recipe_id is distinct from old.recipe_id then perform public.require_live('recipes', new.recipe_id); end if;
    when 'batches' then
      if fresh or restoring or new.ingredient_id is distinct from old.ingredient_id then perform public.require_live('ingredients', new.ingredient_id); end if;
    when 'adjustments' then
      if fresh or restoring or new.ingredient_id is distinct from old.ingredient_id then perform public.require_live('ingredients', new.ingredient_id); end if;
      if fresh or restoring or new.batch_id is distinct from old.batch_id then perform public.require_live('batches', new.batch_id); end if;
    when 'snapshot_batches' then
      if fresh or restoring then
        perform public.require_live('snapshots', new.snapshot_id);
        perform public.require_live('batches', new.batch_id);
      end if;
    when 'shopping_items' then
      if fresh or restoring or new.ingredient_id is distinct from old.ingredient_id then perform public.require_live('ingredients', new.ingredient_id); end if;
      if fresh or new.bought_batch_id is distinct from old.bought_batch_id then perform public.require_live('batches', new.bought_batch_id); end if;
    else null;
  end case;
  return new;
end $$;

-- Rules checked at the moment of soft delete (the old RESTRICT / guard_recipe_delete).
create function public.guard_soft_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null or new.deleted_at is null then return new; end if;
  if tg_table_name = 'ingredients' and exists (
    select 1 from public.recipe_ingredients ri where ri.ingredient_id = old.id and ri.deleted_at is null
  ) then
    raise exception 'ingredient is used by a recipe' using errcode = 'foreign_key_violation';
  elsif tg_table_name = 'recipes' and exists (
    select 1 from public.planned_meals m
    where m.recipe_id = old.id and m.deleted_at is null
      and m.date > coalesce((select max(s.on_date) from public.snapshots s
                             where s.household_id = old.household_id and s.deleted_at is null), '-infinity'::date)
  ) then
    raise exception 'recipe is planned after the latest snapshot' using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

-- Soft cascade: children go with their parent, and come back with it only if they went with it
-- (same deleted_at, i.e. the same transaction). Children deleted earlier on their own stay deleted.
create function public.cascade_soft_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  deleting boolean := old.deleted_at is null and new.deleted_at is not null;
  stamp timestamptz := case when deleting then new.deleted_at else old.deleted_at end;
begin
  if old.deleted_at is not distinct from new.deleted_at then return new; end if;
  -- the child UPDATEs below re-stamp via audit_update; "deleted_at = stamp" only expresses intent
  if tg_table_name = 'ingredients' then
    if deleting then
      update public.batches set deleted_at = stamp where ingredient_id = old.id and deleted_at is null;
      update public.adjustments set deleted_at = stamp where ingredient_id = old.id and deleted_at is null;
      update public.shopping_items set deleted_at = stamp where ingredient_id = old.id and deleted_at is null;
    else
      update public.batches set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
      update public.adjustments set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
      update public.shopping_items set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
    end if;
  elsif tg_table_name = 'recipes' then
    -- planned_meals are NOT cascaded: they keep their recipe_id and show "recipe removed" while it is deleted.
    if deleting then
      update public.recipe_ingredients set deleted_at = stamp where recipe_id = old.id and deleted_at is null;
    else
      update public.recipe_ingredients set deleted_at = null where recipe_id = old.id and deleted_at = stamp;
    end if;
  elsif tg_table_name = 'batches' then
    if deleting then
      update public.adjustments set deleted_at = stamp where batch_id = old.id and deleted_at is null;
      update public.snapshot_batches set deleted_at = stamp where batch_id = old.id and deleted_at is null;
      -- was ON DELETE SET NULL: the list item that bought this batch goes back to "not bought"
      update public.shopping_items set bought_batch_id = null where bought_batch_id = old.id and deleted_at is null;
    else
      update public.adjustments set deleted_at = null where batch_id = old.id and deleted_at = stamp;
      update public.snapshot_batches set deleted_at = null where batch_id = old.id and deleted_at = stamp;
    end if;
  elsif tg_table_name = 'snapshots' then
    if deleting then
      update public.snapshot_batches set deleted_at = stamp where snapshot_id = old.id and deleted_at is null;
    else
      update public.snapshot_batches set deleted_at = null where snapshot_id = old.id and deleted_at = stamp;
    end if;
  end if;
  return new;
end $$;

drop trigger guard_recipe_delete on public.recipes;
drop function public.guard_recipe_delete();

do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('create trigger audit_insert before insert on public.%I for each row execute function public.audit_insert()', t);
    execute format('create trigger audit_update before update on public.%I for each row execute function public.audit_update()', t);
    execute format('create trigger guard_soft_delete before update on public.%I for each row execute function public.guard_soft_delete()', t);
    execute format('create trigger soft_delete_on_delete before delete on public.%I for each row execute function public.soft_delete_on_delete()', t);
  end loop;
  foreach t in array array['recipe_ingredients', 'planned_meals', 'batches', 'adjustments', 'snapshot_batches', 'shopping_items'] loop
    execute format('create trigger check_parents_live before insert or update on public.%I for each row execute function public.check_parents_live()', t);
  end loop;
  foreach t in array array['ingredients', 'recipes', 'batches', 'snapshots'] loop
    execute format('create trigger cascade_soft_delete after update of deleted_at on public.%I for each row execute function public.cascade_soft_delete()', t);
  end loop;
end $$;

-- 7. Soft delete and restore -----------------------------------------------------------------------------------------------
-- soft_delete: stamps deleted_at/deleted_by on the caller's household's live rows; guards and soft cascades run in triggers.
-- Security definer because the UPDATE would fail the SELECT-policy check on the (now hidden) new row; the household
-- filter is explicit. Unknown or already deleted ids are skipped, so a retry succeeds. Returns the number deleted.
create function public.soft_delete(tbl text, ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tbl <> all (array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches', 'adjustments', 'snapshots', 'shopping_items']) then
    raise exception 'cannot delete from %', tbl using errcode = '22023';
  end if;
  if public.my_household() is null then raise exception 'not in a household'; end if;
  execute format('update public.%I set deleted_at = now() where id = any($1) and household_id = $2 and deleted_at is null', tbl)
    using ids, public.my_household();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.soft_delete(text, uuid[]) from public, anon;
grant execute on function public.soft_delete(text, uuid[]) to authenticated;

-- restore: clears deleted_at on the caller's own deleted rows (and the children that went with them). Parents must be live;
-- an ingredient whose name is now taken fails with unique_violation. Returns how many rows were restored.
create function public.restore(tbl text, ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tbl <> all (array['ingredients', 'recipes', 'planned_meals', 'batches', 'adjustments', 'snapshots', 'shopping_items']) then
    raise exception 'cannot restore from %', tbl using errcode = '22023';
  end if;
  if public.my_household() is null then raise exception 'not in a household'; end if;
  execute format('update public.%I set deleted_at = null where id = any($1) and household_id = $2 and deleted_at is not null', tbl)
    using ids, public.my_household();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.restore(text, uuid[]) from public, anon;
grant execute on function public.restore(text, uuid[]) to authenticated;

-- 8. RPCs rebuilt on soft delete ------------------------------------------------------------------------------
create or replace function public.save_recipe(
  recipe_id uuid, name text, instructions text, tags text[], serves int, lines jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare rid uuid;
begin
  if save_recipe.recipe_id is null then
    insert into public.recipes (name, instructions, tags, serves)
    values (save_recipe.name, save_recipe.instructions, save_recipe.tags, save_recipe.serves)
    returning id into rid;
  else
    update public.recipes r
      set name = save_recipe.name, instructions = save_recipe.instructions, tags = save_recipe.tags, serves = save_recipe.serves
      where r.id = save_recipe.recipe_id
      returning r.id into rid;
    if rid is null then raise exception 'recipe not found'; end if;
  end if;

  -- diff the lines so unchanged ones keep their history: drop removed, update changed, add new
  perform public.soft_delete('recipe_ingredients', array(
    select ri.id from public.recipe_ingredients ri
    where ri.recipe_id = rid and ri.deleted_at is null
      and not exists (select 1 from jsonb_to_recordset(save_recipe.lines) as x(ingredient_id uuid, qty_per_portion numeric)
                      where x.ingredient_id = ri.ingredient_id)));

  update public.recipe_ingredients ri set qty_per_portion = x.qty_per_portion
  from jsonb_to_recordset(save_recipe.lines) as x(ingredient_id uuid, qty_per_portion numeric)
  where ri.recipe_id = rid and ri.deleted_at is null and ri.ingredient_id = x.ingredient_id
    and ri.qty_per_portion is distinct from x.qty_per_portion;

  insert into public.recipe_ingredients (recipe_id, ingredient_id, qty_per_portion)
  select rid, x.ingredient_id, x.qty_per_portion
  from jsonb_to_recordset(save_recipe.lines) as x(ingredient_id uuid, qty_per_portion numeric)
  where not exists (select 1 from public.recipe_ingredients ri
                    where ri.recipe_id = rid and ri.ingredient_id = x.ingredient_id and ri.deleted_at is null);

  return rid;
end $$;

create or replace function public.buy_shopping_item(
  item_id uuid, batch_id uuid, ingredient_id uuid, qty numeric, expires_on date, added_at timestamptz
) returns jsonb
language plpgsql set search_path = '' as $$
declare found boolean;
begin
  if buy_shopping_item.qty is null or buy_shopping_item.qty <= 0 then
    raise exception 'amount must be more than zero' using errcode = '22023';
  end if;

  insert into public.batches (id, ingredient_id, qty, expires_on, added_at)
  values (buy_shopping_item.batch_id, buy_shopping_item.ingredient_id, buy_shopping_item.qty,
          buy_shopping_item.expires_on, coalesce(buy_shopping_item.added_at, now()))
  on conflict (id) do nothing;

  -- only link a live batch (a retry after the batch was unbought must not resurrect the link)
  update public.shopping_items si
  set bought_batch_id = buy_shopping_item.batch_id
  where si.id = buy_shopping_item.item_id and si.bought_batch_id is null
    and exists (select 1 from public.batches b where b.id = buy_shopping_item.batch_id);

  select exists (select 1 from public.shopping_items si where si.id = buy_shopping_item.item_id) into found;
  return jsonb_build_object('item_found', found);
end $$;

-- Untick: soft-deletes the batch (its adjustments and snapshot rows go with it, and the list item that bought it
-- goes back to "not bought"). Unknown or already deleted batch = no-op, so a retry succeeds.
create or replace function public.unbuy(batch_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.soft_delete('batches', array[unbuy.batch_id]);
end $$;

create or replace function public.finish_shopping(on_date date, batches jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare sid uuid;
begin
  sid := public.save_snapshot(finish_shopping.on_date, finish_shopping.batches);
  perform public.soft_delete('shopping_items', array(select si.id from public.shopping_items si where si.bought_batch_id is not null));
  return sid;
end $$;
