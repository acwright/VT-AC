/**
 * DECSET/DECRST and the ANSI modes.
 *
 * The alternate screen is a mode too, and has its own file.
 */

import { Attr, BLANK_CODE } from '@core/Cell'
import { VTAC } from '@core/VTAC'
import { DecMode } from '@core/ansi/Modes'

const CSI = '\x1b['

function terminal(): {
  vtac: VTAC
  feed: (...items: string[]) => void
  at: (col: number, row: number) => number
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

  const at = (col: number, row: number): number => vtac.screen.codes[vtac.screen.index(col, row)]

  const text = (row: number): string => {
    let out = ''
    for (let col = 0; col < vtac.screen.cols; col++) out += String.fromCharCode(at(col, row))
    return out.replace(/ +$/, '')
  }

  return { vtac, feed, at, text, cursor: () => [vtac.column, vtac.row] }
}

/** `CSI ? n h` / `CSI ? n l`. */
const dec = (mode: number, set: boolean): string => `${CSI}?${mode}${set ? 'h' : 'l'}`

describe('DECAWM — autowrap', () => {
  it('is set at power-on, because every application assumes it', () => {
    expect(new VTAC().vt100.modes.autoWrap).toBe(true)
  })

  it('overwrites the last column forever when reset', () => {
    const { feed, at, cursor, text } = terminal()

    feed(dec(DecMode.AutoWrap, false))
    feed('x'.repeat(45))

    expect(cursor()).toEqual([39, 0])
    expect(at(39, 0)).toBe(0x78)
    expect(text(1)).toBe('')
  })

  it('leaves the last character written in the last column', () => {
    const { feed, at } = terminal()

    feed(dec(DecMode.AutoWrap, false))
    feed(`${CSI}1;39Habc`)

    expect(at(38, 0)).toBe(0x61)
    expect(at(39, 0)).toBe(0x63) // b was overwritten by c
  })

  it('disarms a wrap already pending when it is reset', () => {
    const { feed, at, cursor } = terminal()

    feed('x'.repeat(40)) // arms the deferred wrap
    feed(dec(DecMode.AutoWrap, false))
    feed('y')

    expect(cursor()).toEqual([39, 0])
    expect(at(39, 0)).toBe(0x79)
  })

  it('wraps again once it is set back', () => {
    const { feed, cursor } = terminal()

    feed(dec(DecMode.AutoWrap, false))
    feed('x'.repeat(45))
    feed(dec(DecMode.AutoWrap, true))
    feed('yz')

    expect(cursor()).toEqual([1, 1])
  })
})

describe('DECOM — origin mode', () => {
  it('makes CUP row one the top margin', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`) // rows 4..19
    feed(dec(DecMode.Origin, true))
    feed(`${CSI}1;1H`)

    expect(cursor()).toEqual([0, 4])
    feed(`${CSI}3;1H`)
    expect(cursor()).toEqual([0, 6])
  })

  it('confines the cursor to the region', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`, dec(DecMode.Origin, true))

    feed(`${CSI}99;1H`)
    expect(cursor()).toEqual([0, 19])
  })

  it('makes VPA relative too', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`, dec(DecMode.Origin, true))
    feed(`${CSI}2d`)

    expect(cursor()).toEqual([0, 5])
  })

  it('homes the cursor when it is set and when it is reset', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}5;20r`, `${CSI}10;10H`)
    feed(dec(DecMode.Origin, true))
    expect(cursor()).toEqual([0, 4])

    feed(`${CSI}10;10H`)
    feed(dec(DecMode.Origin, false))
    expect(cursor()).toEqual([0, 0])
  })

  it('sends DECSTBM home to the top margin instead of the screen', () => {
    const { feed, cursor } = terminal()

    feed(dec(DecMode.Origin, true))
    feed(`${CSI}5;20r`)

    expect(cursor()).toEqual([0, 4])
  })

  it('leaves addressing absolute when reset, which is the power-on state', () => {
    const { vtac, feed, cursor } = terminal()

    expect(vtac.vt100.modes.origin).toBe(false)
    feed(`${CSI}5;20r`, `${CSI}1;1H`)

    expect(cursor()).toEqual([0, 0])
  })
})

