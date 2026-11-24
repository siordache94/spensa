-- MR-003: both phones can buy the same list item. A purchase is a batch, and every purchase of a list item points at
-- that item (`batches.shopping_item_id`). The item counts as bought while any live batch points at it; putting one
-- purchase back only returns the item to the list when the last live batch goes. `buy_shopping_item` reads the
-- ingredient from the item (a client can no longer name another ingredient), refuses free-text items, and reports
-- that the partner already bought it so the page can offer "Keep both / Put one back".

-- 1. The purchase link ---------------------------------------------------------------------------------------------
-- Composite FK as in 20261123190000_household_integrity.sql: a batch and its item always share a household.
alter table public.shopping_items add constraint shopping_items_household_id_id_key unique (household_id, id);

alter table public.batches
  add column shopping_item_id uuid,
  add constraint batches_shopping_item_fkey
    foreign key (household_id, shopping_item_id) references public.shopping_items (household_id, id)
    on delete set null (shopping_item_id);
create index batches_shopping_item_idx on public.batches (shopping_item_id) where deleted_at is null;

-- The old single link (shopping_items.bought_batch_id) becomes the purchase's owner. It stays as the "bought" pointer
-- the client reads, and is kept in step below; shopping_item_id is the authoritative list of purchases.
update public.batches b
set shopping_item_id = si.id
from public.shopping_items si
where si.bought_batch_id = b.id and b.shopping_item_id is null;

-- 2. "Bought while any live batch points at it" ---------------------------------------------------------------------
-- One AFTER trigger per updated row: when a purchase goes, bought_batch_id moves to a purchase that is still live, or to
-- null when none is (the item returns to the list). Restoring a purchase marks the item bought again.
-- The trigger name orders it after cascade_soft_delete, which clears the pointer to the batch that went (Postgres fires
-- same-event triggers in alphabetical order). Security definer: the UPDATE must not be filtered by the client's RLS.
create function public.sync_item_purchase() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.shopping_item_id is null then return null; end if;

  if new.deleted_at is not null and old.deleted_at is null then
    update public.shopping_items si
       set bought_batch_id = (
         select b.id from public.batches b
         where b.shopping_item_id = new.shopping_item_id and b.deleted_at is null
         order by b.recorded_at, b.id limit 1)
     where si.id = new.shopping_item_id and si.household_id = new.household_id and si.deleted_at is null;
  elsif new.deleted_at is null and old.deleted_at is not null then
    update public.shopping_items si
       set bought_batch_id = new.id
     where si.id = new.shopping_item_id and si.household_id = new.household_id
       and si.deleted_at is null and si.bought_batch_id is null;
  end if;
  return null;
end $$;

create trigger sync_item_purchase after update of deleted_at on public.batches
  for each row execute function public.sync_item_purchase();

-- 3. Buy: the item names the ingredient ------------------------------------------------------------------------------
-- The client no longer sends ingredient_id: it is read from the shopping item, so a tick can only buy what the list
-- item says. Errors carry SQLSTATE 28000 (not signed in), 22023 (bad amount, free-text item) or 23503 (unknown item).
-- Returns {"already_purchased": bool}: another live purchase of the same item existed before this one (the retry of the
-- same batch does not count),
drop function if exists public.buy_shopping_item(uuid, uuid, uuid, numeric, date, timestamptz);

