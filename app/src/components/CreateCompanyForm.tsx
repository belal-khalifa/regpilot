import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

export default function CreateCompanyForm({
  onCreated,
  title = 'Set up your company',
  description = "This is the name your team (or your client) will see. Consultants can add more companies later.",
}: {
  onCreated: () => void
  title?: string
  description?: string
}) {
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
    setName('')
    setSubmitting(false)
    onCreated()
  }

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
          {title}
        </h1>
        <p className="mt-2 font-text text-[17px] leading-[1.47] tracking-[-0.374px] text-ink-muted-80">
          {description}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex w-full max-w-[440px] flex-col gap-4">
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
  )
}
