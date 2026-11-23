import { useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Group, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconX } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidatePantry } from '../lib/pantry.ts'
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
  return new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

type Meal = Tables<'planned_meals'>

// Planned meals of this recipe after the latest snapshot (all of them if there is no snapshot).
async function fetchPlanned(recipeId: string) {
  const { data: snapshots, error: snapshotError } = await supabase
    .from('snapshots')
    .select('on_date')
    .order('on_date', { ascending: false })
    .limit(1)
  if (snapshotError) throw snapshotError
  const cutoff = snapshots[0]?.on_date

  let query = supabase.from('planned_meals').select('*').eq('recipe_id', recipeId).order('date').order('slot')
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
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [serves, setServes] = useState(recipe.serves)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

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

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recipe-planned', recipe.id] })
    queryClient.invalidateQueries({ queryKey: ['planned_meals'] })
    invalidatePantry(queryClient)
  }

  const unplan = useMutation({
    mutationFn: async (rows: Meal[]) => {
      const { error } = await supabase.from('planned_meals').delete().in('id', rows.map((m) => m.id))
      if (error) throw new Error(error.message)
      return rows
    },
    onSuccess: (rows) => {
      setClearing(false)
      const id = notifications.show({
        autoClose: 5000,
        message: (
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{rows.length === 1 ? 'Removed from that date.' : `Removed from ${rows.length} dates.`}</Text>
            <Button size="compact-md" variant="default" onClick={() => { notifications.hide(id); restore.mutate(rows) }}>Undo</Button>
          </Group>
        ),
      })
    },
    onSettled: refresh,
  })

  const restore = useMutation({
    mutationFn: async (rows: Meal[]) => {
      const { error } = await supabase.from('planned_meals').insert(rows)
      if (error) throw new Error(error.message)
    },
    onSettled: refresh,
  })

  const lines = [...recipe.recipe_ingredients].sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name))
  const failure = remove.error?.message ?? unplan.error?.message ?? restore.error?.message ?? planned.error?.message

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
          <Stack gap={0}>
            <Text fw={500} pb={4}>Planned on</Text>
            {meals.map((meal) => (
              <Group key={meal.id} justify="space-between" wrap="nowrap" gap="xs" mih={44}
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Text size="sm" fw={600} tt="uppercase" style={{ letterSpacing: '0.06em' }}>
                  {formatDate(meal.date)} · {meal.slot}
                </Text>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  w={44}
                  h={44}
                  aria-label={`Remove from ${formatDate(meal.date)}, ${meal.slot}`}
                  disabled={unplan.isPending}
                  onClick={() => unplan.mutate([meal])}
                >
                  <IconX size={20} stroke={1.75} />
                </ActionIcon>
              </Group>
            ))}
            {clearing ? (
              <Button.Group mt="xs">
                <Button color="red" fullWidth loading={unplan.isPending} onClick={() => unplan.mutate(meals)}>
                  Remove from {meals.length} {meals.length === 1 ? 'date' : 'dates'}
                </Button>
                <Button variant="default" fullWidth onClick={() => setClearing(false)}>Keep</Button>
              </Button.Group>
            ) : (
              <Button variant="default" mt="xs" onClick={() => setClearing(true)}>Remove from all dates</Button>
            )}
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
