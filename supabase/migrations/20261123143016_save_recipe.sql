-- Saves a recipe and its ingredient lines in one transaction (plpgsql functions are atomic).
-- security invoker (default): RLS on recipes/recipe_ingredients applies to the caller.
create function public.save_recipe(
  recipe_id uuid,
  name text,
  instructions text,
  tags text[],
  serves int,
  lines jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  rid uuid;
begin
  if save_recipe.recipe_id is null then
    insert into public.recipes (name, instructions, tags, serves)
    values (save_recipe.name, save_recipe.instructions, save_recipe.tags, save_recipe.serves)
    returning id into rid;
  else
    update public.recipes r
      set name = save_recipe.name,
          instructions = save_recipe.instructions,
          tags = save_recipe.tags,
          serves = save_recipe.serves
      where r.id = save_recipe.recipe_id
      returning r.id into rid;
    if rid is null then
      raise exception 'recipe not found';
    end if;
  end if;

  delete from public.recipe_ingredients ri where ri.recipe_id = rid;

  insert into public.recipe_ingredients (recipe_id, ingredient_id, qty_per_portion)
  select rid, x.ingredient_id, x.qty_per_portion
  from jsonb_to_recordset(save_recipe.lines) as x(ingredient_id uuid, qty_per_portion numeric);

  return rid;
end $$;

revoke execute on function public.save_recipe(uuid, text, text, text[], int, jsonb) from public, anon;
grant execute on function public.save_recipe(uuid, text, text, text[], int, jsonb) to authenticated;
