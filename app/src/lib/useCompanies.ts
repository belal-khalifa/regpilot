import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthProvider'

export type Company = {
  id: string
  name: string
  created_by: string
  created_at: string
}

export function useCompanies() {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setCompanies([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, created_by, created_at')
      .order('created_at', { ascending: true })

    if (error) {
      setError(error.message)
    } else {
      setError(null)
      setCompanies(data ?? [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { companies, loading, error, refresh }
}
