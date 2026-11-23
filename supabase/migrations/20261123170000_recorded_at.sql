-- Order facts by when the server recorded them, not by the phone's clock (see ADR 0001, "Ordering").
-- batches.added_at and adjustments.at stay as the phone's time, for display only.
alter table public.batches add column recorded_at timestamptz;
alter table public.adjustments add column recorded_at timestamptz;

-- Existing rows: the phone time is the best record we have.
update public.batches set recorded_at = added_at;
update public.adjustments set recorded_at = at;

alter table public.batches alter column recorded_at set not null, alter column recorded_at set default now();
alter table public.adjustments alter column recorded_at set not null, alter column recorded_at set default now();

-- Clients can't choose it. now() is the transaction start, so rows written in the same
-- transaction as a snapshot (save_inventory_check) get exactly its taken_at.
create function public.set_recorded_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_at := now();
  return new;
end $$;

create trigger batches_set_recorded_at before insert on public.batches
  for each row execute function public.set_recorded_at();
create trigger adjustments_set_recorded_at before insert on public.adjustments
  for each row execute function public.set_recorded_at();
