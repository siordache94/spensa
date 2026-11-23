import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ActionIcon, Alert, Autocomplete, Button, Center, Checkbox, Group, Loader, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { DatePickerInput, type DateValue } from '@mantine/dates'
import { IconPencil } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { uuid } from '../lib/uuid.ts'
import { Stepper } from '../components/Stepper.tsx'
import { amountStep } from '../lib/amountStep.ts'
import { useCommand } from '../lib/api/command.ts'
import { usePantryState } from '../lib/api/pantry.ts'
import { useApi } from '../lib/api/context.tsx'
import { keys } from '../lib/api/keys.ts'
import { addShoppingItem, clearCheckedItems, refreshShop, setMealSkipShopping, useShoppingItems } from '../lib/api/shop.ts'
import { finishShopping } from '../lib/api/checkins.ts'
import { BUY_KEY, CHECK_KEY, ON_HAND_KEY, UNBUY_KEY, UNCHECK_KEY, UN_ON_HAND_KEY, type Buy as BuyVars } from '../lib/shopMutations.ts'
import { useWaitingShopMutations } from '../lib/offlineQueue.ts'
import { memberLabel, useMembers } from '../lib/members.ts'
import { slotLabel, useUnreadCheckins } from '../lib/checkins.ts'
import { changeMessage, diffToBuy, loadAcked, relativeTime, saveAcked, selectedMealIds, tripRange } from '../lib/trip.ts'
import { resolvedKeys } from '../domain/toBuy.ts'
import { shoppingList, type Day, type Need } from '../domain/replay.ts'
import { buildShoppingView, snapshotPlan, type BuyDraft, type Tick, type Untick } from '../domain/shoppingView.ts'
import { round3 } from '../lib/format.ts'
import './shop.css'


type Buy = BuyDraft

type Meal = { id: string; date: Day; slot: string; portions: number; position: number; skip_shopping: boolean; recipes: { name: string } | null }

const withIds = (b: Buy): BuyVars => ({ ...b, batchId: uuid(), addedAt: new Date().toISOString() })
const dayOf = (v: DateValue) => (v ? dayjs(v).format('YYYY-MM-DD') : null)
const dayName = (d: Day) => dayjs(d).format('ddd D')

