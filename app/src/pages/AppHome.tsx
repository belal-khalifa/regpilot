import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useCompanies } from '../lib/useCompanies'

function CreateCompanyForm({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !name.trim()) return
    setSubmitting(true)
    setError(null)
    const { error } = await supabase
      .from('companies')
      .insert({ name: name.trim(), created_by: user.id })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    onCreated()
  }

  return (
    <section className="bg-canvas px-6 py-24">
      <div className="mx-auto flex max-w-[440px] flex-col items-center gap-6 text-center">
        <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
          Set up your company
        </h1>
        <p className="font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink-muted-80">
          This is the name your team (or your client) will see. Consultants can add more
          companies later.
        </p>
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company name"
            className="w-full rounded-full border border-hairline bg-canvas px-5 py-3 text-center font-text text-[17px] text-ink outline-none focus:border-primary"
            required
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create company'}
          </button>
          {error && (
            <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-status-rejected">
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}

export default function AppHome() {
  const { session, user, loading: authLoading } = useAuth()
  const { companies, loading: companiesLoading, refresh } = useCompanies()

  if (!authLoading && !session) {
    return <Navigate to="/login" replace />
  }

  if (authLoading || companiesLoading) {
    return (
      <div>
        <GlobalNav />
        <section className="bg-canvas px-6 py-24 text-center">
          <p className="font-text text-[17px] text-ink-muted-80">Loading…</p>
        </section>
      </div>
    )
  }

  if (companies.length === 0) {
    return (
      <div>
        <GlobalNav />
        <CreateCompanyForm onCreated={refresh} />
      </div>
    )
  }

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-16">
        <div className="mx-auto flex max-w-[640px] flex-col gap-8">
          <div>
            <p className="font-display text-[14px] font-semibold tracking-[0.231px] text-primary">
              Signed in as {user?.email}
            </p>
            <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
              Your companies
            </h1>
          </div>
          <ul className="flex flex-col gap-3">
            {companies.map((company) => (
              <li
                key={company.id}
                className="rounded-lg border border-hairline bg-canvas px-6 py-5 font-text text-[17px] font-semibold text-ink"
              >
                {company.name}
              </li>
            ))}
          </ul>
          <p className="font-text text-[14px] leading-[1.43] tracking-[-0.224px] text-ink-muted-48">
            The product dashboard for each company is coming next.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="self-start rounded-sm bg-ink px-[15px] py-2 font-text text-[14px] leading-[1.29] tracking-[-0.224px] text-on-dark active:scale-95 transition-transform"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  )
}
