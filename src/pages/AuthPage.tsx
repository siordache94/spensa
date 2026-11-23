import { useState, type FormEvent } from 'react'
import { Alert, Button, Center, Divider, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { useCommand } from '../lib/api/command.ts'
import { signIn, signInWithGoogle, signUp } from '../lib/api/auth.ts'

export default function AuthPage() {
  const inviteFromLink = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [mode, setMode] = useState<'signIn' | 'signUp'>(inviteFromLink ? 'signUp' : 'signIn')
  const [inviteCode, setInviteCode] = useState(inviteFromLink)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const onFailure = (e: Error) => setError(e.message)
  const google = useCommand(signInWithGoogle, { onError: onFailure })
  const signingInCmd = useCommand(signIn, { onError: onFailure })
  const signingUpCmd = useCommand(signUp, { onError: onFailure })
  const busy = signingInCmd.isPending || signingUpCmd.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return setError('Enter your email.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')

    setError(null)
    if (mode === 'signIn') signingInCmd.mutate({ email, password })
    else signingUpCmd.mutate({ email, password, inviteCode })
  }

  const signingIn = mode === 'signIn'

  return (
    <Center mih="100vh" p="md">
      <Paper w="100%" maw={380} p="lg" withBorder>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>{signingIn ? 'Sign in' : 'Create account'}</Title>
            {error && <Alert color="red">{error}</Alert>}
            <Button type="button" variant="default" onClick={() => { setError(null); google.mutate() }}>
              Continue with Google
            </Button>
            <Divider label="or" labelPosition="center" />
            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              autoComplete={signingIn ? 'current-password' : 'new-password'}
              description={signingIn ? undefined : 'At least 8 characters'}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            {!signingIn && (
              <TextInput
                label="Invite code"
                description="From your invite link or a household member. Not needed if your email was approved."
                value={inviteCode}
                onChange={(e) => setInviteCode(e.currentTarget.value)}
              />
            )}
            <Button type="submit" loading={busy}>
              {signingIn ? 'Sign in' : 'Create account'}
            </Button>
            <Button variant="subtle" onClick={() => { setMode(signingIn ? 'signUp' : 'signIn'); setError(null) }}>
              {signingIn ? 'No account? Create one' : 'Have an account? Sign in'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
