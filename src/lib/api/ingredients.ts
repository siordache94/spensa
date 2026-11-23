// Ingredients aggregate: queries (hooks) and commands. Pages import from here, never from supabase.
import { useQuery } from '@tanstack/react-query'
import { defineCommand } from './command.ts'
import { useApi } from './context.tsx'
import { keys } from './keys.ts'
import { ApiError, type Ingredient, type IngredientInput } from './port.ts'

export type { Ingredient, IngredientInput }

// ---- Queries ---------------------------------------------------------------------------------------------------
export function useIngredients() {
  const api = useApi()
  return useQuery({ queryKey: keys.ingredients.all(), queryFn: () => api.ingredients.list() })
}

/** Names of the recipes using an ingredient. `ingredientId` undefined (adding) keeps the query off. */
export function useIngredientUsage(ingredientId: string | undefined) {
  const api = useApi()
  return useQuery({
    queryKey: keys.ingredients.usage(ingredientId),
    enabled: ingredientId !== undefined,
    queryFn: () => api.ingredients.usage(ingredientId!),
  })
}

// ---- Commands --------------------------------------------------------------------------------------------------
/** `id: null` adds, otherwise updates. */
export const saveIngredient = defineCommand<{ id: string | null; row: IngredientInput }>({
  name: 'ingredients.save',
  run: async (api, { id, row }) => {
    try {
      await api.ingredients.save(id, row)
    } catch (e) {
      if (e instanceof ApiError && e.code === '23505') throw new Error('An ingredient with this name already exists.')
      throw e
    }
  },
  invalidates: () => [keys.ingredients.all()],
})

export const deleteIngredient = defineCommand<{ id: string }>({
  name: 'ingredients.delete',
  run: async (api, { id }) => {
    try {
      await api.trash.softDelete('ingredients', [id])
    } catch (e) {
      if (e instanceof ApiError && e.code === '23503') throw new Error('Remove it from these recipes to delete it.')
      throw e
    }
  },
  invalidates: () => [keys.ingredients.all()],
})
