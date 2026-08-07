/**
 * What the ANSI sequences *mean* — the other half of `StateMachine.ts`.
 *
 * ## What is here, and what is not
 *
 * Phase 5.1 lands the parser and the personality switch, so this handler
 * implements exactly the two things a personality switch needs to be usable and
 * reversible: characters and C0 controls reach the screen, and there is a way
 * back out. Cursor movement, erasing, SGR, scroll regions, modes, the alternate
 * screen, charsets and reports arrive in 5.2 onwards.
 *
 * Everything not yet implemented is **silently ignored**, which is what a
 * terminal does with a sequence it does not know. It is not a crash and it is
 * not an escape sequence printed as text.
 */

import { AnsiParser } from './StateMachine'
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
 * Translates parsed ANSI sequences into operations on a `VTAC`.
 *
 * Holds the terminal rather than the screen: cursor position, colours and the
 * bell queue all live on `VTAC`, and the VT-100 path has to move the same
 * cursor the native path does or a personality switch would teleport it.
 */
export class Dispatch implements AnsiHandler {
  constructor(private readonly vtac: VTAC) {}

  /**
   * A graphic character.
   *
   * Routed through the same `insertTextData` native mode uses, so both
   * personalities put a glyph on screen by exactly one code path — including
   * its wrap and scroll at the right margin. Note that this is an *immediate*
   * wrap; DECAWM's deferred last-column wrap, which is the behaviour `vttest`
   * checks first, is Phase 5.5's along with the rest of the mode handling.
   */
  print(code: number): void {
    this.vtac.data(code)
  }

  /**
   * A C0 control.
   *
   * The five VT-100 acts on. Everything else — SO/SI, which need the charset
   * machinery, and the rest, which a VT-100 ignores — falls through.
   */
  execute(code: number): void {
    const vtac = this.vtac

    switch (code) {
      case 0x07: // BEL
        vtac.bell()
        break
      case 0x08: // BS
        vtac.backspace()
        break
      case 0x09: // HT
        this.tab()
        break
      case 0x0a: // LF
      case 0x0b: // VT — a VT-100 treats both as an index
      case 0x0c: // FF
        vtac.lineFeed()
        break
      case 0x0d: // CR
        vtac.carriageReturn()
        break
    }
  }

  /** `ESC` … final. */
  esc(final: number, seq: AnsiSequence): void {
    // `ESC ( 0` and the other charset designators carry an intermediate and
    // are Phase 5.6's.
    if (seq.intermediates.length > 0) return

    switch (final) {
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
    }
  }

  //
  // INTERNALS
  //

  /**
   * VT-100 tab: the next multiple of eight, stopping at the right margin.
   *
   * Native mode's `TAB` is every *four* columns and stays that way — v1 defined
   * it that way and the whole premise of the personality switch is that where
   * the two disagree, both are kept. Settable stops (HTS/TBC) are Phase 5.6's;
   * until then every eighth column is a stop, which is the power-on default.
   */
  private tab(): void {
    const vtac = this.vtac
    vtac.column = Math.min(
      (Math.floor(vtac.column / TAB_WIDTH) + 1) * TAB_WIDTH,
      vtac.screen.cols - 1
    )
    vtac.offset = 0
  }

  /**
   * DECSET/DECRST. Only mode 7000 is answered so far; the rest are Phase 5.5's.
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

/** Build the parser and handler pair a `VTAC` reads its `vt100` stream with. */
export function createAnsiParser(vtac: VTAC): AnsiParser {
  return new AnsiParser(new Dispatch(vtac))
}
