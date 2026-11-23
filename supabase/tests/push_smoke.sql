-- Run: docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/push_smoke.sql
-- Web push (ADR 0004): subscription and prefs RLS, the household setting range, and the list-change window
-- functions. Everything is rolled back; safe to repeat on a non-empty database.
begin;

insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.local', now());
-- the real config row (local setups have one) is out of the way, so no HTTP is queued by this test
create temp table saved_config as select * from public.push_config;
delete from public.push_config;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
select public.create_household('Push A', 'Cleo');
select invite_code as a_code from public.households where name = 'Push A' \gset
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
select public.join_household(:'a_code', 'Cass');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select public.create_household('Push B', 'Dan');

-- Subscriptions ----------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
select public.save_push_subscription('https://push.example/c1', 'key-c1', 'auth-c1');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
select public.save_push_subscription('https://push.example/c2', 'key-c2', 'auth-c2');
do $$ begin
  -- a household partner cannot see my subscription (nor can anyone else)
  assert (select count(*) from public.push_subscriptions) = 1, 'user sees only their own subscription';
  assert not exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example/c1'), 'partner subscription visible';
  -- no direct writes: only through save_push_subscription
  begin insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/x', 'k', 'a'); assert false, 'direct insert allowed';
  exception when insufficient_privilege then null; end;
  begin update public.push_subscriptions set p256dh = 'evil'; assert false, 'direct update allowed';
  exception when insufficient_privilege then null; end;
  -- the server fetches endpoints, so only https
  begin perform public.save_push_subscription('http://169.254.169.254/latest', 'k', 'a'); assert false, 'http endpoint accepted';
  exception when check_violation then null; end;
  -- deleting someone else's subscription removes nothing
  delete from public.push_subscriptions where endpoint = 'https://push.example/c1';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.push_subscriptions where endpoint like 'https://push.example/c%') = 2, 'c2 deleted c1''s subscription';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 0, 'another household sees a subscription';
end $$;
-- the same browser, another account: the endpoint moves to the new user, and the old owner loses it
select public.save_push_subscription('https://push.example/c2', 'key-d1', 'auth-d1');
do $$ begin
  assert (select count(*) from public.push_subscriptions where endpoint = 'https://push.example/c2' and p256dh = 'key-d1') = 1, 'endpoint did not move';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 0, 'old owner still sees the moved endpoint';
end $$;
-- own subscription can be removed
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
delete from public.push_subscriptions where endpoint = 'https://push.example/c1';
do $$ begin assert (select count(*) from public.push_subscriptions) = 0, 'own delete did not work'; end $$;
-- anon sees nothing and cannot call
reset role;
set local role anon;
do $$ begin
  begin perform count(*) from public.push_subscriptions; assert false, 'anon read subscriptions';
  exception when insufficient_privilege then null; end;
  begin perform public.save_push_subscription('https://push.example/a', 'k', 'a'); assert false, 'anon saved a subscription';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Prefs ------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
insert into public.push_prefs (list_changes, expiry_time) values (true, '08:30');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
insert into public.push_prefs (list_changes, expiry_time) values (false, null); -- Off
do $$ begin
  assert (select count(*) from public.push_prefs) = 1, 'user sees only their own prefs';
  assert (select expiry_time is null and not list_changes from public.push_prefs), 'Off / list toggle not stored';
  update public.push_prefs set expiry_time = '07:15', list_changes = true;
  assert (select expiry_time from public.push_prefs) = '07:15', 'own prefs not updatable';
  begin insert into public.push_prefs (user_id, list_changes) values ('00000000-0000-0000-0000-0000000000c1', false); assert false, 'inserted prefs for someone else';
  exception when others then if sqlstate not in ('42501', '23505') then raise; end if; end;
  begin update public.push_prefs set expiry_time = '07:15:30'; assert false, 'seconds accepted';
  exception when check_violation then null; end;
  begin update public.push_prefs set expiry_checked_on = current_date; assert false, 'client set expiry_checked_on';
  exception when insufficient_privilege then null; end;
  -- another person's row is invisible, so an update touches nothing
  update public.push_prefs set list_changes = false where user_id = '00000000-0000-0000-0000-0000000000c1';
end $$;
reset role;
do $$ begin
  assert (select list_changes from public.push_prefs where user_id = '00000000-0000-0000-0000-0000000000c1'), 'c2 changed c1''s prefs';
  -- the sender records the day; changing the time gives the new time its own chance today
  update public.push_prefs set expiry_checked_on = current_date where user_id = '00000000-0000-0000-0000-0000000000c1';
  update public.push_prefs set list_changes = false where user_id = '00000000-0000-0000-0000-0000000000c1';
  assert (select expiry_checked_on from public.push_prefs where user_id = '00000000-0000-0000-0000-0000000000c1') = current_date, 'unrelated change cleared the day';
  update public.push_prefs set expiry_time = '09:30' where user_id = '00000000-0000-0000-0000-0000000000c1';
  assert (select expiry_checked_on from public.push_prefs where user_id = '00000000-0000-0000-0000-0000000000c1') is null, 'new time kept the old day';
end $$;

