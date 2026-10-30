// Supabase Edge Function: the public chatbot on the home page (REG-276). No sign-in.
// Answers only from RegPilot's services text (site_settings) and the reference library
// (reference_chunks, kept current by scripts/references/update_references.py). Daily limits and
// 30-day logs live in the database. Runs with the service role; nothing here is exposed to visitors
// except the answer. Deploy with "Verify JWT" switched off, since visitors are not signed in.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') as string
// Asked in this order; the second answers when the first is overloaded or rate limited.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIMENSIONS = 768
const MATCH_COUNT = 8
const HISTORY_MESSAGES = 6
const DEADLINE_MS = 40_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type ChatMessage = { role: 'user' | 'assistant'; text: string }
type Chunk = { id: number; label: string; content: string; title: string; version: string; url: string | null }

const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    answered_from_references: { type: 'BOOLEAN' },
    used_sources: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['answer', 'answered_from_references', 'used_sources'],
}

// Words too common in regulatory questions to help an exact-word search.
const COMMON_WORDS = new Set(
  'about above after again allowed approval before being below between could cosmetic cosmetics does dubai during every label labels labelling municipality other product products register registration regulation should their there these those under using which while would where what when guideline guidelines required requirements please'.split(' '),
)

// Ingredient names and CAS numbers in the question, for the exact-word half of the search.
function exactTerms(question: string): string {
  const cas = question.match(/\b\d{2,7}-\d{2}-\d\b/g) ?? []
  const words = (question.match(/[A-Za-z][A-Za-z0-9-]{4,}/g) ?? []).filter((w) => !COMMON_WORDS.has(w.toLowerCase()))
  return [...new Set([...cas, ...words])].slice(0, 8).join(' or ')
}

async function visitorId(req: Request): Promise<string> {
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const day = new Date().toISOString().slice(0, 10)
  // A keyed hash that changes daily: tells visitors apart for the limits without storing addresses.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ip}|${day}`))
  return Array.from(new Uint8Array(sig).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function embedQuestion(text: string, signal: AbortSignal): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: EMBED_DIMENSIONS,
      }),
      signal,
    },
  )
  if (!res.ok) throw new Error(`embedding ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { embedding?: { values?: number[] } }
  if (!body.embedding?.values) throw new Error('embedding: no values')
  return body.embedding.values
}

async function generate(prompt: string, history: ChatMessage[], signal: AbortSignal): Promise<Record<string, unknown>> {
  const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }))
  const errors: string[] = []
  for (const model of GEMINI_MODELS) {
    for (const thinkingOff of [true, false]) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt }] },
            contents,
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              responseSchema: ANSWER_SCHEMA,
              ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
          signal,
        },
      )
      if (res.ok) {
        const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }
        const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
        return JSON.parse(text)
      }
      errors.push(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`)
      // Some models reject the "no thinking" setting with a vague 400; ask again without it.
      if (!(res.status === 400 && thinkingOff)) break
    }
  }
  throw new Error(errors.join(' | '))
}

