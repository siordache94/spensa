-- Live sync of shopping ticks between phones. RLS still limits which rows each user receives.
alter publication supabase_realtime add table public.batches, public.ingredients, public.shopping_items;
