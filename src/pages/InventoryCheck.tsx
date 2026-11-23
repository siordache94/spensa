import { useMemo, useState } from 'react'
import { ActionIcon, Alert, Button, Modal, Select, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus, IconX } from '@tabler/icons-react'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { invalidatePantry, usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'
import type { Batch, Day } from '../domain/replay.ts'
import './inventory.css'

type Ingredient = Tables<'ingredients'>
type Group = { ingredient: Ingredient; rows: { batch: Batch; amount: number }[] }

type Props = {
  groups: Group[] // every ingredient with batches in stock
  today: Day
  onClose: () => void
}

// One batch line. batchId null = a batch created by this check. `undo` holds the amount a removed row had.
type Line = {
  key: string
  batchId: string | null
  ingredientId: string
  qty: number | null
  expiry: Day | null
  startExpiry: Day | null
  undo?: number
}

const round3 = (n: number) => Number(n.toFixed(3))
const total = (lines: Line[]) => round3(lines.reduce((s, l) => s + (l.qty && l.qty > 0 ? l.qty : 0), 0))
const valid = (l: Line) => l.qty !== null && Number.isFinite(l.qty) && l.qty >= 0
let nextKey = 0

export default function InventoryCheck({ groups, today, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false })
  const { ingredients = [] } = usePantry()

  const [lines, setLines] = useState<Line[]>(() =>
    groups.flatMap((g) =>
      g.rows.map((r) => ({
        key: r.batch.id,
        batchId: r.batch.id,
        ingredientId: g.ingredient.id,
        qty: round3(r.amount),
        expiry: r.batch.expiresOn,
        startExpiry: r.batch.expiresOn,
      })),
    ),
  )
  // Ingredients shown as bands: those in stock, then any added here, in the order they appeared.
  const [shown, setShown] = useState<string[]>(() => groups.map((g) => g.ingredient.id))

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const addable = useMemo(
    () =>
      ingredients
        .filter((i) => i.unit !== 'to_taste' && !shown.includes(i.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ value: i.id, label: i.name })),
    [ingredients, shown],
  )

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = (i: Ingredient) => {
    setShown((s) => (s.includes(i.id) ? s : [...s, i.id]))
    setLines((ls) => [
      ...ls,
      { key: `new-${nextKey++}`, batchId: null, ingredientId: i.id, qty: i.pack_size ? Number(i.pack_size) : 1, expiry: null, startExpiry: null },
    ])
  }
  const remove = (l: Line) => {
    if (l.batchId === null) setLines((ls) => ls.filter((x) => x.key !== l.key))
    else patch(l.key, { qty: 0, undo: l.qty ?? 0 })
  }

  const ok = lines.every(valid)

  const save = useMutation({
    mutationFn: async () => {
      const items = lines.map((l) => ({
        batch_id: l.batchId,
        ingredient_id: l.ingredientId,
        qty: l.qty as number,
        expires_on: l.expiry,
      }))
      const { error } = await supabase.rpc('save_inventory_check', { on_date: today, items })
      if (error) throw new Error(error.message)
    },
    onSuccess: onClose,
    onSettled: () => invalidatePantry(queryClient),
  })

  return (
    <Modal
      opened onClose={onClose} title="Inventory check" fullScreen={isMobile} size="lg" padding={0}
      styles={{ title: { fontWeight: 700 }, header: { padding: '12px 16px' } }}
    >
      <div className="sp-inv-body">
        <Text size="sm" c="dimmed" className="sp-inv-help">
          Amounts already account for today's planned meals. Correct what's off; 0 means gone.
        </Text>
        {save.error && <Alert color="red" mx="md" mb="xs">{save.error.message}</Alert>}
        {shown.length === 0 && <Text px="md" c="dimmed">Nothing in the pantry to count. Add an item below.</Text>}

        {shown.map((id) => {
          const ing = byId.get(id) ?? groups.find((g) => g.ingredient.id === id)?.ingredient
          if (!ing) return null
          const mine = lines.filter((l) => l.ingredientId === id)
          const unit = ing.unit === 'count' ? '' : ing.unit
          return (
            <section key={id} aria-label={ing.name}>
              <div className="sp-inv-band">
                <span className="sp-inv-name">{ing.name}</span>
                {mine.length > 1 && <span className="sp-inv-total">{total(mine)}{unit && ` ${unit}`}</span>}
              </div>
              {mine.map((l) => {
                const gone = l.batchId !== null && l.qty === 0
                return (
                  <div key={l.key} className="sp-inv-row" data-removed={gone ? '' : undefined}>
                    {gone ? (
                      <>
                        <span className="sp-inv-gone">Removed</span>
                        <Button variant="subtle" size="compact-md" miw={44} mih={44} onClick={() => patch(l.key, { qty: l.undo || 1, undo: undefined })}>
                          Undo
                        </Button>
                      </>
                    ) : (
                      <>
                        <Stepper
                          value={l.qty}
                          onChange={(v) => patch(l.key, { qty: v })}
                          min={0}
                          step={amountStep(ing.unit, l.qty)}
                          allowDecimal={ing.unit !== 'count'}
                          unit={unit || undefined}
                          aria-label={`${ing.name} amount`}
                          error={valid(l) ? undefined : ' '}
                        />
                        <DatePickerInput
                          className="sp-inv-date"
                          styles={{ input: { height: 44, minHeight: 44 } }}
                          aria-label={`${ing.name} expiry`}
                          placeholder="No expiry"
                          valueFormat="D MMM"
                          firstDayOfWeek={1}
                          clearable
                          popoverProps={{ withinPortal: true }}
                          value={l.expiry}
                          onChange={(v) => patch(l.key, { expiry: v })}
                        />
                        <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Remove ${ing.name} batch`} onClick={() => remove(l)}>
                          <IconX size={20} />
                        </ActionIcon>
                      </>
                    )}
                  </div>
                )
              })}
              <div className="sp-inv-more">
                <Button variant="subtle" size="compact-md" mih={40} leftSection={<IconPlus size={16} />} onClick={() => addLine(ing)}>
                  Add another
                </Button>
              </div>
            </section>
          )
        })}

        <div className="sp-inv-add">
          <Select
            label="Add item"
            placeholder="Search ingredients"
            searchable
            data={addable}
            value={null}
            nothingFoundMessage="No other ingredients"
            comboboxProps={{ position: 'bottom', middlewares: { flip: false, shift: false } }}
            onChange={(v) => {
              const i = v ? byId.get(v) : undefined
              if (i) addLine(i)
            }}
          />
        </div>

        <div className="sp-inv-foot">
          <Button fullWidth onClick={() => save.mutate()} disabled={!ok} loading={save.isPending}>
            Save inventory check
          </Button>
        </div>
      </div>
    </Modal>
  )
}
