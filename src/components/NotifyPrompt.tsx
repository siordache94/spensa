import { useState } from 'react'
import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { IconBell } from '@tabler/icons-react'
import { memberLabel, useMembers, useMyId } from '../lib/members.ts'
import { dismissPrompt, enablePush, promptDismissed, pushConfigured, useDeviceSubscribed, useInstallApp, usePushStatus, type Prompt } from '../lib/push.ts'

/** The iOS Share button, drawn inline so the instruction can point at the real thing. */
export function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Share" style={{ verticalAlign: '-3px' }}>
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </svg>
  )
}

/** Hides a prompt for two weeks (per device) and re-renders without it. */
function useDismiss(p: Prompt) {
  const [hidden, setHidden] = useState(() => promptDismissed(p))
  return [hidden, () => { dismissPrompt(p); setHidden(true) }] as const
}

/**
 * Top of the Plan tab. On an iPhone that is not installed yet: how to install (notifications are impossible
 * before). Otherwise a one-time card asking to turn notifications on. Nothing once subscribed.
 */
export default function NotifyPrompt() {
  const status = usePushStatus()
  const subscribed = useDeviceSubscribed()
  const install = useInstallApp()
  const members = useMembers().data
  const me = useMyId()
  const queryClient = useQueryClient()
  const [notifyHidden, hideNotify] = useDismiss('notify')
  const [installHidden, hideInstall] = useDismiss('install')
  const [busy, setBusy] = useState(false)

  if (!pushConfigured) return null

  if (status === 'install-ios') {
    if (installHidden) return null
    return (
      <Alert color="yellow" variant="light" title="Install Spensa to get notifications" withCloseButton closeButtonLabel="Hide for two weeks" onClose={hideInstall}>
        <Text size="sm">Tap Share <ShareIcon />, then Add to Home Screen. Open Spensa from the Home Screen and turn notifications on there.</Text>
      </Alert>
    )
  }

  if (status !== 'available' || notifyHidden || subscribed.isPending || subscribed.data) return null

  const partner = members?.filter((m) => m.user_id !== me).map((m) => (m.display_name ? memberLabel(m) : null)).find(Boolean) ?? 'your partner'

  async function turnOn() {
    setBusy(true)
    try {
      await enablePush()
      await queryClient.invalidateQueries({ queryKey: ['push'] })
      notifications.show({ message: 'Notifications are on. You can change them in Settings.' })
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not turn on notifications', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <IconBell size={20} stroke={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <Text size="sm">Get notified when {partner} changes the list or food is about to expire.</Text>
        </Group>
        <Group gap="xs" justify="flex-end">
          {install && <Button variant="subtle" size="sm" onClick={() => void install()}>Install app</Button>}
          <Button variant="default" size="sm" onClick={hideNotify}>Not now</Button>
          <Button size="sm" loading={busy} onClick={turnOn}>Turn on</Button>
        </Group>
      </Stack>
    </Paper>
  )
}
