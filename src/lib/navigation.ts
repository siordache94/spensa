// One navigation layer for the whole shell (MR-051). The back policy, in order:
//
//   1. An open overlay (modal, sheet, discard prompt) is the top of history: back closes it and stays on the page.
//   2. Unsaved edits (the Pantry draft) prompt: Keep editing stays, Discard leaves exactly once.
//   3. Otherwise back follows normal tab history (a tab tap pushes an entry, as a link always did).
//   4. At the first entry of the session, back is the platform's own exit.
//
// Overlays share one history entry (the "gate"): opening the first overlay pushes it, closing the last pops it, so
// entries never pile up. The model below is pure and tested; the adapter at the bottom keeps it in step with the
// browser History API. React bindings live with the adapter so the policy has one home.
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

/** The layer's state. `overlays` is the open stack, bottom first. */
export type NavState = {
  overlays: readonly number[]
  /** True while the pushed overlay entry is the current history entry. */
  gate: boolean
  /** A page registered unsaved edits that need confirming before leaving. */
  dirty: boolean
}

export const initialNav: NavState = { overlays: [], gate: false, dirty: false }

/** What opening or closing one overlay does to the model and to history. */
export type OverlayStep = {
  state: NavState
  pushGate: boolean
  popGate: boolean
}

/** Opening a modal: the first overlay pushes the shared entry, later ones just stack on it. */
export function openOverlayState(state: NavState, id: number): OverlayStep {
  return {
    state: { ...state, overlays: [...state.overlays, id], gate: true },
    pushGate: state.overlays.length === 0 && !state.gate,
    popGate: false,
  }
}

/** Closing a modal with its own button: the last one pops the shared entry without running any guard. */
export function closeOverlayState(state: NavState, id: number): OverlayStep {
  const overlays = state.overlays.filter((open) => open !== id)
  if (overlays.length === state.overlays.length) return { state, pushGate: false, popGate: false }
  const empty = overlays.length === 0
  return {
    state: { ...state, overlays, gate: empty ? false : state.gate },
    pushGate: false,
    popGate: empty && state.gate,
  }
}

/** The same-document route entries the layer knows about, oldest first. */
export type RouteHistory = { paths: readonly string[]; index: number }

export function initialHistory(path: string): RouteHistory {
  return { paths: [path], index: 0 }
}

/** A tab tap or an in-app link: a deliberate push, truncating any forward entries. */
export function pushRoute(history: RouteHistory, path: string): RouteHistory {
  if (history.paths[history.index] === path) return history
  const paths = [...history.paths.slice(0, history.index + 1), path]
  return { paths, index: paths.length - 1 }
}

export function backRoute(history: RouteHistory): RouteHistory {
  return history.index > 0 ? { ...history, index: history.index - 1 } : history
}

export function currentRoute(history: RouteHistory): string {
  return history.paths[history.index]
}

/** Where a back at this point would land: another route in the session, or the platform's exit. */
export function backTarget(history: RouteHistory): { kind: 'route'; path: string } | { kind: 'exit' } {
  return history.index > 0 ? { kind: 'route', path: history.paths[history.index - 1] } : { kind: 'exit' }
}

/** A prompt waiting on the person: the browser back was held, or a tab/link tap was held. */
export type Pending =
  | { kind: 'back'; target: string; delta: -1 | 1 }
  | { kind: 'link'; to: string }

export type BackInput = {
  nav: NavState
  history: RouteHistory
  prompt: Pending | null
}

export type BackResult =
  | { kind: 'dismiss-prompt'; nav: NavState; history: RouteHistory; prompt: null }
  | { kind: 'close-overlay'; nav: NavState; history: RouteHistory; prompt: Pending | null; id: number; repushGate: boolean }
  | { kind: 'guard'; nav: NavState; history: RouteHistory; prompt: Pending }
  | { kind: 'route'; nav: NavState; history: RouteHistory; prompt: Pending | null; path: string }
  | { kind: 'exit'; nav: NavState; history: RouteHistory; prompt: Pending | null }

/**
 * One back press decided by the policy. The overlay is checked before the dirty guard, so a modal on a dirty page
 * closes first; the guard is checked before route history, so a back never silently drops edits.
 */