create function public.buy_shopping_item(
  item_id uuid, batch_id uuid, qty numeric, expires_on date, added_at timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item public.shopping_items%rowtype;
  already boolean;
begin
  if auth.uid() is null or public.my_household() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if buy_shopping_item.qty is null or buy_shopping_item.qty <= 0 then
    raise exception 'amount must be more than zero' using errcode = '22023';
  end if;

  -- RLS limits this to the caller's household and to live rows.
  select si.* into item from public.shopping_items si where si.id = buy_shopping_item.item_id;
  if not found then
    raise exception 'shopping item % is missing or deleted', buy_shopping_item.item_id using errcode = '23503';
  end if;
  if item.ingredient_id is null then
    raise exception 'free-text shopping item % has no ingredient to buy', item.id using errcode = '22023';
  end if;

  -- A retry of the same batch is not a second purchase by the partner.
  select exists (
    select 1 from public.batches b
    where b.shopping_item_id = item.id and b.id <> buy_shopping_item.batch_id and b.deleted_at is null
  ) into already;

  insert into public.batches (id, ingredient_id, shopping_item_id, qty, expires_on, added_at)
  values (buy_shopping_item.batch_id, item.ingredient_id, item.id, buy_shopping_item.qty,
          buy_shopping_item.expires_on, coalesce(buy_shopping_item.added_at, now()))
  on conflict (id) do nothing;

  -- Mark the item bought. A second purchase leaves the pointer on the first batch; both stay in the pantry.
  update public.shopping_items si
     set bought_batch_id = buy_shopping_item.batch_id
   where si.id = item.id and si.deleted_at is null and si.bought_batch_id is null
     and exists (select 1 from public.batches b where b.id = buy_shopping_item.batch_id and b.deleted_at is null);

  return jsonb_build_object('already_purchased', already);
end $$;
revoke execute on function public.buy_shopping_item(uuid, uuid, numeric, date, timestamptz) from public, anon;
grant execute on function public.buy_shopping_item(uuid, uuid, numeric, date, timestamptz) to authenticated;

-- 4. Done shopping clears every item that any live purchase points at ------------------------------------------------
-- Same function as 20261128110000_finish_shopping_version.sql, with the bought-item sweep widened to the new model: a
-- bought item is one with a bought pointer or with a live purchase pointing at it. Both concurrent purchases are in
-- the client's snapshot lines (the replay already holds both), so the snapshot covers them.
create or replace function public.finish_shopping(on_date date, batches jsonb, answers jsonb, expected_at timestamptz) returns uuid
language plpgsql set search_path = '' as $$
declare
  sid uuid;
  a record;
  seen timestamptz;
  today date := public.household_today();
  unknown_batches uuid[];
begin
  if auth.uid() is null or public.my_household() is null then raise exception 'not signed in' using errcode = '28000'; end if;

  if finish_shopping.on_date is distinct from today then
    raise exception 'snapshot date % is not today (%) in the household timezone', finish_shopping.on_date, today
      using errcode = '22023';
  end if;

  -- optimistic version: lock first, then compare, so no partner write can slip in between the check and the snapshot
  seen := public.household_version();
  if finish_shopping.expected_at is distinct from seen then
    raise exception 'the pantry changed since this snapshot was computed (version % is now %)', finish_shopping.expected_at, seen
      using errcode = '40001';
  end if;

  -- every line must name a live batch of this household: a line the replay then treats as covered would lose its stock
  select array_agg(x.batch_id) into unknown_batches
  from jsonb_to_recordset(coalesce(finish_shopping.batches, '[]'::jsonb)) as x(batch_id uuid, qty numeric)
  where not exists (
    select 1 from public.batches b
    where b.id = x.batch_id and b.household_id = public.my_household() and b.deleted_at is null);
  if unknown_batches is not null then
    raise exception 'snapshot names unknown batch(es) %', unknown_batches using errcode = 'foreign_key_violation';
  end if;

  for a in select * from jsonb_to_recordset(coalesce(finish_shopping.answers, '[]'::jsonb)) as x(meal_id uuid, answer text) loop
    if a.answer is null or a.answer <> all (array['planned', 'not_cooked']) then
      raise exception 'unknown answer %', a.answer using errcode = '22023';
    end if;
    perform public.answer_checkin(a.meal_id, a.answer);
  end loop;

  sid := public.save_snapshot(finish_shopping.on_date, finish_shopping.batches);
  perform public.soft_delete('shopping_items', array(
    select si.id from public.shopping_items si
    where si.deleted_at is null
      and (si.bought_batch_id is not null
           or exists (select 1 from public.batches b where b.shopping_item_id = si.id and b.deleted_at is null))));
  update public.planned_meals set skip_shopping = false where skip_shopping;
  perform public.checkin_answer_all('planned');
  return sid;
end $$;
revoke execute on function public.finish_shopping(date, jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.finish_shopping(date, jsonb, jsonb, timestamptz) to authenticated;
