import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  useRegPilotExtension,
  requestMontajiFill,
  type QueuedFile,
} from '../lib/useRegPilotExtension'
import type { ExtractedProductData, ProductDocument } from '../lib/types'

// Keeps what is held in the extension (and in memory here) to a sensible size.
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export default function MontajiFillPanel({
  productName,
  data,
  documents,
}: {
  productName: string
  data: ExtractedProductData
  documents: ProductDocument[]
}) {
  const installed = useRegPilotExtension()
  const [queuing, setQueuing] = useState(false)
  const [queued, setQueued] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [sentFiles, setSentFiles] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  async function handleFill() {
    setQueuing(true)
    setNotice(null)
    setFailure(null)

    const files: QueuedFile[] = []
    const left: string[] = []
    let total = 0
    for (const doc of documents) {
      const { data: blob } = await supabase.storage.from('product-documents').download(doc.storage_path)
      if (!blob || total + blob.size > MAX_TOTAL_BYTES) {
        left.push(doc.file_name)
        continue
      }
      total += blob.size
      files.push({
        id: doc.id,
        docType: doc.doc_type,
        name: doc.file_name,
        type: doc.content_type,
        size: blob.size,
        base64: await blobToBase64(blob),
      })
    }

    const result = await requestMontajiFill(productName, data, files)
    setQueuing(false)
    setQueued(result.ok)
    setFailure(result.ok ? null : (result.error ?? 'The extension did not accept the data.'))
    setSentFiles(files.length)
    if (left.length) {
      setNotice(`Not sent to the extension (too large or unreadable): ${left.join(', ')}`)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas px-6 py-6">
      <h2 className="font-display text-[18px] font-semibold text-ink">Fill on Montaji</h2>

      {!installed ? (
        <>
          <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
            The RegPilot filling tool (a browser add-on) isn't installed in this browser.{' '}
            <Link to="/extension" className="text-primary underline">
              Get the filling tool
            </Link>
            , then come back to this page.
          </p>
        </>
      ) : queued ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="font-text text-[14px] leading-[1.47] text-status-approved">
            ✓ Sent to the extension. Open Montaji in another tab: a RegPilot panel will appear with a
            "Fill this step" button for each step of the wizard. Nothing submits automatically; you
            review and click Next and Submit yourself on Montaji.
            {sentFiles > 0 &&
              ` ${sentFiles} document${sentFiles === 1 ? ' is' : 's are'} ready too: the panel will ask you to confirm before uploading any of them.`}
          </p>
          <button
            type="button"
            onClick={() => setQueued(false)}
            className="self-start rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform"
          >
            Send again
          </button>
          <p className="font-text text-[13px] text-ink-muted-48">
            Use this after pressing Clear in the Montaji panel, or to send changes you saved since.
          </p>
        </div>
      ) : (
        <>
          <p className="font-text text-[14px] leading-[1.47] text-ink-muted-80">
            Stay logged into Montaji in another tab. This sends your reviewed data to the
            extension — it only fills a step when you click "Fill this step" there yourself.
            {documents.length > 0 &&
              ' Your uploaded documents travel with it, and are only attached on Montaji after you confirm there.'}
            {' It stays in the extension for up to 8 hours, until you press Clear, or until you sign out of RegPilot.'}
          </p>
          <button
            type="button"
            onClick={handleFill}
            disabled={queuing}
            className="self-start rounded-full bg-primary px-[18px] py-[10px] font-text text-[15px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
          >
            {queuing ? 'Sending…' : failure ? 'Try again' : 'Send to extension'}
          </button>
          {failure && (
            <p role="alert" className="font-text text-[14px] leading-[1.47] text-status-rejected">
              Could not send to the extension. {failure}
            </p>
          )}
        </>
      )}
      {notice && <p className="font-text text-[13px] text-status-rejected">{notice}</p>}
    </div>
  )
}
