import { useState } from 'react'
import { Alert, Badge, Button, Center, Group, Loader, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'
import IngredientForm from './IngredientForm.tsx'

type Ingredient = Tables<'ingredients'>

async function fetchIngredients(): Promise<Ingredient[]> {
  const { data, error } = await supabase.from('ingredients').select('*').order('name')
  if (error) throw error
  return data
}

export default function IngredientsPage() {
  const { data, isPending, error } = useQuery({ queryKey: ['ingredients'], queryFn: fetchIngredients })
  const [search, setSearch] = useState('')
  // undefined = form closed, null = adding, otherwise the ingredient being edited
  const [editing, setEditing] = useState<Ingredient | null | undefined>(undefined)

  const ingredients = data ?? []
  const needle = search.trim().toLowerCase()
  const shown = ingredients.filter((i) => i.name.toLowerCase().includes(needle))
  const categories = [...new Set(ingredients.map((i) => i.category).filter((c): c is string => !!c))]

  return (
    <Stack>
      <Group justify="space-between" wrap="nowrap">
        <Title order={2}>Ingredients</Title>
        <Button onClick={() => setEditing(null)}>Add ingredient</Button>
      </Group>

      <TextInput placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      {error && <Alert color="red">{error.message}</Alert>}
      {isPending && <Center py="xl"><Loader /></Center>}
      {data && shown.length === 0 && (
        <Text c="dimmed">{ingredients.length === 0 ? 'No ingredients yet.' : 'No matches.'}</Text>
      )}

      <Stack gap={0}>
        {shown.map((i) => (
          <UnstyledButton
            key={i.id}
            onClick={() => setEditing(i)}
            py="sm"
            style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
          >
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={500} truncate="end" miw={0}>{i.name}</Text>
              <Group gap="xs" wrap="nowrap">
                <Text size="sm" c="dimmed">{i.unit.replace('_', ' ')}</Text>
                {i.category && <Badge variant="light">{i.category}</Badge>}
              </Group>
            </Group>
          </UnstyledButton>
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
