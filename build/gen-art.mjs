#!/usr/bin/env node
/**
 * Generate VT-AC's branding art.
 *
 * Outputs:
 *   build/vtac.png                          1024×1024 source art for gen-icon.mjs
 *   src/renderer/public/favicon.svg         the mark, as vector
 *   src/renderer/public/favicon-32.png      the mark, for browsers without SVG icons
 *   src/renderer/public/apple-touch-icon.png 180×180, opaque
 *   src/renderer/public/og-card.png         1200×630 link preview
 *
 * No image dependencies — everything is drawn by `build/art.mjs`.
 * Run: node build/gen-art.mjs   (or: npm run art)
 */

import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  COLORS,
  Canvas,
  ROOT,
  drawIcon,
  drawMark,
  loadCore,
  markSVG,
  writePNG,
  rgb
} from './art.mjs'

const PUBLIC = join(ROOT, 'src', 'renderer', 'public')
mkdirSync(PUBLIC, { recursive: true })

const { core, dispose } = loadCore()

try {
  const { CHARACTERS } = core.Font

  // ── App icon ────────────────────────────────────────────────────────────────

  writePNG(join(ROOT, 'build', 'vtac.png'), drawIcon(CHARACTERS))
  console.log('build/vtac.png                           1024×1024')

  // ── Web icons ───────────────────────────────────────────────────────────────

  writeFileSync(join(PUBLIC, 'favicon.svg'), markSVG())
  console.log('src/renderer/public/favicon.svg          vector')

  writePNG(join(PUBLIC, 'favicon-32.png'), drawMark(32))
  console.log('src/renderer/public/favicon-32.png       32×32')

  // Square, not rounded: iOS masks a home-screen icon itself, so handing it the
  // rounded tile would round an already-rounded shape and notch the corners.
  writePNG(join(PUBLIC, 'apple-touch-icon.png'), drawMark(180, 0))
  console.log('src/renderer/public/apple-touch-icon.png 180×180')

  // ── Open Graph card ─────────────────────────────────────────────────────────

  writePNG(join(PUBLIC, 'og-card.png'), drawCard(core))
  console.log('src/renderer/public/og-card.png          1200×630')
} finally {
  dispose()
}

/**
 * The link preview: a bezel framing an actual screenful of terminal output.
 *
 * "Actual" is the point — the pixels come from a real `VTAC` in the `vt100`
 * personality at 80 columns, rasterized through the real `RGB332_RGBA` table,
 * so the card cannot advertise a screen the app does not draw.
 */
function drawCard({ VTAC, palette, Font }) {
  const CARD = { w: 1200, h: 630 }

  const vtac = new VTAC.VTAC()
  vtac.setColumns(80)
  vtac.personality = 'vt100'
  vtac.cursorVisible = false
  feed(vtac, demo())

  const c = new Canvas(CARD.w, CARD.h, COLORS.screen)

  // The enclosure, at the same proportions as the icon's.
  const pad = 36
  const glass = { x: 84, y: 75, w: vtac.width, h: vtac.height }
  c.fillRounded(glass.x - pad, glass.y - pad, glass.w + pad * 2, glass.h + pad * 2, 40, COLORS.bezel)
  c.fillRounded(glass.x - 12, glass.y - 12, glass.w + 24, glass.h + 24, 20, COLORS.trim)

  // The framebuffer itself, one RGB332 byte per pixel, expanded exactly as the
  // renderer expands it.
  const frame = vtac.buffer
  const rgba = palette.RGB332_RGBA
  const view = new Uint32Array(c.data.buffer)
  for (let y = 0; y < glass.h; y++) {
    for (let x = 0; x < glass.w; x++) {
      view[(glass.y + y) * CARD.w + (glass.x + x)] = rgba[frame[y * glass.w + x]]
    }
  }

  // The wordmark, in the terminal's own font.
  const { CHARACTERS } = Font
  c.text(CHARACTERS, 'VT-AC', 800, 209, 9, COLORS.phosphor)
  c.text(CHARACTERS, 'A FANTASY VT', 800, 325, 3, COLORS.text)
  c.text(CHARACTERS, 'TERMINAL', 800, 357, 3, COLORS.text)
  c.text(CHARACTERS, '80 COLUMNS - VT-100', 800, 405, 2, COLORS.textDim)

  return c
}

/** Push a string of bytes through the terminal. */
function feed(vtac, bytes) {
  for (const byte of bytes) vtac.parse(byte)
}

/**
 * The screenful the card shows: what 80-column VT-100 mode is for.
 *
 * DEC Special Graphics line drawing, SGR colour through the RGB332 quantizer,
 * and the attributes the Advanced Video Option gave a VT100 — which is exactly
 * the machine `ESC [ ? 1 ; 2 c` claims to be.
 */
