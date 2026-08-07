/**
 * Scroll regions and the deferred last-column wrap.
 *
 * The plan names these as the two things most likely to go wrong in the whole
 * VT-100 phase — the deferred wrap because it is the most commonly botched
 * VT100 behaviour and the first thing `vttest` catches, scroll regions crossed
 * with IL/DL because that is where off-by-one errors hide. Both are covered
 * here rather than left to the conformance run to discover.
 */

import { BLANK_CODE } from '@core/Cell'
import { VTAC } from '@core/VTAC'

const A = 0x41
const CSI = '\x1b['

function terminal(): {
  vtac: VTAC
  feed: (...items: Array<string | number>) => void
  at: (col: number, row: number) => number
  column0: () => string
  cursor: () => [number, number]
} {
  const vtac = new VTAC()
  vtac.setPersonality('vt100')

  const feed = (...items: Array<string | number>): void => {
    for (const item of items) {
      if (typeof item === 'number') vtac.parse(item)
      else for (let i = 0; i < item.length; i++) vtac.parse(item.charCodeAt(i))
    }
  }

  const at = (col: number, row: number): number => vtac.screen.codes[vtac.screen.index(col, row)]

  /** Column 0 of every row as a string — how a labelled screen reads. */
  const column0 = (): string => {
    let out = ''
    for (let row = 0; row < vtac.screen.rows; row++) out += String.fromCharCode(at(0, row))
    return out.replace(/ +$/, '')
  }

  return { vtac, feed, at, column0, cursor: () => [vtac.column, vtac.row] }
}

/** Put `A`, `B`, `C`… in column 0 of the first `rows` rows. */
const label = (feed: (s: string) => void, rows: number): void => {
  for (let row = 0; row < rows; row++) {
    feed(`${CSI}${row + 1};1H${String.fromCharCode(A + row)}`)
  }
}

