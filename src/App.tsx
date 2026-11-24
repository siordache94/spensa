import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, AppShell, Box, Button, Center, CopyButton, Group, Menu, Modal, Stack, Text } from '@mantine/core'
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
import { NavigationProvider } from './components/BackNavigation.tsx'
import { useModalOverlay, useNavigationGuard } from './lib/navigation.ts'
import { useOnline } from './lib/useOnline.ts'
import { signOut } from './lib/api/auth.ts'
import { useResyncSubscription } from './lib/api/push.ts'
import { clearLocalData } from './lib/localData.ts'
import { recordTrust, resolveSession, type SessionResolution } from './lib/deviceTrust.ts'
import './shell.css'
import AuthPage from './pages/AuthPage.tsx'
import HouseholdPage from './pages/HouseholdPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import RecipesPage from './pages/RecipesPage.tsx'
import PantryPage from './pages/PantryPage.tsx'
import ShopPage from './pages/ShopPage.tsx'
import IngredientsPage from './pages/IngredientsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import NotFound from './pages/NotFound.tsx'
import { useCheckinsSync, useUnreadCheckins } from './lib/api/checkins.ts'

const navItems: { to: string; label: string; short?: string; end: boolean; icon: Icon }[] = [
  { to: '/', label: 'Plan', end: true, icon: IconCalendarWeek },
  { to: '/recipes', label: 'Recipes', end: false, icon: IconChefHat },
  { to: '/pantry', label: 'Pantry', end: false, icon: IconFridge },
  { to: '/shop', label: 'Shop', end: false, icon: IconShoppingCart },
  // The 64px cell at 320px cannot hold INGREDIENTS; below 340px the tab shows "Items" (shell.css).
  { to: '/ingredients', label: 'Ingredients', short: 'Items', end: false, icon: IconCarrot },
]

function NavButton({ to, label, short, end, icon: NavIcon, side, badge = 0 }: (typeof navItems)[number] & { side?: boolean; badge?: number }) {
  const guard = useNavigationGuard()
  return (
    <NavLink
      to={to}
      end={end}
      className="sp-tab"
      aria-label={badge > 0 ? `${label}, ${badge} ${badge === 1 ? 'meal' : 'meals'} to confirm` : label}
      // A dirty page asks before a tab tap takes it away; Discard then navigates once to this tab.
      onClick={(e) => { if (!guard.request(to)) e.preventDefault() }}
    >
      <NavIcon size={side ? 22 : 24} stroke={1.75} aria-hidden />
      <span className="sp-tab-long">{label}</span>
      {short && <span className="sp-tab-short" aria-hidden>{short}</span>}
      {badge > 0 && <span className="sp-tabbadge" aria-hidden>{badge}</span>}
    </NavLink>
  )
}

function OfflineBadge() {
  const waiting = useWaitingShopMutations()
  const online = useOnline()
  if (waiting === 0) return null
  return <span className="sp-offline" role="status">{online ? `Syncing ${waiting}` : `Offline — ${waiting} waiting`}</span>
}

