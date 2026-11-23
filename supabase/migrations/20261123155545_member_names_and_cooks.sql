-- Member display names and "who cooks" per planned meal.

alter table public.household_members
  add column display_name text check (display_name is null or length(trim(display_name)) between 1 and 40);

-- A member may rename only themselves (and only display_name; the other columns are keys, never updated).
create policy "members rename themselves" on public.household_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = public.my_household());
revoke update on public.household_members from authenticated;
grant update (display_name) on public.household_members to authenticated;

-- Replace the RPCs with name-taking versions; drop the old overloads so calls aren't ambiguous.
drop function public.create_household(text);
drop function public.join_household(text);

create function public.default_member_name() returns text
language sql stable security definer set search_path = '' as $$
  select left(trim(coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1))), 40)
  from auth.users where id = auth.uid()
$$;
revoke execute on function public.default_member_name() from public, anon;

create function public.create_household(name text, display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.households (name) values (create_household.name) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), coalesce(nullif(left(trim(create_household.display_name), 40), ''), public.default_member_name()));
  return hid;
end $$;

create function public.join_household(code text, display_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into hid from public.households where invite_code = code;
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), coalesce(nullif(left(trim(join_household.display_name), 40), ''), public.default_member_name()));
  return hid;
end $$;

revoke execute on function public.create_household(text, text), public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text), public.join_household(text, text) to authenticated;

-- Existing members get a fallback name.
update public.household_members m
set display_name = left(trim(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1))), 40)
from auth.users u
where u.id = m.user_id and m.display_name is null
  and length(trim(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)))) > 0;

-- Who cooks: nobody by default; when set, must be a member of the meal's household.
alter table public.planned_meals add column cook_id uuid references auth.users on delete set null;

create function public.check_cook_is_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cook_id is not null and not exists (
    select 1 from public.household_members where household_id = new.household_id and user_id = new.cook_id
  ) then
    raise exception 'cook must be a member of the household' using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;
create trigger check_cook_is_member before insert or update of cook_id, household_id on public.planned_meals
  for each row execute function public.check_cook_is_member();
