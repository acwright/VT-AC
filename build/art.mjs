/**
 * The drawing kit the branding art is made of.
 *
 * Everything VT-AC ships as an image — the app icon, the favicons, the Open
 * Graph card — is generated from this file rather than drawn by hand, for two
 * reasons. The glyphs on the icon's screen are the real `Font.CHARACTERS`
 * entries at 8×8 scaled by whole pixels, not a lookalike traced in a vector
 * editor; and the geometry is one set of numbers, so `favicon.svg` and
 * `icon.icns` cannot drift apart.
 *
 * Colours are read out of `style.css` rather than copied, so the icon's beige
 * and the app's beige cannot come apart.
 *
 * No image dependencies: PNG is encoded straight out of `zlib`, and shapes are
 * rasterized with 4×4 coverage sampling. `sips`/`iconutil`/`magick` come in
 * later, in `gen-icon.mjs`, only to repackage what this produces.
 */

import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

//
// COLOURS
//

/**
 * The §2 design tokens, read out of the stylesheet that defines them.
 *
 * Not copied: the icon and the app have to be the same beige, and a duplicated
 * palette is a palette that drifts. `--vt-phosphor-dim` arrives as
 * `phosphorDim`.
 */
export const COLORS = (() => {
  const css = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'style.css'), 'utf8')
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)
  if (!root) throw new Error('style.css: no :root block — where did the design tokens go?')

  const tokens = {}
  for (const [, name, hex] of root[1].matchAll(/--vt-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = hex.toUpperCase()
  }

  // Exactly the tokens the art draws with — a longer list would pass for the
  // wrong reason, by checking the stylesheet rather than this file's needs.
  for (const required of ['screen', 'phosphor', 'bezel', 'trim', 'text', 'textDim']) {
    if (tokens[required]) continue
    throw new Error(`style.css: missing --vt-${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
  }
  return tokens
})()

/** `#RRGGBB` → `[r, g, b]`. */
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

//
// GEOMETRY — one 1024-unit design space, shared by every output
//

/**
 * The app icon: the bezel as the tile, with the screen recessed into it.
 *
 * Deliberately not a picture *of* a terminal — no stand and no three-quarter
 * extrusion. The bezel goes edge to edge, so a Dock icon or a Finder thumbnail
 * is a solid slab of DEC beige with a dark screen in it, and what that buys is
 * scale: the screen and its contents get the whole canvas instead of the two
 * thirds an enclosure drawing leaves them.
 *
 * `radius` is the platform's own corner, and the tile carries it rather than
 * being a hard square, because macOS does not mask app icons — the Dock draws
 * the art exactly as given, and a square would be the one hard-cornered icon on
 * the shelf. It costs nothing: the radius *is* the silhouette, so the tile is
 * still solid bezel right up to its own edge rather than beige inset inside a
 * transparent margin.
 *
 * The screen is 800×600 — 4:3, the ratio the terminal itself is locked to —
 * centred, so the band above the glass matches the band below it. A real VT100's
 * chin is deeper, since that is where the badge and the controls lived; this is
 * a tile rather than a portrait, and the symmetry is what reads as one.
 */
export const ICON = (() => {
  const size = 1024
  /** The macOS corner. Also what `favicon.svg` and the 32px PNG use. */
  const radius = 185
  const glyphScale = 14
  const cell = glyphScale * 8

  const screen = { x: 112, y: (size - 600) / 2, w: 800, h: 600, r: 28 }

  // `VT-AC`, a blank line, then the block cursor — three cells tall and five
  // wide, centred on the glass. Derived rather than written down so the label
  // and the cursor cannot drift apart from the screen they sit on.
  const block = { w: cell * 5, h: cell * 3 }
  const origin = {
    x: screen.x + (screen.w - block.w) / 2,
    y: screen.y + (screen.h - block.h) / 2
  }

  return {
    size,
    radius,
    screen,
    /** How far the `trim` recess ring stands proud of the screen on every side. */
    recess: 14,
    glyphScale,
    label: { text: 'VT-AC', ...origin },
    cursor: { x: origin.x, y: origin.y + cell * 2 }
  }
})()

/**
 * The favicon: §Phase 10's "same art, bezel and screen only".
 *
 * The app icon's tile and glass exactly, with the wordmark dropped — five
 * glyphs are illegible below about 128px, and a favicon is identified by shape
 * and colour rather than read. What is left is the read that survives anyway:
 * beige tile, dark screen, one green block, centred and drawn large enough to
 * hold at 16px.
 */
export const MARK = (() => {
  const { size, radius, screen, recess } = ICON
  const block = 224
  return {
    size,
    radius,
    screen,
    recess,
    cursor: {
      x: (size - block) / 2,
      y: screen.y + (screen.h - block) / 2,
      w: block,
      h: block
    }
  }
})()

//
// RASTER
//

export class Canvas {
  constructor(width, height, background = null) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
    if (background) this.fillRect(0, 0, width, height, background)
  }

  /** Source-over one pixel. `a` is coverage in 0..1. */
  blend(x, y, [r, g, b], a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    const d = this.data
    const da = d[i + 3] / 255
    const oa = a + da * (1 - a)
    if (oa <= 0) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0
      return
    }
    d[i] = (r * a + d[i] * da * (1 - a)) / oa
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa
    d[i + 3] = oa * 255
  }

  /** Hard-edged rectangle. Used for glyph pixels, which must not be softened. */
  fillRect(x, y, w, h, color) {
    const c = rgb(color)
    const x0 = Math.round(x)
    const y0 = Math.round(y)
    const x1 = Math.round(x + w)
    const y1 = Math.round(y + h)
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.blend(px, py, c, 1)
    }
  }

  /**
   * Rounded rectangle, antialiased by 4×4 coverage sampling.
   *
   * Interior pixels short-circuit to full coverage; only the boundary pays for
   * the sixteen samples, which keeps a 1024² icon well under a second.
   */
  fillRounded(x, y, w, h, r, color) {
    const c = rgb(color)
    const radius = Math.min(r, w / 2, h / 2)
    const inside = (px, py) => {
      if (px < x || px > x + w || py < y || py > y + h) return false
      const cx = Math.min(Math.max(px, x + radius), x + w - radius)
      const cy = Math.min(Math.max(py, y + radius), y + h - radius)
      const dx = px - cx
      const dy = py - cy
      return dx * dx + dy * dy <= radius * radius
    }

    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.width, Math.ceil(x + w))
    const y1 = Math.min(this.height, Math.ceil(y + h))

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        // Corners are the only place the shape is not axis-aligned.
        const nearCorner =
          (px < x + radius || px > x + w - radius) && (py < y + radius || py > y + h - radius)
        if (!nearCorner) {
          if (inside(px + 0.5, py + 0.5)) this.blend(px, py, c, 1)
          continue
        }
        let hits = 0
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            if (inside(px + (sx + 0.5) / 4, py + (sy + 0.5) / 4)) hits++
          }
        }
        if (hits) this.blend(px, py, c, hits / 16)
      }
    }
  }

  /** One 8×8 glyph from the ROM, every pixel a whole `scale`×`scale` square. */
  glyph(characters, code, x, y, scale, color) {
    const rows = characters[code & 0xff]
    for (let row = 0; row < 8; row++) {
      const bits = rows[row]
      for (let bit = 0; bit < 8; bit++) {
        if (bits & (0x80 >> bit)) {
          this.fillRect(x + bit * scale, y + row * scale, scale, scale, color)
        }
      }
    }
  }

  /** ASCII through the ROM — CP437 agrees with ASCII across 0x20–0x7E. */
  text(characters, string, x, y, scale, color) {
    for (let i = 0; i < string.length; i++) {
      this.glyph(characters, string.charCodeAt(i), x + i * 8 * scale, y, scale, color)
    }
  }

  /** Box-downsample to `size`×`size`. Whole-integer ratios only. */
  resample(width, height) {
    const out = new Canvas(width, height)
    const fx = this.width / width
    const fy = this.height / height
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let n = 0
        for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy++) {
          for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx++) {
            const i = (sy * this.width + sx) * 4
            const sa = this.data[i + 3] / 255
            r += this.data[i] * sa
            g += this.data[i + 1] * sa
            b += this.data[i + 2] * sa
            a += sa
            n++
          }
        }
        const i = (y * width + x) * 4
        if (a > 0) {
          out.data[i] = r / a
          out.data[i + 1] = g / a
          out.data[i + 2] = b / a
        }
        out.data[i + 3] = (a / n) * 255
      }
    }
    return out
  }
}

