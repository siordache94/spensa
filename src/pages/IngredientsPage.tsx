import { useState } from 'react'
import { Button, Group, Stack, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { refreshIngredients, useIngredients, type Ingredient } from '../lib/api/ingredients.ts'
import IngredientForm from './IngredientForm.tsx'
import './lists.css'

export default function IngredientsPage() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useIngredients()
  const [search, setSearch] = useState('')
  // undefined = form closed, null = adding, otherwise the ingredient being edited
  const [editing, setEditing] = useState<Ingredient | null | undefined>(undefined)

  const retry = () => { void refreshIngredients(queryClient) }
  if (error && !data) return <ErrorState title="Couldn't load ingredients" onRetry={retry} retrying={isFetching} />
  if (isPending) return <Loading label="Loading ingredients" />

  const ingredients = data ?? []
  const term = search.trim()
  const needle = term.toLowerCase()
  const shown = ingredients.filter((i) => i.name.toLowerCase().includes(needle))
  const categories = [...new Set(ingredients.map((i) => i.category).filter((c): c is string => !!c))]

  return (
    <Stack className="sp-narrow">
      <Group justify="space-between" wrap="nowrap">
        <h2 className="sp-title">Ingredients</h2>
        <Button onClick={() => setEditing(null)}>Add ingredient</Button>
      </Group>

      {error && <ErrorState variant="inline" onRetry={retry} retrying={isFetching} />}

      <TextInput placeholder="Search" aria-label="Search ingredients" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      {ingredients.length === 0 && (
        <div className="sp-lempty">
          <p>No ingredients yet. Add your first one.</p>
          <Button onClick={() => setEditing(null)}>Add ingredient</Button>
        </div>
      )}
      {ingredients.length > 0 && shown.length === 0 && <p className="sp-dim">No ingredients match “{term}”</p>}

      <Stack gap={0}>
        {shown.map((i) => (
          <button type="button" key={i.id} className="sp-lrow" onClick={() => setEditing(i)}>
            <span className="sp-lrow-main">
              <span className="sp-lrow-name">{i.name}</span>
            </span>
            <span className="sp-lrow-meta">
              <span className="sp-lrow-unit">{i.unit.replace('_', ' ')}</span>
              {i.category && <span className="sp-chip">{i.category}</span>}
            </span>
          </button>
        ))}
      </Stack>

      {editing !== undefined && (
        <IngredientForm
          ingredient={editing}
          categories={categories}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Stack>
  )
}
