# Montaji CPRE walkthrough notes (in progress)

Live walkthrough of the real Montaji production portal (`https://montajiprd.dm.gov.ae`),
done with the user driving login and Belal filling placeholder data; Claude observed
read-only via browser automation and never touched login or clicked final Submit.

**Resume point:** draft request `CPRED-041026-373608` (Consumer Product Registration,
company "BEAUTY TREND COSMETICS TRADING L.L.C"). Portal has gone down twice now
during this walkthrough — both times the draft survived and we resumed from it, so
this seems reliably safe. On the second outage we had: a variant already created
under this draft (request number starting `CPRED-041026-373608-00...`, Variant Name
"Testing Product 321345"), scrolled to its "Ingredients" grid, and had just clicked
**"New"** to open the add-ingredient form when the portal dropped — that form's
fields were never seen. **Resume exactly there**: reopen the draft, scroll to Step 4's
Ingredients section, click New again.
To reopen: log back in, it should still be sitting as a draft — check "My Dashboard"
or "Search Product" / request tracking ("click here" link on the form header) rather
than starting over.

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
Top shows a read-only recap of "Product Base Information" (what was entered in
Step 2), then:

**"Products Information" grid** — list of variants under this product base.
Buttons: **Add New Variant**, **Add Variant with copy Details**, Delete. Clicking
"Add New Variant" adds a row to the grid *and* reveals a "Sub Variant Information"
edit form further down the page (not a modal, not a row-click-to-expand — just
appears below once added). Grid columns: Product Request Number, Barcode, Product
Name, Color, Size/weight.

**"Sub Variant Information" fields** (the actual per-variant data entry):
- **International Barcode*** — text input
- **Variant Name*** — text input, pre-filled from the Product Base's Name
- **Product Color / Shade*** — text input
- **Size / Weight / Volume*** — numeric input (defaults to 0.00)
- **Weight / Volume Unit*** — dropdown
- **Scent / Flavor*** — text input
- **Has Production Date?** — Yes/No radio
- **Has Expiry Date?** — Yes/No radio
- **Has Batch Number?** — Yes/No radio
- **Shelf Life** — numeric input
- **Shelf Life Period Type** — dropdown
- **Has period after opening?** — Yes/No radio
- **Package Type** — dropdown ("Select an item from the dropdown...")

None of these widgets' ids/classes were captured yet (portal went down before
inspecting) — need real selectors next session.

**"Ingredients" section** (below Sub Variant Information) — its own grid, separate
from the Attachments' "Ingredients Report" file upload:
- Buttons: **New**, Edit, **Download Template**, **Import**, Delete.
- Grid columns: Ingredient Name, Other, Weight, Percentage.
- **"Download Template" + "Import" could be a much better fill strategy than
  clicking through a row-add form per ingredient** — if Montaji accepts a filled
  spreadsheet back, RegPilot could generate that file directly from the extracted
  ingredient list instead of the extension doing repetitive UI automation. Worth
  checking the template's exact file format (columns, sheet name) next session,
  and whether Import can be triggered from a content script (file inputs usually
  need a real user-initiated file picker, so this might still need the user to
  pick a RegPilot-generated file — but still far more reliable than N rows of
  autocomplete clicking).
- The "New" button's row-add form itself was not seen — portal went down right
  after clicking it. **First thing to check on resume.**

**"Attachments" section** (below Ingredients) — four upload slots, each with
Upload/View/Delete and a Name/Time Stamp grid:
- **Artwork** — maps to RegPilot's `label_artwork` document type.
- **Ingredients Report** — maps to RegPilot's `formula_ingredient_list` document
  type (the source document, distinct from the structured Ingredients grid above).
- **Product Image** — optional. Not collected by RegPilot today; Belal says we can
  add it as an upload category later. Not needed for v1.
- **Laboratory Test Report** — **ignore per Belal**, not in scope.

Did not reach the bottom of Step 4 (Next/Back buttons) before the second outage.

## Step 5 — Acknowledgement
**Not yet seen.** Presumably final review + consent + the real Submit button, which
we will not click during exploration.

## Still to do
1. Resume from draft `CPRED-041026-373608` → Step 4 → the existing variant's
   Ingredients section → click **New** and capture that form's fields/selectors.
2. Capture real selectors for all "Sub Variant Information" fields listed above.
3. Check "Download Template" for Ingredients — exact file format — and evaluate
   the file-import approach vs. per-row UI automation.
4. Reach and map Step 5 (Acknowledgement).
5. Confirm the Country of Origin → Free Sale/GMP conditional behavior on Step 3.
6. Figure out the unlabeled toggle on Step 2 if it turns out to matter.
7. Once everything is mapped, decide the Category/Sub-Category taxonomy question
   (manual selection vs. some mapping table) and update `field-map.js` with real
   selectors (replacing the `TODO_SELECTOR_*` placeholders), set `MONTAJI_READY =
   true`. (Manifest domain is already fixed — `montajiprd.dm.gov.ae`.)
8. Update `montaji-filler.js` to watch for step changes (MutationObserver) since
   this is an SPA wizard.
9. Build the "searchable autocomplete" filler (click → type → click result) in
   `fill-engine.js` as a distinct helper from the current plain `fillField`, since
   Category/Group/Sub-Category/Country of Origin/Weight-Volume Unit/Package Type
   all need it.
10. Decide whether Product Image becomes a 4th RegPilot upload category (later,
    not v1).
