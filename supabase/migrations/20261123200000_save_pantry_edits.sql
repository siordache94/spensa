-- Pantry edit mode writes only what changed (no snapshot): amount changes and removals become adjustments,
-- added lines become batches, expiry corrections update the batch. One transaction. security invoker: RLS applies.
-- adjustments: [{batch_id, ingredient_id, kind: set|finished|discard, qty}]  (qty only for set)
-- new_batches: [{ingredient_id, qty, expires_on}]   expiries: [{batch_id, expires_on}]
-- Adjustments for a batch deleted meanwhile (e.g. by the partner) are skipped. save_inventory_check stays, now unused by the app.
create function public.save_pantry_edits(adjustments jsonb, new_batches jsonb, expiries jsonb default '[]'::jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_to_recordset(save_pantry_edits.adjustments) as x(kind text, qty numeric)
             where x.kind not in ('set', 'finished', 'discard') or (x.kind = 'set' and (x.qty is null or x.qty < 0))) then
    raise exception 'invalid adjustment' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(save_pantry_edits.new_batches) as x(qty numeric) where x.qty is null or x.qty <= 0) then
    raise exception 'amount must be more than zero' using errcode = '22023';
  end if;

  insert into public.adjustments (ingredient_id, batch_id, kind, qty)
  select x.ingredient_id, x.batch_id, x.kind::public.adjustment_kind, case when x.kind = 'set' then x.qty end
  from jsonb_to_recordset(save_pantry_edits.adjustments) as x(batch_id uuid, ingredient_id uuid, kind text, qty numeric)
  where exists (select 1 from public.batches b where b.id = x.batch_id);

  insert into public.batches (ingredient_id, qty, expires_on)
  select x.ingredient_id, x.qty, x.expires_on
  from jsonb_to_recordset(save_pantry_edits.new_batches) as x(ingredient_id uuid, qty numeric, expires_on date);

  update public.batches b set expires_on = x.expires_on
  from jsonb_to_recordset(save_pantry_edits.expiries) as x(batch_id uuid, expires_on date)
  where b.id = x.batch_id;
end $$;

revoke execute on function public.save_pantry_edits(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_pantry_edits(jsonb, jsonb, jsonb) to authenticated;
