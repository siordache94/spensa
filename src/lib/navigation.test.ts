import { describe, expect, it } from 'vitest'
import {
  backRoute,
  backTarget,
  closeOverlayState,
  currentRoute,
  discardEdits,
  initialHistory,
  initialNav,
  keepEditing,
  openOverlayState,
  pressBack,
  pushRoute,
  routeTitle,
  type NavState,
  type Pending,
  type RouteHistory,
} from './navigation.ts'

/** Apply openOverlayState without the history side effects, for the model tests. */
function open(state: NavState, id: number): NavState {
  return openOverlayState(state, id).state
}

describe('overlay stack', () => {
  it('pushes one shared history entry for the first overlay and none for the next', () => {
    const first = openOverlayState(initialNav, 1)
    expect(first.pushGate).toBe(true)
    expect(first.state.overlays).toEqual([1])
    expect(first.state.gate).toBe(true)

    const second = openOverlayState(first.state, 2)
    expect(second.pushGate).toBe(false)
    expect(second.state.overlays).toEqual([1, 2])
    expect(second.state.gate).toBe(true)
  })

  it('closes the top overlay without touching the entry until the last one goes', () => {
    const stacked = open(open(initialNav, 1), 2)

    const top = closeOverlayState(stacked, 2)
    expect(top.state.overlays).toEqual([1])
    expect(top.popGate).toBe(false)
    expect(top.state.gate).toBe(true)

    const last = closeOverlayState(top.state, 1)
    expect(last.state.overlays).toEqual([])
    expect(last.popGate).toBe(true)
    expect(last.state.gate).toBe(false)
  })

  it('ignores closing an overlay that is not open', () => {
    const step = closeOverlayState(open(initialNav, 1), 99)
    expect(step.state.overlays).toEqual([1])
    expect(step.popGate).toBe(false)
  })
})

describe('back ordering', () => {
  const history = pushRoute(pushRoute(initialHistory('/'), '/shop'), '/pantry')

  it('closes the top overlay before any route history', () => {
    const nav = open(initialNav, 1)
    const result = pressBack({ nav, history, prompt: null })
    expect(result.kind).toBe('close-overlay')
    if (result.kind !== 'close-overlay') return
    expect(result.id).toBe(1)
    expect(result.nav.overlays).toEqual([])
    expect(result.repushGate).toBe(false)
    // the route history did not move
    expect(result.history.index).toBe(2)
    expect(currentRoute(result.history)).toBe('/pantry')
  })

  it('closes an overlay even when the page is dirty, then asks on the next back', () => {
    const nav: NavState = { ...open(initialNav, 1), dirty: true }

    const closing = pressBack({ nav, history, prompt: null })
    expect(closing.kind).toBe('close-overlay')

    const asking = pressBack({ nav: closing.nav, history: closing.history, prompt: null })
    expect(asking.kind).toBe('guard')
  })

  it('repushes the shared entry while overlays remain', () => {
    const nav = open(open(initialNav, 1), 2)
    const result = pressBack({ nav, history, prompt: null })
    expect(result.kind).toBe('close-overlay')
    if (result.kind !== 'close-overlay') return
    expect(result.repushGate).toBe(true)
    expect(result.nav.overlays).toEqual([1])
  })
})

describe('dirty guard', () => {
  const history = pushRoute(initialHistory('/'), '/shop')
  const dirty: NavState = { ...initialNav, dirty: true }

  it('holds a back and stays put until the person decides', () => {
    const result = pressBack({ nav: dirty, history, prompt: null })
    expect(result.kind).toBe('guard')
    if (result.kind !== 'guard') return
    expect(result.prompt).toEqual({ kind: 'back', target: '/', delta: -1 })
    expect(result.history).toEqual(history)
    expect(result.nav.dirty).toBe(true)
  })

  it('keeps editing: dismiss the prompt, no navigation, still dirty', () => {
    const held = { kind: 'back', target: '/', delta: -1 } as const
    const dismissed = pressBack({ nav: dirty, history, prompt: held })
    expect(dismissed.kind).toBe('dismiss-prompt')

    const kept = keepEditing(dirty)
    expect(kept.prompt).toBeNull()
    expect(kept.nav.dirty).toBe(true)
  })

  it('discards once: one back, one route, clean afterwards', () => {
    const held = { kind: 'back', target: '/', delta: -1 } as const
    const result = discardEdits({ nav: dirty, history, prompt: held })
    expect(result.goBack).toBe(true)
    expect(result.navigateTo).toBeNull()
    expect(result.nav.dirty).toBe(false)
    expect(result.history.index).toBe(0)
    expect(currentRoute(result.history)).toBe('/')
  })

  it('does not prompt a second time after discarding', () => {
    const held = { kind: 'back', target: '/', delta: -1 } as const
    const discarded = discardEdits({ nav: dirty, history, prompt: held })
    const after = pressBack({ nav: discarded.nav, history: discarded.history, prompt: discarded.prompt })
    expect(after.kind).not.toBe('guard')
  })

  it('discards a tab tap by navigating once to that tab', () => {
    const held: Pending = { kind: 'link', to: '/pantry' }
    const result = discardEdits({ nav: dirty, history, prompt: held })
    expect(result.goBack).toBe(false)
    expect(result.navigateTo).toBe('/pantry')
    expect(result.nav.dirty).toBe(false)
    expect(currentRoute(result.history)).toBe('/pantry')
  })

  it('guards at the root too, before the platform exit', () => {
    const atRoot = initialHistory('/')
    const result = pressBack({ nav: dirty, history: atRoot, prompt: null })
    expect(result.kind).toBe('guard')
  })
})

describe('tab history', () => {
  it('a tab tap reaches that tab, and back then walks the taps in reverse', () => {
    let history: RouteHistory = initialHistory('/')
    history = pushRoute(history, '/recipes')
    history = pushRoute(history, '/shop')

    expect(currentRoute(history)).toBe('/shop')
    expect(history.index).toBe(2)

    history = backRoute(history)
    expect(currentRoute(history)).toBe('/recipes')
    history = backRoute(history)
    expect(currentRoute(history)).toBe('/')
  })

  it('a new tab after going back truncates the forward entries', () => {
    let history: RouteHistory = initialHistory('/')
    history = pushRoute(history, '/recipes')
    history = pushRoute(history, '/shop')
    history = backRoute(history)
    history = pushRoute(history, '/pantry')

    expect(history.paths).toEqual(['/', '/recipes', '/pantry'])
    expect(history.index).toBe(2)
  })

  it('reports where a back would go', () => {
    const history = pushRoute(initialHistory('/'), '/shop')
    expect(backTarget(history)).toEqual({ kind: 'route', path: '/' })
  })
})

describe('root exit', () => {
  it('back on the first entry of the session is the platform exit', () => {
    const result = pressBack({ nav: initialNav, history: initialHistory('/'), prompt: null })
    expect(result.kind).toBe('exit')
  })

  it('follows route history before exiting', () => {
    const history = pushRoute(initialHistory('/'), '/shop')
    const first = pressBack({ nav: initialNav, history, prompt: null })
    expect(first.kind).toBe('route')

    const second = pressBack({ nav: initialNav, history: initialHistory('/'), prompt: null })
    expect(second.kind).toBe('exit')
  })
})

describe('routeTitle', () => {
  it('names every route from one map', () => {
    expect(routeTitle('/')).toBe('Spensa — Plan')
    expect(routeTitle('/shop')).toBe('Spensa — Shop')
    expect(routeTitle('/pantry/')).toBe('Spensa — Pantry')
    expect(routeTitle('/nowhere')).toBe('Spensa — Not found')
  })
})
