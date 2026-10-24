// Supabase Edge Function: reads a product's uploaded documents with Gemini and stores the result.
// Runs on Deno. The caller must be signed in; the product and its files are read with THEIR token,
// so Row Level Security decides what they may see. The Gemini key is a Supabase secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { MONTAJI_TAXONOMY } from './montajiTaxonomy.ts'
import {
  CLASSIFICATION_CONFIDENCE,
  MONTAJI_CATEGORIES,
  MONTAJI_GROUPS,
  MONTAJI_SUB_CATEGORIES,
  SHELF_LIFE_PERIOD_TYPES,
  VOLUME_UNITS,
  validateClassification,
  type Classification,
} from './montajiFields.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') as string
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') as string
// The newest flash model is sometimes overloaded (503); the lite model answers well too. Both are
// asked at once and the first good answer wins.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
// Supabase stops a function after 150 s; this leaves time to answer before that.
const HARD_LIMIT_MS = 140_000
// Abuse and cost controls (the database also caps files at 15 MB each and 20 per product).
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
const MAX_RUNS_PER_HOUR = 20
// A run with no finish time older than this is treated as dead (longer than any request can last).
const RUN_STALE_MS = 5 * 60 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const DOC_TYPE_LABELS: Record<string, string> = {
  formula_ingredient_list: 'Formula / ingredient list',
  certificate_free_sale: 'Certificate of Free Sale / manufacturer docs',
  label_artwork: 'Label artwork',
  unsorted: 'not labelled (dropped with the others; work out what it is)',
}
const DOCUMENT_KINDS = [
  'formula',
  'certificate_free_sale',
  'gmp_certificate',
  'label_artwork',
  'other_supporting',
  'unrelated',
]

const TAXONOMY_FOR_PROMPT = Object.entries(MONTAJI_TAXONOMY)
  .map(([group, cats]) => {
    const lines = Object.entries(cats).map(([cat, subs]) => {
      const extra = subs.filter((s) => s !== 'Undefined')
      return extra.length ? `    - ${cat} (sub-categories besides Undefined: ${extra.join('; ')})` : `    - ${cat}`
    })
    return `  ${group}:\n${lines.join('\n')}`
  })
  .join('\n')

