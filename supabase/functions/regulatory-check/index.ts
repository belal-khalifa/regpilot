// Supabase Edge Function: the regulatory check of one product (REG-255, stage A).
// A signed-in client asks for a check; the function answers at once with the check's id and does the
// work in the background, so a phone that locks or a slow AI answer does not lose it:
//   1. Fixed rules (rules.ts): ingredients against the EU banned and restricted lists, documents and
//      certificates against the Dubai Municipality guideline. No AI.
//   2. One AI read (Gemini) of the label artwork and certificates, with the guideline's label section,
//      the claims rules and the EU labelling articles in front of it. Every finding must quote its rule;
//      a finding without a real quote becomes "Needs expert".
//   3. The findings are stored and the check waits for an expert (stage B).
// Reads the product and its files as the client (Row Level Security decides what they may see); writes
// the check with the service role, so a client can read but never change a finding.
// Deploy with "Verify JWT" on. Needs the GEMINI_API_KEY secret (already set for the other functions).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  casNumbers,
  checkedAiFinding,
  documentFindings,
  ingredientFindings,
  lookupNames,
  type AiFinding,
  type CertificateSeen,
  type Finding,
  type Ingredient,
  type Passage,
  type RequiredWarning,
  type Rule,
} from './rules.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') as string
// Both are asked at once and the first good answer wins, as in extract-product.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
const AI_DEADLINE_MS = 120_000
// Gemini takes at most 20 MB per request; files travel as base64 (a third larger).
const MAX_FILE_BYTES = 13 * 1024 * 1024
const EU_SOURCE = 'eu-1223-2009'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Data = {
  product_name?: string
  product_type?: string
  brand_name?: string
  country_of_origin?: string
  manufacturer_country?: string
  ingredients?: Ingredient[]
  label_claims?: string[]
  montaji_group?: string
  certificate_product_match?: 'yes' | 'no' | 'not_applicable' | 'no_certificate'
  document_inventory?: Array<{ file_name: string; kind: string }>
}
type Doc = { file_name: string; doc_type: string; storage_path: string; content_type: string }

const isUae = (c: string | undefined) => /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((c ?? '').trim())
const isFragrance = (d: Data) => /fragrance|perfume/i.test(d.montaji_group ?? '')

