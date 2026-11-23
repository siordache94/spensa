import { useState } from 'react'
import { Alert, Anchor, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'

const CONFIRM_WORD = 'DELETE'
// Deployers point this at their own filled-in notice (see PRIVACY.md).
const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL || 'https://github.com/siordache94/spensa/blob/main/PRIVACY.md'

function ExportData() {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    const { data, error } = await supabase.rpc('export_my_data')
    setBusy(false)
    if (error) return notifications.show({ color: 'red', title: 'Could not export', message: error.message })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spensa-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <Stack gap={6} align="flex-start">
      <Text fw={600} className="sp-label">Download my data</Text>
      <Text size="sm" c="dimmed">
        A JSON file with your account details and everything your household holds, including items you deleted.
      </Text>
      <Button variant="default" loading={busy} onClick={download}>Download my data</Button>
    </Stack>
  )
}

function DeleteAccount() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function purge() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' })
    if (error) {
      setBusy(false)
      return setError('Could not delete your account. Nothing was lost; try again.')
    }
    queryClient.clear()
    await supabase.auth.signOut({ scope: 'local' }) // the server session is already gone
  }

  return (
    <Stack gap={6} align="flex-start">
      <Text fw={600} className="sp-label">Delete my account</Text>
      <Text size="sm" c="dimmed">
        Permanently deletes your account. If you are the last member, your household and all its data go too. Otherwise the
        household keeps its data and your name is removed from it. This cannot be undone.
      </Text>
      <Button color="red" variant="outline" onClick={() => { setTyped(''); setError(null); setOpen(true) }}>Delete my account</Button>
      <Modal opened={open} onClose={() => !busy && setOpen(false)} title="Delete your account?" centered>
        <form onSubmit={(e) => { e.preventDefault(); if (typed === CONFIRM_WORD) purge() }}>
          <Stack>
            <Alert color="red">This is permanent. There is no way to get your account or its data back.</Alert>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput
              label={`Type ${CONFIRM_WORD} to confirm`}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" color="red" loading={busy} disabled={typed !== CONFIRM_WORD}>Delete forever</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}

export function PrivacyAndData() {
  return (
    <Stack gap="lg">
      <ExportData />
      <DeleteAccount />
      <Text size="sm">
        <Anchor href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy notice</Anchor>
      </Text>
    </Stack>
  )
}
