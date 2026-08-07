<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ClipboardIcon,
  Cog6ToothIcon,
  DocumentArrowUpIcon,
  LinkIcon,
  LinkSlashIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  TrashIcon
} from '@heroicons/vue/24/solid'
import { useTerminalStore } from '@/stores/terminal'
import { useSerial } from '@/composables/useSerial'
import { useBell } from '@/composables/useBell'
import { useFullscreen } from '@/composables/useFullscreen'
import type { SettingsSection } from '@/components/SettingsPanel.vue'

/**
 * The control bar — the EMULATOR's layout, with a terminal's buttons.
 *
 * Three groups, separated by hairlines: what to put on the screen, what the
 * line and the terminal are doing, and everything else. The middle group is
 * VT-AC's own: three live readouts that are also the fastest way to change
 * what they report.
 *
 * The bar is exactly `CONTROL_BAR_HEIGHT` (56px) tall — 24px of icon with 16px
 * above and below — because `main/index.ts` sizes the window as the 40-column
 * screen *plus* that number, and a bar that disagreed would cost the canvas
 * whole rows of pixels.
 */

const emit = defineEmits<{
  'toggle-settings': []
  'open-settings': [section: SettingsSection]
  'toggle-paste': []
}>()

const store = useTerminalStore()
const serial = useSerial()
const { audioReady, muted, initAudio } = useBell()
const fullscreen = useFullscreen()

// ── Files ────────────────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null)

async function onLoadFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Cleared so picking the same file twice fires `change` the second time —
  // and re-loading the same file is exactly what someone iterating on an
  // example does.
  input.value = ''
  store.load(bytes, file.name)
}

// ── Serial ───────────────────────────────────────────────────────────────────

const connected = computed(() => serial.status.value === 'connected')

/** `9600 8N1` — the framing, as a terminal manual would write it. */
const framing = computed(() => {
  const { baudRate, dataBits, parity, stopBits } = serial.config.value
  return `${baudRate} ${dataBits}${parity[0].toUpperCase()}${stopBits}`
})

const linkTitle = computed(() => {
  switch (serial.status.value) {
    case 'connected':
      return `Disconnect ${serial.port.value || 'serial port'}`
    case 'connecting':
      return 'Connecting…'
    case 'error':
      return serial.error.value ?? 'Connection failed'
    default:
      return serial.available ? 'Connect serial port' : 'Serial is not available here'
  }
})

/**
 * Connect, disconnect, or — when there is no port to connect *to* — open the
 * panel where one is chosen. A button that silently failed because a `<select>`
 * two clicks away was empty would be the worst of the three.
 */
async function toggleSerial(): Promise<void> {
  if (connected.value) {
    await serial.disconnect()
    return
  }
  if (serial.available && !serial.port.value && window.api !== undefined) {
    emit('open-settings', 'serial')
    return
  }
  await serial.connect()
}

// ── Terminal ─────────────────────────────────────────────────────────────────

/**
 * The two readouts change what the terminal is doing *now*, exactly as
 * `ESC 0x02` and `ESC 0x03` arriving on the wire do — they are the same store
 * calls. What the terminal boots with, and what a reset returns it to, is the
 * Settings panel's TERMINAL section; a click here is not a decision about
 * tomorrow.
 */
function togglePersonality(): void {
  store.setPersonality(store.personality === 'native' ? 'vt100' : 'native')
}

function toggleColumns(): void {
  store.setColumns(store.cols === 40 ? 80 : 40)
}

// ── Bell ─────────────────────────────────────────────────────────────────────

/**
 * Whether the bell can be *heard right now*, never the stored preference alone.
 * In a browser the AudioContext cannot start before a gesture, so an unmuted
 * preference still shows the crossed-out speaker: nothing can come out of it
 * yet, and this button is what removes that confusion (the EMULATOR's
 * `showsMuted` rule).
 */
const showsMuted = computed(() => !audioReady.value || muted.value)

const bellTitle = computed(() => {
  if (!audioReady.value) return 'Click to enable sound'
  return muted.value ? 'Unmute bell' : 'Mute bell'
})

async function toggleBell(): Promise<void> {
  // Before audio exists, a button reading "muted" means "give me sound",
  // whatever was stored last time — so this unmutes rather than toggles.
  if (!audioReady.value) {
    await initAudio()
    muted.value = false
  } else {
    muted.value = !muted.value
  }
  void window.api?.settings.set({ bellMuted: muted.value })
}
</script>