// What each file is: the AI's sorting for a dropped file, otherwise the slot it was uploaded into.
function kindOf(doc: Doc, data: Data): string {
  const sorted = data.document_inventory?.find((e) => e.file_name === doc.file_name)?.kind
  if (sorted) return sorted
  return { formula_ingredient_list: 'formula', certificate_free_sale: 'certificate_free_sale', label_artwork: 'label_artwork' }[doc.doc_type] ?? 'unsorted'
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// ------------------------------------------------------------------ reference passages

type SourceRow = { id: string; title: string; version: string; current_load_id: string | null }

async function loadPassages(db: SupabaseClient, guideline: 'GU116' | 'GU117') {
  const dmId = `dm-${guideline.toLowerCase()}`
  const { data: sources, error } = await db
    .from('reference_sources')
    .select('id, title, version, current_load_id')
    .in('id', [dmId, EU_SOURCE])
  if (error) throw new Error(`reference_sources: ${error.message}`)
  const byId = new Map((sources as SourceRow[]).map((s) => [s.id, s]))
  const read = async (sourceId: string, filter: string) => {
    const source = byId.get(sourceId)
    if (!source?.current_load_id) return []
    const { data, error: chunkError } = await db
      .from('reference_chunks')
      .select('label, content')
      .eq('source_id', sourceId)
      .eq('load_id', source.current_load_id)
      .or(filter)
      .order('id')
    if (chunkError) throw new Error(`reference_chunks: ${chunkError.message}`)
    return (data as Array<{ label: string; content: string }>).map((c) => ({ ...c, title: source.title, version: source.version }))
  }
  // The guideline's sections on definitions, scope, labels, claims, advertising and documents.
  const dmSections = guideline === 'GU116'
    ? ['4', '5.1', '5.2', '7.1', '7.2', '9.1', '9.2', '9.3', '9.5', '11.2']
    : ['4', '5.1', '6-5', '7.2', '7.3', '7.4', '8', '8.1']
  // Values are quoted because labels contain commas and brackets; * is the wildcard.
  const dm = await read(dmId, dmSections.map((n) => `label.like."${guideline}, Section ${n} *"`).join(','))
  // EU: the definition of a cosmetic product, labelling (Article 19) and claims (Article 20).
  const eu = await read(EU_SOURCE, ['Article 2', 'Article 19', 'Article 20'].map((a) => `label.eq."${a}",label.like."${a} (part *"`).join(','))
  const sourceList = [byId.get(dmId), byId.get(EU_SOURCE)].filter(Boolean).map((s) => ({ id: s!.id, title: s!.title, version: s!.version }))
  return { dm: dm as Passage[], eu: eu as Passage[], sources: sourceList, euVersion: byId.get(EU_SOURCE) }
}

// ------------------------------------------------------------------ the AI read

const FINDING = {
  type: 'OBJECT',
  properties: {
    item: { type: 'STRING' },
    status: { type: 'STRING', enum: ['pass', 'issue', 'needs_expert'] },
    observed: { type: 'STRING' },
    explanation: { type: 'STRING' },
    source: { type: 'STRING' },
    quote: { type: 'STRING' },
  },
  required: ['item', 'status', 'explanation'],
}

const AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label_found: { type: 'BOOLEAN' },
    label_items: { type: 'ARRAY', items: FINDING },
    claims: {
      type: 'ARRAY',
      items: { ...FINDING, properties: { ...FINDING.properties, changes_product_type: { type: 'BOOLEAN' } }, required: ['item', 'status', 'explanation', 'changes_product_type'] },
    },
    warnings: { type: 'ARRAY', items: FINDING },
    certificates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          file_name: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['free_sale', 'gmp', 'halal', 'other'] },
          names_product: { type: 'STRING', enum: ['yes', 'no', 'unclear'] },
          valid_until: { type: 'STRING' },
        },
        required: ['file_name', 'kind', 'names_product', 'valid_until'],
      },
    },
    halal_logo_on_label: { type: 'BOOLEAN' },
  },
  required: ['label_found', 'label_items', 'claims', 'warnings', 'certificates', 'halal_logo_on_label'],
}

