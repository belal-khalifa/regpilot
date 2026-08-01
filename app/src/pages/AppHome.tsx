import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusBadge from '../components/StatusBadge'
import CreateCompanyForm from '../components/CreateCompanyForm'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useCompanies } from '../lib/useCompanies'
import { useProducts } from '../lib/useProducts'

const SELECTED_COMPANY_KEY = 'regpilot:selectedCompanyId'

function NewProductForm({
  companyId,
  onCreated,
  onCancel,
}: {
  companyId: string
  onCreated: (productId: string) => void
  onCancel: () => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !name.trim()) return
    setSubmitting(true)
    setError(null)
    const { data, error } = await supabase
      .from('products')
      .insert({ company_id: companyId, name: name.trim(), created_by: user.id })
      .select('id')
      .single()
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    onCreated(data.id)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas-parchment p-5 sm:flex-row sm:items-center"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Product name"
        autoFocus
        className="flex-1 rounded-full border border-hairline bg-canvas px-5 py-3 font-text text-[15px] text-ink outline-none focus:border-primary"
        required
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
        >
          {submitting ? 'Adding…' : 'Add product'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-hairline px-[18px] py-[10px] font-text text-[15px] text-ink-muted-80 active:scale-95 transition-transform"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="font-text text-[13px] text-status-rejected sm:basis-full">{error}</p>
      )}
    </form>
  )
}

export default function AppHome() {
  const navigate = useNavigate()
  const { session, user, loading: authLoading } = useAuth()
  const { companies, loading: companiesLoading, refresh: refreshCompanies } = useCompanies()
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [addingCompany, setAddingCompany] = useState(false)
  const [addingProduct, setAddingProduct] = useState(false)

  useEffect(() => {
    if (companies.length === 0) return
    const stored = localStorage.getItem(SELECTED_COMPANY_KEY)
    const stillValid = companies.some((c) => c.id === stored)
    if (stillValid) {
      setSelectedCompanyId(stored)
    } else {
      setSelectedCompanyId(companies[0].id)
    }
  }, [companies])

  function selectCompany(id: string) {
    setSelectedCompanyId(id)
    localStorage.setItem(SELECTED_COMPANY_KEY, id)
  }

  const {
    products,
    loading: productsLoading,
    refresh: refreshProducts,
    deleteProduct,
  } = useProducts(selectedCompanyId)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDeleteProduct(product: { id: string; name: string }) {
    if (!window.confirm(`Delete "${product.name}"? This also removes its uploaded documents.`)) {
      return
    }
    setDeletingId(product.id)
    const { error } = await deleteProduct(product)
    setDeletingId(null)
    if (error) window.alert(error)
  }

  if (!authLoading && !session) {
    return <Navigate to="/login" replace />
  }

  if (authLoading || companiesLoading) {
    return (
      <div>
        <GlobalNav />
        <section className="bg-canvas px-6 py-24 text-center">
          <p className="font-text text-[17px] text-ink-muted-80">Loading…</p>
        </section>
      </div>
    )
  }

  if (companies.length === 0) {
    return (
      <div>
        <GlobalNav />
        <section className="bg-canvas px-6 py-24">
          <CreateCompanyForm onCreated={refreshCompanies} />
        </section>
      </div>
    )
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0]

  return (
    <div>
      <GlobalNav />
      <section className="bg-canvas px-6 py-16">
        <div className="mx-auto flex max-w-[720px] flex-col gap-8">
          <div>
            <p className="font-display text-[13px] font-semibold tracking-[0.231px] text-primary">
              Signed in as {user?.email}
            </p>
            <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.28px] text-ink">
              {selectedCompany.name}
            </h1>
          </div>

          {companies.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCompany(c.id)}
                  className={`rounded-full border px-4 py-2 font-text text-[14px] transition-colors ${
                    c.id === selectedCompany.id
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-hairline text-ink-muted-80'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {addingCompany ? (
            <div className="rounded-lg border border-hairline p-6">
              <CreateCompanyForm
                title="Add another company"
                description="For consultants managing more than one client."
                onCreated={() => {
                  setAddingCompany(false)
                  refreshCompanies()
                }}
              />
              <button
                type="button"
                onClick={() => setAddingCompany(false)}
                className="mx-auto mt-4 block font-text text-[14px] text-ink-muted-48"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCompany(true)}
              className="self-start font-text text-[14px] text-primary"
            >
              + Add another company
            </button>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[21px] font-semibold tracking-[0.231px] text-ink">
                Products
              </h2>
              {!addingProduct && (
                <button
                  type="button"
                  onClick={() => setAddingProduct(true)}
                  className="rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform"
                >
                  + New product
                </button>
              )}
            </div>

            {addingProduct && (
              <NewProductForm
                companyId={selectedCompany.id}
                onCreated={(productId) => {
                  setAddingProduct(false)
                  refreshProducts()
                  navigate(`/app/products/${productId}`)
                }}
                onCancel={() => setAddingProduct(false)}
              />
            )}

            {productsLoading ? (
              <p className="font-text text-[15px] text-ink-muted-80">Loading products…</p>
            ) : products.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-6 py-10 text-center font-text text-[15px] text-ink-muted-48">
                No products yet. Add your first one to get started.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {products.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas pr-4 transition-colors hover:border-primary"
                  >
                    <Link
                      to={`/app/products/${product.id}`}
                      className="flex flex-1 items-center justify-between gap-3 px-6 py-5"
                    >
                      <span className="font-text text-[17px] font-semibold text-ink">
                        {product.name}
                      </span>
                      <StatusBadge status={product.status} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDeleteProduct(product)}
                      disabled={deletingId === product.id}
                      className="shrink-0 font-text text-[13px] text-status-rejected disabled:opacity-60"
                    >
                      {deletingId === product.id ? 'Removing…' : 'Delete'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
