#!/usr/bin/env node
/**
 * Record the README's animations from the app itself.
 *
 * Launches the built Electron app with a boot config, drives the far end of the
 * hardware serial loopback, screenshots the window over the DevTools protocol,
 * and assembles the frames into a GIF.
 *
 *   npm run build                      # the app it records has to exist
 *   node scripts/capture-demo.mjs native
 *   node scripts/capture-demo.mjs htop
 *
 * Why this rather than a screen recorder: `screencapture` and `osascript` are
 * both gated behind macOS permissions this environment does not have, and a
 * hand-timed recording is not reproducible. This is — same bytes, same baud
 * rate, same frame times, every run.
 *
 * Requirements: `npm run build`, ffmpeg, and the two USB serial cables wired to
 * each other (PLAN.md §5.5). `--list` prints the candidates.
 */

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The two ends of the loopback.
 *
 * The app takes the `tty.` form because that is what `SerialPort.list()`
 * reports and what the settings match against; this script takes the `cu.`
 * form, which is the one that opens without waiting on carrier detect.
 */
const LOOPBACK = {
  app: '/dev/tty.usbserial-FTDMBHZ7',
  host: '/dev/cu.PL2303G-USBtoUART1130'
}

/**
 * VT-AC's framing at a given rate — 8-N-1, and all four fields.
 *
 * Partial is not an option: `SettingsService.override` replaces
 * `serialConfig` wholesale rather than merging into it, which is why the CLI
 * builds the whole record from `DEFAULT_SERIAL_CONFIG` for any one framing flag.
 */
const framing = (baudRate) => ({ baudRate, dataBits: 8, parity: 'none', stopBits: 1 })

const SCENARIOS = {
  /**
   * The README's hero: v1's own example files arriving over the wire at v1's
   * own baud rate, in the personality that is byte-for-byte v1.
   */
  native: {
    out: 'images/VT-AC.gif',
    settings: { personality: 'native', columns: 40, serialConfig: framing(9600) },
    scale: 2,
    clipScale: 0.5,
    fps: 10,
    seconds: 9,
    drive: async ({ send, wait }) => {
      await wait(700)
      await send('examples/characters.bin')
      await wait(1800)
      await send('examples/palette.bin')
      await wait(2000)
    }
  },

  /**
   * The release's headline: 80 columns, the VT-100 personality, and a program
   * that has no idea it is not talking to a DEC terminal.
   *
   * 115200 rather than 9600 because a full 80×60 repaint is 4,800 characters —
   * five seconds of screen-painting at 9600, which is authentic and unwatchable.
   */
  htop: {
    out: 'images/VT-AC-htop.gif',
    settings: { personality: 'vt100', columns: 80, serialConfig: framing(115200) },
    // 80 columns puts one terminal pixel on one CSS pixel, so unlike the
    // 40-column scenario this one keeps the Retina backing store: at half scale
    // an 8×8 glyph lands on 8 image pixels and htop becomes an impression of
    // htop rather than a screenshot of it.
    scale: 2,
    clipScale: 1,
    fps: 8,
    seconds: 12,
    drive: async ({ run, wait }) => {
      const htop = await run(['--rows', '60', '--cols', '80', '--term', 'ansi', '--', 'htop'])
      await wait(11500)
      await htop.stop()
    }
  }
}

//
// ARGUMENTS
//

const argv = process.argv.slice(2)

if (argv.includes('--list')) {
  execFileSync('sh', ['-c', 'ls /dev/cu.* /dev/tty.usb* 2>/dev/null'], { stdio: 'inherit' })
  process.exit(0)
}

const name = argv.find((a) => !a.startsWith('-'))
const scenario = SCENARIOS[name]
if (!scenario) {
  console.error(`Usage: node scripts/capture-demo.mjs <${Object.keys(SCENARIOS).join('|')}>`)
  process.exit(1)
}

const KEEP_FRAMES = argv.includes('--keep-frames')

/** Where the app listens for the DevTools protocol. */
const PORT = 9222

/** 320·scale × 240·scale plus the control bar, which is what main builds. */
const VIEWPORT = { width: 320 * scenario.scale, height: 240 * scenario.scale + 56 }

//
// RUN
//

const work = mkdtempSync(join(tmpdir(), 'vtac-capture-'))
const bootConfig = join(work, 'boot.json')
let app = null
let socket = null
let nextId = 1

try {
  await record()
} finally {
  socket?.close()
  app?.kill()
  if (!KEEP_FRAMES) rmSync(work, { recursive: true, force: true })
  else console.log(`frames kept in ${work}`)
}

async function record() {
  writeFileSync(
    bootConfig,
    JSON.stringify({
      scale: scenario.scale,
      serialPort: LOOPBACK.app,
      settings: scenario.settings
    })
  )

  app = launch()
  const page = await waitForPage()
  socket = await connect(page.webSocketDebuggerUrl)

  // The window is up before the serial port is; give the connection and the
  // first paint a moment so frame 0 is a settled screen rather than a flash.
  await wait(2500)

  const frames = []
  const capturing = capture(frames)
  await scenario.drive({ send, run, wait })
  await capturing

  writeGIF(frames)
}

