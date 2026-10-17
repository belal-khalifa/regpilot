import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Product } from './types'

export function useProducts(companyId: string | null) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!companyId) {
      setProducts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setError(null)
      setProducts((data ?? []) as Product[])
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function deleteProduct(product: Pick<Product, 'id'>) {
    const { data: docs, error: docsError } = await supabase
      .from('product_documents')
      .select('storage_path')
      .eq('product_id', product.id)
    if (docsError) return { error: docsError.message }

    // Delete the product first (its document records go with it). If that fails nothing is lost; if
    // removing the files fails afterwards, only stray files are left, never a product without files.
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id)
    if (deleteError) return { error: deleteError.message }

    if (docs && docs.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('product-documents')
        .remove(docs.map((d) => d.storage_path))
      if (storageError) console.error('Could not remove some files of a deleted product', storageError.message)
    }

    await refresh()
    return { error: null }
  }

  return { products, loading, error, refresh, deleteProduct }
}
