import { createContext, useContext, type ReactNode } from 'react'
import type { DataPort } from './port.ts'
import { supabaseAdapter } from './supabaseAdapter.ts'

const ApiContext = createContext<DataPort>(supabaseAdapter)

/** Wrap the app (src/main.tsx) or a test tree. Without a provider, useApi() is the Supabase adapter. */
export function ApiProvider({ api, children }: { api: DataPort; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

/** The adapter for the current tree. Call it in hooks and components, never at module level. */
export const useApi = () => useContext(ApiContext)
