import { useState } from 'react'
import { Button, Group, SegmentedControl, Select, Stack, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { Stepper } from '../components/Stepper.tsx'
import { notifications } from '@mantine/notifications'
import { useCommand } from '../lib/api/command.ts'
import { useMyId } from '../lib/api/auth.ts'
import { deviceTimeZone, saveYourName, updateHousehold, useHouseholdSettings, useMembers } from '../lib/api/household.ts'
import { PrivacyAndData } from './AccountData.tsx'
import NotificationSettings from '../components/NotificationSettings.tsx'
import { useSettings, type Density, type ThemeName } from '../lib/settings.ts'
import { useSaveSlotEndTimes, useSlotEndTimes } from '../lib/api/checkins.ts'
import { isEndTime, slotLabel } from '../lib/checkin.ts'
import { initialSlotTimes, slotTimeEdit, slotTimesChanged, slotTimesPayload, slotTimesValid } from '../lib/slotTimesForm.ts'
import './lists.css'

const notifyFailure = (title: string) => (e: Error) => notifications.show({ color: 'red', title, message: e.message })

/** A section whose row has not arrived yet: no placeholder default, so the form never flashes or jumps. */
function SectionLoading({ title, error }: { title: string; error: boolean }) {
  return (
    <Stack gap="md">
      <h3 className="sp-lhead">{title}</h3>
      <p className="sp-dim">{error ? 'Could not load. Check your connection and try again.' : 'Loading…'}</p>
    </Stack>
  )
}

function YourName() {
  const me = useMyId()
  const members = useMembers()
  if (!members.data || me === undefined) return <SectionLoading title="Your name" error={members.isError} />
  const saved = members.data.find((m) => m.user_id === me)?.display_name ?? ''
  // Keyed by the stored name: our own save or a partner's rename restarts the field from the server value.
  return <YourNameForm key={saved} saved={saved} me={me} />
}

function YourNameForm({ saved, me }: { saved: string; me: string | null | undefined }) {
  const [value, setValue] = useState(saved)
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

/** Every IANA zone the browser knows, for the searchable picker. A stored zone outside the list is added by the form. */
const TIME_ZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

/** Settings every member shares: they live on the household row and sync to both phones. */
function HouseholdSettings() {
  const household = useHouseholdSettings()
  const saved = household.data
  if (!saved) return <SectionLoading title="Household" error={household.isError} />
  // Keyed by the stored row: a save from either phone restarts the form from the server, with no effect copying query
  // data into state (and no lost edits when a refetch returns the same values).
  return <HouseholdForm key={JSON.stringify(saved)} saved={saved} />
}

type HouseholdRow = NonNullable<ReturnType<typeof useHouseholdSettings>['data']>

function HouseholdForm({ saved }: { saved: HouseholdRow }) {
  const [horizon, setHorizon] = useState<number | null>(saved.horizon_days)
  const [expiring, setExpiring] = useState<number | null>(saved.expiring_days)
  const [reminder, setReminder] = useState<number | null>(saved.expiry_reminder_days)
  const [zone, setZone] = useState<string | null>(saved.timezone)
  const save = useCommand(updateHousehold, { onError: notifyFailure('Could not save') })
  const valid = intIn(horizon, 1, 14) && intIn(expiring, 0, 60) && intIn(reminder, 0, 14) && !!zone
  const changed = horizon !== saved.horizon_days || expiring !== saved.expiring_days || reminder !== saved.expiry_reminder_days || zone !== saved.timezone
  // tripRange is today plus horizon-1 days, so the copy must not promise N days after today.
  const span = valid && horizon !== null
    ? `today${horizon === 1 ? ' only' : ` and the next ${horizon - 1} day${horizon === 2 ? '' : 's'}`}`
    : 'today and the days after it'
  // The stored zone must stay selectable even if the browser's list has dropped it.
  const zones = zone && !TIME_ZONES.includes(zone) ? [zone, ...TIME_ZONES] : TIME_ZONES
  const deviceZone = deviceTimeZone()
  return (
    <Stack gap="md">
      <h3 className="sp-lhead">Household</h3>
      <Stack gap="xs">
        <Select
          label="Timezone"
          description="Drives today, meal end times and reminders. Shared with your household."
          searchable
          nothingFoundMessage="No such timezone"
          data={zones}
          value={zone}
          onChange={setZone}
          styles={{ input: { minHeight: 44 } }}
        />
        {deviceZone && (
          <Group>
            <Button variant="default" h={44} disabled={zone === deviceZone} onClick={() => setZone(deviceZone)}>
              Use this device's zone ({deviceZone})
            </Button>
          </Group>
        )}
      </Stack>
      <Stepper
        label="Shopping horizon"
        description={`A shopping trip covers ${span}. You can still leave meals off the trip.`}
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
        disabled={!valid || !changed}
        onClick={() => save.mutate({ timezone: zone!, horizon_days: horizon!, expiring_days: expiring!, expiry_reminder_days: reminder! })}
      >
        Save household settings
      </Button>
    </Stack>
  )
}

/** When each slot ends (ADR 0005). The check-in comes 30 minutes later. Shows the default where nothing is stored. */
function SlotEndTimes() {
  const q = useSlotEndTimes()
  if (!q.data) return <SectionLoading title="Meal end times" error={q.isError} />
  const { slots, endTimes } = q
  // Keyed by the stored times: a change from either phone restarts the fields from the server, not from an effect copy.
  return <SlotTimesForm key={`${slots.join('|')}:${JSON.stringify(endTimes)}`} slots={slots} endTimes={endTimes} />
}

function SlotTimesForm({ slots, endTimes }: { slots: string[]; endTimes: Record<string, string> }) {
  const save = useSaveSlotEndTimes()
  const [times, setTimes] = useState<Record<string, string>>(() => initialSlotTimes(endTimes))
  const valid = slotTimesValid(slots, times)
  const changed = slotTimesChanged(slots, times, endTimes)
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
          // The updater is built from the event now; React may run it later, when currentTarget is null.
          onChange={(e) => setTimes(slotTimeEdit(e, s))}
          w={160}
        />
      ))}
      <Button
        loading={save.isPending}
        disabled={!valid || !changed}
        onClick={() => save.mutate(slotTimesPayload(slots, times), { onError: notifyFailure('Could not save') })}
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
      <h1 className="sp-title">Settings</h1>
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
          value={settings.themeChoice ?? 'auto'}
          onChange={(v) => update({ themeChoice: v === 'auto' ? null : (v as ThemeName) })}
          data={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'amoled', label: 'AMOLED' }]}
        />
        <p className="sp-dim">Auto follows your phone. AMOLED is pure black with the highest contrast.</p>
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
