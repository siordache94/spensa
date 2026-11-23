-- Meal check-ins (docs/adr/0005-meal-check-ins.md): "didn't cook", per-meal amounts, slot end times,
-- the shared unread check-in, and the per-person push switch.

-- 0. Fix found while testing account deletion: audit_update put updated_by back after ON DELETE SET NULL cleared it
-- (the update "changes nothing" apart from updated_by), so deleting a user who had edited anything failed with a
-- foreign key violation. Like created_by and deleted_by, admin sessions (no auth.uid()) may now change it.
create or replace function public.audit_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  requested timestamptz := new.deleted_at;
begin
  new.created_at := old.created_at;
  if uid is not null then new.created_by := old.created_by; end if;
  if old.deleted_at is null and requested is not null then
    new.deleted_at := now(); new.deleted_by := uid;
  elsif old.deleted_at is not null and requested is null then
    new.deleted_at := null; new.deleted_by := null;
  else
    new.deleted_at := old.deleted_at;
    if uid is not null then new.deleted_by := old.deleted_by; end if;
  end if;
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    if uid is not null then new.updated_at := old.updated_at; new.updated_by := old.updated_by; end if; -- admin: lets ON DELETE SET NULL through
  else
    new.updated_at := now(); new.updated_by := uid;
  end if;
  return new;
end $$;

-- 1. Didn't cook. A meal flagged not_cooked consumes nothing in the replay (src/domain/replay.ts).
alter table public.planned_meals add column not_cooked boolean not null default false;
alter table public.planned_meals add constraint planned_meals_household_id_id_key unique (household_id, id);

-- 2. Per-meal amounts. When a meal has live lines they REPLACE the recipe's lines for that meal (the UI seeds them
-- from the recipe the first time, so "add an ingredient" and "left one out" both work). qty_total is the whole
-- meal's amount in the ingredient's unit (not per portion: it records what was actually used); null = to taste.
create table public.planned_meal_lines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  planned_meal_id uuid not null,
  ingredient_id uuid not null,
  qty_total numeric check (qty_total > 0), -- null = to taste
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users on delete set null,
  constraint planned_meal_lines_meal_fkey foreign key (household_id, planned_meal_id)
    references public.planned_meals (household_id, id) on delete cascade,
  constraint planned_meal_lines_ingredient_fkey foreign key (household_id, ingredient_id)
    references public.ingredients (household_id, id) on delete cascade
);
create unique index planned_meal_lines_live on public.planned_meal_lines (planned_meal_id, ingredient_id) where deleted_at is null;
create index planned_meal_lines_household on public.planned_meal_lines (household_id, planned_meal_id);

-- 3. Household setting: when each slot ends (wall clock, household timezone). Keyed by slot name; a slot missing
-- from the object uses the app default for its name (src/lib/checkin.ts).
alter table public.households
  add column slot_end_times jsonb not null default '{"lunch": "14:00", "dinner": "21:30"}';
