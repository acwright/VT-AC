/**
 * RGB332 plane → canvas pixels.
 *
 * The last thing SDL did for v1 that v2 has to do itself. `window.render(...,
 * 'rgb332', buffer)` expanded the framebuffer on the way to the screen;
 * `putImageData` takes RGBA, so the expansion happens here, through the table
 * `palette.ts` built to SDL's own formula.
 *
 * Both functions are deliberately plain — no DOM types, no allocation, indices
 * computed rather than derived from an object — so they run under the node-based
 * Jest project and so the renderer's per-frame path stays a table lookup per
 * pixel. Everything else about the frame (what changed, what to upload) is the
 * canvas component's business.
 */

import { CHARACTERS } from './Font'
import { RGB332_RGBA } from './palette'

/**
 * Convert a rectangle of an RGB332 plane into 32-bit RGBA pixels.
 *
 * `out` is a `Uint32Array` view of an `ImageData`'s bytes and shares the plane's
 * geometry, so one index addresses both; `stride` is the width of each in
 * pixels. Only the named rectangle is touched — everything outside it keeps the
 * pixels it already had, which is what makes a static screen free.
 */
export function blitRGB332(
  plane: Uint8Array,
  out: Uint32Array,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  for (let row = 0; row < height; row++) {
    let i = (y + row) * stride + x
    const end = i + width
    for (; i < end; i++) out[i] = RGB332_RGBA[plane[i]]
  }
}

/**
 * Draw the cursor over one cell, colours inverted — v1's `drawCursor`
 * (`src/index.ts:268-285`), writing RGBA instead of RGB332.
 *
 * "Inverted" is literal and is the whole of the cursor's appearance: a set bit
 * in the glyph takes the *background* colour and a clear bit takes the
 * *foreground*. So a glyph of mostly clear pixels comes out as mostly solid
 * rectangle — a space inverts to a filled block, and the character already in
 * the cell inverts to that same block with the character punched out of it,
 * which is what a VT100's cursor looks like.
 *
 * The corollary is worth stating because it is the obvious mistake: passing
 * CP437's *full block* `0xDB` inverts to a rectangle of pure background, which
 * is to say an invisible cursor.
 *
 * This paints into the raster only, never into the plane. The cursor is not
 * screen content — nothing can read it back, a scroll must not carry it along,
 * and the cell underneath has to be recoverable the moment the cursor blinks
 * off or moves, which it is: the plane still holds it.
 */
export function overlayCursor(
  out: Uint32Array,
  stride: number,
  col: number,
  row: number,
  code: number,
  fg: number,
  bg: number
): void {
  const glyph = CHARACTERS[code & 0xff]
  const set = RGB332_RGBA[bg]
  const clear = RGB332_RGBA[fg]
  const left = col * 8

  for (let y = 0; y < 8; y++) {
    const bits = glyph[y]
    const base = (row * 8 + y) * stride + left
    for (let x = 0; x < 8; x++) {
      out[base + x] = ((bits >> (7 - x)) & 1) === 1 ? set : clear
    }
  }
}
