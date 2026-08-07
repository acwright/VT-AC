/**
 * Character sets, tab stops and reports.
 *
 * The charset half is where CP437 pays off: DEC Special Graphics line drawing
 * and the UK pound both resolve onto glyphs the ROM already has, which is the
 * argument the plan makes for choosing that ROM in the first place.
 */

import { DEC_SPECIAL_GRAPHICS } from '@core/Font'
import { VTAC } from '@core/VTAC'
import { Charset, Charsets } from '@core/ansi/Charsets'

const CSI = '\x1b['

function terminal(): {
  vtac: VTAC
  feed: (...items: string[]) => void
  sent: () => string
  at: (col: number, row: number) => number
  text: (row: number) => string
} {
  const vtac = new VTAC()
  vtac.setPersonality('vt100')

  const out: number[] = []
  vtac.setTransmitCallback((bytes) => out.push(...bytes))

  const feed = (...items: string[]): void => {
    for (const text of items) {
      for (let i = 0; i < text.length; i++) vtac.parse(text.charCodeAt(i))
    }
  }

  const at = (col: number, row: number): number => vtac.screen.codes[vtac.screen.index(col, row)]

  const text = (row: number): string => {
    let result = ''
    for (let col = 0; col < vtac.screen.cols; col++) result += String.fromCharCode(at(col, row))
    return result.replace(/ +$/, '')
  }

  return {
    vtac,
    feed,
    sent: () => String.fromCharCode(...out),
    at,
    text
  }
}

describe('SCS — designating character sets', () => {
  it('starts with ASCII in all four slots', () => {
    const { vtac } = terminal()
    const charsets = vtac.vt100.charsets

    expect(charsets.g).toEqual([Charset.Ascii, Charset.Ascii, Charset.Ascii, Charset.Ascii])
    expect(charsets.gl).toBe(0)
  })

  it.each([
    ['(', 0],
    [')', 1],
    ['*', 2],
    ['+', 3]
  ])('designates through the %s slot', (intermediate, slot) => {
    const { vtac, feed } = terminal()

    feed(`\x1b${intermediate}0`)

    expect(vtac.vt100.charsets.g[slot]).toBe(Charset.SpecialGraphics)
  })

  it('names ASCII with B and UK with A', () => {
    const { vtac, feed } = terminal()

    feed('\x1b(A')
    expect(vtac.vt100.charsets.g[0]).toBe(Charset.Uk)
    feed('\x1b(B')
    expect(vtac.vt100.charsets.g[0]).toBe(Charset.Ascii)
  })

  it('leaves the slot alone when asked for a set it does not have', () => {
    const { vtac, feed } = terminal()

    feed('\x1b(0')
    feed('\x1b(<') // DEC supplemental — not in this ROM
    expect(vtac.vt100.charsets.g[0]).toBe(Charset.SpecialGraphics)
  })

  it('ignores a slot that is not one of the four', () => {
    const charsets = new Charsets()

    charsets.designate(-1, Charset.SpecialGraphics)
    charsets.designate(4, Charset.SpecialGraphics)

    expect(charsets.g).toEqual([Charset.Ascii, Charset.Ascii, Charset.Ascii, Charset.Ascii])
  })
})

describe('escape sequences that look like these but are not', () => {
  it('ignores an escape carrying two intermediates', () => {
    const { vtac, feed } = terminal()

    feed('\x1b()0')

    expect(vtac.vt100.charsets.g[0]).toBe(Charset.Ascii)
    expect(vtac.vt100.charsets.g[1]).toBe(Charset.Ascii)
  })

  it('ignores the `#` line-attribute sequences a VT100 has and VT-AC does not', () => {
    // `ESC # 3`/`4`/`5`/`6` are double-height and double-width lines, which an
    // 8×8 ROM on a fixed grid cannot draw. Only DECALN is answered.
    const { feed, text } = terminal()

    feed('abc')
    feed('\x1b#3', '\x1b#6')

    expect(text(0)).toBe('abc')
  })
})

