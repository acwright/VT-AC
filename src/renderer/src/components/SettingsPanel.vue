<script lang="ts">
/**
 * Which section the panel was opened *at*. The control bar's framing readout
 * opens it on SERIAL, which is the section that readout is about.
 */
export type SettingsSection = 'terminal' | 'serial' | 'display' | 'bell' | 'files' | 'cli'
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowPathIcon } from '@heroicons/vue/24/solid'
import { useTerminalStore } from '@/stores/terminal'
import { useSerial } from '@/composables/useSerial'
import { useBell } from '@/composables/useBell'
import { useFullscreen } from '@/composables/useFullscreen'
import { useSettings } from '@/services/settings'
import { DEFAULT_APP_SETTINGS, MAX_SCALE, MIN_SCALE } from '@shared/types'
import type { CliShimStatus, Columns, Personality, PortInfo } from '@shared/types'

/**
 * The Settings panel — the EMULATOR's structure, retargeted.
 *
 * The division of labour with the control bar is deliberate and runs through
 * every section here: **the bar changes what the terminal is doing, this panel
 * changes what it does by default.** Personality and columns chosen here become
 * `VTAC.defaultPersonality`/`defaultColumns` — what `0x04` and a host's `ESC c`
 * return the terminal to — and are written to disk; the same two values clicked
 * in the bar last only until the next reset, exactly like the `ESC 0x02` that
 * could have arrived on the wire instead.
 *
 * Nothing here hydrates a value that something else already owns. The serial
 * framing, the bell's mute and volume, and the fullscreen state all live in
 * app-lifetime composables that `App.vue` filled from settings at start-up, so
 * this component binds straight to them. That is what the EMULATOR's
 * `hydrating` flag was defending against — a panel that loaded settings into
 * its own fields and had its watcher write them straight back, persisting
 * launch-only values from `vtac -b 19200` in the process. With one hydration,
 * before any panel exists, there is nothing left to guard: the watchers below
 * are created on mount and only ever see edits.
 */

const props = defineProps<{ section?: SettingsSection }>()
defineEmits<{ close: [] }>()

const store = useTerminalStore()
const serial = useSerial()
const { audioReady, muted, volume, initAudio, test } = useBell()
const fullscreen = useFullscreen()
const appSettings = useSettings()

const isElectron = computed(() => typeof window !== 'undefined' && window.api !== undefined)

// ── Terminal ─────────────────────────────────────────────────────────────────

const personality = ref<Personality>(store.personality)
const columns = ref<Columns>(store.cols as Columns)

// The wire can change either of these from under us — `ESC 0x02`, `ESC 0x03`,
// or DECCOLM — while the panel is open. Following it keeps the radio buttons
// honest about what the terminal is actually doing.
watch(
  () => [store.personality, store.cols] as const,
  ([next, cols]) => {
    personality.value = next
    columns.value = cols as Columns
  }
)

function applyTerminal(next: { personality?: Personality; columns?: Columns }): void {
  personality.value = next.personality ?? personality.value
  columns.value = next.columns ?? columns.value
  // `configure`, not `setPersonality`/`setColumns`: this is the terminal's
  // configuration, so a reset comes back here rather than to 40 columns of
  // native. It applies the change now as well.
  store.configure({ personality: personality.value, columns: columns.value })
  void appSettings.set({
    personality: personality.value,
    columns: columns.value
  })
}

// ── Serial ───────────────────────────────────────────────────────────────────

const ports = ref<PortInfo[]>([])

async function refreshPorts(): Promise<void> {
  if (!isElectron.value) return
  ports.value = await serial.listPorts()
}

async function toggleSerial(): Promise<void> {
  if (serial.status.value === 'connected') {
    await serial.disconnect()
  } else {
    await serial.connect()
  }
}

watch(
  serial.config,
  (config) => {
    void appSettings.set({ serialConfig: { ...config } })
  },
  { deep: true }
)

/** Web Serial is Chromium-only and HTTPS-only; silence about that is worse. */
const webSerialMissing = computed(() => !isElectron.value && !serial.available)

// ── Display ──────────────────────────────────────────────────────────────────

// The one value on this panel that nothing else holds — the renderer cannot
// resize its own window, so `scale` is written to settings and main acts on it.
const scale = ref(DEFAULT_APP_SETTINGS.scale)

function applyScale(): void {
  void appSettings.set({ scale: scale.value })
}

// ── Bell ─────────────────────────────────────────────────────────────────────

async function toggleMuted(): Promise<void> {
  if (!audioReady.value) await initAudio()
  muted.value = !muted.value
  void appSettings.set({ bellMuted: muted.value })
}

