import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// During `npm run dev`, Vite serves the frontend on :5173 and proxies
// /api/* to the backend (`npm run server`, :8787) so the Ollama key stays server-side.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 explicitly — avoids localhost resolving to ::1 while the
      // backend may only be reachable on IPv4 (prevents ECONNREFUSED flapping).
      '/api': 'http://127.0.0.1:8787',
    },
  },
})