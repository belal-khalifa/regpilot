import { useState } from 'react'
import { useRegPilotExtension, requestMontajiFill } from '../lib/useRegPilotExtension'
import type { ExtractedProductData } from '../lib/types'

export default function MontajiFillPanel({
  productName,
  data,
}: {
  productName: string
  data: ExtractedProductData
}) {
  const installed = useRegPilotExtension()
  const [queuing, setQueuing] = useState(false)
  const [queued, setQueued] = useState(false)

  async function handleFill() {
    setQueuing(true)
    const ok = await requestMontajiFill(productName, data)
    setQueuing(false)
    setQueued(ok)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas px-6 py-6">
      <h2 className="font-display text-[18px] font-semibold text-ink">Fill on Montaji</h2>

      {!installed ? (
        <>
          <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
            The RegPilot browser extension isn't detected in this browser. Install it, then come
            back to this page.
          </p>
          <p className="font-text text-[13px] text-ink-muted-48">
            (Dev build: load the <code>extension</code> folder as an unpacked extension via
            chrome://extensions.)
          </p>
        </>
      ) : queued ? (
        <p className="font-text text-[14px] leading-[1.47] text-status-approved">
          Queued. Open Montaji in another tab — a RegPilot banner will appear with a "Fill form"
          button. Nothing submits automatically; you review and click Submit yourself on Montaji.
        </p>
      ) : (
        <>
          <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
            Stay logged into Montaji in another tab. This sends your reviewed data to the
            extension — it only fills the form when you click "Fill form" there yourself.
          </p>
          <button
            type="button"
            onClick={handleFill}
            disabled={queuing}
            className="self-start rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
          >
            {queuing ? 'Sending…' : 'Send to extension'}
          </button>
        </>
      )}
    </div>
  )
}
