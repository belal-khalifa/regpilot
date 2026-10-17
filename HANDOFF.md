# RegPilot — handoff report

Updated 2026-10-17. Everything described here is in the repo at the commit that contains this file.

- Live app: https://regpilot-app.pages.dev (Cloudflare Pages, free `pages.dev` address; a real domain is planned).
- Code: https://github.com/belal-khalifa/regpilot (private).
- Database, login, file storage and the AI extraction function: Supabase project "Regulatory app"
  (ref `ilrrluobgaowbooysjwc`).

## How to work with the owner

- The owner is a non-coding CEO; you act as CTO. Talk in plain English about what they can see,
  click or decide. Discuss impact before technical choices, then decide the technical parts yourself.
- Build one piece at a time and test it yourself (desktop and phone width) before showing it.
- The theme comes from `DESIGN.md` (Apple-style design system), wired as Tailwind v4 `@theme` tokens.
- Commit messages end with the `Co-Authored-By` trailer given by the harness. Push to GitHub after
  finishing a piece of work and say so.
- Never ask for, read back or paste secrets (Gemini key, passwords). The owner types secrets into the
  Supabase / Cloudflare dashboards themselves.

## 1. Goal

**What:** RegPilot is a SaaS for cosmetics trading companies and regulatory consultants. A user
uploads a product's documents; AI extracts the product data; a human reviews and edits it; a Chrome
extension then fills Dubai Municipality's **Montaji** portal (https://montajiprd.dm.gov.ae, built
on Mendix) while the human stays logged in and clicks Submit themselves.

**Who:** brand/trading-company teams and regulatory consultants (multi-company: one user can
belong to several companies; single role per company).

**Documents per product:** formula / ingredient list, Certificate of Free Sale (non-UAE) or GMP
certificate (UAE), label artwork.

**Future vision (not built, separate deliberate decision):** automate submission itself once
extraction confidence is high enough. Do not build it without asking.

## 2. Architecture

| Part | Where | Notes |
| --- | --- | --- |
| Website | `app/` (Vite 8, React 19, TypeScript, Tailwind v4, react-router) | Built and hosted by Cloudflare Pages. Root directory `app`, build `npm run build`, output `dist`, Node 22 (`app/.node-version`). Pushing to `main` redeploys. |
| Database, login, storage | Supabase | Auth: Google, Microsoft, email+password. Postgres with Row Level Security. Storage bucket `product-documents`. `products.seq_no` is a per-company number assigned by a trigger. |
| AI extraction | `supabase/functions/extract-product/` (Deno Edge Function) | Reads the product's files with the **caller's token** (RLS decides access, no service key). Asks `gemini-flash-latest` and `gemini-flash-lite-latest` at once, first good answer wins, thinking off. Secret `GEMINI_API_KEY` is a Supabase secret. About 20-30 s per product. |
| Chrome extension | `extension/` (Manifest V3) | Runs on the website and on Montaji. Never presses Next, Save Draft, Cancel, Submit, Delete outside its own flows; never ticks the declaration; never handles Montaji credentials. |
| QA | `qa/RegPilot-QA-Test-Cases.xlsx` | 181 test cases, document pack, data audit, known limits. |

Cloudflare environment variables (names only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
The website derives the extraction address from `VITE_SUPABASE_URL`.

**Database:** `supabase/schema-snapshot.sql` is a reference export of the live rules (tables, policies,
triggers, bucket limits). Change the database in Supabase, then refresh that file. Safeguards in
place: only members can add members; bucket caps files at 15 MB and PDF/image types; at most 20
documents per product; extraction limits (40 MB total per run, 20 runs per person per hour, one run
per product at a time, tracked in `extraction_runs`); error messages to users are generic, details go
to the function logs.

**Deploying the extraction function:** the repo copy is the source of truth. It cannot import from
`app/`, so `scripts/sync-supabase-shared.sh` copies the two shared files
(`montajiTaxonomy.ts`, the extraction part of `montajiFields.ts`) into the function folder. After
changing either source file or the function, run the script, then deploy the function to Supabase
(`deploy_edge_function` via the Supabase MCP, or the Supabase CLI) **and** push to GitHub.

Supabase sign-in settings that must stay right: Authentication > URL Configuration holds the site
URL (`https://regpilot-app.pages.dev`) and redirect URLs (`.../**` and `http://localhost:5173/**`).

## 3. Decisions made and why

- First market is Montaji only. The extension prepares, the human submits (enforced in code:
  `FORBIDDEN_BUTTONS` in `extension/config/field-map.js` and a guard in `clickButton`).
- Outcome tracking is a manual status dropdown today (draft, extracted, ready_to_fill, submitted,
  approved, rejected). Team invites are out of scope for the MVP.
- `color_shade` and `scent_flavor` are the manufacturer's own code or name (for example `126`), never
  the visual colour. Default `NA`. At least one variant always exists.
- Classification is Group, Category, Sub-Category from Montaji's real taxonomy
  (`app/src/lib/montajiTaxonomy.ts`, the single source of truth). Invalid paths are dropped and
  confidence forced to `low`; the extension skips classification when confidence is low.
- Ingredients go in through Montaji's own Excel template (shared strings, percentage cells in
  General format so small values such as 0.001 are not rounded to 0). Names are written as
  `***Other***` plus the real name. Rows with a `<` or `>` percentage are entered through Montaji's
  popup so the sign is kept. Rows without any percentage are listed for manual entry.