/** Start the built app with remote debugging on. */
function launch() {
  // PLAN.md Phase 8 sets ELECTRON_RUN_AS_NODE deliberately for the CLI shim;
  // here it would start Electron as plain Node and nothing would open.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  // The binary directly rather than through `npx`: killing `npx` leaves the app
  // behind, and an app left behind holds both the serial port and the debugging
  // port against the next run.
  const child = spawn(
    require('electron'),
    ['.', `--boot-config=${bootConfig}`, `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  child.stderr.on('data', (d) => {
    const text = String(d).trim()
    if (text && !text.startsWith('DevTools listening')) console.error(`[app] ${text}`)
  })
  return child
}

async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    await wait(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* not listening yet */
    }
  }
  throw new Error('the app never opened a debuggable page')
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((ok, fail) => {
    ws.onopen = ok
    ws.onerror = () => fail(new Error('cannot attach to the app'))
  })
  return ws
}

function cdp(method, params = {}) {
  const id = nextId++
  return new Promise((resolve) => {
    const listener = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', listener)
      resolve(message.result)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * Screenshot on a fixed cadence for the scenario's duration.
 *
 * `clipScale` decides how much of the Retina backing store to keep. What
 * matters is that a terminal pixel lands on a whole number of image pixels —
 * anything else resamples an 8×8 glyph ROM into mush.
 */
async function capture(frames) {
  const interval = 1000 / scenario.fps
  const total = Math.round(scenario.seconds * scenario.fps)
  const started = Date.now()

  for (let i = 0; i < total; i++) {
    const shot = await cdp('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, ...VIEWPORT, scale: scenario.clipScale }
    })
    frames.push(Buffer.from(shot.data, 'base64'))
    const due = started + (i + 1) * interval
    await wait(Math.max(0, due - Date.now()))
  }
}

//
// THE FAR END
//

/** Open our end of the loopback with the scenario's framing. */
async function openHost() {
  const { SerialPort } = require('serialport')
  const port = new SerialPort({ path: LOOPBACK.host, ...scenario.settings.serialConfig })
  await new Promise((ok, fail) => port.on('open', ok).on('error', fail))
  // A `serialport` process that mostly listens does not surface received bytes
  // promptly on macOS — they appear only when it next writes or closes. The
  // pump is what makes a keystroke from the app arrive while it still matters.
  const pump = setInterval(() => port.read(), 20)
  return {
    port,
    close: () =>
      new Promise((ok) => {
        clearInterval(pump)
        port.close(ok)
      })
  }
}

/** Stream a file down the loopback at the scenario's baud rate. */
async function send(file) {
  const bytes = readFileSync(join(ROOT, file))
  const link = await openHost()
  await new Promise((ok) => link.port.write(bytes, ok))
  await new Promise((ok) => link.port.drain(ok))
  await link.close()
  console.log(`sent ${file} (${bytes.length} bytes)`)
}

/**
 * Run a real program against the loopback.
 *
 * `pty-host.py` allocates the pty and speaks raw bytes over its pipes;
 * `serialport` puts those bytes on the wire. Splitting it that way is not
 * tidiness — Python's `termios` set this PL2303 to anything above 9600 and the
 * far end received noise, while `serialport` at both ends is clean at 115200.
 */
async function run(args) {
  const link = await openHost()
  const child = spawn('python3', [join(ROOT, 'scripts', 'pty-host.py'), ...args], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdout.on('data', (bytes) => link.port.write(bytes))
  link.port.on('data', (bytes) => child.stdin.write(bytes))
  child.stderr.on('data', (d) => console.error(`[pty] ${String(d).trim()}`))

  return {
    stop: async () => {
      child.kill('SIGTERM')
      await link.close()
    }
  }
}

//
// OUTPUT
//

function writeGIF(frames) {
  frames.forEach((png, i) => {
    writeFileSync(join(work, `frame-${String(i).padStart(4, '0')}.png`), png)
  })

  const out = join(ROOT, scenario.out)
  const pattern = join(work, 'frame-%04d.png')
  const palette = join(work, 'palette.png')

  // Two passes: one global palette for the whole animation, then the encode.
  // A per-frame palette dithers the flat phosphor green differently every
  // frame, which reads as noise on a screen that is supposed to be still.
  const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args])
  ffmpeg(['-framerate', String(scenario.fps), '-i', pattern, '-vf', 'palettegen=stats_mode=full', palette])
  ffmpeg([
    '-framerate', String(scenario.fps), '-i', pattern,
    '-i', palette,
    '-lavfi', 'paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0',
    out
  ])

  const { size } = require('node:fs').statSync(out)
  console.log(`${scenario.out}  ${frames.length} frames  ${(size / 1024).toFixed(0)} KB`)
}

function wait(ms) {
  return new Promise((ok) => setTimeout(ok, ms))
}
