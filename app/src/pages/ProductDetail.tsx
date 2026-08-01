import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusBadge from '../components/StatusBadge'
import DocumentUploadSection from '../components/DocumentUploadSection'
import { supabase } from '../lib/supabase'
import { useProductDocuments } from '../lib/useProductDocuments'
import type { DocumentType, ExtractedProductData, Product } from '../lib/types'

const DOC_TYPES: DocumentType[] = [
  'formula_ingredient_list',
  'certificate_free_sale',
  'label_artwork',
]

function ExtractionSummary({ data }: { data: ExtractedProductData }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-canvas-parchment p-6">
      <p className="font-text text-[13px] font-semibold uppercase tracking-[0.231px] text-status-extracted">
        AI-extracted draft — review before use
      </p>
      <dl className="flex flex-col gap-3">
        {data.product_name && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">Product name</dt>
            <dd className="font-text text-[15px] text-ink">{data.product_name}</dd>
          </div>
        )}
        {data.product_type && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">Product type</dt>
            <dd className="font-text text-[15px] text-ink">{data.product_type}</dd>
          </div>
        )}
        {data.ingredients && data.ingredients.length > 0 && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">
              Ingredients ({data.ingredients.length})
            </dt>
            <dd className="font-text text-[15px] text-ink">
              {data.ingredients
                .slice(0, 6)
                .map((i) => i.inci_name)
                .join(', ')}
              {data.ingredients.length > 6 ? ', …' : ''}
            </dd>
          </div>
        )}
        {data.manufacturer_name && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">Manufacturer</dt>
            <dd className="font-text text-[15px] text-ink">
              {data.manufacturer_name}
              {data.manufacturer_country ? `, ${data.manufacturer_country}` : ''}
            </dd>
          </div>
        )}
        {data.label_claims && data.label_claims.length > 0 && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">Label claims</dt>
            <dd className="font-text text-[15px] text-ink">{data.label_claims.join(', ')}</dd>
          </div>
        )}
        {data.notes && (
          <div>
            <dt className="font-text text-[12px] text-ink-muted-48">Notes for review</dt>
            <dd className="font-text text-[15px] text-ink">{data.notes}</dd>
          </div>
        )}
      </dl>
      <p className="font-text text-[13px] text-ink-muted-48">
        A full editable review screen is coming next — for now this is a read-only preview.
      </p>
    </div>
  )
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

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
      const body = await res.json()
      if (!res.ok) {
        setExtractError(body.error || 'Extraction failed.')
      } else {
        loadProduct()
      }
    } catch {
      setExtractError('Could not reach the extraction service.')
    }
    setExtracting(false)
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
                <StatusBadge status={product.status} />
              </div>

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

              {extractedData && Object.keys(extractedData).length > 0 && (
                <ExtractionSummary data={extractedData} />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
