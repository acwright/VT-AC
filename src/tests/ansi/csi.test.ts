/**
 * CSI dispatch — cursor movement, erasing, and line/character editing.
 *
 * Scroll regions and the deferred wrap have their own file; this one is the
 * flat cases, where the region is the whole screen.
 */

import { BLANK_CODE } from '@core/Cell'
import { VTAC } from '@core/VTAC'
import type { Personality } from '@core/types'

const A = 0x41

/**
 * A terminal in VT-100 mode, with `feed` and a few readers.
 *
 * `defaultPersonality` is what RIS returns to, and only matters to the handful
 * of tests that reset mid-stream.
 */
function terminal(defaultPersonality: Personality = 'native'): {
  vtac: VTAC
  feed: (...items: Array<string | number>) => void
  at: (col: number, row: number) => number
  text: (row: number) => string
  cursor: () => [number, number]
} {
  const vtac = new VTAC()
  vtac.defaultPersonality = defaultPersonality
  vtac.setPersonality('vt100')

  const feed = (...items: Array<string | number>): void => {
    for (const item of items) {
      if (typeof item === 'number') vtac.parse(item)
      else for (let i = 0; i < item.length; i++) vtac.parse(item.charCodeAt(i))
    }
  }

  const at = (col: number, row: number): number => vtac.screen.codes[vtac.screen.index(col, row)]

  const text = (row: number): string => {
    let out = ''
    for (let col = 0; col < vtac.screen.cols; col++) out += String.fromCharCode(at(col, row))
    return out.replace(/ +$/, '')
  }

  return { vtac, feed, at, text, cursor: () => [vtac.column, vtac.row] }
}

/** `CSI` — the two bytes, as a host sends them. */
const CSI = '\x1b['

describe('cursor movement', () => {
  it('moves up, down, forward and back', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`)
    expect(cursor()).toEqual([19, 9])

    feed(`${CSI}3A`)
    expect(cursor()).toEqual([19, 6])
    feed(`${CSI}2B`)
    expect(cursor()).toEqual([19, 8])
    feed(`${CSI}4C`)
    expect(cursor()).toEqual([23, 8])
    feed(`${CSI}5D`)
    expect(cursor()).toEqual([18, 8])
  })

  it('treats an omitted or zero count as one', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;10H`, `${CSI}B`)
    expect(cursor()).toEqual([9, 10])
    feed(`${CSI}0B`)
    expect(cursor()).toEqual([9, 11])
  })

  it('stops at the edges instead of wrapping round', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}99A`, `${CSI}99D`)
    expect(cursor()).toEqual([0, 0])

    feed(`${CSI}99B`, `${CSI}99C`)
    expect(cursor()).toEqual([39, 29])
  })

  it('positions with CUP, which is one-based and row-first', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}1;1H`)
    expect(cursor()).toEqual([0, 0])
    feed(`${CSI}5;7H`)
    expect(cursor()).toEqual([6, 4])
  })

  it('homes on a bare CUP', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}12;12H`, `${CSI}H`)
    expect(cursor()).toEqual([0, 0])
  })

  it('clamps a CUP past the last row or column', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}99;99H`)
    expect(cursor()).toEqual([39, 29])
  })

  it('accepts HVP as another spelling of CUP', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;7f`)
    expect(cursor()).toEqual([6, 4])
  })

  it('moves to the start of a following or preceding line with CNL and CPL', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`, `${CSI}2E`)
    expect(cursor()).toEqual([0, 11])
    feed(`${CSI}20C`, `${CSI}3F`)
    expect(cursor()).toEqual([0, 8])
  })

  it('sets the column with CHA and the row with VPA, leaving the other alone', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`, `${CSI}5G`)
    expect(cursor()).toEqual([4, 9])
    feed(`${CSI}3d`)
    expect(cursor()).toEqual([4, 2])
  })

  it('indexes, reverse-indexes and takes the next line with ESC D, M and E', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`, '\x1bD')
    expect(cursor()).toEqual([19, 10])
    feed('\x1bM')
    expect(cursor()).toEqual([19, 9])
    feed('\x1bE')
    expect(cursor()).toEqual([0, 10])
  })
})

