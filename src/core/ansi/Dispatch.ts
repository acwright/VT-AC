/**
 * What the ANSI sequences *mean* — the other half of `StateMachine.ts`.
 *
 * ## Where VT-100 state lives
 *
 * Here, not on `VTAC`. The scroll margins, the saved cursor and the pending
 * wrap are things only the VT-100 personality has a word for, and keeping them
 * out of `VTAC` is what stops native mode growing fields it never reads.
 *
 * The *cursor* is the exception and deliberately so: `vtac.column` and
 * `vtac.row` are the same ones native mode moves, so a personality switch never
 * teleports the cursor. Same for the colours and the bell.
 *
 * ## What is here, and what is not
 *
 * Cursor movement, erasing, line and character editing, and scroll regions.
 * Still to come: SGR and colour (5.4), DECSET/DECRST and the alternate screen
 * (5.5), charsets, tab stops and reports (5.6).
 *
 * Everything not yet implemented is **silently ignored**, which is what a
 * terminal does with a sequence it does not know. It is not a crash and it is
 * not an escape sequence printed as text.
 */

import { Attr } from '../Cell'
import { applySGR, resetPen } from './SGR'
import type { Pen } from './SGR'
import type { AnsiHandler, AnsiSequence } from './StateMachine'
import type { VTAC } from '../VTAC'

/**
 * The DEC private mode that puts the terminal back into VT-AC native mode.
 *
 * `CSI ? 7000 h` leaves `vt100`; `CSI ? 7000 l` re-enters it. The number is
 * VT-AC's invention, so it was chosen from a range nobody else has claimed:
 * xterm's `ctlseqs` documents nothing above 2006, DEC's own private modes are
 * all below 100, and the other well-known squatters sit at 1000–1016 (mouse),
 * 2004 (bracketed paste) and mintty's 7700s. 7000 is clear of all of them.
 *
 * It exists because `ESC 0x03` is a one-way door: it is a *native*-mode escape
 * extension, so once the stream is in `vt100` there is no native byte left to
 * read. A host that switched a terminal into VT-100 mode has to be able to put
 * it back without a power cycle.
 */
export const DECSET_NATIVE_MODE = 7000

/** Column width of a default VT-100 tab stop. */
const TAB_WIDTH = 8

/**
 * What DECSC (`ESC 7`) stores and DECRC (`ESC 8`) puts back.
 *
 * Colours are in because they already exist; character attributes and the
 * charset selection join them as 5.4 and 5.6 introduce them, which is why this
 * is a record rather than two numbers.
 */
interface SavedCursor {
  column: number
  row: number
  pendingWrap: boolean
  foreground: number
  background: number
  attrs: number
}

/**
 * Translates parsed ANSI sequences into operations on a `VTAC`.
 *
 * Holds the terminal rather than the screen: the cursor, the colours and the
 * bell queue all live on `VTAC`, and `Screen` deliberately knows nothing about
 * scroll margins — they are passed to it as arguments.
 */
export class Dispatch implements AnsiHandler, Pen {
  /**
   * The `Attr` bitfield SGR is currently setting on new text.
   *
   * VT-100 state, so it lives here — native mode never sets an attribute.
   */
  attrs: number = Attr.NONE

  /**
   * The pen's two colours, which are `VTAC`'s.
   *
   * Not held here, because they are not the VT-100's alone: erasing fills with
   * the current background (that is "background colour erase", and full-screen
   * applications depend on it), `Screen`'s scroll and clear take them, and
   * native mode's `0x18`/`0x19` write the same two values. One set of colours,
   * two ways of setting them.
   */
  get foreground(): number {
    return this.vtac.foregroundColor
  }
  set foreground(value: number) {
    this.vtac.foregroundColor = value
  }

  get background(): number {
    return this.vtac.backgroundColor
  }
  set background(value: number) {
    this.vtac.backgroundColor = value
  }

  /**
   * Top margin of the scroll region, 0-based and inclusive.
   *
   * Held here rather than on `Screen` because a scroll region is protocol
   * state: native mode has no such concept, and the alternate screen (5.5)
   * stays a plain second `Screen` as a result.
   */
  top = 0

  /** Bottom margin of the scroll region, 0-based and inclusive. */
  bottom: number

  /**
   * The deferred last-column wrap.
   *
   * Writing to the last column does **not** move the cursor off it. It sets
   * this flag, and the *next* graphic character wraps first. That is what makes
   * a character in the bottom-right corner not scroll the screen, and it is the
   * single most commonly botched VT100 behaviour — the plan names it as the
   * first thing `vttest` catches, which is why it is here in 5.3 rather than
   * bolted on with the rest of the modes.
   *
   * Autowrap is unconditional for now; DECAWM's off switch is 5.5's, and lands
   * as one branch in `print`.
   */
  private pendingWrap = false

