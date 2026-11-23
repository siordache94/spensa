import { useMemo, useState } from 'react'
import { Accordion, Alert, Badge, Button, Center, Group, Loader, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { invalidatePantry, usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables, TablesInsert } from '../lib/database.types.ts'
import { addDays, replay, stockByIngredient, type Batch, type Day } from '../domain/replay.ts'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import UseSoon from './UseSoon.tsx'
import AddBatch from './AddBatch.tsx'
import InventoryCheck from './InventoryCheck.tsx'

type Ingredient = Tables<'ingredients'>
type Row = { batch: Batch; amount: number }

const EPS = 1e-9
const round1 = (n: number) => Math.round(n * 10) / 10
const fmt = (day: Day) => dayjs(day).format('D MMM YYYY')
// Stepper gives null when empty; anything else is a number (NaN while typing "-").
const num = (v: number | null) => (v === null ? NaN : v)

const byExpiry = (a: Row, b: Row) =>
  (a.batch.expiresOn ?? '9999').localeCompare(b.batch.expiresOn ?? '9999') ||
  Date.parse(a.batch.addedAt) - Date.parse(b.batch.addedAt)

function expiryBadge(expiresOn: Day, today: Day, expiringDays: number) {
  if (expiresOn < today) return { color: 'red', text: `Expired ${fmt(expiresOn)}` }
  const soon = expiresOn <= addDays(today, expiringDays)
  return { color: soon ? 'yellow' : 'gray', text: `Expires ${fmt(expiresOn)}` }
}

export default function PantryPage() {
  const { events, ingredients, household, today: day, isPending, error } = usePantry()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)

  // Stock is replayed, never stored (src/domain/replay.ts).
  const live = useMemo(() => {
    if (!events || !day) return null
    const { remaining } = replay(events, day)
    const stock = stockByIngredient(events, remaining)
    const byIngredient = new Map<string, Row[]>()
    for (const batch of events.batches) {
      const amount = remaining.get(batch.id) ?? 0
      if (amount <= EPS) continue
      const rows = byIngredient.get(batch.ingredientId) ?? []
      rows.push({ batch, amount })
      byIngredient.set(batch.ingredientId, rows)
    }
    for (const rows of byIngredient.values()) rows.sort(byExpiry)
    return { stock, byIngredient }
  }, [events, day])

  const byName = (a: Ingredient, b: Ingredient) => a.name.localeCompare(b.name)
  const stocked = useMemo(
    () => (ingredients ?? []).filter((i) => i.unit !== 'to_taste' && (live?.stock.get(i.id) ?? 0) > 0).sort(byName),
    [ingredients, live],
  )
  const toTaste = useMemo(() => (ingredients ?? []).filter((i) => i.unit === 'to_taste').sort(byName), [ingredients])
  const nonToTaste = useMemo(() => (ingredients ?? []).filter((i) => i.unit !== 'to_taste').sort(byName), [ingredients])

  if (error) return <Alert color="red">{error.message}</Alert>
  if (isPending || !live || !day || !household || !ingredients) return <Center py="xl"><Loader /></Center>

  const needle = search.trim().toLowerCase()
  const shown = stocked.filter((i) => i.name.toLowerCase().includes(needle))
  const groups = stocked.map((i) => ({ ingredient: i, rows: live.byIngredient.get(i.id) ?? [] }))

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Title order={2}>Pantry</Title>
        <Group gap="xs" wrap="nowrap">
          <Button variant="light" onClick={() => setChecking(true)}>Inventory check</Button>
          <Button onClick={() => setAdding(true)}>Add to pantry</Button>
        </Group>
      </Group>

      <UseSoon />

      <TextInput placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      {stocked.length === 0 ? (
        <Text c="dimmed">Nothing in the pantry yet. Use Add to pantry to record what you bought.</Text>
      ) : shown.length === 0 ? (
        <Text c="dimmed">No matches.</Text>
      ) : (
        <Accordion>
          {shown.map((i) => {
            const rows = live.byIngredient.get(i.id) ?? []
            const soonest = rows[0]?.batch.expiresOn
            const badge = soonest ? expiryBadge(soonest, day, household.expiring_days) : null
            return (
              <Accordion.Item key={i.id} value={i.id}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text fw={500} truncate="end" miw={0}>{i.name}</Text>
                    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Text size="sm" c="dimmed">{round1(live.stock.get(i.id) ?? 0)} {i.unit}</Text>
                      {badge && <Badge color={badge.color} variant="light">{badge.text}</Badge>}
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <IngredientDetail ingredient={i} rows={rows} />
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      )}

      {toTaste.length > 0 && (
        <Stack gap={0}>
          <Title order={4}>To taste</Title>
          {toTaste.map((i) => <OnHandRow key={i.id} ingredient={i} />)}
        </Stack>
      )}

      {adding && <AddBatch ingredients={nonToTaste} today={day} onClose={() => setAdding(false)} />}
      {checking && <InventoryCheck groups={groups} today={day} onClose={() => setChecking(false)} />}
    </Stack>
  )
}

function IngredientDetail({ ingredient, rows }: { ingredient: Ingredient; rows: Row[] }) {
  const queryClient = useQueryClient()
  const [used, setUsed] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [discarding, setDiscarding] = useState<string | null>(null)
  const soonestId = rows[0]?.batch.id // rows are sorted soonest-expiring first

  const record = useMutation({
    mutationFn: async (row: TablesInsert<'adjustments'>) => {
      const { error } = await supabase.from('adjustments').insert(row)
      if (error) throw new Error(error.message)
    },
    onError: (e) => notifications.show({ color: 'red', message: e.message }),
    onSettled: () => invalidatePantry(queryClient),
  })

  const base = { ingredient_id: ingredient.id }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        {rows.map(({ batch, amount }) => (
          <Group key={batch.id} justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <div>
              <Text size="sm" fw={500}>{round1(amount)} {ingredient.unit}</Text>
              <Text size="xs" c="dimmed">
                added {fmt(batch.addedOn)} · {batch.expiresOn ? `expires ${fmt(batch.expiresOn)}` : 'no expiry'}
              </Text>
            </div>
            {discarding === batch.id ? (
              <Group gap="xs" wrap="nowrap">
                <Button
                  size="compact-sm"
                  color="red"
                  disabled={record.isPending}
                  onClick={() => record.mutate({ ...base, kind: 'discard', batch_id: batch.id }, { onSuccess: () => setDiscarding(null) })}
                >
                  Confirm
                </Button>
                <Button size="compact-sm" variant="default" onClick={() => setDiscarding(null)}>Keep</Button>
              </Group>
            ) : (
              <Button size="compact-sm" variant="light" color="red" onClick={() => setDiscarding(batch.id)}>
                Discard
              </Button>
            )}
          </Group>
        ))}
      </Stack>

      <Group align="flex-end" wrap="nowrap">
        <div style={{ flex: 1, minWidth: 0 }}><Stepper label="Used…" min={0} step={amountStep(ingredient.unit, used)} unit={ingredient.unit} value={used} onChange={setUsed} /></div>
        <Button
          variant="light"
          h={44}
          disabled={!(num(used) > 0) || record.isPending}
          onClick={() => record.mutate({ ...base, kind: 'used', qty: num(used), batch_id: null }, { onSuccess: () => setUsed(null) })}
        >
          Apply
        </Button>
      </Group>

      <Group align="flex-end" wrap="nowrap">
        <div style={{ flex: 1, minWidth: 0 }}><Stepper label="Set remaining…" min={0} step={amountStep(ingredient.unit, remaining)} unit={ingredient.unit} value={remaining} onChange={setRemaining} /></div>
        <Button
          variant="light"
          h={44}
          disabled={!(num(remaining) >= 0) || !soonestId || record.isPending}
          onClick={() => {
            if (!soonestId) return
            record.mutate({ ...base, kind: 'set', qty: num(remaining), batch_id: soonestId }, { onSuccess: () => setRemaining(null) })
          }}
        >
          Apply
        </Button>
      </Group>

      <Button
        variant="light"
        disabled={!soonestId || record.isPending}
        onClick={() => {
          if (!soonestId) return
          record.mutate({ ...base, kind: 'finished', batch_id: soonestId })
        }}
      >
        Finished
      </Button>
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
