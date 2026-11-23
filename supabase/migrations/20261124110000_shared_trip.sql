-- Shared shopping trip (CONTEXT.md "Trip") and a realtime signal that survives soft delete (ADR 0003).

-- 1. Which planned meals the shopping trip skips. The only trip state; everything else is inferred.
alter table public.planned_meals add column skip_shopping boolean not null default false;

-- 2. The shopping horizon is a household setting, not a per-phone one.
alter table public.households
  add column horizon_days int not null default 7 check (horizon_days between 1 and 14);
revoke update on public.households from authenticated;
grant update (name, slots, timezone, expiring_days, horizon_days) on public.households to authenticated;

-- 3. A new trip starts after "Done shopping": meals skipped for the finished trip are selected again.
create or replace function public.finish_shopping(on_date date, batches jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare sid uuid;
begin
  sid := public.save_snapshot(finish_shopping.on_date, finish_shopping.batches);
  perform public.soft_delete('shopping_items', array(select si.id from public.shopping_items si where si.bought_batch_id is not null));
  update public.planned_meals set skip_shopping = false where skip_shopping;
  return sid;
end $$;

-- 4. Realtime signal. A soft delete is an UPDATE to a row RLS now hides, so postgres_changes never delivers it.
-- Instead every write to a household table touches ONE always-visible row per household; subscribers get that
-- UPDATE, and `by` says who wrote (so a phone can tell its own echo from the partner's change).
create table public.household_events (
  household_id uuid primary key references public.households on delete cascade,
  by uuid,
  at timestamptz not null default clock_timestamp()
);
alter table public.household_events enable row level security;
create policy household_events_select on public.household_events for select to authenticated
  using (household_id = public.my_household());
revoke all on public.household_events from anon, authenticated;
grant select on public.household_events to authenticated;

create function public.touch_household_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h uuid := public.my_household();
begin
  if h is not null then
    insert into public.household_events (household_id, by, at) values (h, auth.uid(), clock_timestamp())
    on conflict (household_id) do update set by = excluded.by, at = excluded.at;
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['households', 'ingredients', 'recipes', 'recipe_ingredients', 'planned_meals', 'batches',
                           'adjustments', 'snapshots', 'shopping_items'] loop
    execute format('create trigger touch_household_events after insert or update or delete on public.%I
                    for each statement execute function public.touch_household_events()', t);
  end loop;
end $$;

-- Row events on the tables themselves are replaced by the signal.
alter publication supabase_realtime drop table public.batches, public.ingredients, public.shopping_items;
alter publication supabase_realtime add table public.household_events;
