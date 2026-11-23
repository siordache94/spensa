import { useState, type FormEvent } from 'react'
import { Alert, Button, Center, CloseButton, Group, Input, Loader, SegmentedControl, Select, Stack, TagsInput, Text, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { createIngredient, useIngredients, type Ingredient } from '../lib/api/ingredients.ts'
import { saveRecipe, type Recipe } from '../lib/api/recipes.ts'
import { useCommand } from '../lib/api/command.ts'

type Unit = Ingredient['unit']

const SERVES = [1, 2, 3, 4, 6, 8]

const UNITS: { value: Unit; label: string }[] = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
  { value: 'count', label: 'count' },
  { value: 'to_taste', label: 'to taste' },
]

// One recipe line. amount is for `serves` servings, as typed; null when empty.
type Line = {
  key: number
  ingredientId: string | null
  amount: number | null
  query: string // the Select's search text
  creating: boolean // inline picker for a new ingredient is open
  newUnit: Unit
}

let lastKey = 0
function newLine(patch: Partial<Line> = {}): Line {
  return { key: ++lastKey, ingredientId: null, amount: null, query: '', creating: false, newUnit: 'g', ...patch }
}

type Props = {
  recipe: Recipe | null // null = adding
  onClose: () => void
}

export default function RecipeForm({ recipe, onClose }: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })

  const [name, setName] = useState(recipe?.name ?? '')
  const [tags, setTags] = useState<string[]>(recipe?.tags ?? [])
  const [serves, setServes] = useState(recipe?.serves ?? 2)
  const [instructions, setInstructions] = useState(recipe?.instructions ?? '')
  const [lines, setLines] = useState<Line[]>(() =>
    recipe
      ? recipe.recipe_ingredients.map((ri) => newLine({
          ingredientId: ri.ingredient_id,
          amount: ri.qty_per_portion === null ? null : Math.round(ri.qty_per_portion * recipe.serves * 1000) / 1000,
        }))
      : [],
  )

  const dirty = useDirty({ name, tags, serves, instructions, lines: lines.map((l) => [l.ingredientId, l.amount]) })

  const ingredientsQuery = useIngredients()
  const ingredients = ingredientsQuery.data ?? []
  const unitOf = (id: string | null) => ingredients.find((i) => i.id === id)?.unit

  const addIngredient = useCommand(createIngredient)

  const save = useCommand(saveRecipe, { onSuccess: onClose })

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key))
  }

  const ids = lines.map((l) => l.ingredientId)
  const noDuplicates = new Set(ids).size === ids.length
  const linesComplete = lines.every((l) =>
    l.ingredientId !== null &&
    (unitOf(l.ingredientId) === 'to_taste' || (typeof l.amount === 'number' && l.amount > 0)),
  )
  const canSave = name.trim() !== '' && noDuplicates && linesComplete && !ingredientsQuery.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    save.mutate({
      id: recipe?.id ?? null,
      name: name.trim(),
      instructions,
      tags,
      serves,
      lines: lines.map((line) => ({
        ingredient_id: line.ingredientId ?? '',
        qty_per_portion: unitOf(line.ingredientId) === 'to_taste' ? null : Number(line.amount) / serves,
      })),
    })
  }

  const failure = save.error?.message ?? addIngredient.error?.message ?? ingredientsQuery.error?.message

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={recipe ? 'Edit recipe' : 'Add recipe'} fullScreen={isMobile}>
      <form onSubmit={submit}>
        <Stack>
          {failure && <Alert color="red">{failure}</Alert>}

          <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} />

          <TagsInput label="Tags" placeholder="Type and press Enter" value={tags} onChange={setTags} clearable />

          <Input.Wrapper label={`Amounts below are for ${serves} servings`}>
            <SegmentedControl
              fullWidth
              data={SERVES.map(String)}
              value={String(serves)}
              onChange={(value) => setServes(Number(value))}
            />
          </Input.Wrapper>

          <Text fw={500} mt="xs">Ingredients</Text>
          {ingredientsQuery.isPending ? (
            <Center py="md"><Loader /></Center>
          ) : (
            <Stack gap="sm">
              {lines.map((line) => {
                const unit = unitOf(line.ingredientId)
                const used = new Set(lines.map((l) => l.ingredientId))
                const options = ingredients
                  .filter((i) => !used.has(i.id) || i.id === line.ingredientId)
                  .map((i) => ({ value: i.id, label: i.name }))
                const q = line.query.trim()
                const matches = ingredients.some((i) => i.name.toLowerCase().includes(q.toLowerCase()))
                const offerCreate = line.ingredientId === null && q !== '' && !matches

                return (
                  <Stack key={line.key} gap={6}>
                    <Group wrap="nowrap" gap="xs" align="flex-start">
                      <Select
                        aria-label="Ingredient"
                        placeholder="Ingredient"
                        searchable
                        clearable
                        data={options}
                        value={line.ingredientId}
                        searchValue={line.query}
                        onSearchChange={(query) => updateLine(line.key, { query })}
                        onChange={(ingredientId) => updateLine(line.key, { ingredientId, query: '' })}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <CloseButton aria-label="Remove ingredient" size={36} mt={4} onClick={() => removeLine(line.key)} />
                    </Group>

                    {unit && unit !== 'to_taste' && (
                      <Stepper
                        aria-label="Amount"
                        min={amountStep(unit, 0)}
                        step={amountStep(unit, line.amount)}
                        unit={unit}
                        value={line.amount}
                        onChange={(amount) => updateLine(line.key, { amount })}
                        error={line.amount !== null && !(line.amount > 0) ? 'Must be more than 0' : undefined}
                      />
                    )}

                    {offerCreate && !line.creating && (
                      <Button variant="light" size="xs" w="fit-content" onClick={() => updateLine(line.key, { creating: true, newUnit: 'g' })}>
                        Create “{q}”
                      </Button>
                    )}

                    {line.creating && (
                      <Stack gap="xs">
                        <SegmentedControl
                          fullWidth
                          size="xs"
                          data={UNITS}
                          value={line.newUnit}
                          onChange={(value) => updateLine(line.key, { newUnit: value as Unit })}
                        />
                        <Group gap="xs">
                          <Button
                            size="xs"
                            loading={addIngredient.isPending}
                            onClick={() =>
                              addIngredient.mutate({ name: q, unit: line.newUnit }, {
                                onSuccess: (ingredientId) => updateLine(line.key, {
                                  ingredientId,
                                  query: '',
                                  creating: false,
                                }),
                              })
                            }
                          >
                            Create
                          </Button>
                          <Button size="xs" variant="default" onClick={() => updateLine(line.key, { creating: false })}>
                            Cancel
                          </Button>
                        </Group>
                      </Stack>
                    )}
                  </Stack>
                )
              })}
              <Button variant="default" onClick={() => setLines((ls) => [...ls, newLine()])}>Add ingredient</Button>
            </Stack>
          )}

          <Textarea
            label="Instructions"
            placeholder="Markdown is fine"
            autosize
            minRows={6}
            value={instructions}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />

          <Button type="submit" disabled={!canSave} loading={save.isPending}>Save</Button>
        </Stack>
      </form>
    </GuardedModal>
  )
}
