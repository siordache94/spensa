import { addDays, type Day } from '../domain/replay.ts'

// A shopping trip is inferred, never stored (CONTEXT.md): today through the household horizon, minus the
// planned meals flagged `skip_shopping`. Only the partner-highlight acks below are per device.

const ACK_KEY = 'spensa.shop.acked'

export function loadAcked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveAcked(ids: string[]) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify(ids.slice(-200))) } catch { /* session only */ }
}

/** The days a trip shops for: today through `horizonDays` days (1 = today only). */
export function tripRange(today: Day, horizonDays: number): { from: Day; to: Day } {
  return { from: today, to: addDays(today, horizonDays - 1) }
}

/** The meals in the trip's range that are not skipped. Skipped meals are still eaten (stock replay), just not shopped for. */
export function selectedMealIds(meals: { id: string; date: Day; skip_shopping: boolean }[], from: Day, to: Day): Set<string> {
  return new Set(meals.filter((m) => m.date >= from && m.date <= to && !m.skip_shopping).map((m) => m.id))
}

/**
 * What changed on the still-to-buy list between two renders, by entry key. Keys in `resolved` that vanished were
 * bought (they moved to the cart), not dropped from the list, so they are not counted as removed.
 */
export function diffToBuy(prev: Iterable<string>, next: Iterable<string>, resolved: ReadonlySet<string> = new Set()) {
  const before = new Set(prev)
  const after = new Set(next)
  return {
    added: [...after].filter((k) => !before.has(k)),
    removed: [...before].filter((k) => !after.has(k) && !resolved.has(k)),
  }
}

/** "Anna changed the list: 2 added, 1 removed", or null when nothing changed. */
export function changeMessage(who: string, diff: { added: unknown[]; removed: unknown[] }): string | null {
  const parts = [diff.added.length && `${diff.added.length} added`, diff.removed.length && `${diff.removed.length} removed`].filter(Boolean)
  return parts.length ? `${who} changed the list: ${parts.join(', ')}` : null
}

/** "just now", "4 min", "2 h". */
export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  return `${Math.round(s / 3600)} h`
}
