import { CHARACTERS } from './Font'
import { Screen } from './Screen'
import { Dispatch } from './ansi/Dispatch'
import { AnsiParser } from './ansi/StateMachine'
import type { Personality } from './types'

/** The two geometries VT-AC offers, keyed by column count. */
export const GEOMETRIES = {
  40: { cols: 40, rows: 30 },
  80: { cols: 80, rows: 60 }
} as const

/** A column count `setColumns` accepts. */
export type Columns = keyof typeof GEOMETRIES

/**
 * The cursor a VT-100 shows when nothing has asked for another — CP437's full
 * block, which `overlayCursor` draws inverted into a solid rectangle.
 */
export const VT100_CURSOR = 0xdb

export class VTAC {

  /** @deprecated Instance geometry lives on `screen`; this is the 40-column default. */
  static COLUMNS: number = 40
  /** @deprecated Instance geometry lives on `screen`; this is the 40-column default. */
  static ROWS: number = 30
  /** @deprecated Instance geometry lives on `screen`; this is the 40-column default. */
  static WIDTH: number = VTAC.COLUMNS * 8
  /** @deprecated Instance geometry lives on `screen`; this is the 40-column default. */
  static HEIGHT: number = VTAC.ROWS * 8

  /**
   * Where the screen actually lives.
   *
   * v1 owned a framebuffer and drew into it. v2 owns a `Screen`, which owns the
   * cells and derives the framebuffer from them; every drawing method below is
   * now a two-line delegation. The renderer reads `screen.plane` and
   * `screen.takeDamage()` directly; `buffer` is for everything that predates it.
   */
  /**
   * Not `readonly`: the alternate screen buffer (`CSI ? 1049 h`) is this
   * reference being pointed at a second `Screen`. Everything that reads the
   * screen goes through here and picks up the swap for free — including
   * `buffer`, which notices the plane changed underneath it.
   */
  screen: Screen = new Screen(VTAC.COLUMNS, VTAC.ROWS)

  /**
   * The VT-100 personality: its state — scroll margins, saved cursor, pending
   * wrap — and what every ANSI sequence does.
   *
   * Deliberately not folded into `VTAC`: native mode has no word for any of it.
   * What the two personalities *do* share is the cursor, the colours and the
   * bell, which all stay here, so a personality switch never teleports the
   * cursor or changes what the screen looks like.
   */
  readonly vt100: Dispatch = new Dispatch(this)

  /**
   * The VT-100 parser, and where `parse` sends bytes while the personality is
   * `vt100`.
   *
   * Built with the terminal rather than on demand: it is a state machine over a
   * few dozen bytes of parameter storage, and a personality can change from
   * inside the byte stream, so there is no moment where allocating it would be
   * cheaper than having it.
   */
  readonly ansi: AnsiParser = new AnsiParser(this.vt100)

  private bufferView: Buffer<ArrayBuffer> | null = null
  private bufferSource: Uint8Array | null = null

  /**
   * The RGB332 framebuffer, as v1 exposed it.
   *
   * Derived now rather than authoritative: reading it rasterizes whatever cells
   * are outstanding and hands back a `Buffer` **view onto the screen's own
   * memory**, not a copy. Writes through it therefore land on the screen and
   * stay there, which is what keeps `VTAC.test.ts` — which pokes pixels in and
   * then scrolls them around — meaningful against the new model.
   */
  get buffer(): Buffer<ArrayBuffer> {
    this.screen.rasterize()

    const plane = this.screen.plane
    if (this.bufferView === null || this.bufferSource !== plane) {
      this.bufferSource = plane
      this.bufferView = Buffer.from(
        plane.buffer as ArrayBuffer,
        plane.byteOffset,
        plane.byteLength
      ) as Buffer<ArrayBuffer>
    }
    return this.bufferView
  }

  /** Framebuffer width in pixels. Instance geometry; the static is the default. */
  get width(): number {
    return this.screen.width
  }

  /** Framebuffer height in pixels. Instance geometry; the static is the default. */
  get height(): number {
    return this.screen.height
  }

