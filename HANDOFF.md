# RegPilot — handoff report

Written 2026-10-14. Everything described here is in the repo at the commit that adds this file.
Live app: https://regpilot-app.netlify.app (Netlify site `regpilot-app`).

## How to work with the owner

- The owner is a non-coding CEO; you act as CTO. Talk in plain English about what they can see,
  click or decide. Discuss impact before technical choices, then decide the technical parts yourself.
- Build one piece at a time and test it yourself (desktop and phone width) before showing it.
- The theme comes from `DESIGN.md` (Apple-style design system), wired as Tailwind v4 `@theme` tokens.
- Commit messages end with the `Co-Authored-By` trailer given by the harness.

## 1. Goal

**What:** RegPilot is a SaaS for cosmetics trading companies and regulatory consultants. A user
uploads a product's documents; AI extracts the product data; a human reviews and edits it; a Chrome
extension then fills Dubai Municipality's **Montaji** portal (https://montajiprd.dm.gov.ae, built
on Mendix) while the human stays logged in and clicks Submit themselves.

**Who:** brand/trading-company teams and regulatory consultants (multi-company: one user can
belong to several companies; single role per company).

**Target outcome (MVP):** a person goes from a folder of documents to a fully filled Montaji
registration draft in minutes, with as few manual entries as possible. Documents per product:
formula / ingredient list, Certificate of Free Sale or manufacturer (GMP) certificate, label artwork.

**Future vision (not built, separate deliberate decision):** automate submission itself once
extraction confidence is high enough (confidence gating). The owner raised this; it was flagged as
its own decision. Do not build it without asking.

## 2. Decisions made and why

**Product**
- First market is Montaji only; other regulators may follow.
- The extension prepares, the human submits. The extension never presses Next, Save Draft, Cancel
  or Submit, never toggles the declaration, and never touches Montaji credentials. This is enforced
  in code (`FORBIDDEN_BUTTONS` in `extension/config/field-map.js` and a guard in `clickButton`).
- Outcome tracking is manual via a status dropdown (draft, extracted, ready_to_fill, submitted,
  approved, rejected).
- Team invites are explicitly out of scope for the MVP.

**Stack**
- Vite 8 + React 19 + TypeScript + Tailwind v4, react-router.
- Supabase: Auth (Google, Microsoft/azure, email+password), Postgres with Row Level Security,
  Storage bucket `product-documents`.
- Netlify hosting plus one Netlify Function (`extract-product`). `GEMINI_API_KEY` is a Netlify
  secret (production context only).
- Gemini (`gemini-flash-latest`, falling back to `gemini-flash-lite-latest`) with structured output
  via `responseSchema` and enums. Chosen because the owner supplied a free key and this is an MVP.
- The function authenticates as the caller with their Supabase access token, so RLS decides what it
  can read and write. It never uses a service key.
- Chrome extension is Manifest V3: content scripts, a service worker, a shadow-DOM panel.

**Extraction rules (from the owner)**
- `color_shade` and `scent_flavor` are the manufacturer's own code or name (for example `126`,
  `128`), never the visual colour (not "red" or "pink"). Default `NA` when absent.
- Certificate rule: Country of Origin not UAE means Certificate of Free Sale; UAE means GMP.
- Product Image is optional and a later upload category. Ignore Laboratory Test Report.
- Classification is Group, Category, Sub-Category from Montaji's real taxonomy. Anything that is not
  a valid path is dropped and confidence forced to `low`; the extension skips classification when
  confidence is low (`validateClassification` in `app/src/lib/montajiFields.ts`).
- At least one variant always exists.

**Ingredients**
- Bulk Excel import using Montaji's own template, not one popup per ingredient (the popup path took
  about a minute per variant and is kept only as a fallback).
- Every ingredient is written as `***Other***` with the real name in the Other column; the owner
  expects Montaji to swap in master-list names. **Unconfirmed**, see section 6.
- Montaji rejects any row without a percentage. Rows without one are listed for manual entry.

## 3. Current state

### Committed (HEAD = the commit containing this file; previous work commit `5ccca25`)
- Web app: landing, login (Google/Microsoft/email), company setup and switcher, product dashboard,
  document upload with storage, extraction via Gemini, editable review screen (variants,
  classification with confidence flag, shelf life, date flags, a "Before you send this to Montaji"
  checklist), status control, delete with storage cleanup, "Send to extension" panel.
- Extension v0.3.0: step detection, Step 2 (product base) and Step 4 (variants, flags, shelf life,
  ingredients by Excel import, Save and Validate) filling, informational messages for Steps 1, 3, 5.
- `test-documents/`: generator script plus two fictional product sets, all stamped "SAMPLE -
  SOFTWARE TESTING ONLY":
  - `lip-gloss-italy/` — Maison Lumiere "Double Gloss", shades 126 and 128, 13 ingredients with
    percentages, Certificate of Free Sale.
  - `perfume-uae/` — Maison Alamir "Oud Noir" EDP 100 ml, 9 ingredients, GMP certificate.
