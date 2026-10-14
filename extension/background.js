// RegPilot extension — background service worker.
// Holds the one "pending fill" payload in local storage until the Montaji
// content script picks it up. No network calls happen here — this extension
// never talks to RegPilot's servers or Montaji directly, it only relays data
// that already left the user's own logged-in RegPilot browser tab.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'STORE_FILL_DATA') {
    // The document bytes travel with the product but are kept apart from it, so the small
    // product record stays quick to read and a file is only loaded when it is about to be uploaded.
    const { files = [], ...rest } = message.payload || {}
    const pendingFill = {
      ...rest,
      documents: files.map(({ id, docType, name, type, size }) => ({ id, docType, name, type, size })),
    }
    const pendingFiles = {}
    for (const file of files) pendingFiles[file.id] = file.base64
    chrome.storage.local.set({ pendingFiles }, () => {
      chrome.storage.local.set({ pendingFill }, () => sendResponse({ ok: !chrome.runtime.lastError }))
    })
    return true // keep the message channel open for the async sendResponse
  }

  if (message.type === 'GET_FILE') {
    chrome.storage.local.get('pendingFiles', (result) => {
      const files = result.pendingFiles || {}
      sendResponse({ base64: files[message.id] || null })
    })
    return true
  }

  if (message.type === 'GET_FILL_DATA') {
    chrome.storage.local.get('pendingFill', (result) => {
      sendResponse({ pendingFill: result.pendingFill ?? null })
    })
    return true
  }

  if (message.type === 'CLEAR_FILL_DATA') {
    chrome.storage.local.remove(['pendingFill', 'pendingFiles'], () => {
      sendResponse({ ok: true })
    })
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
