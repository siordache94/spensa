import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import App from './App.tsx'
import { theme } from './theme.ts'
import { useSettings } from './lib/settings.ts'
import { ApiProvider } from './lib/api/context.tsx'
import { supabaseAdapter } from './lib/api/supabaseAdapter.ts'
import { registerShopMutations } from './lib/shopMutations.ts'

const maxAge = 1000 * 60 * 60 * 24 * 7

// gcTime must be at least maxAge, or persisted data is dropped.
const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: maxAge } } })
// One adapter for the whole app: the offline mutation functions and <ApiProvider> must use the same one.
registerShopMutations(queryClient, supabaseAdapter)

// localStorage can throw (private mode); the app then just runs without a persisted cache.
const storage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
const persister = createSyncStoragePersister({ storage })

function Root() {
  const [{ theme: name }] = useSettings()
  // AMOLED is the dark scheme with palette overrides (theme.css).
  return (
    <MantineProvider theme={theme} forceColorScheme={name === 'light' ? 'light' : 'dark'}>
      <Notifications />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge }}
        onSuccess={() => { void queryClient.resumePausedMutations() }}
      >
        <ApiProvider api={supabaseAdapter}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ApiProvider>
      </PersistQueryClientProvider>
    </MantineProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
