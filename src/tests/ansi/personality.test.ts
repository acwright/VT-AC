/**
 * Personalities — the switch between VT-AC's own protocol and VT-100 mode.
 *
 * The fiction is a terminal that shipped with its own protocol *and* a VT-100
 * compatibility mode, so the interesting assertions are about the seam: that
 * each personality reads the same byte as the thing it means in that
 * personality, that a switch is reachable from either side and from every
 * direction the plan names, and that nothing leaks across it.
 */

import { VTAC } from '@core/VTAC'
import { DECSET_NATIVE_MODE } from '@core/ansi/Modes'
import { State } from '@core/ansi/StateMachine'
import { BLANK_CODE } from '@core/Cell'

const ESC = 0x1b

/** Feed a mixture of strings and raw bytes, as a host would. */
function feed(vtac: VTAC, ...items: Array<string | number | number[]>): void {
  for (const item of items) {
    if (typeof item === 'number') vtac.parse(item)
    else if (typeof item === 'string') {
      for (let i = 0; i < item.length; i++) vtac.parse(item.charCodeAt(i))
    } else for (const byte of item) vtac.parse(byte)
  }
}

/** The glyph code recorded at a cell. */
function codeAt(vtac: VTAC, col: number, row: number): number {
  return vtac.screen.codes[vtac.screen.index(col, row)]
}

/** The text of a row, trailing blanks trimmed. */
function textAt(vtac: VTAC, row: number): string {
  let out = ''
  for (let col = 0; col < vtac.screen.cols; col++) {
    out += String.fromCharCode(codeAt(vtac, col, row))
  }
  return out.replace(/ +$/, '')
}

describe('defaults', () => {
  it('starts in native mode', () => {
    expect(new VTAC().personality).toBe('native')
  })

  it('parses natively until told otherwise', () => {
    const vtac = new VTAC()
    // 0x0E is SET COLUMN in native mode, not a printable character.
    feed(vtac, 0x0e, 5, 'A')
    expect(vtac.column).toBe(6)
    expect(codeAt(vtac, 5, 0)).toBe(0x41)
  })
})

describe('entering VT-100 mode', () => {
  it('switches on ESC 0x03', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03)
    expect(vtac.personality).toBe('vt100')
  })

  it('switches from the settings panel or the CLI', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    expect(vtac.personality).toBe('vt100')
  })

  it('reads the same byte as ANSI rather than as a native command', () => {
    // 0x0E is SET COLUMN natively; in VT-100 mode it is SO, which VT-AC does
    // not act on until the charset work lands — so the bytes after it print.
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, 0x0e, 5, 'A')
    expect(vtac.column).toBe(1)
    expect(codeAt(vtac, 0, 0)).toBe(0x41)
  })

  it('reports the personality it is in when queried', () => {
    const sent: number[] = []
    const vtac = new VTAC()
    vtac.setTransmitCallback((bytes) => sent.push(...bytes))

    feed(vtac, ESC, 0x04)
    expect(sent).toEqual([0x1b, 0x04, 0x00, 40, 30])

    // The query is a *native* extension, so it is unreachable from VT-100 mode
    // — which is exactly why mode 7000 has to exist.
    sent.length = 0
    feed(vtac, ESC, 0x03, ESC, 0x04)
    expect(sent).toEqual([])
  })
})

describe('leaving VT-100 mode', () => {
  it('returns to native on CSI ? 7000 h', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03)
    feed(vtac, ESC, `[?${DECSET_NATIVE_MODE}h`)
    expect(vtac.personality).toBe('native')
  })

  it('reads native commands again immediately afterwards', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, `[?${DECSET_NATIVE_MODE}h`)
    feed(vtac, 0x0e, 5, 'A')
    expect(codeAt(vtac, 5, 0)).toBe(0x41)
  })

  it('re-enters VT-100 mode on CSI ? 7000 l', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, `[?${DECSET_NATIVE_MODE}l`)
    expect(vtac.personality).toBe('vt100')
  })

  it('honours mode 7000 alongside other modes in one sequence', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, `[?25;${DECSET_NATIVE_MODE}h`)
    expect(vtac.personality).toBe('native')
  })

  it('ignores a mode number that is not 7000', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, '[?25h', ESC, '[?7h')
    expect(vtac.personality).toBe('vt100')
  })

  it('ignores a private sequence that is not DECSET or DECRST', () => {
    // `CSI ? 6 n` is DSR, which Phase 5.6 answers. It must not be mistaken for
    // a mode change on the strength of its `?` alone.
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, `[?${DECSET_NATIVE_MODE}n`)
    expect(vtac.personality).toBe('vt100')
  })

  it('returns to the configured default on RIS', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, 'c')
    expect(vtac.personality).toBe('native')
  })

  it('stays in VT-100 on RIS when that is the configured default', () => {
    // `vtac --mode vt100` is talking to one device all session; a reset from
    // the far end should not quietly demote the terminal.
    const vtac = new VTAC()
    vtac.defaultPersonality = 'vt100'
    vtac.setPersonality('vt100')
    feed(vtac, ESC, 'c')
    expect(vtac.personality).toBe('vt100')
  })
})

