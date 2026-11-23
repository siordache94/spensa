import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ActionIcon, Alert, Autocomplete, Button, Center, Checkbox, Group, Loader, Modal, NumberInput, Stack, Text } from '@mantine/core'
import { DatePickerInput, type DateValue } from '@mantine/dates'
import { IconPencil } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { invalidatePantry, usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import { BUY_KEY, CHECK_KEY, ON_HAND_KEY, UNBUY_KEY, UNCHECK_KEY, UN_ON_HAND_KEY, type Buy as BuyVars } from '../lib/shopMutations.ts'
import { useWaitingShopMutations } from '../lib/offlineQueue.ts'
import { useSettings } from '../lib/settings.ts'
import { loadAcked, loadTrip, relativeTime, saveAcked, saveTrip, setupEnd, tripRange, type Trip } from '../lib/trip.ts'
import { addDays, replay, shoppingList, type Day, type Need } from '../domain/replay.ts'
import './shop.css'


// What the UI builds; ticking adds the batch id and time (see shopMutations.ts).
type Buy = Omit<BuyVars, 'batchId' | 'addedAt'>

// One row on the list. `buy` is set for rows with a quantity (the pencil at the row end changes it).
type Entry = {
  key: string
  name: string
  category: string | null // null = uncategorised
  note?: string
  figure?: string
  unit?: string
  free?: string // text in the amount column instead of a figure, e.g. "to taste"
  pack?: string
  buy?: Buy
  onTick: () => void
}

type Meal = { id: string; date: Day; slot: string; portions: number; position: number; recipes: { name: string } | null }

const withIds = (b: Buy): BuyVars => ({ ...b, batchId: crypto.randomUUID(), addedAt: new Date().toISOString() })
const STORE_WALK = ['produce', 'dairy', 'meat', 'fish', 'dry goods', 'frozen']
const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000
const dayOf = (v: DateValue) => (v ? dayjs(v).format('YYYY-MM-DD') : null)
const packLabel = (packs: number | null) => (packs ? `≈ ${packs} ${packs === 1 ? 'pack' : 'packs'}` : undefined)
const dayName = (d: Day) => dayjs(d).format('ddd D')

function BuyModal({ buy, pending, onBuy, onClose }: { buy: Buy; pending: boolean; onBuy: (b: Buy) => void; onClose: () => void }) {
  const [qty, setQty] = useState<number | string>(buy.qty)
  const [expires, setExpires] = useState<DateValue>(buy.expiresOn ? dayjs(buy.expiresOn).toDate() : null)
  const dirty = useDirty({ qty, expires })
  const qtyValue = qty === '' ? null : Number(qty)
  const qtyValid = qtyValue !== null && qtyValue > 0

  function submit() {
    if (qtyValue === null || !(qtyValue > 0)) return
    onBuy({ ...buy, qty: round3(qtyValue), expiresOn: dayOf(expires) })
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={buy.name}>
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
    </GuardedModal>
  )
}

function Tick({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <span className="sp-tickcell">
      <Checkbox aria-label={label} checked={checked} onChange={onChange} />
    </span>
  )
}

function Figure({ figure, unit, free }: { figure?: string; unit?: string; free?: string }) {
  if (free) return <span className="sp-free">{free}</span>
  return (
    <>
      <b className="sp-num">{figure}</b>
      <span className="sp-unit">{unit}</span>
    </>
  )
}

function Setup({ meals, slots, today, horizon, trip, onStart }: {
  meals: Meal[]
  slots: string[]
  today: Day
  horizon: number
  trip: Trip | null
  onStart: (mealIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (trip) return new Set(trip.mealIds)
    const end = setupEnd(today, horizon, 0)
    return new Set(meals.filter((m) => m.date >= today && m.date <= end).map((m) => m.id))
  })
  const [extra, setExtra] = useState(() => {
    if (!trip) return 0
    const last = meals.filter((m) => selected.has(m.id)).reduce((a, m) => (m.date > a ? m.date : a), today)
    let w = 0
    while (setupEnd(today, horizon, w) < last) w++
    return w
  })
  const end = setupEnd(today, horizon, extra)
  const rank = (slot: string) => { const i = slots.indexOf(slot); return i < 0 ? slots.length : i }
  const shown = meals
    .filter((m) => m.date >= today && m.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a.slot) - rank(b.slot) || a.position - b.position)
  const days = [...new Set(shown.map((m) => m.date))]
  const count = shown.filter((m) => selected.has(m.id)).length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="sp-shop">
      <div className="sp-titlerow"><h1 className="sp-title">Plan this trip</h1></div>
      <p className="sp-note">Staples below minimum stock and extras are always on the list.</p>

      {shown.length === 0 && (
        <p className="sp-empty">Nothing is planned for the next {extra * 7 + horizon} days. You can still shop for staples and extras.</p>
      )}

      {days.map((d) => (
        <div key={d}>
          <div className="sp-band sp-day"><span>{dayjs(d).format('ddd D MMM')}</span></div>
          {shown.filter((m) => m.date === d).map((m) => (
            <label key={m.id} className="sp-meal">
              <Tick checked={selected.has(m.id)} label={`${m.slot} ${m.recipes?.name ?? 'meal'}`} onChange={() => toggle(m.id)} />
              <span className="sp-slot">{m.slot}</span>
              <span className="sp-name">{m.recipes?.name ?? 'No recipe'} <b>× {m.portions}</b></span>
            </label>
          ))}
        </div>
      ))}

      {meals.some((m) => m.date > end) && (
        <div className="sp-more">
          <Button variant="default" size="md" fullWidth onClick={() => setExtra((e) => e + 1)}>Show 7 more days</Button>
        </div>
      )}

      <div className="sp-dock">
        <Button className="sp-dock-btn" size="lg" fullWidth onClick={() => onStart([...selected].filter((id) => meals.some((m) => m.id === id)))}>
          {trip ? 'Update trip' : 'Start shopping'} · {count} {count === 1 ? 'meal' : 'meals'}
        </Button>
      </div>
    </div>
  )
}

