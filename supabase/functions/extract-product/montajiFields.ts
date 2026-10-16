// COPY of app/src/lib/montajiFields.ts - do not edit here. Run scripts/sync-supabase-shared.sh.
import { MONTAJI_TAXONOMY } from './montajiTaxonomy.ts'

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