create function public.valid_slot_end_times(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
    where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
$$;
alter table public.households add constraint households_slot_end_times_valid check (public.valid_slot_end_times(slot_end_times));
revoke update on public.households from authenticated;
grant update (name, slots, timezone, expiring_days, horizon_days, expiry_reminder_days, slot_end_times) on public.households to authenticated;

-- 4. Per-person switch for the check-in push.
alter table public.push_prefs add column meal_checkins boolean not null default true;
grant insert (list_changes, expiry_time, meal_checkins) on public.push_prefs to authenticated;
grant update (list_changes, expiry_time, meal_checkins) on public.push_prefs to authenticated;

-- 5. The check-in: one row per meal, created by the server when the meal's check-in is due (answered_at null =
-- unread). Its own table, not columns on planned_meals: answering must not look like editing the meal
-- (updated_by), only the server may create one (clients can edit planned_meals freely under RLS), and
-- unique (planned_meal_id) is the "at most once per meal" guarantee. Clients read; every write is an RPC below.
create table public.meal_checkins (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  planned_meal_id uuid not null unique,
  answered_at timestamptz,
  answered_by uuid references auth.users on delete set null,
  answer text check (answer in ('planned', 'changed', 'not_cooked', 'dismissed')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users on delete set null,
  constraint meal_checkins_meal_fkey foreign key (household_id, planned_meal_id)
    references public.planned_meals (household_id, id) on delete cascade,
  check ((answer is null) = (answered_at is null))
);
create index meal_checkins_unread on public.meal_checkins (household_id) where answered_at is null and deleted_at is null;

-- RLS, authorship and the realtime signal, as on every household table (ADR 0002, 0003).
do $$
declare t text;
begin
  foreach t in array array['planned_meal_lines', 'meal_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "live rows read" on public.%I for select to authenticated
                    using (household_id = public.my_household() and deleted_at is null)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger audit_insert before insert on public.%I for each row execute function public.audit_insert()', t);
    execute format('create trigger audit_update before update on public.%I for each row execute function public.audit_update()', t);
    execute format('create trigger touch_household_events after insert or update or delete on public.%I
                    for each statement execute function public.touch_household_events()', t);
  end loop;
  execute 'grant select on public.meal_checkins to authenticated';
  -- the lines are edited directly by clients (through save_meal_lines or plain writes), like recipe_ingredients
  execute 'grant select, insert, update, delete on public.planned_meal_lines to authenticated';
  execute 'create policy "live rows insert" on public.planned_meal_lines for insert to authenticated
           with check (household_id = public.my_household() and deleted_at is null)';
  execute 'create policy "live rows update" on public.planned_meal_lines for update to authenticated
           using (household_id = public.my_household() and deleted_at is null)
           with check (household_id = public.my_household() and deleted_at is null)';
  execute 'create policy "live rows delete" on public.planned_meal_lines for delete to authenticated
           using (household_id = public.my_household() and deleted_at is null)';
  execute 'create trigger guard_soft_delete before update on public.planned_meal_lines for each row execute function public.guard_soft_delete()';
  execute 'create trigger soft_delete_on_delete before delete on public.planned_meal_lines for each row execute function public.soft_delete_on_delete()';
  execute 'create trigger check_parents_live before insert or update on public.planned_meal_lines for each row execute function public.check_parents_live()';
  execute 'create trigger cascade_soft_delete after update of deleted_at on public.planned_meals for each row execute function public.cascade_soft_delete()';
end $$;

-- 6. Soft-delete plumbing for the new tables.
create or replace function public.check_parents_live() returns trigger
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
    when 'planned_meal_lines' then
      if fresh or restoring or new.planned_meal_id is distinct from old.planned_meal_id then perform public.require_live('planned_meals', new.planned_meal_id); end if;
      if fresh or restoring or new.ingredient_id is distinct from old.ingredient_id then perform public.require_live('ingredients', new.ingredient_id); end if;
    else null;
  end case;
  return new;
end $$;

create or replace function public.cascade_soft_delete() returns trigger
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
      update public.planned_meal_lines set deleted_at = stamp where ingredient_id = old.id and deleted_at is null;
    else
      update public.batches set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
      update public.adjustments set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
      update public.shopping_items set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
      update public.planned_meal_lines set deleted_at = null where ingredient_id = old.id and deleted_at = stamp;
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
  elsif tg_table_name = 'planned_meals' then
    -- a deleted meal takes its own amounts and its check-in with it, and gets them back on restore
    if deleting then
      update public.planned_meal_lines set deleted_at = stamp where planned_meal_id = old.id and deleted_at is null;
      update public.meal_checkins set deleted_at = stamp where planned_meal_id = old.id and deleted_at is null;
    else
      update public.planned_meal_lines set deleted_at = null where planned_meal_id = old.id and deleted_at = stamp;
      update public.meal_checkins set deleted_at = null where planned_meal_id = old.id and deleted_at = stamp;
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

create or replace function public.soft_delete(tbl text, ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tbl <> all (array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meal_lines', 'planned_meals', 'batches', 'adjustments', 'snapshots', 'shopping_items']) then
    raise exception 'cannot delete from %', tbl using errcode = '22023';
  end if;
  if public.my_household() is null then raise exception 'not in a household'; end if;
  execute format('update public.%I set deleted_at = now() where id = any($1) and household_id = $2 and deleted_at is null', tbl)
    using ids, public.my_household();
  get diagnostics n = row_count;
  return n;
end $$;

-- 7. Internal: answer an unread check-in. Not callable by clients; the RPCs below check the household.
-- First answer wins (the check-in is shared, so once one person answers it is cleared for both).
create function public.checkin_resolve(p_meal uuid, p_answer text, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.meal_checkins c set answer = p_answer, answered_at = now(), answered_by = p_user
  where c.planned_meal_id = p_meal and c.answered_at is null and c.deleted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.checkin_resolve(uuid, text, uuid) from public, anon, authenticated;

-- Marking a meal "didn't cook" by any route (a plain UPDATE from the Plan screen, or answer_checkin) answers its check-in.
create function public.planned_meals_not_cooked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.not_cooked and not old.not_cooked then
    perform public.checkin_resolve(new.id, 'not_cooked', auth.uid());
  end if;
  return null;
end $$;
create trigger planned_meals_not_cooked after update of not_cooked on public.planned_meals
  for each row execute function public.planned_meals_not_cooked();

-- 8. Answer one check-in. 'planned' | 'changed' (the UI has already edited the meal's lines by normal writes)
-- | 'not_cooked' (also flags the meal) | 'dismissed'. Returns true when an unread check-in was cleared by this call;
-- false when it was already answered by someone else, never existed, or the meal is gone (so retries are harmless).
create function public.answer_checkin(p_meal uuid, p_answer text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare was_unread boolean;
begin
  if auth.uid() is null or public.my_household() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_answer is null or p_answer <> all (array['planned', 'changed', 'not_cooked', 'dismissed']) then
    raise exception 'unknown answer %', p_answer using errcode = '22023';
  end if;
  if not exists (select 1 from public.planned_meals m where m.id = p_meal and m.household_id = public.my_household() and m.deleted_at is null) then
    return false;
  end if;
  select exists (select 1 from public.meal_checkins c where c.planned_meal_id = p_meal and c.answered_at is null and c.deleted_at is null) into was_unread;
  if p_answer = 'not_cooked' then
    update public.planned_meals set not_cooked = true where id = p_meal; -- its trigger answers the check-in
  end if;
  perform public.checkin_resolve(p_meal, p_answer, auth.uid());
  return was_unread;
end $$;
revoke execute on function public.answer_checkin(uuid, text) from public, anon;
grant execute on function public.answer_checkin(uuid, text) to authenticated;

-- Answer everything still unread in my household with one answer ('planned' or 'dismissed'). Used by finish_shopping.
create function public.checkin_answer_all(p_answer text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null or public.my_household() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_answer is null or p_answer <> all (array['planned', 'dismissed']) then raise exception 'unknown answer %', p_answer using errcode = '22023'; end if;
  update public.meal_checkins c set answer = p_answer, answered_at = now(), answered_by = auth.uid()
  where c.household_id = public.my_household() and c.answered_at is null and c.deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.checkin_answer_all(text) from public, anon;
grant execute on function public.checkin_answer_all(text) to authenticated;

-- 9. Done shopping, now with the check-ins. `answers`: [{meal_id, answer: 'planned' | 'not_cooked'}] from the finish
-- dialog. Everything still unread afterwards counts as cooked as planned. One transaction: if the snapshot fails
-- nothing is answered.
drop function public.finish_shopping(date, jsonb);
create function public.finish_shopping(on_date date, batches jsonb, answers jsonb default '[]') returns uuid
language plpgsql set search_path = '' as $$
declare sid uuid; a record;
begin
  for a in select * from jsonb_to_recordset(coalesce(finish_shopping.answers, '[]'::jsonb)) as x(meal_id uuid, answer text) loop
    if a.answer is null or a.answer <> all (array['planned', 'not_cooked']) then
      raise exception 'unknown answer %', a.answer using errcode = '22023';
    end if;
    perform public.answer_checkin(a.meal_id, a.answer);
  end loop;
  sid := public.save_snapshot(finish_shopping.on_date, finish_shopping.batches);
  perform public.soft_delete('shopping_items', array(select si.id from public.shopping_items si where si.bought_batch_id is not null));
  update public.planned_meals set skip_shopping = false where skip_shopping;
  perform public.checkin_answer_all('planned');
  return sid;
end $$;
revoke execute on function public.finish_shopping(date, jsonb, jsonb) from public, anon;
grant execute on function public.finish_shopping(date, jsonb, jsonb) to authenticated;

-- 10. Replace a meal's own amounts in one go. p_lines: [{ingredient_id, qty_total}] (qty_total null = to taste).
-- An empty array removes the override, so the meal follows its recipe again. Diffs like save_recipe: unchanged lines keep their row.
create function public.save_meal_lines(p_meal uuid, p_lines jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.planned_meals m where m.id = p_meal) then raise exception 'meal not found'; end if;
  perform public.soft_delete('planned_meal_lines', array(
    select l.id from public.planned_meal_lines l
    where l.planned_meal_id = p_meal and l.deleted_at is null
      and not exists (select 1 from jsonb_to_recordset(p_lines) as x(ingredient_id uuid, qty_total numeric) where x.ingredient_id = l.ingredient_id)));
  update public.planned_meal_lines l set qty_total = x.qty_total
  from jsonb_to_recordset(p_lines) as x(ingredient_id uuid, qty_total numeric)
  where l.planned_meal_id = p_meal and l.deleted_at is null and l.ingredient_id = x.ingredient_id and l.qty_total is distinct from x.qty_total;
  insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
  select p_meal, x.ingredient_id, x.qty_total
  from jsonb_to_recordset(p_lines) as x(ingredient_id uuid, qty_total numeric)
  where not exists (select 1 from public.planned_meal_lines l where l.planned_meal_id = p_meal and l.ingredient_id = x.ingredient_id and l.deleted_at is null);
end $$;
revoke execute on function public.save_meal_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_meal_lines(uuid, jsonb) to authenticated;

-- 11. Server side (push-cron, service role only).
-- Creates the check-ins for these meals, once each, and returns the meals that are new. Touches the household
-- signal so open phones refetch (a service session has no household for touch_household_events to find).
create function public.checkin_create(hid uuid, meal_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare made uuid[];
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  with ins as (
    insert into public.meal_checkins (household_id, planned_meal_id)
    select m.household_id, m.id from public.planned_meals m
    where m.household_id = hid and m.id = any (meal_ids) and m.deleted_at is null and not m.not_cooked
    on conflict (planned_meal_id) do nothing
    returning planned_meal_id)
  select coalesce(array_agg(planned_meal_id), '{}') into made from ins;
  if cardinality(made) > 0 then
    insert into public.household_events (household_id, by, at) values (hid, null, clock_timestamp())
    on conflict (household_id) do update set by = excluded.by, at = excluded.at;
  end if;
  return made;
end $$;

-- A signed token in a push (see _shared/checkin.ts) answers 'planned' for the person it was issued to, with no session.
-- Returns the household's unread count afterwards (for the app badge), or null if the person is not in the meal's household.
create function public.checkin_answer_as(p_user uuid, p_meal uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare hid uuid; n int;
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  select m.household_id into hid from public.planned_meals m
    join public.household_members hm on hm.household_id = m.household_id and hm.user_id = p_user
    where m.id = p_meal and m.deleted_at is null;
  if hid is null then return null; end if;
  if public.checkin_resolve(p_meal, 'planned', p_user) then
    insert into public.household_events (household_id, by, at) values (hid, p_user, clock_timestamp())
    on conflict (household_id) do update set by = excluded.by, at = excluded.at;
  end if;
  select count(*) into n from public.meal_checkins c where c.household_id = hid and c.answered_at is null and c.deleted_at is null;
  return n;
end $$;

-- How many check-ins a household has unread (the badge number in a push).
create function public.checkin_unread_count(hid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.meal_checkins c where c.household_id = hid and c.answered_at is null and c.deleted_at is null
$$;
revoke execute on function public.checkin_create(uuid, uuid[]), public.checkin_answer_as(uuid, uuid), public.checkin_unread_count(uuid)
  from public, anon, authenticated;
grant execute on function public.checkin_create(uuid, uuid[]), public.checkin_answer_as(uuid, uuid), public.checkin_unread_count(uuid) to service_role;

-- 12. Data export includes the new tables.
create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  result jsonb;
  t text;
  rows jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select household_id into hid from public.household_members where user_id = uid;

  result := jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)
                from auth.users u where u.id = uid),
    'push_prefs', (select to_jsonb(p) - 'user_id' from public.push_prefs p where p.user_id = uid),
    'push_subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'created_at', s.created_at)), '[]')
                           from public.push_subscriptions s where s.user_id = uid));
  if hid is null then return result; end if;

  -- invite_code is a credential, so it is left out
  result := result
    || jsonb_build_object('household', (select to_jsonb(h) - 'invite_code' from public.households h where h.id = hid))
    || jsonb_build_object('household_members', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.household_members m where m.household_id = hid));
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'planned_meal_lines', 'meal_checkins', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.household_id = $1', t)
      into rows using hid;
    result := result || jsonb_build_object(t, rows);
  end loop;
  return result;
end $$;