describe('saving and restoring the cursor', () => {
  it('puts the cursor and the colours back', () => {
    const { vtac, feed, cursor } = terminal()

    feed(`${CSI}10;20H`)
    vtac.foregroundColor = 0x1c
    vtac.backgroundColor = 0x03
    feed('\x1b7')

    feed(`${CSI}1;1H`)
    vtac.foregroundColor = 0xff
    vtac.backgroundColor = 0x00
    feed('\x1b8')

    expect(cursor()).toEqual([19, 9])
    expect(vtac.foregroundColor).toBe(0x1c)
    expect(vtac.backgroundColor).toBe(0x03)
  })

  it('homes the cursor when nothing was ever saved', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`, '\x1b8')
    expect(cursor()).toEqual([0, 0])
  })

  it('clamps a position the screen has since shrunk past', () => {
    const { vtac, feed, cursor } = terminal()

    vtac.setColumns(80)
    feed(`${CSI}50;70H`, '\x1b7')
    vtac.setColumns(40)
    feed('\x1b8')

    expect(cursor()).toEqual([39, 29])
  })

  it('is cleared by a reset', () => {
    // Configured VT-100 throughout, because RIS returns to the *default*
    // personality — from a native default it would hand the rest of this
    // stream back to the native parser, which is its own test elsewhere.
    const { feed, cursor } = terminal('vt100')

    feed(`${CSI}10;20H`, '\x1b7', '\x1bc')
    feed(`${CSI}5;5H`, '\x1b8')

    expect(cursor()).toEqual([0, 0])
  })
})

describe('erasing', () => {
  /** Put `A` in every cell of the first four rows. */
  const fill = (feed: (s: string) => void): void => {
    feed(`${CSI}1;1H`)
    for (let row = 0; row < 4; row++) feed('A'.repeat(40))
  }

  it('erases from the cursor to the end of the screen with ED 0', () => {
    const { feed, at } = terminal()
    fill(feed)

    feed(`${CSI}2;3H`, `${CSI}J`)

    expect(at(1, 1)).toBe(A)
    expect(at(2, 1)).toBe(BLANK_CODE)
    expect(at(0, 2)).toBe(BLANK_CODE)
    expect(at(39, 0)).toBe(A)
  })

  it('erases from the start of the screen to the cursor with ED 1', () => {
    const { feed, at } = terminal()
    fill(feed)

    feed(`${CSI}2;3H`, `${CSI}1J`)

    expect(at(39, 0)).toBe(BLANK_CODE)
    expect(at(2, 1)).toBe(BLANK_CODE)
    expect(at(3, 1)).toBe(A)
  })

  it('erases everything with ED 2, without moving the cursor', () => {
    const { feed, at, cursor } = terminal()
    fill(feed)

    feed(`${CSI}2;3H`, `${CSI}2J`)

    expect(at(0, 0)).toBe(BLANK_CODE)
    expect(at(39, 3)).toBe(BLANK_CODE)
    expect(cursor()).toEqual([2, 1])
  })

  it('erases the three EL ranges', () => {
    const { feed, at, text } = terminal()

    fill(feed)
    feed(`${CSI}2;3H`, `${CSI}K`)
    expect(at(1, 1)).toBe(A)
    expect(at(2, 1)).toBe(BLANK_CODE)

    fill(feed)
    feed(`${CSI}2;3H`, `${CSI}1K`)
    expect(at(2, 1)).toBe(BLANK_CODE)
    expect(at(3, 1)).toBe(A)

    fill(feed)
    feed(`${CSI}2;3H`, `${CSI}2K`)
    expect(text(1)).toBe('')
    expect(text(2)).toBe('A'.repeat(40))
  })

  it('ignores an erase mode it does not have', () => {
    const { feed, text } = terminal()
    fill(feed)

    feed(`${CSI}2;3H`, `${CSI}9J`, `${CSI}9K`)

    expect(text(1)).toBe('A'.repeat(40))
  })
})

describe('line editing', () => {
  /** Label the first six rows `A`, `B`, `C`… in column 0. */
  const label = (feed: (s: string) => void): void => {
    for (let row = 0; row < 6; row++) {
      feed(`${CSI}${row + 1};1H${String.fromCharCode(A + row)}`)
    }
  }

  it('inserts lines, pushing the rest of the screen down', () => {
    const { feed, at } = terminal()
    label(feed)

    feed(`${CSI}3;5H`, `${CSI}2L`)

    expect(at(0, 1)).toBe(A + 1)
    expect(at(0, 2)).toBe(BLANK_CODE)
    expect(at(0, 3)).toBe(BLANK_CODE)
    expect(at(0, 4)).toBe(A + 2)
  })

  it('deletes lines, pulling the rest of the screen up', () => {
    const { feed, at } = terminal()
    label(feed)

    feed(`${CSI}3;5H`, `${CSI}2M`)

    expect(at(0, 1)).toBe(A + 1)
    expect(at(0, 2)).toBe(A + 4)
    expect(at(0, 3)).toBe(A + 5)
  })

  it('moves the cursor to the first column, as a VT102 does', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}3;5H`, `${CSI}L`)
    expect(cursor()).toEqual([0, 2])

    feed(`${CSI}3;5H`, `${CSI}M`)
    expect(cursor()).toEqual([0, 2])
  })
})

describe('character editing', () => {
  const fill = (feed: (s: string) => void): void => {
    feed(`${CSI}1;1HABCDEF`)
  }

  it('inserts blanks with ICH, pushing the rest of the row right', () => {
    const { feed, text } = terminal()
    fill(feed)

    feed(`${CSI}1;3H`, `${CSI}2@`)

    expect(text(0)).toBe('AB  CDEF')
  })

  it('deletes with DCH, pulling the rest of the row left', () => {
    const { feed, text } = terminal()
    fill(feed)

    feed(`${CSI}1;2H`, `${CSI}2P`)

    expect(text(0)).toBe('ADEF')
  })

  it('erases in place with ECH, shifting nothing', () => {
    const { feed, text } = terminal()
    fill(feed)

    feed(`${CSI}1;2H`, `${CSI}3X`)

    expect(text(0)).toBe('A   EF')
  })

  it('leaves the cursor where it was', () => {
    const { feed, cursor } = terminal()
    fill(feed)

    feed(`${CSI}1;3H`, `${CSI}2@`, `${CSI}1P`, `${CSI}1X`)

    expect(cursor()).toEqual([2, 0])
  })

  it('does not spill onto the next row', () => {
    const { feed, text } = terminal()

    feed(`${CSI}1;40HZ`)
    feed(`${CSI}2;1HY`)
    feed(`${CSI}1;1H`, `${CSI}1@`)

    expect(text(0)).toBe('')
    expect(text(1)).toBe('Y')
  })
})