//
// PNG
//

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Write a `Canvas` as an 8-bit RGBA PNG. */
export function writePNG(path, canvas) {
  const { width, height, data } = canvas

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Filter 0 (None) on every scanline: the art is flat colour, so deflate's
  // own run-length matching already does the work a filter would.
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4)
    raw[at] = 0
    Buffer.from(data.buffer, y * width * 4, width * 4).copy(raw, at + 1)
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

//
// DRAWING — the two compositions
//

/** The full app icon, at `ICON.size`. */
export function drawIcon(characters) {
  const c = new Canvas(ICON.size, ICON.size)
  const { screen, recess } = ICON

  // The bezel, edge to edge apart from the platform's corner.
  c.fillRounded(0, 0, ICON.size, ICON.size, ICON.radius, COLORS.bezel)

  // The screen sits in a recess: a trim-coloured ring standing proud of it.
  c.fillRounded(
    screen.x - recess,
    screen.y - recess,
    screen.w + recess * 2,
    screen.h + recess * 2,
    screen.r + recess,
    COLORS.trim
  )
  c.fillRounded(screen.x, screen.y, screen.w, screen.h, screen.r, COLORS.screen)

  // Real glyphs from the real ROM, at 8×8, scaled by a whole number.
  c.text(characters, ICON.label.text, ICON.label.x, ICON.label.y, ICON.glyphScale, COLORS.phosphor)
  c.glyph(characters, 0xdb, ICON.cursor.x, ICON.cursor.y, ICON.glyphScale, COLORS.phosphor)

  return c
}

