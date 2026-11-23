import { useState } from 'react'
import { Alert, Badge, Button, Center, Group, Loader, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import RecipeForm from './RecipeForm.tsx'
import RecipeView, { type Recipe } from './RecipeView.tsx'

const RECIPE_SELECT = '*, recipe_ingredients(ingredient_id, qty_per_portion, ingredients(name, unit))'

async function fetchRecipes(): Promise<Recipe[]> {
  const { data, error } = await supabase.from('recipes').select(RECIPE_SELECT).order('name')
  if (error) throw error
  return data
}

export default function RecipesPage() {
  const { data, isPending, error } = useQuery({ queryKey: ['recipes'], queryFn: fetchRecipes })
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<Recipe | null>(null)
  // undefined = form closed, null = adding, otherwise the recipe being edited
  const [editing, setEditing] = useState<Recipe | null | undefined>(undefined)

  const recipes = data ?? []
  const needle = search.trim().toLowerCase()
  const shown = recipes.filter(
    (r) => r.name.toLowerCase().includes(needle) || r.tags.some((t) => t.toLowerCase().includes(needle)),
  )

  return (
    <Stack>
      <Group justify="space-between" wrap="nowrap">
        <Title order={2}>Recipes</Title>
        <Button onClick={() => setEditing(null)}>Add recipe</Button>
      </Group>

      <TextInput placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      {error && <Alert color="red">{error.message}</Alert>}
      {isPending && <Center py="xl"><Loader /></Center>}
      {data && shown.length === 0 && (
        <Text c="dimmed">{recipes.length === 0 ? 'No recipes yet.' : 'No matches.'}</Text>
      )}

      <Stack gap={0}>
        {shown.map((r) => (
          <UnstyledButton
            key={r.id}
            onClick={() => setViewing(r)}
            py="sm"
            style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
          >
            <Stack gap={4}>
              <Text fw={500}>{r.name}</Text>
              {r.tags.length > 0 && (
                <Group gap={4}>
                  {r.tags.map((tag) => <Badge key={tag} variant="light" size="sm">{tag}</Badge>)}
                </Group>
              )}
            </Stack>
          </UnstyledButton>
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
        />
      )}

      {editing !== undefined && (
        <RecipeForm recipe={editing} onClose={() => setEditing(undefined)} />
      )}
    </Stack>
  )
}
