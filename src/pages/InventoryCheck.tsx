import { useState } from 'react'
import { Alert, Button, Modal, NumberInput, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { invalidatePantry } from '../lib/pantry.ts'
import { supabase } from '../lib/supabase.ts'
import type { Tables } from '../lib/database.types.ts'
import type { Batch, Day } from '../domain/replay.ts'

type Ingredient = Tables<'ingredients'>
type Group = { ingredient: Ingredient; rows: { batch: Batch; amount: number }[] }

type Props = {
  groups: Group[] // every ingredient with batches in stock
  today: Day
  onClose: () => void
}

const num = (v: number | string) => (v === '' ? NaN : Number(v))
const fmt = (day: Day) => dayjs(day).format('D MMM YYYY')

export default function InventoryCheck({ groups, today, onClose }: Props) {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [qtys, setQtys] = useState<Record<string, number | string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.rows.map((r) => [r.batch.id, Number(r.amount.toFixed(3))]))),
  )
  const valid = groups.every((g) => g.rows.every((r) => num(qtys[r.batch.id]) >= 0))

  const save = useMutation({
    mutationFn: async () => {
      const { data: snapshot, error } = await supabase.from('snapshots').insert({ on_date: today }).select('id').single()
      if (error || !snapshot) throw new Error(error?.message ?? 'Snapshot not saved')

      const lines = groups
        .flatMap((g) => g.rows)
        .map((r) => ({ snapshot_id: snapshot.id, batch_id: r.batch.id, qty: num(qtys[r.batch.id]) }))
        .filter((l) => l.qty > 0)
      if (lines.length === 0) return // no lines: every batch is zero, which is what the snapshot says

      const { error: linesError } = await supabase.from('snapshot_batches').insert(lines)
      if (linesError) {
        // A snapshot with no lines would zero every batch, so take it back out.
        await supabase.from('snapshots').delete().eq('id', snapshot.id)
        throw new Error(linesError.message)
      }
    },
    onSuccess: onClose,
    onSettled: () => invalidatePantry(queryClient),
  })

  return (
    <Modal opened onClose={onClose} title="Inventory check" fullScreen={isMobile}>
      <Stack>
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <Text size="sm" c="dimmed">
          Amounts already account for today's planned meals. Correct what's off; 0 means gone.
        </Text>
        {groups.length === 0 && <Text>Nothing in the pantry to count.</Text>}

        {groups.map((g) => (
          <Stack key={g.ingredient.id} gap="xs">
            <Text fw={500}>{g.ingredient.name}</Text>
            {g.rows.map((r) => (
              <NumberInput
                key={r.batch.id}
                label={`Added ${fmt(r.batch.addedOn)} · ${r.batch.expiresOn ? `expires ${fmt(r.batch.expiresOn)}` : 'no expiry'}`}
                min={0}
                decimalScale={3}
                suffix={` ${g.ingredient.unit}`}
                value={qtys[r.batch.id]}
                onChange={(v) => setQtys((prev) => ({ ...prev, [r.batch.id]: v }))}
              />
            ))}
          </Stack>
        ))}

        <Button
          onClick={() => save.mutate()}
          disabled={!valid || groups.length === 0}
          loading={save.isPending}
        >
          Save inventory check
        </Button>
      </Stack>
    </Modal>
  )
}
