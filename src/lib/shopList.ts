// A bought shopping item stays in the table, pointing at the batch it became.
// It is out of the "to buy" list while it has one, and back on it when the batch goes.
type Item = { id: string; bought_batch_id?: string | null }

export const toBuy = <T extends Item>(items: T[]): T[] => items.filter((i) => !i.bought_batch_id)

export const markBought = <T extends Item>(items: T[], itemId: string, batchId: string): T[] =>
  items.map((i) => (i.id === itemId ? { ...i, bought_batch_id: batchId } : i))

export const restoreBought = <T extends Item>(items: T[], batchId: string): T[] =>
  items.map((i) => (i.bought_batch_id === batchId ? { ...i, bought_batch_id: null } : i))
