import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string
const GEMINI_MODEL = 'gemini-flash-latest'

const EXTRACTION_PROMPT = `You are extracting structured product data from cosmetics regulatory documents (ingredient/formula lists, Certificates of Free Sale, manufacturer documents, and label artwork) to help prepare a submission to Dubai Municipality's Montaji cosmetics registration portal.

Read all the attached documents carefully and extract:
- The product's name and product type/category (e.g. "Face Serum", "Lipstick", "Body Lotion")
- The full ingredient list in INCI naming, with percentage if stated
- The manufacturer's name, country, and full address
- Any Certificate of Free Sale number and its issuing country, if present
- Notable label claims (e.g. "paraben-free", "cruelty-free", "SPF 30")
- Anything unclear, missing, or that a human reviewer should double-check, in "notes"

If a field isn't present in the documents, omit it or leave it blank rather than guessing. Respond only with the structured data.`

const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_name: { type: 'STRING' },
    product_type: { type: 'STRING' },
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
    notes: { type: 'STRING' },
  },
}

export const handler: Handler = async (event) => {
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

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA,
        },
      }),
    },
  )

  if (!geminiRes.ok) {
    const errText = await geminiRes.text()
    return {
      statusCode: 502,
      body: JSON.stringify({ error: `Gemini API error: ${errText.slice(0, 500)}` }),
    }
  }

  const geminiJson = await geminiRes.json()
  const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gemini returned no extractable content' }) }
  }

  let extracted: unknown
  try {
    extracted = JSON.parse(rawText)
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
