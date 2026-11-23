import { useEffect, useState } from 'react'
import { Button, Group, NumberInput, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMembers, useMyId } from '../lib/members.ts'
import { supabase } from '../lib/supabase.ts'
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

export default function SettingsPage() {
  const [settings, update] = useSettings()
  return (
    <Stack gap="xl" maw={480}>
      <Title order={2}>Settings</Title>
      <YourName />
      <Text size="sm" c="dimmed">Theme, density and shopping horizon are saved on this device only.</Text>

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

      <NumberInput
        label="Pre-select meals for the next N days"
        description="Used when you start a shopping trip; you can still add or remove meals."
        min={1}
        max={14}
        startValue={7}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="strict"
        value={settings.horizonDays}
        onChange={(v) => { if (typeof v === 'number') update({ horizonDays: v }) }}
        onBlur={(e) => { if (e.currentTarget.value === '') update({ horizonDays: 7 }) }}
      />
    </Stack>
  )
}