  /** Cells across — 40 or 80. Instance geometry; the static is the default. */
  get columns(): number {
    return this.screen.cols
  }

  /** Cells down — 30 or 60. Instance geometry; the static is the default. */
  get rows(): number {
    return this.screen.rows
  }

  /**
   * Which protocol the byte stream is read as.
   *
   * `native` is v1's protocol plus the ESC extensions below; `vt100` is the
   * ANSI compatibility mode. Phase 4 owns the state and the `ESC 0x03` switch
   * that sets it — Phase 5 owns the parser that reads it, so until then both
   * personalities parse natively and the only visible effect is what `ESC 0x04`
   * reports back.
   */
  personality: Personality = 'native'

  /**
   * The personality `reset()` returns to.
   *
   * The CLI's `--mode` and the settings panel set this; RIS (Phase 5) and
   * `0x04` alike come back to it rather than to a hard-coded `native`.
   */
  defaultPersonality: Personality = 'native'

  /**
   * The column count `reset()` returns to.
   *
   * Same argument as `defaultPersonality`: `vtac --columns 80` should survive a
   * reset from the far end, or the flag means nothing after the first `0x04`.
   */
  defaultColumns: Columns = 40

  mode: 'text' | 'graphics' = 'text'

  column: number = 0
  row: number = 0
  offset: number = 0
  columnNextByte: boolean = false
  rowNextByte: boolean = false

  cursorChar: number = 0x00 // OFF
  cursorMode: 'solid' | 'blinking' = 'solid'
  cursorCharNextByte: boolean = false

  /**
   * DECTCEM — whether the cursor is drawn at all.
   *
   * On `VTAC` rather than with the other VT-100 modes, for the same reason the
   * colours are: the renderer needs one place to look, and native mode has to
   * read `true` without knowing the mode exists. Nothing in the native protocol
   * writes it — `0x02 0x00` is native's way to turn the cursor off.
   */
  cursorVisible: boolean = true

  /**
   * The glyph to draw as the cursor, or `0x00` for none.
   *
   * `cursorChar` defaults to OFF, which is v1's behaviour and right for a
   * terminal whose host chooses its cursor. A VT-100 does not work that way —
   * it has a block cursor and it is on — and an application like `vi` has no
   * native command available to ask for one. So in the `vt100` personality an
   * unset cursor means the VT-100's own block, while a host that picked a glyph
   * before switching keeps it.
   */
  get cursorGlyph(): number {
    if (this.cursorChar !== 0x00) return this.cursorChar
    return this.personality === 'vt100' ? VT100_CURSOR : 0x00
  }

  bellDuration: number = 0x3C // Duration in jiffies (1/60th of a second) (Default: 1 second)
  bellFrequency: number = 0x3D // Frequency value (Default: C6)
  bellDurationNextByte: boolean = false
  bellFrequencyNextByte: boolean = false
  bellQueue: Array<{ frequency: number, duration: number }> = []

  dataNextByte: boolean = false

  /**
   * Set by `0x1B`: the next byte selects an ESC extension.
   *
   * v1 treated `0x1B` as a no-op and documented it as "Reserved for future
   * escape code implementation". This is that future, and the release's one
   * intentional deviation from v1 — see `escape()` for how narrow it is.
   */
  escapeNextByte: boolean = false

  foregroundColor: number = 0xFF // White
  backgroundColor: number = 0x00 // Black
  foregroundColorNextByte: boolean = false
  backgroundColorNextByte: boolean = false

  /**
   * Where bytes the terminal *sends* go — `ESC 0x04`'s reply now, and Phase 5's
   * DA/DSR reports later.
   *
   * Null until something claims the wire, and dropped on the floor while it is:
   * a terminal with nothing on the other end has nowhere to put a reply, which
   * is v1's rule for keystrokes applied in the same direction.
   */
  private onTransmit: ((bytes: number[]) => void) | null = null

  //
  // METHODS
  //

  /** Register the sink for bytes the terminal sends. The store owns this. */
  setTransmitCallback = (callback: ((bytes: number[]) => void) | null) => {
    this.onTransmit = callback
  }

