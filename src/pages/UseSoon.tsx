import { useMemo } from 'react'
import dayjs from 'dayjs'
import { usePantryState } from '../lib/api/pantry.ts'
import { round1 } from '../lib/format.ts'
import './lists.css'
import './pantry.css'

export default function UseSoon() {
  const { expiring, remaining, ingredients, today: day } = usePantryState()

  const items = useMemo(() => {
    if (!expiring || !remaining || !ingredients) return []
    const byId = new Map(ingredients.map((i) => [i.id, i]))
    return expiring.map((batch) => ({
      batch,
      amount: remaining.get(batch.id) ?? 0,
      ingredient: byId.get(batch.ingredientId),
    }))
  }, [expiring, remaining, ingredients])

  if (!day || items.length === 0) return null

  return (
    <section aria-labelledby="use-soon-head">
      <h3 id="use-soon-head" className="sp-lhead">Use soon</h3>
      {items.map(({ batch, amount, ingredient }) => {
        const expiresOn = batch.expiresOn ?? ''
        const expired = expiresOn < day
        return (
          <div key={batch.id} className="sp-lrow">
            <span className="sp-lrow-main">
              <span className="sp-lrow-name">{ingredient?.name ?? 'Unknown'}</span>
              <span className="sp-lrow-sub">{round1(amount)} {ingredient?.unit}</span>
            </span>
            <span className="sp-inv-hint" data-expired={expired ? '' : undefined}>
              {expired ? 'Expired' : 'Expires'} {dayjs(expiresOn).format('D MMM')}
            </span>
          </div>
        )
      })}
    </section>
  )
}
