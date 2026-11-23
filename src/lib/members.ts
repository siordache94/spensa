import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase.ts'

export type Member = { user_id: string; display_name: string | null }

export const memberLabel = (m: Member) => m.display_name ?? 'Someone'

export function useMembers() {
  return useQuery({
    queryKey: ['household', 'members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('household_members').select('user_id, display_name').order('display_name')
      if (error) throw error
      return data as Member[]
    },
  })
}

export function useMyId() {
  return useQuery({
    queryKey: ['auth', 'uid'],
    staleTime: Infinity,
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  }).data
}
