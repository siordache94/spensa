-- Closed signups (auth hook), data export and account purge. See README "Signups" and PRIVACY.md.

-- 1. Signup allowlist: service role / SQL console only, never reachable from the client.
create table public.signup_allowlist (email text primary key check (email = lower(trim(email))));
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from public, anon, authenticated;

-- 2. "Before user created" auth hook. Allows a new account only when its email is on the allowlist
-- or user metadata carries the invite code of an existing household. Runs for every new user,
-- including OAuth; existing users are unaffected.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  mail text := lower(trim(coalesce(event->'user'->>'email', '')));
  code text := trim(coalesce(event->'user'->'user_metadata'->>'invite_code', ''));
begin
  if mail <> '' and exists (select 1 from public.signup_allowlist where email = mail) then
    return '{}'::jsonb;
  end if;
  if code <> '' and exists (select 1 from public.households where invite_code = code) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Spensa is invite-only. Ask a household member for an invite link.'));
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- 3. Export everything the caller's household holds, soft-deleted rows included, plus their account.
create function public.export_my_data() returns jsonb
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
                from auth.users u where u.id = uid));
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
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- 4. Purge a user's household data (service role only; the delete-account edge function calls it
-- and then deletes the auth user). Last member: the whole household is hard-deleted (cascades).
-- Otherwise the membership (and so the display name) goes, and the user's id is cleared from
-- household_events; the auth.users FKs (on delete set null) clear created_by/updated_by/
-- deleted_by/cook_id when the auth user is deleted right after. Idempotent, so a retry is safe.
create function public.purge_user(uid uuid) returns void
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
end $$;
revoke execute on function public.purge_user(uuid) from public, anon, authenticated;
grant execute on function public.purge_user(uuid) to service_role;

-- 5. Fix: audit_update restored deleted_by from the old row for every session, so the ON DELETE SET NULL
-- on deleted_by failed ("not present in table users") when a user who had soft-deleted something was
-- deleted. Like created_by, admin sessions (no auth.uid()) may now change it; clients still cannot.
create or replace function public.audit_update() returns trigger
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
    new.deleted_at := old.deleted_at;
    if uid is not null then new.deleted_by := old.deleted_by; end if; -- uid null: lets ON DELETE SET NULL through
  end if;
  -- an update that changes nothing leaves no trace
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := old.updated_at; new.updated_by := old.updated_by;
  else
    new.updated_at := now(); new.updated_by := uid;
  end if;
  return new;
end $$;
