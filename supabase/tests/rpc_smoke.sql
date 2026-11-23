-- Run: docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/rpc_smoke.sql
-- Everything is rolled back.
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_household('A home');
insert into public.ingredients (id, name, unit) values
  ('10000000-0000-0000-0000-000000000001', 'pasta', 'g'),
  ('10000000-0000-0000-0000-000000000002', 'rice', 'g');
insert into public.shopping_items (id, ingredient_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');

-- buy_shopping_item: creates the batch with the client's id and marks the item bought
do $$ declare r jsonb; begin
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
         '10000000-0000-0000-0000-000000000001', 500, '2027-01-01', now());
  assert (r->>'item_found')::boolean, 'item should be found';
  assert (select qty from public.batches where id = '30000000-0000-0000-0000-000000000001') = 500, 'batch missing';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000001', 'item not marked bought';

  -- idempotent retry: still one batch
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
         '10000000-0000-0000-0000-000000000001', 500, '2027-01-01', now());
  assert (select count(*) from public.batches) = 1, 'retry duplicated the batch';

  -- item gone: batch is still created, item_found false
  delete from public.shopping_items where id = '20000000-0000-0000-0000-000000000002';
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
         '10000000-0000-0000-0000-000000000002', 200, null, now());
  assert not (r->>'item_found')::boolean, 'item_found should be false';
  assert (select count(*) from public.batches) = 2, 'batch not created for deleted item';

  begin
    perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009',
      '10000000-0000-0000-0000-000000000001', 0, null, now());
    assert false, 'zero qty should fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- unbuy: batch deleted, item put back on the list; unknown batch is a no-op
do $$ begin
  perform public.unbuy('30000000-0000-0000-0000-000000000001');
  assert not exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000001'), 'batch still visible';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') is null, 'bought_batch_id not cleared';
  perform public.unbuy('30000000-0000-0000-0000-000000000001');
end $$;

