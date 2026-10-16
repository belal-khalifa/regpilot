// COPY of app/src/lib/montajiTaxonomy.ts - do not edit here. Run scripts/sync-supabase-shared.sh.
// Montaji's Group -> Category -> Sub-Category taxonomy, captured live from the CPRE form (2026-10-14).
// Only groups that have been crawled are listed; Detergents, Biocides and Health Supplements are
// pending the master sheet. Strings are exact as rendered by Montaji (see the three spaces in
// 'Air Fresheners   Home Fragrances').
export const MONTAJI_TAXONOMY: Record<string, Record<string, string[]>> = {
  "Cosmetics and Personal care Products": {
    "Foot Care": [
      "Undefined"
    ],
    "Make Up Products": [
      "Undefined"
    ],
    "Sunscreen & Suntan preparations": [
      "Undefined"
    ],
    "Eye Care": [
      "Undefined"
    ],
    "Hair and scalp products": [
      "Undefined",
      "Hair and scalp care and cleansing products"
    ],
    "Nail and cuticle products": [
      "Undefined"
    ],
    "Face & Neck Preparations": [
      "Undefined"
    ],
    "Baby Products": [
      "Undefined"
    ],
    "B2B Products": [
      "Undefined"
    ],
    "Hand Care": [
      "Undefined"
    ],
    "Depilatories": [
      "Undefined"
    ],
    "Lip Care": [
      "Undefined"
    ],
    "Shaving products": [
      "Undefined"
    ],
    "Body Care Preparations": [
      "Correction of body odor and/or perspiration",
      "Undefined"
    ],
    "Others": [
      "Undefined"
    ],
    "Hotel amenities": [
      "Undefined",
      "Hair Care",
      "Hand Care"
    ],
    "Oral Hygiene products": [
      "Undefined"
    ],
    "Skin Products": [
      "Undefined"
    ],
    "Professional use product": [
      "Undefined"
    ]
  },
  "Fragrances": {
    "Eau de Toilettes (EDT)": [
      "Undefined"
    ],
    "Scented Candles": [
      "Undefined"
    ],
    "Diffusers": [
      "Undefined"
    ],
    "Cologne": [
      "Undefined"
    ],
    "After shave": [
      "Undefined"
    ],
    "Splash": [
      "Undefined"
    ],
    "Concentrated oils": [
      "Undefined"
    ],
    "Eau de Perfumes (EDP)": [
      "Undefined"
    ],
    "Others": [
      "Undefined"
    ],
    "Air Fresheners   Home Fragrances": [
      "Other"
    ]
  }
}

export const MONTAJI_PENDING_GROUPS = ["Detergents", "Biocides", "Health Supplements"] as const
