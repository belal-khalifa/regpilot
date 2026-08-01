import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusBadge from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
  }, [id])

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-16">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6">
          <Link to="/app" className="font-text text-[14px] text-primary">
            ← Back to dashboard
          </Link>

          {loading && <p className="font-text text-[17px] text-ink-muted-80">Loading…</p>}
          {error && (
            <p className="font-text text-[14px] text-status-rejected">{error}</p>
          )}

          {product && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
                  {product.name}
                </h1>
                <StatusBadge status={product.status} />
              </div>
              <div className="rounded-lg border border-hairline bg-canvas-parchment px-6 py-8 text-center">
                <p className="font-text text-[17px] leading-[1.47] text-ink-muted-80">
                  Document upload and AI extraction are coming in the next piece. Once that's
                  built, you'll upload the formula/ingredient list, Certificate of Free Sale, and
                  label artwork here, and RegPilot will draft the product record for you.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
