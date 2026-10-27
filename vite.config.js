import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Notes live in this origin's localStorage, so the port must never change
// (a different port = an empty notebook). The path doesn't matter: / and /app/ share it.
const server = { port: 5173, strictPort: true, open: '/app/' }
const page = p => fileURLToPath(new URL(p, import.meta.url))

// two pages: the landing page at / (plain HTML, for search engines) and the app at /app/
export default defineConfig({
  plugins: [react()], server, preview: server,
  build: { rolldownOptions: { input: { main: page('./index.html'), app: page('./app/index.html') } } },
})
