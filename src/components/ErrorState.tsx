import { Button, Group, Stack, Text, Title } from '@mantine/core'

export type ErrorStateProps = {
  /** `full`: no data to show. `inline`: a one-line notice above saved data that could not be refreshed. */
  variant?: 'full' | 'inline'
  /** Full only. Default "Couldn't load your list". */
  title?: string
  /** Inline only. Default "Can't refresh. Showing your saved list." */
  message?: string
  /** Runs when Retry is tapped. */
  onRetry: () => void
  /** Shows Retry as busy while a refetch is in flight. */
  retrying?: boolean
}

/** Shown when a list cannot load. Use `full` when there is no cached data, `inline` when cached data is on screen. */
export function ErrorState({ variant = 'full', title = "Couldn't load your list", message = "Can't refresh. Showing your saved list.", onRetry, retrying = false }: ErrorStateProps) {
  if (variant === 'inline') {
    return (
      <Group role="alert" wrap="nowrap" justify="space-between" gap="sm" px="md" py={4}>
        <Text size="sm" c="var(--sp-red)">{message}</Text>
        <Button variant="default" size="sm" mih={44} loading={retrying} onClick={onRetry}>Retry</Button>
      </Group>
    )
  }
  return (
    <Stack role="alert" align="center" gap="md" py="xl" px="md" ta="center">
      <Title order={2} className="sp-heading" fz={20}>{title}</Title>
      <Button size="md" mih={44} loading={retrying} onClick={onRetry}>Retry</Button>
    </Stack>
  )
}
