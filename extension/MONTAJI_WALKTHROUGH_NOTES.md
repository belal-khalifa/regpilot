# Montaji CPRE walkthrough notes (in progress)

Live walkthrough of the real Montaji production portal (`https://montajiprd.dm.gov.ae`),
done with the user driving login and Belal filling placeholder data; Claude observed
read-only via browser automation and never touched login or clicked final Submit.

**Resume point:** draft request `CPRED-041026-373608` (Consumer Product Registration,
company "BEAUTY TREND COSMETICS TRADING L.L.C"). Portal went down mid-walkthrough,
partway through Step 4. Log back in, it should still be sitting as a draft — check
"My Dashboard" or "Search Product" / request tracking ("click here" link on the form
header) to reopen it rather than starting over.

## How to reach the form
Login → left sidebar **Services** → **Consumer Product Registration (CPRE)** card
(under "Registration"). 5-step wizard: General Information → Product Base →
Attachments → Products Variants → Acknowledgement.

## Platform notes (Mendix)
- Mendix 9+, React-based under the hood — the native-setter + dispatch input/change
  events trick in `fill-engine.js` should work unchanged.
- Wizard steps are client-side (SPA) navigation, not full page loads — the Montaji
  content script will need a MutationObserver to detect step changes, not just
  `document_idle` on first load.
- **Plain `<input>`/`<select>` ids are UNSTABLE.** Pattern is
  `<module>.Services.<Page>.<widgetName>_<3 random letters>_<NN>`, e.g.
  `458.Services.CPRE_CompanyInformation_RO.textBox7_fbl_59`. Reloading the page
  changed this to `..._ocn_59` — same widget, different suffix. **Selectors must use
  `[id^="458.Services.CPRE_CompanyInformation_RO.textBox7"]` (starts-with), scoped by
  tag, never an exact id.**
