// Contract-test harness (MR-009). The same assertions run against the fake adapter in-process and, when the local
// Supabase stack is up, against the production adapter. Node/Vitest only: no jsdom, no Testing Library.
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createFakeAdapter } from './fakeAdapter.ts'
import type { DataPort } from './port.ts'

export type ContractFixture = {
  port: DataPort
  /** Production creates check-ins server-side; the fixture does the same thing for this meal. */
  seedUnreadCheckin(mealId: string): Promise<void>
  dispose(): Promise<void>
}

export type LocalStack = { url: string; anonKey: string; serviceKey: string }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]', '::1'])

/**
 * The local Supabase stack from the env files, or null when there is none to test against. Only a loopback URL is
 * ever used: the contract test must never touch a hosted project.
 */
export async function localStack(): Promise<LocalStack | null> {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!raw || !anonKey) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!LOOPBACK.has(url.hostname)) return null
  if (!(await reachable(url.origin))) return null

  const fromCli = statusEnv()
  if (fromCli?.API_URL && new URL(fromCli.API_URL).origin !== url.origin) return null
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromCli?.SERVICE_ROLE_KEY
  return serviceKey ? { url: url.origin, anonKey, serviceKey } : null
}

async function reachable(origin: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const res = await fetch(`${origin}/rest/v1/`, { signal: controller.signal })
    return res.ok || res.status === 401
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** `supabase status -o env`: the local stack's keys, without asking anyone to paste secrets into the repo. */
function statusEnv(): Record<string, string> | null {
  try {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] })
    const pairs = out
      .trim()
      .split('\n')
      .map((line) => {
        const at = line.indexOf('=')
        return at < 0 ? null : [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')] as const
      })
      .filter((pair): pair is readonly [string, string] => pair !== null && pair[0].length > 0)
    return Object.fromEntries(pairs)
  } catch {
    return null
  }
}

/** A fresh fake household per suite, seeded with the app's default settings. */
export function fakeContractFixture(): ContractFixture {
  const api = createFakeAdapter()
  return {
    port: api,
    async seedUnreadCheckin(mealId) {
      api.state.unreadCheckins.push({
        id: `checkin-${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
        planned_meals: {
          id: mealId,
          date: new Date().toISOString().slice(0, 10),
          slot: 'dinner',
          portions: 2,
          cook_id: null,
          recipes: null,
        },
      })
    },
    async dispose() {},
  }
}

/**
 * A fresh auth user and household on the local stack, created through the production adapter itself. Cleanup deletes
 * both, so repeated runs do not pile up rows.
 */
export async function realContractFixture(stack: LocalStack): Promise<ContractFixture> {
  // src/lib/supabase.ts rewrites a loopback URL to window.location.hostname; Node has no window. A window without a
  // document keeps supabase-js in its non-browser path.
  const globals = globalThis as unknown as { window?: { location: { hostname: string } } }
  globals.window ??= { location: { hostname: new URL(stack.url).hostname } }

  const admin = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { supabaseAdapter } = await import('./supabaseAdapter.ts')
  const email = `contract-${crypto.randomUUID()}@test.local`
  const password = crypto.randomUUID()

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const userId = created.data.user.id

  await supabaseAdapter.auth.signIn(email, password)
  await supabaseAdapter.household.create('Contract house', 'Contract', 'UTC')

  return {
    port: supabaseAdapter,
    async seedUnreadCheckin(mealId) {
      const household = await supabaseAdapter.household.settings()
      const { error } = await admin.rpc('checkin_create', { hid: household.id, meal_ids: [mealId] })
      if (error) throw error
    },
    async dispose() {
      try {
        await supabaseAdapter.auth.signOut('local')
      } catch {
        // the session may already be gone
      }
      const purged = await admin.rpc('purge_user', { uid: userId })
      if (purged.error) throw purged.error
      const deleted = await admin.auth.admin.deleteUser(userId)
      if (deleted.error) throw deleted.error
    },
  }
}
