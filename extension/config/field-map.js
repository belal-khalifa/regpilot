// ⚠️ PLACEHOLDER — this file does not work yet.
//
// A live walkthrough of the real Montaji production portal is in progress —
// see ../MONTAJI_WALKTHROUGH_NOTES.md for everything learned so far (resume
// point, real selector patterns, Mendix-specific gotchas) before continuing
// this file. Selectors below are still stand-ins pending Step 4/5 of the
// wizard (ingredients, label artwork, acknowledgement) and a decision on the
// Category/Sub-Category taxonomy question documented there.
//
// Mendix quirk (see notes doc for detail): plain input ids have an UNSTABLE
// runtime suffix — use `[id^="stable.prefix"]` starts-with selectors, never
// an exact id. Some widgets instead carry a stable `mx-name-<name>` class on
// their wrapper, which is preferable when present.
//
// This is a plain script (not an ES module) so it can load as a classic
// content script alongside fill-engine.js and montaji-filler.js, sharing
// one global scope — simplest, most compatible option for an unpacked
// extension.

const MONTAJI_FIELD_MAP = {
  // Simple text fields: one RegPilot field -> one Montaji input selector.
  product_name: 'TODO_SELECTOR_product_name',
  product_type: 'TODO_SELECTOR_product_type',
  manufacturer_name: 'TODO_SELECTOR_manufacturer_name',
  manufacturer_country: 'TODO_SELECTOR_manufacturer_country',
  manufacturer_address: 'TODO_SELECTOR_manufacturer_address',
  certificate_number: 'TODO_SELECTOR_certificate_number',
  certificate_issuing_country: 'TODO_SELECTOR_certificate_issuing_country',
  // label_claims is an array — joined with ", " before filling, unless
  // Montaji has its own repeating list/checkbox UI for claims, in which
  // case this needs custom handling like ingredients below.
  label_claims: 'TODO_SELECTOR_label_claims',
}

// Ingredients are very likely a repeating table/row structure on Montaji
// (one row per ingredient, with an "add row" button) rather than a single
// field. That can't be mapped with a simple selector — it needs real
// row-adding logic once we've seen the actual markup. Leaving this as an
// explicit placeholder rather than guessing a structure that would
// silently fill the wrong thing.
const MONTAJI_INGREDIENTS_CONFIG = {
  // Example of what this will likely need to become:
  // addRowButtonSelector: '#TODO_add_ingredient_row_button',
  // rowSelector: '.TODO_ingredient_row',
  // nameFieldSelector: '.TODO_ingredient_row input[name="inciName"]',
  // percentageFieldSelector: '.TODO_ingredient_row input[name="percentage"]',
  implemented: false,
}

const MONTAJI_READY = false // flip to true once selectors above are real