  private saved: SavedCursor | null = null

  constructor(private readonly vtac: VTAC) {
    this.bottom = vtac.screen.rows - 1
  }

  /** Back to power-on state. `VTAC.reset()` and RIS alike. */
  reset(): void {
    this.resetMargins()
    resetPen(this)
    this.pendingWrap = false
    this.saved = null
  }

  /**
   * Open the scroll region to the whole screen.
   *
   * Called on a column-mode switch as well as a reset: the row count changed,
   * and DECCOLM opens the margins on real hardware.
   */
  resetMargins(): void {
    this.top = 0
    this.bottom = this.vtac.screen.rows - 1
  }

  //
  // CHARACTERS AND CONTROLS
  //

  /**
   * A graphic character.
   *
   * Always a glyph: VT-100 mode has no equivalent of native mode's graphics
   * mode, so this does not go through `VTAC.data()` and a stream that left
   * `mode` set to `graphics` before switching personality still gets text.
   */
  print(code: number): void {
    const vtac = this.vtac
    const screen = vtac.screen

    if (this.pendingWrap) {
      this.pendingWrap = false
      vtac.column = 0
      this.index()
    }

    screen.putGlyph(vtac.column, vtac.row, code, this.foreground, this.background, this.attrs)

    if (vtac.column < screen.cols - 1) vtac.column++
    else this.pendingWrap = true

    vtac.offset = 0
  }

  /**
   * A C0 control.
   *
   * The five a VT-100 acts on. Everything else — SO/SI, which need the charset
   * machinery, and the rest, which a VT-100 ignores — falls through.
   */
  execute(code: number): void {
    switch (code) {
      case 0x07: // BEL
        this.vtac.bell()
        break
      case 0x08: // BS
        this.setColumn(this.vtac.column - 1)
        break
      case 0x09: // HT
        this.tab()
        break
      case 0x0a: // LF
      case 0x0b: // VT — a VT-100 treats both as an index
      case 0x0c: // FF
        this.index()
        break
      case 0x0d: // CR
        this.setColumn(0)
        break
    }
  }

  //
  // ESCAPE SEQUENCES
  //

  /** `ESC` … final. */
  esc(final: number, seq: AnsiSequence): void {
    // `ESC ( 0` and the other charset designators carry an intermediate and
    // are 5.6's, as is `ESC # 8` (DECALN).
    if (seq.intermediates.length > 0) return

    switch (final) {
      case 0x37: // '7' — DECSC, save cursor
        this.saveCursor()
        break
      case 0x38: // '8' — DECRC, restore cursor
        this.restoreCursor()
        break
      case 0x44: // 'D' — IND, index
        this.index()
        break
      case 0x45: // 'E' — NEL, next line
        this.index()
        this.setColumn(0)
        break
      case 0x4d: // 'M' — RI, reverse index
        this.reverseIndex()
        break
      case 0x63: // 'c' — RIS, reset to initial state
        this.vtac.reset()
        break
    }
  }

