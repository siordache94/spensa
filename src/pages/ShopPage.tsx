import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Badge, Button, Center, Checkbox, Group, Loader, Modal, NumberInput, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { DatePickerInput, type DateValue } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { invalidatePantry, usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'
import { BUY_KEY, CHECK_KEY, ON_HAND_KEY, SHOP_KEY, type Buy as BuyVars } from '../lib/shopMutations.ts'
import { addDays, replay, shoppingList, type Need } from '../domain/replay.ts'

type Unit = Tables<'ingredients'>['unit']

// What the UI builds; ticking adds the batch id and time (see shopMutations.ts).
type Buy = Omit<BuyVars, 'batchId' | 'addedAt'>

// One row on the list. `buy` is set for rows with a quantity (tap the label to change it).
type Entry = {
  key: string
  name: string
  category: string | null // null = uncategorised
  detail: string | null
  buy?: Buy
  onTick: () => void
}

const withIds = (b: Buy): BuyVars => ({ ...b, batchId: crypto.randomUUID(), addedAt: new Date().toISOString() })
const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000
const dayOf = (v: DateValue) => (v ? dayjs(v).format('YYYY-MM-DD') : null)
const amount = (qty: number, unit: Unit) => (unit === 'count' ? `${round1(qty)}` : `${round1(qty)} ${unit}`)

function BuyModal({ buy, pending, onBuy, onClose }: { buy: Buy; pending: boolean; onBuy: (b: Buy) => void; onClose: () => void }) {
  const [qty, setQty] = useState<number | string>(buy.qty)
  const [expires, setExpires] = useState<DateValue>(buy.expiresOn ? dayjs(buy.expiresOn).toDate() : null)
  const qtyValue = qty === '' ? null : Number(qty)
  const qtyValid = qtyValue !== null && qtyValue > 0

  function submit() {
    if (qtyValue === null || !(qtyValue > 0)) return
    onBuy({ ...buy, qty: round3(qtyValue), expiresOn: dayOf(expires) })
  }

  return (
    <Modal opened onClose={onClose} title={buy.name}>
      <Stack>
        <NumberInput
          label="Amount"
          size="lg"
          value={qty}
          onChange={setQty}
          suffix={buy.unit === 'count' ? undefined : ` ${buy.unit}`}
          decimalScale={3}
          min={0}
          error={qty !== '' && !qtyValid ? 'Must be more than 0' : undefined}
        />
        <DatePickerInput
          label="Expires"
          size="lg"
          placeholder="No expiry"
          valueFormat="D MMM YYYY"
          clearable
          value={expires}
          onChange={setExpires}
        />
        <Button size="lg" disabled={!qtyValid} loading={pending} onClick={submit}>
          Buy
        </Button>
      </Stack>
    </Modal>
  )
}

export default function ShopPage() {
  const queryClient = useQueryClient()
  const pantry = usePantry()
  const { events, domainIngredients, ingredients, today } = pantry

  const items = useQuery({
    queryKey: ['shopping_items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopping_items')
        .select('*, ingredients(name, unit, category)')
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  // Live sync: any change from the other phone refreshes the list.
  useEffect(() => {
    const channel = supabase.channel('shopping')
    for (const table of ['batches', 'ingredients', 'shopping_items']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        invalidatePantry(queryClient)
        queryClient.invalidateQueries({ queryKey: ['shopping_items'] })
      })
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])

  const waiting = useMutationState({ filters: { mutationKey: SHOP_KEY }, select: (m) => m.state.isPaused }).filter(Boolean).length

  const [picked, setPicked] = useState<[DateValue, DateValue] | null>(null)
  const [text, setText] = useState('')
  const [buying, setBuying] = useState<Buy | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)

  const defaultRange = useMemo<[DateValue, DateValue]>(
    () => (today ? [dayjs(today).toDate(), dayjs(addDays(today, 6)).toDate()] : [null, null]),
    [today],
  )
  const range = picked ?? defaultRange
  const from = dayOf(range[0]) ?? today
  const to = dayOf(range[1]) ?? (from ? addDays(from, 6) : undefined)

  const needs = useMemo<Need[]>(
    () => (events && domainIngredients && from && to ? shoppingList(events, domainIngredients, from, to) : []),
    [events, domainIngredients, from, to],
  )

  const names = (ingredients ?? []).map((i) => i.name)

  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: ['shopping_items'] })
  const showError = (e: Error) => notifications.show({ color: 'red', message: e.message })

  const buy = useMutation<void, Error, BuyVars>({ mutationKey: BUY_KEY })
  const markOnHand = useMutation<void, Error, string>({ mutationKey: ON_HAND_KEY })
  const checkText = useMutation<void, Error, string>({ mutationKey: CHECK_KEY })
  const { mutate: mutateBuy } = buy

  const clearChecked = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('shopping_items').delete().eq('checked', true)
      if (error) throw new Error(error.message)
    },
    onSettled: () => invalidateItems(),
    onError: showError,
  })

  const addItem = useMutation({
    mutationFn: async (value: string) => {
      const match = (ingredients ?? []).find((i) => i.name.toLowerCase() === value.toLowerCase())
      const { error } = await supabase
        .from('shopping_items')
        .insert(match ? { ingredient_id: match.id } : { text: value })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => setText(''),
    onSettled: () => invalidateItems(),
    onError: showError,
  })

  const snapshot = useMutation({
    mutationFn: async () => {
      if (!events || !today) throw new Error('Still loading, try again.')
      const { remaining } = replay(events, today)
      const batches = [...remaining]
        .filter(([, qty]) => qty > 0)
        .map(([batchId, qty]) => ({ batch_id: batchId, qty: round3(qty) }))
      const { error } = await supabase.rpc('save_snapshot', { on_date: today, batches })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => setSnapshotOpen(false),
    onSettled: () => invalidatePantry(queryClient),
    onError: showError,
  })

  const { mutate: mutateOnHand } = markOnHand
  const { mutate: mutateCheck } = checkText

  const entries = useMemo<Entry[]>(() => {
    if (!ingredients || !today) return []
    const byId = new Map(ingredients.map((i) => [i.id, i]))
    const expiryFor = (shelfLifeDays: number | null) => (shelfLifeDays ? addDays(today, shelfLifeDays) : null)
    const out: Entry[] = []

    for (const n of needs) {
      const ing = byId.get(n.ingredientId)
      if (!ing) continue
      if (n.qty === null) {
        out.push({ key: `need-${n.ingredientId}`, name: ing.name, category: ing.category, detail: 'to taste', onTick: () => mutateOnHand(n.ingredientId) })
        continue
      }
      const b: Buy = {
        ingredientId: n.ingredientId,
        name: ing.name,
        unit: ing.unit,
        qty: round3(Math.max(n.qty, ing.pack_size ?? 0)),
        expiresOn: expiryFor(ing.shelf_life_days),
      }
      const packs = n.packs ? ` ≈ ${n.packs} ${n.packs === 1 ? 'pack' : 'packs'}` : ''
      out.push({
        key: `need-${n.ingredientId}`,
        name: ing.name,
        category: ing.category,
        detail: `${amount(n.qty, ing.unit)}${packs}`,
        buy: b,
        onTick: () => mutateBuy(withIds(b)),
      })
    }

    for (const item of items.data ?? []) {
      if (item.ingredient_id) {
        const ing = byId.get(item.ingredient_id)
        if (!ing || !item.ingredients) continue
        const b: Buy = {
          ingredientId: item.ingredient_id,
          name: item.ingredients.name,
          unit: item.ingredients.unit,
          qty: round3(item.qty ?? ing.pack_size ?? 1),
          expiresOn: expiryFor(ing.shelf_life_days),
          shoppingItemId: item.id,
        }
        out.push({
          key: `item-${item.id}`,
          name: item.ingredients.name,
          category: item.ingredients.category,
          detail: item.qty ? amount(item.qty, item.ingredients.unit) : null,
          buy: b,
          onTick: () => mutateBuy(withIds(b)),
        })
      } else if (!item.checked) {
        out.push({ key: `item-${item.id}`, name: item.text ?? '', category: null, detail: null, onTick: () => mutateCheck(item.id) })
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [ingredients, today, needs, items.data, mutateBuy, mutateOnHand, mutateCheck])

  const groups = useMemo(() => {
    const byCategory = new Map<string | null, Entry[]>()
    for (const e of entries) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e])
    return [...byCategory.entries()].sort(([a], [b]) => {
      if (a === null) return 1
      if (b === null) return -1
      return a.localeCompare(b)
    })
  }, [entries])

  const checkedTexts = (items.data ?? []).filter((i) => !i.ingredient_id && i.checked)
  const failure = pantry.error ?? items.error

  if (failure) return <Alert color="red">{failure.message}</Alert>
  if (pantry.isPending || items.isPending) return <Center py="xl"><Loader /></Center>

  function submitItem(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (value) addItem.mutate(value)
  }

  return (
    <Stack>
      <Title order={2}>Shop</Title>
      {waiting > 0 && <Badge color="orange" size="lg">Offline — {waiting} {waiting === 1 ? 'tick' : 'ticks'} waiting</Badge>}

      <DatePickerInput
        type="range"
        label="Days"
        size="lg"
        firstDayOfWeek={1}
        value={range}
        onChange={(v) => setPicked(v as [DateValue, DateValue])}
      />

      <form onSubmit={submitItem}>
        <Group wrap="nowrap" align="flex-end">
          <Autocomplete
            flex={1}
            size="lg"
            placeholder="Add an item"
            value={text}
            onChange={setText}
            data={names}
          />
          <Button type="submit" size="lg" loading={addItem.isPending} disabled={text.trim() === ''}>
            Add
          </Button>
        </Group>
      </form>

      {entries.length === 0 && <Text>Nothing to buy for these days.</Text>}

      {groups.map(([category, rows]) => (
        <Stack key={category ?? 'uncategorised'} gap={0}>
          <Text fw={700} size="sm" tt="uppercase" c="dimmed" mt="md">
            {category ?? 'Uncategorised'}
          </Text>
          {rows.map((e) => (
            <Group key={e.key} wrap="nowrap" gap="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Checkbox size="xl" aria-label={`Bought ${e.name}`} checked={false} onChange={() => e.onTick()} />
              <UnstyledButton flex={1} style={{ textAlign: 'left' }} onClick={() => e.buy && setBuying(e.buy)}>
                <Text fw={500} size="lg">{e.name}</Text>
                {e.detail && <Text size="sm" c="dimmed">{e.detail}</Text>}
              </UnstyledButton>
            </Group>
          ))}
        </Stack>
      ))}

      {checkedTexts.length > 0 && (
        <Stack gap={0} mt="md">
          <Group justify="space-between">
            <Text fw={700} size="sm" tt="uppercase" c="dimmed">Checked off</Text>
            <Button variant="subtle" loading={clearChecked.isPending} onClick={() => clearChecked.mutate()}>
              Clear checked
            </Button>
          </Group>
          {checkedTexts.map((i) => (
            <Text key={i.id} size="lg" td="line-through" c="dimmed" py="sm">
              {i.text}
            </Text>
          ))}
        </Stack>
      )}

      <Button size="lg" fullWidth mt="xl" variant="light" disabled={!events} onClick={() => setSnapshotOpen(true)}>
        Done shopping
      </Button>

      {buying && (
        <BuyModal key={buying.shoppingItemId ?? buying.ingredientId} buy={buying} pending={false} onBuy={(b) => { mutateBuy(withIds(b)); setBuying(null) }} onClose={() => setBuying(null)} />
      )}

      <Modal opened={snapshotOpen} onClose={() => setSnapshotOpen(false)} title="Is the rest of the pantry right?">
        <Stack>
          <Text size="sm">Saves what is left of every batch today. Only what you add from now on changes the stock.</Text>
          <Button size="lg" loading={snapshot.isPending} onClick={() => snapshot.mutate()}>
            Yes, save a snapshot
          </Button>
          <Button size="lg" variant="default" onClick={() => setSnapshotOpen(false)}>
            Not now
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
