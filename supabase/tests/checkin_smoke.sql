-- Run: docker exec -i supabase_db_spensa psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/tests/checkin_smoke.sql
-- Meal check-ins (ADR 0005): not_cooked, per-meal lines, slot end times, the shared unread check-in, the answer
-- RPCs and finish_shopping. Everything is rolled back; safe to repeat on a non-empty database.
begin;

insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@test.local', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test.local', now()),
  ('00000000-0000-0000-0000-0000000000f1', 'f1@test.local', now());
create temp table saved_config as select * from public.push_config;
delete from public.push_config; -- no HTTP from the signal triggers

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
select public.create_household('Checkin A', 'Eve');
select invite_code as a_code from public.households where name = 'Checkin A' \gset
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
select public.join_household(:'a_code', 'Eli');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
select public.create_household('Checkin B', 'Finn');
insert into public.ingredients (id, name, unit) values ('b0000000-0000-0000-0000-000000000001', 'b-pasta', 'g');
insert into public.planned_meals (id, date, slot, portions) values ('b0000000-0000-0000-0000-0000000000b1', '2026-11-27', 'dinner', 2);

-- Household A: ingredients and meals -------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
insert into public.ingredients (id, name, unit) values
  ('a0000000-0000-0000-0000-000000000001', 'pasta', 'g'),
  ('a0000000-0000-0000-0000-000000000002', 'cheese', 'g');
insert into public.planned_meals (id, date, slot, portions, cook_id) values
  ('a1000000-0000-0000-0000-000000000001', '2026-11-27', 'dinner', 2, '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-000000000002', '2026-11-27', 'lunch', 2, null),
  ('a1000000-0000-0000-0000-000000000003', '2026-11-27', 'dinner', 2, null),
  ('a1000000-0000-0000-0000-000000000004', '2026-11-26', 'dinner', 2, null);

do $$ begin
  assert (select not_cooked from public.planned_meals where id = 'a1000000-0000-0000-0000-000000000001') = false, 'not_cooked defaults to false';
end $$;

-- Slot end times --------------------------------------------------------------------------------
do $$ begin
  assert (select slot_end_times from public.households) = '{"lunch": "14:00", "dinner": "21:30"}'::jsonb, 'default end times';
  update public.households set slot_end_times = '{"lunch": "13:15", "dinner": "22:00", "snack": "17:00"}' where id is not null;
  assert (select slot_end_times->>'lunch' from public.households) = '13:15', 'end times are editable by a member';
  begin update public.households set slot_end_times = '{"lunch": "25:00"}' where id is not null; assert false, 'bad time accepted';
  exception when check_violation then null; end;
  begin update public.households set slot_end_times = '["14:00"]' where id is not null; assert false, 'array accepted';
  exception when check_violation then null; end;
  begin update public.households set slot_end_times = '{"lunch": 14}' where id is not null; assert false, 'number accepted';
  exception when check_violation then null; end;
  -- the column grant did not widen: the invite code is still not updatable
  begin update public.households set invite_code = 'x' where id is not null; assert false, 'invite_code updatable';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
do $$ begin
  assert (select slot_end_times->>'lunch' from public.households) = '14:00', 'household B saw A''s end times';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';

-- Push pref: meal_checkins defaults on, is writable by the person, switchable --------------------
do $$ begin
  insert into public.push_prefs (list_changes) values (true);
  assert (select meal_checkins from public.push_prefs) = true, 'meal_checkins default';
  update public.push_prefs set meal_checkins = false;
  assert (select meal_checkins from public.push_prefs) = false, 'meal_checkins not switchable';
  update public.push_prefs set meal_checkins = true;
end $$;

-- Per-meal lines ------------------------------------------------------------------------------------
do $$ begin
  -- own household: insert, read; amounts must be positive; one live line per ingredient
  insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
    values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 300);
  assert (select count(*) from public.planned_meal_lines) = 1, 'line not visible';
  begin insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
    values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 0); assert false, 'zero accepted';
  exception when check_violation then null; end;
  begin insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
    values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 5); assert false, 'duplicate live line';
  exception when unique_violation then null; end;
  -- composite FKs: another household's meal or ingredient cannot be referenced
  begin insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
    values ('b0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000002', 5); assert false, 'foreign meal accepted';
  exception when foreign_key_violation or insufficient_privilege then null; end;
  begin insert into public.planned_meal_lines (planned_meal_id, ingredient_id, qty_total)
    values ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 5); assert false, 'foreign ingredient accepted';
  exception when foreign_key_violation then null; end;
  -- authorship is stamped
  assert (select created_by from public.planned_meal_lines) = '00000000-0000-0000-0000-0000000000e1', 'created_by';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
