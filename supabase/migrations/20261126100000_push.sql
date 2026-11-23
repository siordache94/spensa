-- Web push (docs/adr/0004-web-push.md): subscriptions, per-person prefs, list-change batching state,
-- the expiry-reminder household setting, and the database half of the scheduler (pg_net + pg_cron).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1. Household setting: batches expiring within this many days go in the daily reminder.
-- Separate from expiring_days (the in-app "use soon" threshold).
alter table public.households
  add column expiry_reminder_days int not null default 2 check (expiry_reminder_days between 0 and 14);
revoke update on public.households from authenticated;
grant update (name, slots, timezone, expiring_days, horizon_days, expiry_reminder_days) on public.households to authenticated;

-- 2. Push subscriptions. Per user, not a household fact: no soft delete (ADR 0003 exception). An endpoint is
-- a credential (anyone holding it plus the keys can push to the device), and a 404/410 from the push service
-- means it is dead, so rows are really deleted: on expiry, on turning notifications off, with the account.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2048), -- https only: the server fetches it
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth text not null check (length(auth) between 1 and 256),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own subscriptions delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Writes go through this function: a browser's endpoint is unique, and when someone else signs in on the same
-- browser the endpoint moves to them (a plain upsert could not touch the other user's row under RLS).
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict on constraint push_subscriptions_endpoint_key
  do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- 3. Per-person preferences, in their own table rather than on household_members: members can read each
-- other's household_members rows, and nobody should see when their partner gets reminders.
-- expiry_time is a wall-clock time in the household timezone; null = Off. No row = defaults (list on, 09:00).
create table public.push_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  list_changes boolean not null default true,
  expiry_time time default '09:00' check (expiry_time is null or extract(second from expiry_time) = 0),
  expiry_checked_on date, -- the household-local day the reminder was last handled; set by the sender only
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
create policy "own prefs" on public.push_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.push_prefs from anon, authenticated;
grant select on public.push_prefs to authenticated;
grant insert (list_changes, expiry_time) on public.push_prefs to authenticated;
grant update (list_changes, expiry_time) on public.push_prefs to authenticated;

create function public.push_prefs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.expiry_time is distinct from old.expiry_time then
    new.expiry_checked_on := null; -- a new time gets its own chance today
  end if;
  return new;
end $$;
create trigger push_prefs_touch before insert or update on public.push_prefs
  for each row execute function public.push_prefs_touch();

-- 4. List-change batching state, one row per household. Service role only.
--   known: the to-buy keys at the last evaluation (the baseline for the next change).
--   window_*: set while a 30-second combining window is open: the keys when it opened, and who wrote.
create table public.push_list_state (
  household_id uuid primary key references public.households on delete cascade,
  known text[] not null default '{}',
  window_at timestamptz,
  window_keys text[],
  window_authors uuid[] not null default '{}'
);
alter table public.push_list_state enable row level security;
revoke all on public.push_list_state from anon, authenticated;

-- 5. Where the database calls the edge functions. Rows are set per environment (README), never in a migration:
-- until then everything below is a no-op. Not reachable from the API (RLS on, no policy, no grant).
create table public.push_config (
  id boolean primary key default true check (id),
  functions_url text not null, -- e.g. https://<ref>.supabase.co/functions/v1
  webhook_secret text not null -- must equal the PUSH_WEBHOOK_SECRET function secret
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Atomic window transitions, so two concurrent calls (a webhook and the cron sweep) never both send.
-- The first change in a quiet period opens a window with the pre-change baseline; returns true then.
create function public.push_list_observe(hid uuid, by uuid, keys text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare st public.push_list_state;
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  insert into public.push_list_state (household_id, known) values (hid, keys)
  on conflict (household_id) do nothing;
  select * into st from public.push_list_state where household_id = hid for update;
  if st.window_at is not null then
    update public.push_list_state set known = keys,
      window_authors = case when by is null or by = any (window_authors) then window_authors else array_append(window_authors, by) end
    where household_id = hid;
    return false;
  end if;
  if (select coalesce(array_agg(k order by k), '{}') from unnest(keys) k)
     = (select coalesce(array_agg(k order by k), '{}') from unnest(st.known) k) then
    return false; -- nothing on the to-buy list changed
  end if;
  update public.push_list_state
     set window_at = now(), window_keys = st.known, window_authors = case when by is null then '{}' else array[by] end, known = keys
   where household_id = hid;
  return true;
end $$;

-- Closes the window if it is at least `min_age` old and returns its baseline and authors; no row otherwise.
create function public.push_list_take(hid uuid, min_age interval default '30 seconds')
returns table (window_keys text[], authors uuid[])
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  return query
    with old as (select s.household_id, s.window_keys, s.window_authors from public.push_list_state s
                 where s.household_id = hid and s.window_at is not null and s.window_at <= now() - min_age for update),
         closed as (update public.push_list_state s set window_at = null, window_keys = null, window_authors = '{}'
                    from old where s.household_id = old.household_id returning 1)
    select old.window_keys, old.window_authors from old, closed;
end $$;

-- Refresh the baseline while no window is open (time moves the list too: the trip range rolls over at midnight).
create function public.push_list_refresh(hid uuid, keys text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'service role only'; end if;
  insert into public.push_list_state (household_id, known) values (hid, keys)
  on conflict (household_id) do update set known = excluded.known where push_list_state.window_at is null;
end $$;

revoke execute on function public.push_list_observe(uuid, uuid, text[]), public.push_list_take(uuid, interval),
  public.push_list_refresh(uuid, text[]) from public, anon, authenticated;
grant execute on function public.push_list_observe(uuid, uuid, text[]), public.push_list_take(uuid, interval),
  public.push_list_refresh(uuid, text[]) to service_role;

-- 6. Every household write touches household_events (ADR 0003). Hook that signal: with no window open, tell
-- the push-list function (fire and forget, after commit); with one open, just record the author. Never fails the write.
create function public.push_on_household_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.push_config;
begin
  if new."by" is null then return null; end if;
  begin
    update public.push_list_state
       set window_authors = case when new."by" = any (window_authors) then window_authors else array_append(window_authors, new."by") end
     where household_id = new.household_id and window_at is not null;
    if found then return null; end if;
    select * into cfg from public.push_config;
    if not found then return null; end if;
    perform net.http_post(
      url := cfg.functions_url || '/push-list',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.webhook_secret),
      body := jsonb_build_object('household_id', new.household_id, 'by', new."by"),
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'push_on_household_event: %', sqlerrm;
  end;
  return null;
end $$;
create trigger push_on_household_event after insert or update on public.household_events
  for each row execute function public.push_on_household_event();

-- 7. Cron: every 15 minutes call push-cron (expiry reminders, stale-window sweep, baseline refresh).
create function public.push_cron_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare cfg public.push_config;
begin
  select * into cfg from public.push_config;
  if not found then return; end if;
  perform net.http_post(
    url := cfg.functions_url || '/push-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.webhook_secret),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
end $$;
revoke execute on function public.push_cron_tick() from public, anon, authenticated;

select cron.schedule('spensa-push-cron', '*/15 * * * *', 'select public.push_cron_tick()');

-- 8. Data export: the person's own push settings (endpoints are listed, keys are not).
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
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.household_id = $1', t)
      into rows using hid;
    result := result || jsonb_build_object(t, rows);
  end loop;
  return result;
end $$;
