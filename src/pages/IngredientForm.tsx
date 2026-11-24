import { useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Button, Group, Input, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconLock } from '@tabler/icons-react'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { useCommand } from '../lib/api/command.ts'
import { deleteIngredient, saveIngredient, useIngredientUsage, type Ingredient } from '../lib/api/ingredients.ts'

type Unit = Ingredient['unit']

const UNITS: { value: Unit; label: string }[] = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
  { value: 'count', label: 'count' },
  { value: 'to_taste', label: 'to taste' },
]

const DEFAULT_CATEGORIES = ['produce', 'dairy', 'meat', 'fish', 'dry goods', 'frozen', 'other']

// Blank and 0 both mean none (the DB stores null); say it once, next to every optional number.
const BLANK_RULE = 'Optional · leave blank or 0 for none'


type Props = {
  ingredient: Ingredient | null // null = adding
  categories: string[] // categories already used in the household
  onClose: () => void
  /** The ingredient was deleted: the list offers an Undo toast for it. */
  onDeleted: (ingredient: Ingredient) => void
}

export default function IngredientForm({ ingredient, categories, onClose, onDeleted }: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })

  const [name, setName] = useState(ingredient?.name ?? '')
  const [unit, setUnit] = useState<Unit>(ingredient?.unit ?? 'g')
  const [category, setCategory] = useState(ingredient?.category ?? '')
  const [pack, setPack] = useState<number | null>(ingredient?.pack_size ?? null)
  const [shelf, setShelf] = useState<number | null>(ingredient?.shelf_life_days ?? null)
  const [min, setMin] = useState<number | null>(ingredient?.min_stock ?? null)
  const [confirming, setConfirming] = useState(false)

  const dirty = useDirty({ name, unit, category, pack, shelf, min })

  const usage = useIngredientUsage(ingredient?.id)
  const usedIn = usage.data ?? []
  const inUse = usedIn.length > 0

  const toTaste = unit === 'to_taste'
  // optional fields: 0 means "none", the DB only accepts > 0 or null
  const packValue = pack === 0 ? null : pack
  const shelfValue = shelf === 0 ? null : shelf
  const minValue = min
  const packError = packValue !== null && !(packValue > 0) ? 'Must be more than 0' : undefined
  const shelfError = shelfValue !== null && !(Number.isInteger(shelfValue) && shelfValue > 0) ? 'Whole days, more than 0' : undefined
  const minError = minValue !== null && !(minValue >= 0) ? 'Must be 0 or more' : undefined
  const invalidNumbers = !toTaste && !!(packError || shelfError || minError)
  const canSave = name.trim() !== '' && !invalidNumbers

  const save = useCommand(saveIngredient, { onSuccess: onClose })
  // Deleted, not gone for good: the list shows an Undo toast (ADR 0003).
  const remove = useCommand(deleteIngredient, {
    onSuccess: () => { if (ingredient) onDeleted(ingredient); onClose() },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    save.mutate({ id: ingredient?.id ?? null, row: {
      name: name.trim(),
      unit,
      category: category.trim() || null,
      pack_size: toTaste ? null : packValue,
      shelf_life_days: toTaste ? null : shelfValue,
      min_stock: toTaste ? null : minValue,
    } })
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

          {/* The reason is on screen, not behind a tap on a control that looks disabled (MR-045). */}
          <Input.Wrapper
            label={(
              <Group component="span" gap={4} wrap="nowrap">
                <span>Unit</span>
                {inUse && <IconLock size={14} stroke={1.75} aria-hidden />}
              </Group>
            )}
            description={inUse
              ? `Locked: used in ${usedIn.length === 1 ? 'a recipe' : `${usedIn.length} recipes`}. Remove it from ${usedIn.length === 1 ? 'that recipe' : 'them'} to change the unit.`
              : undefined}
          >
            <SegmentedControl fullWidth data={UNITS} value={unit} onChange={(value) => setUnit(value as Unit)} disabled={inUse} />
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
              <Stepper label="Pack size" description={BLANK_RULE} min={0} step={amountStep(unit, pack)} unit={suffix} value={pack} onChange={setPack} error={packError} />
              <Stepper label="Shelf life" description={BLANK_RULE} min={0} step={1} unit="days" allowDecimal={false} value={shelf} onChange={setShelf} error={shelfError} />
              <Stepper label="Min stock" description={BLANK_RULE} min={0} step={amountStep(unit, min)} unit={suffix} value={min} onChange={setMin} error={minError} />
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
                <Button color="red" fullWidth loading={remove.isPending} onClick={() => ingredient && remove.mutate({ id: ingredient.id })}>Delete</Button>
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