do $$ begin
  assert (select count(*) from public.planned_meal_lines) = 0, 'other household sees the line';
  update public.planned_meal_lines set qty_total = 1; -- touches nothing
  delete from public.planned_meal_lines;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
do $$ begin
  assert (select qty_total from public.planned_meal_lines) = 300, 'partner sees the line';
  -- save_meal_lines: add cheese, change pasta; unchanged lines keep their row
  perform public.save_meal_lines('a1000000-0000-0000-0000-000000000001',
    '[{"ingredient_id":"a0000000-0000-0000-0000-000000000001","qty_total":350},{"ingredient_id":"a0000000-0000-0000-0000-000000000002","qty_total":40}]');
  assert (select count(*) from public.planned_meal_lines) = 2, 'save_meal_lines count';
  assert (select updated_by from public.planned_meal_lines where ingredient_id = 'a0000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000e2', 'update authorship';
  -- a plain DELETE is a soft delete: invisible to the client, row kept
  delete from public.planned_meal_lines where ingredient_id = 'a0000000-0000-0000-0000-000000000002';
  assert (select count(*) from public.planned_meal_lines) = 1, 'delete did not hide the line';
  -- an empty set removes the override; the meal follows its recipe again
  perform public.save_meal_lines('a1000000-0000-0000-0000-000000000001', '[]');
  assert (select count(*) from public.planned_meal_lines) = 0, 'override not cleared';
  -- re-adding after a soft delete works (live uniqueness only)
  perform public.save_meal_lines('a1000000-0000-0000-0000-000000000001', '[{"ingredient_id":"a0000000-0000-0000-0000-000000000001","qty_total":null}]');
  assert (select qty_total is null from public.planned_meal_lines), 'to-taste line';
  begin perform public.save_meal_lines('b0000000-0000-0000-0000-0000000000b1', '[]'); assert false, 'foreign meal accepted';
  exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.planned_meal_lines where deleted_at is not null and deleted_by = '00000000-0000-0000-0000-0000000000e2') = 2, 'soft-deleted rows kept with deleted_by';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';

-- meal_checkins: read-only for clients --------------------------------------------------------------------
do $$ begin
  begin insert into public.meal_checkins (household_id, planned_meal_id) values (public.my_household(), 'a1000000-0000-0000-0000-000000000001'); assert false, 'client insert';
  exception when insufficient_privilege then null; end;
  begin perform public.checkin_create(public.my_household(), array['a1000000-0000-0000-0000-000000000001']::uuid[]); assert false, 'client checkin_create';
  exception when insufficient_privilege then null; end;
  begin perform public.checkin_answer_as('00000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-000000000001'); assert false, 'client checkin_answer_as';
  exception when insufficient_privilege then null; end;
  begin perform public.checkin_resolve('a1000000-0000-0000-0000-000000000001', 'planned', null); assert false, 'client checkin_resolve';
  exception when insufficient_privilege then null; end;
end $$;

-- Server creates check-ins (service role) ----------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{}';
do $$
declare hid uuid := (select id from public.households where name = 'Checkin A'); made uuid[]; ev timestamptz;
begin
  select at into ev from public.household_events where household_id = hid;
  made := public.checkin_create(hid, array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003',
                                           'b0000000-0000-0000-0000-0000000000b1']::uuid[]);
  assert cardinality(made) = 3, 'created three (the other household''s meal is ignored): ' || cardinality(made);
  assert not ('b0000000-0000-0000-0000-0000000000b1' = any (made)), 'created for a foreign meal';
  assert (select at from public.household_events where household_id = hid) > ev, 'signal not touched';
  -- once per meal
  assert cardinality(public.checkin_create(hid, array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[])) = 0, 'created twice';
  -- a not-cooked meal gets none
  update public.planned_meals set not_cooked = true where id = 'a1000000-0000-0000-0000-000000000004';
  assert cardinality(public.checkin_create(hid, array['a1000000-0000-0000-0000-000000000004']::uuid[])) = 0, 'check-in for a not-cooked meal';
  assert public.checkin_unread_count(hid) = 3, 'unread count';
end $$;
set local role authenticated;

-- Shared unread, answering ----------------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
do $$ begin
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'both see unread: e1';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
do $$ begin
  assert (select count(*) from public.meal_checkins) = 0, 'other household sees check-ins';
  assert public.answer_checkin('a1000000-0000-0000-0000-000000000001', 'planned') = false, 'answered another household''s check-in';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
