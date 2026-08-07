/**
 * The DEC ANSI parser — Paul Williams' VT500-series state machine.
 *
 * Transcribed from the published transition table at
 * https://vt100.net/emu/dec_ansi_parser, state by state, in `buildTable()`
 * below. The point of doing it that way rather than matching sequences with
 * regexes is malformed input: a host that sends `ESC [ 1 ; 2` and then stops,
 * or drops a `CAN` into the middle of a CSI, or nests an `ESC` inside a DCS,
 * gets whatever real hardware did instead of a parser wedged in a bad state.
 * Every one of the 256 bytes has a defined transition in every one of the 14
 * states; there is no path that does not terminate.
 *
 * This module knows nothing about what the sequences *mean* — `Dispatch`
 * owns that. It parses, collects parameters and intermediates, and calls the
 * handler.
 */

/** The parser states, in the order the published table lists them. */
export const State = {
  Ground: 0,
  Escape: 1,
  EscapeIntermediate: 2,
  CsiEntry: 3,
  CsiParam: 4,
  CsiIntermediate: 5,
  CsiIgnore: 6,
  DcsEntry: 7,
  DcsParam: 8,
  DcsIntermediate: 9,
  DcsPassthrough: 10,
  DcsIgnore: 11,
  OscString: 12,
  SosPmApcString: 13
} as const
export type State = (typeof State)[keyof typeof State]

const STATE_COUNT = 14

/**
 * The actions a *transition* can carry.
 *
 * The table's `clear`, `hook`, `unhook`, `osc_start` and `osc_end` are missing
 * on purpose: the published table specifies those as **entry and exit** actions
 * of the states themselves, and `enter()`/`exit()` below run them there. Folding
 * them into transitions is the usual shortcut and it is how implementations end
 * up firing `unhook` on the wrong byte.
 */
const Action = {
  Ignore: 0,
  Print: 1,
  Execute: 2,
  Collect: 3,
  Param: 4,
  EscDispatch: 5,
  CsiDispatch: 6,
  Put: 7,
  OscPut: 8
} as const
type Action = (typeof Action)[keyof typeof Action]

/** Target-state sentinel for a transition that does not leave its state. */
const STAY = 0xff

/**
 * Most parameters a sequence may carry.
 *
 * The VT500 spec allows 16. xterm allows 30, and a fully-loaded SGR —
 * `38;2;r;g;b;48;2;r;g;b` plus a handful of flags — is already 14, so 32 leaves
 * room without making the overflow rule unreachable and untested.
 */
export const MAX_PARAMS = 32

/** Largest value a single parameter can hold; digits past this saturate. */
export const MAX_PARAM_VALUE = 65535

/** Most intermediate bytes (`0x20`–`0x2F`) a sequence may carry. */
export const MAX_INTERMEDIATES = 2

/**
 * What a handler can read about the sequence being dispatched.
 *
 * `AnsiParser` implements this itself and passes `this`, so dispatching costs
 * no allocation at all — which matters when `htop` repaints sixty times a
 * second. The flip side is that the object is **reused**: a handler that wants
 * anything past the end of its call must copy it out.
 */
export interface AnsiSequence {
  /** The private marker `< = > ?` if the sequence carried one, else `0`. */
  readonly prefix: number
  /** Intermediate bytes `0x20`–`0x2F`, in the order they arrived. */
  readonly intermediates: readonly number[]
  /** How many parameters were actually present. */
  readonly paramCount: number
  /** Parameter `index`, or `0` when it was omitted or past the end. */
  param(index: number): number
  /**
   * Parameter `index`, substituting `fallback` when it was omitted **or zero**.
   *
   * That is DEC's default rule and it is why `CSI A`, `CSI 0 A` and `CSI 1 A`
   * all move the cursor one row. Sequences where zero means zero — SGR, ED,
   * EL — read `param()` instead.
   */
  paramOr(index: number, fallback: number): number
}

/**
 * What the parser tells its handler.
 *
 * The string handlers are optional: nothing in VT-AC answers DCS or OSC yet,
 * and a terminal that swallows them silently is behaving correctly.
 */
