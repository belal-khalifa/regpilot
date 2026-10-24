import type {
  DocumentInventoryEntry,
  DocumentKind,
  DocumentType,
  ExtractedProductData,
  ProductDocument,
} from './types'

// What a cosmetics registration on Montaji needs, and which of the uploaded files covers each need.

const isUae = (c: string | undefined) => /^(uae|u\.a\.e\.?|united arab emirates)$/i.test((c ?? '').trim())

const KIND_FROM_TYPE: Record<DocumentType, DocumentKind | null> = {
  formula_ingredient_list: 'formula',
  certificate_free_sale: 'certificate_free_sale',
  label_artwork: 'label_artwork',
  unsorted: null,
}

// The Filling tool knows the three original types only, so a sorted file is handed over as one of them.
const TYPE_FROM_KIND: Record<DocumentKind, DocumentType | null> = {
  formula: 'formula_ingredient_list',
  certificate_free_sale: 'certificate_free_sale',
  gmp_certificate: 'certificate_free_sale',
  label_artwork: 'label_artwork',
  other_supporting: null,
  unrelated: null,
}

function inventoryEntry(doc: ProductDocument, inventory: DocumentInventoryEntry[] | undefined) {
  return inventory?.find((e) => e.file_name === doc.file_name)
}

// What the file is: the AI's answer for a dropped file, or the slot it was uploaded into.
export function documentKind(
  doc: ProductDocument,
  inventory: DocumentInventoryEntry[] | undefined,
): DocumentKind | null {
  return inventoryEntry(doc, inventory)?.kind ?? KIND_FROM_TYPE[doc.doc_type]
}

export function effectiveDocType(
  doc: ProductDocument,
  inventory: DocumentInventoryEntry[] | undefined,
): DocumentType {
  if (doc.doc_type !== 'unsorted') return doc.doc_type
  const kind = inventoryEntry(doc, inventory)?.kind
  return (kind && TYPE_FROM_KIND[kind]) || 'unsorted'
}

export type ChecklistItem = { label: string; hint: string; files: string[] }

export function documentChecklist(
  documents: ProductDocument[],
  data: ExtractedProductData,
): ChecklistItem[] {
  const filesOf = (...kinds: DocumentKind[]) =>
    documents
      .filter((d) => {
        const kind = documentKind(d, data.document_inventory)
        return kind !== null && kinds.includes(kind)
      })
      .map((d) => d.file_name)

  const country = (data.country_of_origin ?? '').trim()
  let certificate: ChecklistItem
  if (!country) {
    certificate = {
      label: 'Certificate of Free Sale or GMP certificate',
      hint: 'Free Sale for products made outside the UAE, GMP for products made in the UAE.',
      files: filesOf('certificate_free_sale', 'gmp_certificate'),
    }
  } else if (isUae(country)) {
    certificate = {
      label: 'GMP certificate',
      hint: 'Made in the UAE, so Montaji asks for the factory’s GMP certificate.',
      // A file put in the old certificate slot by hand may be either certificate, so it counts too.
      files: [
        ...filesOf('gmp_certificate'),
        ...documents
          .filter((d) => d.doc_type === 'certificate_free_sale' && !inventoryEntry(d, data.document_inventory))
          .map((d) => d.file_name),
      ],
    }
  } else {
    certificate = {
      label: 'Certificate of Free Sale',
      hint: `Made in ${country}, so Montaji asks for a Certificate of Free Sale.`,
      files: filesOf('certificate_free_sale'),
    }
  }

  return [
    {
      label: 'Formula / ingredient list',
      hint: 'The full ingredient list with percentages.',
      files: filesOf('formula'),
    },
    {
      label: 'Label artwork',
      hint: 'The product label or packaging design.',
      files: filesOf('label_artwork'),
    },
    certificate,
  ]
}
