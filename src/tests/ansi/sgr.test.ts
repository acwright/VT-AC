/**
 * SGR — attributes and colour.
 *
 * Two halves: `applySGR` on its own, where the parameter grammar and its
 * malformed corners are easy to reach, and the whole terminal, where the point
 * is that an attribute reaches the cell and a background colour reaches
 * everything that erases.
 */

import { Attr, BLANK_CODE } from '@core/Cell'
import { CHARACTERS } from '@core/Font'
import { VTAC } from '@core/VTAC'
import { DEFAULT_BACKGROUND, DEFAULT_FOREGROUND, applySGR, resetPen } from '@core/ansi/SGR'
import type { Pen } from '@core/ansi/SGR'
import type { AnsiSequence } from '@core/ansi/StateMachine'
import { XTERM256_TO_RGB332, rgbToRGB332 } from '@core/palette'

const CSI = '\x1b['

/** A parameter list, shaped as the parser would hand it over. */
function sgr(...params: number[]): AnsiSequence {
  const at = (index: number): number => (index < params.length ? params[index] : 0)
  return {
    prefix: 0,
    intermediates: [],
    paramCount: params.length,
    param: at,
    paramOr: (index, fallback) => (at(index) === 0 ? fallback : at(index))
  }
}

/** A pen at its power-on state. */
function pen(): Pen {
  const value: Pen = { foreground: 0, background: 0, attrs: 0 }
  resetPen(value)
  return value
}

/** Apply a parameter list to a fresh pen and hand it back. */
function applied(...params: number[]): Pen {
  const value = pen()
  applySGR(sgr(...params), value)
  return value
}

describe('attributes', () => {
  it('sets each of the four the rasterizer can draw', () => {
    expect(applied(1).attrs).toBe(Attr.BOLD)
    expect(applied(4).attrs).toBe(Attr.UNDERLINE)
    expect(applied(5).attrs).toBe(Attr.BLINK)
    expect(applied(7).attrs).toBe(Attr.REVERSE)
  })

  it('accumulates them', () => {
    expect(applied(1, 4, 5, 7).attrs).toBe(
      Attr.BOLD | Attr.UNDERLINE | Attr.BLINK | Attr.REVERSE
    )
  })

  it('cancels each one individually, leaving the others', () => {
    const value = applied(1, 4, 5, 7)

    applySGR(sgr(22), value)
    expect(value.attrs).toBe(Attr.UNDERLINE | Attr.BLINK | Attr.REVERSE)
    applySGR(sgr(24), value)
    expect(value.attrs).toBe(Attr.BLINK | Attr.REVERSE)
    applySGR(sgr(25), value)
    expect(value.attrs).toBe(Attr.REVERSE)
    applySGR(sgr(27), value)
    expect(value.attrs).toBe(Attr.NONE)
  })

  it('ignores the ones an 8×8 glyph cannot show', () => {
    // 2 faint, 3 italic, 8 conceal, 9 strikethrough.
    expect(applied(2, 3, 8, 9).attrs).toBe(Attr.NONE)
  })
})

describe('reset', () => {
  it('clears attributes and both colours on SGR 0', () => {
    const value = applied(1, 4, 31, 42)

    applySGR(sgr(0), value)

    expect(value.attrs).toBe(Attr.NONE)
    expect(value.foreground).toBe(DEFAULT_FOREGROUND)
    expect(value.background).toBe(DEFAULT_BACKGROUND)
  })

  it('treats a bare CSI m as SGR 0', () => {
    const value = applied(1, 31)

    applySGR(sgr(), value)

    expect(value.attrs).toBe(Attr.NONE)
    expect(value.foreground).toBe(DEFAULT_FOREGROUND)
  })

  it('applies parameters after a reset in the same sequence', () => {
    const value = applied(1, 4)

    applySGR(sgr(0, 1, 31), value)

    expect(value.attrs).toBe(Attr.BOLD)
    expect(value.foreground).toBe(XTERM256_TO_RGB332[1])
  })
})

