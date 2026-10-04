// RegPilot extension — generic form-fill engine.
// Plain script (shares global scope with field-map.js and montaji-filler.js).
//
// Government portals are frequently built with React/Angular/Vue, which track
// input values internally and ignore a plain `element.value = x` assignment.
// setNativeValue uses the framework-agnostic trick of calling the native
// <input>/<textarea> value setter directly, then dispatching real "input" and
// "change" events, so the page's own JS sees the change the same way it would
// if a person had typed it.

function setNativeValue(element, value) {
  const proto = Object.getPrototypeOf(element)
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value)
  } else {
    element.value = value
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillField(selector, value) {
  if (value === undefined || value === null || value === '') {
    return { selector, status: 'skipped-empty' }
  }
  const element = document.querySelector(selector)
  if (!element) {
    return { selector, status: 'not-found' }
  }

  const tag = element.tagName.toLowerCase()
  if (tag === 'select') {
    const option = Array.from(element.options).find(
      (o) => o.value === value || o.textContent.trim() === value,
    )
    if (!option) return { selector, status: 'option-not-found', value }
    setNativeValue(element, option.value)
    return { selector, status: 'filled', value: option.value }
  }

  if (tag === 'input' || tag === 'textarea') {
    setNativeValue(element, value)
    return { selector, status: 'filled', value }
  }

  return { selector, status: 'unsupported-element', tag }
}

// Fills every simple field in MONTAJI_FIELD_MAP from the reviewed RegPilot
// data, and reports what happened with each one so the popup/banner can show
// a clear summary instead of silently failing.
function fillSimpleFields(data) {
  const results = []
  for (const [dataKey, selector] of Object.entries(MONTAJI_FIELD_MAP)) {
    if (selector.startsWith('TODO_SELECTOR')) {
      results.push({ field: dataKey, status: 'selector-not-configured' })
      continue
    }
    let value = data[dataKey]
    if (dataKey === 'label_claims' && Array.isArray(value)) {
      value = value.join(', ')
    }
    const result = fillField(selector, value)
    results.push({ field: dataKey, ...result })
  }
  return results
}
