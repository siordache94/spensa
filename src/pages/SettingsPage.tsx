import { useEffect, useState } from 'react'
import { Button, Group, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { Stepper } from '../components/Stepper.tsx'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMembers, useMyId } from '../lib/members.ts'
import { supabase } from '../lib/supabase.ts'
import { PrivacyAndData } from './AccountData.tsx'
import { useSettings, type Density, type ThemeName } from '../lib/settings.ts'

function YourName() {
  const queryClient = useQueryClient()
  const me = useMyId()
  const members = useMembers()
  const saved = members.data?.find((m) => m.user_id === me)?.display_name ?? ''
  const [value, setValue] = useState('')
  useEffect(() => setValue(saved), [saved])
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('household_members').update({ display_name: value.trim() }).eq('user_id', me!)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household', 'members'] }),
    onError: (e) => notifications.show({ color: 'red', title: 'Could not save', message: e.message }),
  })
  const clean = value.trim()
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
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
  const queryClient = useQueryClient()
  const household = useQuery({
    queryKey: ['household', 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('households').select('id, timezone, expiring_days, horizon_days, slots').single()
      if (error) throw error
      return data
    },
  })
  const saved = household.data
  const [horizon, setHorizon] = useState<number | null>(7)
  const [expiring, setExpiring] = useState<number | null>(3)
  useEffect(() => {
    if (saved) { setHorizon(saved.horizon_days); setExpiring(saved.expiring_days) }
  }, [saved])
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('households').update({ horizon_days: horizon!, expiring_days: expiring! }).not('id', 'is', null)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household', 'settings'] }),
    onError: (e) => notifications.show({ color: 'red', title: 'Could not save', message: e.message }),
  })
  const valid = intIn(horizon, 1, 14) && intIn(expiring, 0, 60)
  const changed = !!saved && (horizon !== saved.horizon_days || expiring !== saved.expiring_days)
  return (
    <Stack gap="md">
      <Title order={3}>Household</Title>
      <Text size="sm" c="dimmed">Shared with your household, so both phones use the same values.</Text>
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
      <Button loading={save.isPending} disabled={!saved || !valid || !changed} onClick={() => save.mutate()}>Save household settings</Button>
    </Stack>
  )
}

export default function SettingsPage() {
  const [settings, update] = useSettings()
  return (
    <Stack gap="xl" maw={480}>
      <Title order={2}>Settings</Title>
      <YourName />
      <HouseholdSettings />
      <Text size="sm" c="dimmed">Theme and density are saved on this device only.</Text>

      <Stack gap={6}>
        <Text fw={600} className="sp-label">Theme</Text>
        <SegmentedControl
          fullWidth
          aria-label="Theme"
          value={settings.theme}
          onChange={(v) => update({ theme: v as ThemeName })}
          data={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'amoled', label: 'AMOLED' }]}
        />
        <Text size="sm" c="dimmed">Follows your phone until you pick one. AMOLED is pure black with the highest contrast.</Text>
      </Stack>

      <Stack gap={6}>
        <Text fw={600} className="sp-label">Density</Text>
        <SegmentedControl
          fullWidth
          aria-label="Density"
          value={settings.density}
          onChange={(v) => update({ density: v as Density })}
          data={[{ value: 'compact', label: 'Compact' }, { value: 'airy', label: 'Airy' }]}
        />
        <Text size="sm" c="dimmed">Airy makes rows and tick boxes larger for one-handed use in the shop.</Text>
      </Stack>

      <PrivacyAndData />

      <Text size="xs" c="dimmed">Build {__BUILD__}</Text>
    </Stack>
  )
}
