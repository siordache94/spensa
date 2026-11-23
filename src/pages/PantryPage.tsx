import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Button, Group, Menu, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconX } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshPantry, useSavePantryEdits, usePantryState } from '../lib/api/pantry.ts'
import { round3 } from '../lib/format.ts'
import { setPantryOnHand } from '../lib/api/shop.ts'
import { useCommand } from '../lib/api/command.ts'
import type { Tables } from '../lib/database.types.ts'
import { addDays, byExpiry, type Day } from '../domain/replay.ts'
import { diffEdits, type EditLine } from '../domain/pantryEdits.ts'
import { Stepper } from '../components/Stepper.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { amountStep } from '../lib/amountStep.ts'
import UseSoon from './UseSoon.tsx'
import './pantry.css'
import './lists.css'

type Ingredient = Tables<'ingredients'>

type Line = EditLine
// origin = the lines when editing began; the diff is against it, so a partner's changes meanwhile are never overwritten.
type Draft = { lines: Line[]; shown: string[]; origin: Line[] }

const EPS = 1e-9
const total = (lines: Line[]) => round3(lines.reduce((s, l) => s + (l.qty && l.qty > 0 ? l.qty : 0), 0))
const valid = (l: Line) => l.qty !== null && Number.isFinite(l.qty) && l.qty >= 0
let nextKey = 0

