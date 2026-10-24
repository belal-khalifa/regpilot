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
  // Internal RegPilot number, counted per company (1, 2, 3 ...).
  seq_no: number | null
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

// 'unsorted' is a file dropped without a type; extraction works out what it is (document_inventory).
export type DocumentType =
  | 'formula_ingredient_list'
  | 'certificate_free_sale'
  | 'label_artwork'
  | 'unsorted'

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  formula_ingredient_list: 'Formula / ingredient list',
  certificate_free_sale: 'Certificate of Free Sale / manufacturer docs',
  label_artwork: 'Label artwork',
  unsorted: 'Not sorted yet',
}

// What extraction decided each dropped file is.
export type DocumentKind =
  | 'formula'
  | 'certificate_free_sale'
  | 'gmp_certificate'
  | 'label_artwork'
  | 'other_supporting'
  | 'unrelated'

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  formula: 'Formula / ingredient list',
  certificate_free_sale: 'Certificate of Free Sale',
  gmp_certificate: 'GMP certificate',
  label_artwork: 'Label artwork',
  other_supporting: 'Other supporting document',
  unrelated: 'Not needed (not used)',
}

export type DocumentInventoryEntry = {
  file_name: string
  kind: DocumentKind
  product_named?: string
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

// One sellable variant under a product. Montaji registers each shade / scent / size as its own
// variant with its own barcode, so a product with shades 126 and 128 has two of these.
export type ExtractedVariant = {
  barcode?: string
  // The manufacturer's own shade designation (a code, number or name such as "126" or "Rose 04"),
  // never a generic description of the visible colour ("red", "pink"). "NA" when the product has none.
  color_shade?: string
  // The manufacturer's own scent or flavour name. "NA" when the product has none.
  scent_flavor?: string
  size_volume?: string
  volume_unit?: string
}

export type ExtractedProductData = {
  product_name?: string
  product_type?: string
  brand_name?: string
  country_of_origin?: string
  ingredients?: ExtractedIngredient[]
  manufacturer_name?: string
  manufacturer_country?: string
  manufacturer_address?: string
  certificate_number?: string
  certificate_issuing_country?: string
  label_claims?: string[]
  // Whether the Certificate of Free Sale names this product (a close match counts).
  certificate_product_match?: 'yes' | 'no' | 'not_applicable' | 'no_certificate'
  certificate_matched_text?: string
  certificate_products_listed?: string[]
  // Documents (formula, composition, analysis...) that are about a different product than the label.
  document_mismatches?: Array<{ file_name: string; product_named: string }>
  variants?: ExtractedVariant[]
  // One entry per uploaded file: what it is. Filled for every extraction run.
  document_inventory?: DocumentInventoryEntry[]
  // The distinct products the documents are about; more than one shows a warning.
  products_found?: string[]
  shelf_life?: string
  shelf_life_period_type?: string
  has_production_date?: boolean
  has_expiry_date?: boolean
  has_batch_number?: boolean
  has_period_after_opening?: boolean
  montaji_group?: string
  montaji_category?: string
  montaji_sub_category?: string
  classification_confidence?: 'high' | 'medium' | 'low'
  notes?: string
}
