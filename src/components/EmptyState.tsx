import { Button, Stack, Text } from '@mantine/core'
import { Link } from 'react-router'

export type EmptyStateAction = {
  /** Button label: the one action that fixes the empty state. */
  label: string
  /** Runs on tap. Use `to` instead when the fix is another page. */
  onClick?: () => void
  /** A route to another page. */
  to?: string
}

export type EmptyStateProps = {
  /** A short headline: what is empty. */
  title: string
  /** One short line: why it is empty. */
  reason?: string
  /** The one action that fixes it. Omit only when the page already shows that action. */
  action?: EmptyStateAction
}

/** One shared empty state: a reason line and one primary action. Shop keeps its own list-specific copy. */
export function EmptyState({ title, reason, action }: EmptyStateProps) {
  return (
    <Stack align="flex-start" gap="sm" py="md">
      <Text fw={600}>{title}</Text>
      {reason && <Text size="sm" c="var(--sp-text2)">{reason}</Text>}
      {action && (action.to
        ? <Button component={Link} to={action.to} onClick={action.onClick}>{action.label}</Button>
        : <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </Stack>
  )
}
