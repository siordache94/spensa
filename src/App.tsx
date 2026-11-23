import { useEffect, useState } from 'react'
import { AppShell, Alert, Box, Button, Center, CopyButton, Group, Loader, Menu, Stack, Text, Title } from '@mantine/core'
import { NavLink, Route, Routes } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './lib/supabase.ts'
import AuthPage from './pages/AuthPage.tsx'
import HouseholdPage from './pages/HouseholdPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import RecipesPage from './pages/RecipesPage.tsx'
import PantryPage from './pages/PantryPage.tsx'
import ShopPage from './pages/ShopPage.tsx'
import IngredientsPage from './pages/IngredientsPage.tsx'

const navItems = [
  { to: '/', label: 'Plan', end: true },
  { to: '/recipes', label: 'Recipes', end: false },
  { to: '/pantry', label: 'Pantry', end: false },
  { to: '/shop', label: 'Shop', end: false },
  { to: '/ingredients', label: 'Ingredients', end: false },
]

function NavButton({ to, label, end, fullWidth }: (typeof navItems)[number] & { fullWidth?: boolean }) {
  return (
    <NavLink to={to} end={end} style={{ textDecoration: 'none', flex: fullWidth ? undefined : 1 }}>
      {({ isActive }) => (
        <Button
          component="span"
          variant={isActive ? 'light' : 'subtle'}
          fullWidth
          justify={fullWidth ? 'flex-start' : 'center'}
        >
          {label}
        </Button>
      )}
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
      footer={{ height: { base: 64, sm: 0 } }}
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

      <AppShell.Footer hiddenFrom="sm" p="xs">
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
