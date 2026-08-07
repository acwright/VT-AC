/**
 * The alternate screen buffer.
 *
 * A second `Screen` swapped by reference, which is only cheap because Phase 2
 * gave a `Screen` its own planes outright — there is nothing to copy and
 * nothing shared to get wrong. Without it `vi` and `htop` scribble over the
 * primary screen and leave it wrecked on exit, so most of what is asserted here
 * is that the primary comes back *untouched*.
 */

import { BLANK_CODE } from '@core/Cell'
import { VTAC } from '@core/VTAC'
import { DecMode } from '@core/ansi/Modes'

const CSI = '\x1b['

function terminal(): {
  vtac: VTAC
  feed: (...items: string[]) => void
  text: (row: number) => string
  cursor: () => [number, number]
} {
  const vtac = new VTAC()
  vtac.setPersonality('vt100')

  const feed = (...items: string[]): void => {
    for (const text of items) {
      for (let i = 0; i < text.length; i++) vtac.parse(text.charCodeAt(i))
    }
  }

  const text = (row: number): string => {
    let out = ''
    for (let col = 0; col < vtac.screen.cols; col++) {
      out += String.fromCharCode(vtac.screen.codes[vtac.screen.index(col, row)])
    }
    return out.replace(/ +$/, '')
  }

  return { vtac, feed, text, cursor: () => [vtac.column, vtac.row] }
}

const alt = (mode: number, set: boolean): string => `${CSI}?${mode}${set ? 'h' : 'l'}`

describe('1049 — the one applications use', () => {
  it('switches to a blank screen and brings the primary back untouched', () => {
    const { vtac, feed, text } = terminal()

    feed(`${CSI}1;1Hprimary content`)
    feed(alt(DecMode.AlternateScreenAndCursor, true))

    expect(vtac.vt100.onAlternateScreen).toBe(true)
    expect(text(0)).toBe('')

    // Homed explicitly: `1049` saves the cursor and clears the buffer, but does
    // not move the cursor — applications send their own CUP straight after.
    feed(`${CSI}1;1Halternate content`)
    expect(text(0)).toBe('alternate content')

    feed(alt(DecMode.AlternateScreenAndCursor, false))

    expect(vtac.vt100.onAlternateScreen).toBe(false)
    expect(text(0)).toBe('primary content')
  })

  it('saves the cursor on the way in and restores it on the way out', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`)
    feed(alt(DecMode.AlternateScreenAndCursor, true))

    feed(`${CSI}1;1Hsomething`)
    feed(alt(DecMode.AlternateScreenAndCursor, false))

    expect(cursor()).toEqual([19, 9])
  })

  it('saves the pen with the cursor', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}1;31m`)
    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed(`${CSI}0m`)
    feed(alt(DecMode.AlternateScreenAndCursor, false))

    expect(vtac.vt100.attrs).not.toBe(0)
  })

  it('clears the alternate screen on every entry', () => {
    const { feed, text } = terminal()

    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed('first visit')
    feed(alt(DecMode.AlternateScreenAndCursor, false))
    feed(alt(DecMode.AlternateScreenAndCursor, true))

    expect(text(0)).toBe('')
  })
})

