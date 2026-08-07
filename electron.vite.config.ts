import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    publicDir: resolve('src/renderer/public'),
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
      // VTAC.buffer is a Node Buffer. The core keeps that type so the existing
      // suite keeps its meaning; the browser needs the shim to honour it.
      nodePolyfills({
        include: ['buffer']
      })
    ]
  }
})
