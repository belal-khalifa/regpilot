// RegPilot extension — bridge content script.
// Runs only on the RegPilot web app. Its job is narrow:
//  1. Announce that the extension is installed, so the web app can show
//     "Fill on Montaji" instead of "Install the extension".
//  2. Relay a fill request the web page dispatches (after the user reviews
//     and approves a product) into the extension's local storage.
// It never reads anything else off the page, and never talks to Montaji.

const EXTENSION_READY_ATTR = 'data-regpilot-extension'

function announceReady() {
  document.documentElement.setAttribute(EXTENSION_READY_ATTR, 'installed')
  window.dispatchEvent(new CustomEvent('regpilot:extension-ready'))
}

announceReady()

window.addEventListener('regpilot:fill-request', (event) => {
  const payload = event.detail
  chrome.runtime.sendMessage({ type: 'STORE_FILL_DATA', payload }, (response) => {
    const ok = Boolean(response && response.ok)
    window.dispatchEvent(
      new CustomEvent('regpilot:fill-queued', { detail: { ok } }),
    )
  })
})