function demo() {
  const out = []
  const put = (s) => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i))
  }
  const byte = (n) => out.push(n)
  const csi = (s) => put(`\x1b[${s}`)
  const at = (row, col) => csi(`${row};${col}H`)
  const sgr = (s) => csi(`${s}m`)
  /** Print through the DEC Special Graphics set, then shift back to ASCII. */
  const graphics = (s) => {
    put('\x1b(0')
    put(s)
    put('\x1b(B')
  }
  const heading = (row, col, s) => {
    at(row, col)
    sgr('0;36')
    put(s)
  }
  const body = (s) => {
    sgr('0;37')
    put(s)
  }

  csi('2J')

  // ── The enclosure, in DEC line drawing ──────────────────────────────────────
  // The glyphs CP437 already had, which is why that ROM was the right one for
  // the fiction — the line drawing comes for free.

  const LEFT = 3
  const RIGHT = 78
  const TOP = 2
  const BOTTOM = 58
  const span = RIGHT - LEFT - 1

  sgr('0;32')
  at(TOP, LEFT)
  graphics(`l${'q'.repeat(span)}k`)
  for (let row = TOP + 1; row < BOTTOM; row++) {
    at(row, LEFT)
    graphics('x')
    at(row, RIGHT)
    graphics('x')
  }
  at(BOTTOM, LEFT)
  graphics(`m${'q'.repeat(span)}j`)

  at(TOP, LEFT + 3)
  sgr('1;32')
  put(' VT-AC ')

  // ── Header ──────────────────────────────────────────────────────────────────

  at(4, 6)
  sgr('1;32')
  put('A VT terminal that could have existed, but did not.')

  at(6, 6)
  body('80 COLUMNS   640x480   8x8 CP437 GLYPH ROM   256-COLOUR RGB332')
  at(7, 6)
  body('VT-100 / ANSI PERSONALITY   PIXEL GRAPHICS MODE   TWO-OCTAVE BELL')

  // ── The glyph ROM, 0x20–0xFF ────────────────────────────────────────────────
  // The C0 range is left out for the obvious reason: in this personality those
  // bytes are controls, and a terminal that printed them would be broken.

  heading(9, 6, 'CHARACTER SET')
  sgr('0;37')
  for (let row = 0; row < 14; row++) {
    at(11 + row, 6)
    for (let col = 0; col < 16; col++) {
      byte(0x20 + row * 16 + col)
      put(' ')
    }
  }

  // ── Line drawing, as a table ────────────────────────────────────────────────

  heading(9, 46, 'LINE DRAWING')
  const rule = (l, m, r) => `${l}${'q'.repeat(8)}${m}${'q'.repeat(8)}${m}${'q'.repeat(8)}${r}`
  const pad = (s) => ` ${s}${' '.repeat(7 - s.length)}`
  const cells = (a, b, c) => [pad(a), pad(b), pad(c)]

  const table = [
    ['g', rule('l', 'w', 'k')],
    ['t', cells('GRID', 'PIXELS', 'GLYPHS')],
    ['g', rule('t', 'n', 'u')],
    ['t', cells('40x30', '320x240', 'CP437')],
    ['t', cells('80x60', '640x480', '8 x 8')],
    ['g', rule('m', 'v', 'j')]
  ]
  table.forEach(([kind, line], i) => {
    at(11 + i, 46)
    sgr('0;32')
    if (kind === 'g') {
      graphics(line)
      return
    }
    // Text rows: the frame is still line drawing, the contents are not, so the
    // charset shifts once per cell rather than once per row.
    graphics('x')
    line.forEach((text) => {
      body(text)
      sgr('0;32')
      graphics('x')
    })
  })

  // ── Attributes — the Advanced Video Option a VT100 had to be ordered with ──

  heading(19, 46, 'ATTRIBUTES')
  at(21, 46)
  sgr('0;1')
  put('BOLD')
  sgr('0;4')
  put('   UNDERLINE')
  at(23, 46)
  sgr('0;7')
  put(' REVERSE ')
  sgr('0;32')
  put('   COLOUR')

  // ── Colour ──────────────────────────────────────────────────────────────────

  heading(27, 6, 'COLOUR')
  at(29, 6)
  for (let n = 0; n <= 7; n++) {
    sgr(`4${n}`)
    put('    ')
  }
  sgr('0')
  at(29, 42)
  for (let n = 0; n <= 7; n++) {
    sgr(`10${n}`)
    put('    ')
  }
  sgr('0')

  // `38;5;n` is the trap the README calls out: 256 xterm indices land on 256
  // RGB332 bytes, but not one-for-one. This row is what the quantizer does.
  at(31, 6)
  for (let n = 16; n < 232; n += 7) {
    sgr(`48;5;${n}`)
    put('  ')
  }
  sgr('0')
  at(32, 6)
  for (let n = 232; n < 256; n++) {
    sgr(`48;5;${n}`)
    put('  ')
  }
  sgr('0')

  // ── The two personalities ───────────────────────────────────────────────────

  heading(35, 6, 'PERSONALITIES')
  at(37, 6)
  sgr('0;32')
  put('native')
  body("    v1's protocol, byte for byte")
  at(38, 6)
  sgr('0;32')
  put('vt100 ')
  body('    scroll regions, alt screen, SGR, charsets, reports')

  heading(41, 6, 'RUNS')
  at(43, 6)
  body('vi     htop     ncurses     vttest')

  heading(41, 46, 'TARGETS')
  at(43, 46)
  body('macOS  Windows  Linux  the web')

  // ── Command line ────────────────────────────────────────────────────────────

  heading(46, 6, 'COMMAND LINE')
  at(48, 6)
  sgr('0;32')
  put('$ ')
  body('vtac --mode vt100 --columns 80 -p /dev/cu.usbserial')
  at(49, 6)
  sgr('0;32')
  put('$ ')
  body('vtac -l ./examples/characters.bin')

  at(53, 6)
  sgr('0;32')
  put('READY')
  sgr('0;7')
  put(' ')
  sgr('0')

  return out
}