  /** Send bytes to the far end. A no-op when nothing has claimed the wire. */
  transmit = (bytes: number[]) => {
    if (bytes.length === 0) return
    this.onTransmit?.(bytes)
  }

  /**
   * Switch column mode — 40 columns at 320×240, or 80 at 640×480.
   *
   * An exact 2× of the 40-column grid in both axes: same 8×8 font, same square
   * pixels, same 4:3, same 8 rows per cell in graphics mode. Only `cols` and
   * `rows` change, so every command keeps its meaning and `SET COLUMN`/`SET ROW`
   * extend for free — both already take their operand modulo the dimension.
   *
   * The screen is cleared and the cursor homed **even when the mode is already
   * the one asked for**, which is DECCOLM's behaviour on real hardware and the
   * reason `ESC 0x01` is a usable "known state" preamble.
   */
  setColumns = (columns: Columns) => {
    const geometry = GEOMETRIES[columns]
    if (geometry === undefined) return

    // Back to the primary screen *before* resizing, or the resize would land
    // on the alternate one and leave the primary at the old geometry. DECCOLM
    // clears the screen anyway, so an alternate buffer holding the old shape
    // has nothing left worth preserving.
    this.vt100.leaveAlternateScreen()

    this.screen.resize(geometry.cols, geometry.rows, this.foregroundColor, this.backgroundColor)
    this.column = 0
    this.row = 0
    this.offset = 0

    // The row count changed under the scroll region, and DECCOLM opens the
    // margins on real hardware anyway.
    this.vt100.resetMargins()
  }

  /**
   * Switch personality — which of the two protocols `parse` reads.
   *
   * Both parsers are dropped back to their ground state on the way through.
   * Neither one should inherit the other's half-finished sequence: a switch
   * arriving between `0x18` (FOREGROUND COLOR) and its operand, or in the
   * middle of a CSI, would otherwise leave a stray byte to be read as the wrong
   * thing entirely.
   */
  setPersonality = (personality: Personality) => {
    if (personality === this.personality) return
    this.personality = personality
    this.clearPendingBytes()
    this.ansi.reset()
  }

  /**
   * Drop any native-mode command waiting on its operand byte.
   *
   * Not `reset()` — nothing on screen changes and no colour, cursor or bell
   * setting is touched. This only forgets that a byte was expected.
   */
  private clearPendingBytes = () => {
    this.columnNextByte = false
    this.rowNextByte = false
    this.cursorCharNextByte = false
    this.foregroundColorNextByte = false
    this.backgroundColorNextByte = false
    this.bellDurationNextByte = false
    this.bellFrequencyNextByte = false
    this.dataNextByte = false
    this.escapeNextByte = false
  }

  reset = () => {
    this.column = 0
    this.row = 0
    this.offset = 0
    this.mode = 'text'
    this.cursorChar = 0x00
    this.cursorMode = 'solid'
    this.backgroundColor = 0x00
    this.foregroundColor = 0xFF
    this.bellDuration = 0x3C
    this.bellFrequency = 0x3D
    this.columnNextByte = false
    this.rowNextByte = false
    this.cursorCharNextByte = false
    this.foregroundColorNextByte = false
    this.backgroundColorNextByte = false
    this.bellDurationNextByte = false
    this.bellFrequencyNextByte = false
    this.escapeNextByte = false
    this.bellQueue = []
    this.cursorVisible = true
    this.ansi.reset()

    // Ahead of the geometry work below, so the screen it operates on is the
    // primary one. `resetMargins` comes after, once the row count is settled.
    this.vt100.reset()

    // Back to the *configured* defaults, not to hard-coded ones: someone who
    // launched `vtac --columns 80 --mode vt100` is running an 80-column VT-100,
    // and a `0x04` from the far end should not quietly demote their terminal.
    this.personality = this.defaultPersonality

    const geometry = GEOMETRIES[this.defaultColumns]
    if (this.screen.cols !== geometry.cols || this.screen.rows !== geometry.rows) {
      this.screen.resize(geometry.cols, geometry.rows)
    } else {
      this.screen.reset()
    }

    // Last, because the bottom margin is read off the row count and the lines
    // above may just have changed it.
    this.vt100.resetMargins()
  }