  /** `CSI` … final. */
  csi(final: number, seq: AnsiSequence): void {
    if (seq.prefix === 0x3f) {
      // `CSI ? … h` / `CSI ? … l` — DECSET / DECRST
      if (final === 0x68) this.privateModes(seq, true)
      else if (final === 0x6c) this.privateModes(seq, false)
      return
    }

    // `CSI > c` (secondary DA) and `CSI ! p` (DECSTR) carry a prefix or an
    // intermediate and belong to 5.6. Reading them as their unadorned
    // namesakes would be worse than ignoring them.
    if (seq.prefix !== 0 || seq.intermediates.length > 0) return

    const vtac = this.vtac
    const screen = vtac.screen
    const fg = vtac.foregroundColor
    const bg = vtac.backgroundColor
    const count = seq.paramOr(0, 1)

    switch (final) {
      case 0x41: // 'A' — CUU
        this.cursorUp(count)
        break
      case 0x42: // 'B' — CUD
        this.cursorDown(count)
        break
      case 0x43: // 'C' — CUF
        this.setColumn(vtac.column + count)
        break
      case 0x44: // 'D' — CUB
        this.setColumn(vtac.column - count)
        break
      case 0x45: // 'E' — CNL
        this.cursorDown(count)
        this.setColumn(0)
        break
      case 0x46: // 'F' — CPL
        this.cursorUp(count)
        this.setColumn(0)
        break
      case 0x47: // 'G' — CHA
        this.setColumn(count - 1)
        break
      case 0x48: // 'H' — CUP
      case 0x66: // 'f' — HVP, identical to CUP
        this.setRow(seq.paramOr(0, 1) - 1)
        this.setColumn(seq.paramOr(1, 1) - 1)
        break
      case 0x4a: // 'J' — ED
        this.eraseInDisplay(seq.param(0))
        break
      case 0x4b: // 'K' — EL
        this.eraseInLine(seq.param(0))
        break
      case 0x4c: // 'L' — IL
        this.insertLines(count)
        break
      case 0x4d: // 'M' — DL
        this.deleteLines(count)
        break
      case 0x40: // '@' — ICH
        screen.insertChars(vtac.column, vtac.row, count, fg, bg)
        this.pendingWrap = false
        break
      case 0x50: // 'P' — DCH
        screen.deleteChars(vtac.column, vtac.row, count, fg, bg)
        this.pendingWrap = false
        break
      case 0x58: // 'X' — ECH
        screen.eraseChars(vtac.column, vtac.row, count, fg, bg)
        this.pendingWrap = false
        break
      case 0x64: // 'd' — VPA
        this.setRow(count - 1)
        break
      case 0x6d: // 'm' — SGR
        applySGR(seq, this)
        break
      case 0x72: // 'r' — DECSTBM
        this.setScrollRegion(seq)
        break
    }
  }

  //
  // CURSOR
  //

  /**
   * Move the cursor to an absolute column, clamped to the screen.
   *
   * Every cursor movement goes through here or `setRow`, and both clear the
   * pending wrap — a cursor that has been told where to go is not still waiting
   * to fall off the end of a line.
   */
  private setColumn(column: number): void {
    const vtac = this.vtac
    vtac.column = Math.min(Math.max(column, 0), vtac.screen.cols - 1)
    vtac.offset = 0
    this.pendingWrap = false
  }

  /** Move the cursor to an absolute row, clamped to the screen. */
  private setRow(row: number): void {
    const vtac = this.vtac
    vtac.row = Math.min(Math.max(row, 0), vtac.screen.rows - 1)
    vtac.offset = 0
    this.pendingWrap = false
  }

  /**
   * CUU — up, stopping at the top margin.
   *
   * A cursor already above the region is not dragged into it; it stops at the
   * top of the screen instead. Which margin applies therefore depends on which
   * side of it the cursor started, and that is DEC's rule, not a simplification.
   */
  private cursorUp(count: number): void {
    const row = this.vtac.row
    this.setRow(Math.max(row - count, row >= this.top ? this.top : 0))
  }

  /** CUD — down, stopping at the bottom margin. */
  private cursorDown(count: number): void {
    const vtac = this.vtac
    const limit = vtac.row <= this.bottom ? this.bottom : vtac.screen.rows - 1
    this.setRow(Math.min(vtac.row + count, limit))
  }

  /** VT-100 tab: the next multiple of eight, stopping at the right margin. */
  private tab(): void {
    const column = this.vtac.column
    this.setColumn(Math.floor(column / TAB_WIDTH) * TAB_WIDTH + TAB_WIDTH)
  }

  /**
   * IND / LF — down one row, scrolling the region when already at its foot.
   *
   * The margin is what makes this different from native mode's line feed, which
   * only ever scrolls the whole screen. A cursor *below* the bottom margin
   * walks to the last row and stops, rather than scrolling a region it is not
   * inside.
   */
  private index(): void {
    const vtac = this.vtac
    this.pendingWrap = false

    if (vtac.row === this.bottom) {
      vtac.screen.scrollUp(this.top, this.bottom, 1, vtac.foregroundColor, vtac.backgroundColor)
    } else if (vtac.row < vtac.screen.rows - 1) {
      vtac.row++
    }
    vtac.offset = 0
  }

  /** RI — up one row, scrolling the region down when already at its head. */
  private reverseIndex(): void {
    const vtac = this.vtac
    this.pendingWrap = false

    if (vtac.row === this.top) {
      vtac.screen.scrollDown(this.top, this.bottom, 1, vtac.foregroundColor, vtac.backgroundColor)
    } else if (vtac.row > 0) {
      vtac.row--
    }
    vtac.offset = 0
  }

  /** DECSC — position and pen alike, which is what makes it usable at all. */
  private saveCursor(): void {
    const vtac = this.vtac
    this.saved = {
      column: vtac.column,
      row: vtac.row,
      pendingWrap: this.pendingWrap,
      foreground: this.foreground,
      background: this.background,
      attrs: this.attrs
    }
  }

