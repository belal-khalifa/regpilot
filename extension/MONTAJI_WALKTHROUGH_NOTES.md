# Montaji CPRE walkthrough notes

Live walkthrough of the real Montaji production portal (`https://montajiprd.dm.gov.ae`),
done with the user driving login and Belal filling placeholder data; Claude observed
read-only via browser automation, never touched login, and never clicked the real
Submit (confirmed Montaji disables it until a human checks a declaration toggle —
see Step 5).

**Status: structural walkthrough of all 5 wizard steps is complete.** Draft used
throughout: request `CPRED-041026-373608` (Consumer Product Registration, company
"BEAUTY TREND COSMETICS TRADING L.L.C"), variant `CPRED-041026-373608-00...`
("Testing Product 321345"), one ingredient saved (AQUA, 70%). The portal went down
four separate times during this session — every time the draft survived and we
resumed exactly where we left off, so that pattern seems reliably safe for future
sessions too.

**Taxonomy crawl (Group → Category → Sub-Category) — done for the two groups that
matter, saved as `app/src/lib/montajiTaxonomy.ts` (the single source of truth; the Netlify extraction function and the review form both import it).** Goal (per Belal):
constrain AI classification to real Montaji values instead of free text, with a
confidence gate deciding auto-fill vs. flag-for-review, working toward trusting
full automation once confidence is proven.
- **Correction to the earlier assumption:** unlike Country of Origin (all ~243
  options present immediately), Group/Category/Sub-Category options are **lazy-loaded
  and dependent** — the underlying `<select>` is empty until the dropdown is
  opened, and Category/Sub-Category only populate after their parent is chosen.
- Captured: **Cosmetics and Personal care Products** (19 Categories) and
  **Fragrances** (10 Categories). Detergents, Biocides, Health Supplements were
  skipped on purpose — Belal will provide a master sheet later.