describe('47 — the oldest spelling', () => {
  it('switches without clearing either buffer', () => {
    const { feed, text } = terminal()

    // Homing explicitly each time, because `47` deliberately does *not* move
    // the cursor — that is the next test.
    feed(`${CSI}1;1Hprimary`)
    feed(alt(DecMode.AlternateScreen, true))
    feed(`${CSI}1;1Halternate`)
    feed(alt(DecMode.AlternateScreen, false))

    expect(text(0)).toBe('primary')

    feed(alt(DecMode.AlternateScreen, true))
    expect(text(0)).toBe('alternate')
  })

  it('leaves the cursor exactly where it was', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}10;20H`)
    feed(alt(DecMode.AlternateScreen, true))

    expect(cursor()).toEqual([19, 9])
  })
})

describe('1047 — clears on the way out', () => {
  it('blanks the alternate screen as it leaves it', () => {
    const { feed, text } = terminal()

    feed(alt(DecMode.AlternateScreenClearOnExit, true))
    feed('alternate')
    feed(alt(DecMode.AlternateScreenClearOnExit, false))

    feed(alt(DecMode.AlternateScreen, true))
    expect(text(0)).toBe('')
  })

  it('is harmless when there has never been an alternate screen to clear', () => {
    const { vtac, feed, text } = terminal()

    feed(`${CSI}1;1Hprimary`)
    feed(alt(DecMode.AlternateScreenClearOnExit, false))

    expect(vtac.vt100.onAlternateScreen).toBe(false)
    expect(text(0)).toBe('primary')
  })
})

describe('the two screens are independent', () => {
  it('scrolls one without disturbing the other', () => {
    const { feed, text } = terminal()

    feed(`${CSI}1;1Hrow one`)
    feed(`${CSI}2;1Hrow two`)

    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed(`${CSI}30;1H`)
    for (let i = 0; i < 10; i++) feed('\n')
    feed(alt(DecMode.AlternateScreenAndCursor, false))

    expect(text(0)).toBe('row one')
    expect(text(1)).toBe('row two')
  })

  it('gives each its own framebuffer, which `buffer` follows', () => {
    const { vtac, feed } = terminal()

    feed('A')
    const primaryPlane = vtac.screen.plane
    const primaryBuffer = vtac.buffer

    feed(alt(DecMode.AlternateScreenAndCursor, true))

    expect(vtac.screen.plane).not.toBe(primaryPlane)
    expect(vtac.buffer).not.toBe(primaryBuffer)
    expect(vtac.buffer.length).toBe(primaryBuffer.length)

    feed(alt(DecMode.AlternateScreenAndCursor, false))
    expect(vtac.screen.plane).toBe(primaryPlane)
  })

  it('leaves the whole alternate screen needing a repaint on arrival', () => {
    // The renderer's backing store still holds the other buffer's pixels.
    const { vtac, feed } = terminal()

    vtac.screen.rasterize()
    vtac.screen.takeDamage()

    feed(alt(DecMode.AlternateScreenAndCursor, true))

    expect(vtac.screen.takeDamage()).toEqual({ col: 0, row: 0, cols: 40, rows: 30 })
    expect(vtac.screen.hasDirtyCells).toBe(true)
  })

  it('carries reverse video across the swap', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}?5h`)
    feed(alt(DecMode.AlternateScreenAndCursor, true))
    expect(vtac.screen.reverse).toBe(true)

    feed(`${CSI}?5l`)
    feed(alt(DecMode.AlternateScreenAndCursor, false))
    expect(vtac.screen.reverse).toBe(false)
  })
})

describe('switching when already switched', () => {
  it('ignores a second entry rather than stacking buffers', () => {
    const { vtac, feed, text } = terminal()

    feed(`${CSI}1;1Hprimary`)
    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed(`${CSI}1;1Halternate`)
    feed(alt(DecMode.AlternateScreen, true)) // already there

    expect(text(0)).toBe('alternate')

    feed(alt(DecMode.AlternateScreenAndCursor, false))
    expect(vtac.vt100.onAlternateScreen).toBe(false)
    expect(text(0)).toBe('primary')
  })

  it('ignores an exit when it is already on the primary', () => {
    const { vtac, feed, text } = terminal()

    feed('primary')
    feed(alt(DecMode.AlternateScreen, false))

    expect(vtac.vt100.onAlternateScreen).toBe(false)
    expect(text(0)).toBe('primary')
  })
})

describe('leaving by other means', () => {
  it('comes back to the primary on RIS', () => {
    const { vtac, feed, text } = terminal()

    vtac.defaultPersonality = 'vt100'
    feed('primary')
    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed('alternate')
    feed('\x1bc')

    expect(vtac.vt100.onAlternateScreen).toBe(false)
    // RIS clears the primary too — the point is which buffer is in front.
    expect(text(0)).toBe('')
    expect(vtac.screen.codes[0]).toBe(BLANK_CODE)
  })

  it('comes back to the primary on a column switch, at the new geometry', () => {
    const { vtac, feed } = terminal()

    feed('primary')
    feed(alt(DecMode.AlternateScreenAndCursor, true))
    feed(`${CSI}?3h`) // DECCOLM — 80 columns

    expect(vtac.vt100.onAlternateScreen).toBe(false)
    expect(vtac.screen.cols).toBe(80)
    expect(vtac.screen.rows).toBe(60)
    expect(vtac.screen.plane.length).toBe(640 * 480)
  })

  it('builds a fresh alternate screen at the new geometry afterwards', () => {
    const { vtac, feed } = terminal()

    feed(alt(DecMode.AlternateScreenAndCursor, true))
    vtac.setColumns(80)
    feed(alt(DecMode.AlternateScreenAndCursor, true))

    expect(vtac.screen.cols).toBe(80)
    expect(vtac.screen.plane.length).toBe(640 * 480)
  })
})
