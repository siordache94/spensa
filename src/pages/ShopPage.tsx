import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import { ActionIcon, Autocomplete, Button, Checkbox, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { DatePickerInput, type DateValue } from '@mantine/dates'
import { IconArrowBackUp, IconPencil } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { GuardedModal, useDirty } from '../components/GuardedModal.tsx'
import { useOverlay } from '../lib/navigation.ts'
import { uuid } from '../lib/uuid.ts'
import { Stepper } from '../components/Stepper.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { UndoToast } from '../components/UndoToast.tsx'
import { notBoughtLine, undoMessage } from '../lib/undoToast.ts'
import { amountStep } from '../lib/amountStep.ts'
import { useCommand } from '../lib/api/command.ts'
import { usePantryState } from '../lib/api/pantry.ts'
import { useApi } from '../lib/api/context.tsx'
import { keys } from '../lib/api/keys.ts'
import { addShoppingItem, clearCheckedItems, refreshShop, setMealSkipShopping, useShoppingItems } from '../lib/api/shop.ts'
import { finishShopping, isVersionConflict } from '../lib/api/checkins.ts'
import { BUY_KEY, CHECK_KEY, ON_HAND_KEY, SHOP_SCOPE, UNBUY_KEY, UNCHECK_KEY, UN_ON_HAND_KEY, type Buy as BuyVars } from '../lib/shopMutations.ts'
import { useWaitingShopMutations } from '../lib/offlineQueue.ts'
import { memberLabel, useMembers } from '../lib/api/household.ts'
import { slotLabel } from '../lib/checkin.ts'
import { useUnreadCheckins } from '../lib/api/checkins.ts'
import { PANTRY_CHANGED_MESSAGE, type BuyResult } from '../lib/api/port.ts'
import { changeMessage, diffToBuy, loadAcked, relativeTime, saveAcked, selectedMealIds, tripRange } from '../lib/trip.ts'
import { ACK_DWELL_MS, rowLabel, tapAction, type TapTarget } from '../lib/shopRow.ts'
import { finishBlock, useOnline } from '../lib/useOnline.ts'
import { resolvedKeys } from '../domain/toBuy.ts'
import { shoppingList, type Day, type Need } from '../domain/replay.ts'
import { buildShoppingView, snapshotPlan, type BuyDraft, type CartRow, type Entry, type Tick, type Untick } from '../domain/shoppingView.ts'
import { round3, formatDay, visibleUnit } from '../lib/format.ts'
import './shop.css'


type Buy = BuyDraft

type Meal = { id: string; date: Day; slot: string; portions: number; position: number; skip_shopping: boolean; recipes: { name: string } | null }

const withIds = (b: Buy): BuyVars => ({ ...b, batchId: uuid(), addedAt: new Date().toISOString() })
const dayOf = (v: DateValue) => (v ? dayjs(v).format('YYYY-MM-DD') : null)
const dayName = (d: Day) => formatDay(d, { weekday: 'short', day: 'numeric' })

function BuyModal({ buy, pending, paused, onBuy, onClose }: {
  buy: Buy
  /** The write is in flight (it is not queued offline). */
  pending: boolean
  /** The write is queued offline: it stays mounted but may close, because it is already saved on this phone. */
  paused: boolean
  onBuy: (b: Buy) => Promise<unknown>
  onClose: () => void
}) {
  const [qty, setQty] = useState<number | null>(buy.qty)
  const [expires, setExpires] = useState<DateValue>(buy.expiresOn ? dayjs(buy.expiresOn).toDate() : null)
  const dirty = useDirty({ qty, expires })
  const qtyValue = qty
  const qtyValid = qtyValue !== null && qtyValue > 0
  // Two taps in the same frame would create two batches with two ids: guard before React re-renders (MR-031).
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  async function submit() {
    if (inFlight.current || qtyValue === null || !(qtyValue > 0)) return
    inFlight.current = true
    try {
      await onBuy({ ...buy, qty: round3(qtyValue), expiresOn: dayOf(expires) })
      // Success: the purchase is on its way to the pantry, so the modal's job is done. A paused write that
      // resolves after the person closed the modal must not close a newer one.
      if (mounted.current) onClose()
    } catch {
      // The write failed and its error toast is already up: keep the modal open for another try.
      if (mounted.current) inFlight.current = false
    }
  }

  // While the write is in flight the modal stays put: closing it would hide a purchase that may not have landed.
  const close = () => { if (!pending) onClose() }

  return (
    <GuardedModal
      dirty={dirty}
      onClose={close}
      title={buy.name}
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
    >
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
        <Button size="lg" disabled={!qtyValid} loading={pending || paused} onClick={() => { void submit() }}>
          Buy
        </Button>
      </Stack>
    </GuardedModal>
  )
}

/** The square tick used by the trip setup rows, where the checkbox is the control. */
function Tick({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <span className="sp-tickcell">
      <Checkbox aria-label={label} checked={checked} onChange={onChange} onClick={(ev) => ev.stopPropagation()} />
    </span>
  )
}

/** The board tick as a board-row draws it: a square inside the row button, not a second control. */
function RowTick({ checked = false }: { checked?: boolean }) {
  return (
    <span className="sp-box" data-checked={checked ? 'true' : undefined} aria-hidden="true">
      {checked && (
        <svg viewBox="0 0 24 24" width="60%" height="60%">
          <path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
        </svg>
      )}
    </span>
  )
}

function Figure({ figure, unit, free }: { figure?: string; unit?: string; free?: string }) {
  if (free) return <span className="sp-free">{free}</span>
  return (
    <>
      <b className="sp-num">{figure}</b>
      <span className="sp-unit">{visibleUnit(unit)}</span>
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
          <div className="sp-band sp-day"><span>{formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
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
  // When each cart row was acknowledged on this phone: the coyote window reads these (MR-044).
  const [ackTimes, setAckTimes] = useState<Record<string, number>>({})
  const [me, setMe] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tasted, setTasted] = useState<string[]>([]) // to-taste ingredients ticked this visit
  const [text, setText] = useState('')
  const [buying, setBuying] = useState<Buy | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [saved, setSaved] = useState(false) // the finish succeeded: the dialog shows the result until it closes (MR-043)
  const snapshotPendingRef = useRef(false)
  // Closing the finish dialog goes through the history layer, so phone back closes it before the route. Back must not
  // drop the dialog while the snapshot is in flight (MR-043).
  const snapshotOverlay = useOverlay(() => {
    if (snapshotPendingRef.current) return 'stayed'
    setSnapshotOpen(false)
    return 'closed'
  }, snapshotOpen)
  const [undo, setUndo] = useState<{ id: string; message: string; untick: Untick } | null>(null) // the last list tick, undoable for 4 s
  const unread = useUnreadCheckins()
  const [notCooked, setNotCooked] = useState<Set<string>>(() => new Set()) // unread meals the finish dialog marks "didn't cook"
  const [conflict, setConflict] = useState(false) // the finish was refused: the pantry changed on the other phone
  const online = useOnline()

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

  const buy = useMutation<BuyResult, Error, BuyVars>({
    mutationKey: BUY_KEY,
    // The partner bought the same item first: both batches exist. Offer the choice, changing no stock (MR-003).
    onSuccess: (result, b) => { if (result.alreadyPurchased) showAlsoBought(b) },
  })
  const markOnHand = useMutation<void, Error, string>({ mutationKey: ON_HAND_KEY })
  const checkText = useMutation<void, Error, string>({ mutationKey: CHECK_KEY })
  const { mutate: mutateBuy } = buy
  const unbuy = useMutation<void, Error, string>({ mutationKey: UNBUY_KEY })
  const unOnHand = useMutation<void, Error, string>({ mutationKey: UN_ON_HAND_KEY })
  const uncheck = useMutation<void, Error, string>({ mutationKey: UNCHECK_KEY })

  const clearChecked = useCommand(clearCheckedItems, { scope: SHOP_SCOPE, onError: showError })

  const addItem = useCommand(addShoppingItem, { scope: SHOP_SCOPE, onSuccess: () => setText(''), onError: showError })

  const setSkip = useCommand(setMealSkipShopping, {
    scope: SHOP_SCOPE,
    onMutate: ({ mealId, skip }) => {
      // tick instantly; the refetch confirms it
      queryClient.setQueryData<{ meals: Meal[] }>(keys.pantry.all(), (d) => d && { ...d, meals: d.meals.map((m) => (m.id === mealId ? { ...m, skip_shopping: skip } : m)) })
    },
    onError: showError,
  })

  const snapshot = useCommand(finishShopping, {
    // Behind every queued tick (SHOP_SCOPE), so a finish never overtakes the batch it is about to snapshot.
    scope: SHOP_SCOPE,
    onSuccess: () => {
      // The snapshot is the end of the trip: reset its UI state (MR-029) and keep the dialog open on the result (MR-043).
      resetTrip()
      setEditing(false)
      setConflict(false)
      setSaved(true)
    },
    onError: (e) => {
      // Keep the dialog open: the command already refetched the pantry and the check-ins (when: 'settled'), so the
      // person reviews the new quantities and taps once more (MR-005).
      if (isVersionConflict(e)) setConflict(true)
      else showError(e)
    },
  })
  // The overlay's back guard reads this ref: a back press while the snapshot is in flight must not drop the dialog.
  useEffect(() => { snapshotPendingRef.current = snapshot.isPending }, [snapshot.isPending])

  /**
   * Clear the state that belongs to one trip. Called when the finish dialog opens and after a successful finish, so a
   * stale undo cannot remove a batch that is already in the snapshot and the next trip starts clean (MR-029).
   * `acked` is per device, not per trip, and stays.
   */
  function resetTrip() {
    setNotCooked(new Set())
    setTasted([])
    setUndo(null)
  }

  /** The finish dialog opens on a clean trip state; a conflict is re-checked against fresh quantities (MR-029, MR-005). */
  function openSnapshot() {
    resetTrip()
    setConflict(false)
    setSaved(false)
    setSnapshotOpen(true)
  }

  function closeSnapshot() {
    if (snapshot.isPending) return
    snapshotOverlay.close()
    setSnapshotOpen(false)
  }

  function saveSnapshot() {
    if (snapshot.isPending) return
    // Never queue a finish: a resumed one would send the version and date captured when it was tapped (MR-053).
    if (!online) return
    if (!events || !today || !remaining) return showError(new Error('Still loading, try again.'))
    // unread check-ins are answered here: a meal marked "didn't cook" consumes nothing, so the snapshot must not count it
    const { answers, batches } = snapshotPlan({ events, today, remaining, unreadMealIds: unread.items.map((u) => u.mealId), notCooked })
    // The version the quantities were replayed from: the server refuses the snapshot if the household moved since.
    snapshot.mutate({ onDate: today, batches, answers, expectedAt: pantry.version ?? null })
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

  // A cart line of mine whose ingredient the partner also bought today: the second purchase exists, so the row says so.
  const alsoBought = useMemo(() => {
    const mine: string[] = []
    const partner = (id: string) => !!pantry.batchAuthors?.[id] && pantry.batchAuthors[id] !== me
    for (const row of cart) {
      if (row.untick.kind !== 'unbuy' || !me) continue
      if (pantry.batchAuthors?.[row.id] !== me) continue
      if (cart.some((other) => other.id !== row.id && other.name === row.name && other.untick.kind === 'unbuy' && partner(other.id))) {
        mine.push(row.id)
      }
    }
    return new Set(mine)
  }, [cart, pantry.batchAuthors, me])

  /** The second shopper's choice: keep both purchases (no stock change) or return their own batch. */
  function showAlsoBought(b: BuyVars) {
    const id = `also-bought-${b.batchId}`
    notifications.show({
      id,
      autoClose: 12000,
      message: (
        <AlsoBought
          name={b.name}
          onKeep={() => notifications.hide(id)}
          onPutBack={() => { notifications.hide(id); runUntick({ kind: 'unbuy', batchId: b.batchId }) }}
        />
      ),
    })
  }

  /** Runs a row's tick: the offline-capable write, or the to-taste bookkeeping first. Returns the untick that undoes it. */
  function runTick(t: Tick): Untick {
    if (t.kind === 'buy') {
      const b = withIds(t.buy)
      mutateBuy(b)
      return { kind: 'unbuy', batchId: b.batchId }
    }
    if (t.kind === 'toTaste') { setTasted((prev) => [...prev, t.ingredientId]); mutateOnHand(t.ingredientId); return { kind: 'unOnHand', ingredientId: t.ingredientId } }
    mutateCheck(t.itemId)
    return { kind: 'uncheck', itemId: t.itemId }
  }

  /** A list row's tick, with the undo toast. Cart rows (puts back) do not raise it. */
  function tickRow(e: Entry) {
    const untick = runTick(e.tick)
    setUndo({ id: uuid(), message: undoMessage(e.tick.kind === 'buy' ? 'buy' : e.tick.kind === 'toTaste' ? 'toTaste' : 'checkText', e.name), untick })
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
  // Saved data (persisted cache) is on screen when both queries have it. A failed refresh then gets an inline notice, not a wall.
  const failure = pantry.error ?? items.error
  const hasData = pantry.events !== undefined && items.data !== undefined
  const retry = () => { void refreshShop(queryClient) }

  if (failure && !hasData) return <ErrorState title="Couldn't load your list" onRetry={retry} retrying={pantry.isFetching || items.isFetching} />
  if (pantry.isPending || items.isPending || !today) return <Loading label="Loading list" />

  function submitItem(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    const match = (ingredients ?? []).find((i) => i.name.toLowerCase() === value.toLowerCase())
    addItem.mutate(match ? { ingredient_id: match.id } : { text: value })
  }

  function acknowledge(id: string, rowKey: string) {
    // functional update: auto-acks fire from timers and must not drop each other
    setAcked((a) => {
      if (a.includes(id)) return a
      const next = [...a, id]
      saveAcked(next)
      return next
    })
    // The coyote window belongs to the acknowledgement, whether a tap or the dwell made it: a tap that began while
    // the highlight was lit lands as that acknowledgement and can never run the cart's untick.
    setAckTimes((m) => (m[rowKey] ? m : { ...m, [rowKey]: Date.now() }))
  }

  /** A cart row's tap: the pure rule decides, so the pointer and keyboard paths cannot diverge. */
  function tapCart(c: CartRow, target: TapTarget) {
    const action = tapAction({ row: 'cart', held: c.held, target, ackedAt: ackTimes[c.key], at: Date.now() })
    if (action === 'acknowledge') acknowledge(c.id, c.key)
    else if (action === 'untick') runUntick(c.untick)
    // 'ignore' swallows the tap: the row was acknowledged a moment ago and the person meant the acknowledgement.
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
    : `${tripMeals[0] === tripMeals.at(-1) ? dayName(tripMeals[0]) : `${dayName(tripMeals[0])} – ${dayName(tripMeals.at(-1)!)}`} · ${tripMeals.length} ${tripMeals.length === 1 ? 'meal' : 'meals'}`
  const finish = finishBlock({ online, waiting })

  return (
    <div className="sp-shop">
      <div className="sp-titlerow">
        <h1 className="sp-title">Shopping list</h1>
        <Button variant="default" size="sm" onClick={() => setEditing(true)}>Edit trip</Button>
      </div>
      <div className="sp-trip">{summary}</div>
      {failure && <ErrorState variant="inline" message="Can't refresh. Showing your saved list." onRetry={retry} retrying={pantry.isFetching || items.isFetching} />}

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

      {groups.map(([category, rows], groupIndex) => {
        const headingId = `sp-aisle-${groupIndex}`
        return (
          // One aisle is a section with a band heading and a list of rows; screen readers can jump band to band.
          <section key={category ?? 'uncategorised'} className="sp-aisle" aria-labelledby={headingId}>
            <h2 id={headingId} className="sp-band"><span>{category ?? 'Other'}</span><small>{rows.length} to buy</small></h2>
            <ul className="sp-rows" role="list">
              {rows.map((e) => (
                // The row is one button: the tick square, name and figure are its content, not nested controls.
                // The pencil beside it is the only way into the amount editor.
                <li key={e.key} className="sp-row">
                  <button type="button" className="sp-rowbtn" aria-label={rowLabel(e, 'buy')} onClick={() => tickRow(e)}>
                    <span className="sp-tickcell"><RowTick /></span>
                    <span className="sp-name">{e.name}{e.note && <em className="sp-cue">{e.note}</em>}{e.pack && <small className="sp-packline">{e.pack}</small>}</span>
                    <Figure figure={e.figure} unit={e.unit} free={e.free} />
                  </button>
                  {e.buy ? (
                    <ActionIcon
                      className="sp-edit"
                      variant="subtle"
                      color="gray"
                      aria-label={`Change amount for ${e.name}`}
                      onClick={() => setBuying(e.buy!)}
                    >
                      <IconPencil size={20} stroke={1.75} />
                    </ActionIcon>
                  ) : <span className="sp-rowend" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {cart.length > 0 && (
        <section className="sp-aisle sp-cart" aria-labelledby="sp-cart-head">
          <div className="sp-cart-head">
            <h2 id="sp-cart-head" className="sp-cart-title">In the cart · {cart.length}</h2>
            {checkedTextCount > 0 && (
              <Button variant="subtle" loading={clearChecked.isPending} onClick={() => clearChecked.mutate({ ids: (items.data ?? []).filter((i) => i.checked).map((i) => i.id) })}>
                Clear checked
              </Button>
            )}
          </div>
          <ul className="sp-rows" role="list">
            {cart.map((c) => (
              <CartLine
                key={c.key}
                row={c}
                now={now}
                shared={alsoBought.has(c.id)}
                onAcknowledge={() => acknowledge(c.id, c.key)}
                onTap={(target) => tapCart(c, target)}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="sp-finish">
        {/* primary once nothing is left to buy: the trip is done */}
        <Button
          size="lg"
          fullWidth
          variant={entries.length === 0 ? 'filled' : 'default'}
          // A tick still queued offline would reach the server after the snapshot (MR-004): wait for it. Offline is
          // not a reason to hide the dialog: it explains the gate and stays closable (MR-053).
          disabled={!events || finish === 'waiting'}
          onClick={openSnapshot}
        >
          {finish === 'waiting'
            ? `Waiting for ${waiting} ${waiting === 1 ? 'change' : 'changes'} to sync`
            : 'Done shopping'}
        </Button>
      </div>

      <div className="sp-dock">
        <div className="sp-pass" role="group" aria-label="Trip status">
          <div className="sp-seg-cell"><b>Left</b><span>{entries.length}</span></div>
          <div className="sp-seg-cell"><b>In cart</b><span>{cart.length}</span></div>
          <div className="sp-seg-cell sp-partner">
            <b>Partner</b>
            {partnerLast ? (
              <span><span className="sp-pname sp-cue">{partnerLast.name}</span> <small>{relativeTime(partnerLast.addedAt, now)}</small></span>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="sp-seg-cell"><b>Queue</b><span>{waiting === 0 ? <span style={{ fontSize: 15 }}>synced</span> : waiting}</span></div>
        </div>
      </div>

      {undo && (
        <UndoToast
          key={undo.id}
          message={undo.message}
          onUndo={() => { runUntick(undo.untick); setUndo(null) }}
          onExpire={() => setUndo(null)}
        />
      )}

      {buying && (
        <BuyModal
          key={buying.shoppingItemId ?? buying.ingredientId}
          buy={buying}
          pending={buy.isPending && !buy.isPaused}
          paused={buy.isPaused}
          onBuy={(b) => buy.mutateAsync(withIds(b))}
          onClose={() => setBuying(null)}
        />
      )}

      <Modal
        opened={snapshotOpen}
        onClose={closeSnapshot}
        title={saved ? 'Pantry saved' : 'Finish this trip?'}
        // While the snapshot is in flight, no close affordance is offered: the dialog is the progress and the result (MR-043).
        closeOnClickOutside={!snapshot.isPending}
        closeOnEscape={!snapshot.isPending}
        withCloseButton={!snapshot.isPending}
      >
        {saved ? (
          <Stack>
            <Button component={Link} to="/pantry" size="lg">
              View pantry
            </Button>
            <Button size="lg" variant="default" onClick={closeSnapshot}>
              Close
            </Button>
          </Stack>
        ) : (
          <Stack>
            <Text size="sm">Saves what's left in your pantry today.</Text>
            <Text size="sm">Meals you haven't confirmed count as cooked as planned.</Text>
            {notBoughtLine(entries.length) && <Text size="sm" fw={600}>{notBoughtLine(entries.length)}</Text>}
            {conflict && (
              <Text size="sm" fw={600} c="orange.7" role="alert">
                {PANTRY_CHANGED_MESSAGE}
              </Text>
            )}
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
                      size="lg"
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
            <Button
              size="lg"
              loading={snapshot.isPending}
              // After a conflict, wait for the refreshed pantry: the next tap must send the version it shows.
              disabled={finish !== null || (conflict && (pantry.isFetching || unread.isFetching))}
              onClick={saveSnapshot}
            >
              Finish trip
            </Button>
            {finish === 'offline' && <Text size="sm" c="dimmed">You're offline. Finish when you're back online.</Text>}
            <Button size="lg" variant="default" disabled={snapshot.isPending} onClick={closeSnapshot}>
              Keep shopping
            </Button>
          </Stack>
        )}
      </Modal>
    </div>
  )
}

/** A cart row: the row button puts the row back (or acknowledges the partner), and an explicit control puts a held row back. */
function CartLine({ row, now, shared, onAcknowledge, onTap }: {
  row: CartRow
  now: number
  /** The partner also bought this ingredient today: both purchases are in the cart (MR-003). */
  shared: boolean
  onAcknowledge: () => void
  onTap: (target: TapTarget) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useDwellAck(ref, row.held ? onAcknowledge : undefined)
  const note = row.held
    ? (row.at ? `ticked by partner · ${relativeTime(row.at, now)}` : 'ticked by partner')
    : shared ? 'partner also bought this' : undefined
  return (
    <li className={`sp-row sp-done${row.held ? ' sp-held' : ''}`}>
      <button
        ref={ref}
        type="button"
        className="sp-rowbtn"
        aria-label={rowLabel({ name: row.name, figure: row.figure, unit: row.unit, free: row.free, note }, row.held ? 'acknowledge' : 'putBack')}
        onClick={() => onTap('row')}
      >
        <span className="sp-tickcell"><RowTick checked /></span>
        <span className="sp-name">
          {row.name}
          {note && <em>{note}</em>}
        </span>
        <Figure figure={row.figure} unit={row.unit} free={row.free} />
      </button>
      {row.held ? (
        // The separate control the brief asks for: the only way to undo a partner's tick from the highlight.
        <button
          type="button"
          className="sp-putback"
          aria-label={rowLabel({ name: row.name, figure: row.figure, unit: row.unit, free: row.free }, 'putBack')}
          onClick={() => onTap('putBack')}
        >
          <IconArrowBackUp size={20} stroke={1.75} aria-hidden="true" />
        </button>
      ) : <span className="sp-rowend" aria-hidden="true" />}
    </li>
  )
}

/**
 * A held row acknowledges itself once 60% of it has been on screen for ACK_DWELL_MS, so the highlight is seen and then
 * clears (MR-044). The tap still works at any time; the page's coyote window covers the boundary between the two.
 */
function useDwellAck(ref: RefObject<HTMLButtonElement | null>, onAck: (() => void) | undefined) {
  const ack = useRef(onAck)
  useEffect(() => { ack.current = onAck }, [onAck])
  const enabled = onAck !== undefined
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(([entry]) => {
      clearTimeout(timer)
      if (entry.isIntersecting) timer = setTimeout(() => ack.current?.(), ACK_DWELL_MS)
    }, { threshold: 0.6 })
    io.observe(el)
    return () => { io.disconnect(); clearTimeout(timer) }
  }, [ref, enabled])
}

/**
 * The second shopper's notice (MR-003): the partner already bought the same list item, and both purchases are real.
 * "Keep both" only closes the notice; "Put one back" returns this shopper's batch through the normal unbuy path.
 */
function AlsoBought({ name, onKeep, onPutBack }: { name: string; onKeep: () => void; onPutBack: () => void }) {
  return (
    <Stack gap={8}>
      <span>Partner also bought {name}.</span>
      <Group gap="xs">
        <Button size="compact-sm" variant="default" onClick={onKeep}>Keep both</Button>
        <Button size="compact-sm" variant="default" onClick={onPutBack}>Put one back</Button>
      </Group>
    </Stack>
  )
}
