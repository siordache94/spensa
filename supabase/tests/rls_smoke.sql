-- Run: docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/rls_smoke.sql
-- Everything is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local');

-- A creates a household and an ingredient
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_household('A home');
insert into public.ingredients (name, unit) values ('pasta', 'g');

-- Remember A's household id and invite code (as superuser)
reset role;
select id as a_id, invite_code from public.households where name = 'A home' \gset
set local spensa.a_id = :'a_id';
set local spensa.invite = :'invite_code';

-- B creates their own household, sees nothing of A's, and can't write into it
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select public.create_household('B home');
do $$ begin
  assert (select count(*) from public.ingredients) = 0, 'B sees A''s ingredients';
  assert (select count(*) from public.households) = 1, 'B sees A''s household';
  begin
    insert into public.ingredients (household_id, name, unit) values (current_setting('spensa.a_id')::uuid, 'x', 'g');
    assert false, 'B wrote into A''s household';
  exception when insufficient_privilege then null;
  end;
  insert into public.ingredients (name, unit) values ('mine', 'g');
  assert (select count(*) from public.ingredients) = 1, 'B insert into own household failed';
end $$;

-- C joins A with the invite code and sees A's data
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.join_household(:'invite_code');
do $$ begin
  assert (select count(*) from public.ingredients) = 1 and exists (select 1 from public.ingredients where name = 'pasta'),
    'C does not see exactly A''s ingredients';
end $$;

-- An ingredient used by a recipe can't be deleted
insert into public.recipes (name) values ('Carbonara');
insert into public.recipe_ingredients (recipe_id, ingredient_id, qty_per_portion)
  select r.id, i.id, 80 from public.recipes r, public.ingredients i where i.name = 'pasta';
do $$ begin
  begin
    delete from public.ingredients where name = 'pasta';
    assert false, 'ingredient delete should be blocked';
  exception when foreign_key_violation then null;
  end;
end $$;

-- A recipe planned after the latest snapshot can't be deleted; once a snapshot covers the meal, it can
insert into public.planned_meals (date, slot, recipe_id, portions)
  select '2026-11-25', 'dinner', id, 2 from public.recipes;
do $$ begin
  begin
    delete from public.recipes;
    assert false, 'recipe delete should be blocked';
  exception when foreign_key_violation then null;
  end;
end $$;
insert into public.snapshots (on_date) values ('2026-11-26');
delete from public.recipes;
do $$ begin
  assert (select count(*) from public.recipes) = 0, 'recipe delete after snapshot failed';
  -- the meal keeps pointing at the (soft-deleted) recipe; the recipe is simply invisible to clients
  assert (select recipe_id from public.planned_meals limit 1) is not null, 'past meal should keep its recipe id';
  assert (select count(*) from public.recipe_ingredients) = 0, 'recipe lines should go with the recipe';
end $$;

-- A hard DELETE was converted: the row is still there for the superuser, stamped with who and when.
reset role;
do $$ begin
  assert (select count(*) from public.recipes where name = 'Carbonara' and deleted_at is not null
            and deleted_by = '00000000-0000-0000-0000-00000000000c') = 1, 'delete should be a soft delete by C';
  assert (select count(*) from public.recipe_ingredients where deleted_at is not null
            and deleted_by = '00000000-0000-0000-0000-00000000000c') = 1, 'recipe line should be soft-deleted with it';
  -- created_by was stamped from auth.uid()
  assert (select created_by from public.ingredients where name = 'pasta') = '00000000-0000-0000-0000-00000000000a', 'created_by wrong';
  assert (select created_by from public.recipes where name = 'Carbonara') = '00000000-0000-0000-0000-00000000000c', 'recipe created_by wrong';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- Restore brings back the recipe and the lines that went with it; a recipe the caller can't see can't be touched
do $$
declare rid uuid;
begin
  -- invisible to normal reads, so the id comes from the planned meal
  select recipe_id into rid from public.planned_meals limit 1;
  assert (select count(*) from public.recipes where id = rid) = 0, 'deleted recipe visible';
  assert public.restore('recipes', array[rid]) = 1, 'restore did not restore';
  assert (select count(*) from public.recipes where id = rid) = 1, 'restored recipe invisible';
  assert (select count(*) from public.recipe_ingredients where recipe_id = rid) = 1, 'recipe lines not restored';
  assert (select count(*) from public.recipes where id = rid and updated_by = '00000000-0000-0000-0000-00000000000c') = 1, 'restore not recorded in updated_by';
  assert public.restore('recipes', array[rid]) = 0, 'restoring a live row should be a no-op';
  begin
    perform public.restore('households', array[rid]);
    assert false, 'restore on other tables must be refused';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Authorship can't be spoofed: created_by/created_at/updated_by/deleted_* are set by triggers
