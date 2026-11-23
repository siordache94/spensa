import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Button, Center, Group, Loader, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus, IconX } from '@tabler/icons-react'
import { invalidatePantry, usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'
import { addDays, replay, stockByIngredient, type Day } from '../domain/replay.ts'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import UseSoon from './UseSoon.tsx'
import './pantry.css'

type Ingredient = Tables<'ingredients'>

// One batch line. batchId null = a batch created by this check. `undo` holds the amount a removed row had.
type Line = {
  key: string
  batchId: string | null
  ingredientId: string
  qty: number | null
  expiry: Day | null
  undo?: number
}
type Draft = { lines: Line[]; shown: string[] }

const EPS = 1e-9
const round3 = (n: number) => Number(n.toFixed(3))
const total = (lines: Line[]) => round3(lines.reduce((s, l) => s + (l.qty && l.qty > 0 ? l.qty : 0), 0))
const valid = (l: Line) => l.qty !== null && Number.isFinite(l.qty) && l.qty >= 0
let nextKey = 0

function hint(expiry: Day, today: Day, expiringDays: number) {
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000)
  if (days < 0) return { expired: true, text: 'Expired' }
  if (expiry > addDays(today, expiringDays)) return null
  return { expired: false, text: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}` }
}

export default function PantryPage() {
  const queryClient = useQueryClient()
  const { events, ingredients, household, today: day, isPending, error } = usePantry()
  const [search, setSearch] = useState('')
  // null = untouched: show the server state. Once edited, the draft wins and refetches are ignored.
  const [draft, setDraft] = useState<Draft | null>(null)

  // Stock is replayed, never stored (src/domain/replay.ts).
  const base = useMemo<Draft | null>(() => {
    if (!events || !day) return null
    const { remaining } = replay(events, day)
    const stock = stockByIngredient(events, remaining)
    const lines: Line[] = []
    const shown: string[] = []
    for (const i of [...(ingredients ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (i.unit === 'to_taste' || (stock.get(i.id) ?? 0) <= 0) continue
      shown.push(i.id)
      events.batches
        .filter((b) => b.ingredientId === i.id && (remaining.get(b.id) ?? 0) > EPS)
        .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || Date.parse(a.addedAt) - Date.parse(b.addedAt))
        .forEach((b) => lines.push({ key: b.id, batchId: b.id, ingredientId: i.id, qty: round3(remaining.get(b.id) ?? 0), expiry: b.expiresOn }))
    }
    return { lines, shown }
  }, [events, ingredients, day])

  const view = draft ?? base
  const dirty = draft !== null
  const edit = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d ?? base!))
  const patch = (key: string, p: Partial<Line>) => edit((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }))
  const addLine = (i: Ingredient) =>
    edit((d) => ({
      shown: d.shown.includes(i.id) ? d.shown : [...d.shown, i.id],
      lines: [...d.lines, { key: `new-${nextKey++}`, batchId: null, ingredientId: i.id, qty: i.pack_size ? Number(i.pack_size) : 1, expiry: null }],
    }))
  const remove = (l: Line) =>
    l.batchId === null ? edit((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) })) : patch(l.key, { qty: 0, undo: l.qty ?? 0 })

  const save = useMutation({
    mutationFn: async () => {
      // A snapshot zeroes any batch it omits, so keep batches the partner added while this draft was open.
      const known = new Set(view!.lines.map((l) => l.batchId))
      const added = base?.lines.filter((l) => l.batchId && !known.has(l.batchId)) ?? []
      const items = [...view!.lines, ...added].map((l) => ({ batch_id: l.batchId, ingredient_id: l.ingredientId, qty: l.qty as number, expires_on: l.expiry }))
      const { error } = await supabase.rpc('save_inventory_check', { on_date: day!, items })
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await invalidatePantry(queryClient)
      setDraft(null)
    },
  })

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id, i])), [ingredients])
  const toTaste = useMemo(() => (ingredients ?? []).filter((i) => i.unit === 'to_taste').sort((a, b) => a.name.localeCompare(b.name)), [ingredients])

  if (error) return <Alert color="red">{error.message}</Alert>
  if (isPending || !view || !day || !household || !ingredients) return <Center py="xl"><Loader /></Center>

  const needle = search.trim().toLowerCase()
  const addable = ingredients
    .filter((i) => i.unit !== 'to_taste' && !view.shown.includes(i.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ value: i.id, label: i.name }))
  const visible = view.shown.filter((id) => byId.get(id)?.name.toLowerCase().includes(needle))

  return (
    <Stack className="sp-pantry">
      <Title order={2}>Pantry</Title>

      <UseSoon />

      <TextInput placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      <div className="sp-inv-body" data-dirty={dirty ? '' : undefined}>
        <Text size="sm" c="dimmed" className="sp-inv-help">
          Amounts already account for today's planned meals. Correct what's off; 0 means gone.
        </Text>
        {save.error && <Alert color="red" mx="md" mb="xs">{save.error.message}</Alert>}
        {view.shown.length === 0 && <Text px="md" c="dimmed">Nothing in the pantry yet. Add an item below.</Text>}
        {view.shown.length > 0 && visible.length === 0 && <Text px="md" c="dimmed">No matches.</Text>}

        {visible.map((id) => {
          const ing = byId.get(id)!
          const mine = view.lines.filter((l) => l.ingredientId === id)
          const unit = ing.unit === 'count' ? '' : ing.unit
          return (
            <section key={id} aria-label={ing.name}>
              <div className="sp-inv-band">
                <span className="sp-inv-name">{ing.name}</span>
                {mine.length > 1 && <span className="sp-inv-total">{total(mine)}{unit && ` ${unit}`}</span>}
              </div>
              {mine.map((l) => {
                const gone = l.batchId !== null && l.qty === 0
                const h = !gone && l.expiry ? hint(l.expiry, day, household.expiring_days) : null
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
                        {h && <span className="sp-inv-hint" data-expired={h.expired ? '' : undefined}>{h.text}</span>}
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
      </div>

      {toTaste.length > 0 && (
        <Stack gap={0}>
          <Title order={4}>To taste</Title>
          {toTaste.map((i) => <OnHandRow key={i.id} ingredient={i} />)}
        </Stack>
      )}

      {dirty && (
        <div className="sp-savebar" role="region" aria-label="Unsaved changes">
          <Button onClick={() => save.mutate()} disabled={!view.lines.every(valid)} loading={save.isPending}>Save changes</Button>
          <Button variant="default" onClick={() => { setDraft(null); save.reset() }} disabled={save.isPending}>Discard</Button>
        </div>
      )}
    </Stack>
  )
}

function OnHandRow({ ingredient }: { ingredient: Ingredient }) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: async (onHand: boolean) => {
      const { error } = await supabase.from('ingredients').update({ on_hand: onHand }).eq('id', ingredient.id)
      if (error) throw new Error(error.message)
    },
    onError: (e) => notifications.show({ color: 'red', message: e.message }),
    onSettled: () => invalidatePantry(queryClient),
  })
  const onHand = toggle.isPending ? !!toggle.variables : ingredient.on_hand

  return (
    <Group justify="space-between" wrap="nowrap" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      <Text fw={500} truncate="end" miw={0}>{ingredient.name}</Text>
      <Switch checked={onHand} label={onHand ? 'On hand' : 'Out'} onChange={(e) => toggle.mutate(e.currentTarget.checked)} />
    </Group>
  )
}
