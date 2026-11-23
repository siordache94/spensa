import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Box, Button, Card, Group, Loader, Menu, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { usePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import { addDays, replay } from '../domain/replay.ts'
import { memberLabel, useMembers, useMyId } from '../lib/members.ts'
import UseSoon from './UseSoon.tsx'
import { CookModal, MealModal, MoveCopyModal, SlotsModal, useWrite, type Target } from './PlanEntryModals.tsx'

type Meal = NonNullable<ReturnType<typeof usePantry>['meals']>[number]
type Marker = { color: string; text: string }

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
      const unit = ing?.unit === 'count' ? '' : (ing?.unit ?? '')
      add(s.mealId, { color: 'red', text: `short by ${Math.round(s.missing * 10) / 10}${unit} ${ing?.name ?? ''}` })
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
        add(c.mealId, { color: 'yellow', text: `uses expiring ${name(b.ingredientId)?.name ?? ''}` })
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

  return (
    <Stack>
      <UseSoon />
      <Group justify="space-between">
        <Title order={2}>
          {fmt(start, { day: 'numeric', month: 'short' })} – {fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}
        </Title>
        <Button variant="default" size="xs" onClick={() => setDialog({ kind: 'slots' })}>Slots</Button>
      </Group>
      <Group>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(weekOffset - 1)}>Prev</Button>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(0)}>This week</Button>
        <Button variant="default" size="xs" onClick={() => setWeekOffset(weekOffset + 1)}>Next</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 7 }} spacing="xs">
        {days.map((day) => (
          <DayCard key={day} isToday={day === today} scrollIntoView={day === today}>
            <Text fw={600} size="sm">{fmt(day, { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            {/* meals in a slot since removed still count as eaten, so keep showing them */}
            {[...new Set([...household.slots, ...meals.filter((m) => m.date === day).map((m) => m.slot)])].map((slot) => {
              const t = { date: day, slot }
              return (
                <Box key={slot} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, t)} mt="xs">
                  <Group justify="space-between" gap="xs">
                    <Text size="xs" c="dimmed" tt="uppercase">{slot}</Text>
                    <Button variant="subtle" size="compact-xs" aria-label={`Add to ${slot}`} onClick={() => setDialog({ kind: 'add', target: t })}>+</Button>
                  </Group>
                  <Stack gap={4} mih={8}>
                    {inSlot(t).map((m) => (
                      <Menu key={m.id} withinPortal>
                        <Menu.Target>
                          <Box
                            draggable
                            title="Drag to another slot; hold Alt while dropping to copy"
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', m.id)}
                            p={6}
                            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4, cursor: 'pointer' }}
                          >
                            <Text size="sm">{m.recipes ? `${m.recipes.name} × ${m.portions}` : `Deleted recipe × ${m.portions}`}</Text>
                            {m.cook_id && (
                              <span className="sp-cook">{(() => { const c = members?.find((x) => x.user_id === m.cook_id); return c ? memberLabel(c) : '…' })()}</span>
                            )}
                            {(markers.get(m.id) ?? []).map((k, i) => (
                              <Badge key={i} color={k.color} size="xs" variant="light" style={{ height: 'auto', whiteSpace: 'normal' }}>{k.text}</Badge>
                            ))}
                          </Box>
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
                  </Stack>
                </Box>
              )
            })}
          </DayCard>
        ))}
      </SimpleGrid>

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

function DayCard({ isToday, scrollIntoView, children }: { isToday: boolean; scrollIntoView: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Only matters on mobile, where days are stacked; harmless on desktop.
    if (scrollIntoView && window.matchMedia('(max-width: 48em)').matches) ref.current?.scrollIntoView()
  }, [scrollIntoView])
  return (
    <Card ref={ref} withBorder padding="xs" style={isToday ? { borderColor: 'var(--mantine-primary-color-filled)', borderWidth: 2 } : undefined}>
      {children}
    </Card>
  )
}