function applyVolume(): void {
  void appSettings.set({ bellVolume: volume.value })
}

async function testBell(): Promise<void> {
  if (!audioReady.value) await initAudio()
  test()
}

// ── Files ────────────────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null)

async function onLoadFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  input.value = ''
  store.load(bytes, file.name)
}

// ── CLI shim ─────────────────────────────────────────────────────────────────

const cliStatus = ref<CliShimStatus>({ installed: false })
const cliMessage = ref('')

async function toggleCli(): Promise<void> {
  cliMessage.value = ''
  const result = cliStatus.value.installed
    ? await window.api!.cli.uninstall()
    : await window.api!.cli.install()
  cliMessage.value = result.message
  cliStatus.value = await window.api!.cli.status()
}

// ── Mount ────────────────────────────────────────────────────────────────────

const sections = ref<Record<string, HTMLElement | null>>({})

onMounted(async () => {
  if (props.section !== undefined) {
    await nextTick()
    sections.value[props.section]?.scrollIntoView({ block: 'start' })
  }

  if (!isElectron.value) return

  const settings = await appSettings.get()
  scale.value = settings.scale

  await refreshPorts()
  // Offer the port that is actually there. `lastPort` may name a device that
  // has since been unplugged, in which case the select falls back to nothing
  // rather than showing a path with no hardware behind it.
  if (serial.port.value && !ports.value.some((port) => port.path === serial.port.value)) {
    serial.port.value = ''
  }

  cliStatus.value = await window.api!.cli.status()
})
</script>

