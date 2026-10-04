// RegPilot extension — background service worker.
// Holds the one "pending fill" payload in local storage until the Montaji
// content script picks it up. No network calls happen here — this extension
// never talks to RegPilot's servers or Montaji directly, it only relays data
// that already left the user's own logged-in RegPilot browser tab.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'STORE_FILL_DATA') {
    chrome.storage.local.set({ pendingFill: message.payload }, () => {
      sendResponse({ ok: true })
    })
    return true // keep the message channel open for the async sendResponse
  }

  if (message.type === 'GET_FILL_DATA') {
    chrome.storage.local.get('pendingFill', (result) => {
      sendResponse({ pendingFill: result.pendingFill ?? null })
    })
    return true
  }

  if (message.type === 'CLEAR_FILL_DATA') {
    chrome.storage.local.remove('pendingFill', () => {
      sendResponse({ ok: true })
    })
    return true
  }

  return false
})
