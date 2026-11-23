import { useState } from 'react'
import { Alert, Button, Center, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { useCommand } from '../lib/api/command.ts'
import { signOut, useAuthSession } from '../lib/api/auth.ts'
import { createHousehold, joinHousehold } from '../lib/api/household.ts'

export default function HouseholdPage() {
  const [name, setName] = useState('')
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '')
  const [yourName, setYourName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Sign-up details (name, invite code) fill the empty fields once, when the session first arrives.
  const session = useAuthSession()
  const [prefilledFrom, setPrefilledFrom] = useState<typeof session.data>(undefined)
  if (session.data && session.data !== prefilledFrom) {
    setPrefilledFrom(session.data)
    const full = session.data.metadata.full_name
    const invite = session.data.metadata.invite_code
    if (typeof full === 'string') setYourName((cur) => cur || full.slice(0, 40))
    if (typeof invite === 'string') setCode((cur) => cur || invite)
  }

  const displayName = yourName.trim() || undefined

  const onFailure = (err: Error) => {
    console.error(err)
    setError(err.message)
  }
  // The commands refresh the household row, and App then shows the shell instead of this page.
  const onDone = () => window.history.replaceState(null, '', window.location.pathname)
  const create = useCommand(createHousehold, { onSuccess: onDone, onError: onFailure })
  const join = useCommand(joinHousehold, { onSuccess: onDone, onError: onFailure })
  const leave = useCommand(signOut)
  const busy = create.isPending || join.isPending

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
          <form onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate({ name: name.trim(), displayName }) }}>
            <Stack>
              <Title order={3}>Create a household</Title>
              <TextInput label="Household name" placeholder="e.g. Casa Rossi" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <Button type="submit" loading={busy} disabled={!name.trim()}>Create household</Button>
            </Stack>
          </form>
        </Paper>

        <Paper p="lg" withBorder>
          <form onSubmit={(e) => { e.preventDefault(); setError(null); join.mutate({ code: code.trim(), displayName }) }}>
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

        <Button variant="subtle" onClick={() => leave.mutate()}>Sign out</Button>
      </Stack>
    </Center>
  )
}