<template>
  <!-- Clicking away closes the panel. -->
  <div class="settings-backdrop" @click="$emit('close')" />

  <div class="settings-panel">
    <div class="panel-header">
      <span class="panel-title">Settings</span>
      <button class="close-btn" title="Close" @click="$emit('close')">✕</button>
    </div>

    <div class="panel-body">
      <!-- ── Terminal ───────────────────────────────────────────────────── -->
      <section :ref="(el) => (sections.terminal = el as HTMLElement)" class="panel-section">
        <h3 class="section-heading">TERMINAL</h3>

        <div class="field-row">
          <span class="field-label">Personality</span>
          <div class="segmented">
            <button
              :class="{ on: personality === 'native' }"
              @click="applyTerminal({ personality: 'native' })"
            >
              VT-AC
            </button>
            <button
              :class="{ on: personality === 'vt100' }"
              @click="applyTerminal({ personality: 'vt100' })"
            >
              VT-100
            </button>
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">Columns</span>
          <div class="segmented">
            <button :class="{ on: columns === 40 }" @click="applyTerminal({ columns: 40 })">
              40
            </button>
            <button :class="{ on: columns === 80 }" @click="applyTerminal({ columns: 80 })">
              80
            </button>
          </div>
        </div>

        <p class="hint">
          <strong>VT-AC</strong> is the native protocol — the one this terminal
          has always spoken, byte for byte. <strong>VT-100</strong> is the
          compatibility mode: DEC escape sequences, for
          <code>vi</code>, <code>htop</code> and anything else built on
          <code>ncurses</code>. Switching columns clears the screen, as DECCOLM
          does on real hardware.
        </p>
      </section>

      <!-- ── Serial ─────────────────────────────────────────────────────── -->
      <section :ref="(el) => (sections.serial = el as HTMLElement)" class="panel-section">
        <h3 class="section-heading">SERIAL</h3>

        <div class="status-row">
          <span class="status-dot" :class="`dot-${serial.status.value}`" />
          <span class="status-text">{{ serial.status.value }}</span>
        </div>

        <p v-if="serial.error.value" class="hint error">{{ serial.error.value }}</p>

        <template v-if="isElectron">
          <div class="port-row">
            <select v-model="serial.port.value" class="field port-select">
              <option value="">— select port —</option>
              <option v-for="port in ports" :key="port.path" :value="port.path">
                {{ port.path }}{{ port.manufacturer ? ` (${port.manufacturer})` : '' }}
              </option>
            </select>
            <button class="btn-icon" title="Refresh ports" @click="refreshPorts">
              <ArrowPathIcon class="size-4" />
            </button>
          </div>

          <div class="config-grid">
            <div class="config-item">
              <label class="config-label">Baud Rate</label>
              <input v-model.number="serial.config.value.baudRate" type="number" class="field" />
            </div>
            <div class="config-item">
              <label class="config-label">Data Bits</label>
              <select v-model.number="serial.config.value.dataBits" class="field">
                <option :value="8">8</option>
                <option :value="7">7</option>
                <option :value="6">6</option>
                <option :value="5">5</option>
              </select>
            </div>
            <div class="config-item">
              <label class="config-label">Parity</label>
              <select v-model="serial.config.value.parity" class="field">
                <option value="none">None</option>
                <option value="even">Even</option>
                <option value="odd">Odd</option>
              </select>
            </div>
            <div class="config-item">
              <label class="config-label">Stop Bits</label>
              <select v-model.number="serial.config.value.stopBits" class="field">
                <option :value="1">1</option>
                <option :value="1.5">1.5</option>
                <option :value="2">2</option>
              </select>
            </div>
          </div>
        </template>

        <p v-if="webSerialMissing" class="hint">
          This browser has no Web Serial API. Chrome or Edge over HTTPS can open
          a port; Firefox and Safari cannot. The desktop app has no such
          restriction.
        </p>
        <p v-else-if="!isElectron" class="hint">
          Connect opens the browser's port picker — Web Serial has no list to
          show until you have granted access to a device.
        </p>

        <button
          class="btn-wide"
          :class="serial.status.value === 'connected' ? 'btn-danger' : 'btn-primary'"
          :disabled="!serial.available || serial.status.value === 'connecting'"
          @click="toggleSerial"
        >
          {{ serial.status.value === 'connected' ? 'Disconnect' : 'Connect' }}
        </button>
      </section>

      <!-- ── Display ────────────────────────────────────────────────────── -->
      <section
        v-if="isElectron"
        :ref="(el) => (sections.display = el as HTMLElement)"
        class="panel-section"
      >
        <h3 class="section-heading">DISPLAY</h3>

        <div class="field-row">
          <span class="field-label">Window scale</span>
          <input
            v-model.number="scale"
            type="range"
            :min="MIN_SCALE"
            :max="MAX_SCALE"
            step="1"
            class="slider"
            @change="applyScale"
          />
          <span class="field-value">{{ scale }}×</span>
        </div>

        <div class="field-row">
          <span class="field-label">Fullscreen</span>
          <div class="segmented">
            <button :class="{ on: !fullscreen.isFullscreen.value }" @click="fullscreen.toggle()">
              Off
            </button>
            <button :class="{ on: fullscreen.isFullscreen.value }" @click="fullscreen.toggle()">
              On
            </button>
          </div>
        </div>

        <p class="hint">
          The window is sized from the 40-column screen whichever mode the
          terminal is in — 80 columns is a finer picture in the same glass, not
          a bigger window. F11 or ⌘↵ toggles fullscreen.
        </p>
      </section>

      <!-- ── Bell ───────────────────────────────────────────────────────── -->
      <section :ref="(el) => (sections.bell = el as HTMLElement)" class="panel-section">
        <h3 class="section-heading">BELL</h3>

        <div class="field-row">
          <span class="field-label">Sound</span>
          <div class="segmented">
            <button :class="{ on: !muted }" @click="muted && toggleMuted()">On</button>
            <button :class="{ on: muted }" @click="!muted && toggleMuted()">Muted</button>
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">Volume</span>
          <input
            v-model.number="volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="slider"
            @change="applyVolume"
          />
          <span class="field-value">{{ Math.round(volume * 100) }}%</span>
        </div>

        <button class="btn-wide btn-secondary" @click="testBell">Test</button>

        <p v-if="!audioReady" class="hint">
          The browser starts audio on the first click or keypress; this button
          counts as one.
        </p>
      </section>

      <!-- ── Files ──────────────────────────────────────────────────────── -->
      <section :ref="(el) => (sections.files = el as HTMLElement)" class="panel-section">
        <h3 class="section-heading">FILES</h3>

        <div class="file-row">
          <span class="file-name" :title="store.loadedName ?? ''">
            {{ store.loadedName ?? '—' }}
          </span>
          <input ref="fileInput" type="file" accept=".bin,.dat" hidden @change="onLoadFile" />
          <button class="btn-sm btn-secondary" @click="fileInput?.click()">Load</button>
          <button
            class="btn-sm btn-secondary"
            :disabled="store.loadedName === null"
            @click="store.reload()"
          >
            Reload
          </button>
        </div>

        <p class="hint">
          A data file is fed through the terminal exactly as if it had arrived on
          the wire. Dropping one on the window does the same thing.
        </p>
      </section>

      <!-- ── Command line ───────────────────────────────────────────────── -->
      <section
        v-if="isElectron"
        :ref="(el) => (sections.cli = el as HTMLElement)"
        class="panel-section"
      >
        <h3 class="section-heading">COMMAND LINE</h3>

        <p class="hint">
          {{
            cliStatus.managedByInstaller
              ? "Installed by this platform's installer."
              : cliStatus.installed
                ? `Installed at ${cliStatus.path}`
                : "Adds the 'vtac' command to your PATH."
          }}
        </p>

        <p v-if="cliMessage" class="hint">{{ cliMessage }}</p>

        <button
          v-if="!cliStatus.managedByInstaller"
          class="btn-wide"
          :class="cliStatus.installed ? 'btn-danger' : 'btn-primary'"
          @click="toggleCli"
        >
          {{ cliStatus.installed ? 'Uninstall' : 'Install' }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ── Frame ────────────────────────────────────────────────────────────────── */
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 99;
}

