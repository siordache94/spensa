import { useState, type FormEvent } from 'react'
import { Alert, Button, Center, Divider, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { supabase } from '../lib/supabase.ts'

const INVITE_ONLY = 'Spensa is invite-only. Ask a household member for an invite link.'

export default function AuthPage() {
  const inviteFromLink = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [mode, setMode] = useState<'signIn' | 'signUp'>(inviteFromLink ? 'signUp' : 'signIn')
  const [inviteCode, setInviteCode] = useState(inviteFromLink)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signInWithGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (error) setError(error.message)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return setError('Enter your email.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')

    setError(null)
    setBusy(true)
    const credentials = { email: email.trim(), password }
    const { error } =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: { data: inviteCode.trim() ? { invite_code: inviteCode.trim() } : undefined },
          })
    setBusy(false)
    if (error) {
      // The server's "before user created" hook refuses signups without an allowlisted email or valid invite code.
      const refused = mode === 'signUp' && (error.status === 403 || error.message.includes('invite-only'))
      setError(refused ? INVITE_ONLY : error.message)
    }
  }

  const signingIn = mode === 'signIn'

  return (
    <Center mih="100vh" p="md">
      <Paper w="100%" maw={380} p="lg" withBorder>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>{signingIn ? 'Sign in' : 'Create account'}</Title>
            {error && <Alert color="red">{error}</Alert>}
            <Button type="button" variant="default" onClick={signInWithGoogle}>
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
