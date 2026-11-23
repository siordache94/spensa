import { useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Button, Input, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'
import type { Tables, TablesInsert } from '../lib/database.types.ts'

type Ingredient = Tables<'ingredients'>
type Unit = Ingredient['unit']

const UNITS: { value: Unit; label: string }[] = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
  { value: 'count', label: 'count' },
  { value: 'to_taste', label: 'to taste' },
]

const DEFAULT_CATEGORIES = ['produce', 'dairy', 'meat', 'fish', 'dry goods', 'frozen', 'other']


type Props = {
  ingredient: Ingredient | null // null = adding
  categories: string[] // categories already used in the household
  onClose: () => void
}

export default function IngredientForm({ ingredient, categories, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })

  const [name, setName] = useState(ingredient?.name ?? '')
  const [unit, setUnit] = useState<Unit>(ingredient?.unit ?? 'g')
  const [category, setCategory] = useState(ingredient?.category ?? '')
  const [pack, setPack] = useState<number | null>(ingredient?.pack_size ?? null)
  const [shelf, setShelf] = useState<number | null>(ingredient?.shelf_life_days ?? null)
  const [min, setMin] = useState<number | null>(ingredient?.min_stock ?? null)
  const [confirming, setConfirming] = useState(false)

  const dirty = useDirty({ name, unit, category, pack, shelf, min })

  const usage = useQuery({
    queryKey: ['ingredient-usage', ingredient?.id],
    enabled: ingredient !== null,
    queryFn: async () => {
      if (!ingredient) return []
      const { data, error } = await supabase
        .from('recipe_ingredients')
        .select('recipes(name)')
        .eq('ingredient_id', ingredient.id)
      if (error) throw error
      return data.map((row) => row.recipes.name)
    },
  })
  const usedIn = usage.data ?? []
  const inUse = usedIn.length > 0

  const toTaste = unit === 'to_taste'
  const packValue = pack
  const shelfValue = shelf
  const minValue = min
  const packError = packValue !== null && !(packValue > 0) ? 'Must be more than 0' : undefined
  const shelfError = shelfValue !== null && !(Number.isInteger(shelfValue) && shelfValue > 0) ? 'Whole days, more than 0' : undefined
  const minError = minValue !== null && !(minValue >= 0) ? 'Must be 0 or more' : undefined
  const invalidNumbers = !toTaste && !!(packError || shelfError || minError)
  const canSave = name.trim() !== '' && !invalidNumbers

  const save = useMutation({
    mutationFn: async (row: TablesInsert<'ingredients'>) => {
      const { error } = ingredient
        ? await supabase.from('ingredients').update(row).eq('id', ingredient.id)
        : await supabase.from('ingredients').insert(row)
      if (error?.code === '23505') throw new Error('An ingredient with this name already exists.')
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!ingredient) return
      const { error } = await supabase.from('ingredients').delete().eq('id', ingredient.id)
      if (error?.code === '23503') throw new Error('Remove it from these recipes to delete it.')
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      onClose()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    save.mutate({
      name: name.trim(),
      unit,
      category: category.trim() || null,
      pack_size: toTaste ? null : packValue,
      shelf_life_days: toTaste ? null : shelfValue,
      min_stock: toTaste ? null : minValue,
    })
  }

  const suffix = toTaste ? undefined : unit
  const failure = save.error?.message ?? remove.error?.message ?? usage.error?.message

  return (
    <GuardedModal
      dirty={dirty}
      onClose={onClose}
      title={ingredient ? 'Edit ingredient' : 'Add ingredient'}
      fullScreen={isMobile}
    >
      <form onSubmit={submit}>
        <Stack>
          {failure && <Alert color="red">{failure}</Alert>}

          <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} />

          <Input.Wrapper label="Unit">
            <SegmentedControl
              fullWidth
              data={UNITS}
              value={unit}
              onChange={(value) => setUnit(value as Unit)}
              disabled={inUse}
              aria-describedby={inUse ? 'unit-locked' : undefined}
            />
            {inUse && (
              <Text id="unit-locked" size="sm" c="dimmed" mt={6}>
                Locked: used in {usedIn.length} {usedIn.length === 1 ? 'recipe' : 'recipes'}. Remove it from {usedIn.length === 1 ? 'that recipe' : 'those recipes'} to change the unit.
              </Text>
            )}
          </Input.Wrapper>

          <Autocomplete
            label="Category"
            placeholder="None"
            data={[...DEFAULT_CATEGORIES, ...categories.filter((c) => !DEFAULT_CATEGORIES.includes(c))]}
            value={category}
            onChange={setCategory}
          />

          {!toTaste && (
            <>
              <Stepper label="Pack size" description="Optional" min={0} step={amountStep(unit, pack)} unit={suffix} value={pack} onChange={setPack} error={packError} />
              <Stepper label="Shelf life" description="Optional" min={0} step={1} unit="days" allowDecimal={false} value={shelf} onChange={setShelf} error={shelfError} />
              <Stepper label="Min stock" description="Optional" min={0} step={amountStep(unit, min)} unit={suffix} value={min} onChange={setMin} error={minError} />
            </>
          )}

          {ingredient && (
            <Text size="sm">
              <Text component="span" fw={500}>Used in: </Text>
              {usage.isPending ? 'Loading…' : usedIn.length > 0 ? usedIn.join(', ') : 'No recipes yet.'}
            </Text>
          )}

          <Stack gap="xs" mt="xs">
            {ingredient && (confirming ? (
              <Button.Group>
                <Button color="red" fullWidth loading={remove.isPending} onClick={() => remove.mutate()}>Delete for good</Button>
                <Button variant="default" fullWidth onClick={() => setConfirming(false)}>Keep</Button>
              </Button.Group>
            ) : (
              <Button color="red" variant="light" disabled={inUse || usage.isPending} onClick={() => setConfirming(true)}>
                Delete
              </Button>
            ))}
            {ingredient && inUse && <Text size="sm" c="dimmed">Remove it from these recipes to delete it.</Text>}
            <Button type="submit" disabled={!canSave} loading={save.isPending}>Save</Button>
          </Stack>
        </Stack>
      </form>
    </GuardedModal>
  )
}
