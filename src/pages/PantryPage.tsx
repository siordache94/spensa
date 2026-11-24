import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Button, Group, Menu, Modal, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconX } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshPantry, usePantryState } from '../lib/api/pantry.ts'
import { formatDay, formatQuantity, round3, visibleUnit } from '../lib/format.ts'
import { setPantryOnHand } from '../lib/api/shop.ts'
import { useCommand } from '../lib/api/command.ts'
import type { Tables } from '../lib/database.types.ts'
import { addDays, byExpiry, type Day } from '../domain/replay.ts'
import { diffEdits, type EditLine } from '../domain/pantryEdits.ts'
import {
  clearPantryDraft,
  draftNeedsRebase,
  droppedEditCount,
  loadPantryDraft,
  onHandChanges,
  rebaseDraft,
  savePantryDraft,
  type DroppedChange,
  type DroppedEdit,
  type PantryDraft,
} from '../lib/pantryDraft.ts'
import { useSavePantryDraft } from '../lib/pantryDraftActions.ts'
import { useDirtyGuard, useModalOverlay } from '../lib/navigation.ts'
import { applyQuickAction, changeSummary, type QuickAction } from '../lib/pantryQuick.ts'
import { Stepper } from '../components/Stepper.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { amountStep } from '../lib/amountStep.ts'
import UseSoon from './UseSoon.tsx'
import './pantry.css'
import './lists.css'

type Ingredient = Tables<'ingredients'>

type Line = EditLine
type Base = { lines: Line[]; shown: string[] }
// origin = the lines when editing began; the diff is against it, so a partner's changes meanwhile are never overwritten.
type Draft = PantryDraft

const EPS = 1e-9
// A row marked Removed is on its way out, so it no longer counts towards the ingredient's total.
const total = (lines: Line[]) => round3(lines.reduce((s, l) => s + (!l.removed && l.qty && l.qty > 0 ? l.qty : 0), 0))
const valid = (l: Line) => l.qty !== null && Number.isFinite(l.qty) && l.qty >= 0
const DROPPED: Record<DroppedChange, string> = { amount: 'amount', expiry: 'expiry', removal: 'finished / threw away' }
let nextKey = 0

const shortDate = (d: Day) => formatDay(d)
// The pantry body is full-bleed; its empty states keep the page's 16px inset (the rows add their own).
const EMPTY_PAD = { paddingInline: 'var(--mantine-spacing-md)' } as const

