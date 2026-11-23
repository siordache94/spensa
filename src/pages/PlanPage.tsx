import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Group, Loader, Menu, Stack, Title } from '@mantine/core'
import { usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import { addDays, replay } from '../domain/replay.ts'
import { memberLabel, useMembers, useMyId } from '../lib/members.ts'
import UseSoon from './UseSoon.tsx'
import './plan.css'
import { CookModal, MealModal, MoveCopyModal, SlotsModal, useWrite, type Target } from './PlanEntryModals.tsx'

type Meal = NonNullable<ReturnType<typeof usePantry>['meals']>[number]
type Marker = { kind: 'short' | 'expiring'; text: string }

type Dialog =
  | { kind: 'add'; target: Target }
  | { kind: 'portions'; meal: Meal }
  | { kind: 'move' | 'copy'; meal: Meal }
  | { kind: 'cook'; meal: Meal }
  | { kind: 'slots' }

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })

// Day-of-week of a calendar day string (0 = Sunday), no local timezone involved.
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))

export default function PlanPage() {
  const { household, today, events, ingredients, meals, isPending, error } = usePantry()
  const [weekOffset, setWeekOffset] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const move = useWrite()
  const me = useMyId()
  const members = useMembers().data

  const start = today ? addDays(mondayOf(today), weekOffset * 7) : undefined
  const end = start ? addDays(start, 6) : undefined

  const markers = useMemo(() => {
    const out = new Map<string, Marker[]>()
    if (!events || !ingredients || !household || !today || !end) return out
    const name = (id: string) => ingredients.find((i) => i.id === id)
    const add = (mealId: string, m: Marker) => out.set(mealId, [...(out.get(mealId) ?? []), m])

    for (const s of replay(events, today).shortfalls) {
      const ing = name(s.ingredientId)
      const n = Math.round(s.missing * 10) / 10
      const text = ing?.unit === 'count' ? `${ing.name} × ${n}` : `${ing?.name ?? ''} ${n} ${ing?.unit ?? ''}`.trim()
      add(s.mealId, { kind: 'short', text: `short: ${text}` })
    }
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

  if (isPending) return <Loader />
  if (error) return <Alert color="red">{error.message}</Alert>
  if (!household || !today || !start || !end || !meals) return null

  const inSlot = (t: Target) =>
    meals.filter((m) => m.date === t.date && m.slot === t.slot).sort((a, b) => a.position - b.position)
  const nextPosition = (t: Target) => inSlot(t).length

  const drop = (e: React.DragEvent, t: Target) => {
    e.preventDefault()
    const meal = meals.find((m) => m.id === e.dataTransfer.getData('text/plain'))
    if (!meal || (meal.date === t.date && meal.slot === t.slot && !e.altKey)) return
    const to = { ...t, position: nextPosition(t) }
    move.mutate(
      e.altKey
        ? supabase.from('planned_meals').insert({ ...to, recipe_id: meal.recipe_id, portions: meal.portions })
        : supabase.from('planned_meals').update(to).eq('id', meal.id),
    )
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  // desktop grid aligns slots across columns, so rows are the week's union; a day shows only its own on mobile
  const weekSlots = [...new Set([...household.slots, ...meals.filter((m) => m.date >= start && m.date <= end).map((m) => m.slot)])]

  return (
    <Stack className="sp-planpage">
      <UseSoon />
      <div className="sp-planhead">
      <Group justify="space-between" className="sp-ph-a">
        <Title order={2} className="sp-ph-title">
          {fmt(start, { day: 'numeric', month: 'short' })} – {fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}
        </Title>
        <Button variant="default" size="xs" className="sp-ph-slots" onClick={() => setDialog({ kind: 'slots' })}>Slots</Button>
      </Group>
      <Group className="sp-ph-nav">
        <Button variant="default" size="xs" onClick={() => setWeekOffset(weekOffset - 1)}>Prev</Button>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(0)}>This week</Button>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(weekOffset + 1)}>Next</Button>
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
                    {inSlot(t).map((m) => (
                      <Menu key={m.id} withinPortal>
                        <Menu.Target>
                          <button
                            type="button"
                            className="sp-mealrow"
                            draggable
                            title="Drag to another slot; hold Alt while dropping to copy"
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', m.id)}
                          >
                            <span className="sp-mealname">{m.recipes ? `${m.recipes.name} × ${m.portions}` : `Deleted recipe × ${m.portions}`}</span>
                            {m.cook_id && (() => {
                              const c = members?.find((x) => x.user_id === m.cook_id)
                              return c ? <span className="sp-cook"><b>Cook</b> · {memberLabel(c)}</span> : null
                            })()}
                            {(markers.get(m.id) ?? []).map((k, i) => (
                              <span key={i} className={k.kind === 'short' ? 'sp-mark sp-short' : 'sp-mark sp-exp'}>{k.text}</span>
                            ))}
                          </button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {me && (
                            <Menu.Item onClick={() => move.mutate(supabase.from('planned_meals').update({ cook_id: m.cook_id === me ? null : me }).eq('id', m.id))}>
                              {m.cook_id === me ? "I won't cook" : "I'll cook"}
                            </Menu.Item>
                          )}
                          <Menu.Item onClick={() => setDialog({ kind: 'cook', meal: m })}>Cook…</Menu.Item>
                          <Menu.Item onClick={() => setDialog({ kind: 'portions', meal: m })}>Change portions</Menu.Item>
                          <Menu.Item onClick={() => setDialog({ kind: 'move', meal: m })}>Move to…</Menu.Item>
                          <Menu.Item onClick={() => setDialog({ kind: 'copy', meal: m })}>Copy to…</Menu.Item>
                          <Menu.Item color="red" onClick={() => move.mutate(supabase.from('planned_meals').delete().eq('id', m.id))}>Delete</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    ))}
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