export interface AnsiHandler {
  /** A graphic character to put on the screen. */
  print(code: number): void
  /** A C0 (or, when enabled, C1) control to act on. */
  execute(code: number): void
  /** `ESC` … final — intermediates in `seq`, no parameters. */
  esc(final: number, seq: AnsiSequence): void
  /** `CSI` … final — parameters, intermediates and private prefix in `seq`. */
  csi(final: number, seq: AnsiSequence): void
  /** A DCS is starting; its data follows through `dcsPut`. */
  dcsHook?(final: number, seq: AnsiSequence): void
  /** One byte of DCS data. */
  dcsPut?(code: number): void
  /** The DCS ended. */
  dcsUnhook?(): void
  /** An OSC is starting; its data follows through `oscPut`. */
  oscStart?(): void
  /** One byte of OSC data. */
  oscPut?(code: number): void
  /** The OSC ended. */
  oscEnd?(): void
}

/** Construction-time options. */
export interface AnsiParserOptions {
  /**
   * Whether `0x80`–`0x9F` are read as 8-bit C1 controls.
   *
   * **Off, and that is a VT-AC decision rather than an oversight.** A real
   * VT100 is a 7-bit terminal, and VT-AC's glyph ROM is CP437 — every byte from
   * `0x80` up is a *character* there, which is the whole reason CP437 was the
   * right ROM for the fiction. Reading `0x9B` as CSI would cost the upper half
   * of the font and make `vt100` mode disagree with `native` mode, where
   * `0x80`–`0xFF` have always been data.
   *
   * The published table's C1 rules are implemented all the same, so a future
   * `S8C1T` has somewhere to turn them on.
   */
  c1Controls?: boolean
}

/**
 * `(action << 8) | targetState`, indexed by `state * 256 + byte`.
 *
 * Built once at module load. 3.5KB for a branch-free lookup on the hottest path
 * in the terminal.
 */
const TABLE = buildTable()

