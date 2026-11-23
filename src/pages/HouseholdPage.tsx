import { useState } from 'react'
import { Alert, Button, Center, Paper, Stack, TextInput, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'

export default function HouseholdPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    setBusy(true)
    const { error } = await call()
    setBusy(false)
    if (error) return setError(error.message)
    window.history.replaceState(null, '', window.location.pathname)
    await queryClient.invalidateQueries({ queryKey: ['household'] })
  }

  return (
    <Center mih="100vh" p="md">
      <Stack w="100%" maw={380}>
        {error && <Alert color="red">{error}</Alert>}

        <Paper p="lg" withBorder>
          <form onSubmit={(e) => { e.preventDefault(); run(() => supabase.rpc('create_household', { name: name.trim() })) }}>
            <Stack>
              <Title order={3}>Create household</Title>
              <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <Button type="submit" loading={busy} disabled={!name.trim()}>Create</Button>
            </Stack>
          </form>
        </Paper>

        <Paper p="lg" withBorder>
          <form onSubmit={(e) => { e.preventDefault(); run(() => supabase.rpc('join_household', { code: code.trim() })) }}>
            <Stack>
              <Title order={3}>Join household</Title>
              <TextInput label="Invite code" value={code} onChange={(e) => setCode(e.currentTarget.value)} />
              <Button type="submit" loading={busy} disabled={!code.trim()}>Join</Button>
            </Stack>
          </form>
        </Paper>

        <Button variant="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </Stack>
    </Center>
  )
}