const EXTRACTION_PROMPT = `You are extracting structured product data from cosmetics regulatory documents (ingredient/formula lists, Certificates of Free Sale or GMP certificates, manufacturer documents, and label artwork) to help prepare a submission to Dubai Municipality's Montaji registration portal.

Read all the attached documents carefully and extract:

PRODUCT
- product_name, product_type (free text such as "Lip Gloss"), brand_name, and country_of_origin (the country where the product is manufactured, as a plain English country name).
- The full ingredient list in INCI naming, with percentage if stated.
- manufacturer_name, manufacturer_country and manufacturer_address.
- certificate_number and certificate_issuing_country, if a Certificate of Free Sale or GMP certificate is present.
- Notable label claims (e.g. "paraben-free", "SPF 30").

VARIANTS
A product can come in several shades, scents/flavours or sizes. Montaji registers each one as a separate variant with its own barcode. Return one entry in "variants" per distinct shade/scent/size/barcode combination that the documents list. If the product has only one version, return a single variant.
For every variant:
- barcode: the international barcode digits (EAN/UPC) printed for that exact variant. Never invent or reuse another variant's barcode.
- color_shade: the MANUFACTURER'S OWN shade designation exactly as the manufacturer uses it - a number, code or name such as "126", "128" or "Rose 04". Do NOT describe the visible colour ("red", "pink", "nude"). If the product has no shade designation at all, return "NA".
- scent_flavor: the MANUFACTURER'S OWN scent or flavour name as printed. If the product has none, return "NA".
- size_volume: the net content number only, as a string (for "50 ml" return "50").
- volume_unit: the unit, chosen from the allowed values.

SHELF LIFE AND DATES (leave out anything you cannot see on the documents)
- shelf_life and shelf_life_period_type when a shelf life is stated.
- has_production_date, has_expiry_date, has_batch_number: true only if a production/manufacturing date, an expiry date, or a batch/lot code is actually printed or shown on the label.
- has_period_after_opening: true only if a period-after-opening symbol (the open-jar icon with a number of months) is shown.

CERTIFICATE CHECK
Each document is introduced by a line saying how the uploader labelled it. If one is labelled "Certificate of Free Sale / manufacturer docs", or you sorted it as a Certificate of Free Sale or GMP certificate, look at what that certificate covers:
- certificate_product_match: "yes" if the certificate names this product, "no" if it does not, "not_applicable" if the document is a GMP certificate (it covers a manufacturing site, not products), "no_certificate" if no such document was provided. A close match is fine: the certificate may use a shorter or slightly different wording than the label (for example "Gatsby Styling Gel Wet & Hard" for "Gatsby Styling Gel Wet and Hard Super Hard"), and a product listed with its brand or among many other products still counts. Different products from the same brand do NOT count.
- certificate_matched_text: when the answer is "yes", the line from the certificate that names the product, copied as written.
- certificate_products_listed: up to 5 product names the certificate lists (the first ones if there are more).

DOCUMENT MISMATCH CHECK
The product is the one on the label artwork. For every OTHER document that names a product (a formula, a certificate of composition, a certificate of analysis, a specification sheet), compare the product it names with the label's product. If a document is clearly about a DIFFERENT product (different product type or name, for example a body scrub when the label is a fragrance mist), add it to document_mismatches with its file name and the product it names. Different wording for the same product does not count. Do not list Certificates of Free Sale (checked separately), GMP certificates, or documents that name no product. Never take ingredients or percentages from a document listed in document_mismatches.

DOCUMENT SORTING
Documents may be uploaded together without a label. Return "document_inventory" with ONE entry for EVERY attached document, using its file name exactly as given:
- kind: "formula" (formula, ingredient list, composition or INCI list), "certificate_free_sale" (Certificate of Free Sale), "gmp_certificate" (GMP / ISO 22716 certificate of the factory), "label_artwork" (label, packaging or artwork design), "other_supporting" (any other document about this product, such as a certificate of analysis, specification or safety report), or "unrelated" (nothing to do with registering this product, for example an invoice, a photo of something else or a blank page).
- product_named: the product the document names, if it names one.
Never take any data from a document you sorted as "unrelated".
Return "products_found": the distinct products that the label artwork, formula and other product documents are about, one name each. Count a product once even when documents word its name differently. Shades, scents, flavours and sizes of one product are variants of ONE product, not separate products. NEVER take names from a Certificate of Free Sale or GMP certificate: a certificate often lists a brand's whole range, and those other products are not part of this upload.

MONTAJI CLASSIFICATION
Choose montaji_group, montaji_category and montaji_sub_category from EXACTLY these valid combinations (group, then its categories):
${TAXONOMY_FOR_PROMPT}
Use the sub-category "Undefined" unless one of the listed extra sub-categories clearly applies. Set classification_confidence to "high" only when the product clearly belongs to one category, "medium" when two categories are plausible, and "low" when you are guessing.

Put anything unclear, missing, or that a human reviewer should double-check in "notes". If a field is not present in the documents, omit it rather than guessing (except color_shade and scent_flavor, which must be "NA" when the product has none). Respond only with the structured data.`

const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_name: { type: 'STRING' },
    product_type: { type: 'STRING' },
    brand_name: { type: 'STRING' },
    country_of_origin: { type: 'STRING' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          inci_name: { type: 'STRING' },
          percentage: { type: 'STRING' },
        },
        required: ['inci_name'],
      },
    },
    manufacturer_name: { type: 'STRING' },
    manufacturer_country: { type: 'STRING' },
    manufacturer_address: { type: 'STRING' },
    certificate_number: { type: 'STRING' },
    certificate_issuing_country: { type: 'STRING' },
    label_claims: { type: 'ARRAY', items: { type: 'STRING' } },
    certificate_product_match: {
      type: 'STRING',
      format: 'enum',
      enum: ['yes', 'no', 'not_applicable', 'no_certificate'],
    },
    certificate_matched_text: { type: 'STRING' },
    certificate_products_listed: { type: 'ARRAY', items: { type: 'STRING' } },
    document_mismatches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { file_name: { type: 'STRING' }, product_named: { type: 'STRING' } },
        required: ['file_name', 'product_named'],
      },
    },
    document_inventory: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          file_name: { type: 'STRING' },
          kind: { type: 'STRING', format: 'enum', enum: DOCUMENT_KINDS },
          product_named: { type: 'STRING' },
        },
        required: ['file_name', 'kind'],
      },
    },
    products_found: { type: 'ARRAY', items: { type: 'STRING' } },
    variants: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          barcode: { type: 'STRING' },
          color_shade: { type: 'STRING' },
          scent_flavor: { type: 'STRING' },
          size_volume: { type: 'STRING' },
          volume_unit: { type: 'STRING', format: 'enum', enum: [...VOLUME_UNITS] },
        },
      },
    },
    shelf_life: { type: 'STRING' },
    shelf_life_period_type: { type: 'STRING', format: 'enum', enum: [...SHELF_LIFE_PERIOD_TYPES] },
    has_production_date: { type: 'BOOLEAN' },
    has_expiry_date: { type: 'BOOLEAN' },
    has_batch_number: { type: 'BOOLEAN' },
    has_period_after_opening: { type: 'BOOLEAN' },
    montaji_group: { type: 'STRING', format: 'enum', enum: MONTAJI_GROUPS },
    montaji_category: { type: 'STRING', format: 'enum', enum: MONTAJI_CATEGORIES },
    montaji_sub_category: { type: 'STRING', format: 'enum', enum: MONTAJI_SUB_CATEGORIES },
    classification_confidence: { type: 'STRING', format: 'enum', enum: [...CLASSIFICATION_CONFIDENCE] },
    notes: { type: 'STRING' },
  },
}

