import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  IPC,
  BASE_WIDTH,
  BASE_HEIGHT,
  CONTROL_BAR_HEIGHT,
  MIN_SCALE,
  MAX_SCALE
} from '../shared/types'
import type { AppSettings, SerialConfig } from '../shared/types'
import type { BootPayload } from '../shared/boot'
import { bootConfigFrom, readBootPayload } from './boot'
import { CliShimService } from './cliShim'
import { SerialService } from './serial'
import { SettingsService } from './settings'

// ── Singletons ───────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let serialService: SerialService
let settingsService: SettingsService
const cliShimService = new CliShimService()

/**
 * What `vtac` asked this launch to boot with, if it launched us at all.
 *
 * Read here rather than inside `whenReady` because the config carries the
 * window's own size and fullscreen state, which have to be known before the
 * window is built. The file is consumed — read and deleted — by this call.
 */
const boot = bootConfigFrom(process.argv)

/** Read lazily and once: the renderer asks for it during its own start-up. */
let bootPayload: Promise<BootPayload> | undefined

/**
 * True until the boot-driven fullscreen has been accounted for.
 *
 * `-f` is a launch-only flag, but the window entering fullscreen looks exactly
 * like the user pressing F11 from here — and that is saved. Swallowing the
 * first transition is what keeps `vtac -f` from quietly deciding how the app
 * opens tomorrow.
 */
let ignoreFullscreenSave = boot?.fullscreen === true

// ── Window ───────────────────────────────────────────────────────────────────

/**
 * The client area for a given scale.
 *
 * Sized from the *40-column* logical screen whatever the terminal is currently
 * doing (PLAN.md §Phase 4): switching to 80 columns doubles the backing store,
 * not the window, so the picture gets finer and `-s` keeps meaning "how big is
 * the picture". The bar's height is added rather than taken out of the screen,
 * so the canvas is a whole-pixel multiple at every scale.
 */
function contentSizeFor(scale: number): { width: number; height: number } {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale)))
  return { width: BASE_WIDTH * s, height: BASE_HEIGHT * s + CONTROL_BAR_HEIGHT }
}

function createWindow(): void {
  const settings = settingsService.get()
  const { width, height } = contentSizeFor(settings.scale)

  mainWindow = new BrowserWindow({
    width,
    height,
    // The numbers above are the canvas plus the bar, not the canvas plus the
    // OS title bar — without this the screen loses ~28 rows of pixels on macOS.
    useContentSize: true,
    resizable: false,
    fullscreenable: true,
    center: true,
    title: 'VT-AC',
    backgroundColor: '#0A0F0A',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for serialport's native Node.js bindings.
      sandbox: false,
      // A terminal is not a web page: it has to keep answering the far end
      // whether or not anyone is looking at it. Chromium's default clamps
      // timers and rAF in an unfocused window to about once a second, which
      // would defer the TX flush behind a DA or DSR reply — and `vi` and
      // `htop` both block on one — as well as freezing the screen and the
      // bell while the window sits behind an editor.
      backgroundThrottling: false
    }
  })

  serialService.setWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (settings.fullscreen) mainWindow?.setFullScreen(true)
    // Launched from a shell, the window is the point of the command — it should
    // come forward rather than open behind the terminal that asked for it.
    if (boot) app.focus({ steal: true })
  })

  // Fullscreen state → renderer, so the control bar's icon matches the window
  // even when the change came from F11 or the green button. Saved here rather
  // than by the renderer for the same reason: main is the only side that hears
  // every route into and out of fullscreen, including the ones no button of
  // ours was pressed for.
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, true)
    if (ignoreFullscreenSave) ignoreFullscreenSave = false
    else settingsService.set({ fullscreen: true })
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, false)
    ignoreFullscreenSave = false
    settingsService.set({ fullscreen: false })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Apply a new DISPLAY-scale setting to the live window. */
function applyScale(scale: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return
  const { width, height } = contentSizeFor(scale)
  mainWindow.setContentSize(width, height)
  mainWindow.center()
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.acwright.vtac')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Services first: the window is sized from a saved setting, and `getPath` is
  // only valid once the app is ready.
  serialService = new SerialService()
  settingsService = new SettingsService()

  // Everything `vtac` set on the command line, for this launch only: the
  // framing, personality and geometry it named, plus the window's own scale and
  // fullscreen state. `override` keeps them out of the settings file while
  // still making them what `get()` reports, so the panel shows what is actually
  // in effect and `createWindow` below sizes to the scale that was asked for.
  if (boot) {
    settingsService.override({
      ...boot.settings,
      ...(boot.scale !== undefined ? { scale: boot.scale } : {}),
      ...(boot.fullscreen === true ? { fullscreen: true } : {})
    })
  }

  // ── App / window ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.WINDOW_TOGGLE_FULLSCREEN, () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })

  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false)

  // ── Boot config ────────────────────────────────────────────────────────────

  // Null when the app was opened any other way, which is the renderer's cue to
  // start normally. The files are read once and the same promise handed to
  // whoever asks, so a reload cannot re-read them halfway through a start-up.
  ipcMain.handle(IPC.BOOT_GET, () => {
    if (!boot) return null
    bootPayload ??= readBootPayload(boot)
    return bootPayload
  })

  // ── Serial ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SERIAL_LIST_PORTS, () => serialService.listPorts())

  ipcMain.handle(IPC.SERIAL_CONNECT, async (_e, path: string, config: SerialConfig) => {
    if (!mainWindow) throw new Error('No main window')
    serialService.setWindow(mainWindow)
    return serialService.connect(path, config)
  })

  ipcMain.handle(IPC.SERIAL_DISCONNECT, () => serialService.disconnect())

  // Fire-and-forget (`on`, not `handle`) for low-latency TX.
  ipcMain.on(IPC.SERIAL_SEND, (_e, data: Uint8Array) => serialService.send(data))

  // ── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, () => settingsService.get())

  ipcMain.handle(IPC.SETTINGS_SET, (_e, partial: Partial<AppSettings>) => {
    settingsService.set(partial)
    // Scale is the one setting the main process has to act on rather than just
    // record — the renderer cannot resize its own window.
    if (partial.scale !== undefined) applyScale(partial.scale)
  })

  // ── CLI shim ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CLI_STATUS, () => cliShimService.status())
  ipcMain.handle(IPC.CLI_INSTALL, () => cliShimService.install())
  ipcMain.handle(IPC.CLI_UNINSTALL, () => cliShimService.uninstall())

  // ── Start ──────────────────────────────────────────────────────────────────

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Quit everywhere. Closing the terminal's window is closing the terminal.
  app.quit()
})

// An open port outlives the window it was opened from unless something closes
// it: the OS reclaims the handle eventually, but "eventually" is long enough
// for a relaunch to find the device busy.
app.on('before-quit', () => {
  void serialService?.disconnect()
})
