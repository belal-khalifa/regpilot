// RegPilot extension - generic form-filling helpers for Montaji's Mendix pages.
//
// Plain script sharing one global scope with field-map.js and montaji-filler.js. Every behaviour
// here was verified against the live portal (see ../MONTAJI_WALKTHROUGH_NOTES.md):
//  - Text boxes only commit to Montaji's model on a blur, so commitText fires the whole
//    focus -> key/input/change -> blur sequence rather than just setting a value.
//  - Searchable dropdowns (Select2) open on a synthetic mousedown and pick on a synthetic mouseup.
//    They load lazily and depend on each other, so every pick waits for real options to appear.

;(function () {
  const RP = (globalThis.RegPilot = globalThis.RegPilot || {})

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function waitFor(check, { timeout = 8000, interval = 150 } = {}) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const value = check()
      if (value) return value
      await sleep(interval)
    }
    return null
  }

  const isVisible = (el) => !!el && el.getClientRects().length > 0

  const normalize = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

  function fire(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  }

  // Finds a visible Mendix input by its stable "<Page>.<widget>" part, ignoring the unstable
  // module prefix and runtime suffix. "textBox1" must not match "textBox10".
  function findInput(page, widget, { tag = 'input,select,textarea', root = document } = {}) {
    const pattern = new RegExp(`\\.${page}\\.${widget}(_[a-z]{3}_\\d+(_\\d+)?)?$`)
    const candidates = root.querySelectorAll(tag)
    for (const el of candidates) {
      if (el.id && pattern.test(el.id) && isVisible(el) && !el.disabled) return el
    }
    return null
  }

  function findButton(text, root = document) {
    const wanted = normalize(text)
    for (const el of root.querySelectorAll('button, a.btn, [role="button"]')) {
      if (isVisible(el) && normalize(el.textContent) === wanted) return el
    }
    return null
  }

  function clickButton(text, root = document) {
    const wanted = normalize(text)
    // The guard protects the wizard itself; inside a popup this extension opened, backing out is fine.
    if (root === document && (RP.FORBIDDEN_BUTTONS || []).includes(wanted)) {
      throw new Error(`Refusing to press "${text}" - that is for the person to do.`)
    }
    const button = findButton(text, root)
    if (!button) return false
    button.click()
    return true
  }

  // --- plain text boxes ---------------------------------------------------------------------

  function commitText(el, value) {
    const text = String(value)
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    el.dispatchEvent(new FocusEvent('focus'))
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    setter.call(el, text)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('blur'))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    return el.value === text
  }

  async function fillText(page, widget, value, { root = document, timeout = 6000 } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return { ok: false, skipped: true, reason: 'no-value' }
    }
    const el = await waitFor(() => findInput(page, widget, { tag: 'input,textarea', root }), { timeout })
    if (!el) return { ok: false, reason: 'field-not-found' }
    return commitText(el, value) ? { ok: true } : { ok: false, reason: 'value-did-not-stick' }
  }

  // --- native <select> ----------------------------------------------------------------------

  async function fillNativeSelect(page, widget, wanted, { root = document, timeout = 6000 } = {}) {
    if (!wanted) return { ok: false, skipped: true, reason: 'no-value' }
    const el = await waitFor(() => findInput(page, widget, { tag: 'select', root }), { timeout })
    if (!el) return { ok: false, reason: 'field-not-found' }
    const want = normalize(wanted)
    const option = Array.from(el.options).find(
      (o) => normalize(o.value) === want || normalize(o.textContent) === want,
    )
    if (!option) return { ok: false, reason: 'option-not-found' }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    el.dispatchEvent(new FocusEvent('focus'))
    setter.call(el, option.value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('blur'))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    return el.value === option.value ? { ok: true } : { ok: false, reason: 'value-did-not-stick' }
  }

  // --- Yes / No radios ----------------------------------------------------------------------

  async function fillRadio(widget, answer, { root = document, timeout = 6000 } = {}) {
    if (answer === undefined || answer === null) return { ok: false, skipped: true, reason: 'no-value' }
    const wanted = answer ? 'yes' : 'no'
    const radio = await waitFor(
      () =>
        Array.from(root.querySelectorAll(`.mx-name-${widget} input[type="radio"]`)).find(
          (r) => normalize(r.value) === wanted && isVisible(r) && !r.disabled,
        ),
      { timeout },
    )
    if (!radio) return { ok: false, reason: 'field-not-found' }
    radio.click()
    await sleep(150)
    return radio.checked ? { ok: true } : { ok: false, reason: 'value-did-not-stick' }
  }

  // --- searchable (Select2) dropdowns -------------------------------------------------------

  const optionEls = () =>
    Array.from(document.querySelectorAll('.select2-results__option')).filter(isVisible)

  function closeOpenSelect2() {
    for (const open of document.querySelectorAll('.select2-container--open .select2-selection')) {
      fire(open, 'mousedown')
    }
  }

  // matcher(optionText) -> number (0 = no match, higher = better). Default: exact, ignoring case/space.
  async function select2Pick(wrapperSelectorOrEl, wantedText, { match, root = document, timeout = 9000 } = {}) {
    const wrapper =
      typeof wrapperSelectorOrEl === 'string'
        ? await waitFor(
            () => {
              const found = Array.from(root.querySelectorAll(`.${wrapperSelectorOrEl}`)).find(isVisible)
              return found || null
            },
            { timeout: 6000 },
          )
        : wrapperSelectorOrEl
    const selection = wrapper && wrapper.querySelector('.select2-selection')
    if (!selection) return { ok: false, reason: 'field-not-found' }

    const matcher = match || ((text) => (normalize(text) === normalize(wantedText) ? 100 : 0))

    const rendered = wrapper.querySelector('.select2-selection__rendered')
    if (rendered && matcher(rendered.textContent) >= 100) return { ok: true, already: true }

    closeOpenSelect2()
    await sleep(150)
    fire(selection, 'mousedown')

    // Options arrive from the server; "Searching..." and "No results found." are not real options.
    const options = await waitFor(
      () => {
        const items = optionEls().filter((li) => !/^(searching|no results found)/i.test(li.textContent.trim()))
        return items.length ? items : null
      },
      { timeout },
    )
    if (!options) {
      closeOpenSelect2()
      return { ok: false, reason: 'no-options-loaded' }
    }

    let best = null
    let bestScore = 0
    for (const li of options) {
      const score = matcher(li.textContent.trim())
      if (score > bestScore) {
        best = li
        bestScore = score
      }
    }
    if (!best) {
      closeOpenSelect2()
      return { ok: false, reason: 'option-not-found' }
    }

    fire(best, 'mouseup')
    await sleep(900) // dependent dropdowns reload after a pick
    return { ok: true, picked: best.textContent.trim() }
  }

  // Scores a country name against Montaji's spelling: exact (via alias if needed) beats starts-with
  // beats contains. Returns 0 when nothing is close enough to trust.
  function countryMatcher(wanted) {
    const aliases = RP.COUNTRY_ALIASES || {}
    const raw = normalize(wanted)
    const target = aliases[raw] || raw
    return (optionText) => {
      const opt = normalize(optionText)
      if (!opt || !target) return 0
      if (opt === target) return 100
      if (opt.startsWith(target + ' ') || opt.startsWith(target + ',')) return 60
      if (target.length >= 5 && opt.includes(target)) return 40
      return 0
    }
  }

  RP.engine = {
    sleep,
    waitFor,
    isVisible,
    normalize,
    findInput,
    findButton,
    clickButton,
    commitText,
    fillText,
    fillNativeSelect,
    fillRadio,
    select2Pick,
    closeOpenSelect2,
    countryMatcher,
  }
})()
