import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import { GoogleIcon, MicrosoftIcon } from '../components/SsoIcons'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

type Mode = 'signin' | 'signup' | 'forgot'

function SsoButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void
  disabled: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-3 rounded-full border border-hairline bg-canvas px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink active:scale-95 transition-transform disabled:opacity-60"
    >
      {icon}
      {label}
    </button>
  )
}

export default function Login() {
  const { session, loading } = useAuth()
  const [ssoLoading, setSsoLoading] = useState<'google' | 'azure' | null>(null)
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!loading && session) {
    return <Navigate to="/app" replace />
  }

  async function handleSso(provider: 'google' | 'azure') {
    setError(null)
    setSsoLoading(provider)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/app`,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    })
    if (error) {
      setError(error.message)
      setSsoLoading(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      setSubmitting(false)
      return
    }

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/app` },
      })
      if (error) {
        setError(error.message)
      } else {
        setNotice('Check your inbox for a confirmation link to finish creating your account.')
      }
      setSubmitting(false)
      return
    }

    // mode === 'forgot'
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) {
      setError(error.message)
    } else {
      setNotice("If that email has an account, we've sent a password reset link.")
    }
    setSubmitting(false)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-24">
        <div className="mx-auto flex max-w-[440px] flex-col items-center gap-6 text-center">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
            {mode === 'signin' && 'Sign in to RegPilot'}
            {mode === 'signup' && 'Create your account'}
            {mode === 'forgot' && 'Reset your password'}
          </h1>
          {mode !== 'forgot' && (
            <p className="font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink-muted-80">
              Use your work Google or Microsoft account, or sign in with email.
            </p>
          )}

          {mode !== 'forgot' && (
            <div className="flex w-full flex-col gap-3">
              <SsoButton
                onClick={() => handleSso('google')}
                disabled={ssoLoading !== null}
                icon={<GoogleIcon />}
                label={ssoLoading === 'google' ? 'Redirecting…' : 'Continue with Google'}
              />
              <SsoButton
                onClick={() => handleSso('azure')}
                disabled={ssoLoading !== null}
                icon={<MicrosoftIcon />}
                label={ssoLoading === 'azure' ? 'Redirecting…' : 'Continue with Microsoft'}
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="flex w-full items-center gap-3">
              <div className="h-px flex-1 bg-hairline" />
              <span className="font-text text-[12px] text-ink-muted-48">or</span>
              <div className="h-px flex-1 bg-hairline" />
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              className="w-full rounded-full border border-hairline bg-canvas px-5 py-3 text-center font-text text-[17px] text-ink outline-none focus:border-primary"
              required
            />
            {mode !== 'forgot' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={6}
                className="w-full rounded-full border border-hairline bg-canvas px-5 py-3 text-center font-text text-[17px] text-ink outline-none focus:border-primary"
                required
              />
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
            >
              {submitting
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>

          {error && (
            <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-status-rejected">
              {error}
            </p>
          )}
          {notice && (
            <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-status-approved">
              {notice}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {mode === 'signin' && (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-primary"
                >
                  New here? Create an account
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-ink-muted-48"
                >
                  Forgot password?
                </button>
              </>
            )}
            {mode !== 'signin' && (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-primary"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