- The numeric module prefix differs per page/step (seen `458` on Step 1's pages,
  `438` on Step 2's `CPRE_ProductBase_Edit` page) — don't assume one global number,
  re-check per step.
- Some custom widgets (the "AutoCompleteForMendix" searchable dropdowns) instead put
  a **stable** `mx-name-<widgetName>` class on their wrapper `<div>` — no random
  suffix. Prefer this when available (more reliable than the id pattern above).
- These autocomplete dropdowns are real Select2 (`.select2-search__field`,
  `.select2-results__option` classes confirmed) but not exposed as a global
  `$.fn.select2` — can't just set the hidden select's value + trigger change.
  **Must fill like a real user**: click wrapper to open → type into the now-visible
  `.select2-search__field` → click the matching `li.select2-results__option`.
- A draft/request number (e.g. `CPRED-041026-373608`) gets created server-side the
  moment you advance past Step 1 — normal, not a submission, but worth knowing it's
  not purely client-side from that point on.

## Step 1 — General Information
Only one field is actually editable; the rest auto-fill read-only from the company's
Montaji profile once you pick it:
- **Company*** — select, `458.Services.CPRE_General_Info_1.referenceSelector1` (plain
  `<select>`, not an autocomplete widget)
- Previous Request Number (optional, copies an old request's details)
- Read-only, auto-filled: License Number, Contact Phone, Contact Email, License
  Expiry Date, Company Name, Contact Mobile, Contact Fax, Importer Code — all
  `458.Services.CPRE_CompanyInformation_RO.*`

None of these need data from RegPilot's extraction — they're about the *trader's own*
company record, not the product's manufacturer.

## Step 2 — Product Base
First a **search grid** (Barcode, Product Name, Group, Category, ...) for finding an
existing product already in Montaji's catalog, with 4 action buttons:
- **Add Selected Variant** — register an exact existing product (found via search)
  under your own company as-is. (Montaji requires every company to register a
  product even if another company already registered the identical one.)
- **Add Variant With Copy** / **Add Variant without Copy** — create a new variant
  under a *found* existing base, either pre-filled from it or blank.
- **Add New Product Base** — brand-new product, nothing found/matching in the
  catalog. **This is RegPilot's primary case** — our users are registering their own
  products for the first time. Triggers an "Are you sure?" confirmation dialog.

**"New Product Base Information" fields** (after Add New Product Base):
- Unlabeled toggle switch near the top — purpose not yet determined, skipped per
  Belal's instruction, revisit if it turns out to matter.
- **Country of Origin*** — autocomplete, wrapper `.mx-name-autoCompleteForMendix1`
- **Name*** — text input, `438.Services.CPRE_ProductBase_Edit.textBox1`
- **Group*** — autocomplete, wrapper `.mx-name-autoCompleteForMendix4`
- **Category*** — autocomplete, wrapper `.mx-name-autoCompleteForMendix2`
- **Sub-Category*** — autocomplete, wrapper `.mx-name-autoCompleteForMendix3`
- **Brand*** — `438.Services.CPRE_ProductBase_Edit.referenceSelector2`. Rendered
  disabled/greyed initially (likely depends on Category/Sub-Category being set
  first); once enabled it accepted direct typing ("Magic" was typed straight in
  during the walkthrough) despite the arrow/picker button next to it.
- **Brand Other*** — text input, `438.Services.CPRE_ProductBase_Edit.textBox5`.
  Free-text fallback, hidden once Brand has a value. **Plan: always fill this one
  instead of trying to match Brand's catalog picker**, since matching an
  AI-extracted brand name to Montaji's exact catalog entry isn't reliable — Brand
  Other accepts anything.

Open question / likely gap: Category and Sub-Category are Montaji's own controlled
taxonomy. Our AI-extracted `product_type` (free text like "Face Serum") won't map
to these cleanly without a lookup table we don't have yet — **these two fields will
likely need manual human selection for v1, not auto-fill.**

## Step 3 — Attachments
Only one attachment slot:
- **Free Sales Certificate*** — Upload / Delete / View buttons, grid of uploaded
  files below (Name, Time Stamp columns).
- **Important conditional rule (from Belal, not yet verified live):** this
  requirement depends on Country of Origin. If Country of Origin **is not** UAE →
  Free Sales Certificate is required. If Country of Origin **is** UAE → the
  requirement becomes a **GMP certificate** instead. Need to confirm exactly how
  this shows up in the UI (does the label/field change, or is there a second
  conditional upload slot that only appears for UAE?) — check this once we resume.

This maps directly to RegPilot's "Certificate of Free Sale / manufacturer docs"
document type, with that UAE/GMP branch to handle.

No slot here for ingredients or label artwork — expected to show up in Step 4,
since a "variant" is the actual sellable SKU and would carry its own label/
ingredients/packaging data.

## Step 4 — Products Variants
**Not yet seen** — portal went down right after clicking Next from Step 3. This is
the step most likely to contain ingredients and label artwork fields. Resume here
first.

## Step 5 — Acknowledgement
**Not yet seen.** Presumably final review + consent + the real Submit button, which
we will not click during exploration.

## Still to do
1. Resume walkthrough from draft `CPRED-041026-373608`, continue into Step 4
   (Products Variants) and Step 5 (Acknowledgement).
2. Confirm the Country of Origin → Free Sale/GMP conditional behavior on Step 3.
3. Figure out the unlabeled toggle on Step 2 if it turns out to matter.
4. Once Steps 4-5 are mapped, decide the Category/Sub-Category taxonomy question
   (manual selection vs. some mapping table) and update `field-map.js` with real
   selectors (replacing the `TODO_SELECTOR_*` placeholders), set `MONTAJI_READY =
   true`, and fix the manifest's placeholder Montaji domain
   (`REPLACE-WITH-REAL-MONTAJI-DOMAIN.gov.ae` → `montajiprd.dm.gov.ae`).
5. Update `montaji-filler.js` to watch for step changes (MutationObserver) since
   this is an SPA wizard.
6. Build the "searchable autocomplete" filler (click → type → click result) in
   `fill-engine.js` as a distinct helper from the current plain `fillField`, since
   Category/Group/Sub-Category/Country of Origin all need it.
