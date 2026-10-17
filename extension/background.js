// RegPilot extension — background service worker.
// Holds the one "pending fill" payload in local storage until the Montaji
// content script picks it up. No network calls happen here — this extension
// never talks to RegPilot's servers or Montaji directly, it only relays data
// that already left the user's own logged-in RegPilot browser tab.

// Queued products and their documents are sensitive, so they are not kept indefinitely: they expire
// after 8 hours, and are also dropped when the browser starts and when the person signs out of RegPilot.
const MAX_AGE_MS = 8 * 60 * 60 * 1000

function clearQueue(done) {
  chrome.storage.local.remove(['pendingFill', 'pendingFiles'], done)
}

// Calls back with the queued product, or null if there is none or it has expired (and then clears it).
function readQueue(callback) {
  chrome.storage.local.get('pendingFill', (result) => {
    const pending = result.pendingFill ?? null
    if (pending && pending.queuedAt && Date.now() - pending.queuedAt > MAX_AGE_MS) {
      clearQueue(() => callback(null))
    } else {
      callback(pending)
    }
  })
}

chrome.runtime.onStartup.addListener(() => clearQueue())
readQueue(() => {}) // the worker waking up is a good moment to drop an expired queue

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'STORE_FILL_DATA') {
    // The document bytes travel with the product but are kept apart from it, so the small
    // product record stays quick to read and a file is only loaded when it is about to be uploaded.
    const { files = [], ...rest } = message.payload || {}
    const pendingFill = {
      ...rest,
      queuedAt: Date.now(),
      documents: files.map(({ id, docType, name, type, size }) => ({ id, docType, name, type, size })),
    }
    const pendingFiles = {}
    for (const file of files) pendingFiles[file.id] = file.base64
    chrome.storage.local.set({ pendingFiles }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: `Could not store the documents: ${chrome.runtime.lastError.message}` })
        return
      }
      chrome.storage.local.set({ pendingFill }, () => {
        if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        else sendResponse({ ok: true })
      })
    })
    return true // keep the message channel open for the async sendResponse
  }

  if (message.type === 'GET_FILE') {
    readQueue((pending) => {
      if (!pending) return sendResponse({ base64: null })
      chrome.storage.local.get('pendingFiles', (result) => {
        const files = result.pendingFiles || {}
        sendResponse({ base64: files[message.id] || null })
      })
    })
    return true
  }

  if (message.type === 'GET_FILL_DATA') {
    readQueue((pending) => sendResponse({ pendingFill: pending }))
    return true
  }

  if (message.type === 'CLEAR_FILL_DATA') {
    clearQueue(() => sendResponse({ ok: true }))
    return true
  }

  // The Montaji page's own security rules can block a page script from reading files inside the
  // extension, so the ingredient spreadsheet template is read here and handed over as base64.
  if (message.type === 'GET_INGREDIENT_TEMPLATE') {
    fetch(chrome.runtime.getURL('assets/Ingredient_sample.xlsx'))
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        }
        sendResponse({ base64: btoa(binary) })
      })
      .catch((error) => sendResponse({ error: String(error) }))
    return true
  }

  return false
})
