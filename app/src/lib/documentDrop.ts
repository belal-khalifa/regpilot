import { unzip, type UnzipFileInfo } from 'fflate'

// Turns whatever a person drops (files, a folder, zip files) into the PDFs and images RegPilot can
// read, and says why anything else was left out. Nothing here uploads.

export const MAX_FILE_BYTES = 15 * 1024 * 1024 // the storage bucket's own limit
export const MAX_DOCUMENTS = 20 // the database refuses a 21st document on a product
// A zip that inflates to more than this is refused, so a "zip bomb" cannot freeze the browser.
const MAX_UNZIPPED_BYTES = 150 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

export type SkippedFile = { name: string; reason: string }
export type ExpandedDrop = { files: File[]; skipped: SkippedFile[] }

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const baseName = (path: string) => path.split('/').pop() ?? path
// Hidden files and the "__MACOSX" folder macOS adds to zips are not documents.
const isJunk = (path: string) =>
  path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX') ||
  baseName(path).toLowerCase() === 'thumbs.db'

function isZip(file: File) {
  return (
    extensionOf(file.name) === 'zip' ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  )
}

function readableMime(file: File): string | null {
  if (Object.values(MIME_BY_EXTENSION).includes(file.type)) return file.type
  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? null
}

function unzipFile(file: File): Promise<{ files: File[]; skipped: SkippedFile[] }> {
  return new Promise((resolve) => {
    file.arrayBuffer().then((buffer) => {
      const skipped: SkippedFile[] = []
      let planned = 0
      const filter = (info: UnzipFileInfo) => {
        if (info.name.endsWith('/') || isJunk(info.name)) return false
        if (info.originalSize > MAX_FILE_BYTES && !info.name.toLowerCase().endsWith('.zip')) {
          skipped.push({ name: baseName(info.name), reason: 'over 15 MB' })
          return false
        }
        planned += info.originalSize
        if (planned > MAX_UNZIPPED_BYTES) {
          skipped.push({ name: baseName(info.name), reason: 'the zip is too large to open' })
          return false
        }
        return true
      }
      unzip(new Uint8Array(buffer), { filter }, (err, entries) => {
        if (err) {
          resolve({ files: [], skipped: [{ name: file.name, reason: 'this zip could not be opened' }] })
          return
        }
        const files = Object.entries(entries).map(([path, bytes]) => {
          const name = baseName(path)
          const type = MIME_BY_EXTENSION[extensionOf(name)] ?? 'application/octet-stream'
          return new File([bytes as BlobPart], name, { type })
        })
        resolve({ files, skipped })
      })
    })
  })
}

// Opens zips (and zips inside them, one level deep) and sorts out what can be uploaded.
export async function expandDrop(
  input: File[],
  existingNames: string[],
): Promise<ExpandedDrop> {
  const skipped: SkippedFile[] = []
  let candidates: File[] = []

  for (const file of input) {
    if (isJunk(file.webkitRelativePath || file.name)) continue
    if (!isZip(file)) {
      candidates.push(file)
      continue
    }
    const opened = await unzipFile(file)
    skipped.push(...opened.skipped)
    for (const inner of opened.files) {
      if (isZip(inner)) {
        const nested = await unzipFile(inner)
        skipped.push(...nested.skipped)
        candidates = candidates.concat(nested.files.filter((f) => !isZip(f)))
      } else {
        candidates.push(inner)
      }
    }
  }

  const seen = new Set(existingNames.map((n) => n.toLowerCase()))
  const files: File[] = []
  for (const file of candidates) {
    const type = readableMime(file)
    if (!type) {
      skipped.push({ name: file.name, reason: 'only PDFs and images are accepted' })
      continue
    }
    if (file.size === 0) {
      skipped.push({ name: file.name, reason: 'the file is empty' })
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped.push({ name: file.name, reason: 'over 15 MB' })
      continue
    }
    if (seen.has(file.name.toLowerCase())) {
      skipped.push({ name: file.name, reason: 'already uploaded' })
      continue
    }
    if (existingNames.length + files.length >= MAX_DOCUMENTS) {
      skipped.push({ name: file.name, reason: `a product can have at most ${MAX_DOCUMENTS} documents` })
      continue
    }
    seen.add(file.name.toLowerCase())
    files.push(file.type === type ? file : new File([file], file.name, { type }))
  }
  return { files, skipped }
}

// Reads a drag-and-drop, walking into dropped folders (browsers only hand over folders this way).
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e)
  if (entries.length === 0) return Array.from(dt.files)

  const out: File[] = []
  async function walk(entry: FileSystemEntry) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      out.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries returns at most ~100 entries per call, so keep reading until it is empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        )
        if (batch.length === 0) break
        for (const child of batch) if (!child.name.startsWith('.')) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}
