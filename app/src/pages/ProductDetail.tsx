import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusSelect from '../components/StatusSelect'
import DocumentUploadSection from '../components/DocumentUploadSection'
import ExtractionReviewForm from '../components/ExtractionReviewForm'
import MontajiFillPanel from '../components/MontajiFillPanel'
import { supabase } from '../lib/supabase'
import { useProductDocuments } from '../lib/useProductDocuments'
import type { DocumentType, ExtractedProductData, Product, ProductStatus } from '../lib/types'

const DOC_TYPES: DocumentType[] = [
  'formula_ingredient_list',
  'certificate_free_sale',
  'label_artwork',
]

const FILLABLE_STATUSES: ProductStatus[] = ['ready_to_fill', 'submitted', 'approved', 'rejected']

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const { documents, uploadDocument, deleteDocument } = useProductDocuments(
    product?.company_id ?? null,
    id,
  )

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
      const res = await fetch('/.netlify/functions/extract-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
                  Upload the documents below, then press Extract with AI. The product name and
                  brand are read from the documents.
                </p>
              )}

              <div className="flex flex-col gap-4">
                <h2 className="font-display text-[18px] font-semibold text-ink">Documents</h2>
                {DOC_TYPES.map((docType) => (
                  <DocumentUploadSection
                    key={docType}
                    docType={docType}
                    documents={documents.filter((d) => d.doc_type === docType)}
                    onUpload={uploadDocument}
                    onDelete={deleteDocument}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || documents.length === 0}
                className="w-full rounded-full bg-primary px-[22px] py-[11px] font-text text-[17px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
              >
                {extracting
                  ? 'Reading documents…'
                  : product.status === 'draft'
                    ? 'Extract with AI'
                    : 'Re-run extraction'}
              </button>
              {documents.length === 0 && (
                <p className="text-center font-text text-[13px] text-ink-muted-48">
                  Upload at least one document above to enable extraction.
                </p>
              )}
              {extractError && (
                <p className="text-center font-text text-[14px] text-status-rejected">
                  {extractError}
                </p>
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
