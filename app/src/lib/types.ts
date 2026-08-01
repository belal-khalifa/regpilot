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