do $$
declare iid uuid;
begin
  insert into public.ingredients (name, unit, created_by, created_at, updated_by, deleted_by)
    values ('salt', 'to_taste', '00000000-0000-0000-0000-00000000000a', '2000-01-01', '00000000-0000-0000-0000-00000000000a',
            '00000000-0000-0000-0000-00000000000a') returning id into iid;
  assert (select created_by from public.ingredients where id = iid) = '00000000-0000-0000-0000-00000000000c', 'created_by spoofed';
  assert (select created_at from public.ingredients where id = iid) > '2020-01-01', 'created_at spoofed';
  assert (select updated_by is null and deleted_by is null from public.ingredients where id = iid), 'insert spoofed updated/deleted_by';
  update public.ingredients set category = 'spices', created_by = '00000000-0000-0000-0000-00000000000a',
         updated_by = '00000000-0000-0000-0000-00000000000a', updated_at = '2000-01-01' where id = iid;
  assert (select created_by from public.ingredients where id = iid) = '00000000-0000-0000-0000-00000000000c', 'created_by changed by update';
  assert (select updated_by from public.ingredients where id = iid) = '00000000-0000-0000-0000-00000000000c', 'updated_by spoofed';
  assert (select updated_at from public.ingredients where id = iid) > '2020-01-01', 'updated_at spoofed';
  -- a client can't write deleted_at directly (the row would vanish from its own view), and can't undelete via update
  begin
    update public.ingredients set deleted_at = now(), deleted_by = '00000000-0000-0000-0000-00000000000a' where id = iid;
    assert false, 'direct deleted_at update should be refused';
  exception when insufficient_privilege then null;
  end;
  -- soft delete via RPC: stamped with the caller, hidden, cascades to its batches; name is free again
  insert into public.batches (id, ingredient_id, qty) values ('40000000-0000-0000-0000-000000000001', iid, 5);
  insert into public.adjustments (batch_id, ingredient_id, kind, qty) values ('40000000-0000-0000-0000-000000000001', iid, 'set', 2);
  assert public.soft_delete('ingredients', array[iid]) = 1, 'soft_delete count';
  assert (select count(*) from public.ingredients where id = iid) = 0, 'soft-deleted ingredient visible';
  assert (select count(*) from public.batches where id = '40000000-0000-0000-0000-000000000001') = 0, 'batch visible after ingredient delete';
  insert into public.ingredients (name, unit) values ('salt', 'to_taste'); -- partial unique index: name reusable
  begin
    insert into public.batches (ingredient_id, qty) values (iid, 1);
    assert false, 'batch for a deleted ingredient should fail';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.restore('ingredients', array[iid]);
    assert false, 'restore into a taken name should fail';
  exception when unique_violation then null;
  end;
  delete from public.ingredients where name = 'salt';  -- hard delete -> soft
  assert public.restore('ingredients', array[iid]) = 1, 'restore ingredient';
  assert (select count(*) from public.batches where id = '40000000-0000-0000-0000-000000000001') = 1, 'batch not restored with ingredient';
  assert (select count(*) from public.adjustments where batch_id = '40000000-0000-0000-0000-000000000001') = 1, 'adjustment not restored with ingredient';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.ingredients where name = 'salt' and deleted_by = '00000000-0000-0000-0000-00000000000c') = 1, 'deleted_by not recorded';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- Another household can't soft-delete or restore A's rows
reset role;
select id as a_ing from public.ingredients where name = 'pasta' \gset
set local spensa.a_ing = :'a_ing';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
do $$ begin
  assert public.soft_delete('ingredients', array[current_setting('spensa.a_ing')::uuid]) = 0, 'B soft-deleted A''s row';
  delete from public.ingredients where id = current_setting('spensa.a_ing')::uuid;
end $$;
reset role;
do $$ begin
  assert (select deleted_at is null from public.ingredients where name = 'pasta'), 'cross-household delete took effect';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';