function BuyModal({ buy, pending, onBuy, onClose }: { buy: Buy; pending: boolean; onBuy: (b: Buy) => void; onClose: () => void }) {
  const [qty, setQty] = useState<number | null>(buy.qty)
  const [expires, setExpires] = useState<DateValue>(buy.expiresOn ? dayjs(buy.expiresOn).toDate() : null)
  const dirty = useDirty({ qty, expires })
  const qtyValue = qty
  const qtyValid = qtyValue !== null && qtyValue > 0

  function submit() {
    if (qtyValue === null || !(qtyValue > 0)) return
    onBuy({ ...buy, qty: round3(qtyValue), expiresOn: dayOf(expires) })
  }

  return (
    <GuardedModal dirty={dirty} onClose={onClose} title={buy.name}>
      <Stack>
        <Stepper
          label="Amount"
          size="lg"
          min={amountStep(buy.unit, 0)}
          step={amountStep(buy.unit, qty)}
          unit={buy.unit === 'count' ? undefined : buy.unit}
          value={qty}
          onChange={setQty}
          error={qty !== null && !qtyValid ? 'Must be more than 0' : undefined}
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
      <Checkbox aria-label={label} checked={checked} onChange={onChange} onClick={(ev) => ev.stopPropagation()} />
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

/** Meal selection for the trip. Each tick writes `skip_shopping` straight away, so both phones see the same trip. */
function Setup({ meals, slots, today, horizon, onSkip, onDone }: {
  meals: Meal[]
  slots: string[]
  today: Day
  horizon: number
  onSkip: (id: string, skip: boolean) => void
  onDone: () => void
}) {
  const { from, to } = tripRange(today, horizon)
  const rank = (slot: string) => { const i = slots.indexOf(slot); return i < 0 ? slots.length : i }
  const shown = meals
    .filter((m) => m.date >= from && m.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a.slot) - rank(b.slot) || a.position - b.position)
  const days = [...new Set(shown.map((m) => m.date))]
  const count = shown.filter((m) => !m.skip_shopping).length
  const span = `${horizon} ${horizon === 1 ? 'day' : 'days'}`

  return (
    <div className="sp-shop">
      <div className="sp-titlerow"><h1 className="sp-title">Plan this trip</h1></div>
      <p className="sp-note">
        The next {span} (change it in Settings). Untick a meal to leave it off the list; it is still planned and eaten.
        Staples below minimum stock and extras are always on the list.
      </p>

      {shown.length === 0 && <p className="sp-empty">Nothing is planned for the next {span}. You can still shop for staples and extras.</p>}

      {days.map((d) => (
        <div key={d}>
          <div className="sp-band sp-day"><span>{dayjs(d).format('ddd D MMM')}</span></div>
          {shown.filter((m) => m.date === d).map((m) => (
            <label key={m.id} className="sp-meal">
              <Tick checked={!m.skip_shopping} label={`${m.slot} ${m.recipes?.name ?? 'meal'}`} onChange={() => onSkip(m.id, !m.skip_shopping)} />
              <span className="sp-slot">{m.slot}</span>
              <span className="sp-name">{m.recipes?.name ?? 'No recipe'} <b>× {m.portions}</b></span>
            </label>
          ))}
        </div>
      ))}

      <div className="sp-dock">
        <Button className="sp-dock-btn" size="lg" fullWidth onClick={onDone}>
          Done · {count} {count === 1 ? 'meal' : 'meals'}
        </Button>
      </div>
    </div>
  )
}

export default function ShopPage() {
  const queryClient = useQueryClient()
  const api = useApi()
  const pantry = usePantryState()
  const { events, domainIngredients, ingredients, today, remaining } = pantry
  const members = useMembers()
  const waiting = useWaitingShopMutations()

  const items = useShoppingItems()

  // Live sync. Soft deletes are UPDATEs of rows RLS then hides, so row events never reach the other phone
  // (ADR 0003). Every write also touches the household's `household_events` row; any change to it refetches.
  // `by` tells the partner's writes from our own echoes, and partner changes to the to-buy list raise one toast.
  const meRef = useRef<string | null>(null)
  const keysRef = useRef<string[]>([])
  const resolvedRef = useRef<ReadonlySet<string>>(new Set())
  const whoRef = useRef<(id: string | null) => string>(() => 'Your partner')
  useEffect(() => {
    whoRef.current = (id) => {
      const m = members.data?.find((x) => x.user_id === id)
      return m?.display_name ? memberLabel(m) : 'Your partner'
    }
  }, [members.data])
  useEffect(() => {
    let baseline: string[] | null = null
    let who: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      const msg = baseline && changeMessage(whoRef.current(who), diffToBuy(baseline, keysRef.current, resolvedRef.current))
      baseline = null
      if (msg) notifications.show({ id: 'partner-list', message: msg })
    }
    const unsubscribe = api.live.subscribeHouseholdEvents('household-events', (by) => {
      void refreshShop(queryClient)
      if (!by || by === meRef.current) return
      baseline ??= keysRef.current // taken before the refetch lands
      who = by
      clearTimeout(timer)
      timer = setTimeout(flush, 3000) // combine changes that arrive close together
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [queryClient, api])

  const [editing, setEditing] = useState(false)
  const [acked, setAcked] = useState<string[]>(loadAcked)
  const [me, setMe] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tasted, setTasted] = useState<string[]>([]) // to-taste ingredients ticked this visit
  const [text, setText] = useState('')
  const [buying, setBuying] = useState<Buy | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const unread = useUnreadCheckins()
  const [notCooked, setNotCooked] = useState<Set<string>>(() => new Set()) // unread meals the finish dialog marks "didn't cook"

  useEffect(() => {
    void api.auth.currentUserId().then((id) => { meRef.current = id; setMe(id) })
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [api])

  // The trip is inferred from household data, so both phones see the same list.
  const horizon = pantry.household?.horizon_days ?? 7
  const range = useMemo(() => (today ? tripRange(today, horizon) : null), [today, horizon])
  const mealIds = useMemo(
    () => (range ? selectedMealIds((pantry.meals ?? []) as Meal[], range.from, range.to) : new Set<string>()),
    [pantry.meals, range],
  )
  const tripMeals = useMemo(
    () => ((pantry.meals ?? []) as Meal[]).filter((m) => mealIds.has(m.id)).map((m) => m.date).sort(),
    [pantry.meals, mealIds],
  )

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

  const showError = (e: Error) => notifications.show({ color: 'red', message: e.message })

  const buy = useMutation<void, Error, BuyVars>({ mutationKey: BUY_KEY })
  const markOnHand = useMutation<void, Error, string>({ mutationKey: ON_HAND_KEY })
  const checkText = useMutation<void, Error, string>({ mutationKey: CHECK_KEY })
  const { mutate: mutateBuy } = buy
  const unbuy = useMutation<void, Error, string>({ mutationKey: UNBUY_KEY })
  const unOnHand = useMutation<void, Error, string>({ mutationKey: UN_ON_HAND_KEY })
  const uncheck = useMutation<void, Error, string>({ mutationKey: UNCHECK_KEY })

  const clearChecked = useCommand(clearCheckedItems, { onError: showError })

  const addItem = useCommand(addShoppingItem, { onSuccess: () => setText(''), onError: showError })

  const setSkip = useCommand(setMealSkipShopping, {
    onMutate: ({ mealId, skip }) => {
      // tick instantly; the refetch confirms it
      queryClient.setQueryData<{ meals: Meal[] }>(keys.pantry.all(), (d) => d && { ...d, meals: d.meals.map((m) => (m.id === mealId ? { ...m, skip_shopping: skip } : m)) })
    },
    onError: showError,
  })

  const snapshot = useCommand(finishShopping, {
    onSuccess: () => { setSnapshotOpen(false); setEditing(false) },
    onError: showError,
  })

  function saveSnapshot() {
    if (!events || !today || !remaining) return showError(new Error('Still loading, try again.'))
    // unread check-ins are answered here: a meal marked "didn't cook" consumes nothing, so the snapshot must not count it
    const { answers, batches } = snapshotPlan({ events, today, remaining, unreadMealIds: unread.items.map((u) => u.mealId), notCooked })
    snapshot.mutate({ onDate: today, batches, answers })
  }

  const { mutate: mutateOnHand } = markOnHand
  const { mutate: mutateCheck } = checkText

  const view = useMemo(
    () => buildShoppingView({
      needs,
      stapleIds,
      ingredients: ingredients ?? [],
      items: items.data ?? [],
      batches: events?.batches ?? [],
      authors: pantry.batchAuthors ?? {},
      today: today ?? '',
      me,
      acked,
      tasted,
    }),
    [needs, stapleIds, ingredients, items.data, events, pantry.batchAuthors, today, me, acked, tasted],
  )
  const { groups, entries, cart, partnerLast, checkedTextCount } = view

  /** Runs a row's tick: the offline-capable write, or the to-taste bookkeeping first. */
  function runTick(t: Tick) {
    if (t.kind === 'buy') mutateBuy(withIds(t.buy))
    else if (t.kind === 'toTaste') { setTasted((prev) => [...prev, t.ingredientId]); mutateOnHand(t.ingredientId) }
    else mutateCheck(t.itemId)
  }

  function runUntick(u: Untick) {
    if (u.kind === 'unbuy') unbuy.mutate(u.batchId)
    else if (u.kind === 'unOnHand') unOnHand.mutate(u.ingredientId)
    else uncheck.mutate(u.itemId)
  }

  // Feeds the partner-change toast: keys now on the list, and keys that left it because they were bought.
  useEffect(() => { keysRef.current = entries.map((e) => e.key) }, [entries])

  useEffect(() => {
    if (!events || !domainIngredients || !today) return
    resolvedRef.current = resolvedKeys({
      events,
      ingredients: domainIngredients,
      today,
      items: (items.data ?? []).map((i) => ({ id: i.id, ingredientId: i.ingredient_id, checked: i.checked, boughtBatchId: i.bought_batch_id })),
    })
  }, [events, domainIngredients, today, items.data])
  const failure = pantry.error ?? items.error

  if (failure) return <Alert color="red">{failure.message}</Alert>
  if (pantry.isPending || items.isPending || !today) return <Center py="xl"><Loader /></Center>

  function submitItem(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    const match = (ingredients ?? []).find((i) => i.name.toLowerCase() === value.toLowerCase())
    addItem.mutate(match ? { ingredient_id: match.id } : { text: value })
  }

  function acknowledge(id: string) {
    // functional update: auto-acks fire from timers and must not drop each other
    setAcked((a) => {
      if (a.includes(id)) return a
      const next = [...a, id]
      saveAcked(next)
      return next
    })
  }

  if (editing || !range) {
    return (
      <Setup
        meals={(pantry.meals ?? []) as Meal[]}
        slots={pantry.household?.slots ?? []}
        today={today}
        horizon={horizon}
        onSkip={(id, skip) => setSkip.mutate({ mealId: id, skip })}
        onDone={() => setEditing(false)}
      />
    )
  }

  const summary = tripMeals.length === 0
    ? 'Staples and extras only'
    : `${tripMeals[0] === tripMeals.at(-1) ? dayjs(tripMeals[0]).format('ddd D') : `${dayName(tripMeals[0])} – ${dayName(tripMeals.at(-1)!)}`} · ${tripMeals.length} ${tripMeals.length === 1 ? 'meal' : 'meals'}`

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
            // the row handles the tap itself: label-to-checkbox forwarding was unreliable on touch
            <div key={e.key} className="sp-row" onClick={() => runTick(e.tick)}>
              <Tick checked={false} label={`Bought ${e.name}`} onChange={() => runTick(e.tick)} />
              <span className="sp-name">{e.name}{e.note && <em>{e.note}</em>}{e.pack && <small className="sp-packline">{e.pack}</small>}</span>
              <Figure figure={e.figure} unit={e.unit} free={e.free} />
              {e.buy ? (
                <ActionIcon
                  className="sp-edit"
                  variant="subtle"
                  color="gray"
                  aria-label={`Change amount for ${e.name}`}
                  onClick={(ev) => { ev.stopPropagation(); setBuying(e.buy!) }}
                >
                  <IconPencil size={20} stroke={1.75} />
                </ActionIcon>
              ) : <span />}
            </div>
          ))}
        </div>
      ))}

      {cart.length > 0 && (
        <div>
          <div className="sp-cart-head">
            <span>In the cart · {cart.length}</span>
            {checkedTextCount > 0 && (
              <Button variant="subtle" loading={clearChecked.isPending} onClick={() => clearChecked.mutate({ ids: (items.data ?? []).filter((i) => i.checked).map((i) => i.id) })}>
                Clear checked
              </Button>
            )}
          </div>
          {cart.map((c) => (
            <div key={c.key} className={`sp-row sp-done${c.held ? ' sp-held' : ''}`} style={{ cursor: 'default' }}>
              <Tick checked label={`Put back ${c.name}`} onChange={() => runUntick(c.untick)} />
              <span className="sp-name">
                {c.name}
                {c.held && c.at && <em>ticked by partner · {relativeTime(c.at, now)}</em>}
              </span>
              <Figure figure={c.figure} unit={c.unit} free={c.free} />
              <span />
              {c.held && <AckButton name={c.name} onAck={() => acknowledge(c.id)} />}
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
            {partnerLast ? (
              <span><span className="sp-pname">{partnerLast.name}</span> <small>{relativeTime(partnerLast.addedAt, now)}</small></span>
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
          {unread.count > 0 && (
            <Stack gap="xs">
              <Text fw={600} className="sp-label">
                {unread.count === 1 ? "1 meal wasn't confirmed" : `${unread.count} meals weren't confirmed`}
              </Text>
              {unread.items.map((u) => (
                <Stack key={u.id} gap={6}>
                  <Text size="sm">{dayName(u.date)} · {slotLabel(u.slot)} · {u.recipeName ?? 'Deleted recipe'}</Text>
                  <SegmentedControl
                    fullWidth
                    size="xs"
                    aria-label={`${slotLabel(u.slot)} ${u.recipeName ?? 'meal'}`}
                    value={notCooked.has(u.mealId) ? 'not_cooked' : 'planned'}
                    onChange={(v) => setNotCooked((prev) => {
                      const next = new Set(prev)
                      if (v === 'not_cooked') next.add(u.mealId)
                      else next.delete(u.mealId)
                      return next
                    })}
                    data={[{ value: 'planned', label: 'As planned' }, { value: 'not_cooked', label: "Didn't cook" }]}
                  />
                </Stack>
              ))}
            </Stack>
          )}
          <Button size="lg" loading={snapshot.isPending} onClick={saveSnapshot}>
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

/** Covers a partner-ticked row: a tap acknowledges it, and so does staying on screen for a few seconds. */
function AckButton({ name, onAck }: { name: string; onAck: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const ack = useRef(onAck)
  ack.current = onAck
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer)
      if (e.isIntersecting) timer = setTimeout(() => ack.current(), 3000)
    }, { threshold: 0.6 })
    if (ref.current) io.observe(ref.current)
    return () => { io.disconnect(); clearTimeout(timer) }
  }, [])
  return <button ref={ref} type="button" className="sp-ack" aria-label={`Acknowledge ${name}, ticked by partner`} onClick={onAck} />
}
