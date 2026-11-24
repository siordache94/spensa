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
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002');
insert into public.shopping_items (id, text) values ('20000000-0000-0000-0000-000000000003', 'bread');
-- an ordinary pantry batch (not a purchase), used by save_pantry_edits below
insert into public.batches (id, ingredient_id, qty) values ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 200);

-- buy_shopping_item: creates the batch, links it to the item and derives the ingredient from the item (MR-003)
do $$ declare r jsonb; begin
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
         500, '2027-01-01', now());
  assert not (r->>'already_purchased')::boolean, 'the first purchase is not already bought';
  assert (select qty from public.batches where id = '30000000-0000-0000-0000-000000000001') = 500, 'batch missing';
  assert (select shopping_item_id from public.batches where id = '30000000-0000-0000-0000-000000000001') = '20000000-0000-0000-0000-000000000001',
    'batch not linked to the item';
  assert (select ingredient_id from public.batches where id = '30000000-0000-0000-0000-000000000001') = '10000000-0000-0000-0000-000000000001',
    'the ingredient must come from the item, not the caller';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000001', 'item not marked bought';

  -- idempotent retry: still one batch, and not reported as the partner's
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
         500, '2027-01-01', now());
  assert not (r->>'already_purchased')::boolean, 'a retry is not a second purchase';
  assert (select count(*) from public.batches where id = '30000000-0000-0000-0000-000000000001') = 1, 'retry duplicated the batch';

  -- the partner bought the same item first: the second purchase is kept and reported, and does not move the pointer
  r := public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004',
         200, null, now());
  assert (r->>'already_purchased')::boolean, 'the second purchase must report already_purchased';
  assert (select count(*) from public.batches where shopping_item_id = '20000000-0000-0000-0000-000000000001' and deleted_at is null) = 2,
    'both purchases must persist';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000001',
    'a second purchase must not move the bought pointer';

  -- a free-text item has no ingredient to buy
  begin
    perform public.buy_shopping_item('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000009', 1, null, now());
    assert false, 'free-text item should be refused';
  exception when invalid_parameter_value then null;
  end;
  assert not exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000009'), 'free-text item created a batch';

  -- an item the partner already deleted (or another household's item) is refused, and nothing is inserted
  delete from public.shopping_items where id = '20000000-0000-0000-0000-000000000004';
  begin
    perform public.buy_shopping_item('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000009', 1, null, now());
    assert false, 'deleted item should be refused';
  exception when foreign_key_violation then null;
  end;
  assert not exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000009'), 'deleted item created a batch';

  begin
    perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009', 0, null, now());
    assert false, 'zero qty should fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- unbuy: returns exactly one purchase; the item stays bought while another live purchase points at it
do $$ begin
  perform public.unbuy('30000000-0000-0000-0000-000000000001');
  assert not exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000001'), 'batch still visible';
  assert exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000004'), 'the other purchase must stay';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000004',
    'the item must stay bought while a purchase remains';

  perform public.unbuy('30000000-0000-0000-0000-000000000004');
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') is null,
    'returning the last purchase must put the item back on the list';
  perform public.unbuy('30000000-0000-0000-0000-000000000004');
end $$;

-- unbuy is a soft delete: the row stays, stamped; a restored purchase marks the item bought again
reset role;
do $$ begin
  assert (select deleted_by from public.batches where id = '30000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a', 'unbuy did not stamp deleted_by';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
do $$ begin
  assert public.restore('batches', array['30000000-0000-0000-0000-000000000001'::uuid]) = 1, 'restore batch';
  assert exists (select 1 from public.batches where id = '30000000-0000-0000-0000-000000000001'), 'restored batch invisible';
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000001',
    'a restored purchase must mark the item bought';
  -- a retried buy of the same batch is idempotent and keeps that link
  perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 500, null, now());
  assert (select bought_batch_id from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '30000000-0000-0000-0000-000000000001',
    'retry changed the bought pointer';
  perform public.unbuy('30000000-0000-0000-0000-000000000001');
end $$;

-- finish_shopping: needs the household's version and today's date (MR-005); every purchase is snapshotted, the bought
-- item is removed and the unbought one stays
do $$ declare v timestamptz; today date; sid uuid; begin
  -- both phones bought the same item: two purchases to snapshot
  perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 300, null, now());
  perform public.buy_shopping_item('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 100, null, now());
  insert into public.planned_meals (id, date, slot, portions, skip_shopping) values ('40000000-0000-0000-0000-000000000001', '2026-11-25', 'dinner', 2, true);
  assert (select skip_shopping from public.planned_meals where id = '40000000-0000-0000-0000-000000000001'), 'skip_shopping not stored';

  -- the version to send is the one after every setup write above (each of them touches household_events)
  v := (select at from public.household_events);
  today := public.household_today();

  -- a stale version is refused as a conflict and writes nothing
  begin
    perform public.finish_shopping(today, jsonb_build_array(jsonb_build_object('batch_id', '30000000-0000-0000-0000-000000000003', 'qty', 300)), '[]'::jsonb, v - interval '1 second');
    assert false, 'stale version accepted';
  exception when sqlstate '40001' then null;
  end;
  assert (select count(*) from public.snapshots) = 0, 'stale finish wrote a snapshot';

  -- an unknown batch id is refused loudly
  begin
    perform public.finish_shopping(today, jsonb_build_array(jsonb_build_object('batch_id', '30000000-0000-0000-0000-0000000000ff', 'qty', 1)), '[]'::jsonb, v);
    assert false, 'unknown batch accepted';
  exception when foreign_key_violation then null;
  end;
  assert (select count(*) from public.snapshots) = 0, 'unknown-batch finish wrote a snapshot';

  -- a date other than the household's today is refused (the message names the expected date)
  begin
    perform public.finish_shopping(today - 1, '[]'::jsonb, '[]'::jsonb, v);
    assert false, 'non-today snapshot date accepted';
  exception when invalid_parameter_value then null;
  end;
  assert (select count(*) from public.snapshots) = 0, 'wrong-date finish wrote a snapshot';

  -- fresh: both purchases are in the snapshot, the bought item is removed, the unbought item stays, the trip resets
  sid := public.finish_shopping(today,
    jsonb_build_array(jsonb_build_object('batch_id', '30000000-0000-0000-0000-000000000003', 'qty', 300),
                      jsonb_build_object('batch_id', '30000000-0000-0000-0000-000000000005', 'qty', 100)), '[]'::jsonb, v);
  assert (select count(*) from public.snapshot_batches where snapshot_id = sid) = 2, 'both purchases must be snapshotted';
  assert (select qty from public.snapshot_batches where snapshot_id = sid and batch_id = '30000000-0000-0000-0000-000000000005') = 100,
    'the second purchase must keep its own quantity in the snapshot';
  assert not exists (select 1 from public.shopping_items where id = '20000000-0000-0000-0000-000000000001'), 'bought item not removed';
  assert exists (select 1 from public.shopping_items where id = '20000000-0000-0000-0000-000000000005'), 'unbought item removed';
  assert (select count(*) from public.snapshots) = 1, 'snapshot not saved';
  assert not (select skip_shopping from public.planned_meals where id = '40000000-0000-0000-0000-000000000001'), 'finish_shopping should start a new trip (skip_shopping reset)';
  -- the realtime signal row is written by the caller's writes and visible to them
  assert (select by from public.household_events) = '00000000-0000-0000-0000-00000000000a', 'household_events not touched by the writer';
end $$;
reset role;
do $$ begin
  assert (select deleted_by from public.shopping_items where id = '20000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a',
    'finish_shopping should soft-delete bought items';
  assert (select count(*) from public.shopping_items where deleted_at is not null and household_id = (select household_id from public.household_members where user_id = '00000000-0000-0000-0000-00000000000a')) = 2, 'expected two soft-deleted items (cleared + removed)';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- soft delete that cascades into a snapshot line: guard_soft_delete must not reference a column snapshot_batches lacks
do $$ declare sid uuid; begin
  select id into sid from public.snapshots limit 1;
  assert public.soft_delete('batches', array['30000000-0000-0000-0000-000000000003'::uuid]) = 1, 'soft-delete a snapshotted batch';
  assert (select count(*) from public.snapshot_batches where batch_id = '30000000-0000-0000-0000-000000000003') = 0,
    'snapshot line did not follow its batch';
  assert public.restore('batches', array['30000000-0000-0000-0000-000000000003'::uuid]) = 1, 'restore a snapshotted batch';
  assert (select count(*) from public.snapshot_batches where batch_id = '30000000-0000-0000-0000-000000000003') = 1,
    'snapshot line did not come back with its batch';
  -- deleting and restoring the snapshot itself takes the same cascade path
  assert public.soft_delete('snapshots', array[sid]) = 1, 'soft-delete the snapshot';
  assert (select count(*) from public.snapshots) = 0, 'soft-deleted snapshot still visible';
  assert (select count(*) from public.snapshot_batches) = 0, 'snapshot line survived its snapshot';
  assert public.restore('snapshots', array[sid]) = 1, 'restore the snapshot';
  assert (select count(*) from public.snapshot_batches) = 2, 'snapshot lines did not come back with the snapshot';
end $$;

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
  assert (select count(*) from public.recipe_ingredients where household_id = (select household_id from public.household_members where user_id = '00000000-0000-0000-0000-00000000000a')) = 3, 'expected 3 line rows (one soft-deleted)';
  assert (select count(*) from public.recipe_ingredients where deleted_at is not null and household_id = (select household_id from public.household_members where user_id = '00000000-0000-0000-0000-00000000000a')) = 1, 'expected 1 soft-deleted line';
end $$;

select 'RPC smoke test passed' as result;
rollback;