const shortDate = (d: Day) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function hint(expiry: Day, today: Day, expiringDays: number) {
  const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000)
  if (days < 0) return { expired: true, text: 'Expired' }
  if (expiry > addDays(today, expiringDays)) return null
  return { expired: false, text: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}` }
}

export default function PantryPage() {
  const queryClient = useQueryClient()
  const { events, ingredients, household, today: day, isPending, error, isFetching, remaining, stockByIngredient: stock } = usePantryState()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  // null = untouched: show the server state. Once edited, the draft wins and refetches are ignored.
  const [draft, setDraft] = useState<Draft | null>(null)

  // Stock is replayed, never stored (src/domain/replay.ts).
  const base = useMemo<Omit<Draft, 'origin'> | null>(() => {
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

  const view: Draft | null = draft ?? (base && { ...base, origin: base.lines })
  const dirty = draft !== null
  const edit = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d ?? { ...base!, origin: base!.lines }))
  const patch = (key: string, p: Partial<Line>) => edit((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }))
  const addLine = (i: Ingredient) =>
    edit((d) => ({
      ...d,
      shown: d.shown.includes(i.id) ? d.shown : [...d.shown, i.id],
      lines: [...d.lines, { key: `new-${nextKey++}`, batchId: null, ingredientId: i.id, qty: i.pack_size ? Number(i.pack_size) : 1, expiry: null }],
    }))
  const remove = (l: Line, reason: 'finished' | 'discard') =>
    l.batchId === null ? edit((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) })) : patch(l.key, { removed: reason })

  // Only what changed is written (adjustments, new batches, expiry fixes), never a snapshot.
  const save = useSavePantryEdits({ onSuccess: () => { setDraft(null); setEditing(false) } })

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id, i])), [ingredients])
  const toTaste = useMemo(() => (ingredients ?? []).filter((i) => i.unit === 'to_taste').sort((a, b) => a.name.localeCompare(b.name)), [ingredients])

  // Saved data on screen: a failed refresh gets an inline notice. No saved data: the page's own error.
  const hasData = events !== undefined && household !== undefined && ingredients !== undefined
  const retry = () => { void refreshPantry(queryClient) }
  if (error && !hasData) return <ErrorState title="Couldn't load the pantry" onRetry={retry} retrying={isFetching} />
  if (isPending || !view || !day || !household || !ingredients) return <Loading label="Loading pantry" />

  const needle = search.trim().toLowerCase()
  const addable = ingredients
    .filter((i) => i.unit !== 'to_taste' && !view.shown.includes(i.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ value: i.id, label: i.name }))
  const visible = view.shown.filter((id) => byId.get(id)?.name.toLowerCase().includes(needle))

  return (
    <Stack className="sp-pantry">
      <Group justify="space-between" wrap="nowrap">
        <Title order={2}>Pantry</Title>
        {!editing && (
          <ActionIcon variant="subtle" color="gray" size={44} aria-label="Edit pantry" onClick={() => setEditing(true)}>
            <IconPencil size={22} />
          </ActionIcon>
        )}
      </Group>

      {error && <ErrorState variant="inline" onRetry={retry} retrying={isFetching} />}

      <UseSoon />

      <TextInput placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />

      <div className="sp-inv-body" data-editing={editing ? '' : undefined}>
        {editing && (
          <Text size="sm" c="dimmed" className="sp-inv-help">
            Amounts already account for today's planned meals. Correct what's off; 0 means gone.
          </Text>
        )}
        {save.error && <Alert color="red" mx="md" mb="xs">{save.error.message}</Alert>}
        {view.shown.length === 0 && !editing && (
          <Stack align="flex-start" px="md" py="md" gap="sm">
            <Text>Nothing in the pantry yet.</Text>
            <Button onClick={() => setEditing(true)}>Add items</Button>
          </Stack>
        )}
        {view.shown.length === 0 && editing && <Text px="md" c="dimmed">Nothing in the pantry yet. Add an item below.</Text>}
        {view.shown.length > 0 && visible.length === 0 && <Text px="md" c="dimmed">No matches.</Text>}

        {visible.map((id) => {
          const ing = byId.get(id)!
          const mine = view.lines.filter((l) => l.ingredientId === id)
          const unit = ing.unit === 'count' ? '' : ing.unit
          if (!editing) {
            const rows = mine.map((l) => ({ l, h: l.expiry ? hint(l.expiry, day, household.expiring_days) : null }))
            const detailed = mine.length > 1 || mine.some((l) => l.expiry)
            return (
              <div key={id} className="sp-inv-read">
                <div className="sp-inv-rname">
                  {ing.name}
                  {detailed && rows.map(({ l, h }) => (
                    <span key={l.key} className="sp-inv-sub">
                      {l.qty}{unit && ` ${unit}`}{l.expiry && ` · expires ${shortDate(l.expiry)}`}
                      {h && <span className="sp-inv-hint" data-expired={h.expired ? '' : undefined}>{h.text}</span>}
                    </span>
                  ))}
                </div>
                <span className="sp-inv-amt">{total(mine)}<small>{unit}</small></span>
              </div>
            )
          }
          return (
            <section key={id} aria-label={ing.name}>
              <div className="sp-inv-band">
                <span className="sp-inv-name">{ing.name}</span>
                {mine.length > 1 && <span className="sp-inv-total">{total(mine)}{unit && ` ${unit}`}</span>}
              </div>
              {mine.map((l) => {
                const gone = !!l.removed
                const h = !gone && l.expiry ? hint(l.expiry, day, household.expiring_days) : null
                return (
                  <div key={l.key} className="sp-inv-row" data-removed={gone ? '' : undefined}>
                    {gone ? (
                      <>
                        <span className="sp-inv-gone">Removed</span>
                        <Button variant="subtle" size="compact-md" miw={44} mih={44} onClick={() => patch(l.key, { removed: undefined })}>
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
                        {l.batchId === null ? (
                          <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Remove ${ing.name} line`} onClick={() => remove(l, 'discard')}>
                            <IconX size={20} />
                          </ActionIcon>
                        ) : (
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Remove ${ing.name} batch`}>
                                <IconX size={20} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item onClick={() => remove(l, 'finished')}>Finished</Menu.Item>
                              <Menu.Item onClick={() => remove(l, 'discard')}>Threw it away</Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        )}
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

        {editing && (
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
      </div>

      {toTaste.length > 0 && (
        <Stack gap={0}>
          <h3 className="sp-lhead">To taste</h3>
          {toTaste.map((i) => <OnHandRow key={i.id} ingredient={i} />)}
        </Stack>
      )}

      {editing && (
        <div className="sp-savebar" role="region" aria-label="Edit pantry">
          <Button onClick={() => save.mutate(diffEdits(view.origin, view.lines))} disabled={!dirty || !view.lines.every(valid)} loading={save.isPending}>Save changes</Button>
          <Button variant="default" onClick={() => { setDraft(null); setEditing(false); save.reset() }} disabled={save.isPending}>{dirty ? 'Discard' : 'Cancel'}</Button>
        </div>
      )}
    </Stack>
  )
}

function OnHandRow({ ingredient }: { ingredient: Ingredient }) {
  const toggle = useCommand(setPantryOnHand, { onError: (e) => notifications.show({ color: 'red', message: e.message }) })
  const onHand = toggle.isPending ? !!toggle.variables?.onHand : ingredient.on_hand

  return (
    <div className="sp-lrow">
      <span className="sp-lrow-name">{ingredient.name}</span>
      <Switch radius={0} checked={onHand} label={onHand ? 'On hand' : 'Out'} onChange={(e) => toggle.mutate({ id: ingredient.id, onHand: e.currentTarget.checked })} />
    </div>
  )
}
