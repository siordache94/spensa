-- Who ticked an item, so the other phone can show "ticked by partner".
-- Nullable: the user may be deleted later, and rows from before this migration have no author.
alter table public.batches add column created_by uuid default auth.uid() references auth.users on delete set null;
alter table public.shopping_items add column created_by uuid default auth.uid() references auth.users on delete set null;
