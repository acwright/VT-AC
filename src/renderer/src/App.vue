<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ScreenCanvas from '@/components/ScreenCanvas.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useBell } from '@/composables/useBell'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Phase 3: the screen, the keyboard and the bell — v1's SDL window, in a
 * canvas. The control bar and settings panel arrive in Phase 7, the serial
 * link in Phase 6, and the boot sequence (`vtac -l`, `-p`, `--fullscreen`) in
 * Phase 8, which is what turns the bare `onMounted` below into an ordered
 * start-up.
 */

const store = useTerminalStore()

useKeyboard()
useBell()

/**
 * Drop a file on the window to feed it through `vtac.parse()`.
 *
 * The `-l` flag's equivalent, and until Phase 7 adds the control bar's Load
 * button the only way to get `examples/*.bin` into the terminal — which is what
 * Phase 3 is verified against. It stays afterwards: dropping a file on a
 * terminal is the obvious gesture, and the README documents it alongside the
 * button.
 *
 * Listeners are on the window rather than on the canvas because the browser's
 * default for a dropped file is to navigate to it. Missing the canvas by a few
 * pixels should not replace the app with a hex dump.
 */
async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file === undefined) return
  try {
    store.parseBytes(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    console.error('[load]', file.name, error)
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
}

onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
})

onUnmounted(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <main class="app-main">
    <ScreenCanvas />
  </main>
</template>

<style scoped>
.app-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  width: 100%;
}
</style>
