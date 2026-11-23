import { useState } from 'react'
import { ActionIcon, Button, Group, Modal, Select, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconX } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import {
  answerCheckin, clearMealLines, invalidateCheckins, mealOwnLines, saveMealLines, setMealNotCooked, slotLabel, useAnswerCheckin,
  type CheckinAnswer,
} from '../lib/checkins.ts'
import { invalidatePantry } from '../lib/pantry.ts'
import { seedMealLines } from '../domain/mealLines.ts'
import { recipeLines } from '../domain/checkinAnswers.ts'
import type { MealAmount } from '../domain/replay.ts'

/** The planned meal fields the check-in UI reads (the Plan page's rows satisfy it). */
export type CheckinMeal = {
  id: string
  date: string
  slot: string
  portions: number
  not_cooked: boolean
  recipes: { name: string; recipe_ingredients: { ingredient_id: string; qty_per_portion: number | string | null }[] } | null
  planned_meal_lines?: { ingredient_id: string; qty_total: number | string | null }[] | null
}
export type IngredientOption = { id: string; name: string; unit: string }

export const checkinFailure = (e: Error) => notifications.show({ color: 'red', title: 'Could not save', message: e.message })

/** The answer and "didn't cook" writes for a meal, refreshing the unread list and the plan after each. */
export function useCheckinActions() {
  const qc = useQueryClient()
  const answer = useAnswerCheckin()
  const notCooked = useMutation({
    mutationFn: (v: { mealId: string; value: boolean }) => setMealNotCooked(v.mealId, v.value),
    onSettled: () => Promise.all([invalidatePantry(qc), invalidateCheckins(qc)]),
  })
  return { answer, notCooked }
}

/** "Cooked as planned?" for one meal. Tapping a button answers the check-in (or flags the meal) and closes the sheet. */
export function CheckinSheet({ meal, unread, onAmounts, onClose }: { meal: CheckinMeal; unread: boolean; onAmounts: () => void; onClose: () => void }) {
  const { answer, notCooked } = useCheckinActions()
  const answerNow = (a: CheckinAnswer) => {
    answer.mutate({ mealId: meal.id, answer: a }, { onError: checkinFailure })
    onClose()
  }
  return (
    <Modal opened onClose={onClose} title={`${slotLabel(meal.slot)} · ${meal.recipes?.name ?? 'Deleted recipe'}`} centered>
      <Stack>
        <Text size="sm">Cooked as planned?</Text>
        <Button size="lg" onClick={() => answerNow('planned')}>Cooked as planned</Button>
        {/* the amounts editor answers "changed" once it is saved */}
        <Button size="lg" variant="default" onClick={onAmounts}>Changed it</Button>
        <Button
          size="lg"
          variant="default"
          onClick={() => {
            notCooked.mutate({ mealId: meal.id, value: true }, { onError: checkinFailure })
            onClose()
          }}
        >
          Didn't cook
        </Button>
        {unread && (
          <Button variant="subtle" color="gray" onClick={() => answerNow('dismissed')}>Dismiss</Button>
        )}
      </Stack>
    </Modal>
  )
}

/**
 * A meal's own amounts: what it actually used. Starts from its own lines, else the recipe scaled to its portions.
 * Saving sends the full set; answers the check-in as 'changed' when there is one unread.
 */
export function AmountsModal({ meal, unread, ingredients, onClose }: {
  meal: CheckinMeal
  unread: boolean
  ingredients: IngredientOption[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const own = mealOwnLines(meal)
  const [lines, setLines] = useState<MealAmount[]>(() => own ?? seedMealLines(recipeLines(meal.recipes?.recipe_ingredients ?? []), meal.portions))
  const [busy, setBusy] = useState(false)
  const dirty = useDirty(lines)

  const byId = new Map(ingredients.map((i) => [i.id, i]))
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Ingredient'
  const unitOf = (id: string) => byId.get(id)?.unit
  const valid = lines.length > 0 && lines.every((l) => l.qty === null || l.qty > 0)
  const name = meal.recipes?.name ?? 'Deleted recipe'

  const setQty = (id: string, qty: number | null) => setLines((ls) => ls.map((l) => (l.ingredientId === id ? { ...l, qty } : l)))
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.ingredientId !== id))
  const add = (id: string) => {
    const unit = unitOf(id)
    setLines((ls) => [...ls, { ingredientId: id, qty: unit === 'to_taste' ? null : unit === 'count' ? 1 : 100 }])
  }

  async function finish(write: () => Promise<void>) {
    setBusy(true)
    try {
      await write()
      if (unread) await answerCheckin(meal.id, 'changed')
      await Promise.all([invalidatePantry(qc), invalidateCheckins(qc)])
      onClose()
    } catch (e) {
      checkinFailure(e as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={`Amounts · ${name}`} fullScreen={isMobile}>
      <Stack>
        <Text size="sm" c="dimmed">
          What this meal used, for {meal.portions} {meal.portions === 1 ? 'portion' : 'portions'}. It replaces the recipe's amounts for this meal only.
        </Text>

        {lines.map((l) => {
          const unit = unitOf(l.ingredientId)
          const ingName = nameOf(l.ingredientId)
          return (
            <Stack key={l.ingredientId} gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Text fw={500}>{ingName}</Text>
                <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Remove ${ingName}`} onClick={() => remove(l.ingredientId)}>
                  <IconX size={20} stroke={1.75} />
                </ActionIcon>
              </Group>
              {unit === 'to_taste' ? (
                <Text size="sm" c="dimmed">To taste</Text>
              ) : (
                <Stepper
                  aria-label={ingName}
                  unit={unit === 'count' ? undefined : unit}
                  min={amountStep(unit, 0)}
                  step={amountStep(unit, l.qty)}
                  allowDecimal={unit !== 'count'}
                  value={l.qty}
                  onChange={(v) => setQty(l.ingredientId, v)}
                  error={l.qty !== null && !(l.qty > 0) ? 'Must be more than 0' : undefined}
                />
              )}
            </Stack>
          )
        })}

        <Select
          aria-label="Add ingredient"
          placeholder="Add ingredient"
          searchable
          value={null}
          data={ingredients
            .filter((i) => !lines.some((l) => l.ingredientId === i.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((i) => ({ value: i.id, label: i.name }))}
          onChange={(id) => id && add(id)}
        />

        {lines.length === 0 && <Text size="sm" c="red">Keep at least one ingredient, or reset to the recipe.</Text>}
        <Button disabled={!valid} loading={busy} onClick={() => finish(() => saveMealLines(meal.id, lines))}>Save amounts</Button>
        {own && (
          <Button variant="default" disabled={busy} onClick={() => finish(() => clearMealLines(meal.id))}>Reset to recipe</Button>
        )}
      </Stack>
    </GuardedModal>
  )
}