- Warnings shown in a red box above the review form: the Free Sale certificate does not name the
  product, no certificate for a foreign product, or a formula/composition/analysis document is about
  a different product than the label.
- Documents travel with "Send to extension" and are uploaded to Montaji only after the person
  confirms in the panel.

## 4. Current state

**Built and working (verified by the owner on real documents):** sign-in, companies, instant
"+ New product", dashboard table (No., Brand, Product name), document upload, extraction on real
PDFs and images, review screen with readiness checklist and red warnings, Send to extension with
clear success/failure, extension panel (minimize, drag, stays on screen, reload detection), Step 2
fill, Step 3 certificate upload, Step 4 variants (first-variant and multi-variant handling),
ingredient import, artwork and ingredients-report upload, reading and acknowledging Montaji message
boxes.

**Still unverified:** whether Montaji replaces `***Other***` names with master-list names after
validation; a separate GMP upload section on Step 3 for UAE products; behaviour when Fill is
pressed twice on the same variant (see the QA workbook "record what happens" cases).

## 5. To-do / open items

1. **Capture the Montaji submission reference number and status** and show them as two new
   dashboard columns (table becomes 5 columns). Needs new `products` columns, selectors for
   Montaji's status screens (explore live with the owner), and a message from the extension back to
   the website. Not started.
2. Run the QA workbook; fix what fails.
3. Choose and buy a real domain, attach it to Cloudflare Pages, update the Supabase site URL /
   redirect URLs and the extension's allowed sites (one extension reload).
4. Move Gemini to a paid tier before real client documents are processed (free-tier content may be
   used by Google).
5. Supabase free plan pauses an idle project; consider Pro before client demos.
6. Publish the extension to the Chrome Web Store (currently "load unpacked", developer mode).
7. Taxonomy for Detergents, Biocides, Health Supplements: waiting on the owner's master sheet
   (move them out of `MONTAJI_PENDING_GROUPS`; run the sync script; redeploy the function).
8. Product Image upload category (optional on Montaji, later). Laboratory Test Report is ignored.
9. Nothing warns when a UAE product has no GMP certificate yet.
10. Set a monthly spend cap on the Gemini key in Google's billing page (owner action).

## 6. Gotchas

**Hard rules from the owner**
- Production Montaji only, **never submit**. Always use the company **DM STACEY ACCOUNT**.
- The owner logs in to Montaji themselves and places the Montaji tab in the Claude-in-Chrome tab group
  you create. Claude-in-Chrome cannot open `chrome://` pages. It sometimes disconnects; ask the
  owner to reconnect.
- The portal goes down now and then; wait and retry. Delete leftover test drafts on Montaji
  (the extension never deletes).
- After every extension reload, refresh both the RegPilot tab and the Montaji tab.

**Mendix / Montaji quirks** (full detail in `extension/MONTAJI_WALKTHROUGH_NOTES.md`)
- Input ids look like `<module>.Services.<Page>.<widget>_<3 letters>_<n>`: the suffix and module
  number are unstable. Match by regex on `<Page>.<widget>` or the stable `mx-name-<widget>` class.
- Text inputs commit only on blur: use focus, key, input, change, blur, focusout with explicit
  `FocusEvent`s.
- Select2: open with a synthetic `mousedown` on `.select2-selection`, pick with `mouseup` on
  `li.select2-results__option`. Ingredient dropdown only searches after typing.
- Group, Category and Sub-Category lazy-load and depend on each other.
- Montaji reformats numbers ("4" becomes "4.00"): compare numerically.
- Variant rows: Montaji pre-creates a blank row `-0001`; "Add New Variant" adds a row but then opens
  the form of the FIRST row. The first variant needs no click (clicking the open row closes its
  form); later variants need their new row clicked, on the Product Name cell (not the first cell).
- The ingredient grid shows 5 rows per page; count with the pager "of N".
- Excel import: shared strings only, sheet "Ingredient Details", headers row 2, data from row 3, max
  113 rows, hidden catalogue in column Z.
- Percentage text inputs accept `<0.001`; the Excel import takes plain numbers only.

**Selectors** live in `extension/config/field-map.js` (`RegPilot.FIELDS`).

**Local setup**
- `app/.env.local` (never committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Run the website locally: `npm run dev --prefix app` (port 5173). It talks to the real Supabase.
- Type-check: `npx tsc -b` in `app/`. The iCloud-synced folder makes builds slow (minutes).
- GitHub CLI `gh` is installed and the owner is logged in as `belal-khalifa`.
- Real client documents live in `test-documents/Real*/` and are git-ignored: never commit them.
  Fictional sample sets are in `test-documents/lip-gloss-italy` and `perfume-uae`.
