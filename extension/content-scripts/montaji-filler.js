// RegPilot extension — Montaji-side content script.
// Shows a small floating banner when there's reviewed product data waiting
// to be filled in. Never touches a Submit button, never reads or stores a
// Montaji password — it only writes into the fields it's told about, after
// the person on this page clicks "Fill form" themselves.

const BANNER_HOST_ID = 'regpilot-fill-banner-host'

function renderBanner(product) {
  if (document.getElementById(BANNER_HOST_ID)) return

  const host = document.createElement('div')
  host.id = BANNER_HOST_ID
  host.style.all = 'initial'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    .card {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      width: 320px;
      background: #1d1d1f;
      color: #ffffff;
      border-radius: 18px;
      padding: 20px;
      font-family: -apple-system, system-ui, sans-serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.35);
    }
    .eyebrow { font-size: 12px; font-weight: 600; color: #2997ff; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.02em; }
    .title { font-size: 16px; font-weight: 600; margin: 0 0 10px; }
    .body { font-size: 13px; line-height: 1.5; color: #cccccc; margin: 0 0 16px; white-space: pre-line; }
    .row { display: flex; gap: 8px; }
    button { font-family: inherit; font-size: 14px; border-radius: 9999px; padding: 10px 16px; border: none; cursor: pointer; }
    .primary { background: #0066cc; color: #fff; flex: 1; }
    .secondary { background: transparent; color: #cccccc; border: 1px solid #444; }
  `
  shadow.appendChild(style)

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <p class="eyebrow">RegPilot</p>
    <p class="title">${escapeHtml(product.productName || 'Product')} is ready to fill</p>
    <p class="body">Click Fill to type the reviewed data into this form. Nothing is submitted — you check everything and click Montaji's own Submit button yourself.</p>
    <div class="row">
      <button class="primary" id="regpilot-fill-btn">Fill form</button>
      <button class="secondary" id="regpilot-dismiss-btn">Dismiss</button>
    </div>
  `
  shadow.appendChild(card)

  shadow.getElementById('regpilot-dismiss-btn').addEventListener('click', () => {
    host.remove()
  })

  shadow.getElementById('regpilot-fill-btn').addEventListener('click', () => {
    const results = fillSimpleFields(product.data || {})
    const notConfigured = results.filter((r) => r.status === 'selector-not-configured')
    const notFound = results.filter((r) => r.status === 'not-found')
    const filled = results.filter((r) => r.status === 'filled')

    let summary
    if (!MONTAJI_READY) {
      summary =
        "This extension's field mapping hasn't been configured for Montaji's real form yet — nothing was filled. See extension/config/field-map.js."
    } else {
      summary = `Filled ${filled.length} of ${results.length} fields.`
      if (notFound.length) {
        summary += `\nNot found on page: ${notFound.map((r) => r.field).join(', ')}`
      }
      if (notConfigured.length) {
        summary += `\nNot yet mapped: ${notConfigured.map((r) => r.field).join(', ')}`
      }
      summary += '\nIngredients need to be entered manually until row-filling is built.'
    }

    card.querySelector('.body').textContent = summary
    card.querySelector('.row').remove()

    chrome.runtime.sendMessage({ type: 'CLEAR_FILL_DATA' })
  })
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

chrome.runtime.sendMessage({ type: 'GET_FILL_DATA' }, (response) => {
  if (response && response.pendingFill) {
    renderBanner(response.pendingFill)
  }
})