function buildTable(): Uint16Array {
  const table = new Uint16Array(STATE_COUNT * 256)

  /** `00-17,19,1C-1F` → `[[0x00, 0x17], [0x19, 0x19], [0x1c, 0x1f]]`. */
  const ranges = (spec: string): Array<[number, number]> =>
    spec.split(',').map((part) => {
      const [lo, hi] = part.split('-')
      const from = parseInt(lo, 16)
      return [from, hi === undefined ? from : parseInt(hi, 16)]
    })

  const on = (state: State, spec: string, action: Action, next: number = STAY): void => {
    for (const [from, to] of ranges(spec)) {
      for (let byte = from; byte <= to; byte++) {
        table[state * 256 + byte] = (action << 8) | next
      }
    }
  }

  // Everything not named below is ignored where it stands. The published table
  // leaves no byte undefined, so this default only ever covers 0x80-0xFF, which
  // the C1/GR pass at the end fills in.
  table.fill((Action.Ignore << 8) | STAY)

  // -- ground ---------------------------------------------------------------
  on(State.Ground, '00-17,19,1C-1F', Action.Execute)
  on(State.Ground, '20-7E', Action.Print)
  on(State.Ground, '7F', Action.Ignore)

  // -- escape ---------------------------------------------------------------
  on(State.Escape, '00-17,19,1C-1F', Action.Execute)
  on(State.Escape, '7F', Action.Ignore)
  on(State.Escape, '20-2F', Action.Collect, State.EscapeIntermediate)
  on(State.Escape, '30-4F,51-57,59,5A,5C,60-7E', Action.EscDispatch, State.Ground)
  on(State.Escape, '50', Action.Ignore, State.DcsEntry)
  on(State.Escape, '58,5E,5F', Action.Ignore, State.SosPmApcString)
  on(State.Escape, '5B', Action.Ignore, State.CsiEntry)
  on(State.Escape, '5D', Action.Ignore, State.OscString)

  // -- escape intermediate --------------------------------------------------
  on(State.EscapeIntermediate, '00-17,19,1C-1F', Action.Execute)
  on(State.EscapeIntermediate, '7F', Action.Ignore)
  on(State.EscapeIntermediate, '20-2F', Action.Collect)
  on(State.EscapeIntermediate, '30-7E', Action.EscDispatch, State.Ground)

  // -- csi entry ------------------------------------------------------------
  on(State.CsiEntry, '00-17,19,1C-1F', Action.Execute)
  on(State.CsiEntry, '7F', Action.Ignore)
  on(State.CsiEntry, '20-2F', Action.Collect, State.CsiIntermediate)
  on(State.CsiEntry, '30-39,3B', Action.Param, State.CsiParam)
  on(State.CsiEntry, '3C-3F', Action.Collect, State.CsiParam)
  on(State.CsiEntry, '3A', Action.Ignore, State.CsiIgnore)
  on(State.CsiEntry, '40-7E', Action.CsiDispatch, State.Ground)

  // -- csi param ------------------------------------------------------------
  on(State.CsiParam, '00-17,19,1C-1F', Action.Execute)
  on(State.CsiParam, '7F', Action.Ignore)
  on(State.CsiParam, '30-39,3B', Action.Param)
  on(State.CsiParam, '3A,3C-3F', Action.Ignore, State.CsiIgnore)
  on(State.CsiParam, '20-2F', Action.Collect, State.CsiIntermediate)
  on(State.CsiParam, '40-7E', Action.CsiDispatch, State.Ground)

  // -- csi intermediate -----------------------------------------------------
  on(State.CsiIntermediate, '00-17,19,1C-1F', Action.Execute)
  on(State.CsiIntermediate, '7F', Action.Ignore)
  on(State.CsiIntermediate, '20-2F', Action.Collect)
  on(State.CsiIntermediate, '30-3F', Action.Ignore, State.CsiIgnore)
  on(State.CsiIntermediate, '40-7E', Action.CsiDispatch, State.Ground)

  // -- csi ignore -----------------------------------------------------------
  on(State.CsiIgnore, '00-17,19,1C-1F', Action.Execute)
  on(State.CsiIgnore, '20-3F,7F', Action.Ignore)
  on(State.CsiIgnore, '40-7E', Action.Ignore, State.Ground)

  // -- dcs entry ------------------------------------------------------------
  on(State.DcsEntry, '00-17,19,1C-1F', Action.Ignore)
  on(State.DcsEntry, '7F', Action.Ignore)
  on(State.DcsEntry, '20-2F', Action.Collect, State.DcsIntermediate)
  on(State.DcsEntry, '30-39,3B', Action.Param, State.DcsParam)
  on(State.DcsEntry, '3C-3F', Action.Collect, State.DcsParam)
  on(State.DcsEntry, '3A', Action.Ignore, State.DcsIgnore)
  on(State.DcsEntry, '40-7E', Action.Ignore, State.DcsPassthrough)

  // -- dcs param ------------------------------------------------------------
  on(State.DcsParam, '00-17,19,1C-1F', Action.Ignore)
  on(State.DcsParam, '7F', Action.Ignore)
  on(State.DcsParam, '30-39,3B', Action.Param)
  on(State.DcsParam, '3A,3C-3F', Action.Ignore, State.DcsIgnore)
  on(State.DcsParam, '20-2F', Action.Collect, State.DcsIntermediate)
  on(State.DcsParam, '40-7E', Action.Ignore, State.DcsPassthrough)

  // -- dcs intermediate -----------------------------------------------------
  on(State.DcsIntermediate, '00-17,19,1C-1F', Action.Ignore)
  on(State.DcsIntermediate, '7F', Action.Ignore)
  on(State.DcsIntermediate, '20-2F', Action.Collect)
  on(State.DcsIntermediate, '30-3F', Action.Ignore, State.DcsIgnore)
  on(State.DcsIntermediate, '40-7E', Action.Ignore, State.DcsPassthrough)

  // -- dcs passthrough ------------------------------------------------------
  on(State.DcsPassthrough, '00-17,19,1C-1F,20-7E', Action.Put)
  on(State.DcsPassthrough, '7F', Action.Ignore)

  // -- dcs ignore -----------------------------------------------------------
  on(State.DcsIgnore, '00-17,19,1C-1F,20-7F', Action.Ignore)

  // -- osc string -----------------------------------------------------------
  on(State.OscString, '00-17,19,1C-1F', Action.Ignore)
  on(State.OscString, '20-7F', Action.OscPut)

  // `BEL` as an OSC terminator is xterm's, not DEC's — the published table
  // ignores it. Every host that sends an OSC sends it this way, so accepting it
  // is the difference between reading a title string and swallowing the rest of
  // the stream up to the next `ST`.
  on(State.OscString, '07', Action.Ignore, State.Ground)

  // -- sos/pm/apc string ----------------------------------------------------
  on(State.SosPmApcString, '00-17,19,1C-1F,20-7F', Action.Ignore)

  // -- the upper half -------------------------------------------------------
  // With `c1Controls` off — the default, see `AnsiParserOptions` — every byte
  // from 0x80 up is a graphic character. It prints on the ground and is string
  // data inside a string; anywhere else it is a stray byte in a control
  // sequence, which is nothing.
  for (let state = 0; state < STATE_COUNT; state++) {
    const action =
      state === State.Ground
        ? Action.Print
        : state === State.OscString
          ? Action.OscPut
          : state === State.DcsPassthrough
            ? Action.Put
            : Action.Ignore
    for (let byte = 0x80; byte <= 0xff; byte++) {
      table[state * 256 + byte] = (action << 8) | STAY
    }
  }

  return table
}

