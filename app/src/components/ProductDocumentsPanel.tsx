import { useRef, useState } from 'react'
import { documentChecklist, documentKind } from '../lib/documentChecklist'
import { expandDrop, filesFromDataTransfer, type SkippedFile } from '../lib/documentDrop'
import {
  DOCUMENT_KIND_LABELS,
  type ExtractedProductData,
  type ProductDocument,
} from '../lib/types'

// One place to drop all of a product's documents. The files are uploaded unsorted; reading them
// with AI works out what each one is, and the checklist below shows what is found and what is missing.
export default function ProductDocumentsPanel({
  documents,
  data,
  sorted,
  disabled,
  onFiles,
  onDelete,
}: {
  documents: ProductDocument[]
  data: ExtractedProductData
  // True once the documents have been read, so the checklist can say found / missing.
  sorted: boolean
  disabled: boolean
  onFiles: (
    files: File[],
    onProgress: (done: number) => void,
  ) => Promise<{ error: string | null; uploaded: number }>
  onDelete: (doc: ProductDocument) => Promise<{ error: string | null }>
}) {
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<SkippedFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handle(input: File[]) {
    if (input.length === 0 || busy || disabled) return
    setError(null)
    setNotice(null)
    setSkipped([])
    setBusy('Opening files…')
    const { files, skipped } = await expandDrop(
      input,
      documents.map((d) => d.file_name),
    )
    setSkipped(skipped)
    if (files.length === 0) {
      setBusy(null)
      if (skipped.length === 0) setError('No documents were found in what you dropped.')
      return
    }
    setBusy(`Uploading 0 of ${files.length}…`)
    const { error, uploaded } = await onFiles(files, (done) =>
      setBusy(`Uploading ${done} of ${files.length}…`),
    )
    if (error) setError(error)
    if (uploaded > 0) {
      setNotice(
        `${uploaded === 1 ? '1 document' : `${uploaded} documents`} uploaded. Add more documents for this same product, or press Read documents with AI below to start.`,
      )
    }
    setBusy(null)
  }

  function fromInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    handle(files)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handle(await filesFromDataTransfer(e.dataTransfer))
  }

  const checklist = documentChecklist(documents, data)
  const blocked = disabled || !!busy

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-[18px] font-semibold text-ink">Documents</h2>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!blocked) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-hairline bg-surface-pearl'
        }`}
      >
        <p className="font-text text-[17px] font-semibold text-ink">
          {busy ?? 'Drop all of this product’s documents here'}
        </p>
        <p className="max-w-[420px] font-text text-[14px] leading-[1.47] text-ink-muted-80">
          One product at a time. A zip, a folder or separate PDFs and images all work. We work
          out what each file is.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            disabled={blocked}
            onClick={() => filesRef.current?.click()}
            className="rounded-full bg-primary px-5 py-2 font-text text-[14px] text-on-primary active:scale-95 transition-transform disabled:opacity-60"
          >
            Choose files or a zip
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => folderRef.current?.click()}
            // Phones cannot pick a whole folder, so the button only shows on wider screens.
            className="hidden sm:block rounded-full border border-hairline bg-canvas px-5 py-2 font-text text-[14px] text-primary active:scale-95 transition-transform disabled:opacity-60"
          >
            Choose a folder
          </button>
        </div>
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="application/pdf,image/*,.zip,application/zip"
          onChange={fromInput}
          className="hidden"
        />
        <input
          ref={folderRef}
          type="file"
          // Not in React's types, but every desktop browser supports picking a whole folder.
          {...{ webkitdirectory: '' }}
          onChange={fromInput}
          className="hidden"
        />
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-sm bg-status-approved/10 px-4 py-3 font-text text-[14px] leading-[1.47] text-status-approved"
        >
          {notice}
        </p>
      )}
      {error && <p className="font-text text-[13px] text-status-rejected">{error}</p>}
      {skipped.length > 0 && (
        <div className="rounded-sm bg-canvas-parchment px-4 py-3">
          <p className="font-text text-[13px] font-semibold text-ink-muted-80">Left out</p>
          <ul className="mt-1 flex flex-col gap-1">
            {skipped.map((s, i) => (
              <li key={`${s.name}-${i}`} className="font-text text-[13px] text-ink-muted-80 break-words">
                {s.name}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => {
            const kind = documentKind(doc, data.document_inventory)
            return (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-sm bg-canvas-parchment px-4 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-text text-[13px] text-ink">{doc.file_name}</span>
                  <span
                    className={`font-text text-[12px] ${
                      kind === 'unrelated' ? 'text-status-submitted' : 'text-ink-muted-48'
                    }`}
                  >
                    {kind ? DOCUMENT_KIND_LABELS[kind] : 'Sorted when the documents are read'}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => onDelete(doc)}
                  className="shrink-0 font-text text-[13px] text-status-rejected disabled:opacity-60"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-hairline p-5">
        <p className="font-text text-[15px] font-semibold text-ink">
          {sorted ? 'Documents found and missing' : 'What to include'}
        </p>
        <ul className="flex flex-col gap-3">
          {checklist.map((item) => {
            const found = item.files.length > 0
            return (
              <li key={item.label} className="flex gap-3">
                <span
                  aria-hidden
                  className={`mt-[1px] font-text text-[15px] font-semibold ${
                    !sorted ? 'text-ink-muted-48' : found ? 'text-status-approved' : 'text-status-rejected'
                  }`}
                >
                  {!sorted ? '•' : found ? '✓' : '✕'}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="font-text text-[14px] text-ink">
                    {item.label}
                    {sorted && (
                      <span className={found ? 'text-status-approved' : 'text-status-rejected'}>
                        {found ? ' · found' : ' · missing'}
                      </span>
                    )}
                  </span>
                  <span className="font-text text-[13px] text-ink-muted-48 break-words">
                    {sorted && found ? item.files.join(', ') : item.hint}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