export function pressBack({ nav, history, prompt }: BackInput): BackResult {
  if (prompt !== null) return { kind: 'dismiss-prompt', nav, history, prompt: null }

  if (nav.overlays.length > 0) {
    const id = nav.overlays[nav.overlays.length - 1]
    const overlays = nav.overlays.slice(0, -1)
    return {
      kind: 'close-overlay',
      nav: { ...nav, overlays, gate: overlays.length > 0 },
      history,
      prompt,
      id,
      repushGate: overlays.length > 0,
    }
  }

  if (nav.dirty) {
    const target = backTarget(history)
    return {
      kind: 'guard',
      nav,
      history,
      prompt: { kind: 'back', target: target.kind === 'route' ? target.path : '', delta: -1 },
    }
  }

  if (history.index > 0) {
    return { kind: 'route', nav, history: backRoute(history), prompt, path: history.paths[history.index - 1] }
  }

  return { kind: 'exit', nav, history, prompt }
}

export type DiscardResult = {
  nav: NavState
  history: RouteHistory
  prompt: null
  /** Where to navigate now, or null when `goBack` performs the one navigation. */
  navigateTo: string | null
  goBack: boolean
}

/** Discard: clear the dirty flag and perform exactly one navigation to the place back or the tap asked for. */
export function discardEdits({ nav, history, prompt }: BackInput & { prompt: Pending }): DiscardResult {
  const clean = { ...nav, dirty: false }
  if (prompt.kind === 'link') {
    return { nav: clean, history: pushRoute(history, prompt.to), prompt: null, navigateTo: prompt.to, goBack: false }
  }
  if (prompt.delta === -1 && history.index > 0) {
    return { nav: clean, history: backRoute(history), prompt: null, navigateTo: null, goBack: true }
  }
  return { nav: clean, history: pushRoute(history, prompt.target), prompt: null, navigateTo: prompt.target, goBack: false }
}

/** Keep editing: the prompt closes and nothing else moves. */
export function keepEditing(nav: NavState): { nav: NavState; prompt: null } {
  return { nav, prompt: null }
}

/** Page titles, one map for every route (MR-033). */
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Spensa — Plan',
  '/recipes': 'Spensa — Recipes',
  '/pantry': 'Spensa — Pantry',
  '/shop': 'Spensa — Shop',
  '/ingredients': 'Spensa — Ingredients',
  '/settings': 'Spensa — Settings',
}

export function routeTitle(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  return ROUTE_TITLES[path] ?? 'Spensa — Not found'
}

// ---------------------------------------------------------------------------------------------------------------------
// Browser adapter.
// ---------------------------------------------------------------------------------------------------------------------

/** How an overlay answers a back: it closed itself, or it stayed (a dirty form showed the discard prompt instead). */
export type OverlayDismiss = 'closed' | 'stayed'

type Dismiss = () => OverlayDismiss

let started = false
let store: NavState = initialNav
let historyModel: RouteHistory = initialHistory('/')
let pending: Pending | null = null
let snapshot: { pending: Pending | null } = { pending: null }

const dismissals = new Map<number, Dismiss>()
let nextOverlayId = 1
let gateCurrent = false
let gatePopTimer: ReturnType<typeof setTimeout> | null = null
/** Pops that belong to this layer (closing an overlay, discarding) must not run the policy again. */
let suppressedPops = 0
let lastIndex: number | null = null
let lastRouteState: unknown = null
let discardHandler: (() => void) | null = null
let navigateTo: ((to: string) => void) | null = null

const listeners = new Set<() => void>()

const GATE_KEY = '__spNavGate'

function notify(): void {
  snapshot = { pending }
  for (const listener of listeners) listener()
}

export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getNavigationSnapshot(): { pending: Pending | null } {
  return snapshot
}

function pathOf(location: { pathname: string; search: string; hash: string }): string {
  return location.pathname + location.search + location.hash
}

function readIndex(): number | null {
  const state = window.history.state as { idx?: unknown } | null
  return typeof state?.idx === 'number' ? state.idx : null
}

function isGateState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[GATE_KEY] === true
}

/** The router's own state for this entry, without the layer's marker. */
function routeState(): unknown {
  const state = window.history.state as Record<string, unknown> | null
  if (state === null) return null
  const copy = { ...state }
  delete copy[GATE_KEY]
  return copy
}