// Tidies the model's answer into the shape the rest of the app relies on.
function postProcess(raw: Record<string, unknown>): Record<string, unknown> {
  const data = { ...raw } as Record<string, unknown> & Classification
  Object.assign(data, validateClassification(data))
  if (!data.montaji_group) {
    delete data.montaji_category
    delete data.montaji_sub_category
  }

  const rawVariants = Array.isArray(data.variants) ? (data.variants as Record<string, unknown>[]) : []
  const variants = rawVariants.map((v) => ({
    ...v,
    color_shade: String(v.color_shade ?? '').trim() || 'NA',
    scent_flavor: String(v.scent_flavor ?? '').trim() || 'NA',
  }))
  data.variants = variants.length ? variants : [{ color_shade: 'NA', scent_flavor: 'NA' }]
  return data
}

// Reads the documents, asks Gemini and stores the result. Called once the caller, the product and
// the usage limits have been checked.
// deno-lint-ignore no-explicit-any
async function extractCore(supabase: any, productId: string, docs: any[]): Promise<Response> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: EXTRACTION_PROMPT },
  ]

  let totalBytes = 0
  // A missing document would give a complete-looking but wrong result, so any unreadable file stops
  // the extraction and is named to the user.
  const unreadable: string[] = []
  for (const doc of docs) {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('product-documents')
      .download(doc.storage_path)
    if (downloadError || !fileBlob) {
      console.error('Could not download document', doc.storage_path, downloadError?.message)
      unreadable.push(doc.file_name)
      continue
    }
    if (unreadable.length) continue
    totalBytes += fileBlob.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json(413, { error: 'These documents are too large to read together (over 40 MB in total). Remove some or use smaller files.' })
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    parts.push({
      text: `Document "${doc.file_name}", uploaded as: ${DOC_TYPE_LABELS[doc.doc_type as string] ?? 'other document'}`,
    })
    parts.push({
      inlineData: {
        mimeType: doc.content_type || 'application/octet-stream',
        data: toBase64(bytes),
      },
    })
  }

  if (unreadable.length) {
    return json(422, {
      error: `Could not open ${unreadable.length === 1 ? 'this document' : 'these documents'}: ${unreadable.join(', ')}. Nothing was extracted. Try again, or remove and re-upload ${unreadable.length === 1 ? 'it' : 'them'}.`,
    })
  }

  if (parts.length === 1) {
    return json(500, { error: 'Could not read any uploaded documents' })
  }

  const buildBody = (withThinkingOff: boolean) =>
    JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_SCHEMA,
        // Reading a form does not need a long reasoning pass, and that pass is what makes scanned
        // PDFs slow.
        ...(withThinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    })

  const startedAt = Date.now()
  const errors: string[] = []

  // One model, asked until it answers or the deadline passes. Resolves with the parsed reply or
  // rejects with a readable reason.
  async function askModel(model: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    let thinkingOff = true
    let lastReason = `${model}: no answer`
    while (!signal.aborted) {
      const askedAt = Date.now()
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: buildBody(thinkingOff), signal },
      )
      if (res.ok) {
        const answer = (await res.json()) as Record<string, unknown>
        // Timing and token use in the logs, to see where a slow read spends its time.
        console.log('Gemini answered', model, `thinking ${thinkingOff ? 'off' : 'on'}`, `${Date.now() - askedAt} ms`, JSON.stringify(answer.usageMetadata ?? {}))
        return answer
      }
      const text = (await res.text()).slice(0, 300)
      lastReason = `${model} ${res.status} after ${Date.now() - askedAt} ms: ${text}`
      errors.push(lastReason)
      console.error('Gemini attempt failed', lastReason)
      // Some models reject the "no thinking" setting with a vague 400; ask again without it.
      if (res.status === 400 && thinkingOff) {
        thinkingOff = false
        continue
      }
      // Overloaded or rate limited: wait a moment and ask the same model again.
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      throw new Error(lastReason)
    }
    throw new Error(`${lastReason} (ran out of time)`)
  }

  // Both models are asked at once and the first good answer wins: the lighter one usually answers
  // well inside the time limit even when the stronger one is slow or overloaded.
  let geminiJson: Record<string, unknown> | null = null
  for (let round = 0; round < 1 && !geminiJson; round++) {
    const remaining = HARD_LIMIT_MS - (Date.now() - startedAt)
    if (remaining < 6000) break
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    try {
      geminiJson = await Promise.any(
        GEMINI_MODELS.map((model) =>
          askModel(model, controller.signal).catch((err) => {
            if (err instanceof Error && err.name === 'AbortError') errors.push(`${model} timed out`)
            throw err
          }),
        ),
      )
    } catch {
      // every model failed this round
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    if (!geminiJson && Date.now() - startedAt < HARD_LIMIT_MS - 6000) await new Promise((r) => setTimeout(r, 1000))
  }

  if (!geminiJson) {
    console.error('Gemini gave no answer', errors.slice(-4).join(' | '))
    return json(502, { error: 'The AI service did not answer in time. Please try again in a minute.' })
  }

  const candidateParts = (geminiJson as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })
    .candidates?.[0]?.content?.parts
  const rawText = (candidateParts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (!rawText) {
    return json(502, { error: 'The AI returned no content. Please try again.' })
  }

  let extracted: Record<string, unknown>
  try {
    extracted = postProcess(JSON.parse(rawText))
  } catch {
    return json(502, { error: 'The AI returned an unreadable answer. Please try again.' })
  }

  const { error: updateError } = await supabase
    .from('products')
    .update({
      extracted_data: extracted,
      status: 'extracted',
      updated_at: new Date().toISOString(),
      // The list shows the product by its real name, so the extracted one replaces the placeholder.
      ...(typeof extracted.product_name === 'string' && extracted.product_name.trim()
        ? { name: extracted.product_name.trim() }
        : {}),
    })
    .eq('id', productId)

  if (updateError) {
    console.error('Saving extraction failed', updateError.message)
    return json(500, { error: 'The documents were read but the result could not be saved. Please try again.' })
  }

  return json(200, { extracted_data: extracted })
}