<template>
  <div class="control-bar">
    <!-- ── Screen contents ──────────────────────────────────────────────── -->
    <button title="Load data file" @click="fileInput?.click()">
      <DocumentArrowUpIcon class="icon" />
    </button>
    <input ref="fileInput" type="file" accept=".bin,.dat" hidden @change="onLoadFile" />

    <button title="Reset (0x04)" @click="store.reset()">
      <ArrowPathIcon class="icon" />
    </button>

    <button title="Clear screen (0x0C)" @click="store.clear()">
      <TrashIcon class="icon" />
    </button>

    <div class="separator" />

    <!-- ── The line, and the terminal on it ─────────────────────────────── -->
    <button
      :title="linkTitle"
      :class="['link', `link-${serial.status.value}`]"
      :disabled="!serial.available || serial.status.value === 'connecting'"
      @click="toggleSerial"
    >
      <LinkIcon v-if="connected" class="icon" />
      <LinkSlashIcon v-else class="icon" />
    </button>

    <button class="readout" title="Serial settings" @click="emit('open-settings', 'serial')">
      {{ framing }}
    </button>

    <button
      class="readout"
      :title="`Switch to ${store.personality === 'native' ? 'VT-100' : 'VT-AC native'} mode`"
      @click="togglePersonality"
    >
      {{ store.personality === 'native' ? 'VT-AC' : 'VT-100' }}
    </button>

    <button
      class="readout"
      :title="`Switch to ${store.cols === 40 ? 80 : 40} columns (clears the screen)`"
      @click="toggleColumns"
    >
      {{ store.cols }}
    </button>

    <div class="separator" />

    <!-- ── Everything else ──────────────────────────────────────────────── -->
    <button :title="bellTitle" :class="{ dim: !audioReady }" @click="toggleBell">
      <SpeakerXMarkIcon v-if="showsMuted" class="icon" />
      <SpeakerWaveIcon v-else class="icon" />
    </button>

    <button title="Paste text" @click="emit('toggle-paste')">
      <ClipboardIcon class="icon" />
    </button>

    <button
      v-if="fullscreen.available"
      :title="fullscreen.isFullscreen.value ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'"
      @click="fullscreen.toggle()"
    >
      <ArrowsPointingInIcon v-if="fullscreen.isFullscreen.value" class="icon" />
      <ArrowsPointingOutIcon v-else class="icon" />
    </button>

    <button title="Settings" @click="emit('toggle-settings')">
      <Cog6ToothIcon class="icon" />
    </button>
  </div>
</template>

<style scoped>
.control-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 14px;
  /* 24 + 16 + 16 = CONTROL_BAR_HEIGHT. See the note at the top of the file. */
  height: 24px;
  margin: 16px 0;
  flex-shrink: 0;
}

.control-bar button {
  display: flex;
  align-items: center;
  color: var(--vt-phosphor-dim);
  transition: color 0.12s;
}
.control-bar button:hover:not(:disabled) {
  color: var(--vt-phosphor);
}
.control-bar button:disabled {
  opacity: 0.45;
  cursor: default;
}

.icon {
  width: 24px;
  height: 24px;
}

.separator {
  width: 1px;
  height: 24px;
  background: var(--vt-trim);
}

/* ── Readouts ─────────────────────────────────────────────────────────────
 *
 * Text where the rest of the bar has icons, because there is no icon for
 * "9600 8N1" — and because the value is the point, not the button.
 */
.readout {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  padding: 4px 7px;
  border: 1px solid var(--vt-trim);
  border-radius: 3px;
  white-space: nowrap;
}
.readout:hover {
  border-color: var(--vt-phosphor-dim);
}

/* ── Link status ──────────────────────────────────────────────────────────
 *
 * The one control in the bar that is coloured at rest: it is reporting the
 * state of something outside the app, which nothing else here is.
 */
.link-connected {
  color: var(--vt-phosphor);
}
.link-connecting {
  color: var(--vt-amber);
  animation: link-pulse 1s ease-in-out infinite;
}
.link-error {
  color: var(--vt-red);
}

@keyframes link-pulse {
  50% {
    opacity: 0.35;
  }
}

/* The bell, before there is any audio to mute. */
.dim {
  opacity: 0.45;
}
</style>
