import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  FindingArea,
  FindingStatus,
  RegulatoryCheck,
  RegulatoryFinding,
} from '../lib/types'

// The regulatory check on the product page (REG-255). The client starts a check; RegPilot checks
// claims, label, ingredients and documents against the references and shows the instant brief: the
// clear Pass and Issue points, with judgement calls listed as under expert review. Once an expert
// confirms (stage B), the same panel shows the confirmed result and marks what the expert changed.

const CHECK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/regulatory-check`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
const POLL_MS = 4000

// REG-268 draft wording; Belal finalises it.
const DISCLAIMER =
  'This is an automated preliminary review. Our regulatory experts are confirming every point, and you will receive the confirmed result within 1 to 2 working days. Please don’t act on it before then.'

const AREAS: Array<{ area: FindingArea; title: string }> = [
  { area: 'claims', title: 'Claims' },
  { area: 'label', title: 'Label' },
  { area: 'ingredients', title: 'Ingredients' },
  { area: 'certificates', title: 'Documents and certificates' },
]

const STATUS_STYLE: Record<FindingStatus, { text: string; className: string }> = {
  pass: { text: 'Pass', className: 'border-status-approved text-status-approved' },
  issue: { text: 'Issue', className: 'border-status-rejected text-status-rejected' },
  needs_expert: { text: 'Under expert review', className: 'border-hairline text-ink-muted-48' },
}

function StatusChip({ status }: { status: FindingStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-text text-[12px] leading-[1.3] ${s.className}`}>
      {s.text}
    </span>
  )
}

function FindingRow({ finding, confirmed }: { finding: RegulatoryFinding; confirmed: boolean }) {
  const status = confirmed ? (finding.expert_status ?? finding.status) : finding.status
  const changed = confirmed && finding.expert_status !== null && finding.expert_status !== finding.status
  // In the instant brief, judgement calls show only their name until an expert has looked at them.
  const hidden = !confirmed && status === 'needs_expert'
  return (
    <li className="flex flex-col gap-1 border-t border-divider-soft py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1 font-text text-[15px] font-semibold leading-[1.35] text-ink [overflow-wrap:anywhere]">
          {finding.item}
        </span>
        <StatusChip status={status} />
      </div>
      {changed && <p className="font-text text-[12px] text-status-submitted">Changed by our expert</p>}
      {!hidden && finding.changes_product_type && status !== 'pass' && (
        <p className="font-text text-[13px] font-semibold text-status-rejected">
          This claim may mean the product is not a cosmetic.
        </p>
      )}
      {!hidden && finding.explanation && (
        <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">{finding.explanation}</p>
      )}
      {confirmed && finding.expert_note && (
        <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
          <span className="font-semibold">Expert note: </span>
          {finding.expert_note}
        </p>
      )}
      {!hidden && finding.evidence && (
        <p className="font-text text-[13px] leading-[1.47] text-ink-muted-48 [overflow-wrap:anywhere]">
          Seen in your documents: {finding.evidence}
        </p>
      )}
      {!hidden && finding.clause && (
        <details className="font-text text-[13px] leading-[1.47] text-ink-muted-48">
          <summary className="cursor-pointer text-primary">
            Rule: {finding.source_label || finding.source_title}
          </summary>
          <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{finding.clause}</p>
          {finding.source_title && (
            <p className="mt-1">
              {finding.source_title}
              {finding.source_version && `, version ${finding.source_version}`}
            </p>
          )}
        </details>
      )}
    </li>
  )
}

