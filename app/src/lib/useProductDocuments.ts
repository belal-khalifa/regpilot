import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthProvider'
import type { DocumentType, ProductDocument } from './types'

export function useProductDocuments(companyId: string | null, productId: string | undefined) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<ProductDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!productId) {
      setDocuments([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('product_documents')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true })

    if (error) setError(error.message)
    else {
      setError(null)
      setDocuments((data ?? []) as ProductDocument[])
    }
    setLoading(false)
  }, [productId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function uploadDocument(
    docType: DocumentType,
    file: File,
    options?: { skipRefresh?: boolean },
  ): Promise<{ error: string | null; document?: ProductDocument }> {
    if (!companyId || !productId || !user) return { error: 'Not ready yet' }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${companyId}/${productId}/${docType}-${Date.now()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('product-documents')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (uploadError) return { error: uploadError.message }

    const { data: inserted, error: insertError } = await supabase
      .from('product_documents')
      .insert({
        product_id: productId,
        doc_type: docType,
        storage_path: path,
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        uploaded_by: user.id,
      })
      .select('*')
      .single()
    if (insertError) {
      // The record failed, so the file would be orphaned: take it back out.
      await supabase.storage.from('product-documents').remove([path])
      return { error: insertError.message }
    }

    if (!options?.skipRefresh) await refresh()
    return { error: null, document: inserted as ProductDocument }
  }

  async function deleteDocument(doc: ProductDocument, options?: { skipRefresh?: boolean }) {
    await supabase.storage.from('product-documents').remove([doc.storage_path])
    const { error } = await supabase.from('product_documents').delete().eq('id', doc.id)
    if (error) return { error: error.message }
    if (!options?.skipRefresh) await refresh()
    return { error: null }
  }

  return { documents, loading, error, refresh, uploadDocument, deleteDocument }
}