describe('DEC Special Graphics', () => {
  it('draws line-drawing glyphs from the CP437 ROM', () => {
    const { feed, at } = terminal()

    feed('\x1b(0')
    feed('lqk') // ┌ ─ ┐

    expect(at(0, 0)).toBe(DEC_SPECIAL_GRAPHICS[0x6c])
    expect(at(1, 0)).toBe(DEC_SPECIAL_GRAPHICS[0x71])
    expect(at(2, 0)).toBe(DEC_SPECIAL_GRAPHICS[0x6b])
  })

  it('draws a box whose corners and edges join up', () => {
    const { feed, at } = terminal()

    feed('\x1b(0')
    feed(`${CSI}1;1Hlqqk`)
    feed(`${CSI}2;1Hx  x`)
    feed(`${CSI}3;1Hmqqj`)

    expect(at(0, 0)).toBe(0xda) // ┌
    expect(at(3, 0)).toBe(0xbf) // ┐
    expect(at(0, 1)).toBe(0xb3) // │
    expect(at(0, 2)).toBe(0xc0) // └
    expect(at(3, 2)).toBe(0xd9) // ┘
    expect(at(1, 2)).toBe(0xc4) // ─
  })

  it('leaves bytes outside the set alone', () => {
    const { feed, at } = terminal()

    feed('\x1b(0')
    feed('A1')

    expect(at(0, 0)).toBe(0x41)
    expect(at(1, 0)).toBe(0x31)
  })

  it('does not translate the CP437 upper half', () => {
    const { vtac, feed, at } = terminal()

    feed('\x1b(0')
    vtac.parse(0xdb)

    expect(at(0, 0)).toBe(0xdb)
  })
})

describe('SO and SI — shifting', () => {
  it('swaps between G0 and G1 without redesignating either', () => {
    const { feed, at } = terminal()

    feed('\x1b(B') // G0 = ASCII
    feed('\x1b)0') // G1 = special graphics

    feed('q') // GL is G0 — an ordinary 'q'
    feed('\x0eq') // SO — G1, so a horizontal line
    feed('\x0fq') // SI — back to G0

    expect(at(0, 0)).toBe(0x71)
    expect(at(1, 0)).toBe(0xc4)
    expect(at(2, 0)).toBe(0x71)
  })

  it('follows a redesignation of the slot that is shifted in', () => {
    const { feed, at } = terminal()

    feed('\x0e') // SO — GL is G1
    feed('q')
    feed('\x1b)0') // G1 becomes special graphics
    feed('q')

    expect(at(0, 0)).toBe(0x71)
    expect(at(1, 0)).toBe(0xc4)
  })
})

describe('DECSC and DECRC', () => {
  it('save and restore the designation and the shift', () => {
    // `vttest`'s save/restore screen is what this is: five characters of line
    // drawing, a save, a detour, a restore, and five more that have to still be
    // line drawing. Without it they come back as `q` and `` ` ``.
    const { feed, at } = terminal()

    feed('\x1b(0') // G0 = special graphics
    feed('q')
    feed('\x1b7') // DECSC
    feed('\x1b(B') // G0 = ASCII again
    feed('q')
    feed('\x1b8') // DECRC — back to line drawing, and to column 1
    feed('q')

    expect(at(0, 0)).toBe(0xc4)
    expect(at(1, 0)).toBe(0xc4)
  })

  it('restore the GL shift as well as the designations', () => {
    const { feed, at } = terminal()

    feed('\x1b)0') // G1 = special graphics
    feed('\x0e') // SO — GL is G1
    feed('\x1b7') // DECSC
    feed('\x0f') // SI — back to G0, which is ASCII
    feed('\x1b8') // DECRC
    feed('q')

    expect(at(0, 0)).toBe(0xc4)
  })

  it('take a copy rather than a reference to the live designation', () => {
    const { feed, at } = terminal()

    feed('\x1b7') // DECSC with all four slots at ASCII
    feed('\x1b(0') // G0 = special graphics
    feed('\x1b8') // DECRC — which has to undo that
    feed('q')

    expect(at(0, 0)).toBe(0x71)
  })
})

describe('the UK set', () => {
  it('draws a pound sign where ASCII has a hash', () => {
    const { feed, at } = terminal()

    feed('\x1b(A')
    feed('#1')

    expect(at(0, 0)).toBe(0x9c) // CP437 £
    expect(at(1, 0)).toBe(0x31) // everything else is ASCII
  })
})

