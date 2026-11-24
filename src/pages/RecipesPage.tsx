import { useState } from 'react'
import { Button, Group, Stack, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyState } from '../components/EmptyState.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { UndoToast } from '../components/UndoToast.tsx'
import { useCommand } from '../lib/api/command.ts'
import { refreshRecipes, restoreRecipe, useRecipes, type Recipe } from '../lib/api/recipes.ts'
import RecipeForm from './RecipeForm.tsx'
import RecipeView from './RecipeView.tsx'
import './lists.css'

export default function RecipesPage() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useRecipes()
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<Recipe | null>(null)
  // undefined = form closed, null = adding, otherwise the recipe being edited
  const [editing, setEditing] = useState<Recipe | null | undefined>(undefined)
  // The recipe just deleted, for the Undo toast; scoped to its id, so nothing else comes back.
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null)
  const restore = useCommand(restoreRecipe, {
    onError: (e) => notifications.show({ color: 'red', title: 'Could not restore the recipe', message: e.message }),
  })

  const retry = () => { void refreshRecipes(queryClient) }
  if (error && !data) return <ErrorState title="Couldn't load recipes" onRetry={retry} retrying={isFetching} />
  if (isPending) return <Loading label="Loading recipes" />

  const recipes = data ?? []
  const term = search.trim()
  const needle = term.toLowerCase()
  const shown = recipes.filter(
    (r) => r.name.toLowerCase().includes(needle) || r.tags.some((t) => t.toLowerCase().includes(needle)),
  )

  return (
    <Stack className="sp-narrow">
      <Group justify="space-between" wrap="nowrap">
        <h1 className="sp-title">Recipes</h1>
        <Button onClick={() => setEditing(null)}>Add recipe</Button>
      </Group>

      {error && <ErrorState variant="inline" message="Can't refresh. Showing saved recipes." onRetry={retry} retrying={isFetching} />}

      <TextInput placeholder="Search" aria-label="Search recipes" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      {recipes.length === 0 && (
        <EmptyState
          title="No recipes yet"
          reason="Add your first one."
          action={{ label: 'Add recipe', onClick: () => setEditing(null) }}
        />
      )}
      {recipes.length > 0 && shown.length === 0 && (
        <EmptyState
          title="No matches"
          reason={`Nothing matches “${term}”.`}
          action={{ label: 'Clear search', onClick: () => setSearch('') }}
        />
      )}

      <Stack gap={0}>
        {shown.map((r) => (
          <button type="button" key={r.id} className="sp-lrow" onClick={() => setViewing(r)}>
            <span className="sp-lrow-main">
              <span className="sp-lrow-name">{r.name}</span>
            </span>
            {r.tags.length > 0 && (
              <span className="sp-lrow-meta">
                {r.tags.map((tag) => <span key={tag} className="sp-chip">{tag}</span>)}
              </span>
            )}
          </button>
        ))}
      </Stack>

      {viewing && (
        <RecipeView
          recipe={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onDeleted={(recipe) => setUndo({ id: recipe.id, name: recipe.name })}
        />
      )}

      {undo && (
        <UndoToast
          key={undo.id}
          message={`Deleted ${undo.name}`}
          onUndo={() => { restore.mutate({ id: undo.id }); setUndo(null) }}
          onExpire={() => setUndo(null)}
        />
      )}

      {editing !== undefined && (
        <RecipeForm recipe={editing} onClose={() => setEditing(undefined)} />
      )}
    </Stack>
  )
}