export default function RegulatoryCheckPanel({ productId, canRun }: { productId: string; canRun: boolean }) {
  const [check, setCheck] = useState<RegulatoryCheck | null>(null)
  const [findings, setFindings] = useState<RegulatoryFinding[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: checks, error: checkError } = await supabase
      .from('regulatory_checks')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (checkError) {
      // Before the stage A database changes are made, the table does not exist: show nothing odd.
      setLoading(false)
      return
    }
    const latest = (checks?.[0] as RegulatoryCheck | undefined) ?? null
    setCheck(latest)
    if (latest && (latest.status === 'under_review' || latest.status === 'confirmed')) {
      const { data: rows } = await supabase
        .from('regulatory_findings')
        .select('*')
        .eq('check_id', latest.id)
        .order('position')
      setFindings((rows as RegulatoryFinding[] | null) ?? [])
    } else {
      setFindings([])
    }
    setLoading(false)
  }, [productId])

  useEffect(() => {
    load()
  }, [load])

  // While the check runs on the server, look again every few seconds.
  useEffect(() => {
    if (check?.status !== 'running') return
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [check?.status, load])

  async function start() {
    if (check && check.status !== 'failed') {
      const again = window.confirm(
        'Run a new regulatory check? Use this after changing the documents or the reviewed data. The new check replaces the one shown here.',
      )
      if (!again) return
    }
    setStarting(true)
    setError(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setError('Your session expired. Please sign in again.')
      setStarting(false)
      return
    }
    try {
      const res = await fetch(CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY },
        body: JSON.stringify({ productId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(body.error ?? `The check could not start (HTTP ${res.status}).`)
      await load()
    } catch {
      setError('The connection dropped. Please try again.')
    }
    setStarting(false)
  }

  if (loading) return null

  const running = check?.status === 'running'
  const confirmed = check?.status === 'confirmed'
  const shown = check && (check.status === 'under_review' || confirmed)
  const effective = (f: RegulatoryFinding) => (confirmed ? (f.expert_status ?? f.status) : f.status)
  const count = (s: FindingStatus) => findings.filter((f) => effective(f) === s).length

  return (
    <div id="regulatory-check" className="flex scroll-mt-6 flex-col gap-3 rounded-lg border border-hairline bg-canvas px-6 py-6">
      <h2 className="font-display text-[18px] font-semibold text-ink">Regulatory check</h2>

      {!check && (
        <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
          Check this product’s claims, label, ingredients and certificates against the Dubai
          Municipality guidelines and the EU Cosmetics Regulation. You get an instant preliminary
          brief, and our regulatory experts confirm the result within 1 to 2 working days.
        </p>
      )}

      {running && (
        <p role="status" className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
          Checking… this usually takes one to two minutes. You can leave this page; the result will be
          here when you come back.
        </p>
      )}

      {check?.status === 'failed' && (
        <p role="alert" className="font-text text-[14px] leading-[1.47] text-status-rejected">
          {check.error ?? 'The check could not finish.'}
        </p>
      )}

      {shown && (
        <>
          <p className={`font-text text-[14px] leading-[1.47] ${confirmed ? 'text-status-approved' : 'text-ink-muted-80'}`}>
            {confirmed
              ? `Confirmed by our regulatory experts${check.confirmed_at ? ` on ${new Date(check.confirmed_at).toLocaleDateString()}` : ''}.`
              : DISCLAIMER}
          </p>
          <p className="font-text text-[15px] text-ink">
            <span className="font-semibold text-status-rejected">{count('issue')} issue{count('issue') === 1 ? '' : 's'}</span>
            {' · '}
            <span className="font-semibold text-status-approved">{count('pass')} passed</span>
            {count('needs_expert') > 0 && (
              <>
                {' · '}
                <span className="text-ink-muted-48">{count('needs_expert')} {confirmed ? 'for you to decide' : 'under expert review'}</span>
              </>
            )}
          </p>
          {AREAS.map(({ area, title }) => {
            const rows = findings.filter((f) => f.area === area)
            if (!rows.length) return null
            // Issues first, then judgement calls, then passes.
            const order: Record<FindingStatus, number> = { issue: 0, needs_expert: 1, pass: 2 }
            rows.sort((a, b) => order[effective(a)] - order[effective(b)] || a.position - b.position)
            return (
              <section key={area} className="flex flex-col">
                <h3 className="font-text text-[15px] font-semibold uppercase tracking-[0.4px] text-ink-muted-48">{title}</h3>
                <ul className="flex flex-col">
                  {rows.map((f) => (
                    <FindingRow key={f.id} finding={f} confirmed={confirmed} />
                  ))}
                </ul>
              </section>
            )
          })}
          {check.sources.length > 0 && (
            <p className="font-text text-[12px] leading-[1.47] text-ink-muted-48">
              Checked on {new Date(check.created_at).toLocaleDateString()} against{' '}
              {check.sources.map((s) => `${s.title} (version ${s.version})`).join(' and ')}.
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={start}
        disabled={!canRun || running || starting}
        className="self-start rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary transition-transform active:scale-95 disabled:opacity-60"
      >
        {starting || running ? 'Checking…' : check ? 'Run a new check' : 'Run regulatory check'}
      </button>
      {!canRun && (
        <p className="font-text text-[13px] text-ink-muted-48">Read the documents with AI first; the check works on what the reading found.</p>
      )}
      {error && (
        <p role="alert" className="font-text text-[14px] leading-[1.47] text-status-rejected">
          {error}
        </p>
      )}
    </div>
  )
}
