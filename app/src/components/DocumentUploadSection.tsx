import { useRef, useState } from 'react'
import { DOCUMENT_TYPE_LABELS, type DocumentType, type ProductDocument } from '../lib/types'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB, keeps requests well under Gemini's inline-data limit

export default function DocumentUploadSection({
  docType,
  documents,
  onUpload,
  onDelete,
}: {
  docType: DocumentType
  documents: ProductDocument[]
  onUpload: (docType: DocumentType, file: File) => Promise<{ error: string | null }>
  onDelete: (doc: ProductDocument) => Promise<{ error: string | null }>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is over 15MB — please upload a smaller one.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setUploading(true)
    setError(null)
    const { error } = await onUpload(docType, file)
    if (error) setError(error)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline p-5">
      <p className="font-text text-[15px] font-semibold text-ink">
        {DOCUMENT_TYPE_LABELS[docType]}
      </p>

      {documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-sm bg-canvas-parchment px-4 py-2"
            >
              <span className="truncate font-text text-[13px] text-ink-muted-80">
                {doc.file_name}
              </span>
              <button
                type="button"
                onClick={() => onDelete(doc)}
                className="shrink-0 font-text text-[13px] text-status-rejected"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="self-start rounded-full border border-hairline px-4 py-2 font-text text-[14px] text-primary active:scale-95 transition-transform cursor-pointer">
        {uploading ? 'Uploading…' : 'Upload file'}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          onChange={handleFileChange}
          disabled={uploading}
          className="hidden"
        />
      </label>

      {error && <p className="font-text text-[13px] text-status-rejected">{error}</p>}
    </div>
  )
}
