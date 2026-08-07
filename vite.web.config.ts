import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Standalone web build — targets src/renderer exactly like the electron-vite
 * renderer config, but outputs a static site for GitHub Pages.
 *
 * Build:   npm run build:web     → dist/web/
 * Preview: npm run preview:web   → localhost:4173/VT-AC/
 * Deploy:  .github/workflows/deploy.yml
 */
export default defineConfig({
  // GitHub Pages serves the repo at /VT-AC/.
  base: '/VT-AC/',

  // Treat src/renderer as the project root so Vite finds index.html there.
  root: resolve('src/renderer'),

  publicDir: resolve('src/renderer/public'),

  build: {
    outDir: resolve('dist/web'),
    emptyOutDir: true
  },

  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src'),
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },

  plugins: [
    vue(),
    tailwindcss(),
    nodePolyfills({
      include: ['buffer']
    })
  ]
})
