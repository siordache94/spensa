-- A new household starts in the creator's zone (MR-006). The client sends the device zone; the server accepts
-- only a real IANA name from pg_catalog.pg_timezone_names. null keeps the old default (Europe/Rome), so an
-- older client, the smoke tests and the SQL shells still work. Existing households are left untouched.
drop function public.create_household(text, text);

create function public.create_household(name text, display_name text default null, timezone text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if create_household.timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = create_household.timezone
  ) then
    raise exception 'unknown timezone %', create_household.timezone;
  end if;
  insert into public.households (name, timezone)
    values (create_household.name, coalesce(create_household.timezone, 'Europe/Rome'))
    returning id into hid;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), coalesce(nullif(left(trim(create_household.display_name), 40), ''), public.default_member_name()));
  return hid;
end $$;

revoke execute on function public.create_household(text, text, text) from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;