function pushGateEntry(): void {
  window.history.pushState({ ...(window.history.state ?? {}), [GATE_KEY]: true }, '', window.location.href)
  gateCurrent = true
}

/** Pop the shared entry after the last overlay closed, but let a sibling modal open in the same commit cancel it. */
function scheduleGatePop(): void {
  if (gatePopTimer !== null) return
  gatePopTimer = setTimeout(() => {
    gatePopTimer = null
    if (!gateCurrent || dismissals.size > 0) return
    gateCurrent = false
    suppressedPops += 1
    window.history.back()
  }, 0)
}

function restoreRoute(): void {
  const path = historyModel.paths[historyModel.index] ?? '/'
  window.history.pushState(lastRouteState, '', path)
}

/** Back on the shared entry: close the top overlay. It may answer "stayed" (a dirty form asked first). */
function closeTopOverlay(): void {
  const id = [...dismissals.keys()].at(-1)
  if (id === undefined) return
  const dismiss = dismissals.get(id)
  gateCurrent = false
  const answer = dismiss?.() ?? 'closed'
  if (answer === 'closed') dismissals.delete(id)
  store = { ...store, overlays: [...dismissals.keys()], gate: false }
  notify()
  if (dismissals.size > 0) pushGateEntry()
}

/** Back pressed inside a dirty page: put the URL back, then ask. Nothing is discarded until the person says so. */
function holdBackForGuard(): void {
  const target = pathOf(window.location)
  const previous = historyModel.paths[historyModel.index - 1]
  restoreRoute()
  pending = { kind: 'back', target, delta: previous === target ? -1 : 1 }
  notify()
}

function onPopState(): void {
  if (suppressedPops > 0) {
    suppressedPops -= 1
    return
  }
  if (gatePopTimer !== null && dismissals.size === 0) {
    clearTimeout(gatePopTimer)
    gatePopTimer = null
  }
  if (gateCurrent) {
    gateCurrent = false
    if (dismissals.size > 0) closeTopOverlay()
    return
  }
  // A pushed route left a shared entry behind (a modal was open when the route changed). Skip it once, so the
  // person does not lose a back press to an entry they never saw.
  if (dismissals.size === 0 && isGateState(window.history.state)) {
    suppressedPops += 1
    window.history.back()
    return
  }
  // The prompt is the top overlay in spirit: back keeps editing.
  const decision = pressBack({
    nav: { ...store, overlays: [], gate: false },
    history: historyModel,
    prompt: pending,
  })
  if (decision.kind === 'dismiss-prompt') {
    restoreRoute()
    pending = null
    notify()
    return
  }
  if (decision.kind === 'guard') holdBackForGuard()
}

/** Install the policy once, before the router subscribes. Called by main.tsx. */
export function startNavigation(): void {
  if (started || typeof window === 'undefined') return
  started = true
  historyModel = initialHistory(pathOf(window.location))
  lastIndex = readIndex()
  lastRouteState = window.history.state
  window.addEventListener('popstate', onPopState)
}

/** Keep the route model in step with the router. `history.state.idx` says push, replace or traversal. */
export function syncLocation(pathname: string, search: string, hash = ''): void {
  const path = pathname + search + hash
  const index = readIndex()
  const current = historyModel.paths[historyModel.index]

  if (path === current && (index === null || lastIndex === null || index === lastIndex)) {
    lastIndex = index ?? lastIndex
    if (!gateCurrent) lastRouteState = routeState()
    return
  }

  const delta = index !== null && lastIndex !== null ? index - lastIndex : null
  if (delta !== null && delta > 0) {
    // A route pushed on top closes the overlays' claim on history; they unmount with the page.
    gateCurrent = false
    store = { ...store, gate: false }
    const forward = historyModel.paths[historyModel.index + delta]
    historyModel = forward === path
      ? { ...historyModel, index: historyModel.index + delta }
      : pushRoute(historyModel, path)
  } else if (delta !== null && delta < 0) {
    historyModel = { ...historyModel, index: Math.max(0, historyModel.index + delta) }
  } else {
    // Same browser entry with a new URL: a replace, not a new step.
    const paths = [...historyModel.paths]
    paths[historyModel.index] = path
    historyModel = { paths, index: historyModel.index }
  }

  lastIndex = index ?? lastIndex
  if (!gateCurrent) lastRouteState = routeState()
}

