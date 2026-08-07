import type { AppSettings } from './types'

/**
 * What `vtac` hands the desktop app when it launches it.
 *
 * The CLI has no terminal of its own — the window is the output (PLAN.md
 * §Divergences) — so everything a flag asked for has to cross a process
 * boundary: the CLI writes a BootConfig to a temp file, puts
 * `--boot-config=<path>` on the app's command line, and main turns it into a
 * BootPayload the renderer applies during its normal start-up.
 *
 * A path, not bytes, is what crosses: a command line has no room for a data
 * file, and main is the process with filesystem access anyway. The CLI still
 * checks the file is readable before spawning, so a typo is a message in the
 * shell that typed it rather than a window that opens missing its file.
 */

/** The switch the CLI puts on the app's command line. */
export const BOOT_CONFIG_SWITCH = '--boot-config='

export interface BootConfig {
  /** `-l` — an absolute path, already verified readable by the CLI. */
  load?: string
  /** `-p` — a host serial port to open before the window shows. */
  serialPort?: string
  /** `-f` — open fullscreen. */
  fullscreen?: boolean
  /** `-s` — window scale; the client area is `320·scale × 240·scale` plus the bar. */
  scale?: number
  /**
   * Settings the app would otherwise have been given through its own panel:
   * serial framing (`-b -a -d -t`), personality (`--mode`) and geometry
   * (`--columns`).
   *
   * Applied to this launch only — see `SettingsService.override`. Someone
   * running `vtac -b 19200 --mode vt100` is talking to one device, not deciding
   * what the app should do tomorrow; anything they then change in the panel
   * persists exactly as it always did.
   *
   * `fullscreen` and `scale` are settings too, and are folded in the same way.
   * They are named separately above because main has to *act* on them when it
   * builds the window rather than merely record them.
   */
  settings?: Partial<AppSettings>
}

/** A file main read on the renderer's behalf, with the name to show for it. */
export interface BootMedia {
  label: string
  bytes: Uint8Array
}

export interface BootPayload {
  /** `-l`'s file, read. Fed through `vtac.parse()` once the screen is up. */
  load?: BootMedia
  /**
   * `-p`'s port. An action rather than a setting — connecting is something the
   * app does, not something it is — so it stays out of `settings`.
   */
  serialPort?: string
  /** What `-f` asked for. The live window state comes from main's own event. */
  fullscreen: boolean
  /**
   * Anything main could not read. The renderer starts without it rather than
   * refusing to start: a missing data file should leave a usable terminal and
   * a message, not a dead window.
   */
  errors: string[]
}
