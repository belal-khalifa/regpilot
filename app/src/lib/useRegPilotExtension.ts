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
