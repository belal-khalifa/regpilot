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

  return { products, loading, error, refresh }
}
