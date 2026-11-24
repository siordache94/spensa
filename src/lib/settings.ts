import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from './storage.ts'

export type ThemeName = 'light' | 'dark' | 'amoled'
export type Density = 'compact' | 'airy'
/** `theme` is the theme in force; `themeChoice` is the stored pick, or null while the device decides. */
export type Settings = { theme: ThemeName; themeChoice: ThemeName | null; density: Density }
export type SettingsPatch = { themeChoice?: ThemeName | null; density?: Density }

const KEY = 'spensa.settings'
const themes: ThemeName[] = ['light', 'dark', 'amoled']
const densities: Density[] = ['compact', 'airy']
const META_COLOR: Record<ThemeName, string> = { light: '#E6E8EB', dark: '#0B0D10', amoled: '#000000' }

type Stored = { theme?: ThemeName; density?: Density }

const isStored = (v: unknown): v is Stored => typeof v === 'object' && v !== null

function read(): Stored {
  const raw = readJson<Stored>(KEY, isStored, {})
  const out: Stored = {}
  if (themes.includes(raw.theme as ThemeName)) out.theme = raw.theme
  if (densities.includes(raw.density as Density)) out.density = raw.density
  return out
}

// private mode: the setting lasts this session only
const write = (s: Stored) => writeJson(KEY, s)

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
let stored: Stored = read()
let snapshot: Settings = compute()
const listeners = new Set<() => void>()

function compute(): Settings {
  return {
    // No saved theme: follow the system (light or dark; amoled is always a choice).
    theme: stored.theme ?? (media?.matches ? 'light' : 'dark'),
    themeChoice: stored.theme ?? null,
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

export function updateSettings(patch: SettingsPatch) {
  // Auto clears the stored theme, so index.html and this module fall back to the system again.
  if (patch.themeChoice !== undefined) {
    if (patch.themeChoice === null) delete stored.theme
    else stored.theme = patch.themeChoice
  }
  if (patch.density !== undefined) stored.density = patch.density
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
