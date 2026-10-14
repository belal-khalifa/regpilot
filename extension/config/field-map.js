// RegPilot extension - where each reviewed value goes on Montaji's CPRE form.
//
// Everything here was captured from the live production form; the evidence and the reasoning
// behind each choice is in ../MONTAJI_WALKTHROUGH_NOTES.md. Plain script (not a module) so it
// shares one global scope with fill-engine.js and montaji-filler.js.
//
// Mendix input ids look like "409.Services.<Page>.<widget>_<3 letters>_<number>". The numeric
// module prefix and the trailing suffix both change, so a widget is identified by the stable
// "<Page>.<widget>" part only (see RegPilot.findInput). Some widgets also carry a stable
// "mx-name-<widget>" class on their wrapper, which is used where available.

globalThis.RegPilot = globalThis.RegPilot || {}

globalThis.RegPilot.FIELDS = {
  // Step 2 - "New Product Base Information"
  productBase: {
    page: 'CPRE_ProductBase_Edit',
    name: 'textBox1',
    brandOther: 'textBox5',
    // Searchable (Select2) dropdowns, identified by their stable wrapper class.
    countryOfOrigin: 'mx-name-autoCompleteForMendix1',
    group: 'mx-name-autoCompleteForMendix4',
    category: 'mx-name-autoCompleteForMendix2',
    subCategory: 'mx-name-autoCompleteForMendix3',
  },

  // Step 4 - "Sub Variant Information"
  variant: {
    page: 'CPRE_Reg_ProductInformation',
    barcode: 'textBox6',
    variantName: 'textBox19',
    colorShade: 'textBox20',
    sizeVolume: 'textBox23',
    volumeUnit: 'dropDown7', // native <select>, values like ML / Kg / Soft_Gel
    scentFlavor: 'textBox22',
    hasProductionDate: 'radioButtons4', // radios with values Yes / No
    hasExpiryDate: 'radioButtons3',
    hasBatchNumber: 'radioButtons1',
    shelfLife: 'textBox24',
    shelfLifePeriod: 'dropDown8', // native <select>: Days / weeks / Months / Years
    hasPeriodAfterOpening: 'radioButtons5',
  },

  // Step 4 - the "Product Ingredients" popup opened by the Ingredients grid's "New" button
  ingredient: {
    page: 'CPRE_Ingredient',
    otherName: 'textBox1',
    weight: 'textBox2',
    percentage: 'textBox3',
    autocomplete: 'mx-name-autoCompleteForMendix2', // scoped to the open popup
    otherOption: '***Other***',
  },
}

// Document upload sections on the Attachments step (certificate) and at the bottom of the variant
// form (artwork, ingredients report). Each is found by its visible heading, then its own "Upload"
// button, so no Mendix widget ids are involved. Patterns are matched against the heading text with
// asterisks and colons removed.
globalThis.RegPilot.ATTACHMENT_SLOTS = {
  freeSale: { label: 'Free Sales Certificate', pattern: /^free sales?( certificate)?$/i },
  gmp: { label: 'GMP certificate', pattern: /^(gmp|good manufacturing practices?)( certificate)?$/i },
  artwork: { label: 'Artwork', pattern: /^artwork$/i },
  ingredientsReport: { label: 'Ingredients Report', pattern: /^ingredients? report$/i },
}

// Plain-English country names an AI or a label might use, mapped to the spelling Montaji lists.
// Anything not covered falls back to a contains-match and, failing that, is left for the person.
globalThis.RegPilot.COUNTRY_ALIASES = {
  uae: 'united arab emirates',
  'u.a.e': 'united arab emirates',
  'u.a.e.': 'united arab emirates',
  emirates: 'united arab emirates',
  usa: 'united states',
  'u.s.a': 'united states',
  'u.s.a.': 'united states',
  us: 'united states',
  'united states of america': 'united states',
  america: 'united states',
  uk: 'united kingdom',
  'u.k.': 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  korea: 'south korea',
  'republic of korea': 'south korea',
  russia: 'russian federation',
  'viet nam': 'vietnam',
}

// Buttons this extension must never press. The person submits, not the extension.
globalThis.RegPilot.FORBIDDEN_BUTTONS = ['submit', 'save draft', 'cancel', 'delete']
