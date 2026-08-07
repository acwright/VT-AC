/**
 * Scroll regions and line/character editing — the `Screen` surface VT-100 mode
 * needs and native mode has no word for.
 *
 * Three things are being asserted throughout, and the third is the one that is
 * easy to lose:
 *
 * 1. Cells move, with their glyphs, colours and attributes.
 * 2. Rows and columns outside the operation do not.
 * 3. **Rendered pixels move too.** The framebuffer is a persistent plane that
 *    can be written to from outside — `VTAC.test.ts` does exactly that — so an
 *    operation that relocates a cell has to relocate what was drawn there, not
 *    just re-render from the description. A cell that was never dirty is never
 *    re-rendered, so if the pixels do not travel, nothing puts them back.
 */

import { Attr, BLANK_CODE } from '@core/Cell'
import { CHARACTERS } from '@core/Font'
import { Screen } from '@core/Screen'

const A = 0x41

/** `screen.codes` at a cell. */
const codeAt = (screen: Screen, col: number, row: number): number =>
  screen.codes[screen.index(col, row)]

/** The glyph codes of a whole row. */
const rowCodes = (screen: Screen, row: number): number[] => {
  const out: number[] = []
  for (let col = 0; col < screen.cols; col++) out.push(codeAt(screen, col, row))
  return out
}

/** The 64 pixels of one cell, after rasterizing whatever is outstanding. */
const cellPixels = (screen: Screen, col: number, row: number): number[] => {
  screen.rasterize()
  const out: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      out.push(screen.plane[(row * 8 + y) * screen.width + col * 8 + x])
    }
  }
  return out
}

/** What a glyph should rasterize to, computed the long way round. */
const expectedGlyph = (code: number, fg: number, bg: number): number[] => {
  const out: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      out.push(((CHARACTERS[code][y] >> (7 - x)) & 1) === 1 ? fg : bg)
    }
  }
  return out
}

/**
 * Write 64 pixels straight into the plane, describing nothing.
 *
 * The cell stays clean, so the rasterizer will never repaint it — which is what
 * makes this the sharp test of whether an operation moved the pixels itself.
 */
const poke = (screen: Screen, col: number, row: number, value: number): void => {
  screen.rasterize()
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      screen.plane[(row * 8 + y) * screen.width + col * 8 + x] = value
    }
  }
}

/** Put `A`, `B`, `C`… in column 0 of each row, so a row is identifiable. */
const label = (screen: Screen, rows: number): void => {
  for (let row = 0; row < rows; row++) screen.putGlyph(0, row, A + row, 0xff, 0x00)
}

describe('scrollUp', () => {
  it('moves rows inside the region and blanks what it exposes', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollUp(2, 5, 1, 0xff, 0x07)

    expect(codeAt(screen, 0, 2)).toBe(A + 3)
    expect(codeAt(screen, 0, 4)).toBe(A + 5)
    expect(codeAt(screen, 0, 5)).toBe(BLANK_CODE)
    expect(screen.bg[screen.index(0, 5)]).toBe(0x07)
  })

  it('leaves everything outside the region alone', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollUp(2, 5, 1, 0xff, 0x00)

    expect(codeAt(screen, 0, 1)).toBe(A + 1)
    expect(codeAt(screen, 0, 6)).toBe(A + 6)
  })

  it('moves by more than one row at a time', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollUp(0, 9, 3, 0xff, 0x00)

    expect(codeAt(screen, 0, 0)).toBe(A + 3)
    expect(codeAt(screen, 0, 6)).toBe(A + 9)
    expect(codeAt(screen, 0, 7)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 9)).toBe(BLANK_CODE)
  })

  it('blanks the whole region when the count reaches its height', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollUp(2, 5, 99, 0xff, 0x00)

    for (let row = 2; row <= 5; row++) expect(codeAt(screen, 0, row)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 6)).toBe(A + 6)
  })

  it('is a no-op for an empty, inverted or zero-count region', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollUp(5, 2, 1, 0xff, 0x00)
    screen.scrollUp(2, 5, 0, 0xff, 0x00)
    screen.scrollUp(2, 5, -1, 0xff, 0x00)

    expect(codeAt(screen, 0, 2)).toBe(A + 2)
  })

  it('clamps a region that runs off the screen', () => {
    // `DECSTBM 1;99` on a 30-row terminal is a real thing hosts send.
    const screen = new Screen()
    label(screen, 3)

    screen.scrollUp(-5, 99, 1, 0xff, 0x00)

    expect(codeAt(screen, 0, 0)).toBe(A + 1)
    expect(codeAt(screen, 0, 29)).toBe(BLANK_CODE)
  })

  it('carries rendered pixels nothing describes', () => {
    const screen = new Screen()
    poke(screen, 3, 5, 0xa5)

    screen.scrollUp(4, 8, 1, 0xff, 0x00)

    expect(cellPixels(screen, 3, 4)).toEqual(new Array(64).fill(0xa5))
  })

  it('leaves pixels outside the region where they are', () => {
    const screen = new Screen()
    poke(screen, 3, 10, 0xa5)

    screen.scrollUp(0, 5, 1, 0xff, 0x00)

    expect(cellPixels(screen, 3, 10)).toEqual(new Array(64).fill(0xa5))
  })

  it('rasterizes correctly when the cells it moved had never been drawn', () => {
    // The dirty-flag bookkeeping in `moveCells`: the flags travel with the
    // cells, and the outstanding count travels with them. If that count goes
    // wrong, `rasterize()` stops early and cells silently stay unpainted.
    const screen = new Screen()
    label(screen, 6)

    screen.scrollUp(0, 5, 2, 0xff, 0x00)
    screen.rasterize()

    expect(screen.hasDirtyCells).toBe(false)
    for (let row = 0; row <= 3; row++) {
      expect(cellPixels(screen, 0, row)).toEqual(expectedGlyph(A + row + 2, 0xff, 0x00))
    }
    expect(cellPixels(screen, 0, 4)).toEqual(new Array(64).fill(0x00))
  })

  it('damages the region and nothing else', () => {
    const screen = new Screen()
    screen.takeDamage()

    screen.scrollUp(4, 8, 1, 0xff, 0x00)

    expect(screen.takeDamage()).toEqual({ col: 0, row: 4, cols: 40, rows: 5 })
  })
})

