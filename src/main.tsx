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
import { registerShopMutations } from './lib/shopMutations.ts'

const maxAge = 1000 * 60 * 60 * 24 * 7

// gcTime must be at least maxAge, or persisted data is dropped.
const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: maxAge } } })
registerShopMutations(queryClient)

// localStorage can throw (private mode); the app then just runs without a persisted cache.
const storage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
const persister = createSyncStoragePersister({ storage })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <Notifications />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge }}
        onSuccess={() => { void queryClient.resumePausedMutations() }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PersistQueryClientProvider>
    </MantineProvider>
  </StrictMode>,
)
