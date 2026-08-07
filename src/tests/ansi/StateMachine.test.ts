/**
 * The DEC ANSI parser, against the published transition table.
 *
 * Two halves. The first walks the sequences a host actually sends and checks
 * they arrive at the handler intact. The second is the half that matters more:
 * malformed, truncated and hostile input, where the whole point of transcribing
 * a real state machine is that the parser behaves like hardware instead of
 * wedging. The last test in the file is the blunt version of that — every one
 * of the 256 bytes fed in every one of the 14 states, asserting only that the
 * machine survives and stays somewhere legal.
 */

import {
  AnsiParser,
  MAX_INTERMEDIATES,
  MAX_PARAMS,
  MAX_PARAM_VALUE,
  State
} from '@core/ansi/StateMachine'
import type { AnsiHandler, AnsiParserOptions, AnsiSequence } from '@core/ansi/StateMachine'

const ESC = 0x1b
const CAN = 0x18
const SUB = 0x1a
const BEL = 0x07
const ST = 0x9c

/**
 * Records what the parser reports, as short readable strings.
 *
 * `AnsiSequence` is reused between dispatches by design, so everything it
 * carries is flattened into the string here rather than held by reference.
 */
class Recorder implements AnsiHandler {
  readonly events: string[] = []

  print(code: number): void {
    this.events.push(`print(${show(code)})`)
  }

  execute(code: number): void {
    this.events.push(`exec(${hex(code)})`)
  }

  esc(final: number, seq: AnsiSequence): void {
    this.events.push(`esc(${intermediates(seq)}${show(final)})`)
  }

  csi(final: number, seq: AnsiSequence): void {
    this.events.push(`csi(${prefix(seq)}${params(seq)}${intermediates(seq)}${show(final)})`)
  }

  dcsHook(final: number, seq: AnsiSequence): void {
    this.events.push(`hook(${prefix(seq)}${params(seq)}${intermediates(seq)}${show(final)})`)
  }

  dcsPut(code: number): void {
    this.events.push(`put(${show(code)})`)
  }

  dcsUnhook(): void {
    this.events.push('unhook')
  }

  oscStart(): void {
    this.events.push('osc-start')
  }

  oscPut(code: number): void {
    this.events.push(`osc(${show(code)})`)
  }

  oscEnd(): void {
    this.events.push('osc-end')
  }
}

const hex = (code: number): string => code.toString(16).padStart(2, '0')
const show = (code: number): string =>
  code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : hex(code)
const prefix = (seq: AnsiSequence): string => (seq.prefix === 0 ? '' : show(seq.prefix))
const intermediates = (seq: AnsiSequence): string => seq.intermediates.map(show).join('')
const params = (seq: AnsiSequence): string => {
  const values: number[] = []
  for (let i = 0; i < seq.paramCount; i++) values.push(seq.param(i))
  return values.join(';')
}

/** A parser wired to a recorder, plus a `feed` that takes text and raw bytes. */
function harness(options?: AnsiParserOptions): {
  parser: AnsiParser
  events: string[]
  feed: (...items: Array<string | number | number[]>) => void
} {
  const recorder = new Recorder()
  const parser = new AnsiParser(recorder, options)

  const feed = (...items: Array<string | number | number[]>): void => {
    for (const item of items) {
      if (typeof item === 'number') parser.parse(item)
      else if (typeof item === 'string') {
        for (let i = 0; i < item.length; i++) parser.parse(item.charCodeAt(i))
      } else parser.parseBytes(item)
    }
  }

  return { parser, events: recorder.events, feed }
}

describe('ground state', () => {
  it('prints the graphic characters 0x20-0x7E', () => {
    const { events, feed } = harness()
    feed('Hi!')
    expect(events).toEqual(['print(H)', 'print(i)', 'print(!)'])
  })

  it('executes the C0 controls', () => {
    const { events, feed } = harness()
    feed(0x07, 0x08, 0x09, 0x0a, 0x0d)
    expect(events).toEqual(['exec(07)', 'exec(08)', 'exec(09)', 'exec(0a)', 'exec(0d)'])
  })

  it('ignores DEL, as the published table has it', () => {
    // Worth pinning: hosts of the era sent 0x7F as padding, so printing the
    // CP437 glyph that sits there would corrupt real output. Native mode keeps
    // 0x7F as its DELETE command; only the VT-100 path drops it.
    const { events, feed } = harness()
    feed('a', 0x7f, 'b')
    expect(events).toEqual(['print(a)', 'print(b)'])
  })

  it('prints the upper half rather than reading it as 8-bit C1 controls', () => {
    // VT-AC's ROM is CP437 and a VT-100 is a 7-bit terminal, so 0x80-0xFF are
    // characters here. See `AnsiParserOptions.c1Controls`.
    const { parser, events, feed } = harness()
    feed(0x9b, 0xdb, 0xff)
    expect(events).toEqual(['print(9b)', 'print(db)', 'print(ff)'])
    expect(parser.state).toBe(State.Ground)
  })
})

