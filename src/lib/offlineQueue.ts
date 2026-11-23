import { useMutationState } from '@tanstack/react-query'
import { SHOP_KEY } from './shopMutations.ts'

/** Number of shop mutations (ticks etc.) paused waiting for a connection. Shared by the header badge and the Shop page. */
export function useWaitingShopMutations(): number {
  return useMutationState({ filters: { mutationKey: SHOP_KEY }, select: (m) => m.state.isPaused }).filter(Boolean).length
}
