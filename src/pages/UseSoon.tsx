import { useMemo } from 'react'
import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import dayjs from 'dayjs'
import { usePantryState } from '../lib/api/pantry.ts'
import { round1 } from '../lib/format.ts'

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
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Title order={4}>Use soon</Title>
        {items.map(({ batch, amount, ingredient }) => {
          const expiresOn = batch.expiresOn ?? ''
          const expired = expiresOn < day
          return (
            <Group key={batch.id} justify="space-between" wrap="nowrap" gap="xs">
              <Text truncate="end" miw={0}>
                {ingredient?.name ?? 'Unknown'}{' '}
                <Text component="span" size="sm" c="dimmed">
                  {round1(amount)} {ingredient?.unit}
                </Text>
              </Text>
              <Badge color={expired ? 'red' : 'yellow'} variant="light" style={{ flexShrink: 0 }}>
                {dayjs(expiresOn).format('D MMM YYYY')}
              </Badge>
            </Group>
          )
        })}
      </Stack>
    </Paper>
  )
}
