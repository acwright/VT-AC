import { DEFAULT_APP_SETTINGS } from '@shared/types'
import type { AppSettings } from '@shared/types'

/**
 * Where the renderer's settings actually live.
 *
 * Under Electron that is `<userData>/settings.json`, reached over IPC — main
 * owns the file because it is also the side that folds in what `vtac -b 19200`
 * asked for this launch alone (`SettingsService.override`). In a browser there
 * is no main process and no command line, so `localStorage` is the whole story.
 *
 * Both are behind one interface because every caller in the renderer wants the
 * same two things and none of them should have to ask which build it is in.
 * Before this existed the panel wrote through `window.api?.settings`, and the
 * optional call meant the web build silently discarded every choice made in it:
 * personality, columns, framing and bell all came back at the defaults on the
 * next load (PLAN.md §Phase 9.2).
 */
export interface ISettingsService {
  get(): Promise<AppSettings>
  set(partial: Partial<AppSettings>): Promise<void>
}

/** The `localStorage` key the web build keeps its settings under. */
export const WEB_SETTINGS_KEY = 'vtac.settings'

/**
 * The part of `Storage` this uses. Narrowed to two methods so the service can
 * be handed a plain object under test, and so a browser that refuses storage
 * entirely — Safari's private mode throws from `setItem` — is a caught error
 * rather than a type that promised more than it delivers.
 */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// ── Web (localStorage) ───────────────────────────────────────────────────────

export class WebSettingsService implements ISettingsService {
  constructor(private readonly store: KeyValueStore | undefined) {}

  async get(): Promise<AppSettings> {
    return this.read()
  }

  async set(partial: Partial<AppSettings>): Promise<void> {
    const next = { ...this.read(), ...partial }
    try {
      this.store?.setItem(WEB_SETTINGS_KEY, JSON.stringify(next))
    } catch (error) {
      // Storage full, or disabled by the browser. The setting still applies to
      // this session — the caller already changed the thing it names — so this
      // is a note, not a failure worth propagating into the panel.
      console.warn('[settings] save:', error)
    }
  }

  /**
   * Read-modify-write rather than an in-memory copy, deliberately: two tabs of
   * the Pages build are two independent terminals sharing one origin, and the
   * one that writes last should not also silently revert whatever the other
   * changed in the meantime. Settings are written on a click, not in a loop.
   */
  private read(): AppSettings {
    try {
      const raw = this.store?.getItem(WEB_SETTINGS_KEY)
      if (raw === null || raw === undefined) return { ...DEFAULT_APP_SETTINGS }
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      return { ...DEFAULT_APP_SETTINGS, ...parsed }
    } catch {
      // Corrupt or unreadable. Defaults are always a usable terminal, and the
      // next `set()` overwrites the bad value rather than leaving it to fail
      // again on every load.
      return { ...DEFAULT_APP_SETTINGS }
    }
  }
}

// ── Electron (IPC → SettingsService in main) ─────────────────────────────────

class ElectronSettingsService implements ISettingsService {
  get(): Promise<AppSettings> {
    return window.api!.settings.get()
  }

  set(partial: Partial<AppSettings>): Promise<void> {
    return window.api!.settings.set(partial)
  }
}

// ── Factory (one instance per platform) ──────────────────────────────────────

function isElectron(): boolean {
  return typeof window !== 'undefined' && 'api' in window && !!window.api
}

let shared: ISettingsService | undefined

/**
 * The settings store for this build.
 *
 * Three keys never reach the web side, and none of them needs filtering out:
 * `scale` and `fullscreen` are written by the Electron-only DISPLAY section and
 * by main, and `lastPort` by a connection that named a path — which Web Serial
 * never does, since the browser's picker owns port identity. Anything stored
 * anyway is merged over the defaults and ignored by the code that does not read
 * it, which is also what makes a settings file from an older version load.
 */
export function useSettings(): ISettingsService {
  if (shared === undefined) {
    shared = isElectron()
      ? new ElectronSettingsService()
      : new WebSettingsService(typeof localStorage === 'undefined' ? undefined : localStorage)
  }
  return shared
}