do $$ begin
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'both see unread: e2';
  assert public.answer_checkin('a1000000-0000-0000-0000-000000000001', 'planned') = true, 'first answer clears';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = 'planned';
  assert (select answered_by from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000e2', 'answered_by';
  assert public.answer_checkin('a1000000-0000-0000-0000-000000000001', 'dismissed') = false, 'second answer must not override';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = 'planned', 'first answer wins';
  begin perform public.answer_checkin('a1000000-0000-0000-0000-000000000002', 'maybe'); assert false, 'bad answer accepted';
  exception when invalid_parameter_value then null; end;
  assert public.answer_checkin('a1000000-0000-0000-0000-0000000000ff', 'planned') = false, 'unknown meal';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
do $$ begin
  -- cleared for the partner too
  assert (select count(*) from public.meal_checkins where answered_at is null) = 2, 'cleared for both';
  -- changed: only marks (the lines were edited by normal writes)
  assert public.answer_checkin('a1000000-0000-0000-0000-000000000002', 'changed') = true;
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 'changed';
  assert (select not_cooked from public.planned_meals where id = 'a1000000-0000-0000-0000-000000000002') = false, 'changed must not flag not_cooked';
  -- not cooked: flags the meal and answers
  assert public.answer_checkin('a1000000-0000-0000-0000-000000000003', 'not_cooked') = true;
  assert (select not_cooked from public.planned_meals where id = 'a1000000-0000-0000-0000-000000000003') = true, 'meal not flagged';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000003') = 'not_cooked';
  assert (select count(*) from public.meal_checkins where answered_at is null) = 0, 'all answered';
end $$;

-- Marking a meal "didn't cook" with a plain UPDATE (the Plan screen) answers its unread check-in --------------------
reset role;
set local request.jwt.claims = '{}';
do $$ begin
  update public.meal_checkins set answered_at = null, answered_by = null, answer = null where planned_meal_id = 'a1000000-0000-0000-0000-000000000002';
  update public.planned_meals set not_cooked = false where id = 'a1000000-0000-0000-0000-000000000003';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
do $$ begin
  assert (select count(*) from public.meal_checkins where answered_at is null) = 1, 'reopened one';
  update public.planned_meals set not_cooked = true where id = 'a1000000-0000-0000-0000-000000000002';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 'not_cooked', 'plain update did not answer';
  update public.planned_meals set not_cooked = false where id = 'a1000000-0000-0000-0000-000000000002'; -- un-flagging leaves the answer
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 'not_cooked';
end $$;

-- finish_shopping: answers, then everything left unread counts as cooked as planned --------------------------------------
reset role;
set local request.jwt.claims = '{}';
do $$ begin
  update public.planned_meals set not_cooked = false where household_id = (select id from public.households where name = 'Checkin A');
  update public.meal_checkins set answered_at = null, answered_by = null, answer = null
    where household_id = (select id from public.households where name = 'Checkin A');
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
do $$ begin
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'three unread before finishing';
  -- a bad answer aborts the whole thing: nothing answered, no snapshot
  begin perform public.finish_shopping(public.household_today(), '[]', '[{"meal_id":"a1000000-0000-0000-0000-000000000001","answer":"planned"},{"meal_id":"a1000000-0000-0000-0000-000000000002","answer":"changed"}]', public.household_version());
    assert false, 'bad finish answer accepted';
  exception when invalid_parameter_value then null; end;
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'failed finish answered something';
  assert (select count(*) from public.snapshots) = 0, 'failed finish left a snapshot';
  -- good: one meal answered not_cooked, one planned; the third is left and must be cleared as planned
  perform public.finish_shopping(public.household_today(), '[]', '[{"meal_id":"a1000000-0000-0000-0000-000000000001","answer":"not_cooked"},{"meal_id":"a1000000-0000-0000-0000-000000000002","answer":"planned"}]', public.household_version());
  assert (select count(*) from public.snapshots) = 1, 'snapshot not saved';
  assert (select count(*) from public.meal_checkins where answered_at is null) = 0, 'unread left after finishing';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = 'not_cooked';
  assert (select not_cooked from public.planned_meals where id = 'a1000000-0000-0000-0000-000000000001') = true, 'not_cooked not applied';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 'planned';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000003') = 'planned', 'leftover not cleared as planned';
  assert (select not_cooked from public.planned_meals where id = 'a1000000-0000-0000-0000-000000000003') = false, 'leftover flagged';
  -- answers default to none; the version is re-read for each call
  perform public.finish_shopping(public.household_today(), '[]', '[]', public.household_version());
  assert (select count(*) from public.snapshots) = 2;
end $$;
-- finishing in household B leaves A alone
reset role;
set local request.jwt.claims = '{}';
do $$ begin
  update public.meal_checkins set answered_at = null, answered_by = null, answer = null
    where household_id = (select id from public.households where name = 'Checkin A');
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
do $$ begin
  perform public.finish_shopping(public.household_today(), '[]', '[]', public.household_version());
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'B finishing cleared A''s check-ins';
end $$;

-- Token answer (service role): only members, only 'planned', returns the unread count ----------------------------------
set local request.jwt.claims = '{}';
do $$ begin
  assert public.checkin_answer_as('00000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-000000000001') is null, 'non-member answered';
  assert (select count(*) from public.meal_checkins where answered_at is null) = 3, 'non-member cleared something';
  assert public.checkin_answer_as('00000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-000000000001') = 2, 'unread after token answer';
  assert (select answer from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = 'planned';
  assert (select answered_by from public.meal_checkins where planned_meal_id = 'a1000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000e1';
  assert public.checkin_answer_as('00000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-000000000001') = 2, 'repeat is harmless';
end $$;

-- Deleting a meal takes its lines and check-in with it, and restoring brings them back --------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
do $$ begin
  perform public.save_meal_lines('a1000000-0000-0000-0000-000000000002', '[{"ingredient_id":"a0000000-0000-0000-0000-000000000002","qty_total":10}]');
  assert (select count(*) from public.meal_checkins where answered_at is null) = 2, 'two unread before the delete';
  perform public.soft_delete('planned_meals', array['a1000000-0000-0000-0000-000000000002']::uuid[]);
  assert (select count(*) from public.meal_checkins where answered_at is null) = 1, 'deleted meal still has an unread check-in';
  assert (select count(*) from public.planned_meal_lines where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 0, 'deleted meal still has lines';
  perform public.restore('planned_meals', array['a1000000-0000-0000-0000-000000000002']::uuid[]);
  assert (select count(*) from public.meal_checkins where answered_at is null) = 2, 'restore did not bring the check-in back';
  assert (select count(*) from public.planned_meal_lines where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 1, 'restore did not bring the lines back';
  -- a live per-meal line guards its ingredient too (MR-046): deleting it must not silently change the meal
  begin
    perform public.soft_delete('ingredients', array['a0000000-0000-0000-0000-000000000002']::uuid[]);
    assert false, 'ingredient delete should be blocked while a live meal line uses it';
  exception when foreign_key_violation then
    assert sqlerrm = 'ingredient is used by a planned meal', 'wrong message: ' || sqlerrm;
  end;
  assert (select count(*) from public.planned_meal_lines where planned_meal_id = 'a1000000-0000-0000-0000-000000000002') = 1,
    'the blocked delete must leave the meal line alone';
  -- once the line is gone (the person edited the meal), the ingredient can go
  delete from public.planned_meal_lines where planned_meal_id = 'a1000000-0000-0000-0000-000000000002';
  perform public.soft_delete('ingredients', array['a0000000-0000-0000-0000-000000000002']::uuid[]);
  assert (select count(*) from public.ingredients where id = 'a0000000-0000-0000-0000-000000000002') = 0, 'ingredient delete after the line was removed';
end $$;

-- Data export includes the new tables -------------------------------------------------------------------------------------
do $$ declare r jsonb := public.export_my_data(); begin
  assert jsonb_array_length(r->'meal_checkins') = 3, 'export meal_checkins';
  assert r->'planned_meal_lines' is not null, 'export planned_meal_lines';
  assert r #>> '{household,slot_end_times,lunch}' = '13:15', 'export slot_end_times';
end $$;
reset role;

-- Account deletion still works with the new rows ----------------------------------------------------------------------
set local request.jwt.claims = '{}';
select public.purge_user('00000000-0000-0000-0000-0000000000f1');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
select public.purge_user('00000000-0000-0000-0000-0000000000e1');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select public.purge_user('00000000-0000-0000-0000-0000000000e2');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e2';
do $$ begin
  assert not exists (select 1 from public.meal_checkins where household_id in (select household_id from public.household_members) and false), 'sanity';
  assert (select count(*) from public.meal_checkins c where not exists (select 1 from public.households h where h.id = c.household_id)) = 0, 'orphan check-ins';
end $$;

rollback;
\echo checkin_smoke: passed
