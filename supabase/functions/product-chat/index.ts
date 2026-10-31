// Supabase Edge Function: the logged-in chat on the dashboard and product pages (REG-275).
// Answers from this client's own product (what the reading found, its documents) and from the same
// reference library as the public chatbot (REG-276). It never fills or submits anything: for that it
// points to the Review and fill button on the product page. Signed-in users only (deploy with
// "Verify JWT" on). Reads and writes as the user, so a client only ever reaches their own company's
// products; the service role is used for the daily limit and the instant-check allowance alone.
// Modes: a question (default); "summary" after a reading; "check", the instant regulatory check of a
// product, free within a monthly allowance per company (REG-269); "check_status", how many of this
// month's checks are used (no AI call).
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
type Lang = 'en' | 'ar'
type Mode = 'question' | 'summary' | 'check'

const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    used_sources: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['answer', 'used_sources'],
}

// Words too common in regulatory questions to help an exact-word search.
const COMMON_WORDS = new Set(
  'about above after again allowed approval before being below between could cosmetic cosmetics does dubai during every label labels labelling municipality other product products register registration regulation should their there these those under using which while would where what when guideline guidelines required requirements please'.split(' '),
)

// The product's ingredient names and claims, so a question like "does it meet the rules?" also finds
// the passages about those ingredients and claims.
function productTerms(p: ProductContext | null): { words: string; meaning: string } {
  const data = (p?.extracted_data ?? {}) as { ingredients?: Array<{ inci_name?: string }>; label_claims?: string[]; product_type?: string }
  const names = (data.ingredients ?? [])
    .map((i) => (i.inci_name ?? '').replace(/["()]/g, ' ').trim())
    .filter((n) => /[A-Za-z]{4,}/.test(n) && !/^aqua\b|^water\b|^parfum\b|^fragrance\b/i.test(n))
    .slice(0, 15)
  const claims = (data.label_claims ?? []).slice(0, 8).join('; ')
  return {
    words: names.map((n) => `"${n}"`).join(' or '),
    meaning: p ? ` (Product: ${data.product_type ?? p.name}${claims ? `; label claims: ${claims}` : ''})` : '',
  }
}

// Ingredient names and CAS numbers in the question, for the exact-word half of the search.
function exactTerms(question: string): string {
  const cas = question.match(/\b\d{2,7}-\d{2}-\d\b/g) ?? []
  const words = (question.match(/[A-Za-z][A-Za-z0-9-]{4,}/g) ?? []).filter((w) => !COMMON_WORDS.has(w.toLowerCase()))
  return [...new Set([...cas, ...words])].slice(0, 8).join(' or ')
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

type ProductContext = {
  name: string
  status: string
  extracted_data: Record<string, unknown> | null
  documents: Array<{ file_name: string; doc_type: string }>
}

// What the chat knows about the client's product. The reading's own notes and inventory are kept;
// long lists are trimmed so the prompt stays small.
function describeProduct(p: ProductContext, facts: string[]): string {
  const data = { ...(p.extracted_data ?? {}) } as Record<string, unknown>
  if (Array.isArray(data.ingredients) && data.ingredients.length > 80) data.ingredients = data.ingredients.slice(0, 80)
  const read = p.status !== 'draft'
  return `Product page: "${p.name}" (status: ${p.status}).
Uploaded documents: ${p.documents.length ? p.documents.map((d) => d.file_name).join('; ') : 'none yet'}.
${read ? `What RegPilot's reading of the documents found (JSON):\n${JSON.stringify(data)}` : 'The documents have not been read yet. The client starts the reading from the chat or with the "Read documents with AI" button.'}
${facts.length ? `Checks shown on the product page:\n${facts.map((f) => `- ${f}`).join('\n')}` : ''}`
}

// The month of the allowance, UAE time, as the first day (matches claim_instant_check).
function allowanceMonth(): { month: string; renews: string } {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .split('-')
    .map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { month: `${y}-${pad(m)}-01`, renews: next }
}

function buildPrompt(settings: Record<string, string>, chunks: Chunk[], product: string | null, mode: Mode, lang: Lang): string {
  const sources = chunks
    .map((c, i) => `[S${i + 1}] ${c.title}, version ${c.version}. ${c.label}\n${c.content}`)
    .join('\n\n')
  const langName = lang === 'ar' ? 'Arabic' : 'English'
  const task = mode === 'check'
    ? `TASK: Run RegPilot's instant regulatory check of this product and write it in ${langName}. Go through what the reading found (ingredients and their percentages, label claims, label details such as dates, batch and period after opening, the certificate) against the reference passages, and list for each point either "looks fine" or "possible issue", with the rule and its source. Claims are the most important point. Say plainly when the passages don't cover a point, rather than skipping it. Start with one line giving the overall picture (for example "2 possible issues, the rest looks fine"). Call the result an instant preliminary check: never say the product is approved, will be approved or is guaranteed to pass, and end with one line that RegPilot's experts can confirm it in a full regulatory check (contact us for this).`
    : mode === 'summary'
    ? `TASK: The client has just had their documents read. Write a short summary in ${lang === 'ar' ? 'Arabic' : 'English'} for a busy regulatory manager, written like a helpful colleague: what the product is (name, brand, type, Montaji category), the useful details found (country of origin, manufacturer, shelf life, number of ingredients and variants), which documents were recognised, and what is missing or needs a closer look (use the checks listed; if there are none, say everything needed was found). Finish with the next step in one sentence: press Review and fill to check the data and fill Montaji, or press Run instant check below for a free check against the rules. A short intro line plus a short list is ideal. Do not repeat disclaimers (the chat already shows one) and do not use the reference passages unless a check needs a rule explained.`
    : `TASK: Answer the client's last message.`
  return `You are RegPilot's assistant inside the RegPilot app. The client is signed in and is a company registering cosmetic, personal care, fragrance and similar products with Dubai Municipality on Montaji.

${task}

Use ONLY the material below: this client's product, the RegPilot services text, the contact details, and the numbered reference passages [S1], [S2], ... Never use outside knowledge, even if you know the answer.

Rules:
1. Reply in the language of the client's last message (Arabic or English). Quote rules faithfully; you may translate a passage, but keep numbers, percentages and names exact.
2. For every rule you state, name its source in the sentence, e.g. "The DM Technical Guidelines for Cosmetic and Personal Care Products (GU116), section 7.1, require ...". List the passage ids you relied on in used_sources.
3. Talk freely and helpfully about this client's product: explain what the reading found, which documents are missing, and what a warning means, in plain words. The chat already shows a disclaimer under every answer, so do not add "preliminary" or "please check" caveats to your answers.
4. Answer questions about a single point fully (one ingredient, one claim, one label detail), with the rule and its source. When the client asks for a check of the whole product (does it meet the rules, is it compliant, check everything), do not run it here: say in one sentence that the Run instant check button in this chat on the product page does that for free (a set number of checks per company each month), and answer any single point they named. Never say the product is approved, will be approved or is guaranteed to pass.
5. Be as useful as the material allows. Apply a passage sensibly to the question (for example, a rule about what the label must show answers a question about packaging), and give a direct, practical answer first, then its source. If the material covers only part of the question, answer that part and say in one short sentence which part the references don't cover. Only if nothing in the material helps, say you cannot confirm it from RegPilot's references and offer the contact details. Never invent rules, numbers or limits.
6. You cannot fill, change, submit or save anything. To fill Montaji, the client presses the Review and fill button on the product page and uses the Filling tool; the client always submits on Montaji themselves. Never say RegPilot submits on a client's behalf.
7. To add documents, the client drops them into this chat or the Documents area of the product page. On the dashboard, a drop starts a new product. One product per drop.
8. Never quote prices, fees or Dubai Municipality charges; when asked about them, give the pricing line and contact details. Do not add pricing or contact details to answers that did not ask for them.
9. Politely decline questions unrelated to product registration or regulation in the UAE.
10. Keep answers short: a few sentences or a short list. Plain text, no markdown headings.

${product ?? 'The client is on the dashboard, not on a product. Answer general questions; for a specific product, suggest opening it or dropping its documents here.'}

RegPilot services (English):
${settings.services_en}

Contact: email ${settings.contact_email}, WhatsApp ${settings.whatsapp_number}.
Pricing (English): ${settings.pricing_en}
Pricing (Arabic): ${settings.pricing_ar}

Reference passages:
${sources || '(none found for this question)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Please sign in again.' })
  // The browser sends the project's public key with every request; reuse it for the database calls.
  const publicKey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const db = createClient(SUPABASE_URL, publicKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser(authHeader.slice('Bearer '.length))
  if (userError || !userData.user) return json(401, { error: 'Please sign in again.' })
  const userId = userData.user.id

  let companyId: string
  let productId: string | null
  let messages: ChatMessage[]
  let mode: Mode
  let statusOnly: boolean
  let facts: string[]
  let lang: Lang
  try {
    const body = await req.json()
    companyId = String(body?.companyId ?? '')
    productId = body?.productId ? String(body.productId) : null
    mode = body?.mode === 'summary' ? 'summary' : body?.mode === 'check' ? 'check' : 'question'
    statusOnly = body?.mode === 'check_status'
    lang = body?.lang === 'ar' ? 'ar' : 'en'
    facts = (Array.isArray(body?.facts) ? body.facts : []).map(String).slice(0, 20).map((f: string) => f.slice(0, 600))
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string')
      .slice(-HISTORY_MESSAGES)
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (!companyId) return json(400, { error: 'companyId is required' })
  const summary = mode === 'summary'
  if (mode !== 'question' && !productId) return json(400, { error: 'This needs a product' })
  const checkRequest = lang === 'ar' ? 'افحص هذا المنتج فحصاً فورياً مقابل المتطلبات.' : 'Run an instant check of this product against the rules.'
  const question =
    mode === 'check' ? checkRequest : summary || statusOnly ? '' : messages.at(-1)?.role === 'user' ? messages.at(-1)!.text.trim() : ''
  if (mode === 'question' && !statusOnly && !question) return json(400, { error: 'Please type a question.' })

  // Row-level security answers these only for the user's own company and its products.
  const { data: company } = await db.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!company) return json(404, { error: 'Company not found or access denied' })
  let product: ProductContext | null = null
  if (productId) {
    const { data: p } = await db
      .from('products')
      .select('name, status, extracted_data, company_id')
      .eq('id', productId)
      .maybeSingle()
    if (!p || p.company_id !== companyId) return json(404, { error: 'Product not found or access denied' })
    if (mode === 'check' && p.status === 'draft') return json(400, { error: 'not_read' })
    const { data: docs } = await db.from('product_documents').select('file_name, doc_type').eq('product_id', productId)
    product = { name: p.name, status: p.status, extracted_data: p.extracted_data, documents: docs ?? [] }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: settings, error: settingsError } = await admin.from('site_settings').select('*').eq('id', 1).single()
  if (settingsError || !settings) {
    console.error('site_settings unreadable', settingsError?.message)
    return json(500, { error: 'The assistant is not available right now.' })
  }
  if (question.length > settings.chat_max_question_chars) {
    return json(400, { error: 'too_long', max: settings.chat_max_question_chars })
  }
  messages = messages.map((m) => ({ ...m, text: m.text.slice(0, 2000) }))

  // The free instant-check allowance: checks used this month by the company, out of the limit.
  const checkLimit = Number(settings.instant_check_monthly_limit ?? 10)
  const { month, renews } = allowanceMonth()
  const checksUsed = async () => {
    const { data } = await admin
      .from('instant_check_usage')
      .select('checks')
      .eq('month', month)
      .eq('company_id', companyId)
      .maybeSingle()
    return Number(data?.checks ?? 0)
  }
  if (statusOnly) return json(200, { checks: { used: await checksUsed(), limit: checkLimit, renews } })

  // A check uses the company's monthly allowance; questions and summaries use the daily question limit.
  const { data: claim, error: claimError } =
    mode === 'check'
      ? await admin.rpc('claim_instant_check', { p_company: companyId })
      : await admin.rpc('claim_product_chat_question', { p_user: userId })
  if (claimError) {
    console.error('claim failed', claimError.message)
    return json(500, { error: 'The assistant is not available right now.' })
  }
  if (claim !== 'ok') return json(429, { limited: claim, checks: { used: checkLimit, limit: checkLimit, renews } })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
  try {
    let found: Chunk[] = []
    if (!summary) {
      const terms = productTerms(product)
      const searchText =
        mode === 'check'
          ? `Labelling requirements, permitted claims, restricted and prohibited ingredients and their limits${terms.meaning}`
          : question + terms.meaning
      const embedding = await embedQuestion(searchText, controller.signal)
      const { data: chunks, error: matchError } = await db.rpc('match_reference_chunks', {
        query_embedding: `[${embedding.join(',')}]`,
        query_text: [mode === 'check' ? '' : exactTerms(question), terms.words].filter(Boolean).join(' or '),
        match_count: mode === 'check' ? MATCH_COUNT * 2 : product ? MATCH_COUNT + 4 : MATCH_COUNT,
      })
      if (matchError) throw new Error(`match: ${matchError.message}`)
      found = (chunks ?? []) as Chunk[]
    }

    const history = summary
      ? [{ role: 'user' as const, text: lang === 'ar' ? 'لخّص ما وجدته في المستندات.' : 'Summarise what you found in the documents.' }]
      : mode === 'check'
      ? [{ role: 'user' as const, text: checkRequest }]
      : messages
    const prompt = buildPrompt(settings, found, product && describeProduct(product, facts), mode, lang)
    const reply = await generate(prompt, history, controller.signal)
    const answer = typeof reply.answer === 'string' ? reply.answer.trim() : ''
    if (!answer) throw new Error('empty answer')
    const used = new Set((Array.isArray(reply.used_sources) ? reply.used_sources : []).map(String))
    const sources = found
      .filter((_, i) => used.has(`S${i + 1}`))
      .map((c) => ({ label: c.label, title: c.title, version: c.version, url: c.url }))

    // Kept with the conversation for 30 days so the client can scroll back.
    const rows = [
      ...(summary ? [] : [{ company_id: companyId, product_id: productId, user_id: userId, role: 'user', text: question }]),
      { company_id: companyId, product_id: productId, user_id: userId, role: 'assistant', text: answer, sources },
    ]
    const { error: saveError } = await db.from('product_chat_messages').insert(rows)
    if (saveError) console.error('save failed', saveError.message)

    return json(200, { answer, sources, ...(mode === 'check' ? { checks: { used: await checksUsed(), limit: checkLimit, renews } } : {}) })
  } catch (err) {
    console.error('product-chat failed', err instanceof Error ? err.message : err)
    if (mode === 'check') {
      const { error: releaseError } = await admin.rpc('release_instant_check', { p_company: companyId })
      if (releaseError) console.error('release failed', releaseError.message)
    }
    return json(502, { error: 'The assistant could not answer just now. Please try again in a minute.' })
  } finally {
    clearTimeout(timer)
  }
})