describe('escape sequences', () => {
  it('dispatches a bare final byte', () => {
    const { events, feed } = harness()
    feed(ESC, 'c')
    expect(events).toEqual(['esc(c)'])
  })

  it('collects intermediates', () => {
    const { events, feed } = harness()
    feed(ESC, '(0', ESC, '#8')
    expect(events).toEqual(['esc((0)', 'esc(#8)'])
  })

  it('parses but does not dispatch an escape with too many intermediates', () => {
    const { parser, events, feed } = harness()
    feed(ESC, ' '.repeat(MAX_INTERMEDIATES + 1), 'p', 'x')
    expect(events).toEqual(['print(x)'])
    expect(parser.state).toBe(State.Ground)
  })

  it('returns to ground and prints what follows', () => {
    const { parser, events, feed } = harness()
    feed(ESC, 'c', 'x')
    expect(events).toEqual(['esc(c)', 'print(x)'])
    expect(parser.state).toBe(State.Ground)
  })

  it('executes C0 controls arriving mid-escape without leaving the sequence', () => {
    const { events, feed } = harness()
    feed(ESC, 0x0d, 'c')
    expect(events).toEqual(['exec(0d)', 'esc(c)'])
  })
})

describe('CSI sequences', () => {
  it('parses a single parameter', () => {
    const { events, feed } = harness()
    feed(ESC, '[5A')
    expect(events).toEqual(['csi(5A)'])
  })

  it('parses several parameters', () => {
    const { events, feed } = harness()
    feed(ESC, '[12;34H')
    expect(events).toEqual(['csi(12;34H)'])
  })

  it('reports no parameters when none were sent', () => {
    const { parser, feed } = harness()
    feed(ESC, '[H')
    expect(parser.paramCount).toBe(0)
    expect(parser.param(0)).toBe(0)
    expect(parser.paramOr(0, 1)).toBe(1)
  })

  it('treats an omitted or zero parameter as the DEC default', () => {
    // `CSI A`, `CSI 0 A` and `CSI 1 A` all move one row.
    const zero = harness()
    zero.feed(ESC, '[0A')
    expect(zero.parser.param(0)).toBe(0)
    expect(zero.parser.paramOr(0, 1)).toBe(1)

    const given = harness()
    given.feed(ESC, '[7A')
    expect(given.parser.paramOr(0, 1)).toBe(7)
  })

  it('keeps a leading semicolon as an omitted first parameter', () => {
    const { events, feed } = harness()
    feed(ESC, '[;5H')
    expect(events).toEqual(['csi(0;5H)'])
  })

  it('keeps a trailing semicolon as an omitted last parameter', () => {
    const { events, feed } = harness()
    feed(ESC, '[5;H')
    expect(events).toEqual(['csi(5;0H)'])
  })

  it('carries the private prefix', () => {
    const { events, feed } = harness()
    feed(ESC, '[?25h', ESC, '[>c')
    expect(events).toEqual(['csi(?25h)', 'csi(>c)'])
  })

  it('carries intermediates', () => {
    const { events, feed } = harness()
    feed(ESC, '[!p') // DECSTR
    expect(events).toEqual(['csi(!p)'])
  })

  it('saturates a parameter rather than overflowing it', () => {
    const { parser, feed } = harness()
    feed(ESC, '[99999999999A')
    expect(parser.param(0)).toBe(MAX_PARAM_VALUE)
  })

  it('accepts exactly MAX_PARAMS parameters', () => {
    const { parser, events, feed } = harness()
    feed(ESC, '[', Array.from({ length: MAX_PARAMS }, () => 1).join(';'), 'm')
    expect(events).toHaveLength(1)
    expect(parser.paramCount).toBe(MAX_PARAMS)
  })

  it('parses but does not dispatch a sequence with too many parameters', () => {
    // The VT500 rule, and the safe one: acting on the half of a sequence that
    // fit is worse than acting on none of it.
    const { parser, events, feed } = harness()
    feed(ESC, '[', Array.from({ length: MAX_PARAMS + 1 }, () => 1).join(';'), 'm')
    expect(events).toEqual([])
    expect(parser.state).toBe(State.Ground)
  })

  it('parses but does not dispatch a sequence with too many intermediates', () => {
    const { parser, events, feed } = harness()
    feed(ESC, '[', ' '.repeat(MAX_INTERMEDIATES + 1), 'p')
    expect(events).toEqual([])
    expect(parser.state).toBe(State.Ground)
  })

  it('does not dispatch a sequence with two private markers', () => {
    const { events, feed } = harness()
    feed(ESC, '[?>1h')
    expect(events).toEqual([])
  })

  it('recovers on the next sequence after an overflow', () => {
    const { events, feed } = harness()
    feed(ESC, '[', ' '.repeat(MAX_INTERMEDIATES + 1), 'p')
    feed(ESC, '[5A')
    expect(events).toEqual(['csi(5A)'])
  })
})

