import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import extensionPackage, { extensionVersion } from './vite-plugins/extensionPackage.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), extensionPackage()],
  // The newest extension version, read from extension/manifest.json, so the site can tell testers when theirs is old.
  define: { __EXTENSION_VERSION__: JSON.stringify(extensionVersion()) },
})