function aiPrompt(data: Data, guideline: 'GU116' | 'GU117', passages: Passage[], warnings: RequiredWarning[], today: string): string {
  const labelSection = guideline === 'GU116' ? 'GU116, Section 7.1' : 'GU117, Section 8.1'
  const numbered = passages.map((p, i) => `[S${i + 1}] ${p.title}, version ${p.version}. ${p.label}\n${p.content}`).join('\n\n')
  return `You are a regulatory reviewer for cosmetic, personal care and fragrance products registered with Dubai Municipality (Montaji). Check the attached label artwork and certificates against the numbered reference passages below. Use ONLY these passages as rules; never use outside knowledge. Today is ${today}.

Product (from RegPilot's earlier reading of the documents): ${data.product_name ?? 'unknown'}, brand ${data.brand_name ?? 'unknown'}, type ${data.product_type ?? 'unknown'}, Montaji group ${data.montaji_group ?? 'unknown'}, country of origin ${data.country_of_origin ?? 'unknown'}.
Claims noticed on the label earlier: ${(data.label_claims ?? []).join('; ') || 'none listed'}.

Every finding has a status:
- "pass": the label clearly meets the rule.
- "issue": the label clearly does not meet the rule (missing, wrong or not allowed).
- "needs_expert": a judgement call, unreadable, or no passage covers it.
For "pass" and "issue" you MUST give "source" (the passage id, e.g. "S3") and "quote": the exact words of that passage that state the rule, copied character for character (one sentence or bullet, at most 40 words). If you cannot quote a rule, the status is "needs_expert". "observed" is what you actually see on the label (copy the text, or say it is absent). "explanation" is one or two plain sentences for a busy regulatory manager.

TASKS
1. label_found: whether a label or packaging artwork is attached.
2. label_items: one finding for EACH required label component listed in ${labelSection} (for example brand name, product name, manufacturer details, country of origin, ingredients, pack size, production and expiry dates, batch number, storage, instructions, warnings, barcode, period after opening), plus one for the language (clear English and/or Arabic). Use the component's name from the passage as "item". If no label is attached, return each component as "issue" with observed "No label artwork among the documents". A component the passage marks "if applicable" that does not apply is "pass" with that reason.
3. claims: one finding for EACH claim on the label: words or symbols about what the product does or contains, or how it was made or tested (e.g. "dermatologically tested", "paraben-free", "SPF 30", "natural", "anti-dandruff", "treats acne", "antibacterial"). "item" is the claim as printed, in quotes. Set changes_product_type to true when the claim says the product prevents, treats or cures a disease or condition, or has a medicinal, antibacterial or pharmacological effect: such claims may take the product out of cosmetics (see the definitions and medical claims rules). A claim the passages forbid is "issue"; a claim the passages allow is "pass" only when you can quote the rule; otherwise "needs_expert". Return an empty list if there are no claims.
4. warnings: ${warnings.length ? `the EU regulation requires this wording on the label for these ingredients. One finding per line below: "pass" if the label shows it (or clearly equivalent wording), "issue" if it does not, "needs_expert" if the condition may not apply to this product. Use "item" = "Warning for <ingredient>", and quote nothing (leave source and quote empty).
${warnings.map((w) => `- ${w.ingredient} (${w.rule}): ${w.wording}`).join('\n')}` : 'none required; return an empty list.'}
5. certificates: one entry per attached certificate: its file name, kind ("free_sale" Free Sale Certificate, "gmp" GMP / ISO 22716, "halal" Halal certificate, "other"), whether it names this product (names_product), and valid_until: the expiry or validity end date as YYYY-MM-DD, or "" if none is printed.
6. halal_logo_on_label: true if a Halal logo or the word Halal appears on the label.

Reference passages:
${numbered}`
}

