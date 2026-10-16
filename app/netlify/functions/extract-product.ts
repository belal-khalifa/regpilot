import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
import { MONTAJI_TAXONOMY } from '../../src/lib/montajiTaxonomy'
import {
  CLASSIFICATION_CONFIDENCE,
  MONTAJI_CATEGORIES,
  MONTAJI_GROUPS,
  MONTAJI_SUB_CATEGORIES,
  SHELF_LIFE_PERIOD_TYPES,
  VOLUME_UNITS,
  validateClassification,
  type Classification,
} from '../../src/lib/montajiFields'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string
// The newest flash model is sometimes overloaded (503); the lite model is the fallback and was
// verified to extract shades, barcodes and classification correctly.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
const HARD_LIMIT_MS = 25_000

const TAXONOMY_FOR_PROMPT = Object.entries(MONTAJI_TAXONOMY)
  .map(([group, cats]) => {
    const lines = Object.entries(cats).map(([cat, subs]) => {
      const extra = subs.filter((s) => s !== 'Undefined')
      return extra.length ? `    - ${cat} (sub-categories besides Undefined: ${extra.join('; ')})` : `    - ${cat}`
    })
    return `  ${group}:\n${lines.join('\n')}`
  })
  .join('\n')

export const EXTRACTION_PROMPT = `You are extracting structured product data from cosmetics regulatory documents (ingredient/formula lists, Certificates of Free Sale or GMP certificates, manufacturer documents, and label artwork) to help prepare a submission to Dubai Municipality's Montaji registration portal.

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

MONTAJI CLASSIFICATION
Choose montaji_group, montaji_category and montaji_sub_category from EXACTLY these valid combinations (group, then its categories):
${TAXONOMY_FOR_PROMPT}
Use the sub-category "Undefined" unless one of the listed extra sub-categories clearly applies. Set classification_confidence to "high" only when the product clearly belongs to one category, "medium" when two categories are plausible, and "low" when you are guessing.

Put anything unclear, missing, or that a human reviewer should double-check in "notes". If a field is not present in the documents, omit it rather than guessing (except color_shade and scent_flavor, which must be "NA" when the product has none). Respond only with the structured data.`

export const EXTRACTION_SCHEMA = {
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
export function postProcess(raw: Record<string, unknown>): Record<string, unknown> {
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

const extractHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing bearer token' }) }
  }
  const accessToken = authHeader.slice('Bearer '.length)

  let productId: string | undefined
  try {
    ;({ productId } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }
  if (!productId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'productId is required' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, company_id, name')
    .eq('id', productId)
    .single()

  if (productError || !product) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Product not found or access denied' }),
    }
  }

  const { data: docs, error: docsError } = await supabase
    .from('product_documents')
    .select('storage_path, file_name, content_type')
    .eq('product_id', productId)

  if (docsError) {
    return { statusCode: 500, body: JSON.stringify({ error: docsError.message }) }
  }
  if (!docs || docs.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Upload at least one document first' }),
    }
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: EXTRACTION_PROMPT },
  ]

  for (const doc of docs) {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('product-documents')
      .download(doc.storage_path)
    if (downloadError || !fileBlob) continue
    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    parts.push({
      inlineData: {
        mimeType: doc.content_type || 'application/octet-stream',
        data: buffer.toString('base64'),
      },
    })
  }

  if (parts.length === 1) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not read any uploaded documents' }),
    }
  }

  const buildBody = (withThinkingOff: boolean) =>
    JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_SCHEMA,
        // Reading a form does not need a long reasoning pass, and that pass is what makes scanned
        // PDFs slow enough to hit Netlify's time limit.
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
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: buildBody(thinkingOff), signal },
      )
      if (res.ok) return (await res.json()) as Record<string, unknown>
      const text = (await res.text()).slice(0, 300)
      lastReason = `${model} ${res.status}: ${text}`
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
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: `The AI service did not answer in time. Please try again. (${errors.slice(-2).join(' | ').slice(0, 240)})`,
      }),
    }
  }

  const candidateParts = (geminiJson as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })
    .candidates?.[0]?.content?.parts
  const rawText = (candidateParts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (!rawText) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gemini returned no extractable content' }) }
  }

  let extracted: Record<string, unknown>
  try {
    extracted = postProcess(JSON.parse(rawText))
  } catch {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gemini returned malformed JSON' }) }
  }

  const { error: updateError } = await supabase
    .from('products')
    .update({ extracted_data: extracted, status: 'extracted', updated_at: new Date().toISOString() })
    .eq('id', productId)

  if (updateError) {
    return { statusCode: 500, body: JSON.stringify({ error: updateError.message }) }
  }

  return { statusCode: 200, body: JSON.stringify({ extracted_data: extracted }) }
}

// Anything unexpected becomes a readable JSON error instead of a bare gateway failure.
export const handler: Handler = async (event, context) => {
  try {
    const result = await extractHandler(event, context)
    return result ?? { statusCode: 500, body: JSON.stringify({ error: 'Empty response from the extraction function' }) }
  } catch (err) {
    console.error('extract-product crashed', err)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Extraction crashed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    }
  }
}
