import { useEffect, useState } from 'react'
import type { DocumentType, ExtractedProductData } from './types'

// One uploaded document, carried to the extension so it can be attached on Montaji after the person
// confirms there. Bytes are base64 because they cross the page/extension boundary as plain data.
export type QueuedFile = {
  id: string
  docType: DocumentType
  name: string
  type: string
  size: number
  base64: string
}

const EXTENSION_READY_ATTR = 'data-regpilot-extension'

export function useRegPilotExtension() {
  const [installed, setInstalled] = useState(
    () => document.documentElement.getAttribute(EXTENSION_READY_ATTR) === 'installed',
  )

  useEffect(() => {
    if (installed) return
    const handler = () => setInstalled(true)
    window.addEventListener('regpilot:extension-ready', handler)
    return () => window.removeEventListener('regpilot:extension-ready', handler)
  }, [installed])

  return installed
}

export type FillRequestResult = { ok: boolean; error?: string }

export function requestMontajiFill(
  productName: string,
  data: ExtractedProductData,
  files: QueuedFile[] = [],
) {
  return new Promise<FillRequestResult>((resolve) => {
    let done = false
    const finish = (result: FillRequestResult) => {
      if (done) return
      done = true
      window.removeEventListener('regpilot:fill-queued', handler)
      clearTimeout(timer)
      resolve(result)
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as FillRequestResult | undefined
      finish({ ok: Boolean(detail?.ok), error: detail?.error })
    }
    window.addEventListener('regpilot:fill-queued', handler)
    // No answer usually means the extension was reloaded after this page opened.
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error:
            'The extension did not answer. If you reloaded it recently, refresh this page (and the Montaji tab) and try again.',
        }),
      10000,
    )
    window.dispatchEvent(
      new CustomEvent('regpilot:fill-request', { detail: { productName, data, files } }),
    )
  })
}

const EXTENSION_VERSION_ATTR = 'data-regpilot-extension-version'
// The extension's script can run a moment after the page does, so "not found" is only declared after this.
const DETECT_GRACE_MS = 2000
const POLL_MS = 1500

export const LATEST_EXTENSION_VERSION: string = __EXTENSION_VERSION__
export const EXTENSION_DOWNLOAD_URL = '/downloads/regpilot-extension.zip'

export type ExtensionState = 'checking' | 'missing' | 'outdated' | 'ready'

function isOlder(installed: string, latest: string) {
  const a = installed.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff < 0
  }
  return false
}

function readExtension() {
  const root = document.documentElement
  if (root.getAttribute(EXTENSION_READY_ATTR) !== 'installed') return null
  // Builds from before versions were announced carry no version, and are by definition old.
  return { version: root.getAttribute(EXTENSION_VERSION_ATTR) }
}

export function useExtensionStatus() {
  const [found, setFound] = useState(readExtension)
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    // Only replace the state when something changed, so polling does not re-render the page.
    const update = () =>
      setFound((prev) => {
        const next = readExtension()
        return prev?.version === next?.version && Boolean(prev) === Boolean(next) ? prev : next
      })
    window.addEventListener('regpilot:extension-ready', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    // The extension can be installed while this page is open, and its announcement can be missed,
    // so keep looking: the status then turns green on its own, without a reload or a trip to another page.
    const poll = setInterval(update, POLL_MS)
    const timer = setTimeout(() => setGaveUp(true), DETECT_GRACE_MS)
    return () => {
      window.removeEventListener('regpilot:extension-ready', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
      clearInterval(poll)
      clearTimeout(timer)
    }
  }, [])

  const installedVersion = found?.version ?? null
  let state: ExtensionState
  if (!found) state = gaveUp ? 'missing' : 'checking'
  else if (!installedVersion || isOlder(installedVersion, LATEST_EXTENSION_VERSION)) state = 'outdated'
  else state = 'ready'
  return { state, installedVersion, latestVersion: LATEST_EXTENSION_VERSION }
}
