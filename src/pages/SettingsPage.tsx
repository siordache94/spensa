import { useEffect, useState } from 'react'
import { Button, Group, SegmentedControl, Stack, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { Stepper } from '../components/Stepper.tsx'
import { notifications } from '@mantine/notifications'
import { useCommand } from '../lib/api/command.ts'
import { useMyId } from '../lib/api/auth.ts'
import { saveYourName, updateHousehold, useHouseholdSettings, useMembers } from '../lib/api/household.ts'
import { PrivacyAndData } from './AccountData.tsx'
import NotificationSettings from '../components/NotificationSettings.tsx'
import { useSettings, type Density, type ThemeName } from '../lib/settings.ts'
import { useSaveSlotEndTimes, useSlotEndTimes } from '../lib/api/checkins.ts'
import { isEndTime, slotLabel } from '../lib/checkin.ts'
import './lists.css'

const notifyFailure = (title: string) => (e: Error) => notifications.show({ color: 'red', title, message: e.message })

function YourName() {
  const me = useMyId()
  const members = useMembers()
  const saved = members.data?.find((m) => m.user_id === me)?.display_name ?? ''
  const [value, setValue] = useState('')
  useEffect(() => setValue(saved), [saved])
  const save = useCommand(saveYourName, { onError: notifyFailure('Could not save') })
  const clean = value.trim()
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (me) save.mutate({ userId: me, displayName: clean }) }}>
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label="Your name"
          description="Shown as the cook on planned meals. Shared with your household."
          maxLength={40}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <Button type="submit" loading={save.isPending} disabled={!me || !clean || clean === saved}>Save</Button>
      </Group>
    </form>
  )
}

const intIn = (v: number | null, min: number, max: number): v is number => v != null && Number.isInteger(v) && v >= min && v <= max

/** Settings every member shares: they live on the household row and sync to both phones. */
function HouseholdSettings() {
  const household = useHouseholdSettings()
  const saved = household.data
  const [horizon, setHorizon] = useState<number | null>(7)
  const [expiring, setExpiring] = useState<number | null>(3)
  const [reminder, setReminder] = useState<number | null>(2)
  useEffect(() => {
    if (saved) { setHorizon(saved.horizon_days); setExpiring(saved.expiring_days); setReminder(saved.expiry_reminder_days) }
  }, [saved])
  const save = useCommand(updateHousehold, { onError: notifyFailure('Could not save') })
  const valid = intIn(horizon, 1, 14) && intIn(expiring, 0, 60) && intIn(reminder, 0, 14)
  const changed = !!saved && (horizon !== saved.horizon_days || expiring !== saved.expiring_days || reminder !== saved.expiry_reminder_days)
  return (
    <Stack gap="md">
      <h3 className="sp-lhead">Household</h3>
      <Stepper
        label="Shopping horizon"
        description="A shopping trip covers today and the next N days. You can still leave meals off the trip."
        unit="days"
        size="lg"
        min={1}
        max={14}
        allowDecimal={false}
        value={horizon}
        onChange={setHorizon}
        error={horizon !== null && !intIn(horizon, 1, 14) ? 'Between 1 and 14' : undefined}
      />
      <Stepper
        label="Expiring soon"
        description="Batches that expire within N days show as expiring soon."
        unit="days"
        size="lg"
        min={0}
        max={60}
        allowDecimal={false}
        value={expiring}
        onChange={setExpiring}
        error={expiring !== null && !intIn(expiring, 0, 60) ? 'Between 0 and 60' : undefined}
      />
      <Stepper
        label="Expiry reminder"
        description="The daily expiry notification lists food that expires within N days (0 = today only)."
        unit="days"
        size="lg"
        min={0}
        max={14}
        allowDecimal={false}
        value={reminder}
        onChange={setReminder}
        error={reminder !== null && !intIn(reminder, 0, 14) ? 'Between 0 and 14' : undefined}
      />
      <Button
        loading={save.isPending}
        disabled={!saved || !valid || !changed}
        onClick={() => save.mutate({ horizon_days: horizon!, expiring_days: expiring!, expiry_reminder_days: reminder! })}
      >
        Save household settings
      </Button>
    </Stack>
  )
}

/** When each slot ends (ADR 0005). The check-in comes 30 minutes later. Shows the default where nothing is stored. */
function SlotEndTimes() {
  const { slots, endTimes } = useSlotEndTimes()
  const save = useSaveSlotEndTimes()
  const [times, setTimes] = useState<Record<string, string>>({})
  // a string key, so the effect does not re-run on every render while the query loads
  const shown = JSON.stringify(endTimes)
  useEffect(() => setTimes(JSON.parse(shown) as Record<string, string>), [shown])
  const valid = slots.every((s) => isEndTime(times[s] ?? ''))
  const changed = slots.some((s) => times[s] !== endTimes[s])
  return (
    <Stack gap="md">
      <h3 className="sp-lhead">Meal end times</h3>
      <p className="sp-dim">When each slot ends. Shared with your household.</p>
      {slots.map((s) => (
        <TimeInput
          key={s}
          label={slotLabel(s)}
          value={times[s] ?? ''}
          error={isEndTime(times[s] ?? '') ? undefined : 'Pick a time'}
          onChange={(e) => setTimes((t) => ({ ...t, [s]: e.currentTarget.value }))}
          w={160}
        />
      ))}
      <Button
        loading={save.isPending}
        disabled={!valid || !changed}
        onClick={() => save.mutate(Object.fromEntries(slots.map((s) => [s, times[s]])), { onError: notifyFailure('Could not save') })}
      >
        Save meal end times
      </Button>
    </Stack>
  )
}

export default function SettingsPage() {
  const [settings, update] = useSettings()
  return (
    <Stack gap="xl" className="sp-narrow">
      <h2 className="sp-title">Settings</h2>
      <YourName />
      <HouseholdSettings />
      <SlotEndTimes />
      <NotificationSettings />
      <p className="sp-dim">Theme and density are saved on this device only.</p>

      <Stack gap={6}>
        <h3 className="sp-lhead">Theme</h3>
        <SegmentedControl
          fullWidth
          aria-label="Theme"
          value={settings.theme}
          onChange={(v) => update({ theme: v as ThemeName })}
          data={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'amoled', label: 'AMOLED' }]}
        />
        <p className="sp-dim">Follows your phone until you pick one. AMOLED is pure black with the highest contrast.</p>
      </Stack>

      <Stack gap={6}>
        <h3 className="sp-lhead">Density</h3>
        <SegmentedControl
          fullWidth
          aria-label="Density"
          value={settings.density}
          onChange={(v) => update({ density: v as Density })}
          data={[{ value: 'compact', label: 'Compact' }, { value: 'airy', label: 'Airy' }]}
        />
        <p className="sp-dim">Airy makes rows and tick boxes larger for one-handed use in the shop.</p>
      </Stack>

      <PrivacyAndData />

      <p className="sp-dim">Build {__BUILD__}</p>
    </Stack>
  )
}