describe('malformed input', () => {
  it('drops a sequence containing a colon, and recovers', () => {
    // The published table routes 0x3A to csi_ignore. That costs the colon-form
    // SGR (`38:2::r:g:b`) — VT-AC's SGR uses the semicolon form — and buys
    // exact agreement with the table on everything else.
    const { parser, events, feed } = harness()
    feed(ESC, '[38:2:1:2:3m', 'x')
    expect(events).toEqual(['print(x)'])
    expect(parser.state).toBe(State.Ground)
  })

  it('ignores a parameter byte arriving after an intermediate', () => {
    const { events, feed } = harness()
    feed(ESC, '[ 1p', 'x')
    expect(events).toEqual(['print(x)'])
  })

  it('aborts a sequence on CAN and on SUB', () => {
    for (const abort of [CAN, SUB]) {
      const { parser, events, feed } = harness()
      feed(ESC, '[1;2', abort, 'x')
      expect(events).toEqual([`exec(${hex(abort)})`, 'print(x)'])
      expect(parser.state).toBe(State.Ground)
    }
  })

  it('restarts on an ESC arriving mid-sequence', () => {
    const { events, feed } = harness()
    feed(ESC, '[1;2', ESC, '[5A')
    expect(events).toEqual(['csi(5A)'])
  })

  it('does not carry parameters from one sequence into the next', () => {
    const { events, feed } = harness()
    feed(ESC, '[12;34H', ESC, '[H')
    expect(events).toEqual(['csi(12;34H)', 'csi(H)'])
  })

  it('leaves a truncated sequence pending rather than dispatching it', () => {
    const { parser, events, feed } = harness()
    feed(ESC, '[1;2')
    expect(events).toEqual([])
    expect(parser.state).toBe(State.CsiParam)
  })

  it('ignores DEL inside a sequence without breaking it', () => {
    const { events, feed } = harness()
    feed(ESC, '[1', 0x7f, ';2H')
    expect(events).toEqual(['csi(1;2H)'])
  })

  it('executes a C0 control inside a CSI and keeps parsing', () => {
    const { events, feed } = harness()
    feed(ESC, '[1', 0x0d, ';2H')
    expect(events).toEqual(['exec(0d)', 'csi(1;2H)'])
  })
})

describe('OSC strings', () => {
  it('collects a string terminated by ST', () => {
    const { events, feed } = harness()
    feed(ESC, ']0;hi', ESC, '\\')
    expect(events).toEqual([
      'osc-start',
      'osc(0)',
      'osc(;)',
      'osc(h)',
      'osc(i)',
      'osc-end',
      'esc(\\)'
    ])
  })

  it('accepts BEL as a terminator, which is what hosts actually send', () => {
    const { parser, events, feed } = harness()
    feed(ESC, ']0;t', BEL, 'x')
    expect(events).toEqual(['osc-start', 'osc(0)', 'osc(;)', 'osc(t)', 'osc-end', 'print(x)'])
    expect(parser.state).toBe(State.Ground)
  })

  it('swallows an unterminated string rather than printing it', () => {
    const { parser, events, feed } = harness()
    feed(ESC, ']0;a very long title with no terminator at all')
    expect(events.filter((e) => e.startsWith('print'))).toEqual([])
    expect(parser.state).toBe(State.OscString)
  })
})

describe('DCS strings', () => {
  it('hooks, passes data through, and unhooks', () => {
    const { events, feed } = harness()
    feed(ESC, 'P1$q', 'm', ESC, '\\')
    expect(events).toEqual(['hook(1$q)', 'put(m)', 'unhook', 'esc(\\)'])
  })

  it('reports neither the header nor the data of an overflowed DCS', () => {
    const { events, feed } = harness()
    feed(ESC, 'P', ' '.repeat(MAX_INTERMEDIATES + 1), 'q', 'data', ESC, '\\')
    expect(events).toEqual(['esc(\\)'])
  })

  it('swallows a DCS whose header carried a colon', () => {
    const { events, feed } = harness()
    feed(ESC, 'P1:2q', 'data', ESC, '\\')
    expect(events).toEqual(['esc(\\)'])
  })
})