/**
 * The parser. Feed it one byte at a time; it calls the handler.
 *
 * One instance per terminal, reused for the life of the session — `reset()`
 * puts it back on the ground between personalities without reallocating.
 */
export class AnsiParser implements AnsiSequence {
  /** The state the machine is in. Exposed because the tests assert on it. */
  state: State = State.Ground

  prefix = 0
  readonly intermediates: number[] = []

  /** Parameter values, valid up to `paramCount`. */
  private readonly values = new Int32Array(MAX_PARAMS)
  private count = 0

  /**
   * Set when a sequence carries more parameters or intermediates than the
   * machine holds, or more than one private marker.
   *
   * Such a sequence is parsed to its end and then **not dispatched** — the
   * VT500 behaviour, and the safe one: half a sequence acted on is worse than
   * none of it, because the half that got dropped was usually the part that put
   * the screen back.
   */
  private overflow = false

  private readonly c1Controls: boolean

  constructor(
    private readonly handler: AnsiHandler,
    options: AnsiParserOptions = {}
  ) {
    this.c1Controls = options.c1Controls ?? false
  }

  get paramCount(): number {
    return this.count
  }

  param(index: number): number {
    return index < this.count ? this.values[index] : 0
  }

  paramOr(index: number, fallback: number): number {
    const value = this.param(index)
    return value === 0 ? fallback : value
  }

  /**
   * Put the machine back on the ground, discarding a half-read sequence.
   *
   * No exit actions run — an abandoned DCS gets no `dcsUnhook`, because nothing
   * downstream ever saw a complete sequence to close. Used when the personality
   * switches out of `vt100` and by `RIS`.
   */
  reset(): void {
    this.state = State.Ground
    this.dcsActive = false
    this.clear()
  }

  /** Feed one received byte. */
  parse(byte: number): void {
    // The anywhere transitions, which outrank every state's own table row.
    // `CAN` and `SUB` abort whatever is in progress; `ESC` restarts it.
    if (byte === 0x18 || byte === 0x1a) {
      this.transition(State.Ground)
      this.handler.execute(byte)
      return
    }
    if (byte === 0x1b) {
      this.transition(State.Escape)
      return
    }
    if (this.c1Controls && byte >= 0x80 && byte <= 0x9f) {
      this.executeC1(byte)
      return
    }

    const entry = TABLE[this.state * 256 + byte]
    const action = (entry >> 8) as Action
    const next = entry & 0xff

    // Exit action, transition action, entry action — in that order, as the
    // published table specifies. Doing the transition first would fire
    // `dcsUnhook` before the last `dcsPut`.
    if (next !== STAY) this.exit()
    this.act(action, byte)
    if (next !== STAY) this.enter(next as State)
  }

