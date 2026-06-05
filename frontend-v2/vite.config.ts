import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production builds are served from /openharvest/ on the server host (canonical URL).
// Dev keeps default base '/' so localhost:5174 works unchanged.
//
// `define` shims `process.env.NODE_ENV` because @pascal-app/viewer's published
// bundle reads it directly (Node-style) and crashes in the browser otherwise
// with "ReferenceError: process is not defined".
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/openharvest/' : '/',
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  server: {
    port: 5174,
  },
}))
