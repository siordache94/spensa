import { useState } from 'react'
import { Alert, Badge, Button, Group, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'

type Unit = Tables<'ingredients'>['unit']

export type Recipe = Tables<'recipes'> & {
  recipe_ingredients: {
    ingredient_id: string
    qty_per_portion: number | null // null = to taste
    ingredients: { name: string; unit: Unit }
  }[]
}

const SERVES = [1, 2, 3, 4, 6, 8]

const BLOCKED = 'Remove it from these planned meals to delete it.'

// shortcut: markdown shown as plain text, render it if formatting matters
const instructionsStyle = { whiteSpace: 'pre-wrap' } as const

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function formatDate(date: string) {
  return new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// Planned meals of this recipe after the latest snapshot (all of them if there is no snapshot).
async function fetchPlanned(recipeId: string) {
  const { data: snapshots, error: snapshotError } = await supabase
    .from('snapshots')
    .select('on_date')
    .order('on_date', { ascending: false })
    .limit(1)
  if (snapshotError) throw snapshotError
  const cutoff = snapshots[0]?.on_date

  let query = supabase.from('planned_meals').select('date, slot').eq('recipe_id', recipeId).order('date').order('slot')
  if (cutoff) query = query.gt('date', cutoff)
  const { data, error } = await query
  if (error) throw error
  return data
}

type Props = {
  recipe: Recipe
  onClose: () => void
  onEdit: () => void
}

export default function RecipeView({ recipe, onClose, onEdit }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [serves, setServes] = useState(recipe.serves)
  const [confirming, setConfirming] = useState(false)

  const planned = useQuery({
    queryKey: ['recipe-planned', recipe.id],
    queryFn: () => fetchPlanned(recipe.id),
  })
  const meals = planned.data ?? []
  const blocked = meals.length > 0

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
      if (error?.code === '23503') throw new Error(BLOCKED)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      onClose()
    },
  })

  const lines = [...recipe.recipe_ingredients].sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name))
  const failure = remove.error?.message ?? planned.error?.message

  return (
    <Modal opened onClose={onClose} title={recipe.name} fullScreen={isMobile}>
      <Stack>
        {failure && <Alert color="red">{failure}</Alert>}

        {recipe.tags.length > 0 && (
          <Group gap="xs">
            {recipe.tags.map((tag) => <Badge key={tag} variant="light">{tag}</Badge>)}
          </Group>
        )}

        <Input.Wrapper label="Serves">
          <SegmentedControl
            fullWidth
            data={SERVES.map(String)}
            value={String(serves)}
            onChange={(value) => setServes(Number(value))}
          />
        </Input.Wrapper>

        <Stack gap={0}>
          {lines.length === 0 && <Text c="dimmed">No ingredients.</Text>}
          {lines.map((line) => (
            <Group key={line.ingredient_id} justify="space-between" wrap="nowrap" gap="xs" py={6}
              style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Text truncate="end" miw={0}>{line.ingredients.name}</Text>
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {line.qty_per_portion === null ? 'to taste' : `${round1(line.qty_per_portion * serves)} ${line.ingredients.unit}`}
              </Text>
            </Group>
          ))}
        </Stack>

        <Text style={instructionsStyle}>{recipe.instructions || 'No instructions.'}</Text>

        {meals.length > 0 && (
          <Stack gap={4}>
            <Text fw={500}>Planned on</Text>
            {meals.map((meal, i) => (
              <Text key={`${meal.date}-${meal.slot}-${i}`} size="sm">{formatDate(meal.date)}, {meal.slot}</Text>
            ))}
          </Stack>
        )}

        <Stack gap="xs" mt="xs">
          <Button variant="default" fullWidth onClick={onEdit}>Edit</Button>
          {confirming ? (
            <Button.Group>
              <Button color="red" fullWidth loading={remove.isPending} onClick={() => remove.mutate()}>Delete for good</Button>
              <Button variant="default" fullWidth onClick={() => setConfirming(false)}>Keep</Button>
            </Button.Group>
          ) : (
            <Button color="red" variant="light" disabled={blocked || planned.isPending || planned.isError} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          {blocked && <Text size="sm" c="dimmed">{BLOCKED}</Text>}
        </Stack>
      </Stack>
    </Modal>
  )
}
