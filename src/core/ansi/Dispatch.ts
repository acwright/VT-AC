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
import { Screen } from '../Screen'
import { Charsets, charsetFor, slotFor } from './Charsets'
import { AnsiMode, DecMode, Modes } from './Modes'
import { applySGR, resetPen } from './SGR'
import type { Pen } from './SGR'
import type { AnsiHandler, AnsiSequence } from './StateMachine'
import type { VTAC } from '../VTAC'

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
  /** The mode flags. See `Modes` for the two that deliberately live elsewhere. */
  readonly modes = new Modes()

  /** The four designated character sets, and which one is shifted in. */
  readonly charsets = new Charsets()

  /**
   * One byte per column, `1` where a tab stop is.
   *
   * Reallocated on a column-mode switch — stops beyond the new right margin
   * mean nothing, and the array has to be the width of the screen it describes.
   */
  private tabStops = new Uint8Array(0)

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

  /**
   * The primary screen, while the alternate one is in front of it.
   *
   * Null when the terminal is on its primary screen, which is also how
   * `onAlternateScreen` is answered — there is no separate flag to fall out of
   * step with the screen actually installed.
   */
  private primary: Screen | null = null

  /** The alternate screen, kept between visits so `47` can return to it. */
  private alternate: Screen | null = null

  constructor(private readonly vtac: VTAC) {
    this.bottom = vtac.screen.rows - 1
    this.resetTabStops()
  }

  /** Whether the alternate screen is the one currently in front. */
  get onAlternateScreen(): boolean {
    return this.primary !== null
  }

  /**
   * Back to power-on state. `VTAC.reset()` and RIS alike.
   *
   * Margins are *not* reset here — `VTAC.reset()` may be about to change the
   * row count, and the bottom margin is read off it. It calls `resetMargins()`
   * afterwards.
   */
  reset(): void {
    this.leaveAlternateScreen()
    this.alternate = null
    this.modes.reset()
    this.charsets.reset()
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

  /**
   * Back to a stop every eight columns, sized to the current screen.
   *
   * Column zero is deliberately not a stop: tabbing from the left margin lands
   * on column 8, which is what every terminal does and what makes the first
   * column of a tabbed table start where it looks like it should.
   */
  resetTabStops(): void {
    this.tabStops = new Uint8Array(this.vtac.screen.cols)
    for (let col = TAB_WIDTH; col < this.tabStops.length; col += TAB_WIDTH) {
      this.tabStops[col] = 1
    }
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

    // IRM — the rest of the line moves right and the cell that fell off the
    // end is gone, exactly as ICH 1 would have done it.
    if (this.modes.insert) {
      screen.insertChars(vtac.column, vtac.row, 1, this.foreground, this.background)
    }

    screen.putGlyph(
      vtac.column,
      vtac.row,
      this.charsets.translate(code),
      this.foreground,
      this.background,
      this.attrs
    )

    if (vtac.column < screen.cols - 1) {
      vtac.column++
    } else if (this.modes.autoWrap) {
      // DECAWM set: arm the deferred wrap. The cursor stays on the last column
      // and the *next* character is what moves it.
      this.pendingWrap = true
    }
    // DECAWM reset: the cursor sits on the last column and every further
    // character overwrites it. No wrap, ever.

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
        // LNM — a line feed returns the carriage too, which is what turns a
        // host sending bare LFs into readable output.
        if (this.modes.newLine) this.setColumn(0)
        break
      case 0x0d: // CR
        this.setColumn(0)
        break
      case 0x0e: // SO — shift out, G1 into GL
        this.charsets.gl = 1
        break
      case 0x0f: // SI — shift in, G0 into GL
        this.charsets.gl = 0
        break
    }
  }

  //
  // ESCAPE SEQUENCES
  //

  /** `ESC` … final. */
  esc(final: number, seq: AnsiSequence): void {
    if (seq.intermediates.length > 0) {
      if (seq.intermediates.length !== 1) return
      const intermediate = seq.intermediates[0]

      // `ESC ( 0` and friends — SCS, designate a character set into a G slot.
      const slot = slotFor(intermediate)
      if (slot >= 0) {
        const charset = charsetFor(final)
        if (charset !== null) this.charsets.designate(slot, charset)
        return
      }

      // `ESC # 8` — DECALN.
      if (intermediate === 0x23 && final === 0x38) this.screenAlignment()
      return
    }

    switch (final) {
      case 0x3d: // '=' — DECKPAM, application keypad
        this.modes.keypadApplication = true
        break
      case 0x3e: // '>' — DECKPNM, numeric keypad
        this.modes.keypadApplication = false
        break
      case 0x48: // 'H' — HTS, set a tab stop here
        this.setTabStop()
        break
      case 0x5a: // 'Z' — DECID, answered as DA is
        this.deviceAttributes()
        break
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

    // Anything carrying another prefix or an intermediate is a sequence a
    // VT100 does not have: `CSI > c` is the VT220 secondary DA, `CSI ! p` is
    // DECSTR. Both are answered by silence, which is what the terminal being
    // impersonated does. Reading them as their unadorned namesakes — `CSI c`
    // and `CSI p` — would be much worse than ignoring them.
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
        this.setRowFromParam(seq.paramOr(0, 1))
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
      case 0x63: // 'c' — DA, device attributes
        // `CSI 0 c` and a bare `CSI c` are the request; anything else is not.
        if (seq.param(0) === 0) this.deviceAttributes()
        break
      case 0x64: // 'd' — VPA
        this.setRowFromParam(count)
        break
      case 0x67: // 'g' — TBC, clear tab stops
        this.clearTabStops(seq.param(0))
        break
      case 0x6e: // 'n' — DSR, device status report
        this.statusReport(seq.param(0))
        break
      case 0x68: // 'h' — SM, set mode
        this.ansiModes(seq, true)
        break
      case 0x6c: // 'l' — RM, reset mode
        this.ansiModes(seq, false)
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
   * CUP and VPA's row parameter — one-based, and origin-mode aware.
   *
   * DECOM set means row 1 *is* the top margin and the cursor cannot address
   * anything outside the region at all. That is the point of the mode: an
   * application can set a region and then forget the margins exist.
   */
  private setRowFromParam(oneBased: number): void {
    if (!this.modes.origin) {
      this.setRow(oneBased - 1)
      return
    }
    const row = this.top + oneBased - 1
    this.setRow(Math.min(Math.max(row, this.top), this.bottom))
  }

  /** Where the cursor goes home to — the top margin under DECOM. */
  private home(): void {
    this.setRow(this.modes.origin ? this.top : 0)
    this.setColumn(0)
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

  /**
   * HT — forward to the next tab stop, or to the right margin if there is none.
   *
   * Native mode's `TAB` is every *four* columns and stays that way: v1 defined
   * it so, and the premise of the personality switch is that where the two
   * disagree, both are kept.
   */
  private tab(): void {
    const cols = this.vtac.screen.cols
    for (let col = this.vtac.column + 1; col < cols; col++) {
      if (this.tabStops[col] === 1) {
        this.setColumn(col)
        return
      }
    }
    this.setColumn(cols - 1)
  }

  // `tabStops.length` is always `screen.cols` — `resetTabStops` is the only
  // thing that allocates it and `VTAC.setColumns` calls it on every geometry
  // change — and the cursor column is always clamped below that. So neither of
  // the two below needs a bounds check.

  /** HTS — a tab stop at the cursor's column. */
  private setTabStop(): void {
    this.tabStops[this.vtac.column] = 1
  }

  /** TBC — 0 clears the stop under the cursor, 3 clears every one. */
  private clearTabStops(mode: number): void {
    if (mode === 3) this.tabStops.fill(0)
    else if (mode === 0) this.tabStops[this.vtac.column] = 0
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
      this.home()
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

    // DECSTBM homes the cursor — to the top margin under DECOM, to the top of
    // the screen otherwise.
    this.home()
  }

  //
  // MODES
  //

  /**
   * DECSET/DECRST — `CSI ? Pn h` and `CSI ? Pn l`.
   *
   * Each parameter is a separate mode, so `CSI ? 1 ; 25 h` sets both — which is
   * why this loops rather than reading `param(0)`.
   */
  private privateModes(seq: AnsiSequence, set: boolean): void {
    for (let i = 0; i < seq.paramCount; i++) this.privateMode(seq.param(i), set)
  }

  private privateMode(mode: number, set: boolean): void {
    const vtac = this.vtac

    switch (mode) {
      case DecMode.CursorKeys: // DECCKM
        this.modes.cursorKeys = set
        break

      case DecMode.Columns: // DECCOLM
        // On a VT100 this is 80/132; VT-AC has no 132, so it drives the 40/80
        // switch the terminal actually has. Clears the screen and homes, as
        // DECCOLM does on real hardware.
        vtac.setColumns(set ? 80 : 40)
        break

      case DecMode.ReverseVideo: // DECSCNM
        vtac.screen.reverse = set
        vtac.screen.dirtyAll()
        break

      case DecMode.Origin: // DECOM
        this.modes.origin = set
        // Setting *or* resetting DECOM homes the cursor, which is the only way
        // the two coordinate systems can be swapped without it landing
        // somewhere meaningless.
        this.home()
        break

      case DecMode.AutoWrap: // DECAWM
        this.modes.autoWrap = set
        if (!set) this.pendingWrap = false
        break

      case DecMode.CursorVisible: // DECTCEM
        vtac.cursorVisible = set
        break

      case DecMode.AlternateScreen: // 47
        if (set) this.enterAlternateScreen(false)
        else this.leaveAlternateScreen()
        break

      case DecMode.AlternateScreenClearOnExit: // 1047
        if (set) {
          this.enterAlternateScreen(false)
        } else {
          // Cleared on the way *out*, so the buffer a later `47` finds is
          // blank rather than holding the last application's screen.
          if (this.alternate !== null) this.alternate.clear(this.foreground, this.background)
          this.leaveAlternateScreen()
        }
        break

      case DecMode.AlternateScreenAndCursor: // 1049
        // The one applications actually use: save the cursor, switch, and
        // clear. Without it `vi` and `htop` scribble over the primary screen
        // and leave it wrecked on exit.
        if (set) {
          this.saveCursor()
          this.enterAlternateScreen(true)
        } else {
          this.leaveAlternateScreen()
          this.restoreCursor()
        }
        break

      case DecMode.NativeMode: // VT-AC's own
        vtac.setPersonality(set ? 'native' : 'vt100')
        break

      // Accepted and deliberately inert. DECANM's reset would mean VT52, which
      // VT-AC does not have and will not pretend to; DECSCLM asks for smooth
      // scrolling on a framebuffer that never pans; DECARM is the host
      // keyboard's auto-repeat. Answering them silently is right — a terminal
      // that does not have a mode simply does not have it.
      case DecMode.Ansi:
      case DecMode.SmoothScroll:
      case DecMode.AutoRepeat:
        break
    }
  }

  /** SM/RM — `CSI Pn h` and `CSI Pn l`, no private marker. */
  private ansiModes(seq: AnsiSequence, set: boolean): void {
    for (let i = 0; i < seq.paramCount; i++) {
      switch (seq.param(i)) {
        case AnsiMode.Insert: // IRM
          this.modes.insert = set
          break
        case AnsiMode.NewLine: // LNM
          this.modes.newLine = set
          break
      }
    }
  }

  //
  // REPORTS
  //
  // Replies go out over the same wire the keyboard uses, and land nowhere at
  // all when no serial port has claimed it — `VTAC.transmit`'s rule, which is
  // v1's rule for keystrokes pointed in the other direction.
  //

  /** Send a reply, given as the text of the sequence. */
  private reply(text: string): void {
    const bytes: number[] = []
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i))
    this.vtac.transmit(bytes)
  }

  /**
   * DA and DECID — "what are you?"
   *
   * `ESC [ ? 1 ; 2 c` is a VT100 with the Advanced Video Option, which is the
   * machine VT-AC is impersonating: AVO is what gave a VT100 its bold,
   * underline, blink and reverse, and those are exactly the four attributes
   * the rasterizer can draw.
   */
  private deviceAttributes(): void {
    this.reply('\x1b[?1;2c')
  }

  /** DSR — 5 asks whether the terminal is well, 6 asks where the cursor is. */
  private statusReport(request: number): void {
    const vtac = this.vtac

    if (request === 5) {
      this.reply('\x1b[0n')
      return
    }

    if (request === 6) {
      // CPR, one-based — and relative to the top margin under DECOM, so that a
      // report round-trips through the same coordinates CUP accepts.
      const row = this.modes.origin ? vtac.row - this.top + 1 : vtac.row + 1
      this.reply(`\x1b[${row};${vtac.column + 1}R`)
    }
  }

  /**
   * DECALN — fill the screen with `E`s.
   *
   * A screen-alignment pattern, and the first thing `vttest` draws. The margins
   * open and the cursor homes, which is what makes it usable as the "known
   * state" the tests that follow it assume.
   */
  private screenAlignment(): void {
    const screen = this.vtac.screen

    for (let row = 0; row < screen.rows; row++) {
      for (let col = 0; col < screen.cols; col++) {
        screen.putGlyph(col, row, 0x45, this.foreground, this.background)
      }
    }

    this.resetMargins()
    this.home()
  }

  //
  // ALTERNATE SCREEN
  //
  // A second `Screen`, swapped by reference. Phase 2 is what makes this cheap:
  // a `Screen` owns its planes outright, so there is nothing to copy and
  // nothing shared to get wrong.
  //

  /** Put the alternate screen in front, creating it the first time. */
  private enterAlternateScreen(clear: boolean): void {
    const vtac = this.vtac
    if (this.primary !== null) return

    // Rebuilt whenever the geometry has moved on — a column switch resizes the
    // screen it is *on*, so a cached alternate can outlive the shape it was
    // made for.
    const current = vtac.screen
    if (
      this.alternate === null ||
      this.alternate.cols !== current.cols ||
      this.alternate.rows !== current.rows
    ) {
      this.alternate = new Screen(current.cols, current.rows, this.foreground, this.background)
    }

    this.primary = current
    this.alternate.reverse = current.reverse
    vtac.screen = this.alternate

    if (clear) this.alternate.clear(this.foreground, this.background)

    // The renderer has been looking at a different plane, and its backing store
    // still holds it.
    this.alternate.dirtyAll()
  }

  /** Put the primary screen back, untouched. A no-op when already on it. */
  leaveAlternateScreen(): void {
    const primary = this.primary
    if (primary === null) return

    primary.reverse = this.vtac.screen.reverse
    this.vtac.screen = primary
    this.primary = null
    primary.dirtyAll()
  }
}
