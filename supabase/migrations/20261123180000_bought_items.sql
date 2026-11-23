-- Buying keeps the shopping item and marks it bought (list -> cart -> pantry). Unticking moves it back one step.
-- The client chooses the batch id and time, so buying is idempotent and an untick can name the batch before the tick syncs.
-- security invoker (default): RLS applies to the caller.
alter table public.shopping_items
  add column bought_batch_id uuid references public.batches on delete set null;

drop function public.buy_shopping_item(uuid, numeric, date);

-- Creates the batch (no-op if batch_id exists) and marks the item bought.
-- Returns {"item_found": bool}: false means the item was deleted meanwhile; the batch is still created.
-- Errors carry SQLSTATE 22023 (invalid_parameter_value).
create function public.buy_shopping_item(
  item_id uuid, batch_id uuid, ingredient_id uuid, qty numeric, expires_on date, added_at timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  found boolean;
begin
  if buy_shopping_item.qty is null or buy_shopping_item.qty <= 0 then
    raise exception 'amount must be more than zero' using errcode = '22023';
  end if;

  insert into public.batches (id, ingredient_id, qty, expires_on, added_at)
  values (buy_shopping_item.batch_id, buy_shopping_item.ingredient_id, buy_shopping_item.qty,
          buy_shopping_item.expires_on, coalesce(buy_shopping_item.added_at, now()))
  on conflict (id) do nothing;

  update public.shopping_items si
  set bought_batch_id = buy_shopping_item.batch_id
  where si.id = buy_shopping_item.item_id and si.bought_batch_id is null;

  select exists (select 1 from public.shopping_items si where si.id = buy_shopping_item.item_id) into found;
  return jsonb_build_object('item_found', found);
end $$;

-- Untick: deletes the batch (cascading its snapshot rows and adjustments) and puts any list item it bought back on the list.
-- Works for batches with no list item. Unknown batch = no-op, so a retry succeeds.
create function public.unbuy(batch_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.shopping_items si set bought_batch_id = null where si.bought_batch_id = unbuy.batch_id;
  delete from public.batches b where b.id = unbuy.batch_id;
end $$;

-- "Done shopping": saves the snapshot and clears the bought items off the list, in one transaction.
create function public.finish_shopping(on_date date, batches jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  sid uuid;
begin
  sid := public.save_snapshot(finish_shopping.on_date, finish_shopping.batches);
  delete from public.shopping_items si where si.bought_batch_id is not null;
  return sid;
end $$;

revoke execute on function
  public.buy_shopping_item(uuid, uuid, uuid, numeric, date, timestamptz),
  public.unbuy(uuid),
  public.finish_shopping(date, jsonb)
from public, anon;
grant execute on function
  public.buy_shopping_item(uuid, uuid, uuid, numeric, date, timestamptz),
  public.unbuy(uuid),
  public.finish_shopping(date, jsonb)
to authenticated;