-- unbuy soft-deleted: the batch row is still there, stamped, and a ticked-again batch restores cleanly
reset role;
do $$ begin
  assert (select deleted_by from public.batches where id = '30000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a', 'unbuy did not stamp deleted_by';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ begin
  -- a retried buy of the unbought batch must not relink it to the item
  perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001', 500, null, now());
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') is null, 'retry relinked a deleted batch';
  assert public.restore('batches', array['30000000-0000-0000-0000-000000000001'::uuid]) = 1, 'restore batch';
  assert exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000001'), 'restored batch invisible';
  perform public.unbuy('30000000-0000-0000-0000-000000000001');
end $$;

-- finish_shopping: bought items are removed, unbought stay; snapshot saved
do $$ begin
  perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001', 300, null, now());
  insert into public.shopping_items (id, ingredient_id) values ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002');
  insert into public.planned_meals (id, date, slot, portions, skip_shopping) values ('40000000-0000-0000-0000-000000000001', '2026-11-25', 'dinner', 2, true);
  assert (select skip_shopping from public.planned_meals where id = '40000000-0000-0000-0000-000000000001'), 'skip_shopping not stored';
  perform public.finish_shopping('2026-11-23', '[{"batch_id":"30000000-0000-0000-0000-000000000003","qty":300}]'::jsonb);
  assert not exists (select 1 from public.shopping_items where id = '20000000-0000-0000-0000-000000000001'), 'bought item not removed';
  assert exists (select 1 from public.shopping_items where id = '20000000-0000-0000-0000-000000000003'), 'unbought item removed';
  assert (select count(*) from public.snapshots) = 1, 'snapshot not saved';
  assert not (select skip_shopping from public.planned_meals where id = '40000000-0000-0000-0000-000000000001'), 'finish_shopping should start a new trip (skip_shopping reset)';
  -- the realtime signal row is written by the caller's writes and visible to them
  assert (select by from public.household_events) = '00000000-0000-0000-0000-00000000000a', 'household_events not touched by the writer';
end $$;
reset role;
do $$ begin
  assert (select deleted_by from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a',
    'finish_shopping should soft-delete bought items';
  assert (select count(*) from public.shopping_items where deleted_at is not null) = 2, 'expected two soft-deleted items (cleared + removed)';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- save_pantry_edits: adjustments for changes, new batch for additions, expiry fix, nothing else
do $$
declare b1 constant uuid := '30000000-0000-0000-0000-000000000003';
        b2 constant uuid := '30000000-0000-0000-0000-000000000002';
        i1 constant uuid := '10000000-0000-0000-0000-000000000001';
        i2 constant uuid := '10000000-0000-0000-0000-000000000002';
begin
  perform public.save_pantry_edits(
    jsonb_build_array(jsonb_build_object('batch_id', b1, 'ingredient_id', i1, 'kind', 'set', 'qty', 120),
                      jsonb_build_object('batch_id', b2, 'ingredient_id', i2, 'kind', 'discard', 'qty', null),
                      jsonb_build_object('batch_id', gen_random_uuid(), 'ingredient_id', i2, 'kind', 'finished', 'qty', null)),
    jsonb_build_array(jsonb_build_object('ingredient_id', i2, 'qty', 1000, 'expires_on', '2027-02-02')),
    jsonb_build_array(jsonb_build_object('batch_id', b1, 'expires_on', '2027-03-03')));
  assert (select count(*) from public.adjustments) = 2, 'expected 2 adjustments (missing batch skipped)';
  assert (select qty from public.adjustments where batch_id = b1 and kind = 'set') = 120, 'set adjustment wrong';
  assert exists (select 1 from public.adjustments where batch_id = b2 and kind = 'discard' and qty is null), 'discard adjustment wrong';
  assert (select count(*) from public.batches where ingredient_id = i2 and qty = 1000 and expires_on = '2027-02-02') = 1, 'new batch missing';
  assert (select expires_on from public.batches where id = b1) = '2027-03-03', 'expiry not updated';
  assert (select qty from public.batches where id = b1) = 300, 'batch qty must stay untouched';
  assert (select count(*) from public.snapshots) = 1, 'edits must not write a snapshot';
  assert (select recorded_at from public.adjustments where batch_id = b1) = now(), 'recorded_at should be server time';

  begin
    perform public.save_pantry_edits('[{"batch_id":null,"kind":"set","qty":null}]'::jsonb, '[]'::jsonb);
    assert false, 'set without qty should fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- save_recipe diffs lines: unchanged lines keep their row, removed ones are soft-deleted, re-adding works
do $$
declare rid uuid; i1 constant uuid := '10000000-0000-0000-0000-000000000001'; i2 constant uuid := '10000000-0000-0000-0000-000000000002';
        line1 uuid;
begin
  rid := public.save_recipe(null, 'Mix', '', '{}', 2, jsonb_build_array(jsonb_build_object('ingredient_id', i1, 'qty_per_portion', 50),
                                                                     jsonb_build_object('ingredient_id', i2, 'qty_per_portion', 60)));
  select id into line1 from public.recipe_ingredients where recipe_id = rid and ingredient_id = i1;
  perform public.save_recipe(rid, 'Mix', '', '{}', 2, jsonb_build_array(jsonb_build_object('ingredient_id', i1, 'qty_per_portion', 70)));
  assert (select count(*) from public.recipe_ingredients where recipe_id = rid) = 1, 'removed line still visible';
  assert (select id from public.recipe_ingredients where recipe_id = rid) = line1, 'unchanged line should keep its row';
  assert (select qty_per_portion from public.recipe_ingredients where recipe_id = rid) = 70, 'qty not updated';
  perform public.save_recipe(rid, 'Mix', '', '{}', 2, jsonb_build_array(jsonb_build_object('ingredient_id', i1, 'qty_per_portion', 70),
                                                                       jsonb_build_object('ingredient_id', i2, 'qty_per_portion', 60)));
  assert (select count(*) from public.recipe_ingredients where recipe_id = rid) = 2, 're-adding a removed line failed';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.recipe_ingredients) = 3, 'expected 3 line rows (one soft-deleted)';
  assert (select count(*) from public.recipe_ingredients where deleted_at is not null) = 1, 'expected 1 soft-deleted line';
end $$;

select 'RPC smoke test passed' as result;
rollback;
