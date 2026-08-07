#!/usr/bin/env node
/**
 * Check src/core/palette.ts against images/palette.png.
 *
 * PLAN.md §Phase 1 names the RGB332 expansion as the one place a
 * no-behaviour-change claim can break while every non-pixel test still passes,
 * and names images/palette.png — a screenshot of v1's SDL window running
 * examples/palette.bin — as the ground truth. This is that check, run rather
 * than eyeballed.
 *
 * Two complications, both handled here:
 *
 * 1. The screenshot is a macOS window capture, so the palette is a known
 *    sub-rectangle of it rather than the whole image. examples/palette.js lays
 *    the 256 colours out as a 16x16 grid of 8x8-pixel blocks centred on the
 *    40x30 grid, which puts colour n at framebuffer (96 + 8*(n%16), 56 +
 *    8*(n/16)). The grid's device-pixel bounds are found by scanning, so the
 *    script does not depend on the window's position or the display's scale.
 *
 * 2. macOS captures in Display P3 while the SDL window content is sRGB, so raw
 *    pixel values are the sRGB->P3 image of the colours SDL drew. The
 *    comparison applies that same transform to each candidate expansion rather
 *    than trying to undo it.
 *
 * Usage: node scripts/verify-palette.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─── a minimal PNG reader (8-bit, non-interlaced) ────────────────────────────

function decodePNG(path) {
  const buf = readFileSync(path)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported')

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported colour type ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let pos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = line[i]
      switch (filter) {
        case 0:
          break
        case 1:
          v += a
          break
        case 2:
          v += b
          break
        case 3:
          v += (a + b) >> 1
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new Error(`unknown filter ${filter}`)
      }
      cur[i] = v & 0xff
    }
  }

  const pixel = (x, y) => {
    const i = y * stride + x * channels
    return channels >= 3 ? [out[i], out[i + 1], out[i + 2]] : [out[i], out[i], out[i]]
  }
  return { width, height, pixel }
}

// ─── sRGB -> Display P3, the transform a macOS screen capture applies ────────

const SRGB_TO_P3 = [
  [0.8224621, 0.177538, 0.0],
  [0.0331941, 0.9668058, 0.0],
  [0.0170827, 0.0723974, 0.9105199]
]

const linearize = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

const encode = (v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

const toDisplayP3 = ([r, g, b]) => {
  const lin = [linearize(r), linearize(g), linearize(b)]
  return SRGB_TO_P3.map((row) => encode(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))
}

// ─── the two candidate expansions ────────────────────────────────────────────

const CANDIDATES = {
  // What SDL's SDL_expand_byte lookup tables contain.
  'floor (SDL)': (value, bits) => Math.floor((value * 255) / ((1 << bits) - 1)),
  // What PLAN.md §Phase 1 specifies.
  'round (PLAN)': (value, bits) => Math.round((value * 255) / ((1 << bits) - 1))
}

const expandRGB332 = (byte, expand) => [
  expand((byte >> 5) & 0x07, 3),
  expand((byte >> 2) & 0x07, 3),
  expand(byte & 0x03, 2)
]

// ─── locate the palette grid in the screenshot ───────────────────────────────

/**
 * examples/palette.js centres a 16x16 grid of 8x8 blocks on the 40x30 screen,
 * so the grid occupies framebuffer x 96..223, y 56..183 — 128x128 pixels.
 */
const GRID_CELLS = 16
const CELL_PIXELS = 8

function findGrid(img) {
  // Skip the window's title bar and 1px frame, then take the bounding box of
  // everything that is not the black screen background.
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = Math.floor(img.height * 0.17); y < img.height * 0.87; y++) {
    for (let x = Math.floor(img.width * 0.08); x < img.width * 0.92; x++) {
      const [r, g, b] = img.pixel(x, y)
      if (r > 16 || g > 16 || b > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const size = maxX - minX + 1
  if (size !== maxY - minY + 1) {
    throw new Error(`palette grid is not square: ${size}x${maxY - minY + 1}`)
  }
  const scale = size / (GRID_CELLS * CELL_PIXELS)
  if (!Number.isInteger(scale)) {
    throw new Error(`palette grid is ${size}px, not a whole multiple of 128`)
  }
  return { x: minX, y: minY, scale }
}

// ─── compare ─────────────────────────────────────────────────────────────────

const img = decodePNG(join(ROOT, 'images', 'palette.png'))
const grid = findGrid(img)
console.log(
  `images/palette.png: ${img.width}x${img.height}, ` +
    `palette grid at (${grid.x}, ${grid.y}) at ${grid.scale}x device pixels\n`
)

const sampled = []
for (let value = 0; value < 256; value++) {
  const cellX = (value % GRID_CELLS) * CELL_PIXELS * grid.scale
  const cellY = Math.floor(value / GRID_CELLS) * CELL_PIXELS * grid.scale
  const centre = (CELL_PIXELS * grid.scale) / 2
  sampled.push(img.pixel(grid.x + cellX + centre, grid.y + cellY + centre))
}

const results = []
for (const [name, expand] of Object.entries(CANDIDATES)) {
  let total = 0
  let worst = 0
  let exact = 0
  for (let value = 0; value < 256; value++) {
    const expected = toDisplayP3(expandRGB332(value, expand))
    const actual = sampled[value]
    const error = expected.reduce((sum, c, i) => sum + Math.abs(c - actual[i]), 0)
    total += error
    worst = Math.max(worst, error)
    if (error === 0) exact++
  }
  results.push({ name, total, worst, exact })
  console.log(
    `${name.padEnd(14)} exact ${String(exact).padStart(3)}/256   ` +
      `total |error| ${String(total).padStart(4)}   worst ${worst}`
  )
}

results.sort((a, b) => a.total - b.total)
const [best, other] = results
console.log(`\nBest fit: ${best.name}`)

if (!best.name.startsWith('floor')) {
  console.error('\nFAIL: src/core/palette.ts expands with floor, but the screenshot disagrees.')
  process.exit(1)
}
if (best.total >= other.total) {
  console.error('\nFAIL: the two candidates are indistinguishable from this screenshot.')
  process.exit(1)
}

console.log('OK: src/core/palette.ts matches v1s SDL output.')
