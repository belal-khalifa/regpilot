import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusSelect from '../components/StatusSelect'
import ProductDocumentsPanel from '../components/ProductDocumentsPanel'
import ExtractionReviewForm from '../components/ExtractionReviewForm'
import MontajiFillPanel from '../components/MontajiFillPanel'
import { supabase } from '../lib/supabase'
import { documentWarnings } from '../lib/montajiFields'
import { useProductDocuments } from '../lib/useProductDocuments'
import type { ExtractedProductData, Product, ProductDocument, ProductStatus } from '../lib/types'

// Extraction runs as a Supabase Edge Function on the same project as the database.
const EXTRACT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-product`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const FILLABLE_STATUSES: ProductStatus[] = ['ready_to_fill', 'submitted', 'approved', 'rejected']

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const {
    documents,
    refresh: refreshDocuments,
    uploadDocument,
    deleteDocument,
  } = useProductDocuments(
    product?.company_id ?? null,
    id,
  )

  // A running seconds counter while the AI reads the documents, so the wait does not look frozen.
  useEffect(() => {
    if (!extracting) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [extracting])

  function loadProduct() {
    if (!id) return
    setLoading(true)
    supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setProduct(data as Product)
        setLoading(false)
      })
  }

  useEffect(loadProduct, [id])

  // Uploads a drop one file at a time, unsorted. Reading starts only when the person presses the button,
  // so they can add more documents for the same product first.
  async function handleDroppedFiles(files: File[], onProgress: (done: number) => void) {
    let uploaded = 0
    let failure: string | null = null
    for (const file of files) {
      const { error } = await uploadDocument('unsorted', file, { skipRefresh: true })
      if (error) {
        failure = `Could not upload ${file.name}: ${error}`
        break
      }
      uploaded += 1
      onProgress(uploaded)
    }
    await refreshDocuments()
    return { error: failure, uploaded }
  }

  async function handleExtract() {
    if (!id) return
    if (product && product.status !== 'draft') {
      const proceed = window.confirm(
        'This product already has extracted or edited data. Re-running extraction will overwrite it with a fresh AI read of the current documents. Continue?',
      )
      if (!proceed) return
    }
    setExtracting(true)
    setExtractError(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setExtractError('Your session expired — please sign in again.')
      setExtracting(false)
      return
    }
    try {
      const res = await fetch(EXTRACT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: PUBLIC_KEY,
        },
        body: JSON.stringify({ productId: id }),
      })
      const text = await res.text()
      let body: { error?: string; code?: string } = {}
      try {
        body = JSON.parse(text)
      } catch {
        // not JSON: a gateway or timeout page
      }
      if (body.code === 'multiple_products') {
        // One product per upload: documents covering several products are turned away as a whole.
        const dropped = documents.filter((d: ProductDocument) => d.doc_type === 'unsorted')
        for (const doc of dropped) await deleteDocument(doc, { skipRefresh: true })
        await refreshDocuments()
        setExtractError(
          `${body.error ?? 'These documents cover more than one product.'} The documents were removed, so you can add them again one product at a time.`,
        )
      } else if (!res.ok) {
        setExtractError(
          body.error ||
            `The extraction service answered with an error (HTTP ${res.status}). ${text.replace(/<[^>]*>/g, ' ').trim().slice(0, 160)}`,
        )
      } else if (!body.error) {
        loadProduct()
      } else {
        setExtractError(body.error)
      }
    } catch (err) {
      setExtractError(
        `Could not reach the extraction service (${err instanceof Error ? err.message : 'network error'}).`,
      )
    }
    setExtracting(false)
  }

  async function handleSaveReview(
    data: ExtractedProductData,
    options: { markReady: boolean },
  ): Promise<{ error: string | null }> {
    if (!id) return { error: 'Missing product id' }
    const update: Partial<Product> & { updated_at: string } = {
      extracted_data: data,
      updated_at: new Date().toISOString(),
    }
    if (options.markReady) update.status = 'ready_to_fill'
    // The dashboard lists the product by this name, so it follows what the reviewer confirmed.
    if (data.product_name?.trim()) update.name = data.product_name.trim()

    const { error } = await supabase.from('products').update(update).eq('id', id)
    if (error) return { error: error.message }
    loadProduct()
    return { error: null }
  }

  async function handleStatusChange(next: ProductStatus) {
    if (!id) return
    setStatusError(null)
    const { error } = await supabase
      .from('products')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) setStatusError(error.message)
    else loadProduct()
  }

  const extractedData = product?.extracted_data as ExtractedProductData | undefined

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-16">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6">
          <Link to="/app" className="font-text text-[14px] text-primary">
            ← Back to dashboard
          </Link>

          {loading && <p className="font-text text-[17px] text-ink-muted-80">Loading…</p>}
          {error && <p className="font-text text-[14px] text-status-rejected">{error}</p>}

          {product && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
                  {product.name}
                </h1>
                <StatusSelect status={product.status} onChange={handleStatusChange} />
              </div>
              {statusError && (
                <p className="font-text text-[13px] text-status-rejected">{statusError}</p>
              )}

              {product.status === 'draft' && (
                <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
                  Add the product’s documents below, then press Read documents with AI. The product
                  name and brand come from the documents.
                </p>
              )}

              <ProductDocumentsPanel
                documents={documents}
                data={extractedData ?? {}}
                sorted={product.status !== 'draft'}
                disabled={extracting}
                onFiles={handleDroppedFiles}
                onDelete={(doc) => deleteDocument(doc)}
              />

              <button
                type="button"
                onClick={() => handleExtract()}
                disabled={extracting || documents.length === 0}
                className="w-full rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
              >
                {extracting
                  ? `Reading documents… ${elapsed}s`
                  : product.status === 'draft'
                    ? 'Read documents with AI'
                    : 'Re-run extraction'}
              </button>
              {extracting && (
                <p className="text-center font-text text-[13px] text-ink-muted-48">
                  Please keep this page open; the button is turned off until it finishes so it
                  can't run twice.
                </p>
              )}
              {documents.length === 0 && (
                <p className="text-center font-text text-[13px] text-ink-muted-48">
                  Add the product’s documents above to read them.
                </p>
              )}
              {extractError && (
                <p className="text-center font-text text-[14px] text-status-rejected">
                  {extractError}
                </p>
              )}

              {product.status !== 'draft' && !extracting && documentWarnings(extractedData ?? {}).length > 0 && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-[18px] border border-status-rejected bg-status-rejected/10 px-5 py-4"
                >
                  <p className="font-text text-[15px] font-semibold text-status-rejected">
                    Check these documents before going further
                  </p>
                  {documentWarnings(extractedData ?? {}).map((text) => (
                    <p key={text} className="font-text text-[14px] leading-[1.47] text-status-rejected">
                      {text}
                    </p>
                  ))}
                </div>
              )}

              {product.status !== 'draft' && (
                <ExtractionReviewForm
                  key={product.updated_at}
                  initialData={extractedData ?? {}}
                  onSave={handleSaveReview}
                />
              )}

              {FILLABLE_STATUSES.includes(product.status) && (
                <MontajiFillPanel
                  productName={product.name}
                  data={extractedData ?? {}}
                  documents={documents}
                />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