function hint(expiry: Day, today: Day, expiringDays: number) {
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000)
  if (days < 0) return { expired: true, text: 'Expired' }
  if (expiry > addDays(today, expiringDays)) return null
  return { expired: false, text: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}` }
}

export default function PantryPage() {
  const queryClient = useQueryClient()
  const {
    events, ingredients, household, today: day, isPending, error, isFetching, remaining, stockByIngredient: stock, version,
  } = usePantryState()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  // null = untouched: show the server state. Once edited, the draft wins and refetches are ignored.
  const [draft, setDraft] = useState<Draft | null>(null)
  // Non-null after a version mismatch restored a draft: the banner lists edits the partner's changes made impossible.
  const [rebased, setRebased] = useState<DroppedEdit[] | null>(null)
  const [restoredFor, setRestoredFor] = useState<string | null>(null)
  // The line a new batch just created: after render it is scrolled into view and focused (MR-032).
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const newRow = useRef<HTMLDivElement>(null)
  // One revealed batch panel at a time (MR-019): the corrections are a tap away, not another form on the page.
  const [openKey, setOpenKey] = useState<string | null>(null)
  // The one compact amount sheet Used and Set remaining share. Closing it changes nothing.
  const [sheet, setSheet] = useState<{ key: string; action: 'used' | 'set' } | null>(null)
  const [askingDiscard, setAskingDiscard] = useState(false)

  // Stock is replayed, never stored (src/domain/replay.ts).
  const base = useMemo<Base | null>(() => {
    if (!events || !day || !remaining || !stock) return null
    const lines: Line[] = []
    const shown: string[] = []
    for (const i of [...(ingredients ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (i.unit === 'to_taste' || (stock.get(i.id) ?? 0) <= 0) continue
      shown.push(i.id)
      events.batches
        .filter((b) => b.ingredientId === i.id && (remaining.get(b.id) ?? 0) > EPS)
        .sort(byExpiry)
        .forEach((b) => lines.push({ key: b.id, batchId: b.id, ingredientId: i.id, qty: round3(remaining.get(b.id) ?? 0), expiry: b.expiresOn }))
    }
    return { lines, shown }
  }, [events, ingredients, day, remaining, stock])

  const view: Draft | null = draft ?? (base && { ...base, origin: base.lines, version, onHand: {} })
  const dirty = draft !== null

  // Leaving edit mode (save, discard, Cancel or the back guard) drops the revealed panel and any open sheet with the
  // draft, so a later edit never reopens stale UI.
  const closeEditor = () => {
    if (household) clearPantryDraft(household.id)
    setDraft(null)
    setEditing(false)
    setRebased(null)
    setOpenKey(null)
    setSheet(null)
    setAskingDiscard(false)
  }

  // Leaving with a draft asks first (MR-051): back, a tab tap and a reload all go through the same question.
  // Discard clears the saved draft, so returning to Pantry starts from the server facts (MR-013).
  useDirtyGuard(dirty, closeEditor)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const edit = (fn: (d: Draft) => Draft) =>
    setDraft((d) => fn(d ?? { ...base!, origin: base!.lines, version, onHand: {} }))
  const patch = (key: string, p: Partial<Line>) => edit((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }))
  const addLine = (i: Ingredient) => {
    const key = `new-${nextKey++}`
    edit((d) => ({
      ...d,
      shown: d.shown.includes(i.id) ? d.shown : [...d.shown, i.id],
      lines: [...d.lines, { key, batchId: null, ingredientId: i.id, qty: i.pack_size ? Number(i.pack_size) : 1, expiry: null }],
    }))
    // A filter that hides the new name would hide the row we are about to reveal.
    if (!i.name.toLowerCase().includes(search.trim().toLowerCase())) setSearch('')
    setFocusKey(key)
  }

  useEffect(() => {
    const el = newRow.current
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
  }, [focusKey])
  // Quick corrections write to the draft (never the server): Used and Set remaining share the amount sheet, Finished
  // and Threw away are one tap. After an action the panel closes and the row shows the pending change (MR-019).
  const act = (l: Line, action: QuickAction) => {
    if (action === 'used' || action === 'set') {
      setSheet({ key: l.key, action })
      return
    }
    patch(l.key, applyQuickAction(l, action))
    setOpenKey(null)
  }
  const remove = (l: Line, reason: 'finished' | 'discard') => {
    if (l.batchId === null) edit((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))
    else patch(l.key, { removed: reason })
    setOpenKey(null)
  }

  // Only what changed is written (adjustments, new batches, expiry fixes, to-taste switches), never a snapshot.
  const save = useSavePantryDraft({ onSuccess: closeEditor })

  // Restore a draft saved before a tab switch or reload. If the household moved meanwhile, replay the diff onto the
  // fresh base and keep the user's explicit edits; never resurrect a batch the partner removed.
  useEffect(() => {
    if (!household || !base || restoredFor === household.id) return
    // A different household means a different draft; never carry the old one across.
    if (restoredFor !== null) {
      setDraft(null)
      setRebased(null)
      setEditing(false)
    }
    setRestoredFor(household.id)
    const stored = loadPantryDraft(household.id)
    if (!stored) return
    // New lines are keyed new-0, new-1, ...; continue above the highest key the restored draft already uses.
    for (const line of stored.lines) {
      const match = /^new-(\d+)$/.exec(line.key)
      if (match) nextKey = Math.max(nextKey, Number(match[1]) + 1)
    }
    if (draftNeedsRebase(stored.version, version)) {
      const merged = rebaseDraft(stored.origin, stored.lines, base)
      setDraft({ lines: merged.lines, shown: merged.shown, origin: merged.origin, version, onHand: stored.onHand })
      setRebased(merged.dropped)
    } else {
      setDraft({ ...stored, version: version ?? stored.version })
    }
    setEditing(true)
  }, [household, base, version, restoredFor])

  useEffect(() => {
    if (!household || !draft || restoredFor !== household.id) return
    savePantryDraft(household.id, draft)
  }, [household, draft, restoredFor])

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id, i])), [ingredients])
  const toTaste = useMemo(() => (ingredients ?? []).filter((i) => i.unit === 'to_taste').sort((a, b) => a.name.localeCompare(b.name)), [ingredients])

  // Saved data on screen: a failed refresh gets an inline notice. No saved data: the page's own error.
  const hasData = events !== undefined && household !== undefined && ingredients !== undefined
  const retry = () => { void refreshPantry(queryClient) }
  if (error && !hasData) return <ErrorState title="Couldn't load the pantry" onRetry={retry} retrying={isFetching} />
  if (isPending || !view || !day || !household || !ingredients) return <Loading label="Loading pantry" />

  const needle = search.trim().toLowerCase()
  const catalogEmpty = ingredients.length === 0
  const addable = ingredients
    .filter((i) => i.unit !== 'to_taste' && !view.shown.includes(i.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ value: i.id, label: i.name }))
  const visible = view.shown.filter((id) => byId.get(id)?.name.toLowerCase().includes(needle))
  const droppedCount = rebased ? droppedEditCount(rebased) : 0
  // What each existing batch was when editing began: the origin the inline change line compares against.
  const originByKey = new Map(view.origin.map((l) => [l.key, l]))
  const sheetLine = sheet ? view.lines.find((l) => l.key === sheet.key) : undefined

  return (
    <Stack className="sp-pantry">
      <Group justify="space-between" wrap="nowrap">
        <h1 className="sp-title">Pantry</h1>
        {!editing && (
          <ActionIcon variant="subtle" color="gray" size={44} aria-label="Edit pantry" onClick={() => setEditing(true)}>
            <IconPencil size={22} />
          </ActionIcon>
        )}
      </Group>

      {error && <ErrorState variant="inline" message="Can't refresh. Showing the saved pantry." onRetry={retry} retrying={isFetching} />}

      {rebased !== null && (
        <Alert color="yellow" variant="light" withCloseButton closeButtonLabel="Dismiss" onClose={() => setRebased(null)}>
          <Text size="sm">
            Updated with your partner's changes
            {droppedCount > 0 && ` · ${droppedCount} of your edits could not be applied — review`}
          </Text>
          {droppedCount > 0 && (
            <ul className="sp-inv-dropped">
              {rebased.map((edit) => (
                <li key={edit.batchId}>
                  {byId.get(edit.ingredientId)?.name ?? 'A removed batch'}: {edit.changes.map((change) => DROPPED[change]).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <UseSoon />

      <TextInput aria-label="Search pantry" placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      <div className="sp-inv-body" data-editing={editing ? '' : undefined}>
        {editing && !catalogEmpty && (
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
        )}
        {editing && (
          <Text size="sm" c="dimmed" className="sp-inv-help">
            Amounts already account for today's planned meals. Correct what's off; 0 means gone.
          </Text>
        )}
        {save.error && <Alert color="red" mx="md" mb="xs">{save.error.message}</Alert>}
        {view.shown.length === 0 && !editing && (
          <div style={EMPTY_PAD}>
            {catalogEmpty ? (
              <EmptyState
                title="No ingredients yet"
                reason="Add ingredients first."
                action={{ label: 'Go to Ingredients', to: '/ingredients' }}
              />
            ) : (
              <EmptyState
                title="Nothing in the pantry"
                reason="Add what you have."
                action={{ label: 'Add items', onClick: () => setEditing(true) }}
              />
            )}
          </div>
        )}
        {view.shown.length === 0 && editing && (
          <div style={EMPTY_PAD}>
            <EmptyState
              title={catalogEmpty ? 'No ingredients yet' : 'Nothing in the pantry'}
              reason={catalogEmpty ? 'Add ingredients first.' : 'Add an item above.'}
              action={catalogEmpty ? { label: 'Go to Ingredients', to: '/ingredients' } : undefined}
            />
          </div>
        )}
        {view.shown.length > 0 && visible.length === 0 && (
          <div style={EMPTY_PAD}>
            <EmptyState
              title="No matches"
              reason={`Nothing matches “${search.trim()}”.`}
              action={{ label: 'Clear search', onClick: () => setSearch('') }}
            />
          </div>
        )}

        {visible.map((id) => {
          const ing = byId.get(id)!
          const mine = view.lines.filter((l) => l.ingredientId === id)
          const unit = visibleUnit(ing.unit)
          if (!editing) {
            const rows = mine.map((l) => ({ l, h: l.expiry ? hint(l.expiry, day, household.expiring_days) : null }))
            const detailed = mine.length > 1 || mine.some((l) => l.expiry)
            return (
              // A read row is one tap target that opens the editor, exactly like the pencil (MR-019): no read-mode
              // sheet, so the quick corrections always write to the same draft the Save bar persists.
              <button
                key={id}
                type="button"
                className="sp-inv-read"
                onClick={() => setEditing(true)}
              >
                <span className="sp-inv-rname">
                  {ing.name}
                  {detailed && rows.map(({ l, h }) => (
                    <span key={l.key} className="sp-inv-sub">
                      {formatQuantity(l.qty ?? 0, ing.unit)}{l.expiry && ` · expires ${shortDate(l.expiry)}`}
                      {h && <span className="sp-inv-hint" data-expired={h.expired ? '' : undefined}>{h.text}</span>}
                    </span>
                  ))}
                </span>
                <span className="sp-inv-amt">{total(mine)}<small>{unit}</small></span>
              </button>
            )
          }
          return (
            <section key={id} aria-label={ing.name}>
              <div className="sp-inv-band">
                <span className="sp-inv-name">{ing.name}</span>
                {mine.length > 1 && <span className="sp-inv-total">{formatQuantity(total(mine), ing.unit)}</span>}
              </div>
              {mine.map((l) => {
                const gone = !!l.removed
                const h = !gone && l.expiry ? hint(l.expiry, day, household.expiring_days) : null
                const focused = l.key === focusKey
                // A line added in this edit is a purchase, not a correction: it keeps the direct amount control and
                // never gets Finished / Threw away or a change line.
                if (l.batchId === null) {
                  return (
                    <div
                      key={l.key}
                      ref={focused ? newRow : undefined}
                      tabIndex={focused ? -1 : undefined}
                      className="sp-inv-row"
                      data-kind="new"
                    >
                      <div className="sp-inv-amount">
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
                      </div>
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
                      <ActionIcon
                        className="sp-inv-remove"
                        variant="subtle"
                        color="gray"
                        size={44}
                        aria-label={`Remove ${ing.name} line`}
                        onClick={() => remove(l, 'discard')}
                      >
                        <IconX size={20} />
                      </ActionIcon>
                      {h && <span className="sp-inv-hint" data-expired={h.expired ? '' : undefined}>{h.text}</span>}
                    </div>
                  )
                }
                // An existing batch is a tappable summary (MR-019): amount or pending change over its expiry, with the
                // remove control beside it. Tapping reveals the four corrections and the expiry picker, one batch at a
                // time, so the list stays a list.
                const origin = originByKey.get(l.key)
                const summary = changeSummary(l, origin, ing.unit)
                const open = openKey === l.key
                const panelId = `sp-inv-actions-${l.key}`
                const now = formatQuantity(l.qty ?? 0, ing.unit)
                const label = summary
                  ? l.removed
                    ? `Adjust ${ing.name}, ${now}, ${l.removed === 'finished' ? 'finished' : 'threw away'}`
                    : `Adjust ${ing.name}, ${formatQuantity(origin?.qty ?? 0, ing.unit)}, now ${now}`
                  : `Adjust ${ing.name}, ${now}`
                return (
                  <div
                    key={l.key}
                    ref={focused ? newRow : undefined}
                    tabIndex={focused ? -1 : undefined}
                    className="sp-inv-row"
                    data-kind="batch"
                    data-open={open ? '' : undefined}
                  >
                    <button
                      type="button"
                      className="sp-inv-summary"
                      aria-label={label}
                      aria-expanded={open}
                      aria-controls={open ? panelId : undefined}
                      onClick={() => setOpenKey(open ? null : l.key)}
                    >
                      <span className="sp-inv-sum" data-gone={gone ? '' : undefined}>{summary ?? now}</span>
                      {!gone && l.expiry && <span className="sp-inv-sum-meta">expires {shortDate(l.expiry)}</span>}
                    </button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Remove ${ing.name} batch`}>
                          <IconX size={20} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label className="sp-menu-note">Finished: used up · Threw away: wasted</Menu.Label>
                        <Menu.Item onClick={() => remove(l, 'finished')}>Finished</Menu.Item>
                        <Menu.Item onClick={() => remove(l, 'discard')}>Threw it away</Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    {open && (
                      <div className="sp-inv-actions" id={panelId}>
                        <Button
                          variant="default" size="compact-md" mih={44}
                          aria-label={`Record use of ${ing.name}`}
                          onClick={() => act(l, 'used')}
                        >
                          Used
                        </Button>
                        <Button
                          variant="default" size="compact-md" mih={44}
                          aria-label={`Set remaining ${ing.name}`}
                          onClick={() => act(l, 'set')}
                        >
                          Set remaining
                        </Button>
                        <Button
                          variant="default" size="compact-md" mih={44}
                          aria-label={`Mark ${ing.name} batch finished`}
                          onClick={() => act(l, 'finished')}
                        >
                          Finished
                        </Button>
                        <Button
                          variant="default" size="compact-md" mih={44}
                          aria-label={`Record ${ing.name} batch thrown away`}
                          onClick={() => act(l, 'waste')}
                        >
                          Threw away
                        </Button>
                        {/* Expiry stays an editable correction: it is part of amending this batch, not of the amount. */}
                        <DatePickerInput
                          className="sp-inv-date sp-inv-expiry"
                          label="Expiry"
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
                      </div>
                    )}
                    {h && <span className="sp-inv-hint" data-expired={h.expired ? '' : undefined}>{h.text}</span>}
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

      </div>

      {toTaste.length > 0 && (
        <Stack gap={0}>
          <h3 className="sp-lhead">To taste</h3>
          {toTaste.map((i) => (
            <OnHandRow
              key={i.id}
              ingredient={i}
              editing={editing}
              value={view.onHand[i.id] ?? i.on_hand}
              onChange={(onHand) =>
                edit((d) => {
                  const next = { ...d.onHand }
                  if (onHand === i.on_hand) delete next[i.id]
                  else next[i.id] = onHand
                  return { ...d, onHand: next }
                })
              }
            />
          ))}
        </Stack>
      )}

      {editing && (
        <div className="sp-savebar" role="region" aria-label="Edit pantry">
          <Button
            onClick={() => save.mutate({ edits: diffEdits(view.origin, view.lines), onHand: onHandChanges(view.onHand, ingredients) })}
            disabled={!dirty || !view.lines.every(valid)}
            loading={save.isPending}
          >
            Save changes
          </Button>
          <Button
            variant="default"
            onClick={() => {
              // Nothing to lose with a clean draft: Cancel closes silently. With edits, the same question the back
              // guard asks (MR-019), so a mis-tap never drops a correction.
              if (dirty) setAskingDiscard(true)
              else {
                closeEditor()
                save.reset()
              }
            }}
            disabled={save.isPending}
          >
            {dirty ? 'Discard' : 'Cancel'}
          </Button>
        </div>
      )}

      {sheet && sheetLine && (
        <AmountSheet
          ingredient={byId.get(sheetLine.ingredientId)!}
          line={sheetLine}
          action={sheet.action}
          onClose={() => setSheet(null)}
          onConfirm={(amount) => {
            patch(sheetLine.key, applyQuickAction(sheetLine, sheet.action, amount))
            setSheet(null)
            setOpenKey(null)
          }}
        />
      )}

      {askingDiscard && (
        <DiscardConfirm
          onKeep={() => setAskingDiscard(false)}
          onDiscard={() => {
            closeEditor()
            save.reset()
          }}
        />
      )}
    </Stack>
  )
}

