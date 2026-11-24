import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Anchor, Button, Center, Divider, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { useCommand } from '../lib/api/command.ts'
import { useApi } from '../lib/api/context.tsx'
import {
  INVITE_ONLY_MESSAGE, readAuthRedirectError, requestPasswordReset, resendConfirmation, setNewPassword, signIn, signInWithGoogle, signUp, stripAuthRedirectError,
} from '../lib/api/auth.ts'
import { initialScreen, reduceAuth, type AuthScreen } from '../lib/authFlow.ts'
import { PRIVACY_URL } from './AccountData.tsx'
import './lists.css'

/** How long the resend button waits after a send (MR-015). */
const RESEND_COOLDOWN_S = 60

export default function AuthPage() {
  const api = useApi()
  const inviteFromLink = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [screen, setScreen] = useState<AuthScreen>(() => initialScreen(inviteFromLink))
  const [inviteCode, setInviteCode] = useState(inviteFromLink)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [resendWait, setResendWait] = useState(0)
  // A refused Google sign-in comes back in the URL. Read it once, then strip only the error params so Supabase's own handling is untouched.
  const [redirectError] = useState(() => readAuthRedirectError(window.location.search, window.location.hash))
  const [error, setError] = useState<string | null>(redirectError)
  const fromGoogleRedirect = redirectError !== null && error === redirectError
  useEffect(() => {
    const { search, hash } = window.location
    const next = stripAuthRedirectError(search, hash)
    if (next.search !== search || next.hash !== hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${next.search}${next.hash}`)
    }
  }, [])

  // A reset link signs in with a recovery session: show "Set a new password" whatever the signed-in state (MR-039).
  useEffect(() => api.live.onPasswordRecovery(() => {
    setScreen('setPassword')
    setError(null)
    setNotice(null)
  }), [api])

  // Resend cooldown, one second at a time.
  useEffect(() => {
    if (resendWait <= 0) return
    const id = setTimeout(() => setResendWait((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendWait])

  const onFailure = (e: Error) => setError(e.message)
  const go = (next: AuthScreen) => { setScreen(next); setError(null); setNotice(null) }
  const back = () => {
    // Leaving the set-password screen abandons the recovery session; the user signs in as usual.
    if (screen === 'setPassword') void api.auth.signOut('local').catch(() => { /* already gone */ })
    setPassword('')
    setConfirmPassword('')
    go('signIn')
  }

  const google = useCommand(signInWithGoogle, { onError: onFailure })
  const signingInCmd = useCommand(signIn, { onError: onFailure })
  const signingUpCmd = useCommand(signUp, {
    onError: onFailure,
    onSuccess: (out) => setScreen((current) => reduceAuth(current, { type: 'signedUp', outcome: out.needsConfirmation ? 'checkEmail' : 'signedIn' })),
  })
  const resend = useCommand(resendConfirmation, { onError: onFailure, onSuccess: () => setResendWait(RESEND_COOLDOWN_S) })
  const reset = useCommand(requestPasswordReset, {
    onError: onFailure,
    onSuccess: () => setScreen((current) => reduceAuth(current, { type: 'resetRequested' })),
  })
  const savePassword = useCommand(setNewPassword, {
    onError: onFailure,
    onSuccess: () => {
      setPassword('')
      setConfirmPassword('')
      go('signIn')
      setNotice('Password updated.')
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (screen === 'checkEmail' || screen === 'resetSent' || screen === 'signedIn') return
    if (screen !== 'setPassword' && !email.trim()) return setError('Enter your email.')

    if (screen === 'resetRequest') {
      setError(null)
      return reset.mutate({ email })
    }
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (screen === 'setPassword' && password !== confirmPassword) return setError("Passwords don't match.")

    setError(null)
    if (screen === 'signIn') signingInCmd.mutate({ email, password })
    else if (screen === 'signUp') signingUpCmd.mutate({ email, password, inviteCode })
    else savePassword.mutate({ password })
  }

  if (screen === 'signedIn') return null

  const withGoogle = screen === 'signIn' || screen === 'signUp'
  const title = screen === 'signIn' ? 'Sign in'
    : screen === 'signUp' ? 'Create account'
      : screen === 'resetRequest' ? 'Reset password'
        : screen === 'setPassword' ? 'Set a new password'
          : 'Check your email'

  return (
    <Center mih="100vh" p="md">
      <div className="sp-panel sp-block sp-authcard">
        <form onSubmit={submit}>
          <Stack>
            <h1 className="sp-title">{title}</h1>
            {error && (
              <Alert color="red">
                {error}
                {fromGoogleRedirect && error === INVITE_ONLY_MESSAGE && (
                  <div>Google sign-in works only for emails a household member has added. Use the invite link to sign up with email instead.</div>
                )}
              </Alert>
            )}
            {notice && <Alert color="green">{notice}</Alert>}

            {withGoogle && (
              <>
                <Button type="button" variant="default" onClick={() => { setError(null); google.mutate() }}>
                  Continue with Google
                </Button>
                <Divider label="or" labelPosition="center" />
              </>
            )}

            {screen === 'checkEmail' && (
              <>
                <Text>Check your email to confirm, then sign in.</Text>
                <Text size="sm" className="sp-selectable">{email}</Text>
                <Button
                  type="button"
                  variant="default"
                  loading={resend.isPending}
                  disabled={resendWait > 0}
                  onClick={() => { setError(null); resend.mutate({ email }) }}
                >
                  {resendWait > 0 ? `Resend in ${resendWait}s` : 'Resend email'}
                </Button>
              </>
            )}

            {screen === 'resetSent' && (
              <>
                <Text>Check your email for the reset link.</Text>
                <Text size="sm" className="sp-selectable">{email}</Text>
              </>
            )}

            {(screen === 'signIn' || screen === 'signUp' || screen === 'resetRequest') && (
              <TextInput
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            )}

            {(screen === 'signIn' || screen === 'signUp') && (
              <PasswordInput
                label="Password"
                autoComplete={screen === 'signIn' ? 'current-password' : 'new-password'}
                description={screen === 'signIn' ? undefined : 'At least 8 characters'}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            )}

            {screen === 'signUp' && (
              <TextInput
                label="Invite code"
                description="From your invite link or a household member. Not needed if your email was approved."
                value={inviteCode}
                onChange={(e) => setInviteCode(e.currentTarget.value)}
              />
            )}

            {screen === 'setPassword' && (
              <>
                <PasswordInput
                  label="New password"
                  autoComplete="new-password"
                  description="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Confirm password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                />
              </>
            )}

            {screen === 'signIn' && <Button type="submit" loading={signingInCmd.isPending}>Sign in</Button>}
            {screen === 'signUp' && <Button type="submit" loading={signingUpCmd.isPending}>Create account</Button>}
            {screen === 'resetRequest' && <Button type="submit" loading={reset.isPending}>Send reset link</Button>}
            {screen === 'setPassword' && <Button type="submit" loading={savePassword.isPending}>Save password</Button>}

            {screen === 'signIn' && (
              <Button variant="subtle" type="button" onClick={() => go('resetRequest')}>Forgot password?</Button>
            )}
            {(screen === 'signIn' || screen === 'signUp') && (
              <Button variant="subtle" type="button" onClick={() => go(screen === 'signIn' ? 'signUp' : 'signIn')}>
                {screen === 'signIn' ? 'No account? Create one' : 'Have an account? Sign in'}
              </Button>
            )}
            {screen !== 'signIn' && screen !== 'signUp' && (
              <Button variant="subtle" type="button" onClick={back}>Back to sign in</Button>
            )}

            <Text size="sm" ta="center">
              <Anchor href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy notice</Anchor>
            </Text>
          </Stack>
        </form>
      </div>
    </Center>
  )
}
