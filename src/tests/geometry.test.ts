/**
 * Phase 4 — geometry, 80-column mode, and the native ESC extensions.
 *
 * The claim under test is that 80 columns is not a new mode so much as the same
 * terminal at a different size: every command keeps its meaning, `SET COLUMN`
 * and `SET ROW` extend for free because they already work modulo the dimension,
 * and graphics mode still fills a cell eight rows at a time.
 *
 * The second half covers `0x1B`, which is the release's one intentional
 * deviation from v1 — including the part that is *not* a deviation, since an
 * unrecognised second byte is re-dispatched rather than eaten.
 */

import { Screen } from '@core/Screen'
import { VTAC } from '@core/VTAC'

/** Feed a run of bytes, as a serial link would. */
const feed = (vtac: VTAC, ...bytes: number[]): void => {
  for (const byte of bytes) vtac.parse(byte)
}

const pixel = (vtac: VTAC, col: number, row: number, x: number, y: number): number => {
  return vtac.buffer[(row * 8 + y) * vtac.width + col * 8 + x]
}

describe('geometry', () => {
  it('starts at 40 columns, which is v1', () => {
    const vtac = new VTAC()

    expect(vtac.columns).toBe(40)
    expect(vtac.rows).toBe(30)
    expect(vtac.width).toBe(320)
    expect(vtac.height).toBe(240)
    expect(vtac.buffer.length).toBe(320 * 240)
  })

  it('switches to an 80×60 grid at 640×480 — an exact 2× in both axes', () => {
    const vtac = new VTAC()

    vtac.setColumns(80)

    expect(vtac.columns).toBe(80)
    expect(vtac.rows).toBe(60)
    expect(vtac.width).toBe(640)
    expect(vtac.height).toBe(480)
    expect(vtac.buffer.length).toBe(640 * 480)
    expect(vtac.screen.count).toBe(4800)
  })

  it('hands back a buffer view of the new plane, not the old one', () => {
    const vtac = new VTAC()
    const before = vtac.buffer

    vtac.setColumns(80)

    expect(vtac.buffer).not.toBe(before)
    expect(before.length).toBe(320 * 240)
  })

  it('clears the screen and homes the cursor on a switch', () => {
    const vtac = new VTAC()

    feed(vtac, 0x41, 0x42, 0x43)
    vtac.column = 12
    vtac.row = 7
    vtac.offset = 3

    vtac.setColumns(80)

    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
    expect(vtac.offset).toBe(0)
    expect(vtac.buffer.every((value) => value === 0x00)).toBe(true)
  })

  it('clears even when the mode asked for is the one already in force', () => {
    // DECCOLM's behaviour on real hardware, and what makes `ESC 0x01` usable as
    // a "known state" preamble rather than a conditional no-op.
    const vtac = new VTAC()

    feed(vtac, 0x41)
    vtac.setColumns(40)

    expect(vtac.buffer.every((value) => value === 0x00)).toBe(true)
  })

  it('clears to the background colour in effect, as CLEAR SCREEN does', () => {
    const vtac = new VTAC()

    feed(vtac, 0x19, 0x24) // BACKGROUND COLOR $24
    vtac.setColumns(80)

    expect(vtac.buffer.every((value) => value === 0x24)).toBe(true)
  })

  it('ignores a column count it does not have a geometry for', () => {
    const vtac = new VTAC()

    // @ts-expect-error — the type forbids it; the guard is for the byte stream.
    vtac.setColumns(132)

    expect(vtac.columns).toBe(40)
  })

  //
  // ADDRESSING
  //

  it('addresses column 79 at 80 columns and wraps modulo at 40', () => {
    const vtac = new VTAC()

    feed(vtac, 0x0e, 79) // SET COLUMN 79
    expect(vtac.column).toBe(79 % 40)

    vtac.setColumns(80)
    feed(vtac, 0x0e, 79)
    expect(vtac.column).toBe(79)

    feed(vtac, 0x0f, 59) // SET ROW 59
    expect(vtac.row).toBe(59)
  })

  it('keeps SET ROW modulo the row count in both geometries', () => {
    const vtac = new VTAC()

    feed(vtac, 0x0f, 0x77)
    expect(vtac.row).toBe(0x77 % 30)

    vtac.setColumns(80)
    feed(vtac, 0x0f, 0x77)
    expect(vtac.row).toBe(0x77 % 60)
  })

  it('wraps text at the right-hand edge of whichever grid it is on', () => {
    const vtac = new VTAC()
    vtac.setColumns(80)

    vtac.column = 79
    feed(vtac, 0x41)

    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(1)
    expect(vtac.screen.codes[vtac.screen.index(79, 0)]).toBe(0x41)
  })

  it('scrolls off the bottom of 60 rows, not 30', () => {
    const vtac = new VTAC()
    vtac.setColumns(80)

    vtac.row = 29
    feed(vtac, 0x0a) // LINE FEED
    expect(vtac.row).toBe(30)

    vtac.row = 59
    feed(vtac, 0x41) // a glyph on the bottom row, to be scrolled up
    vtac.column = 0
    feed(vtac, 0x0a)
    expect(vtac.row).toBe(59)
    expect(vtac.screen.codes[vtac.screen.index(0, 58)]).toBe(0x41)
  })

  it('tabs to the same 4-column stops, clamped to the wider grid', () => {
    const vtac = new VTAC()
    vtac.setColumns(80)

    vtac.column = 77
    feed(vtac, 0x09)
    expect(vtac.column).toBe(79)
  })

  //
  // GRAPHICS
  //

  it('still advances 8 rows per cell in graphics mode at 80 columns', () => {
    const vtac = new VTAC()
    vtac.setColumns(80)

    feed(vtac, 0x0b) // SCREEN MODE → graphics
    expect(vtac.mode).toBe('graphics')

    feed(vtac, 0x18, 0xe1, 0x19, 0x1e) // fg $E1 on bg $1E
    for (let i = 0; i < 8; i++) feed(vtac, 0b10100000)

    // Eight bytes fill one cell and land on the next, in both geometries.
    expect(vtac.column).toBe(1)
    expect(vtac.offset).toBe(0)

    for (let y = 0; y < 8; y++) {
      expect(pixel(vtac, 0, 0, 0, y)).toBe(0xe1)
      expect(pixel(vtac, 0, 0, 1, y)).toBe(0x1e)
    }
  })

  it('wraps graphics off the last cell of the 80-column grid', () => {
    const vtac = new VTAC()
    vtac.setColumns(80)

    feed(vtac, 0x0b)
    vtac.column = 79
    for (let i = 0; i < 8; i++) feed(vtac, 0xff)

    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(1)
  })

  //
  // RESET
  //

  it('returns to the configured geometry on reset, not to a hard-coded 40', () => {
    const vtac = new VTAC()
    vtac.defaultColumns = 80
    vtac.defaultPersonality = 'vt100'

    vtac.setColumns(40)
    vtac.setPersonality('native')
    vtac.reset()

    expect(vtac.columns).toBe(80)
    expect(vtac.rows).toBe(60)
    expect(vtac.personality).toBe('vt100')
    expect(vtac.buffer.length).toBe(640 * 480)
  })
})

