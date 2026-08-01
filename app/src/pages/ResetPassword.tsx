import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    setDone(true)
    setSubmitting(false)
    setTimeout(() => navigate('/app'), 1500)
  }

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-24">
        <div className="mx-auto flex max-w-[440px] flex-col items-center gap-6 text-center">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
            Choose a new password
          </h1>
          {done ? (
            <p className="font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-status-approved">
              Password updated. Taking you to RegPilot…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                minLength={6}
                className="w-full rounded-full border border-hairline bg-canvas px-5 py-3 text-center font-text text-[17px] text-ink outline-none focus:border-primary"
                required
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Save password'}
              </button>
              {error && (
                <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-status-rejected">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
