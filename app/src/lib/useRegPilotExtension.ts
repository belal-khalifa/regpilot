import { useEffect, useState } from 'react'
import type { ExtractedProductData } from './types'

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

export function requestMontajiFill(productName: string, data: ExtractedProductData) {
  return new Promise<boolean>((resolve) => {
    const handler = (event: Event) => {
      window.removeEventListener('regpilot:fill-queued', handler)
      resolve(Boolean((event as CustomEvent).detail?.ok))
    }
    window.addEventListener('regpilot:fill-queued', handler)
    window.dispatchEvent(
      new CustomEvent('regpilot:fill-request', { detail: { productName, data } }),
    )
    // Safety timeout in case the extension doesn't respond
    setTimeout(() => {
      window.removeEventListener('regpilot:fill-queued', handler)
      resolve(false)
    }, 2000)
  })
}