describe('tab stops', () => {
  it('stops every eight columns at power-on', () => {
    const { vtac, feed } = terminal()

    feed('\t')
    expect(vtac.column).toBe(8)
    feed('\t')
    expect(vtac.column).toBe(16)
  })

  it('sets a stop with HTS', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;4H`, '\x1bH') // a stop at column 3
    feed(`${CSI}1;1H`, '\t')

    expect(vtac.column).toBe(3)
  })

  it('clears the stop under the cursor with TBC 0', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;9H`, `${CSI}g`) // clear the stop at column 8
    feed(`${CSI}1;1H`, '\t')

    expect(vtac.column).toBe(16)
  })

  it('clears every stop with TBC 3, leaving tab a jump to the margin', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}3g`)
    feed(`${CSI}1;1H`, '\t')

    expect(vtac.column).toBe(39)
  })

  it('ignores a TBC mode it does not have', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}9g`)
    feed('\t')

    expect(vtac.column).toBe(8)
  })

  it('stops at the right margin when nothing is left to reach', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;35H`, '\t')

    expect(vtac.column).toBe(39)
  })

  it('is restored to every eight columns on RIS', () => {
    const { vtac, feed } = terminal()

    vtac.defaultPersonality = 'vt100'
    feed(`${CSI}3g`, '\x1bc')
    feed('\t')

    expect(vtac.column).toBe(8)
  })

  it('is rebuilt at the new width on a column switch', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}3g`) // clear every stop at 40 columns
    vtac.setColumns(80)
    feed('\t')

    expect(vtac.column).toBe(8)
    feed(`${CSI}1;70H`, '\t')
    expect(vtac.column).toBe(72)
  })

  it('leaves native mode tabbing every four columns', () => {
    const vtac = new VTAC()

    vtac.parse(0x09)

    expect(vtac.column).toBe(4)
  })
})

describe('reports', () => {
  it('identifies itself as a VT100 with AVO', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}c`)

    expect(sent()).toBe('\x1b[?1;2c')
  })

  it('answers DECID the same way', () => {
    const { feed, sent } = terminal()

    feed('\x1bZ')

    expect(sent()).toBe('\x1b[?1;2c')
  })

  it('answers a bare and a zero DA, and nothing else', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}0c`)
    expect(sent()).toBe('\x1b[?1;2c')

    feed(`${CSI}5c`)
    expect(sent()).toBe('\x1b[?1;2c')
  })

  it('reports itself well on DSR 5', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}5n`)

    expect(sent()).toBe('\x1b[0n')
  })

  it('reports the cursor position on DSR 6, one-based', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}10;20H`, `${CSI}6n`)

    expect(sent()).toBe('\x1b[10;20R')
  })

  it('reports the cursor relative to the top margin under DECOM', () => {
    // So that a report round-trips through the coordinates CUP accepts.
    const { feed, sent } = terminal()

    feed(`${CSI}5;20r`, `${CSI}?6h`)
    feed(`${CSI}3;7H`, `${CSI}6n`)

    expect(sent()).toBe('\x1b[3;7R')
  })

  it('answers DECREQTPARM, distinguishing the two requests', () => {
    // `vttest`'s terminal-reports item asks for both. The leading 2 or 3 is the
    // only thing that separates the answers: it says which request this is a
    // reply to, and VT-AC reports unsolicited under neither.
    const unsolicited = terminal()
    unsolicited.feed(`${CSI}0x`)
    expect(unsolicited.sent()).toBe('\x1b[2;1;1;112;112;1;0x')

    const onRequest = terminal()
    onRequest.feed(`${CSI}1x`)
    expect(onRequest.sent()).toBe('\x1b[3;1;1;112;112;1;0x')
  })

  it('ignores a terminal-parameters request it does not have', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}4x`)

    expect(sent()).toBe('')
  })

  it('ignores a status request it does not have', () => {
    const { feed, sent } = terminal()

    feed(`${CSI}99n`)

    expect(sent()).toBe('')
  })

  it('drops a reply on the floor when nothing has claimed the wire', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')

    expect(() => {
      for (const char of `${CSI}c`) vtac.parse(char.charCodeAt(0))
    }).not.toThrow()
  })
})

describe('DECALN', () => {
  it('fills the screen with E', () => {
    const { vtac, feed, text } = terminal()

    feed('\x1b#8')

    expect(text(0)).toBe('E'.repeat(40))
    expect(text(29)).toBe('E'.repeat(40))
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
  })

  it('opens the margins, so what follows starts from a known state', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}5;20r`)
    feed('\x1b#8')

    expect(vtac.vt100.top).toBe(0)
    expect(vtac.vt100.bottom).toBe(29)
  })
})

describe('reset', () => {
  it('returns the charsets to ASCII with G0 shifted in', () => {
    const { vtac, feed } = terminal()

    feed('\x1b(0', '\x1b)0', '\x0e')
    vtac.reset()

    const charsets = vtac.vt100.charsets
    expect(charsets.g).toEqual([Charset.Ascii, Charset.Ascii, Charset.Ascii, Charset.Ascii])
    expect(charsets.gl).toBe(0)
  })
})