async function extractHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Missing bearer token' })
  const accessToken = authHeader.slice('Bearer '.length)
  // The browser sends the project's public key with every request; reuse it for the database call.
  const publicKey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  let productId: string | undefined
  try {
    ;({ productId } = await req.json())
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (!productId) return json(400, { error: 'productId is required' })

  const supabase = createClient(SUPABASE_URL, publicKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, company_id, name')
    .eq('id', productId)
    .single()

  if (productError || !product) {
    return json(404, { error: 'Product not found or access denied' })
  }

  const { data: docs, error: docsError } = await supabase
    .from('product_documents')
    .select('storage_path, file_name, content_type, doc_type')
    .eq('product_id', productId)

  if (docsError) {
    console.error('Reading documents failed', docsError.message)
    return json(500, { error: 'Could not read this product\'s documents.' })
  }
  if (!docs || docs.length === 0) {
    return json(400, { error: 'Upload at least one document first' })
  }

  // Reserve a run in ONE atomic database step: access check, "one run per product at a time" (across
  // all company members) and the per-person hourly limit. If the check itself fails, extraction does
  // not start.
  const { data: runId, error: claimError } = await supabase.rpc('claim_extraction_run', {
    p_product_id: productId,
    p_max_per_hour: MAX_RUNS_PER_HOUR,
    p_stale_seconds: RUN_STALE_MS / 1000,
  })
  if (claimError) {
    if (claimError.code === 'RP001') {
      return json(409, { error: 'Extraction is already running for this product. Please wait for it to finish.' })
    }
    if (claimError.code === 'RP002') {
      return json(429, { error: 'Extraction has been run many times in the last hour. Please wait a little and try again.' })
    }
    console.error('Could not reserve an extraction run', claimError.code, claimError.message)
    return json(503, { error: 'Could not start extraction safely. Please try again in a moment.' })
  }

  try {
    return await extractCore(supabase, productId, docs)
  } finally {
    const { error: finishError } = await supabase.rpc('finish_extraction_run', { p_run_id: runId })
    if (finishError) console.error('Could not mark the extraction run finished', finishError.message)
  }
}

// Anything unexpected becomes a readable JSON error instead of a bare gateway failure.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    return await extractHandler(req)
  } catch (err) {
    console.error('extract-product crashed', err)
    return json(500, { error: 'Something went wrong while reading the documents. Please try again.' })
  }
})
