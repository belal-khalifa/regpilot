import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.95v2.34C2.43 15.98 5.48 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.7c-.18-.54-.28-1.11-.28-1.7s.1-1.16.28-1.7V4.96H.95C.34 6.18 0 7.55 0 9s.34 2.82.95 4.04l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.43 2.02.95 4.96l3.01 2.34C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

export default function Login() {
  const { session, loading } = useAuth()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && session) {
    return <Navigate to="/app" replace />
  }

  async function handleGoogleSignIn() {
    setError(null)
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    })
    if (error) {
      setError(error.message)
      setSigningIn(false)
    }
  }

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-24">
        <div className="mx-auto flex max-w-[440px] flex-col items-center gap-6 text-center">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
            Sign in to RegPilot
          </h1>
          <p className="font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink-muted-80">
            Use your work Google account. If you're new, this creates your account automatically.
          </p>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-hairline bg-canvas px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink active:scale-95 transition-transform disabled:opacity-60"
          >
            <GoogleIcon />
            {signingIn ? 'Redirecting…' : 'Continue with Google'}
          </button>
          {error && (
            <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-status-rejected">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