- `extension/README.md`: install/reload and how a fill works.

### Deployed
- Production is deployed from the current build. A temporary timeout-probe function was deployed,
  used and then removed; the final deploy no longer contains it.
- **Measured Netlify function limit is about 30 seconds** (28 s sleep returned 200; 45 s returned
  504 "Inactivity Timeout" at about 31 s). The extraction function's 22 s retry budget is inside
  that. A large multi-PDF extraction plus a Gemini retry could still get close; watch it.

### Uncommitted or half done
- Nothing uncommitted at the time of writing (`git status` clean after this file is committed).
- `extension/MONTAJI_WALKTHROUGH_NOTES.md` section "Still to do" is **stale**: selectors are
  already in `field-map.js` and the filler is built. Trust the "Fill code" and "Excel import"
  sections instead.

### Not verified / possibly broken
1. **The packaged extension has never run end to end.** All live fill tests injected the scripts
   into the Montaji page with a stubbed `window.chrome`. Untested for real: isolated-world
   behaviour, `chrome.storage` hand-off from the RegPilot page, the new background-worker
   `GET_INGREDIENT_TEMPLATE` path (added this session; syntax-checked only), and the panel.
2. **Real PDF and image extraction has never been run.** Only text samples were tested. The
   function sends files as Gemini `inlineData`; the new sample PDFs and PNGs were never sent.
3. The local extraction test harness was lost (scratchpad is temporary) and the Gemini key cannot be
   read back from Netlify (masked). To test locally the owner must supply a key, or test through the
   live app by uploading `test-documents/` after signing in.
4. Montaji did not replace `***Other***` names with master entries in the grid after import or after
   Save and Validate. May happen only at review or submission.
5. Step 3 (attachments) is not automated; the extension only tells the user which certificate to
   upload. The conditional Free Sale / GMP behaviour on Step 3 was not confirmed live.
6. `app/` build is slow in this iCloud-synced folder (`tsc -b && vite build` took several minutes).
   A `netlify deploy` once hung for 9 minutes with no output and had to be killed.

## 4. Open questions / waiting on the owner

- **Waiting:** the owner's partner is sending real documents. Until then use `test-documents/`.
- Needs a Gemini key if you want to run extraction from your own machine (ask; do not dig it out
  of old transcripts).
- Master sheet for the other taxonomy groups (Detergents, Biocides, Health Supplements) — owner
  said they will send it later. Only Cosmetics and Personal Care (19 categories) and Fragrances
  (10) are supported.
- Whether to automate attachment upload via `DataTransfer` (technically viable, extra scope).
- Whether/when to pursue automated submission with confidence gating (future).
- Whether to add Product Image as an upload category.
- Clean-up: leftover test drafts on Montaji for the owner to delete — `CPRED-141026-377523` (DM
  STACEY ACCOUNT, has stray variants and duplicate ingredient rows), `CPRED-041026-373608`, and an
  empty draft under CHEMTECH.

## 5. Next steps, in priority order

1. **Run the real end-to-end test with the sample documents.** No code change needed to start.
   See the test script below. Files touched only if something fails: `extension/content-scripts/
   montaji-filler.js`, `extension/config/*`, `extension/background.js`.
2. **Verify real PDF/PNG extraction** through the live app (upload the six sample files as two
   products). Check variants (126/128 with distinct barcodes `8025272612340` / `8025272612357`),
   UAE origin for the perfume, classification, and ingredient percentages. Touches
   `app/netlify/functions/extract-product.ts` (prompt, schema, `postProcess`) if wrong.
3. **Fix whatever the first real extension run reveals**, most likely in
   `extension/content-scripts/montaji-filler.js` (panel and hand-off) and `extension/background.js`.
4. **Resolve the `***Other***` question** by checking the draft's review/summary page in Montaji
   after import. If names are never replaced, decide whether to match names against the catalogue
   hidden in the template (column Z, 847 rows) inside `extension/config/ingredient-import.js`.
5. **Step 3 attachments**: confirm the UAE/GMP conditional live; optionally attach files via
   `DataTransfer` from RegPilot storage. Touches `montaji-filler.js`, `field-map.js`, and would need
   file bytes passed through the bridge (`extension/content-scripts/regpilot-bridge.js`,
   `app/src/lib/useRegPilotExtension.ts`).
6. **Ingredient percentages gap**: when a formula has no percentages, Montaji rejects the import.
   Consider letting the review form flag/enter them (`app/src/components/ExtractionReviewForm.tsx`).
7. **Add the other taxonomy groups** when the master sheet arrives: `app/src/lib/montajiTaxonomy.ts`
   (single source of truth; the prompt and dropdowns derive from it) and move them out of
   `MONTAJI_PENDING_GROUPS`.
