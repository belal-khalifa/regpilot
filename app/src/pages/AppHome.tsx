import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import GlobalNav from '../components/GlobalNav'
import StatusBadge from '../components/StatusBadge'
import CreateCompanyForm from '../components/CreateCompanyForm'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useCompanies } from '../lib/useCompanies'
import { useProducts } from '../lib/useProducts'

const SELECTED_COMPANY_KEY = 'regpilot:selectedCompanyId'
const NEW_PRODUCT_NAME = 'New product'

export default function AppHome() {
  const navigate = useNavigate()
  const { session, user, loading: authLoading } = useAuth()
  const { companies, loading: companiesLoading, refresh: refreshCompanies } = useCompanies()
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [addingCompany, setAddingCompany] = useState(false)
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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
    const { error, warning } = await deleteProduct(product)
    setDeletingId(null)
    if (error) window.alert(error)
    else if (warning) window.alert(warning)
  }

  // A new product starts as an empty shell: the documents are uploaded next, and the AI reads the
  // product's name and brand out of them.
  async function handleNewProduct(companyId: string) {
    if (!user) return
    setCreatingProduct(true)
    setCreateError(null)
    const { data, error } = await supabase
      .from('products')
      .insert({ company_id: companyId, name: NEW_PRODUCT_NAME, created_by: user.id })
      .select('id')
      .single()
    setCreatingProduct(false)
    if (error) {
      setCreateError(error.message)
      return
    }
    refreshProducts()
    navigate(`/app/products/${data.id}`)
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
              <button
                type="button"
                onClick={() => handleNewProduct(selectedCompany.id)}
                disabled={creatingProduct}
                className="rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
              >
                {creatingProduct ? 'Creating…' : '+ New product'}
              </button>
            </div>

            {createError && (
              <p className="font-text text-[13px] text-status-rejected">{createError}</p>
            )}

            {productsLoading ? (
              <p className="font-text text-[15px] text-ink-muted-80">Loading products…</p>
            ) : products.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-6 py-10 text-center font-text text-[15px] text-ink-muted-48">
                No products yet. Add your first one to get started.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-hairline">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-canvas-parchment font-text text-[12px] uppercase tracking-[0.06em] text-ink-muted-48">
                      <th className="w-[64px] px-4 py-3 font-semibold">No.</th>
                      <th className="w-[28%] px-4 py-3 font-semibold">Brand</th>
                      <th className="px-4 py-3 font-semibold">Product name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const brand = (product.extracted_data as { brand_name?: string } | null)?.brand_name
                      const open = () => navigate(`/app/products/${product.id}`)
                      return (
                        <tr
                          key={product.id}
                          onClick={open}
                          onKeyDown={(e) => e.key === 'Enter' && open()}
                          tabIndex={0}
                          className="cursor-pointer border-t border-hairline transition-colors hover:bg-canvas-parchment focus:bg-canvas-parchment focus:outline-none"
                        >
                          <td className="px-4 py-4 font-text text-[15px] text-ink-muted-80">
                            {product.seq_no ?? '–'}
                          </td>
                          <td className="px-4 py-4 font-text text-[15px] text-ink">
                            {brand || <span className="text-ink-muted-48">–</span>}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 flex-col items-start gap-1">
                                <span className="font-text text-[15px] font-semibold text-ink">
                                  {product.name}
                                </span>
                                <StatusBadge status={product.status} />
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteProduct(product)
                                }}
                                disabled={deletingId === product.id}
                                className="shrink-0 font-text text-[13px] text-status-rejected disabled:opacity-60"
                              >
                                {deletingId === product.id ? 'Removing…' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