describe('the basic and bright colours', () => {
  it('maps 30-37 and 40-47 onto xterm colours 0-7', () => {
    for (let index = 0; index < 8; index++) {
      expect(applied(30 + index).foreground).toBe(XTERM256_TO_RGB332[index])
      expect(applied(40 + index).background).toBe(XTERM256_TO_RGB332[index])
    }
  })

  it('maps 90-97 and 100-107 onto xterm colours 8-15', () => {
    for (let index = 0; index < 8; index++) {
      expect(applied(90 + index).foreground).toBe(XTERM256_TO_RGB332[index + 8])
      expect(applied(100 + index).background).toBe(XTERM256_TO_RGB332[index + 8])
    }
  })

  it('lands on the RGB332 bytes those colours actually are', () => {
    // The exact end of the mapping, so a reordered table cannot pass. These
    // are the same spot checks `palette.test.ts` pins from the other side.
    expect(applied(30).foreground).toBe(0x00) // black
    expect(applied(97).foreground).toBe(0xff) // bright white
    expect(applied(91).foreground).toBe(0xe0) // bright red
    expect(applied(92).foreground).toBe(0x1c) // bright green
    expect(applied(94).foreground).toBe(0x03) // bright blue
  })

  it('puts a dim red in the red channel and nowhere else', () => {
    const red = applied(31).foreground

    expect((red >> 5) & 0x07).toBeGreaterThan(0)
    expect((red >> 2) & 0x07).toBe(0)
    expect(red & 0x03).toBe(0)
  })

  it('returns to the defaults on 39 and 49', () => {
    const value = applied(31, 42)

    applySGR(sgr(39), value)
    expect(value.foreground).toBe(DEFAULT_FOREGROUND)
    applySGR(sgr(49), value)
    expect(value.background).toBe(DEFAULT_BACKGROUND)
  })
})

describe('the extended colour forms', () => {
  it('quantizes an xterm-256 index through the palette', () => {
    expect(applied(38, 5, 196).foreground).toBe(XTERM256_TO_RGB332[196])
    expect(applied(48, 5, 21).background).toBe(XTERM256_TO_RGB332[21])
  })

  it('quantizes truecolour to the nearest RGB332', () => {
    expect(applied(38, 2, 255, 128, 0).foreground).toBe(rgbToRGB332(255, 128, 0))
    expect(applied(48, 2, 12, 34, 56).background).toBe(rgbToRGB332(12, 34, 56))
  })

  it('is a quantization, not a correspondence — the 256-colour trap', () => {
    // Two xterm colours a whole step apart in the grey ramp, landing on the
    // same RGB332 byte. `38;5;n` addresses xterm's palette, not VT-AC's; the
    // way to reach VT-AC's directly is native mode's 0x18.
    expect(applied(38, 5, 232).foreground).toBe(applied(38, 5, 233).foreground)

    const vtac = new VTAC()
    vtac.parse(0x18)
    vtac.parse(233)
    expect(vtac.foregroundColor).toBe(233)
  })

  it('carries on with the parameters after the colour', () => {
    const value = applied(38, 5, 196, 1, 4)

    expect(value.foreground).toBe(XTERM256_TO_RGB332[196])
    expect(value.attrs).toBe(Attr.BOLD | Attr.UNDERLINE)
  })

  it('ignores an index outside the palette rather than clamping it', () => {
    expect(applied(38, 5, 300).foreground).toBe(DEFAULT_FOREGROUND)
  })

  it('swallows the rest of a truncated form rather than guessing', () => {
    // `CSI 38;5m` has already lost its meaning. Reading the tail of
    // `CSI 38;5;1;31m` as attributes would be a guess, and a visible one.
    expect(applied(38, 5).foreground).toBe(DEFAULT_FOREGROUND)
    expect(applied(38, 2, 1, 2).foreground).toBe(DEFAULT_FOREGROUND)
    expect(applied(48, 2, 1).background).toBe(DEFAULT_BACKGROUND)
    expect(applied(38, 5, 1).attrs).toBe(Attr.NONE)
  })

  it('swallows the rest after a selector it does not know', () => {
    expect(applied(38, 9, 1, 31).attrs).toBe(Attr.NONE)
    expect(applied(38, 9, 1, 31).foreground).toBe(DEFAULT_FOREGROUND)
  })
})

//
// THROUGH THE TERMINAL
//

function terminal(): {
  vtac: VTAC
  feed: (...items: string[]) => void
  cellAttrs: (col: number, row: number) => number
  cellFg: (col: number, row: number) => number
  cellBg: (col: number, row: number) => number
} {
  const vtac = new VTAC()
  vtac.setPersonality('vt100')

  const feed = (...items: string[]): void => {
    for (const text of items) {
      for (let i = 0; i < text.length; i++) vtac.parse(text.charCodeAt(i))
    }
  }

  const index = (col: number, row: number): number => vtac.screen.index(col, row)

  return {
    vtac,
    feed,
    cellAttrs: (col, row) => vtac.screen.attrs[index(col, row)],
    cellFg: (col, row) => vtac.screen.fg[index(col, row)],
    cellBg: (col, row) => vtac.screen.bg[index(col, row)]
  }
}