describe('DECSCNM — reverse screen', () => {
  it('flips the whole screen and repaints it', () => {
    const { vtac, feed } = terminal()

    feed('A')
    vtac.screen.rasterize()

    feed(dec(DecMode.ReverseVideo, true))
    expect(vtac.screen.reverse).toBe(true)
    expect(vtac.screen.hasDirtyCells).toBe(true)

    vtac.screen.rasterize()
    // A blank cell was black on black; reversed it is a field of foreground.
    expect(vtac.screen.plane[vtac.screen.width * 8]).toBe(0xff)
  })

  it('combines with a cell that asked for reverse itself, rather than winning', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}7mA`) // a reverse-video cell
    feed(dec(DecMode.ReverseVideo, true))
    vtac.screen.rasterize()

    expect(vtac.screen.attrs[0]).toBe(Attr.REVERSE)
    // Reversed twice is the right way up: the glyph's lit pixels are back to
    // the foreground colour.
    expect(vtac.screen.plane[0]).toBe(0x00)
  })

  it('survives an erase, which paints the framebuffer without the rasterizer', () => {
    // The staircase `vttest` drew: a full clear fills `plane` in one pass
    // rather than dirtying 1,200 cells, so it is the one place that has to
    // restate the rasterizer's rule. On a reversed screen a blank cell is a
    // field of *foreground*.
    const { vtac, feed } = terminal()

    feed(dec(DecMode.ReverseVideo, true))
    feed(`${CSI}2J`)
    vtac.screen.rasterize()

    expect(vtac.screen.plane.every((pixel) => pixel === 0xff)).toBe(true)
  })

  it('reverses a screen widened while it was set', () => {
    // `resize` allocates a new framebuffer and fills it the same way.
    const { vtac, feed } = terminal()

    feed(dec(DecMode.ReverseVideo, true))
    vtac.setColumns(80)
    vtac.screen.rasterize()

    expect(vtac.screen.plane.every((pixel) => pixel === 0xff)).toBe(true)
  })

  it('goes back on reset', () => {
    const { vtac, feed } = terminal()

    feed(dec(DecMode.ReverseVideo, true))
    feed(dec(DecMode.ReverseVideo, false))

    expect(vtac.screen.reverse).toBe(false)
  })

  it('is cleared by RIS', () => {
    const { vtac, feed } = terminal()

    feed(dec(DecMode.ReverseVideo, true))
    vtac.reset()

    expect(vtac.screen.reverse).toBe(false)
  })
})

describe('DECTCEM — cursor visibility', () => {
  it('hides and shows the cursor', () => {
    const { vtac, feed } = terminal()

    expect(vtac.cursorVisible).toBe(true)
    feed(dec(DecMode.CursorVisible, false))
    expect(vtac.cursorVisible).toBe(false)
    feed(dec(DecMode.CursorVisible, true))
    expect(vtac.cursorVisible).toBe(true)
  })

  it('comes back on RIS', () => {
    const { vtac, feed } = terminal()

    feed(dec(DecMode.CursorVisible, false))
    vtac.reset()

    expect(vtac.cursorVisible).toBe(true)
  })
})

describe('the cursor glyph', () => {
  // `overlayCursor` draws its glyph *inverted*, so what is handed to it is the
  // thing being reversed, not the shape being drawn. A full block would invert
  // to pure background — an invisible cursor — which is exactly what happened
  // before a screenshot of the running app caught it.
  it('is off by default in native mode, as v1 has it', () => {
    expect(new VTAC().cursorGlyph).toBe(0x00)
  })

  it('is the cell underneath in VT-100 mode, which has no way to ask for one', () => {
    const { vtac, feed } = terminal()

    // A blank cell: a space inverts to a solid block of foreground.
    expect(vtac.cursorGlyph).toBe(BLANK_CODE)

    // A written one: the character punched out of that block.
    feed('A')
    feed(`${CSI}1;1H`)
    expect(vtac.cursorGlyph).toBe(0x41)
  })

  it('follows the cursor as it moves', () => {
    const { vtac, feed } = terminal()

    feed('AB')
    feed(`${CSI}1;2H`)
    expect(vtac.cursorGlyph).toBe(0x42)
    feed(`${CSI}1;1H`)
    expect(vtac.cursorGlyph).toBe(0x41)
  })

  it('keeps a glyph the host chose before switching', () => {
    const vtac = new VTAC()
    vtac.parse(0x02) // CURSOR CHARACTER
    vtac.parse(0x5f) // '_'
    vtac.setPersonality('vt100')

    expect(vtac.cursorGlyph).toBe(0x5f)
  })
})

describe('DECCOLM — column mode', () => {
  it('switches to 80 columns', () => {
    const { vtac, feed } = terminal()

    feed(dec(DecMode.Columns, true))
    expect(vtac.screen.cols).toBe(80)
    expect(vtac.screen.rows).toBe(60)
  })

  it('reset also selects 80 columns, because that is what it means on a VT100', () => {
    // `CSI ? 3 l` is "normal width", not "narrow": it opens vt100 terminfo's
    // `rs2`, `tput init` and vttest's own start-up. Reading it as VT-AC's
    // 40-column mode put every properly-initialised program on half a screen,
    // which is what the conformance run caught.
    const { vtac, feed } = terminal()

    feed(dec(DecMode.Columns, false))
    expect(vtac.screen.cols).toBe(80)

    feed(dec(DecMode.Columns, false))
    expect(vtac.screen.cols).toBe(80)
  })

  it('clears the screen, homes the cursor and opens the margins', () => {
    const { vtac, feed, at, cursor } = terminal()

    feed('text', `${CSI}5;20r`, `${CSI}10;10H`)
    feed(dec(DecMode.Columns, true))

    expect(at(0, 0)).toBe(BLANK_CODE)
    expect(cursor()).toEqual([0, 0])
    expect(vtac.vt100.top).toBe(0)
    expect(vtac.vt100.bottom).toBe(59)
  })
})

describe('IRM — insert/replace', () => {
  it('shifts the line right as it prints when set', () => {
    const { feed, text } = terminal()

    feed('ABCDEF')
    feed(`${CSI}1;3H`)
    feed(`${CSI}4h`)
    feed('xy')

    expect(text(0)).toBe('ABxyCDEF')
  })

  it('overwrites when reset, which is the power-on state', () => {
    const { feed, text } = terminal()

    feed('ABCDEF')
    feed(`${CSI}1;3H`)
    feed('xy')

    expect(text(0)).toBe('ABxyEF')
  })

  it('drops what it pushes off the end of the line', () => {
    const { feed, at } = terminal()

    feed(`${CSI}1;40HZ`)
    feed(`${CSI}1;1H`, `${CSI}4h`, 'x')

    expect(at(0, 0)).toBe(0x78)
    expect(at(39, 0)).toBe(BLANK_CODE)
  })
})

describe('LNM — line feed / new line', () => {
  it('leaves LF a plain index when reset', () => {
    const { feed, cursor } = terminal()

    feed('abc\n')

    expect(cursor()).toEqual([3, 1])
  })

  it('makes LF return the carriage as well when set', () => {
    const { feed, cursor } = terminal()

    feed(`${CSI}20h`)
    feed('abc\n')

    expect(cursor()).toEqual([0, 1])
  })
})

describe('modes VT-AC does not have', () => {
  it.each([
    ['DECANM', DecMode.Ansi],
    ['DECSCLM', DecMode.SmoothScroll],
    ['DECARM', DecMode.AutoRepeat]
  ])('accepts %s and does nothing', (_name, mode) => {
    const { feed, cursor, text } = terminal()

    feed('abc')
    feed(dec(mode, true), dec(mode, false))

    expect(text(0)).toBe('abc')
    expect(cursor()).toEqual([3, 0])
  })

  it('ignores a private mode number it has never heard of', () => {
    const { feed, text } = terminal()

    feed('abc', `${CSI}?9999h`, `${CSI}?1002h`)

    expect(text(0)).toBe('abc')
  })

  it('ignores an ANSI mode number it has never heard of', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}12h`, `${CSI}2l`)

    expect(vtac.vt100.modes.insert).toBe(false)
    expect(vtac.vt100.modes.newLine).toBe(false)
  })
})