describe('scrollDown', () => {
  it('moves rows inside the region and blanks what it exposes', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollDown(2, 5, 1, 0xff, 0x07)

    expect(codeAt(screen, 0, 3)).toBe(A + 2)
    expect(codeAt(screen, 0, 5)).toBe(A + 4)
    expect(codeAt(screen, 0, 2)).toBe(BLANK_CODE)
    expect(screen.bg[screen.index(0, 2)]).toBe(0x07)
  })

  it('drops the rows pushed past the bottom margin', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollDown(2, 5, 1, 0xff, 0x00)

    // Row 5 held `F` and row 6 still does — `F` was pushed out of the region,
    // not into the row below it.
    expect(codeAt(screen, 0, 6)).toBe(A + 6)
  })

  it('moves by more than one row at a time', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollDown(0, 9, 3, 0xff, 0x00)

    expect(codeAt(screen, 0, 3)).toBe(A)
    expect(codeAt(screen, 0, 9)).toBe(A + 6)
    expect(codeAt(screen, 0, 0)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 2)).toBe(BLANK_CODE)
  })

  it('blanks the whole region when the count reaches its height', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollDown(2, 5, 99, 0xff, 0x00)

    for (let row = 2; row <= 5; row++) expect(codeAt(screen, 0, row)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 1)).toBe(A + 1)
  })

  it('is a no-op for an empty, inverted or zero-count region', () => {
    const screen = new Screen()
    label(screen, 10)

    screen.scrollDown(5, 2, 1, 0xff, 0x00)
    screen.scrollDown(2, 5, 0, 0xff, 0x00)

    expect(codeAt(screen, 0, 2)).toBe(A + 2)
  })

  it('clamps a region that runs off the screen', () => {
    const screen = new Screen()
    label(screen, 3)

    screen.scrollDown(-5, 99, 1, 0xff, 0x00)

    expect(codeAt(screen, 0, 1)).toBe(A)
    expect(codeAt(screen, 0, 0)).toBe(BLANK_CODE)
  })

  it('carries rendered pixels nothing describes', () => {
    const screen = new Screen()
    poke(screen, 3, 5, 0xa5)

    screen.scrollDown(4, 8, 1, 0xff, 0x00)

    expect(cellPixels(screen, 3, 6)).toEqual(new Array(64).fill(0xa5))
  })

  it('damages the region and nothing else', () => {
    const screen = new Screen()
    screen.takeDamage()

    screen.scrollDown(4, 8, 2, 0xff, 0x00)

    expect(screen.takeDamage()).toEqual({ col: 0, row: 4, cols: 40, rows: 5 })
  })
})

