import { useState } from 'react'
import { ActionIcon, Alert, Button, Group, Input, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconX } from '@tabler/icons-react'
import { Markdown } from '../components/Markdown.tsx'
import { useCommand } from '../lib/api/command.ts'
import { useModalOverlay } from '../lib/navigation.ts'
import { formatDay, visibleUnit } from '../lib/format.ts'
import {
  deleteRecipe,
  restoreRecipeMeals,
  RECIPE_IN_USE_MESSAGE,
  unplanRecipeMeals,
  usePlannedForRecipe,
  type Recipe,
} from '../lib/api/recipes.ts'
import './recipes.css'

const SERVES = [1, 2, 3, 4, 6, 8]

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function formatDate(date: string) {
  return formatDay(date, { weekday: 'short', day: 'numeric', month: 'short' })
}

type Props = {
  recipe: Recipe
  onClose: () => void
  onEdit: () => void
  /** The recipe was deleted: the list offers an Undo toast for it. */
  onDeleted: (recipe: Recipe) => void
}

export default function RecipeView({ recipe, onClose, onEdit, onDeleted }: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const closeView = useModalOverlay(onClose)
  const [serves, setServes] = useState(recipe.serves)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Planned meals of this recipe after the latest snapshot (all of them if there is no snapshot).
  const planned = usePlannedForRecipe(recipe.id)
  const meals = planned.data ?? []
  const blocked = meals.length > 0

  // Deleted, not gone for good: the list shows an Undo toast (ADR 0003).
  const remove = useCommand(deleteRecipe, { onSuccess: () => { onDeleted(recipe); onClose() } })

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
    <Modal opened onClose={closeView} title={recipe.name} fullScreen={isMobile}>
      <Stack>
        {failure && <Alert color="red">{failure}</Alert>}

        {recipe.tags.length > 0 && (
          <Group gap="xs">
            {recipe.tags.map((tag) => <span key={tag} className="sp-chip">{tag}</span>)}
          </Group>
        )}

        <Input.Wrapper label="Scale for" description="Preview only. Scaling does not change the recipe.">
          <SegmentedControl
            fullWidth
            data={SERVES.map(String)}
            value={String(serves)}
            onChange={(value) => setServes(Number(value))}
          />
        </Input.Wrapper>

        <Stack gap={0}>
          {lines.length === 0 && <Text c="dimmed">No ingredients.</Text>}
          {lines.length > 0 && (
            <ul className="sp-rrows">
              {lines.map((line) => {
                const unit = visibleUnit(line.ingredients.unit)
                return (
                  <li key={line.ingredient_id} className="sp-rrow">
                    <span className="sp-rrow-name">{line.ingredients.name}</span>
                    {line.qty_per_portion === null ? (
                      <span className="sp-rrow-free">to taste</span>
                    ) : (
                      <>
                        <span className="sp-rrow-num">{round1(line.qty_per_portion * serves)}</span>
                        {unit && <span className="sp-rrow-unit">{unit}</span>}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Stack>

        {recipe.instructions.trim() === ''
          ? <Text c="dimmed">No instructions.</Text>
          : <Markdown source={recipe.instructions} className="sp-selectable" />}

        {meals.length > 0 && (
          <Stack gap={0}>
            <Text fw={500} pb={4}>Planned on</Text>
            <ul className="sp-rrows">
              {meals.map((meal) => (
                <li key={meal.id} className="sp-rplan">
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
                </li>
              ))}
            </ul>
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
              <Button color="red" fullWidth loading={remove.isPending} onClick={() => remove.mutate({ id: recipe.id })}>Delete</Button>
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
