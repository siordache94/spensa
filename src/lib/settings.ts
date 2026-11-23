import { useSyncExternalStore } from 'react'

export type ThemeName = 'light' | 'dark' | 'amoled'
export type Density = 'compact' | 'airy'
export type Settings = { theme: ThemeName; density: Density }

const KEY = 'spensa.settings'
const themes: ThemeName[] = ['light', 'dark', 'amoled']
const densities: Density[] = ['compact', 'airy']
const META_COLOR: Record<ThemeName, string> = { light: '#E6E8EB', dark: '#0B0D10', amoled: '#000000' }

type Stored = { theme?: ThemeName; density?: Density }

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored
    const out: Stored = {}
    if (themes.includes(raw.theme as ThemeName)) out.theme = raw.theme
    if (densities.includes(raw.density as Density)) out.density = raw.density
    return out
  } catch {
    return {}
  }
}

function write(s: Stored) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode: setting lasts this session only */ }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
let stored: Stored = read()
let snapshot: Settings = compute()
const listeners = new Set<() => void>()

function compute(): Settings {
  return {
    // No saved theme: follow the system (light or dark; amoled is always a choice).
    theme: stored.theme ?? (media?.matches ? 'light' : 'dark'),
    density: stored.density ?? 'compact',
  }
}

function apply(s: Settings) {
  const root = document.documentElement
  root.dataset.spensaTheme = s.theme
  root.dataset.spensaDensity = s.density
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[s.theme])
}

function refresh() {
  snapshot = compute()
  apply(snapshot)
  listeners.forEach((l) => l())
}

apply(snapshot)
media?.addEventListener('change', () => { if (!stored.theme) refresh() })

export function updateSettings(patch: Partial<Settings>) {
  stored = { ...stored, ...patch }
  write(stored)
  refresh()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useSettings(): [Settings, typeof updateSettings] {
  return [useSyncExternalStore(subscribe, () => snapshot), updateSettings]
}
