import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const extensionDir = resolve(here, '../../extension')
const outFile = resolve(here, '../public/downloads/regpilot-extension.zip')

// Internal notes that do not belong in what testers download.
const SKIP = new Set(['MONTAJI_WALKTHROUGH_NOTES.md'])

export function extensionVersion(): string {
  return JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8')).version
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (SKIP.has(name) || name.startsWith('.')) return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

// Zips ../extension into public/downloads so the website can offer it. The extension's own vendored
// JSZip is reused, so no extra dependency is needed. The zip unpacks into one "regpilot-extension" folder.
async function pack() {
  const JSZip = createRequire(import.meta.url)(join(extensionDir, 'vendor/jszip.min.js'))
  const zip = new JSZip()
  for (const file of walk(extensionDir)) {
    zip.file(`regpilot-extension/${relative(extensionDir, file).split('\\').join('/')}`, readFileSync(file))
  }
  const bytes: Uint8Array = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, bytes)
}

export default function extensionPackage(): Plugin {
  return {
    name: 'regpilot-extension-package',
    async buildStart() {
      await pack()
    },
  }
}
