#!/usr/bin/env node
/**
 * Drive `vttest` against the built app over the hardware serial loopback.
 *
 * PLAN.md stage 5.8 — the VT-100 conformance gate, held until Phase 6 gave the
 * app a real port to open. The point of running it this way rather than against
 * `src/core` is that everything between the wire and the glass is included:
 * `serialport` framing, the store, the renderer, the cursor overlay.
 *
 *   npm run build                        # the app it tests has to exist
 *   node scripts/vttest-run.mjs 1        # menu item 1, all sub-tests
 *   node scripts/vttest-run.mjs 1 2 3 6  # the four items the plan names
 *   node scripts/vttest-run.mjs --menu   # just show the menu and exit
 *
 * Each screen is written to `out/vttest/<item>/NN.png` and `NN.txt`. The PNG is
 * what a person looks at; the `.txt` is the same screen read back *out of the
 * canvas* — every 8×8 cell matched against `Font.CHARACTERS` — because judging
 * "is the cursor in column 40" from a 640×480 screenshot of an 8×8 ROM is how
 * conformance claims get made up. Both come from the same frame.
 *
 * Requirements: `npm run build`, `vttest` (brew install vttest), python3, and
 * the two USB serial cables wired to each other (PLAN.md §5.5).
 */

import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The two ends of the loopback — the app takes `tty.`, this side takes `cu.`. */
const LOOPBACK = {
  app: '/dev/tty.usbserial-FTDMBHZ7',
  host: '/dev/cu.PL2303G-USBtoUART1130'
}

/**
 * 115200 rather than VT-AC's own 9600: a vttest screen is up to 4,800
 * characters and the gate is about what gets drawn, not about how long a
 * VT100's line took to paint. 8-N-1 either way, and all four fields, because
 * `SettingsService.override` replaces `serialConfig` wholesale.
 */
const SERIAL = { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1 }

/** Terminal geometry, and what vttest is told about it: 60 lines, 80 columns, no 132. */
const GEOMETRY = { rows: 60, cols: 80 }

const PORT = 9222
const SCALE = 2
const VIEWPORT = { width: 320 * SCALE, height: 240 * SCALE + 56 }

/** vttest's prompt when it is sitting on a menu rather than showing a test. */
const MENU_PROMPT = /Enter choice number/

/**
 * The other half of stage 5.8: real programs, over the same wire.
 *
 * `vttest` proves the sequences are right one at a time. These prove the
 * combination is usable — which is the claim the release actually makes, and
 * not one any number of unit tests can support. Each names a command, the
 * keystrokes to drive it, and where to photograph it.
 */
const PROGRAMS = {
  /** The plan's first named program: opens, edits and exits cleanly. */
  vi: {
    term: 'vt100',
    command: (file) => ['vi', file],
    file: 'VT-AC\nsecond line\n',
    steps: [
      { shot: 'opened', wait: 1500 },
      // `G` to the last line, `o` opens one below it, then type and escape.
      { keys: 'Go', wait: 600 },
      { keys: 'edited in vi over the serial line\x1b', wait: 600, shot: 'edited' },
      { keys: ':wq\r', wait: 1500 }
    ],
    // What the file has to contain afterwards. An edit that renders correctly
    // but never reached the disk would look identical on the glass.
    expect: 'edited in vi over the serial line'
  },

  /**
   * ncurses through terminfo's own `vt100` entry, which is what makes this
   * different from `vttest`: the line drawing is chosen by ncurses from the
   * terminal's capabilities rather than written out by hand.
   */
  curses: {
    term: 'vt100',
    command: () => ['python3', join(ROOT, 'scripts', 'curses-demo.py')],
    steps: [
      { shot: 'drawn', wait: 2500 },
      { keys: 'q', wait: 500 }
    ]
  },

  /**
   * `examples/ansi.bin`, poured down the wire by `cat`.
   *
   * Starts the app in the personality and geometry a *user* starts it in —
   * native, 40 columns — because the example's first four bytes are the escape
   * extensions that ask for anything else, and a harness that pre-set them
   * would be checking a file that had already had its opening removed.
   */
  ansi: {
    term: 'vt100',
    settings: { personality: 'native', columns: 40, serialConfig: SERIAL },
    command: () => ['cat', join(ROOT, 'examples', 'ansi.bin')],
    steps: [{ shot: 'loaded', wait: 3000 }]
  }
}

//
// ARGUMENTS
//

