import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Group, Modal, Text } from '@mantine/core'
import {
  NavigationGuardContext,
  discardPending,
  getNavigationSnapshot,
  keepPrompt,
  requestNavigation,
  routeTitle,
  setNavigate,
  subscribeNavigation,
  syncLocation,
} from '../lib/navigation.ts'

const GUARD = { request: requestNavigation }

/**
 * The shell's back/navigation layer (MR-051) and its per-route title and scroll reset (MR-033).
 * Rendered inside the router, around the AppShell, so tabs, links, pages and modals all share one policy.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const snapshot = useSyncExternalStore(subscribeNavigation, getNavigationSnapshot, getNavigationSnapshot)

  useEffect(() => {
    setNavigate((to) => navigate(to))
    return () => setNavigate(null)
  }, [navigate])

  // Keep the layer's route history in step with the router. A replace keeps the entry; a push adds one.
  useEffect(() => {
    syncLocation(location.pathname, location.search, location.hash)
  }, [location.pathname, location.search, location.hash])

  // One title map for the whole app; a tab switch also starts at the top of the new tab. Only pathname changes reset
  // the scroll, so in-page state behind a ?query or #hash is not disturbed.
  useEffect(() => {
    document.title = routeTitle(location.pathname)
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <NavigationGuardContext.Provider value={GUARD}>
      {children}
      <Modal
        opened={snapshot.pending !== null}
        onClose={keepPrompt}
        title="Discard changes?"
        centered
        size="sm"
        withCloseButton={false}
      >
        <Text size="sm" mb="md">Your edits will be lost.</Text>
        <Group grow>
          <Button variant="default" data-autofocus onClick={keepPrompt}>Keep editing</Button>
          <Button color="red" onClick={discardPending}>Discard</Button>
        </Group>
      </Modal>
    </NavigationGuardContext.Provider>
  )
}
