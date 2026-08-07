/**
 * SGR — `CSI … m`, the sequence that sets how text looks.
 *
 * ## The 256-colour trap
 *
 * VT-AC has a 256-colour framebuffer and `SGR 38;5;n` is called "256-colour
 * mode", and the two have **nothing to do with each other**. `38;5;n` addresses
 * *xterm's* palette — 16 system colours, a 6×6×6 cube on a non-linear ramp, and
 * a 24-step grey — and lands on whichever RGB332 byte is nearest. It is a
 * quantization, and colours that differ in xterm can arrive identical here.
 *
 * The way to address VT-AC's palette directly is native mode's `0x18`/`0x19`,
 * where the operand byte *is* the RGB332 colour and nothing is approximated.
 * That distinction is the whole reason both personalities exist.
 *
 * ## What is implemented
 *
 * 0 reset, 1 bold, 4 underline, 5 blink, 7 reverse and their 22/24/25/27
 * cancels; 30–37/40–47 basic, 90–97/100–107 bright, 39/49 back to default, and
 * the 38/48 extended forms. Anything else — faint, italic, conceal, strike —
 * is ignored, because the rasterizer has no way to draw it on an 8×8 glyph.
 */

import { Attr } from '../Cell'
import { XTERM256_TO_RGB332, rgbToRGB332 } from '../palette'
import type { AnsiSequence } from './StateMachine'

/** Foreground with no SGR in force — VT-AC's power-on white. */
export const DEFAULT_FOREGROUND = 0xff

/** Background with no SGR in force — VT-AC's power-on black. */
export const DEFAULT_BACKGROUND = 0x00

/**
 * The three things SGR writes.
 *
 * An interface rather than a record because the foreground and background
 * belong to the `VTAC` both personalities share — erasing uses them, and so
 * does native mode — while the attributes belong to the VT-100 dispatch.
 * `Dispatch` implements this over both.
 */
export interface Pen {
  foreground: number
  background: number
  attrs: number
}

/** Back to plain default-coloured text. `SGR 0`, and every reset. */
export function resetPen(pen: Pen): void {
  pen.foreground = DEFAULT_FOREGROUND
  pen.background = DEFAULT_BACKGROUND
  pen.attrs = Attr.NONE
}

/**
 * Apply one `CSI … m` to a pen.
 *
 * Parameters are applied left to right and accumulate, so `CSI 0;1;31m` is a
 * reset followed by bold followed by red — which is how every application on
 * earth writes it.
 */
export function applySGR(seq: AnsiSequence, pen: Pen): void {
  // `CSI m` is `CSI 0 m`.
  if (seq.paramCount === 0) {
    resetPen(pen)
    return
  }

  for (let i = 0; i < seq.paramCount; i++) {
    const code = seq.param(i)

    if (code >= 30 && code <= 37) {
      pen.foreground = XTERM256_TO_RGB332[code - 30]
      continue
    }
    if (code >= 40 && code <= 47) {
      pen.background = XTERM256_TO_RGB332[code - 40]
      continue
    }
    if (code >= 90 && code <= 97) {
      pen.foreground = XTERM256_TO_RGB332[code - 90 + 8]
      continue
    }
    if (code >= 100 && code <= 107) {
      pen.background = XTERM256_TO_RGB332[code - 100 + 8]
      continue
    }

    switch (code) {
      case 0:
        resetPen(pen)
        break
      case 1:
        pen.attrs |= Attr.BOLD
        break
      case 4:
        pen.attrs |= Attr.UNDERLINE
        break
      case 5:
        pen.attrs |= Attr.BLINK
        break
      case 7:
        pen.attrs |= Attr.REVERSE
        break
      case 22:
        pen.attrs &= ~Attr.BOLD
        break
      case 24:
        pen.attrs &= ~Attr.UNDERLINE
        break
      case 25:
        pen.attrs &= ~Attr.BLINK
        break
      case 27:
        pen.attrs &= ~Attr.REVERSE
        break
      case 38:
        i = extendedColour(seq, i, pen, true)
        break
      case 39:
        pen.foreground = DEFAULT_FOREGROUND
        break
      case 48:
        i = extendedColour(seq, i, pen, false)
        break
      case 49:
        pen.background = DEFAULT_BACKGROUND
        break
    }
  }
}

/**
 * `38`/`48` and the parameters they swallow — returns the last index consumed.
 *
 * Two forms, both semicolon-separated: `5;n` for an xterm-256 index and
 * `2;r;g;b` for truecolour. The colon-separated spellings (`38:2::r:g:b`) never
 * reach here — the published parser table routes a colon to `csi ignore`, which
 * is noted where that decision is made.
 *
 * A malformed or truncated form swallows the **rest of the sequence** rather
 * than falling back to reading its parameters as attributes. `CSI 38;9;1;31m`
 * has already lost its meaning; turning its tail into bold red would be a
 * guess, and a visible one.
 */
function extendedColour(
  seq: AnsiSequence,
  index: number,
  pen: Pen,
  foreground: boolean
): number {
  const selector = seq.param(index + 1)

  if (selector === 5) {
    if (index + 2 >= seq.paramCount) return seq.paramCount
    const colour = seq.param(index + 2)
    // Out of range is ignored rather than clamped: landing on white because a
    // host sent 300 would be a silently wrong colour.
    if (colour <= 255) setColour(pen, foreground, XTERM256_TO_RGB332[colour])
    return index + 2
  }

  if (selector === 2) {
    if (index + 4 >= seq.paramCount) return seq.paramCount
    setColour(
      pen,
      foreground,
      rgbToRGB332(seq.param(index + 2), seq.param(index + 3), seq.param(index + 4))
    )
    return index + 4
  }

  return seq.paramCount
}

function setColour(pen: Pen, foreground: boolean, value: number): void {
  if (foreground) pen.foreground = value
  else pen.background = value
}