-- Household setting ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
do $$ begin
  assert (select expiry_reminder_days from public.households) = 2, 'default is 2 days';
  update public.households set expiry_reminder_days = 0; update public.households set expiry_reminder_days = 14;
  begin update public.households set expiry_reminder_days = 15; assert false, '15 accepted';
  exception when check_violation then null; end;
  begin update public.households set expiry_reminder_days = -1; assert false, '-1 accepted';
  exception when check_violation then null; end;
  update public.households set expiry_reminder_days = 2;
  -- the invite code stays out of reach of the column grant
  begin update public.households set invite_code = 'x'; assert false, 'invite_code updatable';
  exception when insufficient_privilege then null; end;
end $$;

-- Window functions: not for clients -------------------------------------------
do $$ begin
  begin perform public.push_list_observe(gen_random_uuid(), null, '{}'); assert false, 'client ran push_list_observe';
  exception when insufficient_privilege then null; end;
  begin perform * from public.push_list_state; assert false, 'client read push_list_state';
  exception when insufficient_privilege then null; end;
  begin perform * from public.push_config; assert false, 'client read push_config';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- List-change window (service role = no auth.uid()) -----------------------------
set local request.jwt.claims = '{}'; -- service role: no signed-in user
do $$
declare hid uuid := (select id from public.households where name = 'Push A'); opened boolean; w record;
begin
  -- first call only records the baseline
  assert not public.push_list_observe(hid, '00000000-0000-0000-0000-0000000000c1', array['need-a']), 'first call opened a window';
  -- same list: nothing changed
  assert not public.push_list_observe(hid, '00000000-0000-0000-0000-0000000000c1', array['need-a']), 'unchanged list opened a window';
  -- a change opens one, keeping the baseline from before it
  assert public.push_list_observe(hid, '00000000-0000-0000-0000-0000000000c1', array['need-a', 'item-1']), 'change did not open a window';
  select * into w from public.push_list_state where household_id = hid;
  assert w.window_keys = array['need-a'] and w.known = array['need-a', 'item-1'], 'baseline wrong';
  -- further changes join the window (any order of keys), and record who wrote
  assert not public.push_list_observe(hid, '00000000-0000-0000-0000-0000000000c2', array['item-1', 'need-a', 'item-2']), 'second change opened another window';
  select * into w from public.push_list_state where household_id = hid;
  assert w.window_keys = array['need-a'] and w.window_authors @> array['00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid], 'window not extended';
  -- refresh is ignored while a window is open
  perform public.push_list_refresh(hid, array['zzz']);
  assert (select known from public.push_list_state where household_id = hid) = array['item-1', 'need-a', 'item-2'], 'refresh overwrote an open window''s baseline';
  -- too early: nothing to take
  assert not exists (select 1 from public.push_list_take(hid)), 'window taken before 30 s';
  -- due: taken once, with its baseline and authors, then closed
  select * into w from public.push_list_take(hid, '0 seconds');
  assert w.window_keys = array['need-a'] and cardinality(w.authors) = 2, 'taken window wrong';
  assert not exists (select 1 from public.push_list_take(hid, '0 seconds')), 'window taken twice';
  -- closed: refresh works again, and the next change opens a new window
  perform public.push_list_refresh(hid, array['need-a']);
  assert public.push_list_observe(hid, '00000000-0000-0000-0000-0000000000c1', array[]::text[]), 'next change did not open a window';
end $$;

-- The household_events hook: records authors while a window is open, never fails a write ------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
insert into public.shopping_items (text) values ('bread'); -- no push_config row: the hook does nothing and the write succeeds
reset role;
do $$ begin
  assert (select window_authors @> array['00000000-0000-0000-0000-0000000000c2'::uuid] from public.push_list_state s
          join public.households h on h.id = s.household_id where h.name = 'Push A'), 'open window did not record the writer';
end $$;
-- with a (bogus) config the write still succeeds and an HTTP call is queued after commit
insert into public.push_config values (true, 'http://127.0.0.1:1/functions/v1', 'x');
delete from public.push_list_state where household_id = (select id from public.households where name = 'Push A');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
insert into public.shopping_items (text) values ('eggs');
reset role;
do $$ begin
  assert exists (select 1 from net.http_request_queue where url = 'http://127.0.0.1:1/functions/v1/push-list'), 'no push-list call queued';
end $$;

-- Export -------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
select public.save_push_subscription('https://push.example/c1', 'key-c1', 'auth-c1');
do $$ declare r jsonb := public.export_my_data(); begin
  assert r #>> '{push_prefs,expiry_time}' = '09:30:00', 'prefs missing from export';
  assert r #>> '{push_subscriptions,0,endpoint}' = 'https://push.example/c1', 'subscription missing from export';
  assert not (r::text like '%key-c1%'), 'subscription keys exported';
end $$;
reset role;

-- Account deletion takes the push data with it ------------------------------------
set local request.jwt.claims = '{}';
select public.purge_user('00000000-0000-0000-0000-0000000000c1');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert not exists (select 1 from public.push_subscriptions where user_id = '00000000-0000-0000-0000-0000000000c1'), 'subscription outlived the account';
  assert not exists (select 1 from public.push_prefs where user_id = '00000000-0000-0000-0000-0000000000c1'), 'prefs outlived the account';
end $$;

rollback;
\echo push_smoke: ok
