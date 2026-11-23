import { useState } from 'react'
import { Alert, Button, Loader, Modal, NumberInput, Select, Stack, TagsInput, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidatePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'

/** Runs a Supabase write, refreshes the pantry, reports failures in a notification. */
export function useWrite(onDone?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (write: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await write
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      invalidatePantry(queryClient)
      onDone?.()
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Could not save', message: e.message }),
  })
}

const isPortions = (v: number | string) => typeof v === 'number' && Number.isInteger(v) && v >= 1

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
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [portions, setPortions] = useState<number | string>(meal?.portions ?? 2)
  const write = useWrite(onClose)

  const recipes = useQuery({
    queryKey: ['recipes', 'options'],
    enabled: !meal,
    queryFn: async () => {
      const { data, error } = await supabase.from('recipes').select('id, name, serves').order('name')
      if (error) throw error
      return data
    },
  })

  const canSave = isPortions(portions) && (!!meal || !!recipeId)
  const save = () => {
    if (!isPortions(portions)) return
    if (meal) write.mutate(supabase.from('planned_meals').update({ portions: Number(portions) }).eq('id', meal.id))
    else if (recipeId) {
      write.mutate(
        supabase.from('planned_meals').insert({ ...target, recipe_id: recipeId, portions: Number(portions), position }),
      )
    }
  }

  return (
    <Modal opened onClose={onClose} title={meal ? 'Change portions' : `Add to ${target.slot}, ${target.date}`} fullScreen={isMobile}>
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
        <NumberInput
          label="Portions"
          min={1}
          allowDecimal={false}
          value={portions}
          onChange={setPortions}
          error={isPortions(portions) ? undefined : 'Whole number, 1 or more'}
        />
        <Button disabled={!canSave} loading={write.isPending} onClick={save}>Save</Button>
      </Stack>
    </Modal>
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
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [date, setDate] = useState<string | null>(meal.date)
  const [slot, setSlot] = useState<string | null>(meal.slot)
  const write = useWrite(onClose)

  const save = () => {
    if (!date || !slot) return
    const to = { date, slot, position: position({ date, slot }) }
    write.mutate(
      mode === 'move'
        ? supabase.from('planned_meals').update(to).eq('id', meal.id)
        : supabase.from('planned_meals').insert({ ...to, recipe_id: meal.recipe_id, portions: meal.portions }),
    )
  }

  return (
    <Modal opened onClose={onClose} title={mode === 'move' ? 'Move to…' : 'Copy to…'} fullScreen={isMobile}>
      <Stack>
        <DatePickerInput label="Date" firstDayOfWeek={1} value={date} onChange={setDate} />
        <Select label="Slot" data={slots} value={slot} onChange={setSlot} allowDeselect={false} />
        <Button disabled={!date || !slot} loading={write.isPending} onClick={save}>
          {mode === 'move' ? 'Move' : 'Copy'}
        </Button>
      </Stack>
    </Modal>
  )
}

export function SlotsModal({ slots, onClose }: { slots: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [value, setValue] = useState(slots)
  const write = useWrite(() => {
    queryClient.invalidateQueries({ queryKey: ['household', 'settings'] })
    onClose()
  })
  const clean = [...new Set(value.map((s) => s.trim()).filter(Boolean))]

  return (
    <Modal opened onClose={onClose} title="Slots" fullScreen={isMobile}>
      <Stack>
        <TagsInput label="Slots, in day order" value={value} onChange={setValue} />
        {clean.length === 0 && <Text size="sm" c="red">Keep at least one slot.</Text>}
        <Button
          disabled={clean.length === 0}
          loading={write.isPending}
          // household_id is not needed: RLS limits the update to the member's own household row
          onClick={() => write.mutate(supabase.from('households').update({ slots: clean }).not('id', 'is', null))}
        >
          Save
        </Button>
      </Stack>
    </Modal>
  )
}
