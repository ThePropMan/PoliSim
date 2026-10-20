import { defineConfig } from 'vite';

export default defineConfig({
  // three.js alone is ~600 kB; that's expected for this app
  build: { chunkSizeWarningLimit: 900 },
});