  bell = () => {
    // Get frequency from lookup table, default to 0 Hz if not found
    const frequency = VTAC.NOTE_FREQUENCIES[this.bellFrequency] || 0
    
    // Skip if frequency is 0 or duration is 0
    if (frequency === 0 || this.bellDuration === 0) {
      return
    }
    
    // Add bell request to queue
    this.bellQueue.push({ frequency, duration: this.bellDuration })
  }

  getNextBell = (): { frequency: number, duration: number } | undefined => {
    // Remove and return the first bell from queue
    return this.bellQueue.shift()
  }

  hasQueuedBells = (): boolean => {
    return this.bellQueue.length > 0
  }

  backspace = () => {
    if (this.column > 0) {
      this.column--
    }
    this.offset = 0
  }

  tab = () => {
    this.column = Math.min((Math.floor(this.column / 4) + 1) * 4, this.screen.cols - 1)
    this.offset = 0
  }

  lineFeed = () => {
    let nextRow = this.row + 1

    if (nextRow >= this.screen.rows) {
      nextRow = this.screen.rows - 1
      this.scroll('up')
    }

    this.row = nextRow
    this.offset = 0
  }

  carriageReturn = () => {
    this.column = 0
    this.offset = 0
  }

  deleteTo = (destination: 'startOfLine' | 'endOfLine' | 'startOfScreen' | 'endOfScreen') => {
    this.screen.deleteTo(
      destination,
      this.column,
      this.row,
      this.foregroundColor,
      this.backgroundColor
    )
  }

  scroll = (direction: 'left' | 'right' | 'up' | 'down') => {
    this.screen.scroll(direction, this.foregroundColor, this.backgroundColor)
  }

  cursor = (direction: 'left' | 'right' | 'up' | 'down') => {
    switch (direction) {
      case 'left':
        if (this.column > 0) {
          this.column--
        }
        break
      case 'right':
        if (this.column < this.screen.cols - 1) {
          this.column++
        }
        break
      case 'up':
        if (this.row > 0) {
          this.row--
        }
        break
      case 'down':
        if (this.row < this.screen.rows - 1) {
          this.row++
        }
        break
    }
    this.offset = 0
  }

  delete = () => {
    this.clearCharacterCell(this.column, this.row)
  }

  data = (data: number) => {
    switch (this.mode) {
      case 'text':
        this.insertTextData(data)
        break
      case 'graphics':
        this.insertGraphicsData(data)
        break
    }
  }

  //
  // INSERT
  //

  insertTextData = (data: number) => {
    // The glyph and its colours are recorded, not rasterized — `Screen` renders
    // it on demand, which is what makes the cell re-readable and re-colourable.
    this.screen.putGlyph(
      this.column,
      this.row,
      data,
      this.foregroundColor,
      this.backgroundColor
    )

    // Move to next character position
    this.column++
    if (this.column >= this.screen.cols) {
      this.column = 0
      this.row++
      if (this.row >= this.screen.rows) {
        this.row = this.screen.rows - 1
        this.scroll('up')
      }
    }
    this.offset = 0
  }

  insertGraphicsData = (data: number) => {
    // `offset` is the row within the 8x8 block. Bit 7 (MSB) is the leftmost
    // pixel, bit 0 (LSB) the rightmost.
    this.screen.putPixelRow(
      this.column,
      this.row,
      this.offset,
      data,
      this.foregroundColor,
      this.backgroundColor
    )

    // Move to next location in pixel array
    this.offset++
    if (this.offset >= 8) {
      this.offset = 0
      this.column++
      if (this.column >= this.screen.cols) {
        this.column = 0
        this.row++
        if (this.row >= this.screen.rows) {
          this.row = 0
        }
      }
    }
  }

  //
  // ESCAPE
  //

