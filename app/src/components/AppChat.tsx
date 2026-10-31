import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSiteSettings, whatsappLink } from '../lib/useSiteSettings'
import { expandDrop, filesFromDataTransfer } from '../lib/documentDrop'
import type { Product, ProductDocument } from '../lib/types'
import { initialLang, rememberLang, type Lang, type Source } from '../lib/chatLanguage'
import { Bubble, SourceList } from './PublicChat'

// The logged-in chat on the dashboard and product pages (REG-275). Takes a product's documents (the
// same upload as the Documents area, so nothing is uploaded twice), starts the reading when the client
// says so, explains what was found, and answers questions from the product and the regulation library
// through the product-chat Supabase function. It never fills: Review and fill takes the client to the
// review form and the Fill section on the page.

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/product-chat`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

type Checks = { used: number; limit: number; renews: string }
type Message = { role: 'user' | 'assistant'; text: string; sources?: Source[]; notice?: boolean }

const TEXT = {
  en: {
    open: 'Ask RegPilot',
    title: 'Ask RegPilot',
    close: 'Close chat',
    other: 'العربية',
    welcomeProduct:
      'Drop this product’s documents here (files, a zip or a folder) and I’ll read them and explain what I find. You can also ask me about the product or the Dubai Municipality rules.',
    welcomeDashboard:
      'Drop one product’s documents here to start a new product, or ask me a general question about registering products in Dubai.',
    placeholder: 'Type your question…',
    send: 'Send',
    attach: 'Add documents',
    dropHere: 'Drop the documents to add them',
    thinking: 'Checking…',
    opening: 'Opening files…',
    uploading: (done: number, total: number) => `Uploading ${done} of ${total}…`,
    uploaded: (n: number) =>
      `I have ${n === 1 ? '1 new document' : `${n} new documents`}. Add more for this same product, or shall I read them now?`,
    skipped: (list: string) => `Left out: ${list}.`,
    nothingFound: 'I found no documents in what you dropped. PDFs and images (or a zip of them) work.',
    readNow: 'Yes, read them',
    reading: 'Reading the documents. This takes about a minute; please keep this page open.',
    readFailed: 'The reading did not finish. The message on the page says why; you can try again.',
    summarising: 'Writing a summary…',
    summaryFailed:
      'The documents were read, but I could not write the summary just now. The results are on the page; you can ask me about them.',
    review: 'Review and fill',
    starting: 'Starting a new product…',
    sources: 'Sources',
    disclaimer:
      'Preliminary information, not regulatory advice. You check the data before filling and submit on Montaji yourself.',
    stored: 'This conversation is kept for 30 days.',
    tooLong: (max: number) => `Please keep your question under ${max} characters.`,
    limited: 'You have reached today’s limit of questions. It resets at midnight UAE time, or contact us:',
    runCheck: 'Run instant check',
    checking: 'Checking the product against the rules. This takes up to a minute…',
    checksLeft: (left: number, limit: number) => `Free: ${left} of ${limit} instant checks left this month for your company.`,
    checkLimited: (limit: number, renews: string) =>
      `Your company has used this month’s ${limit} free instant checks. They renew on ${renews}. For more checks, or a check confirmed by our experts, contact us:`,
    checkFailed: 'The instant check did not finish, so it was not counted. Please try again in a minute.',
    failed: 'Sorry, I could not answer just now. Please try again in a minute.',
    email: 'Email',
    whatsapp: 'WhatsApp',
  },
  ar: {
    open: 'اسأل RegPilot',
    title: 'اسأل RegPilot',
    close: 'إغلاق المحادثة',
    other: 'English',
    welcomeProduct:
      'ضع مستندات هذا المنتج هنا (ملفات أو ملف مضغوط أو مجلد) وسأقرؤها وأشرح ما أجده. يمكنك أيضاً سؤالي عن المنتج أو عن متطلبات بلدية دبي.',
    welcomeDashboard:
      'ضع مستندات منتج واحد هنا لبدء منتج جديد، أو اسألني سؤالاً عاماً عن تسجيل المنتجات في دبي.',
    placeholder: 'اكتب سؤالك…',
    send: 'إرسال',
    attach: 'إضافة مستندات',
    dropHere: 'أفلت المستندات لإضافتها',
    thinking: 'جارٍ التحقق…',
    opening: 'جارٍ فتح الملفات…',
    uploading: (done: number, total: number) => `جارٍ رفع ${done} من ${total}…`,
    uploaded: (n: number) =>
      `لديّ ${n === 1 ? 'مستند جديد واحد' : `${n} مستندات جديدة`}. أضف المزيد لنفس المنتج، أو هل أقرؤها الآن؟`,
    skipped: (list: string) => `لم تتم إضافة: ${list}.`,
    nothingFound: 'لم أجد مستندات فيما أضفته. تُقبل ملفات PDF والصور (أو ملف مضغوط يحتويها).',
    readNow: 'نعم، اقرأها',
    reading: 'جارٍ قراءة المستندات. يستغرق ذلك نحو دقيقة؛ يرجى إبقاء هذه الصفحة مفتوحة.',
    readFailed: 'لم تكتمل القراءة. توضح الرسالة في الصفحة السبب؛ يمكنك المحاولة مرة أخرى.',
    summarising: 'جارٍ كتابة الملخص…',
    summaryFailed: 'تمت قراءة المستندات، لكن تعذّرت كتابة الملخص الآن. النتائج في الصفحة ويمكنك سؤالي عنها.',
    review: 'المراجعة والتعبئة',
    starting: 'جارٍ بدء منتج جديد…',
    sources: 'المصادر',
    disclaimer: 'معلومات أولية وليست استشارة تنظيمية. تراجع البيانات قبل التعبئة وتقدّم الطلب على منتجي بنفسك.',
    stored: 'تُحفظ هذه المحادثة لمدة 30 يوماً.',
    tooLong: (max: number) => `يرجى ألا يتجاوز سؤالك ${max} حرفاً.`,
    limited: 'وصلت إلى الحد اليومي للأسئلة. يتجدد عند منتصف الليل بتوقيت الإمارات، أو تواصل معنا:',
    runCheck: 'إجراء فحص فوري',
    checking: 'جارٍ فحص المنتج مقابل المتطلبات. يستغرق ذلك حتى دقيقة…',
    checksLeft: (left: number, limit: number) => `مجاناً: تبقّى ${left} من ${limit} فحوصات فورية هذا الشهر لشركتك.`,
    checkLimited: (limit: number, renews: string) =>
      `استخدمت شركتك الفحوصات الفورية المجانية لهذا الشهر (${limit}). تتجدد في ${renews}. لمزيد من الفحوصات، أو لفحص يؤكده خبراؤنا، تواصل معنا:`,
    checkFailed: 'لم يكتمل الفحص الفوري، لذلك لم يُحتسب. يرجى المحاولة بعد دقيقة.',
    failed: 'عذراً، تعذّرت الإجابة الآن. يرجى المحاولة بعد دقيقة.',
    email: 'البريد الإلكتروني',
    whatsapp: 'واتساب',
  },
}

// "1 December" / "1 ديسمبر" from 2026-12-01.
function formatDay(isoDay: string, lang: Lang): string {
  if (!isoDay) return ''
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Dubai',
  })
}

type UploadResult = { error: string | null; uploaded: number }

export default function AppChat({
  companyId,
  product,
  documents = [],
  facts = [],
  reading = false,
  incomingFiles,
  onFiles,
  onRead,
  onReviewAndFill,
}: {
  companyId: string
  // Absent on the dashboard.
  product?: Product
  documents?: ProductDocument[]
  // The product page's own checks (missing documents, warnings), passed to the summary.
  facts?: string[]
  reading?: boolean
  // Files dropped on the dashboard chat, handed over when the new product's page opens.
  incomingFiles?: File[]
  onFiles: (files: File[], onProgress: (done: number) => void) => Promise<UploadResult>
  onRead?: () => Promise<boolean>
  onReviewAndFill?: () => void
}) {
  const settings = useSiteSettings()
  const [open, setOpen] = useState(!!incomingFiles?.length)
  const [lang, setLang] = useState<Lang>(initialLang)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [offerRead, setOfferRead] = useState(false)
  const [contactShown, setContactShown] = useState(false)
  const [dragging, setDragging] = useState(false)
  // This month's free instant checks for the company (REG-269); null until known.
  const [checks, setChecks] = useState<Checks | null>(null)
  // The product's updated_at when a reading started from the chat; the summary waits for it to change.
  const [awaitingSummaryFrom, setAwaitingSummaryFrom] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const handledIncoming = useRef(false)
  const t = TEXT[lang]
  const maxChars = settings?.chat_max_question_chars ?? 500
  const productId = product?.id ?? null

  // The saved conversation for this product (or the company's dashboard chat).
  useEffect(() => {
    let active = true
    let query = supabase
      .from('product_chat_messages')
      .select('role, text, sources')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(200)
    query = productId ? query.eq('product_id', productId) : query.is('product_id', null)
    query.then(({ data }) => {
      if (active && data) setMessages(data as Message[])
    })
    return () => {
      active = false
    }
  }, [companyId, productId])

  // How many free instant checks are left, shown under the button. Product pages only.
  useEffect(() => {
    if (!productId || !open) return
    let active = true
    call({ mode: 'check_status' })
      .then(({ status, body }) => {
        if (active && status === 200 && body.checks) setChecks(body.checks as Checks)
      })
      .catch(() => {})
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, productId, open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, offerRead, open])

  const say = (text: string, extra?: Partial<Message>) =>
    setMessages((m) => [...m, { role: 'assistant', text, notice: true, ...extra }])

  async function call(body: Record<string, unknown>) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { status: 401, body: {} as Record<string, unknown> }
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ companyId, productId, lang, ...body }),
    })
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  }

  function handleReply(status: number, body: Record<string, unknown>, failedText: string) {
    if (body.checks) setChecks(body.checks as Checks)
    if (status === 429 && body.limited === 'check_limit') {
      const c = body.checks as Checks | undefined
      setContactShown(true)
      say(t.checkLimited(c?.limit ?? checks?.limit ?? 0, formatDay(c?.renews ?? checks?.renews ?? '', lang)))
    } else if (status === 429 && body.limited) {
      setContactShown(true)
      say(t.limited)
    } else if (status === 200 && typeof body.answer === 'string') {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: body.answer as string, sources: (body.sources as Source[]) ?? [] },
      ])
    } else if (body.error === 'too_long') {
      say(t.tooLong(Number(body.max) || maxChars))
    } else {
      say(failedText)
    }
  }

  async function handleFiles(input: File[]) {
    if (input.length === 0 || busy || reading) return
    setOfferRead(false)
    setBusy(t.opening)
    const { files, skipped } = await expandDrop(
      input,
      documents.map((d) => d.file_name),
    )
    if (skipped.length) say(t.skipped(skipped.map((s) => `${s.name} (${s.reason})`).join(', ')))
    if (files.length === 0) {
      if (!skipped.length) say(t.nothingFound)
      setBusy(null)
      return
    }
    setBusy(product ? t.uploading(0, files.length) : t.starting)
    const { error, uploaded } = await onFiles(files, (done) => setBusy(t.uploading(done, files.length)))
    setBusy(null)
    if (error) say(error)
    // On the dashboard the new product's page takes over from here.
    if (product && uploaded > 0) {
      say(t.uploaded(uploaded))
      setOfferRead(!!onRead)
    }
  }

  // Files dropped on the dashboard arrive here once their product's page has opened.
  useEffect(() => {
    if (!incomingFiles?.length || !product || handledIncoming.current) return
    handledIncoming.current = true
    handleFiles(incomingFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles, product])

  async function read() {
    if (!onRead || !product) return
    setOfferRead(false)
    say(t.reading)
    const startedFrom = product.updated_at
    const ok = await onRead()
    if (ok) setAwaitingSummaryFrom(startedFrom)
    else say(t.readFailed)
  }

  // Once the page has the fresh reading (and so fresh checks), ask for the summary.
  useEffect(() => {
    if (!awaitingSummaryFrom || !product || reading) return
    if (product.updated_at === awaitingSummaryFrom || product.status === 'draft') return
    setAwaitingSummaryFrom(null)
    ;(async () => {
      setBusy(t.summarising)
      try {
        const { status, body } = await call({ mode: 'summary', facts, messages: [] })
        handleReply(status, body, t.summaryFailed)
      } catch {
        say(t.summaryFailed)
      } finally {
        setBusy(null)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingSummaryFrom, product?.updated_at, product?.status, reading])

  async function send() {
    const question = draft.trim()
    if (!question || busy) return
    if (question.length > maxChars) {
      say(t.tooLong(maxChars))
      return
    }
    const history = [...messages.filter((m) => !m.notice), { role: 'user' as const, text: question }]
    setMessages((m) => [...m, { role: 'user', text: question }])
    setDraft('')
    setBusy(t.thinking)
    try {
      const { status, body } = await call({
        facts,
        messages: history.slice(-6).map(({ role, text }) => ({ role, text })),
      })
      handleReply(status, body, t.failed)
    } catch {
      say(t.failed)
    } finally {
      setBusy(null)
    }
  }

  async function runCheck() {
    if (busy || reading) return
    setMessages((m) => [...m, { role: 'user', text: t.runCheck }])
    setBusy(t.checking)
    try {
      const { status, body } = await call({ mode: 'check', facts, messages: [] })
      handleReply(status, body, t.checkFailed)
    } catch {
      say(t.checkFailed)
    } finally {
      setBusy(null)
    }
  }

  function switchLang() {
    const next = lang === 'en' ? 'ar' : 'en'
    setLang(next)
    rememberLang(next)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-text text-[15px] text-on-primary shadow-[0_4px_16px_rgba(0,0,0,0.18)] active:scale-95 transition-transform md:bottom-6 md:right-6"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {t.open}
      </button>
    )
  }

  const contact = settings && (
    <p className="font-text text-[13px] leading-[1.4] text-ink-muted-80">
      {t.email}:{' '}
      <a className="text-primary underline" href={`mailto:${settings.contact_email}`}>
        {settings.contact_email}
      </a>
      {' · '}
      {t.whatsapp}:{' '}
      <a className="text-primary underline" href={whatsappLink(settings.whatsapp_number)} target="_blank" rel="noreferrer">
        <span dir="ltr">{settings.whatsapp_number}</span>
      </a>
    </p>
  )
  const blocked = !!busy || reading
  const canReview = !!onReviewAndFill && !!product && product.status !== 'draft' && !reading
  const canCheck = !!product && product.status !== 'draft' && !reading
  const checksLeft = checks ? Math.max(checks.limit - checks.used, 0) : null

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      role="dialog"
      aria-label={t.title}
      onDragOver={(e) => {
        e.preventDefault()
        if (!blocked) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        setDragging(false)
        if (!blocked) handleFiles(await filesFromDataTransfer(e.dataTransfer))
      }}
      className={`fixed inset-x-4 bottom-4 z-40 flex max-h-[calc(100svh-88px)] flex-col overflow-hidden rounded-lg border bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-6 md:right-6 md:h-[600px] md:w-[400px] ${
        dragging ? 'border-primary' : 'border-hairline'
      }`}
    >
      <div className="flex items-center justify-between gap-3 bg-surface-black px-4 py-3">
        <p className="min-w-0 truncate font-display text-[15px] font-semibold text-on-dark">
          {t.title}
          {product && <span className="font-text font-normal text-on-dark/70"> · <bdi>{product.name}</bdi></span>}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={switchLang} className="font-text text-[13px] text-on-dark underline">
            {t.other}
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="text-on-dark">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={listRef} className="relative flex min-h-[200px] flex-1 flex-col gap-3 overflow-y-auto bg-canvas-parchment px-4 py-4">
        <Bubble role="assistant" text={product ? t.welcomeProduct : t.welcomeDashboard} />
        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Bubble role={m.role} text={m.text} />
            {m.sources && m.sources.length > 0 && <SourceList label={t.sources} sources={m.sources} />}
          </div>
        ))}
        {offerRead && !blocked && (
          <button
            type="button"
            onClick={read}
            className="self-start rounded-full bg-primary px-4 py-2 font-text text-[14px] text-on-primary active:scale-95 transition-transform"
          >
            {t.readNow}
          </button>
        )}
        {contactShown && contact}
        {busy && <p className="font-text text-[13px] text-ink-muted-48">{busy}</p>}
        {dragging && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-canvas/90 font-text text-[15px] font-semibold text-primary">
            {t.dropHere}
          </div>
        )}
      </div>

      <div className="border-t border-hairline bg-canvas px-4 pb-3 pt-3">
        {(canCheck || canReview) && (
          <div className="mb-2 flex gap-2">
            {canCheck && (
              <button
                type="button"
                onClick={runCheck}
                disabled={blocked || checksLeft === 0}
                className="flex-1 rounded-full bg-primary px-4 py-2 font-text text-[14px] text-on-primary disabled:opacity-40 active:scale-95 transition-transform"
              >
                {t.runCheck}
              </button>
            )}
            {canReview && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onReviewAndFill()
                }}
                className="flex-1 rounded-full border border-primary px-4 py-2 font-text text-[14px] text-primary active:scale-95 transition-transform"
              >
                {t.review}
              </button>
            )}
          </div>
        )}
        {canCheck && checks && checksLeft !== null && (
          <p className="mb-2 font-text text-[12px] leading-[1.35] text-ink-muted-48">
            {checksLeft > 0 ? t.checksLeft(checksLeft, checks.limit) : t.checkLimited(checks.limit, formatDay(checks.renews, lang))}
          </p>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => filesRef.current?.click()}
            disabled={blocked}
            aria-label={t.attach}
            title={t.attach}
            className="shrink-0 rounded-full border border-hairline p-2 text-primary disabled:opacity-40"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-2.8-2.8l7.9-7.9" />
            </svg>
          </button>
          <input
            ref={filesRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.zip,application/pdf,image/*,application/zip"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              handleFiles(files)
            }}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            maxLength={maxChars + 100}
            placeholder={t.placeholder}
            className="min-w-0 flex-1 resize-none rounded-md border border-hairline px-3 py-2 font-text text-[15px] leading-[1.4] text-ink outline-none focus:border-primary-focus"
          />
          <button
            type="button"
            onClick={send}
            disabled={!!busy || !draft.trim()}
            className="rounded-full bg-primary px-4 py-2 font-text text-[15px] text-on-primary disabled:opacity-40 active:scale-95 transition-transform"
          >
            {t.send}
          </button>
        </div>
        {draft.length > maxChars * 0.8 && (
          <p className={`mt-1 font-text text-[12px] ${draft.length > maxChars ? 'text-status-rejected' : 'text-ink-muted-48'}`}>
            {draft.length}/{maxChars}
          </p>
        )}
        <p className="mt-2 font-text text-[11px] leading-[1.35] text-ink-muted-48">
          {t.disclaimer} {t.stored}
        </p>
        {!contactShown && <div className="mt-1">{contact}</div>}
      </div>
    </div>
  )
}
