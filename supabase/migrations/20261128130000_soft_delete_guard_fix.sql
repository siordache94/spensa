-- Fix: guard_soft_delete aborted every soft delete that cascaded into a snapshot line.
--
-- The trigger is attached to nine tables, including snapshot_batches, which has a (snapshot_id, batch_id) primary
-- key and no id column. The ingredients branch referenced old.id inside a single IF expression, so PL/pgSQL had to
-- compile that expression for every table the trigger fired on. On snapshot_batches the expression could not be
-- parsed ("record \"old\" has no field \"id\""), which made these paths fail:
--
--   * returning a purchased batch after a "Done shopping" snapshot (cascade batch -> snapshot_batches)
--   * deleting a snapshot (cascade snapshot -> snapshot_batches)
--   * deleting an ingredient whose batch is in a snapshot (ingredient -> batch -> snapshot_batches)
--
-- No rule applies to snapshot lines, so return before touching old.id, and keep each guarded table in its own
-- statement. The rules themselves are unchanged.
create or replace function public.guard_soft_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null or new.deleted_at is null then return new; end if;

  -- snapshot_batches has no id and no rule; referencing old.id below must not be compiled for it
  if tg_table_name = 'snapshot_batches' then
    return new;
  end if;

  if tg_table_name = 'ingredients' then
    if exists (
      select 1 from public.recipe_ingredients ri where ri.ingredient_id = old.id and ri.deleted_at is null
    ) then
      raise exception 'ingredient is used by a recipe' using errcode = 'foreign_key_violation';
    end if;
  elsif tg_table_name = 'recipes' then
    if exists (
      select 1 from public.planned_meals m
      where m.recipe_id = old.id and m.deleted_at is null
        and m.date > coalesce((select max(s.on_date) from public.snapshots s
                               where s.household_id = old.household_id and s.deleted_at is null), '-infinity'::date)
    ) then
      raise exception 'recipe is planned after the latest snapshot' using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end $$;