  /**
   * The second byte of an ESC sequence — the release's one intentional
   * deviation from v1, and a deliberately narrow one.
   *
   * | Sequence | Effect |
   * | --- | --- |
   * | `ESC 0x01` | 40-column mode (320×240) |
   * | `ESC 0x02` | 80-column mode (640×480) |
   * | `ESC 0x03` | Enter VT-100 personality |
   * | `ESC 0x04` | Query — reply with personality, columns, rows |
   * | `ESC 0x1B` | Literal `0x1B` as data |
   *
   * **Anything else is re-dispatched as an ordinary byte**, which is what makes
   * this deviation as small as it can be: a stream that carried a stray ESC
   * followed by something meaningless behaves exactly as it did under v1, where
   * ESC was a no-op and the byte after it was just the next command. Discarding
   * the byte instead would have been a second deviation, and one that eats a
   * cursor move (`ESC 0x1C`) rather than nothing at all.
   */
  escape = (data: number) => {
    switch (data) {
      case 0x01: // 40-COLUMN MODE
        this.setColumns(40)
        break
      case 0x02: // 80-COLUMN MODE
        this.setColumns(80)
        break
      case 0x03: // VT-100 PERSONALITY
        this.setPersonality('vt100')
        break
      case 0x04: // QUERY
        this.transmit(this.queryResponse())
        break
      case 0x1B: // LITERAL ESCAPE
        this.data(0x1B)
        break
      default:
        // v1's no-op ESC, preserved exactly.
        this.parse(data)
        break
    }
  }

  /**
   * The reply to `ESC 0x04`, as five bytes: the query echoed back so the far end
   * can frame it, then personality, columns and rows.
   *
   * Columns and rows go out as their literal counts — `40 30` or `80 60` — not
   * as a mode index, so a host can size its output without a lookup table and
   * without this becoming a compatibility problem if a third geometry ever
   * appears.
   *
   * **The personality byte always reads `00`.** The query is a native-mode
   * extension, so a terminal in `vt100` never reaches it: the ANSI parser takes
   * `ESC 0x04` as an escape followed by a C0 control and answers nothing. The
   * byte stays because a reply that does not say what it is describing ages
   * badly, and because it is what tells a host its `CSI ? 7000 h` landed. Asking
   * the same question from the VT-100 side is DECRQM on mode 7000, which
   * arrives with the rest of the mode handling.
   */
  queryResponse = (): number[] => {
    return [
      0x1B,
      0x04,
      this.personality === 'vt100' ? 0x01 : 0x00,
      this.screen.cols,
      this.screen.rows
    ]
  }

  //
  // HELPERS
  //

  copyCharacterCell = (sourceCol: number, sourceRow: number, destCol: number, destRow: number) => {
    this.screen.copyCell(sourceCol, sourceRow, destCol, destRow)
  }

  clearCharacterCell = (col: number, row: number) => {
    this.screen.clearCell(col, row, this.foregroundColor, this.backgroundColor)
  }

  //
  // EVENTS
  //

