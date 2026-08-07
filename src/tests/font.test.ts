import {
  CHARACTERS,
  DEC_SPECIAL_GRAPHICS,
  DEC_SPECIAL_GRAPHICS_MAX,
  DEC_SPECIAL_GRAPHICS_MIN
} from '@core/Font'
import { VTAC } from '@core/VTAC'

/** Codes with no glyph in a CP437 ROM, which resolve to a blank by design. */
const BLANK_BY_DESIGN = [
  0x5f, // _  blank
  0x62, // b  HT
  0x63, // c  FF
  0x64, // d  CR
  0x65, // e  LF
  0x68, // h  NL
  0x69, // i  VT
  0x7c // |  not equal
]

const isBlank = (code: number): boolean => CHARACTERS[code].every((row) => row === 0x00)

describe('CHARACTERS', () => {
  it('is a 256-glyph ROM of 8x8 bitmaps', () => {
    expect(CHARACTERS).toHaveLength(256)
    for (const glyph of CHARACTERS) {
      expect(glyph).toHaveLength(8)
      for (const row of glyph) {
        expect(Number.isInteger(row)).toBe(true)
        expect(row).toBeGreaterThanOrEqual(0x00)
        expect(row).toBeLessThanOrEqual(0xff)
      }
    }
  })

  it('survived the move out of VTAC.ts intact', () => {
    // Spot-checks at both ends and either side of the ASCII block, so a
    // transcription that dropped or shifted a row cannot pass.
    expect(CHARACTERS[0x00]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(CHARACTERS[0x01]).toEqual([0x7e, 0x81, 0xa5, 0x81, 0xbd, 0x99, 0x81, 0x7e]) // ☺
    expect(CHARACTERS[0x41]).toEqual([0x30, 0x78, 0xcc, 0xcc, 0xfc, 0xcc, 0xcc, 0x00]) // A
    expect(CHARACTERS[0x7a]).toEqual([0x00, 0x00, 0xfc, 0x98, 0x30, 0x64, 0xfc, 0x00]) // z
    expect(CHARACTERS[0xdb]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) // █
    expect(CHARACTERS[0xff]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('is still reachable as VTAC.CHARACTERS', () => {
    expect(VTAC.CHARACTERS).toBe(CHARACTERS)
  })
})

describe('DEC_SPECIAL_GRAPHICS', () => {
  it('covers exactly the DEC Special Graphics range', () => {
    const codes = Object.keys(DEC_SPECIAL_GRAPHICS)
      .map(Number)
      .sort((a, b) => a - b)
    const expected = []
    for (let code = DEC_SPECIAL_GRAPHICS_MIN; code <= DEC_SPECIAL_GRAPHICS_MAX; code++) {
      expected.push(code)
    }
    expect(codes).toEqual(expected)
  })

  it('resolves every code to a glyph the ROM actually has', () => {
    for (const [code, glyph] of Object.entries(DEC_SPECIAL_GRAPHICS)) {
      expect(Number.isInteger(glyph)).toBe(true)
      expect(glyph).toBeGreaterThanOrEqual(0x00)
      expect(glyph).toBeLessThanOrEqual(0xff)
      expect(CHARACTERS[glyph]).toBeDefined()
      // A mapping that points at an unused ROM slot renders as nothing, which
      // is indistinguishable from "no mapping at all" on screen — so only the
      // codes documented as blanks are allowed to be blank.
      if (!BLANK_BY_DESIGN.includes(Number(code))) {
        expect(isBlank(glyph)).toBe(false)
      }
    }
  })

  it('maps the line-drawing set onto the CP437 box glyphs', () => {
    expect(DEC_SPECIAL_GRAPHICS[0x6a]).toBe(0xd9) // j ┘
    expect(DEC_SPECIAL_GRAPHICS[0x6b]).toBe(0xbf) // k ┐
    expect(DEC_SPECIAL_GRAPHICS[0x6c]).toBe(0xda) // l ┌
    expect(DEC_SPECIAL_GRAPHICS[0x6d]).toBe(0xc0) // m └
    expect(DEC_SPECIAL_GRAPHICS[0x6e]).toBe(0xc5) // n ┼
    expect(DEC_SPECIAL_GRAPHICS[0x71]).toBe(0xc4) // q ─
    expect(DEC_SPECIAL_GRAPHICS[0x74]).toBe(0xc3) // t ├
    expect(DEC_SPECIAL_GRAPHICS[0x75]).toBe(0xb4) // u ┤
    expect(DEC_SPECIAL_GRAPHICS[0x76]).toBe(0xc1) // v ┴
    expect(DEC_SPECIAL_GRAPHICS[0x77]).toBe(0xc2) // w ┬
    expect(DEC_SPECIAL_GRAPHICS[0x78]).toBe(0xb3) // x │
  })

  it('draws a box whose corners and edges join up', () => {
    // The point of the whole mapping: an ncurses frame has to close. A vertical
    // edge must paint the same columns its corners do, and a horizontal edge
    // the same rows — otherwise the box is drawn with visible seams.
    const glyph = (code: number) => CHARACTERS[DEC_SPECIAL_GRAPHICS[code]]
    const vertical = glyph(0x78) // │
    const horizontal = glyph(0x71) // ─
    const topLeft = glyph(0x6c) // ┌
    const bottomRight = glyph(0x6a) // ┘

    const verticalColumns = vertical[0]
    const horizontalRow = horizontal.findIndex((row) => row !== 0x00)

    // ┌ carries the vertical stroke below the join and the horizontal to its right.
    expect(topLeft[7] & verticalColumns).toBe(verticalColumns)
    expect(topLeft[horizontalRow]).not.toBe(0x00)
    // ┘ carries the vertical stroke above the join and the horizontal to its left.
    expect(bottomRight[0] & verticalColumns).toBe(verticalColumns)
    expect(bottomRight[horizontalRow]).not.toBe(0x00)
    // Both corners put their horizontal stroke on the same row as ─ itself.
    expect(topLeft.findIndex((row) => (row & ~verticalColumns) !== 0)).toBe(horizontalRow)
  })

  it('maps the non-drawing glyphs the ROM does have', () => {
    expect(DEC_SPECIAL_GRAPHICS[0x60]).toBe(0x04) // ` ◆
    expect(DEC_SPECIAL_GRAPHICS[0x61]).toBe(0xb1) // a ▒
    expect(DEC_SPECIAL_GRAPHICS[0x66]).toBe(0xf8) // f °
    expect(DEC_SPECIAL_GRAPHICS[0x67]).toBe(0xf1) // g ±
    expect(DEC_SPECIAL_GRAPHICS[0x79]).toBe(0xf3) // y ≤
    expect(DEC_SPECIAL_GRAPHICS[0x7a]).toBe(0xf2) // z ≥
    expect(DEC_SPECIAL_GRAPHICS[0x7b]).toBe(0xe3) // { π
    expect(DEC_SPECIAL_GRAPHICS[0x7d]).toBe(0x9c) // } £
    expect(DEC_SPECIAL_GRAPHICS[0x7e]).toBe(0xfa) // ~ ·
  })

  it('puts scan line 9 on the cell floor', () => {
    // The one scan line the ROM can place correctly: `_` fills row 7 and
    // nothing else, which is where DEC draws scan line 9.
    const scanNine = CHARACTERS[DEC_SPECIAL_GRAPHICS[0x73]]
    expect(scanNine.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(scanNine[7]).toBe(0xff)
  })

  it('leaves bytes outside the range unmapped', () => {
    expect(DEC_SPECIAL_GRAPHICS[0x5e]).toBeUndefined()
    expect(DEC_SPECIAL_GRAPHICS[0x7f]).toBeUndefined()
    expect(DEC_SPECIAL_GRAPHICS[0x41]).toBeUndefined()
  })
})
