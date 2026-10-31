import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusSelect from '../components/StatusSelect'
import ProductDocumentsPanel from '../components/ProductDocumentsPanel'
import ExtractionReviewForm from '../components/ExtractionReviewForm'
import MontajiFillPanel from '../components/MontajiFillPanel'
import AppChat from '../components/AppChat'
import RegulatoryCheckPanel from '../components/RegulatoryCheckPanel'
import { supabase } from '../lib/supabase'
import { documentWarnings as montajiDocumentWarnings } from '../lib/montajiFields'
import { documentChecklist } from '../lib/documentChecklist'
import { useProductDocuments } from '../lib/useProductDocuments'
import type { ExtractedProductData, Product, ProductStatus } from '../lib/types'

// Extraction runs as a Supabase Edge Function on the same project as the database.
const EXTRACT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-product`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

// The red box above the review form: the existing document checks plus "these documents seem to be
// about more than one product", which warns rather than refuses (a certificate listing a brand's whole
// range made the AI count several products when there was one).
function documentWarnings(data: ExtractedProductData): string[] {
  const warnings = montajiDocumentWarnings(data)
  const products = data.products_found ?? []
  if (products.length > 1) {
    warnings.push(
      `These documents seem to be about more than one product: ${products.join('; ')}. Each product needs its own page in RegPilot. If they really are one product, you can ignore this.`,
    )
  }
  return warnings
}

const FILLABLE_STATUSES: ProductStatus[] = ['ready_to_fill', 'submitted', 'approved', 'rejected']

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  // Documents dropped on the dashboard chat, handed to this page's chat to upload.
  const [incomingFiles] = useState<File[] | undefined>(
    () => (location.state as { chatFiles?: File[] } | null)?.chatFiles,
  )
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

  async function loadProduct() {
    if (!id) return
    setLoading(true)
    const { data, error } = await supabase.from('products').select('*').eq('id', id).single()
    if (error) setError(error.message)
    else setProduct(data as Product)
    setLoading(false)
  }

  useEffect(() => {
    loadProduct()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Forget the handed-over files once taken, so reloading the page does not upload them again.
  useEffect(() => {
    if (incomingFiles) navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Returns whether the reading finished, so the chat knows to explain the result.
  async function handleExtract(): Promise<boolean> {
    if (!id) return false
    if (product && product.status !== 'draft') {
      const proceed = window.confirm(
        'This product already has extracted or edited data. Re-running extraction will overwrite it with a fresh AI read of the current documents. Continue?',
      )
      if (!proceed) return false
    }
    setExtracting(true)
    setExtractError(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setExtractError('Your session expired — please sign in again.')
      setExtracting(false)
      return false
    }
    let finished = false
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
      let body: { error?: string } = {}
      try {
        body = JSON.parse(text)
      } catch {
        // not JSON: a gateway or timeout page
      }
      if (!res.ok) {
        setExtractError(
          body.error ||
            `The extraction service answered with an error (HTTP ${res.status}). ${text.replace(/<[^>]*>/g, ' ').trim().slice(0, 160)}`,
        )
      } else if (!body.error) {
        await loadProduct()
        finished = true
      } else {
        setExtractError(body.error)
      }
    } catch {
      // The connection dropped, often because a phone locked or the person switched apps. The reading
      // carries on on the server, so look again shortly instead of reporting a hard failure.
      setExtractError(
        'The connection dropped while the documents were being read (this happens if the phone locks or you switch apps). The reading may still finish: this page checks again in a minute.',
      )
      setTimeout(() => {
        loadProduct()
        refreshDocuments()
      }, 60_000)
    }
    setExtracting(false)
    return finished
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

  // What the page itself flags, given to the chat so its summary says the same thing.
  const chatFacts =
    product && product.status !== 'draft'
      ? [
          ...documentChecklist(documents, extractedData ?? {})
            .filter((item) => item.files.length === 0)
            .map((item) => `Missing document: ${item.label}. ${item.hint}`),
          ...documentWarnings(extractedData ?? {}),
        ]
      : []

  function scrollToReviewAndFill() {
    const target = document.getElementById('montaji-fill') ?? document.getElementById('review-form')
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
                <div id="review-form" className="scroll-mt-6">
                  <ExtractionReviewForm
                    key={product.updated_at}
                    initialData={extractedData ?? {}}
                    onSave={handleSaveReview}
                  />
                </div>
              )}

              {product.status !== 'draft' && (
                <RegulatoryCheckPanel productId={product.id} canRun={!extracting} />
              )}

              {FILLABLE_STATUSES.includes(product.status) && (
                <div id="montaji-fill" className="scroll-mt-6">
                  <MontajiFillPanel
                    productName={product.name}
                    data={extractedData ?? {}}
                    documents={documents}
                  />
                </div>
              )}

              <AppChat
                companyId={product.company_id}
                product={product}
                documents={documents}
                facts={chatFacts}
                reading={extracting}
                incomingFiles={incomingFiles}
                onFiles={handleDroppedFiles}
                onRead={handleExtract}
                onReviewAndFill={scrollToReviewAndFill}
              />
            </>
          )}
        </div>
      </section>
    </div>
  )
}