  parse = (data: number) => {
    // The personality switch, and the only place it is read. `vt100` hands the
    // whole stream to the ANSI state machine, which calls back into the same
    // drawing methods the native path below uses — so the two personalities
    // share a screen, a cursor and a bell, and differ only in what they read a
    // byte to mean.
    //
    // Ahead of the pending-operand checks because a personality never changes
    // with a native command half-read: `setPersonality` clears them, and the
    // one native byte that can switch personalities (`ESC 0x03`) is itself the
    // operand it was waiting for.
    if (this.personality === 'vt100') {
      this.ansi.parse(data)
      return
    }

    // First, because `escape` may re-dispatch the byte through here and the
    // flag has to be down by then or an unrecognised sequence would loop.
    if (this.escapeNextByte) {
      this.escapeNextByte = false
      this.escape(data)
      return
    }

    if (this.cursorCharNextByte) {
      this.cursorChar = data
      this.cursorCharNextByte = false
      return
    }
    if (this.columnNextByte) {
      this.column = data % this.screen.cols // 0 to cols-1
      this.offset = 0
      this.columnNextByte = false
      return
    }
    if (this.rowNextByte) {
      this.row = data % this.screen.rows // 0 to rows-1
      this.offset = 0
      this.rowNextByte = false
      return
    }

    if (this.bellDurationNextByte) {
      this.bellDuration = data
      this.bellDurationNextByte = false
      return
    }
    if (this.bellFrequencyNextByte) {
      this.bellFrequency = data
      this.bellFrequencyNextByte = false
      return
    }

    if (this.foregroundColorNextByte) {
      this.foregroundColor = data
      this.foregroundColorNextByte = false
      return
    }
    if (this.backgroundColorNextByte) {
      this.backgroundColor = data
      this.backgroundColorNextByte = false
      return
    }

    if (this.dataNextByte) {
      this.data(data)
      this.dataNextByte = false
      return
    }

    switch(true) {
      case (data == 0x00): // NULL
        break
      case (data == 0x01): // CURSOR HOME
        this.column = 0
        this.row = 0
        this.offset = 0
        break
      case (data == 0x02): // CURSOR CHARACTER
        this.cursorCharNextByte = true
        break
      case (data == 0x03): // CURSOR BLINKING
        this.cursorMode == 'solid' ? this.cursorMode = 'blinking' : this.cursorMode = 'solid'
        break
      case (data == 0x04): // RESET
        this.reset()
        break
      case (data == 0x05): // BELL DURATION
        this.bellDurationNextByte = true
        break
      case (data == 0x06): // BELL FREQUENCY
        this.bellFrequencyNextByte = true
        break
      case (data == 0x07): // BELL
        this.bell()
        break
      case (data == 0x08): // BACKSPACE
        this.backspace()
        break
      case (data == 0x09): // TAB
        this.tab()
        break
      case (data == 0x0A): // LINE FEED
        this.lineFeed()
        break
      case (data == 0x0B): // SCREEN MODE
        this.mode == 'text' ? this.mode = 'graphics' : this.mode = 'text'
        break
      case (data == 0x0C): // CLEAR SCREEN
        this.screen.clear(this.foregroundColor, this.backgroundColor)
        break
      case (data == 0x0D): // CARRIAGE RETURN
        this.carriageReturn()
        break
      case (data == 0x0E): // SET COLUMN
        this.columnNextByte = true
        break
      case (data == 0x0F): // SET ROW
        this.rowNextByte = true
        break
      case (data == 0x10): // DELETE TO START OF LINE
        this.deleteTo('startOfLine')
        break
      case (data == 0x11): // DELETE TO END OF LINE
        this.deleteTo('endOfLine')
        break
      case (data == 0x12): // DELETE TO START OF SCREEN
        this.deleteTo('startOfScreen')
        break
      case (data == 0x13): // DELETE TO END OF SCREEN
        this.deleteTo('endOfScreen')
        break
      case (data == 0x14): // SCROLL LEFT
        this.scroll('left')
        break
      case (data == 0x15): // SCROLL RIGHT
        this.scroll('right')
        break
      case (data == 0x16): // SCROLL UP
        this.scroll('up')
        break
      case (data == 0x17): // SCROLL DOWN
        this.scroll('down')
        break
      case (data == 0x18): // FOREGROUND COLOR
        this.foregroundColorNextByte = true
        break
      case (data == 0x19): // BACKGROUND COLOR
        this.backgroundColorNextByte = true
        break
      case (data == 0x1A): // NEXT BYTE AS DATA
        this.dataNextByte = true
        break
      case (data == 0x1B): // ESCAPE
        this.escapeNextByte = true
        break
      case (data == 0x1C): // CURSOR LEFT
        this.cursor('left')
        break
      case (data == 0x1D): // CURSOR RIGHT
        this.cursor('right')
        break
      case (data == 0x1E): // CURSOR UP
        this.cursor('up')
        break
      case (data == 0x1F): // CURSOR DOWN
        this.cursor('down')
        break
      case (data >= 0x20 && data <= 0x7E): // ASCII CHARACTERS
        this.data(data)
        break
      case (data == 0x7F): // DELETE
        this.delete()
        break
      case (data >= 0x80 && data <= 0xFF): // EXTENDED CHARACTERS
        this.data(data)
        break
      default:
        break
    }
  }