function buildPrompt(settings: Record<string, string>, chunks: Chunk[]): string {
  const sources = chunks
    .map((c, i) => `[S${i + 1}] ${c.title}, version ${c.version}. ${c.label}\n${c.content}`)
    .join('\n\n')
  return `You are RegPilot's assistant on its public website. Visitors are companies registering cosmetic, personal care, fragrance and similar products in Dubai (UAE).

Answer ONLY from the material below: the RegPilot services text, the contact details, and the numbered reference passages [S1], [S2], ... Never use outside knowledge, even if you know the answer.

Rules:
1. Reply in the language of the visitor's last message (Arabic or English). Quote rules faithfully; you may translate a passage, but keep numbers, percentages and names exact.
2. For every rule you state, name its source in the sentence, e.g. "Under EC 1223/2009, Annex III entry 75 ..." or "The DM Technical Guidelines for Cosmetic and Personal Care Products (GU116), section 7.1, require ...". List the passage ids you relied on in used_sources.
3. If the passages answer only part of the question, answer that part with its source, then say plainly which part RegPilot's references do not cover. Only if the passages answer none of it, say you cannot confirm it from RegPilot's references, suggest signing up or contacting the team, and set answered_from_references to false. Never guess or fill gaps from outside knowledge.
4. Answer general questions only. Do not judge whether a specific product is compliant or will be approved: explain the general rule and suggest signing up for a proper check by RegPilot's experts.
5. Never quote prices, fees or Dubai Municipality charges; give the pricing line and contact details instead.
6. Never say RegPilot submits registrations on a client's behalf, and never promise an outcome.
7. Politely decline questions unrelated to product registration or regulation in the UAE.
8. Do not ask for or accept documents, formulas or confidential data; say the public chat cannot take them.
9. Keep answers short: a few sentences or a short list. Plain text, no markdown headings.

RegPilot services (English):
${settings.services_en}

RegPilot services (Arabic):
${settings.services_ar}

Contact: email ${settings.contact_email}, WhatsApp ${settings.whatsapp_number}.
Pricing (English): ${settings.pricing_en}
Pricing (Arabic): ${settings.pricing_ar}

Reference passages:
${sources || '(none found for this question)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  let messages: ChatMessage[]
  try {
    const body = await req.json()
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string')
      .slice(-HISTORY_MESSAGES)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const question = messages.at(-1)?.role === 'user' ? messages.at(-1)!.text.trim() : ''
  if (!question) return json(400, { error: 'Please type a question.' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: settings, error: settingsError } = await db.from('site_settings').select('*').eq('id', 1).single()
  if (settingsError || !settings) {
    console.error('site_settings unreadable', settingsError?.message)
    return json(500, { error: 'The assistant is not available right now.' })
  }
  if (question.length > settings.chat_max_question_chars) {
    return json(400, { error: 'too_long', max: settings.chat_max_question_chars })
  }
  // Earlier messages are context only; keep them short too.
  messages = messages.map((m) => ({ ...m, text: m.text.slice(0, 2000) }))

  const { data: claim, error: claimError } = await db.rpc('claim_public_chat_question', { p_visitor: await visitorId(req) })
  if (claimError) {
    console.error('claim failed', claimError.message)
    return json(500, { error: 'The assistant is not available right now.' })
  }
  if (claim !== 'ok') return json(429, { limited: claim })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
  try {
    const embedding = await embedQuestion(question, controller.signal)
    const { data: chunks, error: matchError } = await db.rpc('match_reference_chunks', {
      query_embedding: `[${embedding.join(',')}]`,
      query_text: exactTerms(question),
      match_count: MATCH_COUNT,
    })
    if (matchError) throw new Error(`match: ${matchError.message}`)
    const found = (chunks ?? []) as Chunk[]

    const reply = await generate(buildPrompt(settings, found), messages, controller.signal)
    const answer = typeof reply.answer === 'string' ? reply.answer.trim() : ''
    if (!answer) throw new Error('empty answer')
    const used = new Set((Array.isArray(reply.used_sources) ? reply.used_sources : []).map(String))
    const sources = found
      .filter((_, i) => used.has(`S${i + 1}`))
      .map((c) => ({ label: c.label, title: c.title, version: c.version, url: c.url }))
    const fromReferences = reply.answered_from_references === true

    const { error: logError } = await db.from('public_chat_logs').insert({
      language: /[؀-ۿ]/.test(question) ? 'ar' : 'en',
      question,
      answer,
      sources,
      answered_from_references: fromReferences,
    })
    if (logError) console.error('log failed', logError.message)

    return json(200, { answer, sources, answered_from_references: fromReferences })
  } catch (err) {
    console.error('public-chat failed', err instanceof Error ? err.message : err)
    return json(502, { error: 'The assistant could not answer just now. Please try again in a minute.' })
  } finally {
    clearTimeout(timer)
  }
})