describe('several modes in one sequence', () => {
  it('applies every parameter', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}?6;7;25l`)

    expect(vtac.vt100.modes.origin).toBe(false)
    expect(vtac.vt100.modes.autoWrap).toBe(false)
    expect(vtac.cursorVisible).toBe(false)
  })
})

describe('reset', () => {
  it('returns every mode to its power-on value', () => {
    const { vtac, feed } = terminal()

    feed(`${CSI}?1;6;7;25l`, `${CSI}4;20h`)
    vtac.reset()

    const modes = vtac.vt100.modes
    expect(modes.cursorKeys).toBe(false)
    expect(modes.origin).toBe(false)
    expect(modes.autoWrap).toBe(true)
    expect(modes.insert).toBe(false)
    expect(modes.newLine).toBe(false)
  })
})

describe('DECCKM — cursor keys', () => {
  // The flag only, until the keyboard reads it in 5.7.
  it('records the application/normal choice', () => {
    const { vtac, feed } = terminal()

    expect(vtac.vt100.modes.cursorKeys).toBe(false)
    feed(dec(DecMode.CursorKeys, true))
    expect(vtac.vt100.modes.cursorKeys).toBe(true)
    feed(dec(DecMode.CursorKeys, false))
    expect(vtac.vt100.modes.cursorKeys).toBe(false)
  })
})
