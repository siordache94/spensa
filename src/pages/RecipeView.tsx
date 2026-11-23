import { useState } from 'react'
import { ActionIcon, Alert, Button, Group, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconX } from '@tabler/icons-react'
import { useCommand } from '../lib/api/command.ts'
import {
  deleteRecipe,
  restoreRecipeMeals,
  RECIPE_IN_USE_MESSAGE,
  unplanRecipeMeals,
  usePlannedForRecipe,
  type Recipe,
} from '../lib/api/recipes.ts'

const SERVES = [1, 2, 3, 4, 6, 8]

// shortcut: markdown shown as plain text, render it if formatting matters
const instructionsStyle = { whiteSpace: 'pre-wrap' } as const

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function formatDate(date: string) {
  return new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

type Props = {
  recipe: Recipe
  onClose: () => void
  onEdit: () => void
}

export default function RecipeView({ recipe, onClose, onEdit }: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [serves, setServes] = useState(recipe.serves)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Planned meals of this recipe after the latest snapshot (all of them if there is no snapshot).
  const planned = usePlannedForRecipe(recipe.id)
  const meals = planned.data ?? []
  const blocked = meals.length > 0

  const remove = useCommand(deleteRecipe, { onSuccess: onClose })

  const restore = useCommand(restoreRecipeMeals)

  const unplan = useCommand(unplanRecipeMeals, {
    onSuccess: (_, { ids }) => {
      setClearing(false)
      const id = notifications.show({
        autoClose: 5000,
        message: (
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{ids.length === 1 ? 'Removed from that date.' : `Removed from ${ids.length} dates.`}</Text>
            <Button size="compact-md" variant="default" onClick={() => { notifications.hide(id); restore.mutate({ recipeId: recipe.id, ids }) }}>Undo</Button>
          </Group>
        ),
      })
    },
  })

  const lines = [...recipe.recipe_ingredients].sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name))
  const failure = remove.error?.message ?? unplan.error?.message ?? restore.error?.message ?? planned.error?.message

  return (
    <Modal opened onClose={onClose} title={recipe.name} fullScreen={isMobile}>
      <Stack>
        {failure && <Alert color="red">{failure}</Alert>}

        {recipe.tags.length > 0 && (
          <Group gap="xs">
            {recipe.tags.map((tag) => <span key={tag} className="sp-chip">{tag}</span>)}
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

        <Text className="sp-selectable" style={instructionsStyle}>{recipe.instructions || 'No instructions.'}</Text>

        {meals.length > 0 && (
          <Stack gap={0}>
            <Text fw={500} pb={4}>Planned on</Text>
            {meals.map((meal) => (
              <Group key={meal.id} justify="space-between" wrap="nowrap" gap="xs" mih={44}
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Group gap="sm" wrap="nowrap" miw={0}>
                  <Text>{formatDate(meal.date)}</Text>
                  <span className="sp-caps">{meal.slot}</span>
                </Group>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  w={44}
                  h={44}
                  aria-label={`Remove from ${formatDate(meal.date)}, ${meal.slot}`}
                  disabled={unplan.isPending}
                  onClick={() => unplan.mutate({ recipeId: recipe.id, ids: [meal.id] })}
                >
                  <IconX size={20} stroke={1.75} />
                </ActionIcon>
              </Group>
            ))}
            {clearing ? (
              <Button.Group mt="xs">
                <Button color="red" fullWidth loading={unplan.isPending} onClick={() => unplan.mutate({ recipeId: recipe.id, ids: meals.map((m) => m.id) })}>
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
              <Button color="red" fullWidth loading={remove.isPending} onClick={() => remove.mutate({ id: recipe.id })}>Delete for good</Button>
              <Button variant="default" fullWidth onClick={() => setConfirming(false)}>Keep</Button>
            </Button.Group>
          ) : (
            <Button color="red" variant="light" disabled={blocked || planned.isPending || planned.isError} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          {blocked && <Text size="sm" c="dimmed">{RECIPE_IN_USE_MESSAGE}</Text>}
        </Stack>
      </Stack>
    </Modal>
  )
}
