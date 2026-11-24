-- MR-005: "Done shopping" must not trust the phone's cache. The client sends the household version it computed the
-- snapshot from (household_events.at) and the snapshot date; this function locks the household clock, compares the
-- version in the same transaction, and refuses a stale one instead of silently dropping a batch the partner bought
-- meanwhile. Unknown batch ids and a non-today date are refused loudly too.
-- Everything MR-004/ADR 0001 expects stays in one transaction: answers, snapshot, trip reset, bought items cleared,
-- and every check-in left unread counts as cooked as planned.

-- The household's today in its own timezone. The snapshot date must be this, whatever the phone's clock says.
create function public.household_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone coalesce(
    (select h.timezone from public.households h where h.id = public.my_household()), 'UTC'))::date
$$;
revoke execute on function public.household_today() from public, anon;
grant execute on function public.household_today() to authenticated;

-- The household's event clock, locked for the rest of the transaction. Every household write touches that row
-- (touch_household_events), so locking it makes a partner's in-flight write commit either before our check (which
-- then sees a newer `at` and refuses) or after our snapshot. security definer because clients may read the row but
-- not lock it; it only ever reads it (no row is created here).
create function public.household_version() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid := public.my_household();
  seen timestamptz;
begin
  if auth.uid() is null or hid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select he.at into seen from public.household_events he where he.household_id = hid for update;
  return seen;
end $$;
revoke execute on function public.household_version() from public, anon;
grant execute on function public.household_version() to authenticated;

-- Replaces the version that took only (on_date, batches, answers). 40001 = the household moved since `expected_at`
-- (the client refetches, keeps the dialog open and asks for one more tap); 22023 = the date is not the household's
-- today (the message names the expected date); 23503 = a snapshot line names a batch this household cannot see.
drop function public.finish_shopping(date, jsonb, jsonb);

create function public.finish_shopping(on_date date, batches jsonb, answers jsonb, expected_at timestamptz) returns uuid
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
  perform public.soft_delete('shopping_items', array(select si.id from public.shopping_items si where si.bought_batch_id is not null));
  update public.planned_meals set skip_shopping = false where skip_shopping;
  perform public.checkin_answer_all('planned');
  return sid;
end $$;
revoke execute on function public.finish_shopping(date, jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.finish_shopping(date, jsonb, jsonb, timestamptz) to authenticated;
