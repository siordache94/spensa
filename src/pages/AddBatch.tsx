import { useState } from 'react'
import { Alert, Button, Select, Stack } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidatePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables, TablesInsert } from '../lib/database.types.ts'
import { addDays, type Day } from '../domain/replay.ts'

type Ingredient = Tables<'ingredients'>

type Props = {
  ingredients: Ingredient[] // non-to_taste, sorted by name
  today: Day
  onClose: () => void
}

// Stepper gives null when empty; anything else is a number (NaN while typing "-").
const num = (v: number | null) => (v === null ? NaN : v)

export default function AddBatch({ ingredients, today, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const [ingredientId, setIngredientId] = useState<string | null>(null)
  const [qty, setQty] = useState<number | null>(null)
  const [expiry, setExpiry] = useState<string | null>(null)

  const dirty = useDirty({ ingredientId, qty, expiry })
  const selected = ingredients.find((i) => i.id === ingredientId)
  const qtyValue = num(qty)

  // Picking an ingredient pre-fills pack size and expiry from its settings.
  function pick(id: string | null) {
    const i = ingredients.find((x) => x.id === id)
    setIngredientId(id)
    setQty(i?.pack_size ?? null)
    setExpiry(i?.shelf_life_days ? addDays(today, i.shelf_life_days) : null)
  }

  const add = useMutation({
    mutationFn: async (row: TablesInsert<'batches'>) => {
      const { error } = await supabase.from('batches').insert(row)
      if (error) throw new Error(error.message)
    },
    onSuccess: onClose,
    onSettled: () => invalidatePantry(queryClient),
  })

  function submit() {
    if (!ingredientId || !(qtyValue > 0)) return
    add.mutate({
      ingredient_id: ingredientId,
      qty: qtyValue,
      expires_on: expiry,
    })
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title="Add to pantry" fullScreen={isMobile}>
      <Stack>
        {add.error && <Alert color="red">{add.error.message}</Alert>}

        <Select
          label="Ingredient"
          placeholder="Pick one"
          searchable
          required
          data={ingredients.map((i) => ({ value: i.id, label: i.name }))}
          value={ingredientId}
          onChange={pick}
        />
        <Stepper
          label="Quantity"
          min={amountStep(selected?.unit, 0)}
          step={amountStep(selected?.unit, qty)}
          unit={selected?.unit}
          value={qty}
          onChange={setQty}
          error={qty !== null && !(qty > 0) ? 'Must be more than 0' : undefined}
        />
        <DatePickerInput
          label="Expires"
          placeholder="Optional"
          clearable
          value={expiry}
          onChange={setExpiry}
        />

        <Button onClick={submit} disabled={!ingredientId || !(qtyValue > 0)} loading={add.isPending}>
          Add
        </Button>
      </Stack>
    </GuardedModal>
  )
}
