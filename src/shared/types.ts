/**
 * The contract between the main process, the preload bridge and the renderer.
 *
 * Imported by main and preload with relative paths (neither is alias-resolved —
 * see tsconfig.node.json) and by the renderer as `@shared/types`. The two type
 * re-exports below come from `src/core`, which deliberately knows nothing about
 * this file: the terminal defines what a personality and a column count are,
 * and the app's settings merely store one of each.
 */

import type { Personality } from '../core/types'
import type { Columns } from '../core/VTAC'

export type { Personality, Columns }

// ── Serial ───────────────────────────────────────────────────────────────────

export interface PortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
}

export interface SerialConfig {
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  parity: 'none' | 'odd' | 'even'
  stopBits: 1 | 1.5 | 2
}

/**
 * VT-AC v1's default framing — `-b 9600 -d 8 -a none -t 1`, `src/index.ts`.
 *
 * Deliberately *not* the EMULATOR's 19200: this app is a terminal, and the
 * baud rate someone types `vtac` expecting is the one v1 opened with.
 */
export const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1
}

export type SerialStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// ── CLI shim ─────────────────────────────────────────────────────────────────

export interface CliShimStatus {
  installed: boolean
  /** Where the shim was written, when installed. */
  path?: string
  /** True when this platform's install step is handled by the installer, not this action. */
  managedByInstaller?: boolean
}

// ── Window geometry ──────────────────────────────────────────────────────────

/** The 40-column screen, 4:3. The window is sized from this whatever the mode. */
export const BASE_WIDTH = 320
export const BASE_HEIGHT = 240

/**
 * Vertical room for the control bar (Phase 7): a 24px icon row with 16px above
 * and below. Defined here rather than in `main/index.ts` because the window
 * height and the bar's CSS have to agree, and they are written in different
 * processes.
 */
export const CONTROL_BAR_HEIGHT = 56

/** Window scale bounds — the Settings panel's DISPLAY slider, and `vtac -s`. */
export const MIN_SCALE = 1
export const MAX_SCALE = 6

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  serialConfig: SerialConfig
  /** Which protocol the terminal boots speaking, and what `0x04`/RIS returns to. */
  personality: Personality
  /** 40 or 80. The geometry the terminal boots at, and RIS returns to. */
  columns: Columns
  /** Window scale: the client area is `320·scale × 240·scale` plus the bar. */
  scale: number
  fullscreen: boolean
  /**
   * Mute *preference*, not mute state — it decides what the bell's output gain
   * starts at once the AudioContext exists, which in a browser is not until the
   * first gesture. See `useBell`.
   */
  bellMuted: boolean
  /** The port last connected to, offered again next launch. */
  lastPort?: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  serialConfig: DEFAULT_SERIAL_CONFIG,
  personality: 'native',
  columns: 40,
  scale: 3,
  fullscreen: false,
  bellMuted: false
}

// ── IPC channels ─────────────────────────────────────────────────────────────

export const IPC = {
  // App / window
  APP_GET_VERSION: 'app:getVersion',
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggleFullscreen',
  WINDOW_IS_FULLSCREEN: 'window:isFullscreen',
  WINDOW_FULLSCREEN_CHANGED: 'window:fullscreenChanged',
  // What `vtac` asked this launch to boot with (Phase 8, src/shared/boot.ts)
  BOOT_GET: 'boot:get',
  // Serial port
  SERIAL_LIST_PORTS: 'serial:listPorts',
  SERIAL_CONNECT: 'serial:connect',
  SERIAL_DISCONNECT: 'serial:disconnect',
  SERIAL_SEND: 'serial:send',
  SERIAL_DATA: 'serial:data',
  SERIAL_STATUS: 'serial:status',
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  // CLI shim (Phase 8)
  CLI_STATUS: 'cli:status',
  CLI_INSTALL: 'cli:install',
  CLI_UNINSTALL: 'cli:uninstall'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// The EMULATOR's `app:beforeQuit` / `app:saveComplete` pair is deliberately
// absent. It exists to flush a 256 MB CF image and an NVRAM file before the
// window dies; VT-AC has no storage (§Divergences) and writes its settings the
// moment they change, so there is nothing to save on the way out and no reason
// to intercept the close.
