import { useEffect, useState } from 'react'
import { AppShell, Alert, Box, Button, Center, CopyButton, Flex, Group, Loader, Menu, Stack, Text, Title } from '@mantine/core'
import { type Icon, IconCalendarWeek, IconCarrot, IconChefHat, IconFridge, IconShoppingCart } from '@tabler/icons-react'
import { NavLink, Route, Routes } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { QRCodeSVG } from 'qrcode.react'
import { notifications } from '@mantine/notifications'
import { supabase } from './lib/supabase.ts'
import AuthPage from './pages/AuthPage.tsx'
import HouseholdPage from './pages/HouseholdPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import RecipesPage from './pages/RecipesPage.tsx'
import PantryPage from './pages/PantryPage.tsx'
import ShopPage from './pages/ShopPage.tsx'
import IngredientsPage from './pages/IngredientsPage.tsx'

const navItems: { to: string; label: string; end: boolean; icon: Icon }[] = [
  { to: '/', label: 'Plan', end: true, icon: IconCalendarWeek },
  { to: '/recipes', label: 'Recipes', end: false, icon: IconChefHat },
  { to: '/pantry', label: 'Pantry', end: false, icon: IconFridge },
  { to: '/shop', label: 'Shop', end: false, icon: IconShoppingCart },
  { to: '/ingredients', label: 'Ingredients', end: false, icon: IconCarrot },
]

function NavButton({ to, label, end, icon: NavIcon, fullWidth }: (typeof navItems)[number] & { fullWidth?: boolean }) {
  return (
    <NavLink to={to} end={end} style={{ textDecoration: 'none', flex: fullWidth ? undefined : 1, minWidth: 0 }}>
      {({ isActive }) =>
        fullWidth ? (
          <Button component="span" variant={isActive ? 'light' : 'subtle'} fullWidth justify="flex-start" leftSection={<NavIcon size={18} />}>
            {label}
          </Button>
        ) : (
          <Button component="span" variant={isActive ? 'light' : 'subtle'} fullWidth h={56} px={4}>
            <Flex component="span" direction="column" align="center" gap={2}>
              <NavIcon size={22} />
              <Text component="span" fz={11} lh={1} style={{ whiteSpace: 'nowrap' }}>{label}</Text>
            </Flex>
          </Button>
        )
      }
    </NavLink>
  )
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
        <Button variant="subtle">{household.name}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Group px="sm" py="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">
            Invite code: <Text component="span" ff="monospace">{household.invite_code}</Text>
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
            <Text size="xs" ff="monospace" truncate="end" style={{ flex: 1, minWidth: 0 }}>{inviteUrl}</Text>
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
        <Menu.Item onClick={signOut}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function Shell({ household }: { household: Household }) {
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 68, sm: 0 } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={3}>Spensa</Title>
          <HouseholdMenu household={household} />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Stack gap="xs">
          {navItems.map((item) => (
            <NavButton key={item.to} {...item} fullWidth />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<PlanPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/pantry" element={<PantryPage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/ingredients" element={<IngredientsPage />} />
        </Routes>
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="sm" px="xs" py={6}>
        <Group grow gap="xs" h="100%" wrap="nowrap">
          {navItems.map((item) => (
            <NavButton key={item.to} {...item} />
          ))}
        </Group>
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

function App() {
  // undefined = session not yet known
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Center h="100vh"><Loader /></Center>
  if (!session) return <AuthPage />
  return <SignedIn />
}

export default App