-- Referenced ids must belong to the same household (composite FKs)
reset role;
select id as b_ing from public.ingredients where name = 'mine' \gset
set local spensa.b_ing = :'b_ing';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
do $$ begin
  begin
    insert into public.batches (ingredient_id, qty) values (current_setting('spensa.b_ing')::uuid, 1);
    assert false, 'batch referencing another household''s ingredient should fail';
  exception when foreign_key_violation then null;
  end;
end $$;

-- A member can't rewrite invite_code directly, but can still change everyday settings
do $$ begin
  begin
    update public.households set invite_code = 'hacked';
    assert false, 'invite_code update should be denied';
  exception when insufficient_privilege then null;
  end;
  update public.households set expiring_days = 5;
  assert (select expiring_days from public.households) = 5, 'settings update failed';

  -- horizon_days: members may change it, within 1..14
  update public.households set horizon_days = 10;
  assert (select horizon_days from public.households) = 10, 'horizon_days update failed';
  begin
    update public.households set horizon_days = 15;
    assert false, 'horizon_days 15 should be rejected';
  exception when check_violation then null;
  end;
  begin
    update public.households set horizon_days = 0;
    assert false, 'horizon_days 0 should be rejected';
  exception when check_violation then null;
  end;
end $$;

-- skip_shopping: members update it on planned meals (default false)
do $$ begin
  assert (select not skip_shopping from public.planned_meals limit 1), 'skip_shopping should default to false';
  update public.planned_meals set skip_shopping = true;
  assert (select bool_and(skip_shopping) from public.planned_meals), 'skip_shopping update failed';
  -- the signal row exists for this household only, and clients cannot write to it
  assert (select count(*) from public.household_events) = 1, 'household_events should show exactly my household';
  begin
    update public.household_events set by = null;
    assert false, 'household_events should not be client-writable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- rotate_invite_code returns a new code, the old one stops working, and the new one joins
do $$
declare new_code text;
begin
  new_code := public.rotate_invite_code();
  assert new_code is not null and new_code <> current_setting('spensa.invite'), 'code did not change';
  assert (select invite_code from public.households) = new_code, 'stored code differs from returned';
end $$;

-- A wrong invite code fails
do $$ begin
  begin
    perform public.join_household('nope');
    assert false, 'bad code should fail';
  exception when raise_exception then null;
  end;
end $$;

-- purge_user removes the uid from every household structure, not just authorship and household_events (MR-046)
reset role;
select id as a_meal from public.planned_meals limit 1 \gset
set local spensa.a_meal = :'a_meal';
do $$ begin
  update public.planned_meals set cook_id = '00000000-0000-0000-0000-00000000000c' where id = current_setting('spensa.a_meal')::uuid;
  insert into public.meal_checkins (household_id, planned_meal_id, answer, answered_at, answered_by)
    values (current_setting('spensa.a_id')::uuid, current_setting('spensa.a_meal')::uuid, 'planned', now(),
            '00000000-0000-0000-0000-00000000000c');
  insert into public.push_list_state (household_id, window_authors)
    values (current_setting('spensa.a_id')::uuid, array['00000000-0000-0000-0000-00000000000c'::uuid])
  on conflict (household_id) do update set window_authors = excluded.window_authors;
end $$;
set local request.jwt.claims = '{}'; -- service role: no signed-in user
select public.purge_user('00000000-0000-0000-0000-00000000000c');
select public.purge_user('00000000-0000-0000-0000-00000000000c'); -- idempotent
do $$ begin
  assert not exists (select 1 from public.household_members where user_id = '00000000-0000-0000-0000-00000000000c'), 'membership should be gone';
  assert exists (select 1 from public.households where name = 'A home'), 'household must survive while a member remains';
  assert not exists (select 1 from public.household_events where by = '00000000-0000-0000-0000-00000000000c'), 'household_events still names the user';
  assert (select not ('00000000-0000-0000-0000-00000000000c' = any (window_authors)) from public.push_list_state
            where household_id = current_setting('spensa.a_id')::uuid), 'window_authors still names the user';
  assert (select cook_id is null from public.planned_meals where id = current_setting('spensa.a_meal')::uuid), 'cook still names the user';
  assert (select answered_by is null from public.meal_checkins where planned_meal_id = current_setting('spensa.a_meal')::uuid),
    'answered_by still names the user';
end $$;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000c';

select 'RLS smoke test passed' as result;
rollback;