/** "14:05" today, "23 Nov 14:05" otherwise. */
function savedAt(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

/** Persistent, in the header: the shell is showing the saved cache, not live data. */
function OfflineNotice({ verifiedAt }: { verifiedAt: number | null }) {
  return (
    <Text size="xs" c="dimmed" px="md" pb={6} role="status" className="sp-offline-note">
      Offline — showing saved data{verifiedAt === null ? '' : ` from ${savedAt(verifiedAt)}`}
    </Text>
  )
}

function HouseholdMenu({ household }: { household: HouseholdRow }) {
  const queryClient = useQueryClient()
  const guard = useNavigationGuard()
  const inviteUrl = `${window.location.origin}/?invite=${household.invite_code}`

  const [confirmOpen, setConfirmOpen] = useState(false)
  const closeConfirm = useModalOverlay(() => setConfirmOpen(false), confirmOpen)
  const rotate = useCommand(rotateInviteCode, {
    onSuccess: () => setConfirmOpen(false),
    onError: (err) => notifications.show({ color: 'red', title: 'Could not change the invite code', message: err.message }),
  })

  const leave = useCommand(signOut, { onSuccess: () => clearLocalData(queryClient) })

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
    <Modal opened={confirmOpen} onClose={closeConfirm} title="New invite code?" centered>
      <Stack>
        <Text size="sm">The current code, link and QR stop working. People already in the household stay in.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeConfirm}>Cancel</Button>
          <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>New invite code</Button>
        </Group>
      </Stack>
    </Modal>
    <Menu position="bottom-end" width={300}>
      <Menu.Target>
        <Button variant="subtle" className="sp-hh" rightSection={<IconChevronDown size={16} stroke={1.75} />} aria-label={`Household menu: ${household.name}`}>
          <span className="sp-hh-name">{household.name}</span>
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Stack gap="sm" px="sm" py="xs">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm">
              Invite code: <Text component="span" ff="monospace" className="sp-selectable">{household.invite_code}</Text>
            </Text>
            <CopyButton value={household.invite_code}>
              {({ copied, copy }) => (
                <Button variant="light" miw={44} mih={44} onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Stack align="center" gap={4}>
            <Box bg="white" p="sm" style={{ borderRadius: 'var(--mantine-radius-sm)' }}>
              <QRCodeSVG value={inviteUrl} size={180} />
            </Box>
            <Text size="xs" c="dimmed">Scan to join</Text>
          </Stack>
          {/* The whole link on its own line, wrapping rather than truncating: it has to be readable to be usable. */}
          <Text size="xs" ff="monospace" className="sp-selectable sp-invite-url">{inviteUrl}</Text>
          <Group gap="xs" grow>
            <CopyButton value={inviteUrl}>
              {({ copied, copy }) => (
                <Button variant="light" mih={44} onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </CopyButton>
            {typeof navigator.share === 'function' && (
              <Button variant="light" mih={44} onClick={shareLink}>Share</Button>
            )}
          </Group>
          <Button variant="subtle" color="gray" mih={44} onClick={() => setConfirmOpen(true)}>New invite code</Button>
        </Stack>
        <Menu.Divider />
        <Menu.Item
          component={Link}
          to="/settings"
          leftSection={<IconSettings size={18} stroke={1.75} />}
          onClick={(e) => { if (!guard.request('/settings')) e.preventDefault() }}
        >
          Settings
        </Menu.Item>
        <Menu.Item onClick={() => leave.mutate()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    </>
  )
}

/** Settings has its own header affordance, not just a menu item behind the household name (MR-041). */
function SettingsButton() {
  const guard = useNavigationGuard()
  return (
    <ActionIcon
      component={Link}
      to="/settings"
      variant="subtle"
      color="gray"
      size={44}
      aria-label="Settings"
      onClick={(e) => { if (!guard.request('/settings')) e.preventDefault() }}
    >
      <IconSettings size={22} stroke={1.75} />
    </ActionIcon>
  )
}

function Shell({ household, verifiedAt }: { household: HouseholdRow; verifiedAt: number | null }) {
  useResyncSubscription()
  useCheckinsSync()
  const online = useOnline()
  const unreadMeals = useUnreadCheckins().count
  const badge = (to: string) => (to === '/' ? unreadMeals : 0)
  return (
    <NavigationProvider>
    <AppShell
      header={{ height: online ? 'calc(48px + env(safe-area-inset-top, 0px))' : 'calc(76px + env(safe-area-inset-top, 0px))' }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 'calc(60px + env(safe-area-inset-bottom, 0px))', sm: 0 } }}
      padding="md"
    >
      <AppShell.Header className="sp-header">
        <Stack gap={0} h="100%" justify="center">
          <Group h={48} pl="md" pr={4} justify="space-between" wrap="nowrap" className="sp-header-row">
            <Group gap="sm" wrap="nowrap" className="sp-brand-group">
              <Text component="span" className="sp-brand">Spensa</Text>
              <OfflineBadge />
            </Group>
            <Group gap={0} wrap="nowrap" className="sp-header-actions">
              <SettingsButton />
              <HouseholdMenu household={household} />
            </Group>
          </Group>
          {!online && <OfflineNotice verifiedAt={verifiedAt} />}
        </Stack>
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
          <Route path="*" element={<NotFound />} />
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
    </NavigationProvider>
  )
}

function SignedIn({ verifiedAt }: { verifiedAt: number | null }) {
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
  return <Shell household={household} verifiedAt={verifiedAt} />
}

function App() {
  const api = useApi()
  const queryClient = useQueryClient()
  // undefined = session not yet known. The resolution also says whether it came from device trust.
  const [resolution, setResolution] = useState<SessionResolution | undefined>(undefined)
  const userChecked = useRef(false)

  // The one teardown for a session the server says is gone (MR-007): household cache, saved copy and trust record.
  const signOutAndClear = useCallback(async () => {
    clearLocalData(queryClient)
    await api.auth.signOut('global').catch(() => { /* the session may already be gone */ })
    setResolution({ session: null, source: 'none', verifiedAt: null, invalid: true })
  }, [api, queryClient])

  const apply = useCallback((next: SessionResolution) => {
    // resolveSession clears the trust record only on a server-confirmed invalid session; do the same for the data.
    if (next.invalid) clearLocalData(queryClient)
    setResolution(next)
  }, [queryClient])

  const resolve = useCallback(async () => apply(await resolveSession(api.auth)), [api, apply])

  // The first read, before any auth event: device trust decides whether the saved shell opens.
  useEffect(() => { void resolveSession(api.auth).then(apply) }, [api, apply])

  // Offline, a null session may only mean the access token expired (auth-js returns null after a failed refresh), so
  // it must not drop to sign-in: resolveSession lets device trust stand in. Online it is a real change of session.
  useEffect(() => api.live.onSessionChange(() => { void resolve() }), [api, resolve])

  // Coming back online re-verifies: a fresh session refreshes the trust record, a confirmed-invalid one signs out.
  useEffect(() => {
    const onOnline = () => { void resolve() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [resolve])

  // A local DB reset leaves a JWT for a user that no longer exists. Verify once per load
  // in the background; only a server-side "this user/session is gone" answer signs out.
  // Network failures never sign out: retry when the browser comes back online.
  useEffect(() => {
    if (!resolution?.session || userChecked.current) return
    userChecked.current = true
    const current = resolution.session
    const check = (): Promise<void> => api.auth.verifyUser().then((result) => {
      if (result === 'invalid') return signOutAndClear()
      if (result === 'ok') return recordTrust(current)
      window.addEventListener('online', check, { once: true })
    })
    void check()
  }, [api, resolution, signOutAndClear])

  if (resolution === undefined) return <Center h="100vh"><Loading label="Loading" /></Center>
  if (!resolution.session) return <AuthPage />
  return <SignedIn verifiedAt={resolution.verifiedAt} />
}

export default App
