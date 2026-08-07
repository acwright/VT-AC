import { Attr, BLANK_CODE, CellKind } from '@core/Cell'
import { CHARACTERS } from '@core/Font'
import { Screen } from '@core/Screen'
import { brightenRGB332 } from '@core/palette'

const pixel = (screen: Screen, col: number, row: number, x: number, y: number): number => {
  return screen.plane[(row * 8 + y) * screen.width + col * 8 + x]
}

/** The 64 pixels of one cell, top-left first, after rasterizing. */
const cellPixels = (screen: Screen, col: number, row: number): number[] => {
  screen.rasterize()
  const out: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) out.push(pixel(screen, col, row, x, y))
  }
  return out
}

/** What a glyph *should* rasterize to, computed the long way round. */
const expectedGlyph = (code: number, fg: number, bg: number): number[] => {
  const out: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      out.push(((CHARACTERS[code][y] >> (7 - x)) & 1) === 1 ? fg : bg)
    }
  }
  return out
}

describe('Screen', () => {
  it('starts blank, clean, and undamaged at the default geometry', () => {
    const screen = new Screen()

    expect(screen.cols).toBe(40)
    expect(screen.rows).toBe(30)
    expect(screen.width).toBe(320)
    expect(screen.height).toBe(240)
    expect(screen.plane.length).toBe(320 * 240)
    expect(screen.plane.every((value) => value === 0x00)).toBe(true)
    expect(screen.codes.every((value) => value === BLANK_CODE)).toBe(true)
    expect(screen.hasDirtyCells).toBe(false)
    expect(screen.takeDamage()).toBeNull()
  })

  it('takes an arbitrary geometry, which is what Phase 4 needs', () => {
    const screen = new Screen(80, 60)

    expect(screen.width).toBe(640)
    expect(screen.height).toBe(480)
    expect(screen.count).toBe(4800)
    expect(screen.plane.length).toBe(640 * 480)
  })

  //
  // TEXT CELLS
  //

  it('records a glyph rather than rasterizing it, and rasterizes on demand', () => {
    const screen = new Screen()

    screen.putGlyph(2, 3, 0x41, 0xf0, 0x0f)

    const i = screen.index(2, 3)
    expect(screen.kind[i]).toBe(CellKind.Text)
    expect(screen.codes[i]).toBe(0x41)
    expect(screen.fg[i]).toBe(0xf0)
    expect(screen.bg[i]).toBe(0x0f)
    // Nothing is drawn yet — that is the whole point of the cell model.
    expect(screen.hasDirtyCells).toBe(true)
    expect(pixel(screen, 2, 3, 0, 0)).toBe(0x00)

    expect(cellPixels(screen, 2, 3)).toEqual(expectedGlyph(0x41, 0xf0, 0x0f))
    expect(screen.hasDirtyCells).toBe(false)
  })

  it('answers what character is where — the question v1 could not', () => {
    const screen = new Screen()

    screen.putGlyph(3, 12, 0x5a, 0x1c, 0x00)

    expect(screen.codes[screen.index(3, 12)]).toBe(0x5a)
    expect(screen.codes[screen.index(4, 12)]).toBe(BLANK_CODE)
  })

  it('ignores writes outside the screen', () => {
    const screen = new Screen()

    screen.putGlyph(-1, 0, 0x41, 0xff, 0x00)
    screen.putGlyph(40, 0, 0x41, 0xff, 0x00)
    screen.putGlyph(0, 30, 0x41, 0xff, 0x00)
    screen.putPixelRow(0, 0, 8, 0xff, 0xff, 0x00)
    screen.putPixelRow(0, 0, -1, 0xff, 0xff, 0x00)

    expect(screen.hasDirtyCells).toBe(false)
    expect(screen.plane.every((value) => value === 0x00)).toBe(true)
  })

  //
  // ATTRIBUTES
  //

  it('renders REVERSE by swapping foreground and background', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x41, 0xe0, 0x03, Attr.REVERSE)

    expect(cellPixels(screen, 0, 0)).toEqual(expectedGlyph(0x41, 0x03, 0xe0))
  })

  it('renders BOLD by brightening the foreground one RGB332 step', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x41, 0x00, 0x00, Attr.BOLD)

    expect(brightenRGB332(0x00)).toBe(0x25)
    expect(cellPixels(screen, 0, 0)).toEqual(expectedGlyph(0x41, 0x25, 0x00))
    // Already at maximum, so bold on white stays white rather than wrapping.
    expect(brightenRGB332(0xff)).toBe(0xff)
  })

  it('renders UNDERLINE as a filled bottom row in the foreground', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x20, 0xff, 0x00, Attr.UNDERLINE)
    screen.rasterize()

    for (let x = 0; x < 8; x++) {
      expect(pixel(screen, 0, 0, x, 7)).toBe(0xff)
      expect(pixel(screen, 0, 0, x, 6)).toBe(0x00)
    }
  })

  it('hides BLINK cells on the dark half of the clock and repaints on the turn', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x41, 0xff, 0x11, Attr.BLINK)
    screen.putGlyph(1, 0, 0x41, 0xff, 0x11)
    screen.rasterize()

    screen.setBlink(false)
    expect(screen.hasDirtyCells).toBe(true)
    screen.rasterize()

    expect(cellPixels(screen, 0, 0)).toEqual(new Array(64).fill(0x11))
    // The cell without the attribute is untouched, and was never dirtied.
    expect(cellPixels(screen, 1, 0)).toEqual(expectedGlyph(0x41, 0xff, 0x11))

    screen.setBlink(true)
    screen.rasterize()
    expect(cellPixels(screen, 0, 0)).toEqual(expectedGlyph(0x41, 0xff, 0x11))
  })

  //
  // PIXEL CELLS
  //

  it('keeps rows a graphics stream has not written, including a glyph underneath', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x41, 0xff, 0x11)
    screen.putPixelRow(0, 0, 0, 0b10100000, 0xe0, 0x1c)
    screen.rasterize()

    expect(screen.kind[screen.index(0, 0)]).toBe(CellKind.Pixels)

    // Row 0 is the graphics data, in the colours in effect when it arrived.
    expect(pixel(screen, 0, 0, 0, 0)).toBe(0xe0)
    expect(pixel(screen, 0, 0, 1, 0)).toBe(0x1c)
    expect(pixel(screen, 0, 0, 2, 0)).toBe(0xe0)

    // Rows 1–7 are still the glyph that was there, in *its* colours — a cell
    // whose rows disagree, which is why `Pixels` cells exist at all.
    const glyph = expectedGlyph(0x41, 0xff, 0x11)
    for (let y = 1; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(pixel(screen, 0, 0, x, y)).toBe(glyph[y * 8 + x])
      }
    }
  })

  it('materializes from a cell that has not been rasterized yet', () => {
    const screen = new Screen()

    // No `rasterize()` between the two writes: the glyph is still only a
    // description when the graphics row lands on top of it.
    screen.putGlyph(0, 0, 0x41, 0xff, 0x11)
    screen.putPixelRow(0, 0, 3, 0xff, 0xe0, 0x00)
    screen.rasterize()

    const glyph = expectedGlyph(0x41, 0xff, 0x11)
    for (let x = 0; x < 8; x++) {
      expect(pixel(screen, 0, 0, x, 3)).toBe(0xe0)
      expect(pixel(screen, 0, 0, x, 2)).toBe(glyph[2 * 8 + x])
    }
  })

  it('turns a pixel cell back into a text cell when a glyph is written over it', () => {
    const screen = new Screen()

    screen.putPixelRow(0, 0, 0, 0xff, 0xe0, 0x00)
    screen.putGlyph(0, 0, 0x42, 0xff, 0x00)

    expect(screen.kind[screen.index(0, 0)]).toBe(CellKind.Text)
    expect(cellPixels(screen, 0, 0)).toEqual(expectedGlyph(0x42, 0xff, 0x00))
  })

  //
  // MOVING AND CLEARING
  //

  it('copies a pixel cell whole — description, block and rendered pixels', () => {
    const screen = new Screen()

    screen.putPixelRow(1, 1, 0, 0b11110000, 0xe0, 0x03)
    screen.rasterize()
    screen.copyCell(1, 1, 5, 5)

    expect(screen.kind[screen.index(5, 5)]).toBe(CellKind.Pixels)
    expect(cellPixels(screen, 5, 5)).toEqual(cellPixels(screen, 1, 1))
  })

  it('copies a cell that is still dirty, and both sides rasterize the same', () => {
    const screen = new Screen()

    screen.putGlyph(1, 1, 0x41, 0xf0, 0x0f)
    screen.copyCell(1, 1, 2, 2)
    screen.rasterize()

    expect(cellPixels(screen, 2, 2)).toEqual(expectedGlyph(0x41, 0xf0, 0x0f))
    expect(cellPixels(screen, 2, 2)).toEqual(cellPixels(screen, 1, 1))
  })

  it('carries pixels written straight into the plane along with the cell', () => {
    const screen = new Screen()

    // Nothing describes these pixels — they were poked in, exactly as
    // `VTAC.test.ts` pokes them through `vtac.buffer`.
    screen.rasterize()
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) screen.plane[(3 * 8 + y) * screen.width + 3 * 8 + x] = 0xa5
    }

    screen.copyCell(3, 3, 4, 4)

    expect(cellPixels(screen, 4, 4)).toEqual(new Array(64).fill(0xa5))
  })

  it('clears a cell to the background', () => {
    const screen = new Screen()

    screen.putGlyph(2, 2, 0x41, 0xff, 0x00)
    screen.clearCell(2, 2, 0xff, 0x33)

    expect(screen.codes[screen.index(2, 2)]).toBe(BLANK_CODE)
    expect(cellPixels(screen, 2, 2)).toEqual(new Array(64).fill(0x33))
  })

  it('scrolls cells, not just pixels, and blanks the vacated edge', () => {
    const screen = new Screen()

    screen.putGlyph(0, 0, 0x41, 0xff, 0x00)
    screen.putGlyph(1, 0, 0x42, 0xff, 0x00)
    screen.putGlyph(0, 1, 0x43, 0xff, 0x00)

    screen.scroll('up', 0xff, 0x05)
    expect(screen.codes[screen.index(0, 0)]).toBe(0x43)
    expect(screen.codes[screen.index(0, 29)]).toBe(BLANK_CODE)
    expect(screen.bg[screen.index(0, 29)]).toBe(0x05)

    screen.scroll('down', 0xff, 0x05)
    expect(screen.codes[screen.index(0, 1)]).toBe(0x43)
    expect(screen.codes[screen.index(0, 0)]).toBe(BLANK_CODE)

    screen.scroll('left', 0xff, 0x05)
    expect(screen.codes[screen.index(39, 1)]).toBe(BLANK_CODE)

    screen.putGlyph(0, 2, 0x44, 0xff, 0x00)
    screen.scroll('right', 0xff, 0x05)
    expect(screen.codes[screen.index(1, 2)]).toBe(0x44)
    expect(screen.codes[screen.index(0, 2)]).toBe(BLANK_CODE)
  })

  it('clears the whole screen to the background, leaving nothing outstanding', () => {
    const screen = new Screen()

    screen.putGlyph(4, 4, 0x41, 0xff, 0x00)
    screen.clear(0xff, 0x24)

    expect(screen.hasDirtyCells).toBe(false)
    expect(screen.plane.every((value) => value === 0x24)).toBe(true)
    expect(screen.codes.every((value) => value === BLANK_CODE)).toBe(true)
    expect(screen.bg.every((value) => value === 0x24)).toBe(true)
  })

  it('clears the four deleteTo ranges exactly where v1 did', () => {
    const screen = new Screen()
    const fill = () => {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) screen.putGlyph(col, row, 0x41, 0xff, 0x00)
      }
    }

    fill()
    screen.deleteTo('startOfLine', 2, 0, 0xff, 0x11)
    expect(screen.codes[screen.index(2, 0)]).toBe(BLANK_CODE)
    expect(screen.codes[screen.index(3, 0)]).toBe(0x41)

    fill()
    screen.deleteTo('endOfLine', 2, 0, 0xff, 0x11)
    expect(screen.codes[screen.index(1, 0)]).toBe(0x41)
    expect(screen.codes[screen.index(2, 0)]).toBe(BLANK_CODE)

    fill()
    screen.deleteTo('startOfScreen', 1, 1, 0xff, 0x11)
    expect(screen.codes[screen.index(4, 0)]).toBe(BLANK_CODE)
    expect(screen.codes[screen.index(1, 1)]).toBe(BLANK_CODE)
    expect(screen.codes[screen.index(2, 1)]).toBe(0x41)

    fill()
    screen.deleteTo('endOfScreen', 1, 1, 0xff, 0x11)
    expect(screen.codes[screen.index(0, 1)]).toBe(0x41)
    expect(screen.codes[screen.index(1, 1)]).toBe(BLANK_CODE)
    expect(screen.codes[screen.index(0, 2)]).toBe(BLANK_CODE)
  })

  //
  // DAMAGE
  //

  it('reports the changed region once, then forgets it', () => {
    const screen = new Screen()
    screen.takeDamage()

    screen.putGlyph(5, 6, 0x41, 0xff, 0x00)
    screen.putGlyph(9, 2, 0x42, 0xff, 0x00)

    expect(screen.takeDamage()).toEqual({ col: 5, row: 2, cols: 5, rows: 5 })
    expect(screen.takeDamage()).toBeNull()
  })

  it('damages the whole screen on a scroll, where clean cells move too', () => {
    const screen = new Screen()
    screen.takeDamage()

    screen.scroll('up', 0xff, 0x00)

    expect(screen.takeDamage()).toEqual({ col: 0, row: 0, cols: 40, rows: 30 })
  })

  //
  // INDEPENDENCE — the alternate screen buffer Phase 5 builds on
  //

  it('keeps two screens entirely separate', () => {
    const primary = new Screen()
    const alternate = new Screen()

    primary.putGlyph(0, 0, 0x41, 0xff, 0x00)
    primary.rasterize()
    alternate.rasterize()

    expect(alternate.codes[0]).toBe(BLANK_CODE)
    expect(alternate.plane.every((value) => value === 0x00)).toBe(true)
    expect(primary.plane).not.toBe(alternate.plane)
  })
})