8. **Production hardening**: error handling for very large documents (30 s limit; consider
   uploading fewer/lighter files or an async job), Gemini quota, a privacy note on document
   storage, publishing the extension (Chrome Web Store) instead of "load unpacked".
9. Update the stale "Still to do" in `extension/MONTAJI_WALKTHROUGH_NOTES.md`.

### End-to-end test script (for the owner)
1. `chrome://extensions` → Developer mode → Load unpacked → the `extension` folder (or press reload
   if already loaded).
2. Open https://regpilot-app.netlify.app, sign in, create a product, upload the three files from
   `test-documents/lip-gloss-italy/`, run extraction.
3. Review the screen, fix anything flagged, press **Save & mark ready to fill**, then
   **Send to extension**.
4. In Montaji, log in yourself and choose **DM STACEY ACCOUNT**. Start the CPRE service; the
   RegPilot panel appears. Press **Fill this step** on each step. Press Next yourself.
5. **Never submit.** Leave the draft and report what was wrong.

## 6. Gotchas

**Hard rules from the owner**
- Production Montaji only, **never submit**. Always use the company **DM STACEY ACCOUNT**.
- The owner logs in to Montaji themselves; place the Montaji tab into the Claude-in-Chrome tab group
  you create ("create the tab group again" is the ritual). Claude-in-Chrome sometimes disconnects;
  ask the owner to reconnect.
- The portal goes down now and then; just wait and retry.

**Mendix / Montaji quirks** (full detail in `extension/MONTAJI_WALKTHROUGH_NOTES.md`)
- Input ids look like `<module>.Services.<Page>.<widget>_<3 letters>_<n>`: the suffix and module
  number are unstable. Match by regex on `<Page>.<widget>` or the stable `mx-name-<widget>` class.
- Text inputs commit only on blur. Use the full sequence focus, key, input, change, blur, focusout
  with explicit `FocusEvent`s (`el.blur()` does nothing in an unfocused tab).
- Select2: open with a synthetic `mousedown` on `.select2-selection`, pick with `mouseup` on
  `li.select2-results__option`. The ingredient dropdown only searches after typing into
  `.select2-search__field`.
- Group, Category and Sub-Category lazy-load and depend on each other.
- Montaji reformats numbers ("4" becomes "4.00"): compare numerically.
- After "Add New Variant" the form stays bound to the previously selected grid row; select the new
  last row first.
- The ingredient grid shows 5 rows per page; count with the pager "of N", not visible rows.
- Excel import: use shared strings (inline strings are rejected); template sheet "Ingredient
  Details", headers on row 2, data from row 3, max 113 rows, hidden catalogue in column Z.
- Country of origin is matched through `COUNTRY_ALIASES`.
- Pages include an AMD loader that swallows UMD globals in injected tests (not an issue in the
  extension's isolated world).

**Selectors** live in `extension/config/field-map.js` (`RegPilot.FIELDS`): product base page
`CPRE_ProductBase_Edit`, variant page `CPRE_Reg_ProductInformation`, ingredient page
`CPRE_Ingredient`.

**Setup and credentials (names only)**
- `app/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Netlify env: `GEMINI_API_KEY` (production context; also reads the two `VITE_*` vars).
- Tools: `netlify` CLI (logged in), Node, Python 3 with `reportlab` and `Pillow` for the sample
  generator (`python3 test-documents/generate.py`).
- Type-check the function separately: `npx tsc --ignoreConfig --noEmit <file> --types node`.
- Test accounts: the owner has two personal emails for sign-in; passwords are theirs and are never
  shared. Do not ask for Montaji or RegPilot passwords.

## 7. Deliverables

| Deliverable | Status |
| --- | --- |
| Landing page, design system theme | Done |
| Auth: Google, Microsoft, email/password | Done (verified with the owner's test accounts) |
| Companies, switcher, RLS | Done |
| Product dashboard and status pipeline | Done |
| Document upload and storage | Done |
| AI extraction (text samples) | Done |
| AI extraction from real PDF/PNG documents | Not verified |
| Editable review screen with Montaji fields and readiness checklist | Done |
| Montaji taxonomy: Cosmetics + Fragrances | Done |
| Montaji taxonomy: Detergents, Biocides, Health Supplements | Not started (waiting on master sheet) |
| Chrome extension: Steps 2 and 4 fill logic | Done, verified by injection only |
| Ingredient import via Excel | Done, verified live by injection |
| Chrome extension packaged end-to-end run | Not started (first real run pending) |
| Step 3 attachments upload | Not started (informational message only) |
| Sample test documents | Done |
| Extension README and install notes | Done |
| Netlify timeout measured | Done (about 30 s) |
| `***Other***` replacement behaviour | In progress (unconfirmed) |
| Product Image category | Not started |
| Automated submission | Not started, a separate decision |
| Chrome Web Store publication | Not started |
