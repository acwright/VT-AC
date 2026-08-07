<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ScreenCanvas from '@/components/ScreenCanvas.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useBell } from '@/composables/useBell'
import { useSerial } from '@/composables/useSerial'
import { useTerminalStore } from '@/stores/terminal'

/**
 * The screen, the keyboard, the bell and the serial link — v1's SDL window, in
 * a canvas. The control bar and settings panel arrive in Phase 7; Phase 8
 * replaces the start-up below with `useBoot`, which folds `vtac -l`, `-p` and
 * `--fullscreen` into the same ordered sequence.
 */

const store = useTerminalStore()

useKeyboard()
useBell()
// Held here for the app's lifetime: the link belongs to the terminal, not to
// whichever panel happens to be open (see useSerial).
const serial = useSerial()

/**
 * Start the terminal at the configured geometry, personality and port.
 *
 * Reading settings directly rather than through a composable because there is
 * nothing else to read them yet — Phase 7's panel and Phase 9's localStorage
 * fallback are what make that worth abstracting. The web build has no
 * `window.api`, so it starts at the defaults, which is what Phase 9 fixes.
 */
async function start(): Promise<void> {
  const settings = await window.api?.settings.get()
  if (settings === undefined) return

  // `configure`, not `setColumns`/`setPersonality`: these are the terminal's
  // configured defaults, so a RIS from the far end comes back to them.
  store.configure(settings)

  // Reconnect to the line this terminal was last wired to — but only if it is
  // still there. A saved path whose device has been unplugged should be a
  // silent no-op, not an error the user has to dismiss on every launch.
  if (settings.lastPort !== undefined) {
    const ports = await serial.listPorts()
    if (ports.some((port) => port.path === settings.lastPort)) {
      await serial.connect(settings.serialConfig, settings.lastPort)
    }
  }
}

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
  void start()
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
