import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Group, Menu, Stack, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { refreshPantry, usePantry } from '../lib/api/pantry.ts'
import { ErrorState } from '../components/ErrorState.tsx'
import { Loading } from '../components/Loading.tsx'
import { useCommand } from '../lib/api/command.ts'
import { addMeal, deleteMeal, moveMeal, setMealCook } from '../lib/api/plan.ts'
import { addDays, replay } from '../domain/replay.ts'
import { useMyId } from '../lib/api/auth.ts'
import { memberLabel, useMembers } from '../lib/api/household.ts'
import { parseCheckinParams } from '../lib/checkin.ts'
import { useUnreadCheckins } from '../lib/api/checkins.ts'
import UseSoon from './UseSoon.tsx'
import NotifyPrompt from '../components/NotifyPrompt.tsx'
import './plan.css'
import { CookModal, MealModal, MoveCopyModal, notifyFailure, SlotsModal, type Target } from './PlanEntryModals.tsx'
import { AmountsModal, CheckinSheet, checkinFailure, useCheckinActions } from './CheckinModals.tsx'

type Meal = NonNullable<ReturnType<typeof usePantry>['meals']>[number]
type Marker = { kind: 'expiring'; text: string }

type Dialog =
  | { kind: 'add'; target: Target }
  | { kind: 'portions'; meal: Meal }
  | { kind: 'move' | 'copy'; meal: Meal }
  | { kind: 'cook'; meal: Meal }
  | { kind: 'checkin'; mealId: string }
  | { kind: 'amounts'; mealId: string }
  | { kind: 'slots' }

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })

// Day-of-week of a calendar day string (0 = Sunday), no local timezone involved.
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))

