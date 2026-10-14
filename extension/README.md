# RegPilot for Montaji (Chrome extension)

Fills a reviewed RegPilot product into the Montaji CPRE wizard, one step at a time. You stay logged
in to Montaji yourself. The extension never presses Next, Save Draft, Cancel or Submit, never
touches the declaration tick-box, and never sees your Montaji password.

## Install / reload (developer build)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. **Load unpacked** and choose this `extension` folder. After any code change, press the circular
   **reload** arrow on the RegPilot card, then refresh the Montaji tab and the RegPilot tab.
3. The extension only runs on `https://regpilot-app.netlify.app`, `http://localhost:5173` and
   `https://montajiprd.dm.gov.ae`.

## How a fill works

1. In RegPilot open the product, review it, press **Save & mark ready to fill**, then
   **Send to extension**. The data is held in the extension's local storage.
2. In Montaji open the CPRE service. A RegPilot panel appears on the page and shows which
   step you are on.
3. Press **Fill this step**. Each step fills what it can and lists what it did, what you must do
   yourself (for example uploading attachments) and anything it skipped.
4. You press Next / Save and Validate / Submit on Montaji yourself.

## Steps

| Montaji step | What the extension does |
| --- | --- |
| 1 Acknowledgement | Nothing. You tick and continue yourself. |
| 2 Product base | Country, name, group, category, sub-category, brand (classification is skipped when the AI was not confident). |
| 3 Attachments | Nothing yet. A list tells you which certificate to upload (Free Sale when the country of origin is not UAE, GMP when it is). |
| 4 Variants | One variant per row: barcode, shade, scent, size, unit, date flags, shelf life, ingredients (Excel import), then Save and Validate. |
| 5 Declaration | Nothing. You review and submit yourself. |

## Files

- `manifest.json` Chrome manifest (MV3).
- `background.js` holds the queued product and serves the ingredient template.
- `content-scripts/regpilot-bridge.js` receives the product from the RegPilot page.
- `content-scripts/montaji-filler.js` the on-page panel and step logic.
- `config/field-map.js` where each Montaji field is located. Montaji is built with Mendix, so the
  matching is by page and widget name because the numeric ids change.
- `config/fill-engine.js` low-level, human-paced typing, selecting and clicking.
- `config/ingredient-import.js` fills Montaji's own Excel template with the ingredient list.
- `MONTAJI_WALKTHROUGH_NOTES.md` everything learned about the portal.
