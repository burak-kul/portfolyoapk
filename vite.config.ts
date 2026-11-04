import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, forward API, SEO feeds and uploaded files to the backend (npm run server).
const backend = 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on local network (0.0.0.0) so phones on the same Wi-Fi can connect
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/sitemap.xml': backend,
      '/robots.txt': backend,
      '/feed.xml': backend,
    },
  },
})
