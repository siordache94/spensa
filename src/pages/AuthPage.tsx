import { useState, type FormEvent } from 'react'
import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { supabase } from '../lib/supabase.ts'

export default function AuthPage() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        : await supabase.auth.signUp(credentials)
    setBusy(false)
    if (error) setError(error.message)
  }

  const signingIn = mode === 'signIn'

  return (
    <Center mih="100vh" p="md">
      <Paper w="100%" maw={380} p="lg" withBorder>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>{signingIn ? 'Sign in' : 'Create account'}</Title>
            {error && <Alert color="red">{error}</Alert>}
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
              description="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
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
