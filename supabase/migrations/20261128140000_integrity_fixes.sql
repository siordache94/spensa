-- MR-046: two remaining data-integrity fixes (the snapshot-clock one is already in MR-005).
--
-- 1. Per-meal amounts are a second use of an ingredient. guard_soft_delete refused an ingredient only while a
-- recipe line used it, so cascade_soft_delete silently soft-deleted its planned_meal_lines (ADR 0005): the meal
-- fell back to its recipe or lost the ingredient. Refuse the delete instead, in the same style as the recipe
-- guard, until the line is removed by the person editing the meal.
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
    if exists (
      select 1 from public.planned_meal_lines l where l.ingredient_id = old.id and l.deleted_at is null
    ) then
      raise exception 'ingredient is used by a planned meal' using errcode = 'foreign_key_violation';
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

-- 2. purge_user scrubbed authorship and household_events.by, but the uid could survive in other household
-- structures: the open push-list window's authors, a meal's cook, and who answered a check-in. Clear all three
-- so the purge removes the person everywhere; the membership row (or the whole household) goes above.
create or replace function public.purge_user(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid; others int;
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  select household_id into hid from public.household_members where user_id = uid;
  if hid is not null then
    select count(*) into others from public.household_members where household_id = hid and user_id <> uid;
    if others = 0 then
      delete from public.households where id = hid;
    else
      delete from public.household_members where user_id = uid;
    end if;
  end if;
  update public.household_events set by = null where by = uid;
  update public.push_list_state set window_authors = array_remove(window_authors, uid) where uid = any (window_authors);
  update public.planned_meals set cook_id = null where cook_id = uid;
  update public.meal_checkins set answered_by = null where answered_by = uid;
end $$;
