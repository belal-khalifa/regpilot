// RegPilot extension — bridge content script.
// Runs only on the RegPilot web app. Its job is narrow:
//  1. Announce that the extension is installed, so the web app can show
//     "Fill on Montaji" instead of "Install the extension".
//  2. Relay a fill request the web page dispatches (after the user reviews
//     and approves a product) into the extension's local storage.
// It never reads anything else off the page, and never talks to Montaji.

const EXTENSION_READY_ATTR = 'data-regpilot-extension'
const EXTENSION_VERSION_ATTR = 'data-regpilot-extension-version'

function announceReady() {
  document.documentElement.setAttribute(EXTENSION_READY_ATTR, 'installed')
  // Lets the web app warn when this build is older than the one it offers for download.
  document.documentElement.setAttribute(EXTENSION_VERSION_ATTR, chrome.runtime.getManifest().version)
  window.dispatchEvent(new CustomEvent('regpilot:extension-ready'))
}

announceReady()

window.addEventListener('regpilot:fill-request', (event) => {
  const reply = (detail) => window.dispatchEvent(new CustomEvent('regpilot:fill-queued', { detail }))
  const payload = event.detail

  // After the extension is reloaded, an already-open page keeps a dead copy of this script.
  if (!chrome.runtime || !chrome.runtime.id) {
    reply({ ok: false, error: 'The extension was reloaded after this page opened. Refresh this page and try again.' })
    return
  }
  try {
    chrome.runtime.sendMessage({ type: 'STORE_FILL_DATA', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reply({ ok: false, error: chrome.runtime.lastError.message })
      } else if (!response || !response.ok) {
        reply({ ok: false, error: (response && response.error) || 'The extension did not accept the data.' })
      } else {
        reply({ ok: true })
      }
    })
  } catch (err) {
    reply({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

// The person signed out of RegPilot: whatever was queued for Montaji is dropped with that sign-in.
window.addEventListener('regpilot:signed-out', () => {
  try {
    if (chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type: 'CLEAR_FILL_DATA' })
  } catch (_) {
    // the extension was reloaded; its storage is cleared on the next start anyway
  }
})