const argv = process.argv.slice(2)
const MENU_ONLY = argv.includes('--menu')
const KEEP = argv.includes('--keep')
const PROGRAM = argv.includes('--program') ? argv[argv.indexOf('--program') + 1] : null
const items = argv.filter((a) => /^\d+$/.test(a))
if (!MENU_ONLY && PROGRAM === null && items.length === 0) {
  console.error('Usage: node scripts/vttest-run.mjs [--menu] [--program <name>] <menu item>...')
  process.exit(1)
}

const OUT = join(ROOT, 'out', 'vttest')

//
// RUN
//

const work = mkdtempSync(join(tmpdir(), 'vtac-vttest-'))
let app = null
let socket = null
let link = null
let child = null
let nextId = 1

/** Everything vttest has written, as text, so the driver can see the prompts. */
let transcript = ''
let lastByteAt = 0

async function run() {
  const bootConfig = join(work, 'boot.json')
  writeFileSync(
    bootConfig,
    JSON.stringify({
      scale: SCALE,
      serialPort: LOOPBACK.app,
      // A program may want the terminal in the state a user starts it in
      // rather than in the one `vttest` needs. `serialConfig` is always whole:
      // `SettingsService.override` replaces the key rather than merging into it.
      settings: PROGRAMS[PROGRAM]?.settings ?? {
        personality: 'vt100',
        columns: GEOMETRY.cols,
        serialConfig: SERIAL
      }
    })
  )

  app = launch(bootConfig)
  const page = await waitForPage()
  socket = await connect(page.webSocketDebuggerUrl)
  await wait(2500) // the port opens after the window does

  const { result } = await cdp('Runtime.evaluate', {
    expression: `(() => { const c = document.querySelector('canvas'); return c.width + 'x' + c.height })()`,
    returnByValue: true
  })
  console.error(`[app] framebuffer ${result.value}`)

  if (PROGRAM !== null) {
    await runProgram(PROGRAM)
    return
  }

  await startVttest()
  await settle()

  if (MENU_ONLY) {
    console.log(await screenText())
    return
  }

  for (const item of items) await runItem(item)
}

/** One of `PROGRAMS`, driven and photographed. */
async function runProgram(name) {
  const program = PROGRAMS[name]
  if (program === undefined) {
    throw new Error(`no such program: ${name} (have ${Object.keys(PROGRAMS).join(', ')})`)
  }

  const dir = join(OUT, 'programs')
  mkdirSync(dir, { recursive: true })

  const file = join(work, `${name}.txt`)
  if (program.file !== undefined) writeFileSync(file, program.file)

  await startProgram(program.command(file), program.term)

  for (const step of program.steps) {
    if (step.keys !== undefined) await send(step.keys)
    await wait(step.wait ?? 500)
    if (step.shot === undefined) continue
    writeFileSync(join(dir, `${name}-${step.shot}.png`), await screenshot())
    writeFileSync(join(dir, `${name}-${step.shot}.txt`), await screenText())
    console.log(`${name}: ${step.shot} → out/vttest/programs/`)
  }

  if (program.expect !== undefined) {
    const written = readFileSync(file, 'utf8')
    const ok = written.includes(program.expect)
    console.log(`${name}: file ${ok ? 'contains' : 'DOES NOT CONTAIN'} ${JSON.stringify(program.expect)}`)
    if (!ok) console.log(written)
  }
}

/**
 * One menu item, and every sub-test under it.
 *
 * `*` is vttest's own "run every item at this level", which is what makes a
 * scripted run cover the same ground an interactive one would. Sub-menus that
 * do not offer it simply see an unrecognised key and repaint, and the RETURNs
 * that follow walk the item list anyway.
 */
async function runItem(item) {
  const dir = join(OUT, item)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  await send(`${item}\r`)
  await settle()

  // Some items open a sub-menu and some go straight into their first screen.
  // `*` is vttest's "run every item at this level", and it is only a command
  // where a menu is listening — sent into a test screen it is a character
  // typed at a "Push <RETURN>" prompt, which is why this asks first.
  const subMenu = MENU_PROMPT.test(tail())
  if (subMenu) {
    await send('*\r')
    await settle()
  }

  let n = 0
  for (; n < 80; n++) {
    const index = String(n).padStart(2, '0')
    writeFileSync(join(dir, `${index}.png`), await screenshot())
    writeFileSync(join(dir, `${index}.txt`), await screenText())
    // Back at a menu means the item is done — the prompt is the terminator,
    // not a screen count, because sub-test counts differ per item and per
    // vttest release.
    if (MENU_PROMPT.test(tail())) break
    await send('\r')
    await settle()
  }
  console.log(`item ${item}: ${n + 1} screens → out/vttest/${item}/`)

  // Back out of the sub-menu, so the next item starts where this one did — and
  // only if there was one. `0` at the *main* menu is Exit, which quits vttest
  // and leaves every later item typing at a terminal with nothing behind it.
  if (subMenu) {
    await send('0\r')
    await settle()
  }
}