describe('DECSTBM', () => {
  it('sets the margins and homes the cursor', () => {
    const { vtac, feed, cursor } = terminal()

    feed(`${CSI}10;20H`, `${CSI}5;20r`)

    expect(vtac.vt100.top).toBe(4)
    expect(vtac.vt100.bottom).toBe(19)
    expect(cursor()).toEqual([0, 0])
  })

  it('opens the region to the whole screen with no parameters', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}5;20r`, `${CSI}r`)

    expect(vtac.vt100.top).toBe(0)
    expect(vtac.vt100.bottom).toBe(29)
  })

  it('clamps a bottom margin past the last row', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;99r`)

    expect(vtac.vt100.bottom).toBe(29)
  })

  it('ignores an inverted or single-line region entirely', () => {
    const { vtac, feed, cursor } = terminal()

    feed(`${CSI}5;20r`, `${CSI}10;10H`)
    feed(`${CSI}20;5r`)

    expect(vtac.vt100.top).toBe(4)
    expect(vtac.vt100.bottom).toBe(19)
    // Not even the cursor moved — a half-applied DECSTBM would have homed it.
    expect(cursor()).toEqual([9, 9])

    feed(`${CSI}7;7r`)
    expect(vtac.vt100.top).toBe(4)
  })

  it('is opened again by a reset and by a column-mode switch', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}5;20r`)
    vtac.setColumns(80)
    expect(vtac.vt100.bottom).toBe(59)

    feed(`${CSI}5;20r`)
    vtac.reset()
    expect(vtac.vt100.top).toBe(0)
    expect(vtac.vt100.bottom).toBe(29)
  })
})

describe('scrolling inside the region', () => {
  it('scrolls the region, not the screen, when LF hits the bottom margin', () => {
    const { feed, at } = terminal()
    label(feed, 8)

    feed(`${CSI}2;5r`) // margins on rows 1..4
    feed(`${CSI}5;1H`) // cursor on the bottom margin
    feed('\n')

    expect(at(0, 0)).toBe(A) // above the region: untouched
    expect(at(0, 1)).toBe(A + 2) // region moved up
    expect(at(0, 3)).toBe(A + 4)
    expect(at(0, 4)).toBe(BLANK_CODE) // exposed at the foot of the region
    expect(at(0, 5)).toBe(A + 5) // below the region: untouched
  })

  it('scrolls the region down when RI hits the top margin', () => {
    const { feed, at } = terminal()
    label(feed, 8)

    feed(`${CSI}2;5r`)
    feed(`${CSI}2;1H`) // cursor on the top margin
    feed('\x1bM')

    expect(at(0, 0)).toBe(A)
    expect(at(0, 1)).toBe(BLANK_CODE)
    expect(at(0, 2)).toBe(A + 1)
    expect(at(0, 5)).toBe(A + 5)
  })

  it('walks a cursor below the bottom margin down to the last row and stops', () => {
    const { feed, at, cursor } = terminal()
    label(feed, 8)

    feed(`${CSI}2;5r`)
    feed(`${CSI}7;1H`) // below the region
    feed('\n'.repeat(40)) // more than enough to reach the foot of the screen

    expect(cursor()).toEqual([0, 29])
    // Nothing scrolled: the cursor was never inside the region.
    expect(at(0, 1)).toBe(A + 1)
  })

  it('stops CUU and CUD at the margin the cursor is inside', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`) // rows 4..19
    feed(`${CSI}10;1H`, `${CSI}99A`)
    expect(cursor()).toEqual([0, 4])
    feed(`${CSI}99B`)
    expect(cursor()).toEqual([0, 19])
  })

  it('does not drag a cursor outside the region back into it', () => {
    // The margin only applies from the side the cursor started on. A cursor
    // above the region walks to the top of the *screen*, not to the top
    // margin — otherwise CUU would move a status line into the scroll area.
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`) // rows 4..19
    feed(`${CSI}2;1H`, `${CSI}99A`)
    expect(cursor()).toEqual([0, 0])

    feed(`${CSI}26;1H`, `${CSI}99B`)
    expect(cursor()).toEqual([0, 29])
  })

  it('does not scroll when the cursor is above the top margin', () => {
    const { feed, at, cursor } = terminal()
    label(feed, 8)

    feed(`${CSI}4;6r`)
    feed(`${CSI}1;1H`)
    feed('\x1bM')

    expect(cursor()).toEqual([0, 0])
    expect(at(0, 3)).toBe(A + 3)
  })

  it('keeps the region when text wraps off the last column of the bottom row', () => {
    const { feed, at } = terminal()
    label(feed, 8)

    feed(`${CSI}2;4r`)
    feed(`${CSI}4;1H`) // bottom margin
    feed('x'.repeat(41)) // one past the right-hand edge

    expect(at(0, 0)).toBe(A) // above the region: untouched
    expect(at(0, 4)).toBe(A + 4) // below the region: untouched
    expect(at(0, 1)).toBe(A + 2) // the region scrolled by one
  })
})

describe('IL and DL inside a scroll region', () => {
  it('inserts within the region, pushing nothing past the bottom margin', () => {
    const { feed, at } = terminal()
    label(feed, 8)

    feed(`${CSI}2;5r`)
    feed(`${CSI}3;1H`, `${CSI}L`)

    expect(at(0, 1)).toBe(A + 1) // above the cursor, inside the region
    expect(at(0, 2)).toBe(BLANK_CODE) // the inserted line
    expect(at(0, 3)).toBe(A + 2) // pushed down
    expect(at(0, 4)).toBe(A + 3) // still inside — `E` fell off the bottom
    expect(at(0, 5)).toBe(A + 5) // below the region: untouched
  })

  it('deletes within the region, pulling nothing up from below the margin', () => {
    const { feed, at } = terminal()
    label(feed, 8)

    feed(`${CSI}2;5r`)
    feed(`${CSI}3;1H`, `${CSI}M`)

    expect(at(0, 1)).toBe(A + 1)
    expect(at(0, 2)).toBe(A + 3)
    expect(at(0, 3)).toBe(A + 4)
    expect(at(0, 4)).toBe(BLANK_CODE) // exposed at the foot of the region
    expect(at(0, 5)).toBe(A + 5) // *not* pulled up into the region
  })

  it('does nothing at all when the cursor is outside the region', () => {
    const { feed, column0 } = terminal()
    label(feed, 8)
    const before = column0()

    feed(`${CSI}3;5r`)
    feed(`${CSI}1;1H`, `${CSI}L`, `${CSI}M`)
    feed(`${CSI}7;1H`, `${CSI}L`, `${CSI}M`)

    expect(column0()).toBe(before)
  })
})

describe('the deferred last-column wrap', () => {
  it('leaves the cursor on the last column after writing to it', () => {
    const { feed, at, cursor } = terminal()

    feed('x'.repeat(40))

    expect(at(39, 0)).toBe(0x78)
    expect(cursor()).toEqual([39, 0])
  })

  it('wraps only when the next character arrives', () => {
    const { feed, at, cursor } = terminal()

    feed('x'.repeat(40))
    feed('y')

    expect(at(0, 1)).toBe(0x79)
    expect(cursor()).toEqual([1, 1])
  })

  it('does not scroll the screen for a character in the bottom-right corner', () => {
    // The behaviour the deferred wrap exists for. An immediate wrap would have
    // scrolled the whole screen the moment the corner was written.
    const { feed, at } = terminal()
    label(feed, 3)

    feed(`${CSI}30;40Hz`)

    expect(at(0, 0)).toBe(A)
    expect(at(39, 29)).toBe(0x7a)
  })

  it('scrolls once the character after the corner arrives', () => {
    const { feed, at } = terminal()
    label(feed, 3)

    feed(`${CSI}30;40Hz`)
    feed('!')

    expect(at(0, 0)).toBe(A + 1)
    expect(at(0, 29)).toBe(0x21)
  })

  it.each([
    ['CR', '\r'],
    ['BS', '\b'],
    ['CUB', `${CSI}D`],
    ['CUF', `${CSI}C`],
    ['CUP', `${CSI}1;40H`],
    ['CHA', `${CSI}40G`],
    ['EL', `${CSI}K`],
    ['ECH', `${CSI}X`]
  ])('is cleared by %s, so the next character does not wrap', (_name, sequence) => {
    const { feed, cursor } = terminal()

    feed('x'.repeat(40))
    feed(sequence)
    const [column, row] = cursor()
    feed('y')

    // Whatever the sequence did to the column, the `y` landed on the same row:
    // the pending wrap did not survive it.
    expect(cursor()[1]).toBe(row)
    expect(column).toBeLessThanOrEqual(39)
  })

  it('survives DECSC and DECRC together', () => {
    const { feed, at, cursor } = terminal()

    feed('x'.repeat(40))
    feed('\x1b7')
    feed(`${CSI}1;1H`)
    feed('\x1b8')
    feed('y')

    expect(cursor()).toEqual([1, 1])
    expect(at(0, 1)).toBe(0x79)
  })

  it('is not restored onto a column that can no longer wrap', () => {
    const { vtac, feed, cursor } = terminal()

    feed('x'.repeat(40), '\x1b7')
    vtac.setColumns(80) // clears and homes; column 39 is no longer the margin
    feed('\x1b8', 'y')

    // Restored to column 39 of an 80-column screen, which is not a pending
    // wrap — so `y` lands beside it rather than on the next row.
    expect(cursor()).toEqual([40, 0])
  })
})