export default function ShopPage() {
  const queryClient = useQueryClient()
  const pantry = usePantry()
  const { events, domainIngredients, ingredients, today } = pantry
  const [settings] = useSettings()
  const waiting = useWaitingShopMutations()

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

  const [trip, setTrip] = useState<Trip | null>(loadTrip)
  const [editing, setEditing] = useState(false)
  const [acked, setAcked] = useState<string[]>(loadAcked)
  const [me, setMe] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tasted, setTasted] = useState<string[]>([]) // to-taste ingredients ticked this visit
  const [text, setText] = useState('')
  const [buying, setBuying] = useState<Buy | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null))
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const updateTrip = (t: Trip | null) => { setTrip(t); saveTrip(t) }

  const mealIds = useMemo(() => new Set(trip?.mealIds ?? []), [trip])
  const range = useMemo(() => {
    if (!trip || !events) return null
    const dates = events.meals.filter((m) => mealIds.has(m.id)).map((m) => m.date)
    return { ...tripRange(trip.startedOn, dates), meals: dates.length, first: dates.reduce((a, d) => (d < a ? d : a), dates[0] ?? '') }
  }, [trip, events, mealIds])

  const needs = useMemo<Need[]>(
    () => (events && domainIngredients && range ? shoppingList(events, domainIngredients, range.from, range.to, mealIds) : []),
    [events, domainIngredients, range, mealIds],
  )
  // Staples below min stock: what the list would hold with no meals selected.
  const stapleIds = useMemo(
    () => new Set(events && domainIngredients && range ? shoppingList(events, domainIngredients, range.from, range.to, new Set()).map((n) => n.ingredientId) : []),
    [events, domainIngredients, range],
  )

  const names = (ingredients ?? []).map((i) => i.name)

  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: ['shopping_items'] })
  const showError = (e: Error) => notifications.show({ color: 'red', message: e.message })

  const buy = useMutation<void, Error, BuyVars>({ mutationKey: BUY_KEY })
  const markOnHand = useMutation<void, Error, string>({ mutationKey: ON_HAND_KEY })
  const checkText = useMutation<void, Error, string>({ mutationKey: CHECK_KEY })
  const { mutate: mutateBuy } = buy
  const unbuy = useMutation<void, Error, string>({ mutationKey: UNBUY_KEY })
  const unOnHand = useMutation<void, Error, string>({ mutationKey: UN_ON_HAND_KEY })
  const uncheck = useMutation<void, Error, string>({ mutationKey: UNCHECK_KEY })

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
    onSuccess: () => { setSnapshotOpen(false); setEditing(false); updateTrip(null) },
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
        out.push({ key: `need-${n.ingredientId}`, name: ing.name, category: ing.category, free: 'to taste', onTick: () => { setTasted((t) => [...t, n.ingredientId]); mutateOnHand(n.ingredientId) } })
        continue
      }
      const b: Buy = {
        ingredientId: n.ingredientId,
        name: ing.name,
        unit: ing.unit,
        qty: round3(Math.max(n.qty, ing.pack_size ?? 0)),
        expiresOn: expiryFor(ing.shelf_life_days),
      }
      out.push({
        key: `need-${n.ingredientId}`,
        name: ing.name,
        category: ing.category,
        note: stapleIds.has(n.ingredientId) ? 'Staple, below min stock' : undefined,
        figure: `${round1(n.qty)}`,
        unit: ing.unit,
        pack: packLabel(n.packs),
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
          figure: item.qty ? `${round1(item.qty)}` : undefined,
          unit: item.qty ? item.ingredients.unit : undefined,
          buy: b,
          onTick: () => mutateBuy(withIds(b)),
        })
      } else if (!item.checked) {
        out.push({ key: `item-${item.id}`, name: item.text ?? '', category: null, onTick: () => mutateCheck(item.id) })
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [ingredients, today, needs, stapleIds, items.data, mutateBuy, mutateOnHand, mutateCheck])

  const groups = useMemo(() => {
    const byCategory = new Map<string | null, Entry[]>()
    for (const e of entries) {
      // a real "other" category and uncategorised items share the one closing group
      const key = e.category === null || e.category.toLowerCase() === 'other' ? null : e.category
      byCategory.set(key, [...(byCategory.get(key) ?? []), e])
    }
    const walk = (c: string) => STORE_WALK.indexOf(c.toLowerCase())
    const known = (c: string) => (walk(c) === -1 ? STORE_WALK.length : walk(c))
    const named = [...byCategory.entries()].filter(([c]) => c !== null) as [string, Entry[]][]
    named.sort(([a], [b]) => known(a) - known(b) || a.localeCompare(b))
    const other = byCategory.get(null)
    return [...named, ...(other ? [[null, other] as [null, Entry[]]] : [])] as [string | null, Entry[]][]
  }, [entries])

  const checkedTexts = (items.data ?? []).filter((i) => !i.ingredient_id && i.checked)
  const byId = new Map((ingredients ?? []).map((i) => [i.id, i]))
  const authors = pantry.batchAuthors ?? {}
  const todaysBatches = [...(events?.batches ?? [])]
    .filter((b) => b.addedOn === today && byId.has(b.ingredientId))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const byPartner = (id: string) => !!me && !!authors[id] && authors[id] !== me
  const cart = [
    ...todaysBatches.map((b) => {
      const ing = byId.get(b.ingredientId)!
      const partner = byPartner(b.id)
      return {
        key: `batch-${b.id}`, id: b.id, name: ing.name, figure: `${round1(b.qty)}`, unit: ing.unit, free: undefined as string | undefined,
        held: partner && !acked.includes(b.id), at: partner ? b.addedAt : undefined, untick: () => unbuy.mutate(b.id),
      }
    }),
    ...tasted
      .filter((id) => byId.get(id)?.on_hand)
      .map((id) => ({ key: `taste-${id}`, id, name: byId.get(id)!.name, figure: undefined, unit: undefined, free: 'to taste', held: false, at: undefined, untick: () => unOnHand.mutate(id) })),
    ...checkedTexts.map((i) => ({ key: `text-${i.id}`, id: i.id, name: i.text ?? '', figure: undefined, unit: undefined, free: undefined, held: false, at: undefined, untick: () => uncheck.mutate(i.id) })),
  ]
  const lastPartner = todaysBatches.find((b) => byPartner(b.id))
  const failure = pantry.error ?? items.error

  if (failure) return <Alert color="red">{failure.message}</Alert>
  if (pantry.isPending || items.isPending || !today) return <Center py="xl"><Loader /></Center>

  function submitItem(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (value) addItem.mutate(value)
  }

  function acknowledge(id: string) {
    const next = [...acked, id]
    setAcked(next)
    saveAcked(next)
  }

  if (!trip || editing || !range) {
    return (
      <Setup
        meals={(pantry.meals ?? []) as Meal[]}
        slots={pantry.household?.slots ?? []}
        today={today}
        horizon={settings.horizonDays}
        trip={trip}
        onStart={(ids) => { updateTrip({ mealIds: ids, startedOn: trip?.startedOn ?? today }); setEditing(false) }}
      />
    )
  }

  const summary = range.meals === 0
    ? 'Staples and extras only'
    : `${range.first === range.to ? dayjs(range.to).format('ddd D') : `${dayName(range.first)} – ${dayName(range.to)}`} · ${range.meals} ${range.meals === 1 ? 'meal' : 'meals'}`

  return (
    <div className="sp-shop">
      <div className="sp-titlerow">
        <h1 className="sp-title">Shopping list</h1>
        <Button variant="default" size="sm" onClick={() => setEditing(true)}>Edit trip</Button>
      </div>
      <div className="sp-trip">{summary}</div>

      <form className="sp-add" onSubmit={submitItem}>
        <Group wrap="nowrap" align="flex-end">
          <Autocomplete flex={1} size="md" placeholder="Add an item" aria-label="Add an item" value={text} onChange={setText} data={names} />
          <Button type="submit" size="md" loading={addItem.isPending} disabled={text.trim() === ''}>
            Add
          </Button>
        </Group>
      </form>

      <div className="sp-cols" aria-hidden="true"><span>Item</span><span>Amount</span></div>

      {entries.length === 0 && <p className="sp-empty">Nothing left to buy for this trip.</p>}

      {groups.map(([category, rows]) => (
        <div key={category ?? 'uncategorised'}>
          <div className="sp-band"><span>{category ?? 'Other'}</span><small>{rows.length} to buy</small></div>
          {rows.map((e) => (
            <label key={e.key} className="sp-row">
              <Tick checked={false} label={`Bought ${e.name}`} onChange={() => e.onTick()} />
              <span className="sp-name">{e.name}{e.note && <em>{e.note}</em>}{e.pack && <small className="sp-packline">{e.pack}</small>}</span>
              <Figure figure={e.figure} unit={e.unit} free={e.free} />
              {e.buy ? (
                <ActionIcon
                  className="sp-edit"
                  variant="subtle"
                  color="gray"
                  aria-label={`Change amount for ${e.name}`}
                  onClick={(ev) => { ev.preventDefault(); setBuying(e.buy!) }}
                >
                  <IconPencil size={20} stroke={1.75} />
                </ActionIcon>
              ) : <span />}
            </label>
          ))}
        </div>
      ))}

      {cart.length > 0 && (
        <div>
          <div className="sp-cart-head">
            <span>In the cart · {cart.length}</span>
            {checkedTexts.length > 0 && (
              <Button variant="subtle" loading={clearChecked.isPending} onClick={() => clearChecked.mutate()}>
                Clear checked
              </Button>
            )}
          </div>
          {cart.map((c) => (
            <div key={c.key} className={`sp-row sp-done${c.held ? ' sp-held' : ''}`} style={{ cursor: 'default' }}>
              <Tick checked label={`Put back ${c.name}`} onChange={() => c.untick()} />
              <span className="sp-name">
                {c.name}
                {c.held && c.at && <em>ticked by partner · {relativeTime(c.at, now)}</em>}
              </span>
              <Figure figure={c.figure} unit={c.unit} free={c.free} />
              <span />
              {c.held && <button type="button" className="sp-ack" aria-label={`Acknowledge ${c.name}, ticked by partner`} onClick={() => acknowledge(c.id)} />}
            </div>
          ))}
        </div>
      )}

      <div className="sp-finish">
        <Button size="lg" fullWidth variant="default" disabled={!events} onClick={() => setSnapshotOpen(true)}>
          Done shopping
        </Button>
      </div>

      <div className="sp-dock">
        <div className="sp-pass" role="group" aria-label="Trip status">
          <div className="sp-seg-cell"><b>Left</b><span>{entries.length}</span></div>
          <div className="sp-seg-cell"><b>In cart</b><span>{cart.length}</span></div>
          <div className="sp-seg-cell sp-partner">
            <b>Partner</b>
            {lastPartner ? (
              <span><span className="sp-pname">{byId.get(lastPartner.ingredientId)?.name}</span> <small>{relativeTime(lastPartner.addedAt, now)}</small></span>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="sp-seg-cell"><b>Queue</b><span>{waiting === 0 ? <span style={{ fontSize: 15 }}>synced</span> : waiting}</span></div>
        </div>
      </div>

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
    </div>
  )
}