  /**
   * DECRC.
   *
   * With nothing saved the cursor goes home, which is what a power-on saved
   * position of the origin amounts to. The restored position is clamped, since
   * a column-mode switch may have shrunk the screen since it was taken.
   */
  private restoreCursor(): void {
    const vtac = this.vtac
    const saved = this.saved

    if (saved === null) {
      resetPen(this)
      this.setRow(0)
      this.setColumn(0)
      return
    }

    this.foreground = saved.foreground
    this.background = saved.background
    this.attrs = saved.attrs
    this.setRow(saved.row)
    this.setColumn(saved.column)
    this.pendingWrap = saved.pendingWrap && vtac.column === vtac.screen.cols - 1
  }

  //
  // ERASING AND EDITING
  //

  /** ED — 0 to the end of the screen, 1 from the start, 2 all of it. */
  private eraseInDisplay(mode: number): void {
    const vtac = this.vtac
    this.pendingWrap = false

    switch (mode) {
      case 0:
        vtac.deleteTo('endOfScreen')
        break
      case 1:
        vtac.deleteTo('startOfScreen')
        break
      case 2:
        // The cursor does not move — that is ED's difference from a reset, and
        // full-screen applications rely on it.
        vtac.screen.clear(vtac.foregroundColor, vtac.backgroundColor)
        break
    }
  }

  /** EL — 0 to the end of the line, 1 from the start, 2 all of it. */
  private eraseInLine(mode: number): void {
    const vtac = this.vtac
    this.pendingWrap = false

    switch (mode) {
      case 0:
        vtac.deleteTo('endOfLine')
        break
      case 1:
        vtac.deleteTo('startOfLine')
        break
      case 2:
        vtac.screen.eraseChars(
          0,
          vtac.row,
          vtac.screen.cols,
          vtac.foregroundColor,
          vtac.backgroundColor
        )
        break
    }
  }

  /**
   * IL — open blank lines at the cursor, pushing the region down.
   *
   * Only inside the scroll region: a cursor outside it makes this a no-op,
   * which is DEC's rule and what stops an application scribbling over a status
   * line it deliberately excluded from the region. The cursor moves to column
   * one, as it does on a VT102.
   */
  private insertLines(count: number): void {
    const vtac = this.vtac
    if (vtac.row < this.top || vtac.row > this.bottom) return

    vtac.screen.scrollDown(
      vtac.row,
      this.bottom,
      count,
      vtac.foregroundColor,
      vtac.backgroundColor
    )
    this.setColumn(0)
  }

  /** DL — remove lines at the cursor, pulling the region up behind them. */
  private deleteLines(count: number): void {
    const vtac = this.vtac
    if (vtac.row < this.top || vtac.row > this.bottom) return

    vtac.screen.scrollUp(vtac.row, this.bottom, count, vtac.foregroundColor, vtac.backgroundColor)
    this.setColumn(0)
  }

  //
  // SCROLL REGION
  //

  /**
   * DECSTBM — set the top and bottom margins.
   *
   * `CSI r` with no parameters opens the region to the whole screen. Margins
   * that run off the bottom are clamped rather than refused, since hosts really
   * do send `CSI 1;99r`; a region that would be inverted or a single line is
   * refused outright, and the sequence does nothing at all — including not
   * homing the cursor, which a half-applied DECSTBM would.
   */
  private setScrollRegion(seq: AnsiSequence): void {
    const vtac = this.vtac
    const rows = vtac.screen.rows

    const top = Math.max(seq.paramOr(0, 1) - 1, 0)
    const bottom = Math.min(seq.paramOr(1, rows) - 1, rows - 1)
    if (top >= bottom) return

    this.top = top
    this.bottom = bottom

    // DECSTBM homes the cursor. Absolute for now — DECOM, which makes home the
    // top margin instead, is 5.5's.
    this.setRow(0)
    this.setColumn(0)
  }

  //
  // MODES
  //

  /**
   * DECSET/DECRST. Only mode 7000 is answered so far; the rest are 5.5's.
   *
   * Each parameter is a separate mode, so `CSI ? 1 ; 7000 h` sets both — which
   * is why this loops rather than reading `param(0)`.
   */
  private privateModes(seq: AnsiSequence, set: boolean): void {
    for (let i = 0; i < seq.paramCount; i++) {
      switch (seq.param(i)) {
        case DECSET_NATIVE_MODE:
          this.vtac.setPersonality(set ? 'native' : 'vt100')
          break
      }
    }
  }
}
