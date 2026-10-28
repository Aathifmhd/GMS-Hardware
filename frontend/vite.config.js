import { defineConfig } from 'vite';

// The web app is plain HTML/CSS/JS: index.html plus the scripts and styles in public/, which Vite
// serves and copies to dist/ as they are. While running on this PC, /api calls are forwarded to
// the backend on port 4000; on Vercel the API is on the same site, so the pages need no changes.
const api = { '/api': 'http://localhost:4000' };

export default defineConfig({
  server: { port: 3000, strictPort: true, proxy: api },
  preview: { port: 3000, strictPort: true, proxy: api },
});
