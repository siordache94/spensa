import { useEffect, useRef, useState } from 'react'
import { AppShell, Alert, Box, Button, Center, CopyButton, Group, Loader, Menu, Stack, Text } from '@mantine/core'
import { type Icon, IconCalendarWeek, IconCarrot, IconChefHat, IconChevronDown, IconFridge, IconSettings, IconShoppingCart } from '@tabler/icons-react'
import { Link, NavLink, Route, Routes } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAuthApiError, type Session } from '@supabase/supabase-js'
import { QRCodeSVG } from 'qrcode.react'
import { notifications } from '@mantine/notifications'
import { supabase } from './lib/supabase.ts'
import { useWaitingShopMutations } from './lib/offlineQueue.ts'
import './shell.css'
import AuthPage from './pages/AuthPage.tsx'
import HouseholdPage from './pages/HouseholdPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import RecipesPage from './pages/RecipesPage.tsx'
import PantryPage from './pages/PantryPage.tsx'
import ShopPage from './pages/ShopPage.tsx'
import IngredientsPage from './pages/IngredientsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'

const navItems: { to: string; label: string; end: boolean; icon: Icon }[] = [
  { to: '/', label: 'Plan', end: true, icon: IconCalendarWeek },
  { to: '/recipes', label: 'Recipes', end: false, icon: IconChefHat },
  { to: '/pantry', label: 'Pantry', end: false, icon: IconFridge },
  { to: '/shop', label: 'Shop', end: false, icon: IconShoppingCart },
  { to: '/ingredients', label: 'Ingredients', end: false, icon: IconCarrot },
]

function NavButton({ to, label, end, icon: NavIcon, side }: (typeof navItems)[number] & { side?: boolean }) {
  return (
    <NavLink to={to} end={end} className="sp-tab">
      <NavIcon size={side ? 22 : 24} stroke={1.75} aria-hidden />
      <span>{label}</span>
    </NavLink>
  )
}

function OfflineBadge() {
  const waiting = useWaitingShopMutations()
  if (waiting === 0) return null
  return <span className="sp-offline" role="status">Offline — {waiting} waiting</span>
}

type Household = { id: string; name: string; invite_code: string }

async function fetchHousehold(): Promise<Household | null> {
  const { data, error } = await supabase.from('households').select('id, name, invite_code').maybeSingle()
  if (error) throw error
  return data
}

function HouseholdMenu({ household }: { household: Household }) {
  const queryClient = useQueryClient()
  const inviteUrl = `${window.location.origin}/?invite=${household.invite_code}`

  async function signOut() {
    await supabase.auth.signOut()
    queryClient.clear()
  }

  async function shareLink() {
    try {
      await navigator.share({ title: 'Join my Spensa household', url: inviteUrl })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      notifications.show({ color: 'red', title: 'Could not share', message: String(err) })
    }
  }

  return (
    <Menu position="bottom-end" width={260} shadow="md">
      <Menu.Target>
        <Button variant="subtle" className="sp-hh" rightSection={<IconChevronDown size={16} stroke={1.75} />} aria-label={`Household menu: ${household.name}`}>
          {household.name}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Group px="sm" py="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">
            Invite code: <Text component="span" ff="monospace" className="sp-selectable">{household.invite_code}</Text>
          </Text>
          <CopyButton value={household.invite_code}>
            {({ copied, copy }) => (
              <Button size="compact-sm" variant="light" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Stack align="center" gap="xs" px="sm" pb="xs">
          <Box bg="white" p="sm" style={{ borderRadius: 'var(--mantine-radius-sm)' }}>
            <QRCodeSVG value={inviteUrl} size={180} />
          </Box>
          <Text size="xs" c="dimmed">Scan to join</Text>
          <Group gap="xs" wrap="nowrap" w="100%">
            <Text size="xs" ff="monospace" truncate="end" className="sp-selectable" style={{ flex: 1, minWidth: 0 }}>{inviteUrl}</Text>
            <CopyButton value={inviteUrl}>
              {({ copied, copy }) => (
                <Button size="compact-sm" variant="light" onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </CopyButton>
            {typeof navigator.share === 'function' && (
              <Button size="compact-sm" variant="light" onClick={shareLink}>Share</Button>
            )}
          </Group>
        </Stack>
        <Menu.Divider />
        <Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={18} stroke={1.75} />}>Settings</Menu.Item>
        <Menu.Item onClick={signOut}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function Shell({ household }: { household: Household }) {
  return (
    <AppShell
      header={{ height: 48 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 60, sm: 0 } }}
      padding="md"
    >
      <AppShell.Header className="sp-header">
        <Group h="100%" pl="md" pr={4} justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Text component="span" className="sp-brand">Spensa</Text>
            <OfflineBadge />
          </Group>
          <HouseholdMenu household={household} />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="sp-side">
        <Stack gap={0}>
          {navItems.map((item) => (
            <NavButton key={item.to} {...item} side />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <div className="sp-content">
        <Routes>
          <Route path="/" element={<PlanPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/pantry" element={<PantryPage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/ingredients" element={<IngredientsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        </div>
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="sm" className="sp-nav">
        <nav className="sp-tabs" aria-label="Primary">
          {navItems.map((item) => (
            <NavButton key={item.to} {...item} />
          ))}
        </nav>
      </AppShell.Footer>
    </AppShell>
  )
}

function SignedIn() {
  const { data: household, isPending, error } = useQuery({ queryKey: ['household'], queryFn: fetchHousehold })

  if (isPending) return <Center h="100vh"><Loader /></Center>
  if (error) return <Alert color="red" m="md">{error.message}</Alert>
  if (!household) return <HouseholdPage />
  return <Shell household={household} />
}

const INVALID_USER_CODES = ['user_not_found', 'session_not_found', 'bad_jwt']

// 'invalid' only when the server itself says the user/session is gone.
// Anything else (network down, offline, unknown error) is 'unreachable'.
async function verifyUser(): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) return 'ok'
    const serverSaysGone = isAuthApiError(error) &&
      ([401, 403, 404].includes(error.status) || INVALID_USER_CODES.includes(error.code ?? ''))
    return serverSaysGone && navigator.onLine !== false ? 'invalid' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

function App() {
  // undefined = session not yet known
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const userChecked = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // A local DB reset leaves a JWT for a user that no longer exists. Verify once per load
  // in the background; only a server-side "this user/session is gone" answer signs out.
  // Network failures never sign out: retry once when the browser comes back online.
  useEffect(() => {
    if (!session || userChecked.current) return
    userChecked.current = true
    verifyUser().then((result) => {
      if (result === 'invalid') return supabase.auth.signOut()
      if (result === 'unreachable') {
        window.addEventListener('online', () => {
          verifyUser().then((r) => { if (r === 'invalid') supabase.auth.signOut() })
        }, { once: true })
      }
    })
  }, [session])

  if (session === undefined) return <Center h="100vh"><Loader /></Center>
  if (!session) return <AuthPage />
  return <SignedIn />
}

export default App
