// Recipes aggregate: the recipe list, form and view, and the planned meals a recipe has. Pages import from here.
import { useQuery } from '@tanstack/react-query'
import { defineCommand } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import { ApiError, type Ingredient, type PlannedMeal, type Recipe, type RecipeOption, type RecipeSave } from './port.ts'

export type { Ingredient, PlannedMeal, Recipe, RecipeOption, RecipeSave }

/** Shown when a recipe still has planned meals (the server refuses the delete). */
export const RECIPE_IN_USE_MESSAGE = 'Remove it from these planned meals to delete it.'

// ---- Queries ---------------------------------------------------------------------------------------------------
export function useRecipes() {
  const api = useApi()
  return useQuery({ queryKey: keys.recipes.all(), queryFn: () => api.recipes.list() })
}

/** The planner's recipe picker. `enabled` false keeps it off (editing a meal does not need it). */
export function useRecipeOptions(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: keys.recipes.options(), enabled, queryFn: () => api.recipes.options() })
}

/** Planned meals of one recipe, after the latest snapshot. */
export function usePlannedForRecipe(recipeId: string) {
  const api = useApi()
  return useQuery({ queryKey: keys.recipes.planned(recipeId), queryFn: () => api.recipes.planned(recipeId) })
}

// ---- Commands --------------------------------------------------------------------------------------------------
export const saveRecipe = defineCommand<RecipeSave>({
  name: 'recipes.save',
  run: (api, input) => api.recipes.save(input),
  invalidates: () => [keys.recipes.all()],
})

/** Inline "Create ..." in the recipe form's ingredient picker. The output is the new ingredient, so the line can point at it. */
export const createIngredientForRecipe = defineCommand<{ name: string; unit: Ingredient['unit'] }, Ingredient>({
  name: 'recipes.createIngredient',
  run: async (api, input) => {
    try {
      return await api.recipes.createIngredient(input)
    } catch (e) {
      if (e instanceof ApiError && e.code === '23505') throw new Error('An ingredient with this name already exists.')
      throw e
    }
  },
  invalidates: () => [keys.ingredients.all()],
})

export const deleteRecipe = defineCommand<{ id: string }>({
  name: 'recipes.delete',
  run: async (api, { id }) => {
    try {
      await api.trash.softDelete('recipes', [id])
    } catch (e) {
      if (e instanceof ApiError && e.code === '23503') throw new Error(RECIPE_IN_USE_MESSAGE)
      throw e
    }
  },
  invalidates: () => [keys.recipes.all()],
})

/** Undo of deleteRecipe. Not used by a page yet. */
export const restoreRecipe = defineCommand<{ id: string }>({
  name: 'recipes.restore',
  run: (api, { id }) => api.trash.restore('recipes', [id]),
  invalidates: () => [keys.recipes.all()],
})

// Removing or restoring planned meals from a recipe's view. Both refresh the view even when the write failed,
// because a failed write may have partly applied; they also refresh the planner and the pantry.
const refreshAfterMeals = (recipeId: string) => [keys.recipes.planned(recipeId), keys.plan.plannedMeals(), keys.pantry.all()]

export const unplanRecipeMeals = defineCommand<{ recipeId: string; ids: string[] }>({
  name: 'recipes.unplanMeals',
  run: (api, { ids }) => api.trash.softDelete('planned_meals', ids),
  when: 'settled',
  invalidates: ({ recipeId }) => refreshAfterMeals(recipeId),
})

export const restoreRecipeMeals = defineCommand<{ recipeId: string; ids: string[] }>({
  name: 'recipes.restoreMeals',
  run: (api, { ids }) => api.trash.restore('planned_meals', ids),
  when: 'settled',
  invalidates: ({ recipeId }) => refreshAfterMeals(recipeId),
})
