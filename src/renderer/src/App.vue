<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import ScreenCanvas from '@/components/ScreenCanvas.vue'
import ControlBar from '@/components/ControlBar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import PasteModal from '@/components/PasteModal.vue'
import type { SettingsSection } from '@/components/SettingsPanel.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useBell } from '@/composables/useBell'
import { useSerial } from '@/composables/useSerial'
import { useFullscreen } from '@/composables/useFullscreen'
import { bootPayload } from '@/composables/useBoot'
import { useSettings } from '@/services/settings'
import { useTerminalStore } from '@/stores/terminal'

/** The screen, the control bar, and the two overlays. */

const store = useTerminalStore()

useKeyboard()
const bell = useBell()
// Held here for the app's lifetime: the link belongs to the terminal, not to
// whichever panel happens to be open (see useSerial).
const serial = useSerial()
const fullscreen = useFullscreen()
const settingsStore = useSettings()

const settingsOpen = ref(false)
const settingsSection = ref<SettingsSection | undefined>(undefined)
const pasteOpen = ref(false)

function toggleSettings(): void {
  settingsSection.value = undefined
  settingsOpen.value = !settingsOpen.value
}

/** The control bar's framing readout, opening the panel where it is set. */
function openSettings(section: SettingsSection): void {
  settingsSection.value = section
  settingsOpen.value = true
}

/**
 * Start the terminal at the configured geometry, personality, port and volume.
 *
 * This is the app's one hydration point. Everything below reads settings *into*
 * app-lifetime state — the terminal's configuration, the serial framing, the
 * bell — so that the Settings panel can bind straight to that state instead of
 * loading its own copy and risking writing it back. It runs in both builds:
 * `useSettings()` reads main's `settings.json` under Electron and
 * `localStorage` in the browser, so the web build starts where it was left too.
 *
 * The order is what `vtac` needs it to be: settings first (with anything the
 * command line named already folded in by main), then the terminal at that
 * geometry, then the port, and only then the `-l` file — so a data file lands
 * on a screen that is already the right size, in the right personality, with
 * the line open behind it.
 */
async function start(): Promise<void> {
  // What `vtac` launched this window with, if it did. Null otherwise, and
  // everything below then behaves exactly as it did before the CLI existed.
  const boot = await bootPayload()
  for (const problem of boot?.errors ?? []) console.error('[boot]', problem)

  const settings = await settingsStore.get()

  // `configure`, not `setColumns`/`setPersonality`: these are the terminal's
  // configured defaults, so a RIS from the far end comes back to them — which
  // for `vtac --mode vt100 -c 80` means the mode it was launched in.
  store.configure(settings)

  serial.config.value = { ...settings.serialConfig }
  serial.port.value = boot?.serialPort ?? settings.lastPort ?? ''

  bell.muted.value = settings.bellMuted
  bell.volume.value = settings.bellVolume ?? 1

  if (boot?.serialPort !== undefined) {
    // `-p` names one device deliberately, so it is opened without first asking
    // whether it is in the port list: a device that has gone missing is worth
    // an error here, unlike the saved port below.
    await serial.connect(undefined, boot.serialPort)
  } else if (settings.lastPort !== undefined) {
    // Reconnect to the line this terminal was last wired to — but only if it is
    // still there. A saved path whose device has been unplugged should be a
    // silent no-op, not an error the user has to dismiss on every launch.
    const ports = await serial.listPorts()
    if (ports.some((port) => port.path === settings.lastPort)) {
      await serial.connect()
    }
  }

  // `-l`, through the same path as the Load button and a dropped file, so it is
  // reloadable from the panel afterwards.
  if (boot?.load) store.load(boot.load.bytes, boot.load.label)
}

/**
 * Drop a file on the window to feed it through `vtac.parse()`.
 *
 * The `-l` flag's equivalent, and the same path the control bar's Load button
 * takes — so a dropped file is reloadable from the panel too. Dropping a file
 * on a terminal is the obvious gesture, and the README documents it alongside
 * the button.
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
    store.load(new Uint8Array(await file.arrayBuffer()), file.name)
  } catch (error) {
    console.error('[load]', file.name, error)
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
}

/**
 * Escape closes the overlay before the terminal ever sees it.
 *
 * Capture phase, and stopping propagation, because `useKeyboard`'s listener is
 * on the window too and would otherwise transmit `0x1B` to the far end while
 * the panel that swallowed the keystroke was still on screen. With no overlay
 * open the key is the terminal's, as it always was.
 */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!pasteOpen.value && !settingsOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  if (pasteOpen.value) pasteOpen.value = false
  else settingsOpen.value = false
}

let unbindFullscreen: (() => void) | undefined

onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onEscape, true)
  unbindFullscreen = fullscreen.bind()
  void start()
})

onUnmounted(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onEscape, true)
  unbindFullscreen?.()
})
</script>

<template>
  <main class="app-main">
    <ScreenCanvas />
    <ControlBar
      @toggle-settings="toggleSettings"
      @open-settings="openSettings"
      @toggle-paste="pasteOpen = !pasteOpen"
    />
  </main>

  <!-- Fixed overlays, outside the flex column so they never take height from
       the screen. -->
  <SettingsPanel v-if="settingsOpen" :section="settingsSection" @close="settingsOpen = false" />
  <PasteModal v-if="pasteOpen" @close="pasteOpen = false" />
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
