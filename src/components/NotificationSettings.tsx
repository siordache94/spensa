import { useState } from 'react'
import { Button, Group, Stack, Switch, Text, Title } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCommand } from '../lib/api/command.ts'
import { disableNotifications, savePushPrefs, sendTestNotification, useDeviceSubscribed, usePushPrefs, useTurnOnNotifications } from '../lib/api/push.ts'
import { pushConfigured, useInstallApp, usePushStatus } from '../lib/push.ts'
import { isTime } from '../lib/pushState.ts'
import { ShareIcon } from './NotifyPrompt.tsx'

const fail = (title: string) => (e: Error) => notifications.show({ color: 'red', title, message: e.message })

/** Settings > Notifications: this device, what to be told about, and a test. */
export default function NotificationSettings() {
  const status = usePushStatus()
  const subscribed = useDeviceSubscribed()
  const prefs = usePushPrefs()
  const save = useCommand(savePushPrefs, { onError: fail('Could not save') })
  const install = useInstallApp()
  const turnOn = useTurnOnNotifications({ onError: fail('Could not turn on notifications') })
  const turnOff = useCommand(disableNotifications, {
    onSuccess: () => notifications.show({ message: 'Notifications are off on this device.' }),
    onError: fail('Could not turn off notifications'),
  })
  const test = useCommand(sendTestNotification, {
    onSuccess: () => notifications.show({ message: 'Sent. It should arrive in a few seconds.' }),
    onError: fail('Test failed'),
  })
  const [time, setTime] = useState<string | null>(null) // what is typed, until it is a valid time

  if (!pushConfigured) return null

  const p = prefs.data
  const on = subscribed.data === true
  const shownTime = time ?? p?.expiry_time ?? '09:00'
  const patch = (next: Partial<NonNullable<typeof p>>) => p && save.mutate({ ...p, ...next })

  return (
    <Stack gap="md">
      <Title order={3}>Notifications</Title>

      {status === 'install-ios' && (
        <Text size="sm">Install Spensa to get notifications: tap Share <ShareIcon />, then Add to Home Screen, and open Spensa from there.</Text>
      )}
      {status === 'unsupported' && <Text size="sm" c="dimmed">This browser cannot show notifications from Spensa.</Text>}
      {status === 'blocked' && <Text size="sm" c="dimmed">Notifications are blocked for Spensa. Allow them in your browser or phone settings, then come back.</Text>}

      {status === 'available' && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{on ? 'This device gets notifications.' : 'This device does not get notifications.'}</Text>
          {on
            ? <Button variant="default" size="sm" loading={turnOff.isPending} onClick={() => turnOff.mutate()}>Turn off</Button>
            : <Button size="sm" loading={turnOn.isPending} disabled={subscribed.isPending} onClick={turnOn.turnOn}>Turn on</Button>}
        </Group>
      )}
      {install && <Button variant="default" size="sm" onClick={() => void install()}>Install app</Button>}

      {(status === 'available' || status === 'blocked') && p && (
        <>
          <Switch
            label="List changes"
            description="When your partner adds or removes things on the shopping list. Changes within 30 seconds arrive as one message."
            checked={p.list_changes}
            onChange={(e) => patch({ list_changes: e.currentTarget.checked })}
          />
          <Switch
            label="Meal check-ins"
            description="A silent message about 30 minutes after a slot ends, when a meal could not be covered by the pantry: was it cooked as planned? Slot times are under Household."
            checked={p.meal_checkins}
            onChange={(e) => patch({ meal_checkins: e.currentTarget.checked })}
          />
          <Switch
            label="Expiry reminder"
            description="One message a day listing food that expires soon, if any. How soon is set under Household."
            checked={p.expiry_time !== null}
            onChange={(e) => patch({ expiry_time: e.currentTarget.checked ? shownTime : null })}
          />
          {p.expiry_time !== null && (
            <TimeInput
              label="Remind me at"
              description="Household time. Off above stops the reminder."
              value={shownTime}
              onChange={(e) => {
                const v = e.currentTarget.value
                setTime(v)
                if (isTime(v) && v !== p.expiry_time) patch({ expiry_time: v })
              }}
              onBlur={() => setTime(null)}
              error={time !== null && !isTime(time) ? 'Pick a time' : undefined}
              w={160}
            />
          )}
        </>
      )}

      {status === 'available' && on && (
        <Button variant="default" loading={test.isPending} onClick={() => test.mutate()}>
          Send me a test notification
        </Button>
      )}
    </Stack>
  )
}