/**
 * The favicon mark at any size.
 *
 * Drawn at the target size rather than downsampled into it: `fillRounded`
 * antialiases at whatever scale it is handed, and a 32px favicon rendered
 * directly keeps a harder edge than one boxed down from 1024.
 *
 * `radius` is a parameter because one consumer wants a different answer. iOS
 * applies its *own* mask to a home-screen icon, so handing it the rounded tile
 * would round an already-rounded shape and leave four dark notches; that caller
 * passes 0 and gets a full-bleed square, which is what the platform expects.
 */
export function drawMark(size = MARK.size, radius = MARK.radius) {
  const c = new Canvas(size, size)
  const k = size / MARK.size
  const { screen, recess, cursor } = MARK

  c.fillRounded(0, 0, size, size, radius * k, COLORS.bezel)
  c.fillRounded(
    (screen.x - recess) * k,
    (screen.y - recess) * k,
    (screen.w + recess * 2) * k,
    (screen.h + recess * 2) * k,
    (screen.r + recess) * k,
    COLORS.trim
  )
  c.fillRounded(screen.x * k, screen.y * k, screen.w * k, screen.h * k, screen.r * k, COLORS.screen)
  c.fillRect(cursor.x * k, cursor.y * k, cursor.w * k, cursor.h * k, COLORS.phosphor)

  return c
}

/** `MARK` as an SVG document — the same numbers, resolution-independent. */
export function markSVG() {
  const { size, radius, screen, recess, cursor } = MARK
  const ring = {
    x: screen.x - recess,
    y: screen.y - recess,
    w: screen.w + recess * 2,
    h: screen.h + recess * 2,
    r: screen.r + recess
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="VT-AC">
  <title>VT-AC</title>
  <rect width="${size}" height="${size}" rx="${radius}" fill="${COLORS.bezel}"/>
  <rect x="${ring.x}" y="${ring.y}" width="${ring.w}" height="${ring.h}" rx="${ring.r}" fill="${COLORS.trim}"/>
  <rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="${screen.r}" fill="${COLORS.screen}"/>
  <rect x="${cursor.x}" y="${cursor.y}" width="${cursor.w}" height="${cursor.h}" fill="${COLORS.phosphor}"/>
</svg>
`
}

//
// CORE LOADING
//

/**
 * Transpile `src/core` to a throwaway directory and require it.
 *
 * The same trick `scripts/verify-cellmodel.mjs` uses, and for the same reason:
 * the art has to be made out of the terminal's own font and its own
 * framebuffer, not a copy of either. Returns `{ core, dispose }`.
 */
export function loadCore() {
  const work = mkdtempSync(join(tmpdir(), 'vtac-art-'))
  const ts = require('typescript')

  const walk = (from, to) => {
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(from, entry.name), join(to, entry.name))
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      const output = ts.transpileModule(readFileSync(join(from, entry.name), 'utf8'), {
        fileName: entry.name,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true
        }
      }).outputText
      writeFileSync(join(to, entry.name.replace(/\.ts$/, '.js')), output)
    }
  }
  walk(join(ROOT, 'src', 'core'), join(work, 'core'))

  return {
    core: {
      Font: require(join(work, 'core', 'Font.js')),
      palette: require(join(work, 'core', 'palette.js')),
      VTAC: require(join(work, 'core', 'VTAC.js'))
    },
    dispose: () => rmSync(work, { recursive: true, force: true })
  }
}
