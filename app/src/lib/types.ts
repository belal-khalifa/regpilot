export type ProductStatus =
  | 'draft'
  | 'extracted'
  | 'ready_to_fill'
  | 'submitted'
  | 'approved'
  | 'rejected'

export type Product = {
  id: string
  company_id: string
  name: string
  status: ProductStatus
  extracted_data: Record<string, unknown>
  created_by: string
  created_at: string
  updated_at: string
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  extracted: 'Extracted',
  ready_to_fill: 'Ready to fill',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}

export type DocumentType = 'formula_ingredient_list' | 'certificate_free_sale' | 'label_artwork'

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  formula_ingredient_list: 'Formula / ingredient list',
  certificate_free_sale: 'Certificate of Free Sale / manufacturer docs',
  label_artwork: 'Label artwork',
}

export type ProductDocument = {
  id: string
  product_id: string
  doc_type: DocumentType
  storage_path: string
  file_name: string
  content_type: string
  uploaded_by: string
  created_at: string
}

export type ExtractedIngredient = {
  inci_name: string
  percentage?: string
}

export type ExtractedProductData = {
  product_name?: string
  product_type?: string
  ingredients?: ExtractedIngredient[]
  manufacturer_name?: string
  manufacturer_country?: string
  manufacturer_address?: string
  certificate_number?: string
  certificate_issuing_country?: string
  label_claims?: string[]
  notes?: string
}
