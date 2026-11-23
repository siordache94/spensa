-- Inventory check: one transaction that adds new batches, amends expiry dates and saves the snapshot.
-- security invoker (default): RLS on batches/snapshots/snapshot_batches applies to the caller.

-- items: [{batch_id, ingredient_id, qty, expires_on}, ...]. batch_id null = a new batch (inserted when qty > 0).
-- Existing batches get their expires_on updated when it changed. The snapshot lists every batch with qty > 0.
-- New batches and the snapshot share this transaction's now(), so the snapshot covers them.
create function public.save_inventory_check(on_date date, items jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  sid uuid;
  line record;
  bid uuid;
begin
  insert into public.snapshots (on_date)
  values (save_inventory_check.on_date)
  returning id into sid;

  for line in
    select x.batch_id, x.ingredient_id, x.qty, x.expires_on
    from jsonb_to_recordset(save_inventory_check.items)
      as x(batch_id uuid, ingredient_id uuid, qty numeric, expires_on date)
  loop
    if line.qty is null or line.qty < 0 then
      raise exception 'amounts must be zero or more';
    end if;

    if line.batch_id is null then
      continue when line.qty = 0;
      insert into public.batches (ingredient_id, qty, expires_on)
      values (line.ingredient_id, line.qty, line.expires_on)
      returning id into bid;
    else
      bid := line.batch_id;
      update public.batches b
      set expires_on = line.expires_on
      where b.id = bid and b.expires_on is distinct from line.expires_on;
    end if;

    if line.qty > 0 then
      insert into public.snapshot_batches (snapshot_id, batch_id, qty)
      values (sid, bid, line.qty);
    end if;
  end loop;

  return sid;
end $$;

revoke execute on function public.save_inventory_check(date, jsonb) from public, anon;
grant execute on function public.save_inventory_check(date, jsonb) to authenticated;
