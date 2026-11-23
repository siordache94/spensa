import { AppShell, Button, Group, Stack, Title } from '@mantine/core'
import { NavLink, Route, Routes } from 'react-router'
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

function App() {
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 64, sm: 0 } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Title order={3}>Spensa</Title>
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

export default App