  /** Feed a run of bytes. */
  parseBytes(data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) this.parse(data[i])
  }

  //
  // INTERNALS
  //

  /** The anywhere rules for the 8-bit C1 controls, off unless asked for. */
  private executeC1(byte: number): void {
    switch (byte) {
      case 0x90: // DCS
        this.transition(State.DcsEntry)
        return
      case 0x9b: // CSI
        this.transition(State.CsiEntry)
        return
      case 0x9d: // OSC
        this.transition(State.OscString)
        return
      case 0x98: // SOS
      case 0x9e: // PM
      case 0x9f: // APC
        this.transition(State.SosPmApcString)
        return
      case 0x9c: // ST
        this.transition(State.Ground)
        return
      default:
        this.transition(State.Ground)
        this.handler.execute(byte)
    }
  }

  /** Leave the current state and enter `next`, running both states' actions. */
  private transition(next: State): void {
    if (next === this.state) return
    this.exit()
    this.enter(next)
  }

  private exit(): void {
    switch (this.state) {
      case State.DcsPassthrough:
        if (this.dcsActive) this.handler.dcsUnhook?.()
        this.dcsActive = false
        break
      case State.OscString:
        this.handler.oscEnd?.()
        break
    }
  }

  private enter(next: State): void {
    this.state = next
    switch (next) {
      case State.Escape:
      case State.CsiEntry:
      case State.DcsEntry:
        this.clear()
        break
      case State.DcsPassthrough:
        // The final byte that got us here was consumed by the transition, so
        // it is still the one in `pendingFinal`. An overflowed DCS is hooked,
        // filled and unhooked as nothing at all, which is the same suppression
        // `esc` and `csi` get — a handler must not see the data half of a
        // sequence whose header it was never told about.
        this.dcsActive = !this.overflow
        if (this.dcsActive) this.handler.dcsHook?.(this.pendingFinal, this)
        break
      case State.OscString:
        this.handler.oscStart?.()
        break
    }
  }

  /**
   * The byte that triggered the current transition.
   *
   * Only DCS needs it: the published table makes `hook` an entry action of
   * `dcs passthrough` rather than an action on the transition, so by the time
   * it runs the final byte is no longer in hand.
   */
  private pendingFinal = 0

  /** Whether the handler was told about the DCS whose data is arriving. */
  private dcsActive = false

  private act(action: Action, byte: number): void {
    this.pendingFinal = byte

    switch (action) {
      case Action.Print:
        this.handler.print(byte)
        break
      case Action.Execute:
        this.handler.execute(byte)
        break
      case Action.Collect:
        this.collect(byte)
        break
      case Action.Param:
        this.collectParam(byte)
        break
      case Action.EscDispatch:
        if (!this.overflow) this.handler.esc(byte, this)
        break
      case Action.CsiDispatch:
        if (!this.overflow) this.handler.csi(byte, this)
        break
      case Action.Put:
        if (this.dcsActive) this.handler.dcsPut?.(byte)
        break
      case Action.OscPut:
        this.handler.oscPut?.(byte)
        break
      case Action.Ignore:
        break
    }
  }

  private clear(): void {
    this.prefix = 0
    this.intermediates.length = 0
    this.count = 0
    this.values[0] = 0
    this.overflow = false
  }

  /** An intermediate `0x20`–`0x2F` or a private marker `0x3C`–`0x3F`. */
  private collect(byte: number): void {
    if (byte >= 0x3c && byte <= 0x3f) {
      // Never more than one: a marker is only collected out of `csi entry` and
      // `dcs entry`, and both leave for the param state on the way. A second
      // one arrives in `csi param`, where the table routes it to `csi ignore`.
      this.prefix = byte
      return
    }
    if (this.intermediates.length >= MAX_INTERMEDIATES) {
      this.overflow = true
      return
    }
    this.intermediates.push(byte)
  }

  /** A digit `0x30`–`0x39`, or the `;` that starts the next parameter. */
  private collectParam(byte: number): void {
    if (byte === 0x3b) {
      // A leading `;` means the first parameter was omitted, which is not the
      // same as there being no parameters: `CSI ;5H` is row-default, column 5.
      if (this.count === 0) this.count = 1
      if (this.count >= MAX_PARAMS) {
        this.overflow = true
        return
      }
      this.values[this.count] = 0
      this.count++
      return
    }

    if (this.count === 0) {
      this.values[0] = 0
      this.count = 1
    }

    const index = this.count - 1
    const value = this.values[index] * 10 + (byte - 0x30)
    this.values[index] = value > MAX_PARAM_VALUE ? MAX_PARAM_VALUE : value
  }
}
