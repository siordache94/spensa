/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// WCAG 2.x contrast for the token pairs the gate-board UI actually paints. Reads src/theme.css, so a token
// cannot drift away from its assertion (no duplicated palette in the test).
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')
// The component defaults attach the touch-floor classes; read theme.ts so a class rename cannot pass silently.
const themeSource = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8')

type Theme = 'light' | 'dark' | 'amoled'

const THEMES: Theme[] = ['light', 'dark', 'amoled']

function escapeSelector(selector: string): string {
  return selector.replace(/[[\]()]/g, '\\$&')
}

function declarations(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`${escapeSelector(selector)}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`theme.css has no block for ${selector}`)
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [`--${name}`, value.trim()]),
  )
}

/** The body of a plain CSS rule (first match at the start of a line, so a compound selector cannot win). */
function rule(selector: string): string {
  const match = css.match(new RegExp(`(?:^|\\n)${escapeSelector(selector)}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`theme.css has no rule for ${selector}`)
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The object passed to `Component.extend(...)` in theme.ts, braces included. */
function componentDefaults(component: string): string {
  const start = themeSource.indexOf(`${component}: ${component}.extend({`)
  if (start < 0) throw new Error(`theme.ts has no ${component} defaults`)
  const open = themeSource.indexOf('{', start)
  let depth = 0
  for (let i = open; i < themeSource.length; i += 1) {
    if (themeSource[i] === '{') depth += 1
    else if (themeSource[i] === '}') {
      depth -= 1
      if (depth === 0) return themeSource.slice(start, i + 1)
    }
  }
  throw new Error(`theme.ts has unbalanced ${component} defaults`)
}

const globalTokens = declarations(':root')

function tokens(theme: Theme): Record<string, string> {
  const merged: Record<string, string> = { ...globalTokens, ...declarations(`:root[data-spensa-theme='${theme}']`) }
  const resolve = (name: string): string => {
    let value = merged[name]
    if (value === undefined) throw new Error(`${name} is not defined`)
    const reference = value.match(/^var\(--([\w-]+)\)$/)
    if (reference) value = resolve(`--${reference[1]}`)
    return value
  }
  return new Proxy(merged, { get: (_, name) => (typeof name === 'string' ? resolve(name) : undefined) })
}

function channels(hex: string): [number, number, number] {
  const match = hex.match(/^#([\da-f]{6})$/i)
  if (!match) throw new Error(`expected a 6-digit hex colour, got ${hex}`)
  return [0, 2, 4].map((i) => Number.parseInt(match[1].slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

describe.each(THEMES)('%s theme tokens', (theme) => {
  const t = tokens(theme)

  it('focus ring is at least 3:1 against the ground it sits on', () => {
    expect(contrast(t['--sp-focus'], t['--sp-body'])).toBeGreaterThanOrEqual(3)
  })

  it('focus ring is at least 3:1 against a panel', () => {
    expect(contrast(t['--sp-focus'], t['--sp-panel'])).toBeGreaterThanOrEqual(3)
  })

  it('red text on the red-light destructive surface is at least 4.5:1', () => {
    expect(contrast(t['--sp-red-text'], t['--sp-red-light'])).toBeGreaterThanOrEqual(4.5)
  })

  it('white on the red fill is at least 4.5:1', () => {
    expect(contrast(t['--sp-red-contrast'], t['--sp-red-fill'])).toBeGreaterThanOrEqual(4.5)
  })

  it('error red is at least 4.5:1 against the ground', () => {
    expect(contrast(t['--sp-red'], t['--sp-body'])).toBeGreaterThanOrEqual(4.5)
  })

  it('switch off track is distinguishable from the ground (3:1)', () => {
    expect(contrast(t['--sp-switch-off'], t['--sp-body'])).toBeGreaterThanOrEqual(3)
  })

  it('disabled text stays legible on the disabled fill (4.5:1)', () => {
    expect(contrast(t['--sp-disabled-text'], t['--sp-disabled-bg'])).toBeGreaterThanOrEqual(4.5)
  })
})

// PRODUCT.md promises 44px tap targets. The floor lives in one token; these assertions keep every audited
// component default wired to it (MR-011) and keep the floor inside a compact board row.
describe('44px touch floor', () => {
  it('is a 44px token declared with the density tokens', () => {
    expect(globalTokens['--sp-control-min']).toBe('44px')
  })

  it('fits inside a compact board row, so no control can widen or grow its row', () => {
    expect(Number.parseFloat(globalTokens['--sp-control-min'])).toBeLessThanOrEqual(Number.parseFloat(globalTokens['--row-h']))
  })

  it.each([
    ['Button', 'sp-button'],
    ['Input', 'sp-input'],
    ['TimeInput', 'sp-input'],
    ['CloseButton', 'sp-close'],
    ['ActionIcon', 'sp-action'],
    ['SegmentedControl', 'sp-seg-label'],
    ['Menu', 'sp-menu-item'],
  ])('%s defaults attach %s, whose rule holds the token', (component, className) => {
    expect(componentDefaults(component)).toContain(`'${className}'`)
    expect(rule(`.${className}`)).toContain('min-height: var(--sp-control-min)')
  })

  it('routes the modal and drawer close buttons through the same 44px target', () => {
    expect(componentDefaults('Modal')).toContain("close: 'sp-close'")
    expect(componentDefaults('Drawer')).toContain("close: 'sp-close'")
  })

  it('grows the close target without growing its glyph', () => {
    expect(rule('.sp-close')).toContain('--cb-icon-size: 20px')
  })

  it('keeps single-line field text centred when the floor beats the Mantine size', () => {
    const singleLine = rule('input.sp-input')
    expect(singleLine).toContain('height: max(var(--input-size), var(--sp-control-min))')
    expect(singleLine).toContain('line-height: calc(max(var(--input-size), var(--sp-control-min)) - 2px)')
  })
})
