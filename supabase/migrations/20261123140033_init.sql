-- Spensa schema. Every table is scoped to a household by RLS (docs/adr/0002-household-scoping.md).
-- Only facts are stored; stock is replayed in src/domain/replay.ts (docs/adr/0001-stock-by-replay.md).

create type public.unit as enum ('g', 'ml', 'count', 'to_taste');
create type public.adjustment_kind as enum ('used', 'set', 'finished', 'discard');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  expiring_days int not null default 3 check (expiring_days >= 0),
  slots text[] not null default '{lunch,dinner}',
  timezone text not null default 'Europe/Rome',
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null unique references auth.users on delete cascade, -- one household per user in v1
  primary key (household_id, user_id)
);

-- security definer so policies can call it without recursing into household_members' own RLS
create function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  name text not null check (length(trim(name)) > 0),
  unit public.unit not null,
  category text,
  pack_size numeric check (pack_size > 0),
  shelf_life_days int check (shelf_life_days > 0),
  min_stock numeric check (min_stock >= 0),
  on_hand boolean not null default true, -- only meaningful for to_taste
  archived boolean not null default false,
  unique (household_id, name)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  name text not null check (length(trim(name)) > 0),
  instructions text not null default '',
  tags text[] not null default '{}',
  serves int not null default 2 check (serves in (1, 2, 3, 4, 6, 8)),
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  recipe_id uuid not null references public.recipes on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete restrict, -- can't delete an ingredient a recipe uses
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  qty_per_portion numeric check (qty_per_portion > 0), -- null = to taste
  primary key (recipe_id, ingredient_id)
);

create table public.planned_meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  date date not null,
  slot text not null,
  recipe_id uuid references public.recipes on delete set null, -- deletion guarded by trigger below
  portions int not null check (portions > 0),
  position int not null default 0
);
create index on public.planned_meals (household_id, date);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete cascade,
  qty numeric not null check (qty > 0),
  added_at timestamptz not null default now(),
  expires_on date
);
create index on public.batches (household_id, ingredient_id);

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete cascade,
  batch_id uuid references public.batches on delete cascade,
  kind public.adjustment_kind not null,
  qty numeric check (qty >= 0),
  at timestamptz not null default now(),
  check ((kind in ('used', 'set')) = (qty is not null))
);

create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  on_date date not null, -- household-local date; meals on or before it are covered
  taken_at timestamptz not null default now()
);

create table public.snapshot_batches (
  snapshot_id uuid not null references public.snapshots on delete cascade,
  batch_id uuid not null references public.batches on delete cascade,
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  qty numeric not null check (qty >= 0),
  primary key (snapshot_id, batch_id)
);

-- Manual shopping items: free text, or an ingredient added by hand. Computed needs are not stored.
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households on delete cascade,
  ingredient_id uuid references public.ingredients on delete cascade,
  text text,
  qty numeric check (qty > 0),
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  check (ingredient_id is not null or length(trim(text)) > 0)
);

-- A recipe can't be deleted while a meal after the latest snapshot uses it.
create function public.guard_recipe_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.planned_meals m
    where m.recipe_id = old.id
      and m.date > coalesce((select max(s.on_date) from public.snapshots s where s.household_id = old.household_id), '-infinity'::date)
  ) then
    raise exception 'recipe is planned after the latest snapshot' using errcode = 'foreign_key_violation';
  end if;
  return old;
end $$;
create trigger guard_recipe_delete before delete on public.recipes
  for each row execute function public.guard_recipe_delete();

-- RLS: members see and write only their household's rows.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
create policy "members read their household" on public.households for select to authenticated using (id = public.my_household());
create policy "members update their household" on public.households for update to authenticated
  using (id = public.my_household()) with check (id = public.my_household());
create policy "members see each other" on public.household_members for select to authenticated using (household_id = public.my_household());

do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'snapshot_batches', 'shopping_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "household rows" on public.%I for all to authenticated
                    using (household_id = public.my_household()) with check (household_id = public.my_household())', t);
  end loop;
end $$;
-- shortcut: RLS doesn't check that referenced ids (e.g. a recipe's ingredient_id) belong to the same household;
-- ids are unguessable uuids, so this only matters if ids leak. Add composite FKs if multi-household lands.

-- Joining goes through these functions so non-members can never read households.
create function public.create_household(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.households (name) values (create_household.name) returning id into hid;
  insert into public.household_members (household_id, user_id) values (hid, auth.uid());
  return hid;
end $$;

create function public.join_household(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into hid from public.households where invite_code = code;
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into public.household_members (household_id, user_id) values (hid, auth.uid());
  return hid;
end $$;

revoke execute on function public.create_household(text), public.join_household(text) from public, anon;
grant execute on function public.create_household(text), public.join_household(text) to authenticated;
