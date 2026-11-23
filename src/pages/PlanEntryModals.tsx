import { useState } from 'react'
import { Alert, Button, Input, Loader, Radio, SegmentedControl, Select, Stack, TagsInput, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { notifications } from '@mantine/notifications'
import { useCommand } from '../lib/api/command.ts'
import { addMeal, moveMeal, saveSlots, setMealCook, setMealPortions } from '../lib/api/plan.ts'
import { useRecipeOptions } from '../lib/api/recipes.ts'
import { memberLabel, useMembers } from '../lib/members.ts'

/** Reports a failed planner write. Every planner write uses it as its onError. */
export const notifyFailure = (e: Error) => notifications.show({ color: 'red', title: 'Could not save', message: e.message })

const isPortions = (v: number | null): v is number => v !== null && Number.isInteger(v) && v >= 1

export type Target = { date: string; slot: string }

/** Add a meal (meal === undefined, target given) or change the portions of an existing one. */
export function MealModal({
  target,
  meal,
  position,
  onClose,
}: {
  target: Target
  meal?: { id: string; portions: number }
  position: number
  onClose: () => void
}) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [portions, setPortions] = useState<number | null>(meal?.portions ?? 2)
  const dirty = useDirty({ recipeId, portions })
  const add = useCommand(addMeal, { onSuccess: onClose, onError: notifyFailure })
  const changePortions = useCommand(setMealPortions, { onSuccess: onClose, onError: notifyFailure })

  const recipes = useRecipeOptions(!meal)

  const canSave = isPortions(portions) && (!!meal || !!recipeId)
  const save = () => {
    if (!isPortions(portions)) return
    if (meal) changePortions.mutate({ id: meal.id, portions })
    else if (recipeId) add.mutate({ ...target, recipe_id: recipeId, portions, position })
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={meal ? 'Change portions' : `Add to ${target.slot}, ${target.date}`} fullScreen={isMobile}>
      <Stack>
        {recipes.error && <Alert color="red">{recipes.error.message}</Alert>}
        {!meal &&
          (recipes.isPending ? (
            <Loader />
          ) : (
            <Select
              label="Recipe"
              searchable
              data={recipes.data?.map((r) => ({ value: r.id, label: r.name })) ?? []}
              value={recipeId}
              onChange={(id) => {
                setRecipeId(id)
                const serves = recipes.data?.find((r) => r.id === id)?.serves
                if (serves) setPortions(serves)
              }}
            />
          ))}
        <Stepper
          label="Portions"
          min={1}
          step={1}
          allowDecimal={false}
          value={portions}
          onChange={setPortions}
          error={isPortions(portions) ? undefined : 'Whole number, 1 or more'}
        />
        <Button disabled={!canSave} loading={add.isPending || changePortions.isPending} onClick={save}>Save</Button>
      </Stack>
    </GuardedModal>
  )
}

/** Move a meal to another date and slot, or copy it there. */
export function MoveCopyModal({
  mode,
  meal,
  slots,
  position,
  onClose,
}: {
  mode: 'move' | 'copy'
  meal: { id: string; date: string; slot: string; recipe_id: string | null; portions: number }
  slots: string[]
  position: (t: Target) => number
  onClose: () => void
}) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [date, setDate] = useState<string | null>(meal.date)
  const [slot, setSlot] = useState<string | null>(meal.slot)
  const dirty = useDirty({ date, slot })
  const move = useCommand(moveMeal, { onSuccess: onClose, onError: notifyFailure })
  const copy = useCommand(addMeal, { onSuccess: onClose, onError: notifyFailure })

  const save = () => {
    if (!date || !slot) return
    const to = { date, slot, position: position({ date, slot }) }
    if (mode === 'move') move.mutate({ id: meal.id, to })
    else copy.mutate({ ...to, recipe_id: meal.recipe_id, portions: meal.portions })
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={mode === 'move' ? 'Move to…' : 'Copy to…'} fullScreen={isMobile}>
      <Stack>
        <DatePickerInput label="Date" firstDayOfWeek={1} value={date} onChange={setDate} />
        <Input.Wrapper label="Slot">
          <SegmentedControl fullWidth orientation={slots.length > 3 ? 'vertical' : 'horizontal'} data={slots.includes(meal.slot) ? slots : [...slots, meal.slot]} value={slot ?? ''} onChange={setSlot} />
        </Input.Wrapper>
        <Button disabled={!date || !slot} loading={move.isPending || copy.isPending} onClick={save}>
          {mode === 'move' ? 'Move' : 'Copy'}
        </Button>
      </Stack>
    </GuardedModal>
  )
}

export function SlotsModal({ slots, onClose }: { slots: string[]; onClose: () => void }) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [value, setValue] = useState(slots)
  const dirty = useDirty(value)
  const write = useCommand(saveSlots, { onSuccess: onClose, onError: notifyFailure })
  const clean = [...new Set(value.map((s) => s.trim()).filter(Boolean))]

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title="Slots" fullScreen={isMobile}>
      <Stack>
        <TagsInput label="Slots, in day order" value={value} onChange={setValue} />
        {clean.length === 0 && <Text size="sm" c="red">Keep at least one slot.</Text>}
        <Button
          disabled={clean.length === 0}
          loading={write.isPending}
          onClick={() => write.mutate({ slots: clean })}
        >
          Save
        </Button>
      </Stack>
    </GuardedModal>
  )
}

/** Pick who cooks a meal, or nobody. */
export function CookModal({ meal, onClose }: { meal: { id: string; cook_id: string | null }; onClose: () => void }) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const members = useMembers()
  const [cook, setCook] = useState(meal.cook_id ?? '')
  const dirty = useDirty(cook)
  const write = useCommand(setMealCook, { onSuccess: onClose, onError: notifyFailure })
  return (
    <GuardedModal dirty={dirty} onClose={onClose} title="Who cooks?" fullScreen={isMobile}>
      <Stack>
        {members.error && <Alert color="red">{members.error.message}</Alert>}
        {members.isPending ? (
          <Loader />
        ) : (
          <Radio.Group value={cook} onChange={setCook} aria-label="Cook">
            <Stack gap="sm">
              <Radio value="" label="Nobody" size="md" />
              {members.data?.map((m) => <Radio key={m.user_id} value={m.user_id} label={memberLabel(m)} size="md" />)}
            </Stack>
          </Radio.Group>
        )}
        <Button
          loading={write.isPending}
          onClick={() => write.mutate({ id: meal.id, cookId: cook || null })}
        >
          Save
        </Button>
      </Stack>
    </GuardedModal>
  )
}
