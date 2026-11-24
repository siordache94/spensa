// The undo toast's pure text and timing, kept out of the component file so Fast Refresh sees only a component there.

export const UNDO_MS = 4000

/** The toast's words for a tick: "Bought Milk" for a purchase or a to-taste row, "Checked Bread" for a free-text item. */
export const undoMessage = (kind: 'buy' | 'toTaste' | 'checkText', name: string) => `${kind === 'checkText' ? 'Checked' : 'Bought'} ${name}`

/** The Finish dialog's count line: "1 item not bought", "3 items not bought", or null when nothing is left. */
export const notBoughtLine = (n: number) => (n === 0 ? null : `${n} ${n === 1 ? 'item' : 'items'} not bought`)
