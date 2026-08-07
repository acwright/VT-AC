/**
 * Character sets — SCS and the G0/G1 shift.
 *
 * A VT100 holds four designated sets and maps one of them into the 0x20–0x7F
 * range at a time. `ESC ( 0` designates DEC Special Graphics into G0, `SO`
 * shifts G1 into GL, and so on. The only two that change what a byte draws are
 * Special Graphics and UK, and **VT-AC has the glyphs for both already** —
 * which is the argument the plan makes for CP437 being the right ROM for the
 * fiction. Line drawing comes free, and so does the pound sign.
 */

import { DEC_SPECIAL_GRAPHICS, DEC_SPECIAL_GRAPHICS_MAX, DEC_SPECIAL_GRAPHICS_MIN } from '../Font'

/** The character sets VT-AC can be asked for. */
export const Charset = {
  /** US ASCII — `B`. The power-on designation of all four slots. */
  Ascii: 0,
  /** UK — `A`. ASCII with `#` replaced by `£`. */
  Uk: 1,
  /** DEC Special Graphics — `0`. Line drawing and a handful of symbols. */
  SpecialGraphics: 2
} as const
export type Charset = (typeof Charset)[keyof typeof Charset]

/** CP437's pound sign, the one character UK ASCII differs from US by. */
const POUND = 0x9c

/** The `#` UK replaces. */
const HASH = 0x23

/**
 * An SCS final byte → the set it names, or `null` for one VT-AC does not have.
 *
 * An unknown designation leaves the slot as it was, which is a VT100's
 * behaviour and better than silently designating ASCII: a host asking for a
 * set that is not here has made a mistake, and quietly changing a *different*
 * setting would compound it.
 */
export function charsetFor(designator: number): Charset | null {
  switch (designator) {
    case 0x42: // 'B'
      return Charset.Ascii
    case 0x41: // 'A'
      return Charset.Uk
    case 0x30: // '0'
      return Charset.SpecialGraphics
    default:
      return null
  }
}

/**
 * An SCS intermediate → the G slot it designates into, or `-1`.
 *
 * `(` G0, `)` G1, `*` G2, `+` G3.
 */
export function slotFor(intermediate: number): number {
  if (intermediate >= 0x28 && intermediate <= 0x2b) return intermediate - 0x28
  return -1
}

/** One byte, through one character set. */
export function translate(code: number, charset: Charset): number {
  if (charset === Charset.SpecialGraphics) {
    if (code >= DEC_SPECIAL_GRAPHICS_MIN && code <= DEC_SPECIAL_GRAPHICS_MAX) {
      return DEC_SPECIAL_GRAPHICS[code]
    }
    return code
  }
  if (charset === Charset.Uk && code === HASH) return POUND
  return code
}

/** The four designated sets, and which of them is currently in GL. */
export class Charsets {
  /** G0–G3, in that order. */
  readonly g: Charset[] = [Charset.Ascii, Charset.Ascii, Charset.Ascii, Charset.Ascii]

  /**
   * Which G slot is mapped into GL — 0 after `SI`, 1 after `SO`.
   *
   * G2 and G3 can be designated but not shifted into: reaching them needs
   * single shifts (`SS2`/`SS3`), which are VT220 and not part of the fiction.
   * Designating them is still accepted, so a host that sets all four up front
   * is not met with an error.
   */
  gl = 0

  /** Designate a set into a slot. Out-of-range slots are ignored. */
  designate(slot: number, charset: Charset): void {
    if (slot < 0 || slot > 3) return
    this.g[slot] = charset
  }

  /** One byte, through whichever set is in GL. */
  translate(code: number): number {
    return translate(code, this.g[this.gl])
  }

  /** Back to ASCII in all four slots, with G0 shifted in. */
  reset(): void {
    this.g[0] = Charset.Ascii
    this.g[1] = Charset.Ascii
    this.g[2] = Charset.Ascii
    this.g[3] = Charset.Ascii
    this.gl = 0
  }

  /**
   * A copy of the whole designation, for DECSC to hold and DECRC to put back.
   *
   * DECSC saves the character sets as well as the cursor and the attributes —
   * it is one of the two things about it that surprise people, the other being
   * that it survives an alternate-screen switch. `vttest`'s save/restore screen
   * is what catches its absence: the five characters written after the restore
   * come out as `q` and `` ` `` instead of `─` and `♦`.
   */
  save(): CharsetState {
    return { g: [...this.g], gl: this.gl }
  }

  /** Adopt a state taken by `save`. */
  restore(state: CharsetState): void {
    for (let i = 0; i < 4; i++) this.g[i] = state.g[i]
    this.gl = state.gl
  }
}

/** What `Charsets.save` hands out and `Charsets.restore` takes back. */
export interface CharsetState {
  g: Charset[]
  gl: number
}