  // Note frequency lookup table (hex values $01-$54 mapped to Hz)
  static NOTE_FREQUENCIES: { [key: number]: number } = {
    0x01: 32.70,   // C1
    0x02: 34.65,   // C#1
    0x03: 36.71,   // D1
    0x04: 38.89,   // D#1
    0x05: 41.20,   // E1
    0x06: 43.65,   // F1
    0x07: 46.25,   // F#1
    0x08: 49.00,   // G1
    0x09: 51.91,   // G#1
    0x0A: 55.00,   // A1
    0x0B: 58.27,   // A#1
    0x0C: 61.74,   // B1
    0x0D: 65.41,   // C2
    0x0E: 69.30,   // C#2
    0x0F: 73.42,   // D2
    0x10: 77.78,   // D#2
    0x11: 82.41,   // E2
    0x12: 87.31,   // F2
    0x13: 92.50,   // F#2
    0x14: 98.00,   // G2
    0x15: 103.83,  // G#2
    0x16: 110.00,  // A2
    0x17: 116.54,  // A#2
    0x18: 123.47,  // B2
    0x19: 130.81,  // C3
    0x1A: 138.59,  // C#3
    0x1B: 146.83,  // D3
    0x1C: 155.56,  // D#3
    0x1D: 164.81,  // E3
    0x1E: 174.61,  // F3
    0x1F: 185.00,  // F#3
    0x20: 196.00,  // G3
    0x21: 207.65,  // G#3
    0x22: 220.00,  // A3
    0x23: 233.08,  // A#3
    0x24: 246.94,  // B3
    0x25: 261.63,  // C4
    0x26: 277.18,  // C#4
    0x27: 293.66,  // D4
    0x28: 311.13,  // D#4
    0x29: 329.63,  // E4
    0x2A: 349.23,  // F4
    0x2B: 369.99,  // F#4
    0x2C: 392.00,  // G4
    0x2D: 415.30,  // G#4
    0x2E: 440.00,  // A4
    0x2F: 466.16,  // A#4
    0x30: 493.88,  // B4
    0x31: 523.25,  // C5
    0x32: 554.37,  // C#5
    0x33: 587.33,  // D5
    0x34: 622.25,  // D#5
    0x35: 659.25,  // E5
    0x36: 698.46,  // F5
    0x37: 739.99,  // F#5
    0x38: 783.99,  // G5
    0x39: 830.61,  // G#5
    0x3A: 880.00,  // A5
    0x3B: 932.33,  // A#5
    0x3C: 987.77,  // B5
    0x3D: 1046.50, // C6
    0x3E: 1108.73, // C#6
    0x3F: 1174.66, // D6
    0x40: 1244.51, // D#6
    0x41: 1318.51, // E6
    0x42: 1396.91, // F6
    0x43: 1479.98, // F#6
    0x44: 1567.98, // G6
    0x45: 1661.22, // G#6
    0x46: 1760.00, // A6
    0x47: 1864.66, // A#6
    0x48: 1975.53, // B6
    0x49: 2093.00, // C7
    0x4A: 2217.46, // C#7
    0x4B: 2349.32, // D7
    0x4C: 2489.02, // D#7
    0x4D: 2637.02, // E7
    0x4E: 2793.83, // F7
    0x4F: 2959.96, // F#7
    0x50: 3135.96, // G7
    0x51: 3322.44, // G#7
    0x52: 3520.00, // A7
    0x53: 3729.31, // A#7
    0x54: 3951.07  // B7
  }

  /**
   * @deprecated Moved to `Font.CHARACTERS` in Phase 1. Kept as an alias so
   * v1's `VTAC.CHARACTERS[code]` still resolves; it is the same array.
   */
  static CHARACTERS = CHARACTERS

}