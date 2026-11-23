import { NumberInput, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { useSettings, type Density, type ThemeName } from '../lib/settings.ts'

export default function SettingsPage() {
  const [settings, update] = useSettings()
  return (
    <Stack gap="xl" maw={480}>
      <Title order={2}>Settings</Title>
      <Text size="sm" c="dimmed" mt={-12}>Saved on this device only.</Text>

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
