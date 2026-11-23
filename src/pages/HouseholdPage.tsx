import { useEffect, useState } from 'react'
import { Alert, Button, Center, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.ts'

function friendlyError(message: string) {
  if (message.includes('invalid invite code')) return "That invite code doesn't match any household."
  return 'Something went wrong. Try again.'
}

export default function HouseholdPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '')
  const [yourName, setYourName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const full = data.session?.user.user_metadata?.full_name
      if (typeof full === 'string') setYourName((cur) => cur || full.slice(0, 40))
    })
  }, [])

  const display_name = yourName.trim() || undefined

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    setBusy(true)
    const { error } = await call()
    setBusy(false)
    if (error) {
      console.error(error)
      return setError(friendlyError(error.message))
    }
    window.history.replaceState(null, '', window.location.pathname)
    await queryClient.invalidateQueries({ queryKey: ['household'] })
  }

  return (
    <Center mih="100vh" p="md">
      <Stack w="100%" maw={380}>
        <Stack gap={4}>
          <Title order={2}>Set up your household</Title>
          <Text c="dimmed">Create one for your home, or join your partner's with their invite code.</Text>
        </Stack>

        {error && <Alert color="red">{error}</Alert>}

        <TextInput
          label="Your name"
          description="How you appear to your household, for example as the cook."
          maxLength={40}
          value={yourName}
          onChange={(e) => setYourName(e.currentTarget.value)}
        />

        <Paper p="lg" withBorder>
          <form onSubmit={(e) => { e.preventDefault(); run(() => supabase.rpc('create_household', { name: name.trim(), display_name })) }}>
            <Stack>
              <Title order={3}>Create a household</Title>
              <TextInput label="Household name" placeholder="e.g. Casa Rossi" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <Button type="submit" loading={busy} disabled={!name.trim()}>Create household</Button>
            </Stack>
          </form>
        </Paper>

        <Paper p="lg" withBorder>
          <form onSubmit={(e) => { e.preventDefault(); run(() => supabase.rpc('join_household', { code: code.trim(), display_name })) }}>
            <Stack>
              <Title order={3}>Join a household</Title>
              <TextInput
                label="Invite code"
                description="Ask your partner: it's in their household menu, or scan their QR code."
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
              <Button type="submit" loading={busy} disabled={!code.trim()}>Join household</Button>
            </Stack>
          </form>
        </Paper>

        <Button variant="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </Stack>
    </Center>
  )
}
