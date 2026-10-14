// RegPilot extension - Montaji-side content script.
//
// Shows a small floating panel when reviewed product data is waiting. Clicking "Fill this step"
// fills whatever wizard step is on screen. It never presses Next, Save Draft, Cancel or Submit
// (outside the ingredient/variant popups it opens itself), never toggles the legal declaration,
// and never reads or stores a Montaji password. The person reviews and submits.

;(function () {
  const RP = globalThis.RegPilot
  const E = RP.engine
  const F = RP.FIELDS

  const HOST_ID = 'regpilot-fill-banner-host'
  let pending = null // { productName, data }
  let running = false
  let ui = null // { setStep, setStatus, showResults, setBusy }

  // --- where are we in the wizard -----------------------------------------------------------

  const STEP_LABELS = {
    general: 'Step 1 - General Information',
    productBase: 'Step 2 - Product Base',
    attachments: 'Step 3 - Attachments',
    variants: 'Step 4 - Products Variants',
    acknowledgement: 'Step 5 - Acknowledgement',
    unknown: 'Not on a CPRE form step',
  }

  function detectStep() {
    const text = document.body.innerText || ''
    if (/We hereby acknowledge that all the information/i.test(text)) return 'acknowledgement'
    if (E.findButton('Add New Variant') || E.findInput(F.variant.page, F.variant.barcode)) return 'variants'
    if (E.findButton('Add New Product Base') || E.findInput(F.productBase.page, F.productBase.name)) {
      return 'productBase'
    }
    if (/Free Sales Certificate/i.test(text)) return 'attachments'
    if (document.querySelector('select[id*="CPRE_General_Info_1"]')) return 'general'
    return 'unknown'
  }

  // --- reporting ----------------------------------------------------------------------------

  const REASONS = {
    'field-not-found': 'could not find this field on the page',
    'value-did-not-stick': 'the page did not accept the value',
    'option-not-found': 'no matching option in Montaji\'s list',
    'no-options-loaded': 'Montaji\'s list did not load in time',
    'no-value': 'nothing to fill',
  }

  function note(report, label, result) {
    if (result.skipped) report.push({ label, status: 'skipped', detail: 'nothing to fill' })
    else if (result.ok) report.push({ label, status: 'filled', detail: result.picked || '' })
    else report.push({ label, status: 'manual', detail: REASONS[result.reason] || result.reason })
  }

  const info = (report, label, detail) => report.push({ label, status: 'info', detail })

  // --- Step 2: product base -----------------------------------------------------------------

  async function fillProductBase(data, report) {
    const P = F.productBase

    if (!E.findInput(P.page, P.name)) {
      if (!E.clickButton('Add New Product Base')) {
        info(report, 'New product form', 'Could not find the "Add New Product Base" button.')
        return
      }
      const proceed = await E.waitFor(() => E.findButton('Proceed'), { timeout: 5000 })
      if (proceed) proceed.click()
      const opened = await E.waitFor(() => E.findInput(P.page, P.name), { timeout: 12000 })
      if (!opened) {
        info(report, 'New product form', 'The new-product form did not open.')
        return
      }
    }

    if (data.country_of_origin) {
      note(
        report,
        'Country of origin',
        await E.select2Pick(P.countryOfOrigin, data.country_of_origin, {
          match: E.countryMatcher(data.country_of_origin),
        }),
      )
    } else {
      info(report, 'Country of origin', 'Not in the reviewed data - choose it on Montaji.')
    }

    note(report, 'Product name', await E.fillText(P.page, P.name, data.product_name))

    const lowConfidence = data.classification_confidence === 'low'
    if (!data.montaji_group || !data.montaji_category || lowConfidence) {
      info(report, 'Group / Category', 'Not filled - the classification still needs your confirmation.')
    } else {
      note(report, 'Group', await E.select2Pick(P.group, data.montaji_group))
      note(report, 'Category', await E.select2Pick(P.category, data.montaji_category))
      note(
        report,
        'Sub-category',
        await E.select2Pick(P.subCategory, data.montaji_sub_category || 'Undefined'),
      )
    }

    note(report, 'Brand', await E.fillText(P.page, P.brandOther, data.brand_name))
  }

  // --- Step 4: variants and ingredients -----------------------------------------------------

  const findIngredientPopup = () =>
    Array.from(document.querySelectorAll('.mx-window-active, .modal-dialog')).find(
      (el) => E.isVisible(el) && /Product Ingredients/i.test(el.textContent),
    )

  async function addIngredient(ingredient, report) {
    const I = F.ingredient
    const label = `Ingredient: ${ingredient.inci_name}`

    if (!E.clickButton('New')) {
      report.push({ label, status: 'manual', detail: 'could not find the Ingredients "New" button' })
      return false
    }
    const popup = await E.waitFor(findIngredientPopup, { timeout: 8000 })
    if (!popup) {
      report.push({ label, status: 'manual', detail: 'the ingredient popup did not open' })
      return false
    }

    // Always "Other" with the real name typed in: Montaji swaps in its own master-list entry when
    // the name already exists there, and this avoids the slow per-ingredient list lookup.
    const other = await E.select2Pick(I.autocomplete, I.otherOption, {
      root: popup,
      searchTerm: 'Other',
      match: (text) => (E.normalize(text) === E.normalize(I.otherOption) ? 100 : 0),
    })
    if (!other.ok) {
      E.clickButton('Cancel', popup)
      report.push({ label, status: 'manual', detail: 'could not choose "Other" in the list' })
      return false
    }
    const typed = await E.fillText(I.page, I.otherName, ingredient.inci_name, { root: popup })
    if (!typed.ok) {
      E.clickButton('Cancel', popup)
      report.push({ label, status: 'manual', detail: 'could not type the name under "Other"' })
      return false
    }

    const pct = String(ingredient.percentage ?? '').match(/\d+(\.\d+)?/)
    if (pct) await E.fillText(I.page, I.percentage, pct[0], { root: popup })

    E.clickButton('Save', popup)
    const closed = await E.waitFor(() => !findIngredientPopup(), { timeout: 8000 })
    report.push({
      label,
      status: closed ? 'filled' : 'manual',
      detail: closed ? 'added' : 'popup did not close - check it',
    })
    return Boolean(closed)
  }

  // --- ingredients by Excel import (fast path) ----------------------------------------------

  const findImportPopup = () =>
    Array.from(document.querySelectorAll('.mx-window-active, .modal-dialog, .mx-window')).find(
      (el) => E.isVisible(el) && /Import From Excel/i.test(el.textContent),
    )

  // The ingredient grid is paged (5 rows), so only its "of N" total says how many are really saved.
  function ingredientTotal() {
    const button = E.findButton('Download Template')
    const grid = button && button.closest('.mx-grid')
    const match = grid && grid.textContent.match(/of\s+(\d+)/)
    return match ? Number(match[1]) : null
  }

  async function loadTemplateBytes() {
    const reply = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_INGREDIENT_TEMPLATE' }, (r) => resolve(r || {}))
    })
    if (!reply.base64) throw new Error('could not read the bundled ingredient template')
    const binary = atob(reply.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  // Returns { ok, added, reason }. Never leaves the import popup open.
  async function importIngredientsFile(ingredients) {
    const built = await RP.ingredientImport.buildWorkbook(ingredients, await loadTemplateBytes())
    const before = ingredientTotal()

    if (!E.clickButton('Import')) return { ok: false, reason: 'no Import button' }
    const popup = await E.waitFor(findImportPopup, { timeout: 8000 })
    if (!popup) return { ok: false, reason: 'the import popup did not open' }
    const closePopup = () => {
      const cancel = Array.from(popup.querySelectorAll('button')).find((b) => E.normalize(b.textContent) === 'cancel')
      if (cancel) cancel.click()
    }

    const input = popup.querySelector('input[type="file"]')
    if (!input) {
      closePopup()
      return { ok: false, reason: 'no file box in the import popup' }
    }
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([built.bytes], 'Ingredients.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    // Montaji echoes the chosen file's name into its own text box once it has registered the file.
    const registered = await E.waitFor(
      () => Array.from(popup.querySelectorAll('input[type="text"]')).some((i) => i.value.includes('Ingredients.xlsx')),
      { timeout: 4000 },
    )
    if (!registered) {
      closePopup()
      return { ok: false, reason: 'Montaji did not register the file' }
    }

    const importButton = Array.from(popup.querySelectorAll('button')).find((b) => E.normalize(b.textContent) === 'import')
    if (!importButton) {
      closePopup()
      return { ok: false, reason: 'no Import button in the popup' }
    }
    importButton.click()

    const closed = await E.waitFor(() => !findImportPopup(), { timeout: 25000 })
    if (!closed) {
      const message = (popup.textContent.match(/Please[^.]*\./) || [''])[0].trim()
      closePopup()
      return { ok: false, reason: message || 'Montaji kept the import popup open' }
    }

    await E.sleep(1500)
    const after = ingredientTotal()
    const added = before !== null && after !== null ? after - before : null
    if (added !== null && added < built.count) {
      return { ok: false, partial: true, added, reason: `Montaji took ${added} of ${built.count} rows` }
    }
    return { ok: true, added: added === null ? built.count : added, built }
  }

  async function addIngredients(ingredients, report, prefix) {
    const named = ingredients.filter((i) => i && i.inci_name)
    if (!named.length) return

    // Montaji rejects any row without a percentage, so those are left for a person.
    const hasPercentage = (i) => /\d/.test(String(i.percentage ?? ''))
    const ready = named.filter(hasPercentage)
    const missing = named.filter((i) => !hasPercentage(i))
    if (missing.length) {
      report.push({
        label: `${prefix}Ingredients without a percentage`,
        status: 'manual',
        detail: `Montaji requires one, so add these yourself: ${missing.map((i) => i.inci_name).join(', ')}`,
      })
    }
    if (!ready.length) return

    ui.setStatus(`${prefix}importing ${ready.length} ingredients...`)
    let outcome
    try {
      outcome = await importIngredientsFile(ready)
    } catch (err) {
      outcome = { ok: false, reason: String(err && err.message ? err.message : err) }
    }

    if (outcome.ok) {
      report.push({ label: `${prefix}Ingredients`, status: 'filled', detail: `${outcome.added} imported from Excel` })
      if (outcome.built && outcome.built.approximated.length) {
        report.push({
          label: `${prefix}Approximate percentages`,
          status: 'manual',
          detail: `Written as the first number given - check: ${outcome.built.approximated.join(', ')}`,
        })
      }
      if (outcome.built && outcome.built.skipped.length) {
        report.push({
          label: `${prefix}Ingredients over the file limit`,
          status: 'manual',
          detail: `Add these yourself: ${outcome.built.skipped.join(', ')}`,
        })
      }
      return
    }

    // Slow path: one popup per ingredient. Only reached when the import itself was refused.
    report.push({
      label: `${prefix}Excel import`,
      status: 'info',
      detail: `Did not work (${outcome.reason}); adding ingredients one by one instead.`,
    })
    if (outcome.partial) {
      report.push({
        label: `${prefix}Check ingredients`,
        status: 'manual',
        detail: 'Some rows may already have been imported - check the list for duplicates.',
      })
    }
    for (let i = 0; i < ready.length; i++) {
      ui.setStatus(`${prefix}ingredient ${i + 1} of ${ready.length}...`)
      await addIngredient(ready[i], report)
    }
  }

  async function fillOneVariant(variant, data, index, total, report) {
    const V = F.variant
    const prefix = total > 1 ? `Variant ${index + 1}: ` : ''
    const r = (label, result) => note(report, prefix + label, result)

    r('Barcode', await E.fillText(V.page, V.barcode, variant.barcode))
    r('Colour / shade', await E.fillText(V.page, V.colorShade, variant.color_shade || 'NA'))
    r('Scent / flavour', await E.fillText(V.page, V.scentFlavor, variant.scent_flavor || 'NA'))
    r('Size / volume', await E.fillText(V.page, V.sizeVolume, variant.size_volume))
    r('Unit', await E.fillNativeSelect(V.page, V.volumeUnit, variant.volume_unit))

    if (data.has_production_date !== undefined) {
      r('Has production date', await E.fillRadio(V.hasProductionDate, data.has_production_date))
    }
    if (data.has_expiry_date !== undefined) {
      r('Has expiry date', await E.fillRadio(V.hasExpiryDate, data.has_expiry_date))
    }
    if (data.has_batch_number !== undefined) {
      r('Has batch number', await E.fillRadio(V.hasBatchNumber, data.has_batch_number))
    }
    if (data.has_period_after_opening !== undefined) {
      r('Has period after opening', await E.fillRadio(V.hasPeriodAfterOpening, data.has_period_after_opening))
    }
    if (data.shelf_life) r('Shelf life', await E.fillText(V.page, V.shelfLife, data.shelf_life))
    if (data.shelf_life_period_type) {
      r('Shelf life period', await E.fillNativeSelect(V.page, V.shelfLifePeriod, data.shelf_life_period_type))
    }

    await addIngredients(data.ingredients || [], report, prefix)

    // Montaji's own per-variant check. It only validates and saves; it does not submit anything.
    ui.setStatus(`${prefix}saving and validating...`)
    if (E.clickButton('Save and Validate')) {
      await E.sleep(2500)
      const problems = Array.from(document.querySelectorAll('.mx-validation-message'))
        .filter(E.isVisible)
        .map((el) => el.textContent.trim())
        .filter(Boolean)
      if (problems.length) {
        report.push({ label: `${prefix}Montaji validation`, status: 'manual', detail: problems.slice(0, 4).join(' / ') })
      } else {
        report.push({ label: `${prefix}Montaji validation`, status: 'filled', detail: 'passed' })
      }
    } else {
      info(report, `${prefix}Save and Validate`, 'Button not found - press it yourself on Montaji.')
    }
  }

  // Adding a variant creates a new row in the variants grid, but the form below stays bound to the
  // row that was selected before. The new (last) row has to be clicked for its blank form to load.
  async function selectLastVariantRow() {
    const grid = (E.findButton('Add New Variant') || {}).closest ? E.findButton('Add New Variant').closest('.mx-grid') : null
    if (!grid) return false
    const rows = Array.from(grid.querySelectorAll('tbody tr')).filter(E.isVisible)
    const last = rows[rows.length - 1]
    if (!last) return false
    const cell = last.querySelector('td') || last
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    cell.click()
    return true
  }

  async function fillVariants(data, report) {
    const V = F.variant
    const variants = data.variants && data.variants.length ? data.variants : [{}]

    for (let i = 0; i < variants.length; i++) {
      ui.setStatus(`Variant ${i + 1} of ${variants.length}...`)

      const form = E.findInput(V.page, V.barcode)
      const formIsBlank = form && !form.value.trim()
      if (!(i === 0 && formIsBlank)) {
        if (!E.clickButton('Add New Variant')) {
          info(report, `Variant ${i + 1}`, 'Could not find the "Add New Variant" button.')
          return
        }
        await E.sleep(2000)
        if (!(await selectLastVariantRow())) {
          info(report, `Variant ${i + 1}`, 'Added, but could not select its row in the variants list.')
          return
        }
        // Wait for the blank form of the newly selected row; never write over another variant.
        const blank = await E.waitFor(
          () => {
            const el = E.findInput(V.page, V.barcode)
            return el && !el.value.trim() ? el : null
          },
          { timeout: 10000 },
        )
        if (!blank) {
          info(report, `Variant ${i + 1}`, 'The form still shows the previous variant - stopped to avoid overwriting it.')
          return
        }
      }

      await fillOneVariant(variants[i], data, i, variants.length, report)
    }
  }

  // --- the other steps ----------------------------------------------------------------------

  function certificateNote(data) {
    const country = (data.country_of_origin || '').trim()
    if (!country) return 'Upload the required certificate on Montaji (Free Sale for non-UAE products, GMP for UAE).'
    const uae = /^(uae|u\.a\.e\.?|united arab emirates)$/i.test(country)
    const kind = uae ? 'a GMP certificate' : 'a Certificate of Free Sale'
    const number = data.certificate_number ? ` Certificate number from your documents: ${data.certificate_number}.` : ''
    return `Made in ${country}: Montaji needs ${kind}. Upload it yourself on this step.${number}`
  }

  async function runStep(step, data) {
    const report = []
    if (step === 'general') {
      info(report, 'Company', 'Choose your company yourself, then click Next. RegPilot does not pick it for you.')
    } else if (step === 'productBase') {
      await fillProductBase(data, report)
      info(report, 'Next', 'Check the form, then click Next yourself.')
    } else if (step === 'attachments') {
      info(report, 'Certificate', certificateNote(data))
    } else if (step === 'variants') {
      await fillVariants(data, report)
      info(report, 'Next', 'Check the variant(s) and ingredients, then click Next yourself.')
    } else if (step === 'acknowledgement') {
      info(report, 'Submit', 'Review everything. Tick the declaration and submit yourself - RegPilot never does this.')
    } else {
      info(report, 'Step', 'Open the CPRE form (Services > Consumer Product Registration) first.')
    }
    return report
  }

  async function onFillClicked() {
    if (running || !pending) return
    running = true
    ui.setBusy(true)
    ui.showResults([])
    try {
      const step = detectStep()
      ui.setStatus(`Filling ${STEP_LABELS[step]}...`)
      const report = await runStep(step, pending.data || {})
      ui.showResults(report)
      ui.setStatus('Done. Check the items below, then continue yourself.')
    } catch (err) {
      ui.showResults([{ label: 'Stopped', status: 'manual', detail: String(err && err.message ? err.message : err) }])
      ui.setStatus('Stopped because of an error.')
    } finally {
      running = false
      ui.setBusy(false)
    }
  }

  // --- the floating panel (shadow DOM, so Montaji's CSS cannot touch it) --------------------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag)
    Object.assign(node, props)
    for (const child of children) node.append(child)
    return node
  }

  const STATUS_MARK = { filled: 'Done', manual: 'Do this yourself', skipped: 'Skipped', info: 'Note' }
  const STATUS_COLOR = { filled: '#30d158', manual: '#ff9f0a', skipped: '#8e8e93', info: '#2997ff' }

  function renderPanel() {
    if (document.getElementById(HOST_ID)) return
    const host = el('div', { id: HOST_ID })
    host.style.all = 'initial'
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })

    const style = el('style', {
      textContent: `
        .card { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 340px;
          max-height: 78vh; overflow: auto; background: #1d1d1f; color: #fff; border-radius: 18px;
          padding: 18px; font-family: -apple-system, system-ui, sans-serif;
          box-shadow: 0 10px 40px rgba(0,0,0,.35); }
        .eyebrow { font-size: 12px; font-weight: 600; color: #2997ff; margin: 0 0 4px;
          text-transform: uppercase; letter-spacing: .02em; }
        .title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
        .step { font-size: 12px; color: #cccccc; margin: 0 0 10px; }
        .status { font-size: 13px; line-height: 1.45; color: #cccccc; margin: 0 0 12px; }
        .row { display: flex; gap: 8px; }
        button { font-family: inherit; font-size: 14px; border-radius: 9999px; padding: 10px 14px;
          border: none; cursor: pointer; }
        button:disabled { opacity: .5; cursor: default; }
        .primary { background: #0066cc; color: #fff; flex: 1; }
        .secondary { background: transparent; color: #cccccc; border: 1px solid #444; }
        ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        li { font-size: 12px; line-height: 1.4; border-top: 1px solid #333; padding-top: 8px; }
        li b { display: block; font-size: 11px; margin-bottom: 1px; }
        li span { color: #cccccc; }
      `,
    })

    const stepLine = el('p', { className: 'step' })
    const statusLine = el('p', {
      className: 'status',
      textContent: 'Fills the wizard step you are on. It never presses Next or Submit.',
    })
    const fillBtn = el('button', { className: 'primary', textContent: 'Fill this step' })
    const clearBtn = el('button', { className: 'secondary', textContent: 'Clear' })
    const results = el('ul')

    const card = el('div', { className: 'card' }, [
      el('p', { className: 'eyebrow', textContent: 'RegPilot' }),
      el('p', { className: 'title', textContent: `${pending.productName || 'Product'} is ready to fill` }),
      stepLine,
      statusLine,
      el('div', { className: 'row' }, [fillBtn, clearBtn]),
      results,
    ])
    shadow.append(style, card)

    fillBtn.addEventListener('click', onFillClicked)
    clearBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_FILL_DATA' })
      pending = null
      host.remove()
    })

    ui = {
      setStep: (step) => (stepLine.textContent = STEP_LABELS[step]),
      setStatus: (text) => (statusLine.textContent = text),
      setBusy: (busy) => {
        fillBtn.disabled = busy
        fillBtn.textContent = busy ? 'Filling...' : 'Fill this step'
      },
      showResults: (items) => {
        results.textContent = ''
        for (const item of items) {
          const mark = el('b', { textContent: STATUS_MARK[item.status] || item.status })
          mark.style.color = STATUS_COLOR[item.status] || '#fff'
          results.append(
            el('li', {}, [mark, el('strong', { textContent: item.label }), el('span', { textContent: item.detail ? ` - ${item.detail}` : '' })]),
          )
        }
      },
    }
    ui.setStep(detectStep())
  }

  function show(payload) {
    pending = payload
    if (!document.getElementById(HOST_ID)) renderPanel()
  }

  // Keep the step label current as the person moves through the wizard (it is a single-page app).
  setInterval(() => {
    if (ui && document.getElementById(HOST_ID) && !running) ui.setStep(detectStep())
  }, 1500)

  chrome.runtime.sendMessage({ type: 'GET_FILL_DATA' }, (response) => {
    if (response && response.pendingFill) show(response.pendingFill)
  })

  // Data sent from RegPilot after this Montaji tab was already open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingFill && changes.pendingFill.newValue) {
      show(changes.pendingFill.newValue)
    }
  })
})()