describe('nothing leaks across the switch', () => {
  it('drops a native command still waiting on its operand', () => {
    // 0x18 is FOREGROUND COLOR, whose operand never arrives.
    const vtac = new VTAC()
    feed(vtac, 0x18)
    vtac.setPersonality('vt100')
    feed(vtac, 'A')
    expect(vtac.foregroundColor).toBe(0xff)
    expect(codeAt(vtac, 0, 0)).toBe(0x41)
  })

  it('drops a half-read ANSI sequence', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, '[1;2')
    expect(vtac.ansi.state).toBe(State.CsiParam)

    vtac.setPersonality('native')
    expect(vtac.ansi.state).toBe(State.Ground)

    // Back in VT-100 mode the leftover `H` is a character, not the tail of the
    // abandoned CUP.
    vtac.setPersonality('vt100')
    feed(vtac, 'H')
    expect(codeAt(vtac, 0, 0)).toBe(0x48)
    expect(vtac.row).toBe(0)
  })

  it('is a no-op when the personality is already the one asked for', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, '[1;2')
    vtac.setPersonality('vt100')
    expect(vtac.ansi.state).toBe(State.CsiParam)
  })

  it('clears the ANSI parser on reset', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x03, ESC, '[1;2')
    vtac.reset()
    expect(vtac.ansi.state).toBe(State.Ground)
  })
})

describe('VT-100 mode output', () => {
  it('prints text and wraps at the right margin', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 'x'.repeat(41))
    expect(vtac.row).toBe(1)
    expect(vtac.column).toBe(1)
  })

  it('does not print DEL', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 'a', 0x7f, 'b')
    expect(textAt(vtac, 0)).toBe('ab')
  })

  it('prints the CP437 upper half rather than reading it as C1 controls', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 0xdb)
    expect(codeAt(vtac, 0, 0)).toBe(0xdb)
  })

  it('acts on BS, CR and LF', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 'abc', 0x08, 0x0d, 0x0a)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(1)
  })

  it('tabs every eight columns, where native tabs every four', () => {
    const vt100 = new VTAC()
    vt100.setPersonality('vt100')
    feed(vt100, 0x09)
    expect(vt100.column).toBe(8)

    const native = new VTAC()
    feed(native, 0x09)
    expect(native.column).toBe(4)
  })

  it('stops the tab at the right margin', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 'x'.repeat(39), 0x09)
    expect(vtac.column).toBe(39)
  })

  it('rings the bell on BEL', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 0x07)
    expect(vtac.hasQueuedBells()).toBe(true)
  })

  it('scrolls when text runs off the bottom', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    for (let row = 0; row < vtac.screen.rows; row++) {
      feed(vtac, `row${row}`, 0x0d, 0x0a)
    }
    expect(textAt(vtac, 0)).toBe('row1')
    expect(textAt(vtac, vtac.screen.rows - 1)).toBe('')
  })

  it('resets the screen on RIS', () => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, 'text', ESC, 'c')
    expect(codeAt(vtac, 0, 0)).toBe(BLANK_CODE)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
  })
})

describe('sequences not implemented yet', () => {
  // The contract for everything still to come: a terminal ignores what it does
  // not understand. It must not print the sequence as text, and it must not
  // stop reading the stream. Each of these moves out of this list as the stage
  // that owns it lands.
  it.each([
    ['DECTCEM', '[?25l'], // 5.5
    ['SCS', '(0'], // 5.6
    ['DECSTR', '[!p'], // 5.6
    ['secondary DA', '[>c'], // 5.6
    ['OSC', ']0;title\x07'],
    ['DCS', 'P1$q m\x1b\\']
  ])('swallows %s and keeps reading', (_name, sequence) => {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    feed(vtac, ESC, sequence, 'ok')
    expect(textAt(vtac, 0)).toBe('ok')
    expect(vtac.ansi.state).toBe(State.Ground)
  })
})

describe('native mode is untouched', () => {
  it('still treats 0x1B as its own escape introducer', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x02)
    expect(vtac.screen.cols).toBe(80)
  })

  it('still re-dispatches an unrecognised ESC byte as an ordinary byte', () => {
    const vtac = new VTAC()
    feed(vtac, ESC, 0x41)
    expect(codeAt(vtac, 0, 0)).toBe(0x41)
  })

  it('does not read CSI: `[` is a printable character natively', () => {
    const vtac = new VTAC()
    feed(vtac, '[5A')
    expect(textAt(vtac, 0)).toBe('[5A')
  })
})