.settings-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: 320px;
  background: var(--vt-panel);
  border-left: 1px solid var(--vt-panel-line);
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--vt-panel-line);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--vt-phosphor);
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 14px;
  color: var(--vt-text-dim);
  transition:
    color 0.15s,
    background 0.15s;
}
.close-btn:hover {
  color: var(--vt-phosphor);
  background: rgba(255, 255, 255, 0.06);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.panel-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--vt-panel-line);
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--vt-text-dim);
  margin: 0 0 10px 0;
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */
.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.field-label {
  font-size: 12px;
  color: var(--vt-text);
  flex: 1;
  min-width: 0;
}

.field-value {
  font-size: 12px;
  color: var(--vt-text-dim);
  font-variant-numeric: tabular-nums;
  width: 34px;
  text-align: right;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-width: 0;
}

.file-name {
  flex: 1;
  font-size: 12px;
  color: var(--vt-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.hint {
  font-size: 11px;
  line-height: 1.45;
  color: var(--vt-text-dim);
  margin: 0 0 10px 0;
}
.hint code {
  color: var(--vt-text);
}
.hint strong {
  color: var(--vt-text);
  font-weight: 600;
}
.hint.error {
  color: var(--vt-red);
}

/* ── Serial status ────────────────────────────────────────────────────────── */
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  /* Unlit, deliberately not green: a phosphor dot beside the word
     "disconnected" reads as a connection at a glance. */
  background: var(--vt-trim);
}
.dot-connecting {
  background: var(--vt-amber);
  animation: dot-pulse 1s ease-in-out infinite;
}
.dot-connected {
  background: var(--vt-phosphor);
}
.dot-error {
  background: var(--vt-red);
}

@keyframes dot-pulse {
  50% {
    opacity: 0.35;
  }
}

.status-text {
  font-size: 12px;
  color: var(--vt-text-dim);
}

.port-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-bottom: 10px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.config-item .field {
  width: 100%;
}

.config-label {
  font-size: 10px;
  color: var(--vt-text-dim);
  letter-spacing: 0.03em;
}

/* ── Controls ─────────────────────────────────────────────────────────────── */
.field {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--vt-panel-line);
  border-radius: 4px;
  color: var(--vt-text);
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
  height: 26px;
  outline: none;
}
.field:focus {
  border-color: var(--vt-phosphor-dim);
}

.port-select {
  flex: 1;
  min-width: 0;
}

.slider {
  flex: 1;
  min-width: 0;
  accent-color: var(--vt-phosphor);
}

/* A two- or three-way choice, sized like the control bar's readouts so the
   same value looks the same in both places. */
.segmented {
  display: flex;
  border: 1px solid var(--vt-panel-line);
  border-radius: 4px;
  overflow: hidden;
}
.segmented button {
  font-size: 11px;
  padding: 4px 10px;
  color: var(--vt-text-dim);
  background: transparent;
  transition:
    color 0.12s,
    background 0.12s;
}
.segmented button:hover {
  color: var(--vt-text);
}
.segmented button.on {
  background: var(--vt-phosphor-dim);
  color: var(--vt-phosphor-hi);
}

.btn-icon {
  display: flex;
  align-items: center;
  padding: 3px;
  border-radius: 4px;
  color: var(--vt-text-dim);
}
.btn-icon:hover {
  color: var(--vt-phosphor);
}

.btn-sm {
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 11px;
  height: 24px;
  white-space: nowrap;
}
.btn-sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-wide {
  width: 100%;
  padding: 6px;
  border-radius: 6px;
  font-size: 13px;
  transition: opacity 0.15s;
}
.btn-wide:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--vt-phosphor);
  color: var(--vt-screen);
  font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
  background: var(--vt-phosphor-hi);
}

.btn-danger {
  background: var(--vt-red);
  color: #fff;
}
.btn-danger:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  color: var(--vt-text);
  border: 1px solid var(--vt-panel-line);
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
</style>
