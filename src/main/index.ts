import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ── Window ───────────────────────────────────────────────────────────────────
//
// The 40-column screen is 320×240 (4:3), and the window is sized from that
// logical size regardless of personality or column mode — switching to 80
// columns makes the picture finer, never the window bigger (PLAN.md §Phase 4).
// Serial, settings, boot config and IPC arrive in Phase 6.

const BASE_WIDTH = 320
const BASE_HEIGHT = 240
const DEFAULT_SCALE = 3

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: BASE_WIDTH * DEFAULT_SCALE,
    height: BASE_HEIGHT * DEFAULT_SCALE,
    fullscreenable: true,
    center: true,
    title: 'VT-AC',
    backgroundColor: '#0A0F0A',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for serialport's native Node.js bindings (Phase 6).
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.acwright.vtac')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
