/**
 * The mode numbers and the flags they set.
 *
 * State and naming live here; what each one *does* stays in `Dispatch`, because
 * most of them do something rather than merely being remembered — DECCOLM
 * reshapes the screen, DECSCNM repaints it, the alternate-screen modes swap a
 * whole buffer. Splitting the switch out would have meant an interface existing
 * only to be implemented once.
 */

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

/**
 * DEC private modes — `CSI ? Pn h` to set, `CSI ? Pn l` to reset.
 *
 * Only the ones VT-AC answers. A mode not listed here is ignored, which is
 * what a terminal does with a mode it does not have.
 */
export const DecMode = {
  /** DECCKM — cursor keys send `ESC O x` when set, `ESC [ x` when reset. */
  CursorKeys: 1,
  /** DECANM — reset would mean VT52 mode, which VT-AC does not have. */
  Ansi: 2,
  /** DECCOLM — 80/132 on a VT100. VT-AC has no 132, so either state means 80. */
  Columns: 3,
  /** DECSCLM — smooth scroll. Nothing to do on a framebuffer that never pans. */
  SmoothScroll: 4,
  /** DECSCNM — the whole screen in reverse video. */
  ReverseVideo: 5,
  /** DECOM — cursor addressing relative to the scroll region. */
  Origin: 6,
  /** DECAWM — wrap at the right margin instead of overwriting the last cell. */
  AutoWrap: 7,
  /** DECARM — keyboard auto-repeat, which is the host OS's business. */
  AutoRepeat: 8,
  /** DECTCEM — cursor visibility. */
  CursorVisible: 25,
  /** The alternate screen, in its oldest spelling. */
  AlternateScreen: 47,
  /** The alternate screen, clearing it on the way *out*. */
  AlternateScreenClearOnExit: 1047,
  /** The alternate screen, saving the cursor and clearing on the way *in*. */
  AlternateScreenAndCursor: 1049,
  /** VT-AC's own: set to leave VT-100 mode for the native protocol. */
  NativeMode: DECSET_NATIVE_MODE
} as const

/** ANSI modes — `CSI Pn h` / `CSI Pn l`, no private marker. */
export const AnsiMode = {
  /** IRM — printing inserts and shifts the line right instead of overwriting. */
  Insert: 4,
  /** LNM — LF also returns the carriage, and Return transmits CR LF. */
  NewLine: 20
} as const

/**
 * The mode flags, at their power-on values.
 *
 * Two modes are deliberately absent. Reverse video lives on `Screen`, since the
 * rasterizer is what has to know and the alternate screen carries it across a
 * swap. Cursor visibility lives on `VTAC`, alongside the cursor itself — same
 * argument as the colours, and the renderer needs one place to look.
 */
export class Modes {
  /** DECCKM. Reset at power-on: cursor keys send the `ESC [ x` forms. */
  cursorKeys = false

  /** DECOM. Reset at power-on: addressing is absolute. */
  origin = false

  /**
   * DECAWM. **Set** at power-on — a VT100 wraps by default, and every
   * full-screen application assumes it.
   */
  autoWrap = true

  /** IRM. Reset at power-on: printing replaces. */
  insert = false

  /** LNM. Reset at power-on: LF is an index and nothing more. */
  newLine = false

  /**
   * DECKPAM/DECKPNM — `ESC =` and `ESC >`.
   *
   * Reset at power-on: the keypad sends digits. Not a DECSET mode, which is
   * why it has no number; it is set by a bare escape sequence.
   */
  keypadApplication = false

  /** Back to the power-on values. RIS, and `VTAC.reset()`. */
  reset(): void {
    this.cursorKeys = false
    this.origin = false
    this.autoWrap = true
    this.insert = false
    this.newLine = false
    this.keypadApplication = false
  }
}