describe('SOS / PM / APC strings', () => {
  it.each([
    ['SOS', 'X'],
    ['PM', '^'],
    ['APC', '_']
  ])('swallows a %s string', (_name, introducer) => {
    const { parser, events, feed } = harness()
    feed(ESC, introducer, 'anything at all', ESC, '\\')
    expect(events).toEqual(['esc(\\)'])
    expect(parser.state).toBe(State.Ground)
  })
})

describe('8-bit controls, when enabled', () => {
  const c1 = { c1Controls: true }

  it('reads 0x9B as CSI', () => {
    const { events, feed } = harness(c1)
    feed(0x9b, '5A')
    expect(events).toEqual(['csi(5A)'])
  })

  it('reads 0x9D as OSC and 0x9C as its terminator', () => {
    const { parser, events, feed } = harness(c1)
    feed(0x9d, 'a', ST)
    expect(events).toEqual(['osc-start', 'osc(a)', 'osc-end'])
    expect(parser.state).toBe(State.Ground)
  })

  it('reads 0x90 as DCS', () => {
    const { events, feed } = harness(c1)
    feed(0x90, 'q', 'd', ST)
    expect(events).toEqual(['hook(q)', 'put(d)', 'unhook'])
  })

  it('reads 0x98, 0x9E and 0x9F as string introducers', () => {
    for (const introducer of [0x98, 0x9e, 0x9f]) {
      const { parser, events, feed } = harness(c1)
      feed(introducer, 'text', ST)
      expect(events).toEqual([])
      expect(parser.state).toBe(State.Ground)
    }
  })

  it('executes the remaining C1 controls', () => {
    const { events, feed } = harness(c1)
    feed(0x84, 0x8d)
    expect(events).toEqual(['exec(84)', 'exec(8d)'])
  })

  it('still prints 0xA0 and up', () => {
    const { events, feed } = harness(c1)
    feed(0xdb)
    expect(events).toEqual(['print(db)'])
  })
})

describe('reset', () => {
  it('abandons a half-read sequence without dispatching it', () => {
    const { parser, events, feed } = harness()
    feed(ESC, '[1;2')
    parser.reset()
    feed('x')
    expect(events).toEqual(['print(x)'])
    expect(parser.state).toBe(State.Ground)
  })

  it('abandons a DCS without unhooking a handler that was never hooked', () => {
    const { parser, events, feed } = harness()
    feed(ESC, 'Pq', 'a')
    parser.reset()
    feed('x')
    expect(events).toEqual(['hook(q)', 'put(a)', 'print(x)'])
  })
})

describe('the whole table', () => {
  /**
   * Every byte, in every state, asserting only that the parser survives it and
   * lands somewhere legal.
   *
   * The published table defines all 256 bytes in all 14 states, so the useful
   * claim is coverage rather than any particular outcome: there is no byte that
   * throws, and no byte that leaves the machine in a state it cannot parse its
   * way out of.
   */
  const reach: Record<number, number[]> = {
    [State.Ground]: [],
    [State.Escape]: [ESC],
    [State.EscapeIntermediate]: [ESC, 0x20],
    [State.CsiEntry]: [ESC, 0x5b],
    [State.CsiParam]: [ESC, 0x5b, 0x31],
    [State.CsiIntermediate]: [ESC, 0x5b, 0x20],
    [State.CsiIgnore]: [ESC, 0x5b, 0x3a],
    [State.DcsEntry]: [ESC, 0x50],
    [State.DcsParam]: [ESC, 0x50, 0x31],
    [State.DcsIntermediate]: [ESC, 0x50, 0x20],
    [State.DcsPassthrough]: [ESC, 0x50, 0x71],
    [State.DcsIgnore]: [ESC, 0x50, 0x3a],
    [State.OscString]: [ESC, 0x5d],
    [State.SosPmApcString]: [ESC, 0x58]
  }

  const states = Object.values(State) as State[]

  it.each(states.map((state) => [Object.keys(State)[state], state]))(
    'reaches %s and accepts all 256 bytes from it',
    (_name, state) => {
      const { parser, feed } = harness()
      feed(reach[state])
      expect(parser.state).toBe(state)

      for (let byte = 0; byte <= 0xff; byte++) {
        const { parser: fresh, feed: feedFresh } = harness()
        feedFresh(reach[state])
        expect(() => feedFresh(byte)).not.toThrow()
        expect(states).toContain(fresh.state)
      }
    }
  )
})
