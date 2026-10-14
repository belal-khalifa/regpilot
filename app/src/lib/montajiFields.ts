import { MONTAJI_TAXONOMY } from './montajiTaxonomy'

// Option values exactly as Montaji's "Weight / Volume Unit" select submits them.
export const VOLUME_UNITS = [
  'ML',
  'Caplet',
  'Capsules',
  'Gummies',
  'Kg',
  'L',
  'Others',
  'Powder',
  'Soft_Gel',
  'Tablets',
  'g',
  'mg',
] as const

// Option values exactly as Montaji's "Shelf Life Period Type" select submits them.
export const SHELF_LIFE_PERIOD_TYPES = ['Days', 'weeks', 'Months', 'Years'] as const

export const CLASSIFICATION_CONFIDENCE = ['high', 'medium', 'low'] as const
export type ClassificationConfidence = (typeof CLASSIFICATION_CONFIDENCE)[number]

export const MONTAJI_GROUPS = Object.keys(MONTAJI_TAXONOMY)

export const MONTAJI_CATEGORIES = Array.from(
  new Set(Object.values(MONTAJI_TAXONOMY).flatMap((cats) => Object.keys(cats))),
)

export const MONTAJI_SUB_CATEGORIES = Array.from(
  new Set(Object.values(MONTAJI_TAXONOMY).flatMap((cats) => Object.values(cats).flat())),
)

export function categoriesForGroup(group: string | undefined): string[] {
  return group && MONTAJI_TAXONOMY[group] ? Object.keys(MONTAJI_TAXONOMY[group]) : []
}

export function subCategoriesFor(group: string | undefined, category: string | undefined): string[] {
  if (!group || !category) return []
  return MONTAJI_TAXONOMY[group]?.[category] ?? []
}

export type Classification = {
  montaji_group?: string
  montaji_category?: string
  montaji_sub_category?: string
  classification_confidence?: ClassificationConfidence
}

// The model is constrained to real Montaji values, but it can still pick a combination that does not
// exist (e.g. a Fragrances category under the Cosmetics group). Anything that is not a real
// Group -> Category -> Sub-Category path is dropped and the confidence is forced to "low" so the
// review screen flags it for a human rather than letting it through.
export function validateClassification(input: Classification): Classification {
  const group = input.montaji_group
  const category = input.montaji_category
  if (!group || !category || !MONTAJI_TAXONOMY[group]?.[category]) {
    return { classification_confidence: 'low' }
  }
  const allowed = MONTAJI_TAXONOMY[group][category]
  let sub = input.montaji_sub_category
  let confidence = input.classification_confidence ?? 'low'
  if (!sub || !allowed.includes(sub)) {
    sub = allowed.includes('Undefined') ? 'Undefined' : allowed[0]
    if (allowed.length > 1) confidence = confidence === 'high' ? 'medium' : confidence
  }
  return {
    montaji_group: group,
    montaji_category: category,
    montaji_sub_category: sub,
    classification_confidence: confidence,
  }
}

type ReadinessInput = {
  product_name?: string
  brand_name?: string
  country_of_origin?: string
  montaji_group?: string
  montaji_category?: string
  classification_confidence?: ClassificationConfidence
  variants?: Array<{
    barcode?: string
    color_shade?: string
    scent_flavor?: string
    size_volume?: string
    volume_unit?: string
  }>
  ingredients?: Array<{ inci_name: string; percentage?: string }>
  has_production_date?: boolean
  has_expiry_date?: boolean
  has_batch_number?: boolean
  has_period_after_opening?: boolean
}

// What Montaji will refuse or stop on if it is still missing when the extension fills the form.
// These are reminders for the person reviewing, not blockers: they can still save and fix on Montaji.
export function montajiReadinessIssues(data: ReadinessInput): string[] {
  const issues: string[] = []
  if (!data.product_name) issues.push('Product name is missing.')
  if (!data.brand_name) issues.push('Brand name is missing.')
  if (!data.country_of_origin) issues.push('Country of origin is missing.')
  if (!data.montaji_group || !data.montaji_category) {
    issues.push('Montaji classification (group and category) is not set.')
  } else if (data.classification_confidence === 'low') {
    issues.push('Montaji classification is a low-confidence guess. Please confirm it.')
  }

  const variants = data.variants ?? []
  variants.forEach((v, i) => {
    const label = variants.length > 1 ? `Variant ${i + 1}` : 'The variant'
    if (!v.barcode) issues.push(`${label}: barcode is missing.`)
    if (!v.size_volume || !v.volume_unit) issues.push(`${label}: size and unit are required.`)
    const shade = (v.color_shade ?? '').trim().toUpperCase()
    const scent = (v.scent_flavor ?? '').trim().toUpperCase()
    if (!shade || !scent) issues.push(`${label}: shade and scent are required (use NA if none).`)
  })

  const ingredients = data.ingredients ?? []
  if (ingredients.length === 0) {
    issues.push('No ingredients found. Montaji needs at least one with a percentage.')
  } else {
    const missing = ingredients.filter((i) => !String(i.percentage ?? '').trim()).length
    if (missing > 0) {
      issues.push(
        `${missing} ingredient${missing === 1 ? '' : 's'} without a percentage. Montaji rejects the import unless every row has one; they will be left for you to add by hand.`,
      )
    }
  }

  const flags = [
    data.has_production_date,
    data.has_expiry_date,
    data.has_batch_number,
    data.has_period_after_opening,
  ]
  if (flags.some((f) => f === undefined)) {
    issues.push('Production date, expiry date, batch number and period-after-opening: answer Yes or No for each.')
  }
  return issues
}
