/**
 * The cell planes.
 *
 * v1 rasterized straight into a 320×240 byte buffer and forgot what it drew,
 * so nothing could answer "what character is at row 12, column 3?". Reverse
 * video, an alternate screen buffer and a column switch that preserves content
 * all need that answer, so the pixels become *derived* and the cells become
 * authoritative.
 *
 * Storage is structure-of-arrays, one entry per cell, row-major. Separate typed
 * arrays rather than an array of objects: `copyCell` and `scroll` then become
 * `copyWithin` on a few typed arrays instead of 64 pixel writes per cell.
 */

/** Pixels in one cell — the font is 8×8 and every geometry keeps it. */
export const CELL_PIXELS = 64

/**
 * The glyph a blank cell holds. CP437 0x20 (space) is all zeroes in
 * `Font.CHARACTERS`, so a blank cell rasterizes to a solid field of its
 * background — which is exactly what v1's `buffer.fill(backgroundColor)` did.
 */
export const BLANK_CODE = 0x20

/**
 * What a cell stores.
 *
 * Two kinds, because graphics mode demands it: v1 colours each 8-pixel *row*
 * with the fg/bg in effect when that row arrived, so rows within one cell can
 * differ and no glyph-plus-two-colours description can express it. A `Pixels`
 * cell therefore keeps its own rendered 8×8 block.
 */
export const CellKind = {
  /** A glyph index plus colours and attributes, rasterized on demand. */
  Text: 0,
  /** A literal 8×8 RGB332 block, held in the `pixels` plane. */
  Pixels: 1
} as const
export type CellKind = (typeof CellKind)[keyof typeof CellKind]

/**
 * Per-cell rendering attributes, as a bitfield.
 *
 * Native mode never sets any of these — v1 has no concept of them — so they are
 * inert until Phase 5's SGR handling starts writing them.
 */
export const Attr = {
  NONE: 0x00,
  BOLD: 0x01,
  UNDERLINE: 0x02,
  BLINK: 0x04,
  REVERSE: 0x08
} as const
export type Attr = (typeof Attr)[keyof typeof Attr]

/** The planes for one `cols × rows` screen. */
export interface CellPlanes {
  /** Number of cells, `cols * rows`. */
  readonly count: number
  /** `CellKind` per cell. */
  kind: Uint8Array
  /** Glyph index per cell, meaningful for `Text` cells. */
  codes: Uint8Array
  /** RGB332 foreground per cell. */
  fg: Uint8Array
  /** RGB332 background per cell. */
  bg: Uint8Array
  /** `Attr` bitfield per cell. */
  attrs: Uint8Array
  /** `count * 64` RGB332 pixels, meaningful for `Pixels` cells. */
  pixels: Uint8Array
  /** Per-cell "metadata changed, needs rasterizing" flag. */
  dirty: Uint8Array
}

/** Allocate a blank set of planes, every cell a space on `bg` in `fg`. */
export function allocateCellPlanes(
  cols: number,
  rows: number,
  fg = 0xff,
  bg = 0x00
): CellPlanes {
  const count = cols * rows
  const planes: CellPlanes = {
    count,
    kind: new Uint8Array(count),
    codes: new Uint8Array(count),
    fg: new Uint8Array(count),
    bg: new Uint8Array(count),
    attrs: new Uint8Array(count),
    pixels: new Uint8Array(count * CELL_PIXELS),
    dirty: new Uint8Array(count)
  }
  planes.codes.fill(BLANK_CODE)
  planes.fg.fill(fg)
  planes.bg.fill(bg)
  return planes
}

/** Reset one cell to a blank space on `bg` in `fg`. Does not touch `dirty`. */
export function blankCell(planes: CellPlanes, index: number, fg: number, bg: number): void {
  planes.kind[index] = CellKind.Text
  planes.codes[index] = BLANK_CODE
  planes.fg[index] = fg
  planes.bg[index] = bg
  planes.attrs[index] = Attr.NONE
}