describe('IL and DL, as a region scroll starting at the cursor row', () => {
  // The composition Phase 5.3 dispatches to. Worth pinning here, because "IL
  // inside a scroll region" is the case the plan calls out as where off-by-one
  // errors hide — and there is nothing to get wrong if IL *is* the region
  // scroll rather than a second implementation of one.
  it('inserts a line at the cursor without disturbing the rest of the region', () => {
    const screen = new Screen()
    label(screen, 10)

    // IL 1 with the cursor on row 4, margins 2..7.
    screen.scrollDown(4, 7, 1, 0xff, 0x00)

    expect(codeAt(screen, 0, 3)).toBe(A + 3) // above the cursor: untouched
    expect(codeAt(screen, 0, 4)).toBe(BLANK_CODE) // the inserted line
    expect(codeAt(screen, 0, 5)).toBe(A + 4) // pushed down
    expect(codeAt(screen, 0, 8)).toBe(A + 8) // below the margin: untouched
  })

  it('deletes a line at the cursor and pulls the region up behind it', () => {
    const screen = new Screen()
    label(screen, 10)

    // DL 1 with the cursor on row 4, margins 2..7.
    screen.scrollUp(4, 7, 1, 0xff, 0x00)

    expect(codeAt(screen, 0, 3)).toBe(A + 3)
    expect(codeAt(screen, 0, 4)).toBe(A + 5)
    expect(codeAt(screen, 0, 7)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 8)).toBe(A + 8)
  })
})

describe('insertChars', () => {
  const fill = (screen: Screen): void => {
    for (let col = 0; col < 6; col++) screen.putGlyph(col, 0, A + col, 0xff, 0x00)
  }

  it('opens blank cells and pushes the rest of the row right', () => {
    const screen = new Screen()
    fill(screen)

    screen.insertChars(2, 0, 2, 0xff, 0x07)

    expect(rowCodes(screen, 0).slice(0, 8)).toEqual([
      A,
      A + 1,
      BLANK_CODE,
      BLANK_CODE,
      A + 2,
      A + 3,
      A + 4,
      A + 5
    ])
    expect(screen.bg[screen.index(2, 0)]).toBe(0x07)
  })

  it('drops what it pushes past the last column rather than wrapping it', () => {
    const screen = new Screen()
    screen.putGlyph(39, 0, A, 0xff, 0x00)
    screen.putGlyph(0, 1, A + 1, 0xff, 0x00)

    screen.insertChars(0, 0, 1, 0xff, 0x00)

    expect(codeAt(screen, 39, 0)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 1)).toBe(A + 1)
  })

  it('blanks the tail of the row when the count reaches the margin', () => {
    const screen = new Screen()
    fill(screen)

    screen.insertChars(2, 0, 99, 0xff, 0x00)

    expect(codeAt(screen, 1, 0)).toBe(A + 1)
    expect(rowCodes(screen, 0).slice(2).every((code) => code === BLANK_CODE)).toBe(true)
  })

  it('leaves other rows alone', () => {
    const screen = new Screen()
    screen.putGlyph(0, 1, A, 0xff, 0x00)

    screen.insertChars(0, 0, 3, 0xff, 0x00)

    expect(codeAt(screen, 0, 1)).toBe(A)
  })

  it('carries colours and attributes with the cells it moves', () => {
    const screen = new Screen()
    screen.putGlyph(0, 0, A, 0x1c, 0x03, Attr.BOLD | Attr.UNDERLINE)

    screen.insertChars(0, 0, 1, 0xff, 0x00)

    const i = screen.index(1, 0)
    expect(screen.codes[i]).toBe(A)
    expect(screen.fg[i]).toBe(0x1c)
    expect(screen.bg[i]).toBe(0x03)
    expect(screen.attrs[i]).toBe(Attr.BOLD | Attr.UNDERLINE)
  })

  it('carries rendered pixels nothing describes', () => {
    const screen = new Screen()
    poke(screen, 5, 2, 0xa5)

    screen.insertChars(3, 2, 2, 0xff, 0x00)

    expect(cellPixels(screen, 7, 2)).toEqual(new Array(64).fill(0xa5))
  })

  it('ignores a position off the screen and a count of zero', () => {
    const screen = new Screen()
    fill(screen)

    screen.insertChars(-1, 0, 1, 0xff, 0x00)
    screen.insertChars(0, 30, 1, 0xff, 0x00)
    screen.insertChars(0, 0, 0, 0xff, 0x00)

    expect(codeAt(screen, 0, 0)).toBe(A)
  })

  it('damages from the insertion point to the end of the row', () => {
    const screen = new Screen()
    screen.takeDamage()

    screen.insertChars(10, 3, 2, 0xff, 0x00)

    expect(screen.takeDamage()).toEqual({ col: 10, row: 3, cols: 30, rows: 1 })
  })
})

