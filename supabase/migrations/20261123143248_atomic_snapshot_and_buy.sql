-- Multi-step writes done in one transaction (plpgsql functions are atomic).
-- security invoker (default): RLS on snapshots/snapshot_batches/batches/shopping_items applies to the caller.

-- Saves a snapshot and its batch lines. batches: [{batch_id, qty}, ...]; an empty array saves an empty snapshot.
create function public.save_snapshot(on_date date, batches jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  sid uuid;
begin
  insert into public.snapshots (on_date)
  values (save_snapshot.on_date)
  returning id into sid;

  insert into public.snapshot_batches (snapshot_id, batch_id, qty)
  select sid, x.batch_id, x.qty
  from jsonb_to_recordset(save_snapshot.batches) as x(batch_id uuid, qty numeric);

  return sid;
end $$;

-- Buys a manual shopping item: it becomes a batch, and the item is removed.
create function public.buy_shopping_item(item_id uuid, qty numeric, expires_on date) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  ingredient uuid;
  bid uuid;
begin
  select si.ingredient_id into ingredient
  from public.shopping_items si
  where si.id = buy_shopping_item.item_id;
  if ingredient is null then
    raise exception 'item not found';
  end if;

  insert into public.batches (ingredient_id, qty, expires_on)
  values (ingredient, buy_shopping_item.qty, buy_shopping_item.expires_on)
  returning id into bid;

  delete from public.shopping_items si where si.id = buy_shopping_item.item_id;

  return bid;
end $$;

revoke execute on function public.save_snapshot(date, jsonb), public.buy_shopping_item(uuid, numeric, date) from public, anon;
grant execute on function public.save_snapshot(date, jsonb), public.buy_shopping_item(uuid, numeric, date) to authenticated;