async function askGemini(parts: unknown[]): Promise<Record<string, unknown>> {
  const errors: string[] = []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_DEADLINE_MS)
  const ask = async (model: string) => {
    let thinkingOff = true
    while (!controller.signal.aborted) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: AI_SCHEMA,
            ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: controller.signal,
      })
      if (res.ok) {
        const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>; usageMetadata?: unknown }
        console.log('Gemini answered', model, JSON.stringify(body.usageMetadata ?? {}))
        const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
        return JSON.parse(text) as Record<string, unknown>
      }
      const reason = `${model} ${res.status}: ${(await res.text()).slice(0, 200)}`
      errors.push(reason)
      if (res.status === 400 && thinkingOff) {
        thinkingOff = false
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      throw new Error(reason)
    }
    throw new Error(`${model}: ran out of time`)
  }
  try {
    return await Promise.any(GEMINI_MODELS.map(ask))
  } catch {
    throw new Error(`AI read failed: ${errors.slice(-3).join(' | ') || 'no answer in time'}`)
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

// ------------------------------------------------------------------ the check itself

async function runCheck(
  db: SupabaseClient,
  admin: SupabaseClient,
  checkId: string,
  data: Data,
  docs: Doc[],
  guideline: 'GU116' | 'GU117',
) {
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10) // UAE date
  const { dm, eu, sources, euVersion } = await loadPassages(db, guideline)
  if (!dm.length) throw new Error(`The ${guideline} guideline is not in the reference library`)

  // 1. Ingredients against the EU lists, matched by name or CAS number.
  const ingredients = (data.ingredients ?? []).filter((i) => (i.inci_name ?? '').trim())
  const { data: versionRows } = await db.from('ingredient_rule_versions').select('version').limit(1)
  const rulesVersion = (versionRows as Array<{ version: string }> | null)?.[0]?.version
  if (!rulesVersion) throw new Error('The ingredient rules are not loaded yet')
  const names = [...new Set(ingredients.flatMap((i) => lookupNames(i.inci_name ?? '')))]
  const cas = [...new Set(ingredients.flatMap((i) => casNumbers(i.cas_number)))]
  const rules: Rule[] = []
  const columns = 'annex, ref, chemical_name, inci_name, cas_numbers, names, product_type, max_concentration, other_conditions, warnings'
  for (const [column, values] of [['names', names], ['cas_numbers', cas]] as const) {
    if (!values.length) continue
    const { data: ruleRows, error } = await db.from('ingredient_rules').select(columns).eq('version', rulesVersion).overlaps(column, values)
    if (error) throw new Error(`ingredient_rules: ${error.message}`)
    for (const row of ruleRows as Rule[]) {
      if (!rules.some((r) => r.annex === row.annex && r.ref === row.ref && r.product_type === row.product_type && r.max_concentration === row.max_concentration)) rules.push(row)
    }
  }
  const euTitle = euVersion?.title ?? 'Regulation (EC) No 1223/2009 on cosmetic products'
  const ingredientResult = ingredientFindings(ingredients, rules, { title: euTitle, version: rulesVersion })

  // 2. One AI read of the label and certificates.
  // The document sections are applied by the fixed rules, so the AI sees the rest.
  const documentSection = guideline === 'GU116' ? /, Section 9\./ : /, Section 7\.[2-4] /
  const aiPassages = [...dm.filter((p) => !documentSection.test(p.label)), ...eu]
  const wanted = docs.filter((d) => ['label_artwork', 'certificate_free_sale', 'gmp_certificate', 'other_supporting'].includes(kindOf(d, data)))
  const parts: unknown[] = [{ text: aiPrompt(data, guideline, aiPassages, ingredientResult.warnings, today) }]
  let bytes = 0
  const skipped: string[] = []
  for (const doc of wanted) {
    const { data: blob, error } = await db.storage.from('product-documents').download(doc.storage_path)
    if (error || !blob) {
      skipped.push(doc.file_name)
      continue
    }
    if (bytes + blob.size > MAX_FILE_BYTES) {
      skipped.push(doc.file_name)
      continue
    }
    bytes += blob.size
    parts.push({ text: `Document "${doc.file_name}" (${kindOf(doc, data).replace(/_/g, ' ')})` })
    parts.push({ inlineData: { mimeType: doc.content_type || 'application/octet-stream', data: toBase64(new Uint8Array(await blob.arrayBuffer())) } })
  }
  if (skipped.length) console.log('Not sent to the AI (too large or unreadable):', skipped.join(', '))
  const ai = await askGemini(parts)

  const list = (key: string) => (Array.isArray(ai[key]) ? (ai[key] as AiFinding[]) : [])
  const claims = list('claims').map((f) => checkedAiFinding('claims', f, aiPassages))
  const label = list('label_items').map((f) => checkedAiFinding('label', f, aiPassages))
  // Warnings come from the EU entries already quoted with the ingredient, so they carry that rule.
  const warningFindings: Finding[] = list('warnings').map((f) => {
    const w = ingredientResult.warnings.find((x) => (f.item ?? '').toLowerCase().includes(x.ingredient.toLowerCase()))
    const status = f.status === 'pass' || f.status === 'issue' ? f.status : 'needs_expert'
    return {
      area: 'label',
      item: (f.item ?? '').slice(0, 300),
      status: w ? status : 'needs_expert',
      explanation: (f.explanation ?? '').slice(0, 1200),
      evidence: (f.observed ?? '').slice(0, 600),
      changes_product_type: false,
      clause: w ? `${w.rule}: ${w.wording}` : '',
      source_title: w ? euTitle : '',
      source_version: w ? rulesVersion : '',
      source_label: w?.rule ?? '',
    }
  })

  // 3. Documents and certificates, using what the AI read on the certificates.
  const kinds = new Set(docs.map((d) => kindOf(d, data)))
  const country = (data.country_of_origin ?? '').trim()
  const certificates = (Array.isArray(ai.certificates) ? ai.certificates : []) as CertificateSeen[]
  const documents = documentFindings(
    {
      guideline,
      madeInUae: country ? isUae(country) : null,
      country,
      hasFormula: kinds.has('formula'),
      hasFreeSale: kinds.has('certificate_free_sale') || certificates.some((c) => c.kind === 'free_sale'),
      hasGmp: kinds.has('gmp_certificate') || certificates.some((c) => c.kind === 'gmp'),
      certificateNamesProduct: data.certificate_product_match,
      certificates,
      halalLogo: ai.halal_logo_on_label === true,
      today,
    },
    dm,
  )

  // Claims first: they are the key check.
  const findings = [...claims, ...label, ...warningFindings, ...ingredientResult.findings, ...documents]
  if (!claims.length) {
    findings.unshift({
      area: 'claims', item: 'Claims on the label', status: ai.label_found === false ? 'needs_expert' : 'pass',
      explanation: ai.label_found === false ? 'No label artwork among the documents, so the claims could not be checked.' : 'No claims were found on the label.',
      evidence: '', changes_product_type: false, clause: '', source_title: '', source_version: '', source_label: '',
    })
  }
  const rows = findings.map((f, position) => ({ ...f, check_id: checkId, position }))
  const { error: insertError } = await admin.from('regulatory_findings').insert(rows)
  if (insertError) throw new Error(`saving findings: ${insertError.message}`)
  const { error: updateError } = await admin
    .from('regulatory_checks')
    .update({ status: 'under_review', finished_at: new Date().toISOString(), sources: [...sources.map((s) => (s.id === EU_SOURCE ? { ...s, rules_version: rulesVersion } : s))] })
    .eq('id', checkId)
  if (updateError) throw new Error(`finishing check: ${updateError.message}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const authHeader = req.headers.get('authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Please sign in again.' })
    const publicKey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const db = createClient(SUPABASE_URL, publicKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
    const { data: userData, error: userError } = await db.auth.getUser(authHeader.slice('Bearer '.length))
    if (userError || !userData.user) return json(401, { error: 'Please sign in again.' })

    let productId = ''
    try {
      productId = String((await req.json())?.productId ?? '')
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    if (!productId) return json(400, { error: 'productId is required' })

    // Row Level Security answers only for the client's own company's products.
    const { data: product } = await db.from('products').select('id, company_id, status, extracted_data').eq('id', productId).maybeSingle()
    if (!product) return json(404, { error: 'Product not found or access denied' })
    if (product.status === 'draft') return json(400, { error: 'Read the documents with AI first; the check works on what the reading found.' })
    const { data: docs } = await db.from('product_documents').select('file_name, doc_type, storage_path, content_type').eq('product_id', productId)
    const data = (product.extracted_data ?? {}) as Data
    const guideline = isFragrance(data) ? 'GU117' : 'GU116'

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const { data: claim, error: claimError } = await admin.rpc('claim_regulatory_check', {
      p_company: product.company_id, p_product: productId, p_user: userData.user.id, p_guideline: `dm-${guideline.toLowerCase()}`,
    })
    if (claimError) {
      console.error('claim failed', claimError.message)
      return json(500, { error: 'The check could not start just now. Please try again in a minute.' })
    }
    if (claim === 'running') return json(409, { error: 'A check is already running for this product.' })
    if (claim === 'company_limit') return json(429, { error: 'Your company has reached today’s number of regulatory checks. Please try again tomorrow, or contact us.' })
    const checkId = String(claim)

    EdgeRuntime.waitUntil(
      runCheck(db, admin, checkId, data, (docs ?? []) as Doc[], guideline).catch(async (err) => {
        console.error('regulatory-check failed', checkId, err instanceof Error ? err.message : err)
        await admin.from('regulatory_findings').delete().eq('check_id', checkId)
        await admin.from('regulatory_checks').update({
          status: 'failed', finished_at: new Date().toISOString(),
          error: 'The check could not finish. Please try again in a few minutes.',
        }).eq('id', checkId)
      }),
    )
    return json(202, { checkId })
  } catch (err) {
    console.error('regulatory-check crashed', err)
    return json(500, { error: 'Something went wrong. Please try again.' })
  }
})