//
// THE APP
//

function launch(bootConfig) {
  // ELECTRON_RUN_AS_NODE is set in this shell for the CLI shim's benefit; left
  // in place it starts Electron as plain Node and no window opens.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const proc = spawn(
    require('electron'),
    ['.', `--boot-config=${bootConfig}`, `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  proc.stderr.on('data', (d) => {
    const text = String(d).trim()
    if (text && !text.startsWith('DevTools listening')) console.error(`[app] ${text}`)
  })
  return proc
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

async function screenshot() {
  const shot = await cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    // scale 1 on a Retina backing store: in 80-column mode one terminal pixel
    // is one CSS pixel, so this is the only ratio that does not resample the
    // 8×8 ROM into mush.
    clip: { x: 0, y: 0, ...VIEWPORT, scale: 1 }
  })
  return Buffer.from(shot.data, 'base64')
}

/** Read the screen back out of the canvas as text. See `READER` below. */
async function screenText() {
  const { result } = await cdp('Runtime.evaluate', {
    expression: READER,
    returnByValue: true,
    awaitPromise: false
  })
  if (typeof result.value !== 'string') throw new Error(`cannot read the screen: ${result.description ?? result.type}`)
  return result.value
}

//
// VTTEST, AND THE WIRE
//

function startVttest() {
  return startProgram(['vttest', `${GEOMETRY.rows}x${GEOMETRY.cols}.${GEOMETRY.cols}`], 'vt100')
}

/** Open our end of the loopback and put a program on a pty behind it. */
async function startProgram(command, term = 'vt100') {
  const { SerialPort } = require('serialport')
  const port = new SerialPort({ path: LOOPBACK.host, ...SERIAL })
  await new Promise((ok, fail) => port.on('open', ok).on('error', fail))
  link = {
    port,
    close: () => new Promise((ok) => port.close(ok))
  }

  child = spawn(
    'python3',
    [
      join(ROOT, 'scripts', 'pty-host.py'),
      '--rows', String(GEOMETRY.rows),
      '--cols', String(GEOMETRY.cols),
      '--term', term,
      '--',
      ...command
    ],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
  )

  child.stdout.on('data', (bytes) => {
    link.port.write(bytes)
    transcript += bytes.toString('latin1')
    lastByteAt = Date.now()
  })
  // The app's replies — DA, DECID, CPR — come back up the wire and into
  // vttest's stdin. Item 6 is nothing but this path.
  link.port.on('data', (bytes) => child.stdin.write(bytes))
  child.stderr.on('data', (d) => console.error(`[pty] ${String(d).trim()}`))
}

/**
 * Type on the terminal's own keyboard.
 *
 * Not into vttest's stdin, which is the obvious shortcut and is wrong: the
 * keystroke has to come out of `keymap.ts`, cross the wire and arrive as
 * whatever the terminal decided to send. Item 6's LineFeed/NewLine test is
 * exactly that measurement — with LNM set, RETURN owes vttest CR LF — and
 * injecting a bare CR at the far end tests the harness instead of the terminal.
 *
 * The transcript starts over here too, so `tail()` always means "what this
 * keystroke produced". Keeping the history made a small test screen look like a
 * menu, because the prompt it was drawn over was still inside the search window.
 */
async function send(keys) {
  transcript = ''
  for (const key of keys) {
    if (key === '\r') await keypress({ key: 'Enter', code: 'Enter', keyCode: 13 })
    else await keypress({ key, code: keyCode(key), keyCode: key.toUpperCase().charCodeAt(0), text: key })
  }
  await wait(120)
}

/** `KeyboardEvent.code` for the characters this script types: digits, `*`. */
function keyCode(key) {
  if (key >= '0' && key <= '9') return `Digit${key}`
  if (key === '*') return 'Digit8'
  return `Key${key.toUpperCase()}`
}

async function keypress({ key, code, keyCode, text }) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
  // `keyDown` with `text` is what produces a character; `rawKeyDown` is the
  // non-printing form, which is what Enter is as far as the DOM is concerned.
  await cdp('Input.dispatchKeyEvent', {
    type: text === undefined ? 'rawKeyDown' : 'keyDown',
    ...base,
    ...(text === undefined ? {} : { text, unmodifiedText: text })
  })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await wait(40)
}

/**
 * Wait until vttest stops writing.
 *
 * A screen is finished when the bytes stop, not after a fixed delay: a cursor
 * test paints in a few milliseconds and a scrolling test takes seconds, and
 * screenshotting either one too early photographs a half-drawn screen.
 */
async function settle(quiet = 600, limit = 15000) {
  const started = Date.now()
  lastByteAt = Date.now()
  while (Date.now() - lastByteAt < quiet && Date.now() - started < limit) await wait(100)
  // The renderer paints on its own rAF loop, so the last bytes need one more
  // frame before the glass agrees with the wire.
  await wait(150)
}

/** Everything that arrived since the last keystroke. */
function tail() {
  return transcript
}

function wait(ms) {
  return new Promise((ok) => setTimeout(ok, ms))
}

//
// THE SCREEN READER
//

/**
 * Build the in-page reader.
 *
 * Two tables come out of `src/core/Font.ts` rather than being written here, so
 * neither can drift from the ROM the app draws with: the glyph bitmaps, and the
 * Unicode character each one *looks* like, parsed from the `// [x] (n)`
 * comments the table already carries. That second one is what makes a dump of
 * DEC line drawing legible as a box rather than as a row of code points.
 */
function buildReader() {
  const source = readFileSync(join(ROOT, 'src', 'core', 'Font.ts'), 'utf8')

  const glyphs = []
  const looks = []
  const line = /\[((?:0x[0-9a-f]{2},?\s*){8})\],\s*\/\/ \[(.)\] \((\d+)\)/g
  for (let m; (m = line.exec(source)); ) {
    const code = Number(m[3])
    glyphs[code] = m[1].split(',').map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v))
    looks[code] = m[2]
  }
  if (glyphs.length !== 256) throw new Error(`parsed ${glyphs.length} glyphs from Font.ts, expected 256`)

  return `(() => {
  const GLYPHS = ${JSON.stringify(glyphs)}
  const LOOKS = ${JSON.stringify(looks)}

  const canvas = document.querySelector('canvas')
  if (!canvas) return 'no canvas'
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const W = canvas.width, H = canvas.height
  const data = ctx.getImageData(0, 0, W, H).data
  const at = (x, y) => {
    const i = (y * W + x) * 4
    return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  }

  // Pattern → code. ASCII first so that a blank cell reads as a space rather
  // than as NUL, and so duplicate bitmaps resolve to the printable twin.
  const byPattern = new Map()
  const claim = (i) => { const k = GLYPHS[i].join(','); if (!byPattern.has(k)) byPattern.set(k, i) }
  for (let i = 32; i < 127; i++) claim(i)
  for (let i = 0; i < 256; i++) claim(i)

  const lines = []
  for (let row = 0; row * 8 < H; row++) {
    let text = ''
    for (let col = 0; col * 8 < W; col++) {
      // The cell's majority colour is its field; anything else is ink. Which of
      // fg/bg that is does not matter and must not — reverse video, the cursor
      // overlay and DECSCNM all swap them, and the glyph is the same shape.
      const counts = new Map()
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = at(col * 8 + x, row * 8 + y)
        counts.set(v, (counts.get(v) || 0) + 1)
      }
      let field = 0, most = -1
      for (const [v, n] of counts) if (n > most) { most = n; field = v }

      const bits = []
      for (let y = 0; y < 8; y++) {
        let b = 0
        for (let x = 0; x < 8; x++) if (at(col * 8 + x, row * 8 + y) !== field) b |= 128 >> x
        bits.push(b)
      }

      // Four attempts, in order of how much they assume: the pattern as read,
      // and its complement for a glyph covering more than half its cell; each
      // of those again with row 7 cleared, which is where UNDERLINE lives.
      //
      // The last one is not redundant. Underlining adds eight lit pixels, which
      // is enough to carry a mid-weight glyph past half the cell and flip which
      // colour looks like the field — 'b', 'd' and 'k' land at 33 of 64. Those
      // need the complement *and* the row cleared, in that order.
      const flip = (p) => p.map((b) => (~b) & 255)
      const noRow7 = (p) => { const q = p.slice(); q[7] = 0; return q }
      const code =
        byPattern.get(bits.join(',')) ??
        byPattern.get(flip(bits).join(',')) ??
        byPattern.get(noRow7(bits).join(',')) ??
        byPattern.get(noRow7(flip(bits)).join(','))

      text += code === undefined ? '\\u00bf' : (code >= 32 && code < 127 ? String.fromCharCode(code) : LOOKS[code])
    }
    lines.push(text.replace(/\\s+$/, ''))
  }
  return lines.join('\\n')
})()`
}

const READER = buildReader()

//
// GO
//

try {
  await run()
} finally {
  child?.kill('SIGTERM')
  await link?.close()
  socket?.close()
  app?.kill()
  if (!KEEP) rmSync(work, { recursive: true, force: true })
}