/** A modal opened: register its dismiss answer and, for the first one, push the shared history entry. */
export function pushOverlay(dismiss: Dismiss): number {
  const id = nextOverlayId++
  let cancelled = false
  if (gatePopTimer !== null) {
    clearTimeout(gatePopTimer)
    gatePopTimer = null
    cancelled = true
    store = { ...store, gate: true }
  }
  dismissals.set(id, dismiss)
  const step = openOverlayState(store, id)
  store = step.state
  if (step.pushGate && !cancelled) pushGateEntry()
  notify()
  return id
}

/** A modal closed with its own button (or unmounted): pop its entry without running the back policy. */
export function closeOverlay(id: number): void {
  if (!dismissals.delete(id)) return
  const step = closeOverlayState(store, id)
  store = step.state
  notify()
  if (step.popGate) scheduleGatePop()
}

/**
 * A tab or an in-app link asked to leave. Returns false when the dirty guard held it; the caller must then
 * prevent the navigation.
 */
export function requestNavigation(to: string): boolean {
  if (pending !== null) return false
  if (!store.dirty) return true
  pending = { kind: 'link', to }
  notify()
  return false
}

export function setNavigate(fn: ((to: string) => void) | null): void {
  navigateTo = fn
}

/** A page registers its unsaved edits here (the Pantry draft, MR-013). */
export function setDirtyGuard(dirty: boolean, onDiscard: (() => void) | null): void {
  store = { ...store, dirty }
  discardHandler = onDiscard
}

export function keepPrompt(): void {
  pending = null
  notify()
}

/** Discard: clear the edits and perform the one navigation the prompt was holding. */
export function discardPending(): void {
  const held = pending
  if (held === null) return
  pending = null
  store = { ...store, dirty: false }
  const discard = discardHandler
  discardHandler = null
  try {
    discard?.()
  } catch {
    // A page that cannot clean up still leaves: the prompt's promise is to navigate once.
  }
  notify()
  if (held.kind === 'link') {
    navigateTo?.(held.to)
  } else if (held.delta === -1) {
    suppressedPops += 1
    window.history.back()
  } else {
    navigateTo?.(held.target)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// React bindings.
// ---------------------------------------------------------------------------------------------------------------------

type Guard = { request: (to: string) => boolean }

export const NavigationGuardContext = createContext<Guard>({ request: () => true })

/** Tab and link taps go through here, so a dirty page prompts before the router navigates. */
export function useNavigationGuard(): Guard {
  return useContext(NavigationGuardContext)
}

/**
 * Register a mounted overlay with the history stack. `onDismiss` answers a back press: close the overlay, or stay
 * (and ask first). The returned `close` is for the overlay's own close button; it pops the entry without asking.
 */
export function useOverlay(onDismiss: () => OverlayDismiss, opened = true): { close: () => void } {
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })
  const idRef = useRef<number | null>(null)

  useEffect(() => {
    if (!opened) return
    const id = pushOverlay(() => dismissRef.current())
    idRef.current = id
    return () => {
      idRef.current = null
      closeOverlay(id)
    }
  }, [opened])

  const close = useCallback(() => {
    const id = idRef.current
    idRef.current = null
    if (id !== null) closeOverlay(id)
  }, [])

  return { close }
}

/** A plain Mantine Modal/Drawer: back and its own close button both close it through the layer. */
export function useModalOverlay(onClose: () => void, opened = true): () => void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const overlay = useOverlay(() => {
    onCloseRef.current()
    return 'closed'
  }, opened)
  const { close } = overlay
  return useCallback(() => {
    close()
    onCloseRef.current()
  }, [close])
}

/** Wire a page's dirty flag to the in-app back/route guard. `beforeunload` stays with the page. */
export function useDirtyGuard(dirty: boolean, onDiscard: () => void): void {
  const discardRef = useRef(onDiscard)
  useEffect(() => {
    discardRef.current = onDiscard
  })
  useEffect(() => {
    setDirtyGuard(dirty, () => discardRef.current())
    return () => setDirtyGuard(false, null)
  }, [dirty])
}
