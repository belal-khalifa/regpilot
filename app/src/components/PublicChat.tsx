import { useEffect, useRef, useState } from 'react'
import { useSiteSettings, whatsappLink } from '../lib/useSiteSettings'

// The public chatbot on the home page (REG-276). Talks to the public-chat Supabase function, which
// answers only from RegPilot's services text and the regulation library. No sign-in, no files.

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-chat`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

type Lang = 'en' | 'ar'
type Source = { label: string; title: string; version: string; url: string | null }
type Message = { role: 'user' | 'assistant'; text: string; sources?: Source[]; notice?: boolean }

const TEXT = {
  en: {
    open: 'Ask RegPilot',
    title: 'Ask RegPilot',
    close: 'Close chat',
    other: 'العربية',
    welcome:
      'Hello! I can explain our services and answer general questions about registering cosmetic, personal care and fragrance products in Dubai, quoting the official rules. Please don’t share documents or confidential data here.',
    placeholder: 'Type your question…',
    send: 'Send',
    thinking: 'Checking the regulations…',
    sources: 'Sources',
    disclaimer: 'General information only, not regulatory advice. Our experts confirm answers for registered clients.',
    stored: 'Questions are stored for 30 days to improve answers.',
    tooLong: (max: number) => `Please keep your question under ${max} characters.`,
    limited: 'The assistant has answered all the questions it can today. Please contact us instead:',
    failed: 'Sorry, I could not answer just now. Please try again in a minute.',
    email: 'Email',
    whatsapp: 'WhatsApp',
  },
  ar: {
    open: 'اسأل RegPilot',
    title: 'اسأل RegPilot',
    close: 'إغلاق المحادثة',
    other: 'English',
    welcome:
      'مرحباً! يمكنني شرح خدماتنا والإجابة عن الأسئلة العامة حول تسجيل مستحضرات التجميل ومنتجات العناية الشخصية والعطور في دبي، مع ذكر المصدر الرسمي. يرجى عدم مشاركة المستندات أو البيانات السرية هنا.',
    placeholder: 'اكتب سؤالك…',
    send: 'إرسال',
    thinking: 'جارٍ مراجعة اللوائح…',
    sources: 'المصادر',
    disclaimer: 'معلومات عامة فقط وليست استشارة تنظيمية. يؤكد خبراؤنا الإجابات للعملاء المسجلين.',
    stored: 'تُحفظ الأسئلة لمدة 30 يوماً لتحسين الإجابات.',
    tooLong: (max: number) => `يرجى ألا يتجاوز سؤالك ${max} حرفاً.`,
    limited: 'وصل المساعد إلى الحد اليومي للأسئلة. يرجى التواصل معنا:',
    failed: 'عذراً، تعذّرت الإجابة الآن. يرجى المحاولة بعد دقيقة.',
    email: 'البريد الإلكتروني',
    whatsapp: 'واتساب',
  },
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('regpilot-chat-lang')
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    // storage may be blocked; fall back to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export default function PublicChat() {
  const settings = useSiteSettings()
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<Lang>(initialLang)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [contactShown, setContactShown] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const t = TEXT[lang]
  const maxChars = settings?.chat_max_question_chars ?? 500

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function switchLang() {
    const next = lang === 'en' ? 'ar' : 'en'
    setLang(next)
    try {
      localStorage.setItem('regpilot-chat-lang', next)
    } catch {
      // not essential
    }
  }

  async function send() {
    const question = draft.trim()
    if (!question || busy) return
    if (question.length > maxChars) {
      setMessages((m) => [...m, { role: 'assistant', text: t.tooLong(maxChars), notice: true }])
      return
    }
    const history = [...messages.filter((m) => !m.notice), { role: 'user' as const, text: question }]
    setMessages((m) => [...m, { role: 'user', text: question }])
    setDraft('')
    setBusy(true)
    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY },
        body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 429 && body.limited) {
        setContactShown(true)
        setMessages((m) => [...m, { role: 'assistant', text: t.limited, notice: true }])
      } else if (res.ok && typeof body.answer === 'string') {
        setMessages((m) => [...m, { role: 'assistant', text: body.answer, sources: body.sources ?? [] }])
      } else if (body.error === 'too_long') {
        setMessages((m) => [...m, { role: 'assistant', text: t.tooLong(body.max ?? maxChars), notice: true }])
      } else {
        setMessages((m) => [...m, { role: 'assistant', text: t.failed, notice: true }])
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: t.failed, notice: true }])
    } finally {
      setBusy(false)
    }
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

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      role="dialog"
      aria-label={t.title}
      className="fixed inset-x-4 bottom-4 z-40 flex max-h-[calc(100svh-88px)] flex-col overflow-hidden rounded-lg border border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-6 md:right-6 md:h-[600px] md:w-[400px]"
    >
      <div className="flex items-center justify-between gap-3 bg-surface-black px-4 py-3">
        <p className="font-display text-[15px] font-semibold text-on-dark">{t.title}</p>
        <div className="flex items-center gap-3">
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

      <div ref={listRef} className="flex min-h-[200px] flex-1 flex-col gap-3 overflow-y-auto bg-canvas-parchment px-4 py-4">
        <Bubble role="assistant" text={t.welcome} />
        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Bubble role={m.role} text={m.text} />
            {m.sources && m.sources.length > 0 && (
              <div className="max-w-[90%] font-text text-[12px] leading-[1.4] text-ink-muted-48">
                <span className="font-semibold">{t.sources}: </span>
                {m.sources.map((s, j) => (
                  <span key={j} dir="ltr">
                    {j > 0 && '; '}
                    {s.url ? (
                      <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                        {s.title}, {s.label}
                      </a>
                    ) : (
                      <>
                        {s.title}, {s.label}
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {contactShown && contact}
        {busy && <p className="font-text text-[13px] text-ink-muted-48">{t.thinking}</p>}
      </div>

      <div className="border-t border-hairline bg-canvas px-4 pb-3 pt-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
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
            disabled={busy || !draft.trim()}
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

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const mine = role === 'user'
  return (
    <div
      dir="auto"
      className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 font-text text-[15px] leading-[1.45] ${
        mine ? 'self-end bg-primary text-on-primary' : 'self-start bg-canvas text-ink'
      }`}
    >
      {text}
    </div>
  )
}