// Relative name for the shown week: "This week", "Next week", "Last week", "In 2 weeks", "3 weeks ago".
const relativeWeek = (offset: number) => {
  if (offset === 0) return 'This week'
  if (offset === 1) return 'Next week'
  if (offset === -1) return 'Last week'
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`
}

export default function PlanPage() {
  const queryClient = useQueryClient()
  const { household, today, events, ingredients, meals, isPending, error, isFetching } = usePantry()
  const [weekOffset, setWeekOffset] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const move = useCommand(moveMeal, { onError: notifyFailure })
  const copy = useCommand(addMeal, { onError: notifyFailure })
  const setCook = useCommand(setMealCook, { onError: notifyFailure })
  const remove = useCommand(deleteMeal, { onError: notifyFailure })
  const me = useMyId()
  const members = useMembers().data
  const unread = useUnreadCheckins()
  const unreadByMeal = useMemo(() => new Map(unread.items.map((u) => [u.mealId, u])), [unread.items])
  const { answer, notCooked } = useCheckinActions()

  const start = today ? addDays(mondayOf(today), weekOffset * 7) : undefined
  const end = start ? addDays(start, 6) : undefined

  const markers = useMemo(() => {
    const out = new Map<string, Marker[]>()
    if (!events || !ingredients || !household || !today || !end) return out
    const name = (id: string) => ingredients.find((i) => i.id === id)
    const add = (mealId: string, m: Marker) => out.set(mealId, [...(out.get(mealId) ?? []), m])

    if (end > today) {
      const limit = addDays(today, household.expiring_days)
      const expiry = new Map(events.batches.map((b) => [b.id, b]))
      const seen = new Set<string>()
      for (const c of replay(events, end).consumed) {
        const b = expiry.get(c.batchId)
        const key = `${c.mealId}:${b?.ingredientId}`
        if (!b?.expiresOn || b.expiresOn > limit || seen.has(key)) continue
        seen.add(key)
        add(c.mealId, { kind: 'expiring', text: `Uses expiring ${name(b.ingredientId)?.name ?? ''}` })
      }
    }
    return out
  }, [events, ingredients, household, today, end])

  // Deep links from a notification (ADR 0005): ?meal=<id>&checkin=<answer>. Handled once, when the meals are in.
  const linkHandled = useRef(false)
  useEffect(() => {
    if (linkHandled.current || !meals) return
    const link = parseCheckinParams(window.location.search)
    if (!link) return
    linkHandled.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete('meal')
    url.searchParams.delete('checkin')
    history.replaceState(history.state, '', url)
    if (!meals.some((m) => m.id === link.mealId)) return
    if (link.answer === 'planned') {
      answer.mutate({ mealId: link.mealId, answer: 'planned' }, {
        onSuccess: (done) => notifications.show({ message: done ? 'Marked as cooked' : 'This meal was already answered.' }),
        onError: checkinFailure,
      })
    } else if (link.answer === 'changed') {
      setDialog({ kind: 'amounts', mealId: link.mealId })
    } else {
      setDialog({ kind: 'checkin', mealId: link.mealId })
    }
  }, [meals])

  // Saved plan on screen: a failed refresh gets an inline notice. No saved plan: the page's own error.
  const hasData = household !== undefined && meals !== undefined
  const retry = () => { void refreshPantry(queryClient) }
  if (error && !hasData) return <ErrorState title="Couldn't load the plan" onRetry={retry} retrying={isFetching} />
  if (isPending) return <Loading label="Loading plan" />
  if (!household || !today || !start || !end || !meals) return null

  const dialogMeal = dialog && 'mealId' in dialog ? meals.find((m) => m.id === dialog.mealId) : undefined

  const inSlot = (t: Target) =>
    meals.filter((m) => m.date === t.date && m.slot === t.slot).sort((a, b) => a.position - b.position)
  const nextPosition = (t: Target) => inSlot(t).length

  const drop = (e: React.DragEvent, t: Target) => {
    e.preventDefault()
    const meal = meals.find((m) => m.id === e.dataTransfer.getData('text/plain'))
    if (!meal || (meal.date === t.date && meal.slot === t.slot && !e.altKey)) return
    const to = { ...t, position: nextPosition(t) }
    if (e.altKey) copy.mutate({ ...to, recipe_id: meal.recipe_id, portions: meal.portions })
    else move.mutate({ id: meal.id, to })
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  // desktop grid aligns slots across columns, so rows are the week's union; a day shows only its own on mobile
  const weekSlots = [...new Set([...household.slots, ...meals.filter((m) => m.date >= start && m.date <= end).map((m) => m.slot)])]

  return (
    <Stack className="sp-planpage">
      {error && <ErrorState variant="inline" onRetry={retry} retrying={isFetching} />}
      <NotifyPrompt />
      <UseSoon />
      <div className="sp-planhead">
      <Group justify="space-between" className="sp-ph-a">
        <Title order={2} className="sp-ph-title">
          {fmt(start, { day: 'numeric', month: 'short' })} – {fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}
          <span className="sp-ph-rel">{relativeWeek(weekOffset)}</span>
        </Title>
        <Button variant="default" size="xs" className="sp-ph-slots" onClick={() => setDialog({ kind: 'slots' })}>Slots</Button>
      </Group>
      <Group className="sp-ph-nav">
        <ActionIcon variant="default" size={44} aria-label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>
          <IconChevronLeft size={20} />
        </ActionIcon>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(0)}>This week</Button>
        <ActionIcon variant="default" size={44} aria-label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>
          <IconChevronRight size={20} />
        </ActionIcon>
      </Group>
      </div>

      <div className="sp-plan" style={{ '--sp-plan-rows': weekSlots.length } as React.CSSProperties}>
        <div className="sp-gutter" aria-hidden="true">
          <span className="sp-gutterhead" />
          {weekSlots.map((slot) => <span key={slot} className="sp-gutterslot">{slot}</span>)}
        </div>
        {days.map((day) => (
          <DayBand key={day} isToday={day === today} scrollIntoView={day === today} label={fmt(day, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '')}>
            {/* meals in a slot since removed still count as eaten, so keep showing them */}
            {weekSlots.map((slot) => {
              const t = { date: day, slot }
              const own = household.slots.includes(slot) || meals.some((m) => m.date === day && m.slot === slot)
              return (
                <div key={slot} className={own ? 'sp-slotrow' : 'sp-slotrow sp-ghost'} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, t)}>
                  <span className="sp-slotname">{slot}</span>
                  <div className="sp-slotmeals">
                    {inSlot(t).map((m) => {
                      const toConfirm = unreadByMeal.has(m.id)
                      return (
                        // a meal with an unread check-in opens its check-in sheet instead of the menu (see onChange)
                        <Menu
                          key={m.id}
                          withinPortal
                          opened={menuFor === m.id}
                          onChange={(open) => setMenuFor(open && !toConfirm ? m.id : null)}
                        >
                          <Menu.Target>
                            <button
                              type="button"
                              className={m.not_cooked ? 'sp-mealrow sp-notcooked' : 'sp-mealrow'}
                              draggable
                              title="Drag to another slot; hold Alt while dropping to copy"
                              onClick={toConfirm ? () => setDialog({ kind: 'checkin', mealId: m.id }) : undefined}
                              onDragStart={(e) => e.dataTransfer.setData('text/plain', m.id)}
                            >
                              <span className="sp-mealname">{m.recipes ? `${m.recipes.name} × ${m.portions}` : `Deleted recipe × ${m.portions}`}</span>
                              {m.cook_id && (() => {
                                const c = members?.find((x) => x.user_id === m.cook_id)
                                return c ? <span className="sp-cook"><b>Cook</b> · {memberLabel(c)}</span> : null
                              })()}
                              {m.not_cooked && <span className="sp-mark sp-notcooked-label">Didn't cook</span>}
                              {toConfirm && <span className="sp-mark sp-confirm">To confirm</span>}
                              {(markers.get(m.id) ?? []).map((k, i) => (
                                <span key={i} className="sp-mark sp-exp">{k.text}</span>
                              ))}
                            </button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {me && (
                              <Menu.Item onClick={() => setCook.mutate({ id: m.id, cookId: m.cook_id === me ? null : me })}>
                                {m.cook_id === me ? "I won't cook" : "I'll cook"}
                              </Menu.Item>
                            )}
                            <Menu.Item onClick={() => setDialog({ kind: 'cook', meal: m })}>Cook…</Menu.Item>
                            <Menu.Item onClick={() => setDialog({ kind: 'portions', meal: m })}>Change portions</Menu.Item>
                            <Menu.Item onClick={() => setDialog({ kind: 'amounts', mealId: m.id })}>Edit amounts</Menu.Item>
                            <Menu.Item onClick={() => notCooked.mutate({ mealId: m.id, value: !m.not_cooked }, { onError: checkinFailure })}>
                              {m.not_cooked ? 'Cooked' : "Didn't cook"}
                            </Menu.Item>
                            <Menu.Item onClick={() => setDialog({ kind: 'move', meal: m })}>Move to…</Menu.Item>
                            <Menu.Item onClick={() => setDialog({ kind: 'copy', meal: m })}>Copy to…</Menu.Item>
                            <Menu.Item color="red" onClick={() => remove.mutate({ id: m.id })}>Delete</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )
                    })}
                  </div>
                  <button type="button" className="sp-addmeal" aria-label={`Add to ${slot}`} onClick={() => setDialog({ kind: 'add', target: t })}>+</button>
                </div>
              )
            })}
          </DayBand>
        ))}
      </div>

      {dialog?.kind === 'add' && (
        <MealModal target={dialog.target} position={nextPosition(dialog.target)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'portions' && (
        <MealModal target={dialog.meal} meal={dialog.meal} position={0} onClose={() => setDialog(null)} />
      )}
      {(dialog?.kind === 'move' || dialog?.kind === 'copy') && (
        <MoveCopyModal mode={dialog.kind} meal={dialog.meal} slots={household.slots} position={nextPosition} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'cook' && <CookModal meal={dialog.meal} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'slots' && <SlotsModal slots={household.slots} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'checkin' && dialogMeal && (
        <CheckinSheet
          meal={dialogMeal}
          unread={unreadByMeal.has(dialogMeal.id)}
          onAmounts={() => setDialog({ kind: 'amounts', mealId: dialogMeal.id })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'amounts' && dialogMeal && (
        <AmountsModal
          meal={dialogMeal}
          unread={unreadByMeal.has(dialogMeal.id)}
          ingredients={ingredients ?? []}
          onClose={() => setDialog(null)}
        />
      )}
    </Stack>
  )
}

function DayBand({ isToday, scrollIntoView, label, children }: { isToday: boolean; scrollIntoView: boolean; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (scrollIntoView && window.matchMedia('(max-width: 48em)').matches) ref.current?.scrollIntoView()
  }, [scrollIntoView])
  return (
    <section ref={ref} className={isToday ? 'sp-day sp-today' : 'sp-day'}>
      <h3 className="sp-dayhead">{label}{isToday && <small>Today</small>}</h3>
      {children}
    </section>
  )
}
