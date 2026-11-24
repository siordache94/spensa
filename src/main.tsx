import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
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
import { shouldPersistQuery } from './lib/api/keys.ts'
import { registerPersistedCopyRemover } from './lib/localData.ts'
import { readRaw, removeKey, writeRaw } from './lib/storage.ts'
import { startNavigation } from './lib/navigation.ts'

const maxAge = 1000 * 60 * 60 * 24 * 7

// gcTime must be at least maxAge, or persisted data is dropped.
const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: maxAge } } })
// One adapter for the whole app: the offline mutation functions and <ApiProvider> must use the same one.
registerShopMutations(queryClient, supabaseAdapter)

// localStorage can throw (private mode); the app then just runs without a persisted cache.
const storage = { getItem: readRaw, setItem: writeRaw, removeItem: removeKey }
const persister = createSyncStoragePersister({ storage })

// Sign-out teardown (lib/localData.ts) must remove the saved cache too, not just the in-memory one.
registerPersistedCopyRemover(() => { void persister.removeClient() })

function Root() {
  const [{ theme: name }] = useSettings()
  // AMOLED is the dark scheme with palette overrides (theme.css).
  return (
    <MantineProvider theme={theme} forceColorScheme={name === 'light' ? 'light' : 'dark'}>
      {/* One date locale for every calendar, picker and label (MR-035). */}
      <DatesProvider settings={{ locale: 'en-gb' }}>
      {/* Top centre keeps the stack clear of the tab bar and the trip pass; errors get 8s to be read (MR-040). */}
      <Notifications position="top-center" autoClose={8000} limit={3} classNames={{ root: 'sp-toasts', notification: 'sp-toast' }} />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge,
          // Same default as TanStack (successful queries only), plus the exclusions in shouldPersistQuery.
          dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && shouldPersistQuery(q) },
        }}
        onSuccess={() => { void queryClient.resumePausedMutations() }}
      >
        <ApiProvider api={supabaseAdapter}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ApiProvider>
      </PersistQueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  )
}

// Install the back policy before the router subscribes to popstate, so a guarded back is caught before it renders.
startNavigation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