describe('deleteChars', () => {
  const fill = (screen: Screen): void => {
    for (let col = 0; col < 6; col++) screen.putGlyph(col, 0, A + col, 0xff, 0x00)
  }

  it('removes cells and pulls the rest of the row left', () => {
    const screen = new Screen()
    fill(screen)

    screen.deleteChars(1, 0, 2, 0xff, 0x00)

    expect(rowCodes(screen, 0).slice(0, 4)).toEqual([A, A + 3, A + 4, A + 5])
  })

  it('blanks the cells exposed at the right-hand edge', () => {
    const screen = new Screen()
    fill(screen)

    screen.deleteChars(1, 0, 2, 0xff, 0x07)

    expect(codeAt(screen, 38, 0)).toBe(BLANK_CODE)
    expect(codeAt(screen, 39, 0)).toBe(BLANK_CODE)
    expect(screen.bg[screen.index(39, 0)]).toBe(0x07)
  })

  it('does not pull the next row up into the gap', () => {
    const screen = new Screen()
    screen.putGlyph(0, 1, A, 0xff, 0x00)

    screen.deleteChars(0, 0, 5, 0xff, 0x00)

    expect(codeAt(screen, 0, 1)).toBe(A)
  })

  it('blanks the tail of the row when the count reaches the margin', () => {
    const screen = new Screen()
    fill(screen)

    screen.deleteChars(2, 0, 99, 0xff, 0x00)

    expect(codeAt(screen, 1, 0)).toBe(A + 1)
    expect(rowCodes(screen, 0).slice(2).every((code) => code === BLANK_CODE)).toBe(true)
  })

  it('carries rendered pixels nothing describes', () => {
    const screen = new Screen()
    poke(screen, 5, 2, 0xa5)

    screen.deleteChars(3, 2, 2, 0xff, 0x00)

    expect(cellPixels(screen, 3, 2)).toEqual(new Array(64).fill(0xa5))
  })

  it('ignores a position off the screen and a count of zero', () => {
    const screen = new Screen()
    fill(screen)

    screen.deleteChars(40, 0, 1, 0xff, 0x00)
    screen.deleteChars(0, -1, 1, 0xff, 0x00)
    screen.deleteChars(0, 0, 0, 0xff, 0x00)

    expect(codeAt(screen, 0, 0)).toBe(A)
  })
})

describe('eraseChars', () => {
  it('blanks a run in place, shifting nothing', () => {
    const screen = new Screen()
    for (let col = 0; col < 6; col++) screen.putGlyph(col, 0, A + col, 0xff, 0x00)

    screen.eraseChars(1, 0, 3, 0xff, 0x07)

    expect(rowCodes(screen, 0).slice(0, 6)).toEqual([
      A,
      BLANK_CODE,
      BLANK_CODE,
      BLANK_CODE,
      A + 4,
      A + 5
    ])
    expect(screen.bg[screen.index(1, 0)]).toBe(0x07)
  })

  it('stops at the right-hand edge instead of running into the next row', () => {
    const screen = new Screen()
    screen.putGlyph(0, 1, A, 0xff, 0x00)

    screen.eraseChars(38, 0, 99, 0xff, 0x00)

    expect(codeAt(screen, 39, 0)).toBe(BLANK_CODE)
    expect(codeAt(screen, 0, 1)).toBe(A)
  })

  it('erases a whole row, which is how EL 2 is spelled', () => {
    const screen = new Screen()
    for (let col = 0; col < 40; col++) screen.putGlyph(col, 4, A, 0xff, 0x00)

    screen.eraseChars(0, 4, screen.cols, 0xff, 0x00)

    expect(rowCodes(screen, 4).every((code) => code === BLANK_CODE)).toBe(true)
  })

  it('ignores a count of zero and a row off the screen', () => {
    const screen = new Screen()
    screen.putGlyph(0, 0, A, 0xff, 0x00)

    screen.eraseChars(0, 0, 0, 0xff, 0x00)
    screen.eraseChars(0, 30, 5, 0xff, 0x00)

    expect(codeAt(screen, 0, 0)).toBe(A)
  })
})

describe('the native scrolls are the whole-screen case', () => {
  // v1's four scroll commands now delegate here. The point of the test is that
  // they are the *same* code, so `VTAC.test.ts` and `verify:cellmodel` are
  // covering the region machinery too.
  it('scroll up matches scrollUp over every row', () => {
    const delegated = new Screen()
    const direct = new Screen()
    label(delegated, 10)
    label(direct, 10)

    delegated.scroll('up', 0xff, 0x05)
    direct.scrollUp(0, direct.rows - 1, 1, 0xff, 0x05)

    expect(rowCodes(delegated, 0)).toEqual(rowCodes(direct, 0))
    expect(rowCodes(delegated, 29)).toEqual(rowCodes(direct, 29))
  })

  it('scroll left matches deleteChars on every row', () => {
    const delegated = new Screen()
    const direct = new Screen()
    for (const screen of [delegated, direct]) {
      for (let col = 0; col < 4; col++) screen.putGlyph(col, 1, A + col, 0xff, 0x00)
    }

    delegated.scroll('left', 0xff, 0x05)
    for (let row = 0; row < direct.rows; row++) direct.deleteChars(0, row, 1, 0xff, 0x05)

    expect(rowCodes(delegated, 1)).toEqual(rowCodes(direct, 1))
  })
})