describe('ESC extensions', () => {
  it('switches column mode from the byte stream', () => {
    const vtac = new VTAC()

    feed(vtac, 0x1b, 0x02)
    expect(vtac.columns).toBe(80)
    expect(vtac.width).toBe(640)

    feed(vtac, 0x1b, 0x01)
    expect(vtac.columns).toBe(40)
    expect(vtac.width).toBe(320)
  })

  it('latches on ESC and consumes exactly one further byte', () => {
    const vtac = new VTAC()

    vtac.parse(0x1b)
    expect(vtac.escapeNextByte).toBe(true)

    vtac.parse(0x02)
    expect(vtac.escapeNextByte).toBe(false)
    expect(vtac.columns).toBe(80)
  })

  it('enters the VT-100 personality', () => {
    const vtac = new VTAC()

    expect(vtac.personality).toBe('native')
    feed(vtac, 0x1b, 0x03)
    expect(vtac.personality).toBe('vt100')
  })

  it('answers a query with personality, columns and rows', () => {
    const vtac = new VTAC()
    const sent: number[][] = []
    vtac.setTransmitCallback((bytes) => sent.push(bytes))

    feed(vtac, 0x1b, 0x04)
    expect(sent).toEqual([[0x1b, 0x04, 0x00, 40, 30]])

    feed(vtac, 0x1b, 0x02, 0x1b, 0x04)
    expect(sent[1]).toEqual([0x1b, 0x04, 0x00, 80, 60])
  })

  it('cannot be queried once the stream is in VT-100 mode', () => {
    // The query is a *native* extension: after `ESC 0x03` the stream belongs to
    // the ANSI parser, which reads `ESC 0x04` as an escape followed by a C0
    // control and answers neither. Which is the whole reason `CSI ? 7000 h`
    // exists — see `ansi/personality.test.ts`.
    const vtac = new VTAC()
    const sent: number[][] = []
    vtac.setTransmitCallback((bytes) => sent.push(bytes))

    feed(vtac, 0x1b, 0x03, 0x1b, 0x04)

    expect(sent).toEqual([])
  })

  it('drops a query on the floor when nothing has claimed the wire', () => {
    const vtac = new VTAC()

    expect(() => feed(vtac, 0x1b, 0x04)).not.toThrow()
  })

  it('writes a literal ESC as data', () => {
    const vtac = new VTAC()

    feed(vtac, 0x1b, 0x1b)

    expect(vtac.screen.codes[vtac.screen.index(0, 0)]).toBe(0x1b)
    expect(vtac.column).toBe(1)
  })

  it('re-dispatches an unrecognised second byte, preserving v1 no-op ESC', () => {
    const vtac = new VTAC()
    const cursorSpy = jest.spyOn(vtac, 'cursor')

    // The exact case `VTAC.test.ts` exercises: a stray ESC must not eat the
    // cursor move that follows it.
    feed(vtac, 0x1b, 0x1c)
    expect(cursorSpy).toHaveBeenCalledWith('left')

    // And a printable byte after a stray ESC is still printed.
    feed(vtac, 0x1b, 0x41)
    expect(vtac.screen.codes[vtac.screen.index(0, 0)]).toBe(0x41)
  })

  it('re-dispatches an ESC that follows a stray ESC', () => {
    const vtac = new VTAC()

    // Not a case the table names: `ESC` then `ESC` is the literal, so the only
    // way to reach this is `ESC <unrecognised>` where the unrecognised byte is
    // itself an introducer. It has to leave the latch set, not clear it.
    feed(vtac, 0x1b, 0x7f) // DELETE — unrecognised, re-dispatched
    expect(vtac.escapeNextByte).toBe(false)
  })

  it('takes ESC as data when a data latch is up, exactly as v1 did', () => {
    const vtac = new VTAC()

    feed(vtac, 0x1a, 0x1b) // NEXT BYTE AS DATA, then ESC
    expect(vtac.escapeNextByte).toBe(false)
    expect(vtac.screen.codes[vtac.screen.index(0, 0)]).toBe(0x1b)

    feed(vtac, 0x18, 0x1b) // FOREGROUND COLOR $1B
    expect(vtac.foregroundColor).toBe(0x1b)
    expect(vtac.escapeNextByte).toBe(false)
  })

  it('clears a half-finished ESC on reset', () => {
    const vtac = new VTAC()

    vtac.parse(0x1b)
    vtac.reset()

    expect(vtac.escapeNextByte).toBe(false)
  })
})

describe('Screen.resize', () => {
  it('reallocates every plane and damages the whole screen', () => {
    const screen = new Screen()
    screen.putGlyph(0, 0, 0x41, 0xff, 0x00)
    screen.rasterize()
    screen.takeDamage()

    screen.resize(80, 60, 0xff, 0x07)

    expect(screen.cols).toBe(80)
    expect(screen.rows).toBe(60)
    expect(screen.count).toBe(4800)
    expect(screen.codes.length).toBe(4800)
    expect(screen.pixels.length).toBe(4800 * 64)
    expect(screen.plane.length).toBe(640 * 480)
    expect(screen.plane.every((value) => value === 0x07)).toBe(true)
    expect(screen.hasDirtyCells).toBe(false)
    expect(screen.takeDamage()).toEqual({ col: 0, row: 0, cols: 80, rows: 60 })
  })

  it('leaves a resized screen writable at its new extremities', () => {
    const screen = new Screen()
    screen.resize(80, 60)

    screen.putGlyph(79, 59, 0x41, 0xff, 0x00)
    screen.rasterize()

    expect(screen.plane[(59 * 8 + 1) * 640 + 79 * 8 + 3]).toBe(0xff)
  })
})