describe('through the terminal', () => {
  it('puts the pen on the cells it writes, and only those', () => {
    const { feed, cellAttrs, cellFg, cellBg } = terminal()

    feed('a')
    feed(`${CSI}1;4;31;42m`)
    feed('b')
    feed(`${CSI}0m`)
    feed('c')

    expect(cellAttrs(0, 0)).toBe(Attr.NONE)
    expect(cellAttrs(1, 0)).toBe(Attr.BOLD | Attr.UNDERLINE)
    expect(cellFg(1, 0)).toBe(XTERM256_TO_RGB332[1])
    expect(cellBg(1, 0)).toBe(XTERM256_TO_RGB332[2])
    expect(cellAttrs(2, 0)).toBe(Attr.NONE)
    expect(cellFg(2, 0)).toBe(DEFAULT_FOREGROUND)
  })

  it('rasterizes reverse video by swapping the two colours', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}7m`)
    feed('A')
    vtac.screen.rasterize()

    const glyph = CHARACTERS[0x41]
    const pixelAt = (x: number, y: number): number => vtac.screen.plane[y * vtac.screen.width + x]

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const lit = ((glyph[y] >> (7 - x)) & 1) === 1
        // Reversed: a lit pixel takes the background, an unlit one the
        // foreground.
        expect(pixelAt(x, y)).toBe(lit ? DEFAULT_BACKGROUND : DEFAULT_FOREGROUND)
      }
    }
  })

  it('shares its colours with native mode, which is what 0x18 writes', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}31m`)

    expect(vtac.foregroundColor).toBe(XTERM256_TO_RGB332[1])
  })

  it('erases to the current background — background colour erase', () => {
    // Without this, `htop` and `vi` leave the wrong colour behind everywhere
    // they clear, which is more visible than any missing attribute.
    const { feed, cellBg } = terminal()
    const red = XTERM256_TO_RGB332[1]

    feed(`${CSI}41m`)
    feed(`${CSI}2J`)

    expect(cellBg(0, 0)).toBe(red)
    expect(cellBg(39, 29)).toBe(red)
  })

  it('erases a line and a run to the current background too', () => {
    const { feed, cellBg } = terminal()
    const green = XTERM256_TO_RGB332[2]

    feed(`${CSI}42m`)
    feed(`${CSI}5;1H`, `${CSI}2K`)
    feed(`${CSI}7;1H`, `${CSI}3X`)

    expect(cellBg(0, 4)).toBe(green)
    expect(cellBg(39, 4)).toBe(green)
    expect(cellBg(2, 6)).toBe(green)
  })

  it('scrolls a region in the current background', () => {
    const { feed, cellBg, cellAttrs } = terminal()
    const blue = XTERM256_TO_RGB332[4]

    feed(`${CSI}44m`)
    feed(`${CSI}30;1H`)
    feed('\n')

    expect(cellBg(0, 29)).toBe(blue)
    // The exposed row is blank text, not text wearing the pen's attributes.
    expect(cellAttrs(0, 29)).toBe(Attr.NONE)
  })

  it('saves and restores the pen with the cursor', () => {
    const { vtac, feed, cellAttrs, cellFg } = terminal()

    feed(`${CSI}1;31m`)
    feed('\x1b7')
    feed(`${CSI}0m`)
    feed('\x1b8')
    feed('x')

    expect(vtac.column).toBe(1)
    expect(cellAttrs(0, 0)).toBe(Attr.BOLD)
    expect(cellFg(0, 0)).toBe(XTERM256_TO_RGB332[1])
  })

  it('resets the pen when DECRC finds nothing saved', () => {
    const { feed, cellAttrs } = terminal()

    feed(`${CSI}1;31m`)
    feed('\x1b8')
    feed('x')

    expect(cellAttrs(0, 0)).toBe(Attr.NONE)
  })

  it('clears the pen on RIS', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;31;42m`)
    feed('\x1bc')

    expect(vtac.vt100.attrs).toBe(Attr.NONE)
    expect(vtac.foregroundColor).toBe(DEFAULT_FOREGROUND)
    expect(vtac.backgroundColor).toBe(DEFAULT_BACKGROUND)
  })

  it('leaves a blank cell blank, however loud the pen is', () => {
    const { feed, vtac } = terminal()

    feed(`${CSI}1;5;7;31;42m`)
    feed(`${CSI}2J`)

    expect(vtac.screen.codes[0]).toBe(BLANK_CODE)
  })
})
