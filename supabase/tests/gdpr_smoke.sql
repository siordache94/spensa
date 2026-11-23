-- Run: docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/gdpr_smoke.sql
-- Closed signups, data export, account purge. Everything is rolled back; asserts are scoped to this test's own rows.
begin;

-- Signup hook ----------------------------------------------------------------
insert into public.signup_allowlist (email) values ('owner@test.local');
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.local', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@test.local', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'b1@test.local', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
select public.create_household('GDPR A', 'Ann');
do $$ begin
  begin perform * from public.signup_allowlist; assert false, 'client read the allowlist';
  exception when insufficient_privilege then null; end;
  begin perform public.purge_user('00000000-0000-0000-0000-0000000000a1'); assert false, 'client ran purge_user';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select invite_code as a_code from public.households where name = 'GDPR A' \gset

select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'stranger@test.local', 'user_metadata', '{}'::jsonb)))
  as r_reject \gset
select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'Owner@Test.local ', 'user_metadata', '{}'::jsonb)))
  as r_allow \gset
select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'new@test.local', 'user_metadata', jsonb_build_object('invite_code', :'a_code'))))
  as r_invite \gset
select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'new@test.local', 'user_metadata', jsonb_build_object('invite_code', 'wrong'))))
  as r_badinvite \gset
set local spensa.r_reject = :'r_reject';
set local spensa.r_allow = :'r_allow';
set local spensa.r_invite = :'r_invite';
set local spensa.r_badinvite = :'r_badinvite';
do $$ begin
  assert current_setting('spensa.r_reject')::jsonb #>> '{error,http_code}' = '403', 'stranger should be rejected';
  assert current_setting('spensa.r_reject')::jsonb #>> '{error,message}' like 'Spensa is invite-only.%', 'friendly message';
  assert current_setting('spensa.r_allow')::jsonb = '{}'::jsonb, 'allowlisted email (any case) should be accepted';
  assert current_setting('spensa.r_invite')::jsonb = '{}'::jsonb, 'valid invite code should be accepted';
  assert current_setting('spensa.r_badinvite')::jsonb #>> '{error,http_code}' = '403', 'wrong invite code should be rejected';
end $$;

-- Export ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
insert into public.ingredients (id, name, unit) values
  ('10000000-0000-0000-0000-0000000000a1', 'kept', 'g'),
  ('10000000-0000-0000-0000-0000000000a2', 'gone', 'g');
select public.soft_delete('ingredients', array['10000000-0000-0000-0000-0000000000a2'::uuid]);
do $$
declare r jsonb;
begin
  r := public.export_my_data();
  assert r #>> '{account,email}' = 'a1@test.local', 'account email missing';
  assert r #>> '{account,created_at}' is not null, 'account created_at missing';
  assert r #>> '{household,name}' = 'GDPR A', 'household missing';
  assert not (r->'household' ? 'invite_code'), 'invite code must not be exported';
  assert jsonb_array_length(r->'ingredients') = 2, 'export must include the soft-deleted ingredient';
  assert exists (select 1 from jsonb_array_elements(r->'ingredients') e where e->>'name' = 'gone' and e->>'deleted_at' is not null), 'deleted row not flagged';
  assert r ? 'recipes' and r ? 'batches' and r ? 'snapshot_batches' and r ? 'shopping_items', 'tables missing from export';
end $$;
-- another household's user exports only their own
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select public.create_household('GDPR B', 'Bob');
do $$ begin
  assert jsonb_array_length(public.export_my_data()->'ingredients') = 0, 'export leaked another household';
end $$;
reset role;

-- Purge, last member: the whole household disappears -------------------------
set local request.jwt.claims = '{"role":"service_role"}'; -- no sub, like the service role
select public.purge_user('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  assert not exists (select 1 from public.households where name = 'GDPR B'), 'last member: household should be gone';
  assert not exists (select 1 from public.household_members where user_id = '00000000-0000-0000-0000-0000000000b1'), 'membership should be gone';
  perform public.purge_user('00000000-0000-0000-0000-0000000000b1'); -- idempotent
end $$;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000b1';

-- Purge with others remaining: data stays, authorship is anonymized ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
select public.join_household(:'a_code', 'Amy');
insert into public.ingredients (id, name, unit) values ('10000000-0000-0000-0000-0000000000a3', 'amys', 'g');
select public.soft_delete('ingredients', array['10000000-0000-0000-0000-0000000000a3'::uuid]);
insert into public.planned_meals (id, date, slot, portions, cook_id) values ('40000000-0000-0000-0000-0000000000a1', '2026-12-01', 'dinner', 2, '00000000-0000-0000-0000-0000000000a2');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$ begin
  assert (select created_by from public.ingredients where name = 'amys') = '00000000-0000-0000-0000-0000000000a2', 'precondition: authorship set';
  perform public.purge_user('00000000-0000-0000-0000-0000000000a2');
end $$;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a2'; -- what auth.admin.deleteUser does
do $$
declare a uuid := (select id from public.households where name = 'GDPR A');
begin
  assert a is not null, 'household must survive while a member remains';
  assert (select count(*) from public.household_members where household_id = a) = 1, 'only Ann should remain';
  assert not exists (select 1 from public.household_members where display_name = 'Amy'), 'display name should be removed';
  assert exists (select 1 from public.ingredients where name = 'amys' and household_id = a), 'data must be kept';
  assert (select created_by is null and deleted_by is null and updated_by is null from public.ingredients where name = 'amys'), 'authorship should be anonymized';
  assert (select cook_id is null from public.planned_meals where id = '40000000-0000-0000-0000-0000000000a1'), 'cook should be cleared';
  assert not exists (select 1 from public.household_events where by = '00000000-0000-0000-0000-0000000000a2'), 'household_events still names the user';
end $$;

-- Purge, last member of A: everything hard-deleted, soft-deleted rows included ---
select public.purge_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  assert not exists (select 1 from public.households where name = 'GDPR A'), 'household A should be gone';
  assert not exists (select 1 from public.ingredients where id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a3')), 'ingredients (incl. soft-deleted) should be hard-deleted';
  assert not exists (select 1 from public.planned_meals where id = '40000000-0000-0000-0000-0000000000a1'), 'meals should be gone';
end $$;

select 'GDPR smoke test passed' as result;
rollback;
