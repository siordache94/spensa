import { useEffect, useRef, useState } from 'react'
import { AppShell, Box, Button, Center, CopyButton, Group, Menu, Modal, Stack, Text } from '@mantine/core'
import { type Icon, IconCalendarWeek, IconCarrot, IconChefHat, IconChevronDown, IconFridge, IconSettings, IconShoppingCart } from '@tabler/icons-react'
import { Link, NavLink, Route, Routes } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { notifications } from '@mantine/notifications'
import { useWaitingShopMutations } from './lib/offlineQueue.ts'
import { useCommand } from './lib/api/command.ts'
import { useApi } from './lib/api/context.tsx'
import { refreshHousehold, rotateInviteCode, useHouseholdRow, type HouseholdRow } from './lib/api/household.ts'
import { ErrorState } from './components/ErrorState.tsx'
import { Loading } from './components/Loading.tsx'
import { signOut } from './lib/api/auth.ts'
import { useResyncSubscription } from './lib/api/push.ts'
import './shell.css'
import AuthPage from './pages/AuthPage.tsx'
import HouseholdPage from './pages/HouseholdPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import RecipesPage from './pages/RecipesPage.tsx'
import PantryPage from './pages/PantryPage.tsx'
import ShopPage from './pages/ShopPage.tsx'
import IngredientsPage from './pages/IngredientsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import { useCheckinsSync, useUnreadCheckins } from './lib/api/checkins.ts'

const navItems: { to: string; label: string; end: boolean; icon: Icon }[] = [
  { to: '/', label: 'Plan', end: true, icon: IconCalendarWeek },
  { to: '/recipes', label: 'Recipes', end: false, icon: IconChefHat },
  { to: '/pantry', label: 'Pantry', end: false, icon: IconFridge },
  { to: '/shop', label: 'Shop', end: false, icon: IconShoppingCart },
  { to: '/ingredients', label: 'Ingredients', end: false, icon: IconCarrot },
]

function NavButton({ to, label, end, icon: NavIcon, side, badge = 0 }: (typeof navItems)[number] & { side?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className="sp-tab"
      aria-label={badge > 0 ? `${label}, ${badge} ${badge === 1 ? 'meal' : 'meals'} to confirm` : undefined}
    >
      <NavIcon size={side ? 22 : 24} stroke={1.75} aria-hidden />
      <span>{label}</span>
      {badge > 0 && <span className="sp-tabbadge" aria-hidden>{badge}</span>}
    </NavLink>
  )
}

function OfflineBadge() {
  const waiting = useWaitingShopMutations()
  if (waiting === 0) return null
  return <span className="sp-offline" role="status">Offline — {waiting} waiting</span>
}

function HouseholdMenu({ household }: { household: HouseholdRow }) {
  const queryClient = useQueryClient()
  const inviteUrl = `${window.location.origin}/?invite=${household.invite_code}`

  const [confirmOpen, setConfirmOpen] = useState(false)
  const rotate = useCommand(rotateInviteCode, {
    onSuccess: () => setConfirmOpen(false),
    onError: (err) => notifications.show({ color: 'red', title: 'Could not change the invite code', message: err.message }),
  })

  const leave = useCommand(signOut, { onSuccess: () => queryClient.clear() })

  async function shareLink() {
    try {
      await navigator.share({ title: 'Join my Spensa household', url: inviteUrl })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      notifications.show({ color: 'red', title: 'Could not share', message: String(err) })
    }
  }

  return (
    <>
    <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="New invite code?" centered>
      <Stack>
        <Text size="sm">The current code, link and QR stop working. People already in the household stay in.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>New invite code</Button>
        </Group>
      </Stack>
    </Modal>
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
        <Group px="sm" pb="xs">
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setConfirmOpen(true)}>New invite code</Button>
        </Group>
        <Menu.Divider />
        <Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={18} stroke={1.75} />}>Settings</Menu.Item>
        <Menu.Item onClick={() => leave.mutate()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    </>
  )
}

function Shell({ household }: { household: HouseholdRow }) {
  useResyncSubscription()
  useCheckinsSync()
  const unreadMeals = useUnreadCheckins().count
  const badge = (to: string) => (to === '/' ? unreadMeals : 0)
  return (
    <AppShell
      header={{ height: 'calc(48px + env(safe-area-inset-top, 0px))' }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 'calc(60px + env(safe-area-inset-bottom, 0px))', sm: 0 } }}
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
            <NavButton key={item.to} {...item} side badge={badge(item.to)} />
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
            <NavButton key={item.to} {...item} badge={badge(item.to)} />
          ))}
        </nav>
      </AppShell.Footer>
    </AppShell>
  )
}

function SignedIn() {
  const queryClient = useQueryClient()
  const { data: household, isPending, error, isFetching } = useHouseholdRow()

  if (isPending) return <Center h="100vh"><Loading label="Loading household" /></Center>
  // undefined = never loaded (null means loaded, not in a household). Saved data still shows the shell.
  if (error && household === undefined) {
    return (
      <Center h="100vh">
        <ErrorState title="Couldn't load your household" onRetry={() => void refreshHousehold(queryClient)} retrying={isFetching} />
      </Center>
    )
  }
  if (!household) return <HouseholdPage />
  return <Shell household={household} />
}

function App() {
  const api = useApi()
  // undefined = session not yet known
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)
  const userChecked = useRef(false)

  useEffect(() => {
    void api.auth.session().then((session) => setSignedIn(session !== null))
    return api.live.onSessionChange(setSignedIn)
  }, [api])

  // A local DB reset leaves a JWT for a user that no longer exists. Verify once per load
  // in the background; only a server-side "this user/session is gone" answer signs out.
  // Network failures never sign out: retry once when the browser comes back online.
  useEffect(() => {
    if (!signedIn || userChecked.current) return
    userChecked.current = true
    void api.auth.verifyUser().then((result) => {
      if (result === 'invalid') return api.auth.signOut('global')
      if (result === 'unreachable') {
        window.addEventListener('online', () => {
          void api.auth.verifyUser().then((r) => { if (r === 'invalid') void api.auth.signOut('global') })
        }, { once: true })
      }
    })
  }, [api, signedIn])

  if (signedIn === undefined) return <Center h="100vh"><Loading label="Loading" /></Center>
  if (!signedIn) return <AuthPage />
  return <SignedIn />
}

export default App