- **Big simplification:** almost every Category has exactly one Sub-Category,
  `Undefined`. Exceptions: Hair and scalp products (+ "Hair and scalp care and
  cleansing products"), Body Care Preparations (+ "Correction of body odor and/or
  perspiration"), Hotel amenities (+ "Hair Care", "Hand Care"), and Fragrances'
  "Air Fresheners   Home Fragrances" (sub-category is "Other"). So the real
  classification problem is **Group (5) + Category (~19)**, with Sub-Category
  defaulting to `Undefined` unless the Category has others.
- **Technique that works for the fill engine's autocomplete filler:** these
  Select2 dropdowns respond to *synthetic* events — `mousedown` dispatched on
  `.mx-name-<widget> .select2-selection` opens it; `mouseup` dispatched on the
  matching `li.select2-results__option` selects it. No typing needed. Wait ~500ms
  after opening for options to render and ~800–1000ms after picking before
  touching the dependent dropdown (Group → Category → Sub-Category must be filled
  in that order, each after the previous one's options have loaded). Dropdowns
  toggle: `mousedown` on an already-open one closes it, so check
  `.select2-container--open` first. Widget names (Step 2 form):
  `autoCompleteForMendix4` = Group, `…2` = Category, `…3` = Sub-Category.
  (These class numbers are only unique per form instance — scope to the open form.)

**What's left is not more exploration, it's turning this into working code** — see
"Still to do" at the bottom for the concrete remaining list (mainly: a focused pass
to confidently label a handful of Sub Variant Information selectors, settle the
Category/Sub-Category taxonomy question, then write it all into `field-map.js` and
`montaji-filler.js`).

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
- **Text inputs commit on blur — the plain native-setter trick is NOT enough.**
  Setting the value and dispatching `input`/`change` made the text appear on screen
  but Montaji's model didn't take it: clicking Next raised "A value must be
  entered" on the field. What worked (tested on Brand Other): dispatch
  `FocusEvent('focus')` + `focusin`, set the value with the native setter, dispatch
  `keydown` → `InputEvent('input')` → `keyup` → `change`, then explicitly dispatch
  `FocusEvent('blur')` + `focusout`. The explicit blur matters because calling
  `element.blur()` doesn't fire when the tab/window isn't focused. **The fill
  engine's `setNativeValue` needs this fuller sequence.** The validation message
  cleared immediately and the wizard advanced.
- Select2 autocompletes (Group/Category/Sub-Category) *did* commit correctly from
  synthetic `mousedown`/`mouseup` alone — no extra events needed.
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

**Real selectors — captured in a focused label-by-label pass (2026-10-14).** Page
is `CPRE_Reg_ProductInformation`, module prefix `409`. Ids carry the unstable
`_xxx_NN` suffix (seen `_lea_NNN`), so match with `[id*="CPRE_Reg_ProductInformation.<widget>"]`
scoped by tag. Barcode and Size have no `mx-name-` wrapper class; the rest do.

| Field | Required | Widget | Notes |
|---|---|---|---|
| International Barcode | yes | `input` `textBox6` | no mx-name wrapper |
| Variant Name | yes | `input` `textBox19` (`.mx-name-textBox19`) | pre-filled from Step 2 Name |
| Product Color / Shade | yes | `input` `textBox20` | |
| Size / Weight / Volume | yes | `input` `textBox23` | defaults to `0.00`, no mx-name wrapper |
| Weight / Volume Unit | yes | `select` `dropDown7` (`.mx-name-dropDown7`) | values: `ML`, `Caplet`, `Capsules`, `Gummies`, `Kg`, `L`, `Others`, `Powder`, `Soft_Gel`, `Tablets`, `g`, `mg` (note `Soft_Gel` value, label "Soft Gel") |
| Scent / Flavor | yes | `input` `textBox22` | |
| Has Production Date? | no | radios `radioButtons4` | values `Yes` / `No` |
| Has Expiry Date? | no | radios `radioButtons3` | values `Yes` / `No` |
| Has Batch Number? | no | radios `radioButtons1` | values `Yes` / `No` |
| Shelf Life | no | `input` `textBox24` | |
| Shelf Life Period Type | no | `select` `dropDown8` | values: `Days`, `weeks`, `Months`, `Years` (note lowercase `weeks`) |
| Has period after opening? | no | radios `radioButtons5` | values `Yes` / `No` |
| Package Type | no | autocomplete `.mx-name-autoCompleteForMendix3` | **skip** — see below |

- **Package Type is not a controlled list.** Opening it loads **536** free-text
  packaging descriptions entered by other companies ("Wooden Pencil", "50ml
  product packed in white bottle HDPE, Cap 18MM…"). Options are fetched from the
  server (shows "Searching..." for a second or two). It's optional, so v1 leaves
  it blank.
- **Only 6 fields are required** here: Barcode, Variant Name, Color/Shade,
  Size/Weight/Volume, Unit, Scent/Flavor. Everything else on this form is optional.
- **Gap versus today's extraction:** RegPilot's Gemini schema doesn't extract
  barcode, color/shade, size/volume, unit or scent/flavor yet — those need adding.
- **Scoping caution:** the Step 4 page also renders a read-only "Product Base
  Information" recap (ids under `CPRE_Product_RegProductBaseInformation`, all
  disabled). Never match on `409.` alone — include `CPRE_Reg_ProductInformation`.

**"Ingredients" section** (below Sub Variant Information) — its own grid, separate
from the Attachments' "Ingredients Report" file upload:
- Buttons: **New**, Edit, **Download Template**, **Import**, Delete.
- Grid columns: Ingredient Name, Other, Weight, Percentage.
- **"Download Template" + "Import" — got the actual file, real finding below.**
  Belal downloaded it despite the 503 I saw server-side; saved at
  `attachments/Ingredient_sample.xlsx` in this repo.
  - **Sheet "Ingredient Details"**: row 1 is the same "select Other and fill Other
    column" note as the live modal; row 2 is headers **Ingredient | Other |
    Percentage | Weight**; data starts row 3 (blank in the template). Column A
    ("Ingredient") has an Excel data-validation dropdown tied to a named list.
  - **Sheet "DataSource"**: 847 rows of `(id, ingredient name)` pairs — this is
    **Montaji's entire official ingredient catalog**, the exact same list the live
    Select2 widget searches. We now have it as a static reference file.
  - **This meaningfully upgrades the Import path from "maybe" to a real option**:
    RegPilot could match each AI-extracted ingredient against this known catalog
    *before* ever touching the browser (exact or fuzzy match → real name; no match
    → "Other" + free text in the Other column), generate a filled .xlsx in this
    exact shape, and have the user import it in one action instead of one modal
    per ingredient.
  - **Still deprioritized for v1** — the row-by-row "New" modal (below) is already
    fully mapped and tested working end-to-end, which is enough to ship. Revisit
    this once ingredient-heavy products make the per-row modal feel slow. Note:
    generating a real .xlsx (not just CSV) needs a spreadsheet-writing library in
    the Netlify function — doable, just extra scope.
- **"New" row-add form — now fully mapped and tested end-to-end (one real row
  saved successfully: AQUA, 70%):** opens a "Product Ingredients" modal
  (`.modal-dialog.mx-window.mx-window-active`), with a note: "If you don't find the
  Ingredient, just select 'Other'."
  - **Ingredients*** — autocomplete, wrapper `.mx-name-autoCompleteForMendix2`
    *inside the modal* (same class name pattern reused per-modal-instance, not
    globally unique — always scope this selector to the open modal, not the whole
    document). Typing a name searches Montaji's own ingredient catalog; if it
    matches a real entry (e.g. typing "Aqua" matched "AQUA"), that gets selected
    directly — no extra field needed. If nothing matches, select the
    **`***Other***`** option instead (it appears literally like that, asterisks
    included, and oddly appears more than once in the list — any instance works).
  - Selecting `***Other***` reveals an **"Ingredients other name"** text field,
    `457.Services.CPRE_Ingredient.textBox1` — type the real ingredient name here.
  - **Weight** — text input, `457.Services.CPRE_Ingredient.textBox2` (optional,
    left blank in the test).
  - **Percentage** — text input, `457.Services.CPRE_Ingredient.textBox3`.
  - Save / Cancel buttons at the bottom.
  - **Fill plan confirmed with Belal:** type the ingredient name into the
    Ingredients search box either way — let Montaji auto-match to its catalog if
    it finds one (fine, even better/more accurate), otherwise fall back to
    clicking `***Other***` and filling "Ingredients other name". Don't force
    `***Other***` unconditionally.
  - After Save, the row appears correctly in the Ingredients grid (Ingredient
    Name column showed "AQUA", Percentage "70") — confirms the whole add-ingredient
    loop works and can be repeated (click New) once per ingredient.

**"Attachments" section** (below Ingredients) — four upload slots, each with
Upload/View/Delete and a Name/Time Stamp grid:
- **Artwork** — maps to RegPilot's `label_artwork` document type.
- **Ingredients Report** — maps to RegPilot's `formula_ingredient_list` document
  type (the source document, distinct from the structured Ingredients grid above).
- **Product Image** — optional. Not collected by RegPilot today; Belal says we can
  add it as an upload category later. Not needed for v1.
- **Laboratory Test Report** — **ignore per Belal**, not in scope.

**Upload mechanism** (checked on Artwork, same pattern expected for the others):
clicking Upload opens an in-page "Add Document" modal (bare input + "Browse..." +
Upload/Cancel, inside the usual `.mx-window.mx-window-active`) rather than
immediately throwing a native file picker. The underlying element is a plain
`<input type="file">` with no id/class — find it scoped to the open modal. Belal
confirmed we don't need to actually complete an upload to keep exploring, so this
wasn't finished, but one useful finding: **because it's a real file input (not some
custom non-standard widget), the extension could in principle attach a file
programmatically via the DataTransfer API** (`new DataTransfer(); dt.items.add(new
File(...)); input.files = dt.files; dispatch 'change'`) — no OS picker needed. That
would let the extension auto-attach the same document bytes the user already
uploaded to RegPilot, for Artwork/Ingredients Report/Free Sale/GMP cert. **Not v1
scope** (v1 is text-field filling only; this needs the fill payload to carry actual
file bytes, not just extracted text) but a real, concrete v2 capability worth
remembering — it's not blocked by anything we've seen.

## Step 5 — Acknowledgement
**Seen and mapped.** Top of the page is a full read-only recap of everything
entered in Steps 1-4 (Sub Variant Information, Attachments, etc.) — no new editable
fields there. At the bottom:
- A toggle switch + declaration text: *"We hereby acknowledge that all the
  information which is submitted to Dubai Municipality is correct, and declare
  full legal liability if the mentioned information is proved to be incorrect"*,
  with a **"Terms and Condition\*"** link.
- **The real Submit button is disabled until that toggle is switched on.** This
  independently confirms Montaji itself enforces a human consent step before
  anything can be submitted — lines up exactly with RegPilot's own design (the
  extension fills fields but a person must review and act to actually submit).
  We did not toggle it or click Submit.

**The full 5-step wizard has now been walked end-to-end once, live, in production**,
with one real variant and one real ingredient saved successfully (never submitted).

## Fill code - live test results (2026-10-14)

The fill code was injected into the live Montaji tab (page context, with a stand-in for the
extension's storage) and run against a throwaway draft under the DM STACEY ACCOUNT company
(always use that one for testing). Findings that changed the code:

- **Ingredient lookups need a typed search term.** Opening the dropdown alone leaves it on
  "Searching..." indefinitely. Typing into `.select2-search__field` (native setter + input/keyup)
  triggers the lookup, which returns the whole crowd-sourced list (1,100+ entries with many
  near-duplicates such as "AQUA", "Aqua", "AQUA (WATER)"). The first lookup is slow (~10 s) and
  can freeze the tab briefly; later ones were quick. Exact case-insensitive matching found
  "AQUA" and "SILICA"; anything else falls back to `***Other***` + the typed name.
- **Montaji reformats numbers** ("4" becomes "4.00"), so a strict equality check reported a false
  failure on Size/Volume. The commit check now compares numerically.
- **A second variant needs its row selected.** "Add New Variant" appends a row to the variants
  grid but the form stays bound to the previously selected row, so the new (last) row must be
  clicked before filling, otherwise variant 1 would be overwritten.
- Confirmed working: Step 2 (country via alias-aware matching, name, Group/Category/Sub-Category,
  brand) accepted by Montaji with no validation errors; Step 4 text, native selects, Yes/No radios,
  shelf life, and the ingredient popup; per-variant "Save and Validate" passed.
- End state verified from Montaji's own grids (not just the extension's report): two variants with
  their own barcodes and shades, and the right ingredients with percentages on the selected one.
- **Not yet tested:** the real packaged extension (isolated content-script world, real
  `chrome.runtime` storage, data arriving from the RegPilot site) and the Step 1/3/5 messages.

## Still to do
1. ~~Sub Variant Information selectors~~ — **done**, see the table in Step 4.
2. Confirm the Country of Origin → Free Sale/GMP conditional behavior on Step 3
   (still unverified live — only have Belal's description of the rule).
3. Figure out the unlabeled toggle on Step 2 if it turns out to matter.
4. Decide the Category/Sub-Category taxonomy question (manual selection vs. a
   mapping table from RegPilot's free-text `product_type`).
5. With the above settled, write the real selectors into `field-map.js` (replacing
   `TODO_SELECTOR_*`) and set `MONTAJI_READY = true`. (Manifest domain is already
   fixed — `montajiprd.dm.gov.ae`.)
6. Update `montaji-filler.js` to watch for step changes (MutationObserver) since
   this is an SPA wizard — confirmed across all 5 steps, no full page reloads.
7. Build the "searchable autocomplete" filler (click → type → click matching
   result, scoped to whatever modal/section is open) in `fill-engine.js` as a
   distinct helper from the current plain `fillField` — needed for Category/Group/
   Sub-Category/Country of Origin/Weight-Volume Unit/Package Type/Ingredients.
8. Decide whether Product Image becomes a 4th RegPilot upload category (later,
   not v1).
9. (v2, not blocking) Consider the Ingredients Download-Template/Import bulk path,
   and/or programmatic file-attach via DataTransfer for the Attachments uploads —
   both are confirmed technically viable, just extra scope beyond v1 text-field
   filling.
