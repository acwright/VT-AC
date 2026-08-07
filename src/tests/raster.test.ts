import { CHARACTERS } from '@core/Font'
import { RGB332_RGBA } from '@core/palette'
import { blitRGB332, overlayCursor } from '@core/raster'
import { VTAC } from '@core/VTAC'

/** A plane and a raster of the same geometry, as the renderer holds them. */
function makeTarget(cols: number, rows: number) {
  const width = cols * 8
  const height = rows * 8
  return {
    width,
    height,
    plane: new Uint8Array(width * height),
    raster: new Uint32Array(width * height)
  }
}

/** Bytes of a packed pixel, so assertions read R,G,B,A on either endianness. */
const bytesOf = (value: number): number[] =>
  Array.from(new Uint8Array(new Uint32Array([value]).buffer))

describe('blitRGB332', () => {
  it('expands every RGB332 byte exactly as the palette table does', () => {
    const { plane, raster, width } = makeTarget(32, 8)
    for (let i = 0; i < 256; i++) plane[i] = i

    blitRGB332(plane, raster, width, 0, 0, width, 1)

    for (let i = 0; i < 256; i++) {
      expect(raster[i]).toBe(RGB332_RGBA[i])
    }
  })

  it('converts only the named rectangle', () => {
    const { plane, raster, width } = makeTarget(4, 4)
    plane.fill(0xff)

    // One cell, in the middle of a plane that is entirely white.
    blitRGB332(plane, raster, width, 8, 8, 8, 8)

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const inside = x >= 8 && x < 16 && y >= 8 && y < 16
        expect(raster[y * width + x]).toBe(inside ? RGB332_RGBA[0xff] : 0)
      }
    }
  })

  it('leaves earlier pixels alone, which is what makes a static screen free', () => {
    const { plane, raster, width } = makeTarget(4, 4)

    plane.fill(0xe0)
    blitRGB332(plane, raster, width, 0, 0, width, 32)

    // A later, smaller blit must not disturb what surrounds it.
    plane.fill(0x1c)
    blitRGB332(plane, raster, width, 0, 0, 8, 8)

    expect(raster[0]).toBe(RGB332_RGBA[0x1c])
    expect(raster[8]).toBe(RGB332_RGBA[0xe0])
    expect(raster[width * 8]).toBe(RGB332_RGBA[0xe0])
  })

  it('addresses rows through the stride, not the rectangle width', () => {
    const { plane, raster, width } = makeTarget(4, 4)
    // Column 3, rows 1-2: a tall thin region whose rows are `width` apart.
    plane.fill(0x03)

    blitRGB332(plane, raster, width, 24, 8, 8, 16)

    expect(raster[8 * width + 24]).toBe(RGB332_RGBA[0x03])
    expect(raster[23 * width + 31]).toBe(RGB332_RGBA[0x03])
    expect(raster[8 * width + 23]).toBe(0)
    expect(raster[24 * width + 24]).toBe(0)
  })
})

describe('overlayCursor', () => {
  it('inverts the glyph — set bits take the background colour', () => {
    const { raster, width } = makeTarget(4, 4)
    const fg = 0xff
    const bg = 0x00
    const code = 0xdb // full block: every bit set

    overlayCursor(raster, width, 0, 0, code, fg, bg)

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(raster[y * width + x]).toBe(RGB332_RGBA[bg])
      }
    }
  })

  it('draws clear bits in the foreground colour', () => {
    const { raster, width } = makeTarget(4, 4)
    // 0x20 is the blank glyph: no bits set, so the whole cell is foreground.
    overlayCursor(raster, width, 0, 0, 0x20, 0xe0, 0x03)

    for (let i = 0; i < 8; i++) {
      expect(raster[i]).toBe(RGB332_RGBA[0xe0])
    }
  })

  it('reproduces a real glyph, bit for bit, MSB leftmost', () => {
    const { raster, width } = makeTarget(4, 4)
    const code = 0x41 // 'A'
    const fg = 0xff
    const bg = 0x00

    overlayCursor(raster, width, 0, 0, code, fg, bg)

    for (let y = 0; y < 8; y++) {
      const bits = CHARACTERS[code][y]
      for (let x = 0; x < 8; x++) {
        const set = ((bits >> (7 - x)) & 1) === 1
        expect(bytesOf(raster[y * width + x])).toEqual(
          bytesOf(RGB332_RGBA[set ? bg : fg])
        )
      }
    }
  })

  it('lands on the addressed cell and touches no other', () => {
    const { raster, width, height } = makeTarget(4, 4)

    overlayCursor(raster, width, 2, 1, 0xdb, 0xff, 0x1c)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= 16 && x < 24 && y >= 8 && y < 16
        expect(raster[y * width + x]).toBe(inside ? RGB332_RGBA[0x1c] : 0)
      }
    }
  })

  it('is v1 drawCursor, against a screen the terminal actually drew', () => {
    // v1 copied the framebuffer and stamped the cursor into the copy
    // (src/index.ts:288-311). The composed result — plane underneath, cursor on
    // top — has to be identical, since that copy is what reached the screen.
    const vtac = new VTAC()
    for (const byte of [0x48, 0x49]) vtac.parse(byte) // "HI"
    vtac.cursorChar = 0xdb

    const screen = vtac.screen
    screen.rasterize()

    const raster = new Uint32Array(screen.width * screen.height)
    blitRGB332(screen.plane, raster, screen.width, 0, 0, screen.width, screen.height)
    overlayCursor(
      raster,
      screen.width,
      vtac.column,
      vtac.row,
      vtac.cursorChar,
      vtac.foregroundColor,
      vtac.backgroundColor
    )

    // v1's own composition, on the RGB332 buffer, then expanded.
    const expected = Buffer.from(vtac.buffer)
    const glyph = CHARACTERS[vtac.cursorChar]
    for (let y = 0; y < 8; y++) {
      const row = (vtac.row * 8 + y) * screen.width + vtac.column * 8
      for (let x = 0; x < 8; x++) {
        const bit = (glyph[y] >> (7 - x)) & 1
        expected[row + x] = bit ? vtac.backgroundColor : vtac.foregroundColor
      }
    }

    for (let i = 0; i < expected.length; i++) {
      expect(raster[i]).toBe(RGB332_RGBA[expected[i]])
    }
  })
})