/** The one amount sheet Used and Set remaining share: pre-filled with the draft quantity and its unit (MR-019). */
function AmountSheet({ ingredient, line, action, onConfirm, onClose }: {
  ingredient: Ingredient
  line: Line
  action: 'used' | 'set'
  onConfirm: (amount: number) => void
  onClose: () => void
}) {
  const [value, setValue] = useState<number | null>(line.qty)
  const close = useModalOverlay(onClose)
  const unit = visibleUnit(ingredient.unit)
  const label = action === 'used' ? 'Amount used' : 'Remaining'
  const invalid = value === null || !Number.isFinite(value) || value < 0 || (action === 'used' && value <= 0)

  return (
    <Modal opened onClose={close} title={action === 'used' ? `Used: ${ingredient.name}` : `Set remaining: ${ingredient.name}`} centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">Now {formatQuantity(line.qty ?? 0, ingredient.unit)}</Text>
        <Stepper
          value={value}
          onChange={setValue}
          min={0}
          step={amountStep(ingredient.unit, value)}
          allowDecimal={ingredient.unit !== 'count'}
          unit={unit || undefined}
          label={label}
          aria-label={`${label} for ${ingredient.name}`}
          error={value === null || Number.isNaN(value) ? ' ' : undefined}
        />
        <Group grow>
          <Button variant="default" mih={44} onClick={close}>Cancel</Button>
          <Button mih={44} disabled={invalid} onClick={() => value !== null && onConfirm(value)}>Confirm</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** The save bar's own "Discard changes?" prompt: same words and answer as the tab/back guard. */
function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const close = useModalOverlay(onKeep)

  return (
    <Modal opened onClose={close} title="Discard changes?" centered size="sm" withCloseButton={false}>
      <Text size="sm" mb="md">Your edits will be lost.</Text>
      <Group grow>
        <Button variant="default" data-autofocus onClick={close}>Keep editing</Button>
        <Button color="red" onClick={onDiscard}>Discard</Button>
      </Group>
    </Modal>
  )
}

function OnHandRow({ ingredient, editing, value, onChange }: {
  ingredient: Ingredient
  editing: boolean
  value: boolean
  onChange: (onHand: boolean) => void
}) {
  const toggle = useCommand(setPantryOnHand, { onError: (e) => notifications.show({ color: 'red', message: e.message }) })
  const onHand = editing ? value : toggle.isPending ? !!toggle.variables?.onHand : ingredient.on_hand

  return (
    <div className="sp-lrow">
      <span className="sp-lrow-name">{ingredient.name}</span>
      <Switch
        radius={0}
        checked={onHand}
        label={onHand ? 'On hand' : 'Out'}
        onChange={(e) => (editing ? onChange(e.currentTarget.checked) : toggle.mutate({ id: ingredient.id, onHand: e.currentTarget.checked }))}
      />
    </div>
  )
}
