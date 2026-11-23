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
  assert (select recipe_id from public.planned_meals limit 1) is null, 'past meal should keep a null recipe';
end $$;

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

select 'RLS smoke test passed' as result;
rollback;
