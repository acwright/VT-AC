import { Attr, BLANK_CODE, CELL_PIXELS, CellKind, allocateCellPlanes, blankCell } from './Cell'
import { CHARACTERS } from './Font'
import { brightenRGB332 } from './palette'

/** A rectangle of cells, as returned by `takeDamage()`. */
export interface CellRect {
  col: number
  row: number
  cols: number
  rows: number
}

/**
 * The screen: cell planes, the RGB332 framebuffer they rasterize into, and
 * every operation v1 performed directly on that framebuffer.
 *
 * ## The two stores, and which one wins
 *
 * `plane` is the framebuffer — `width * height` RGB332 bytes, exactly the buffer
 * v1 handed to SDL and exactly what `VTAC.buffer` still exposes. The cell planes
 * are the description that produces it.
 *
 * A cell is marked **dirty** when its description changes; `rasterize()` renders
 * dirty cells into `plane` and clears the flags. Clean cells are never
 * re-rendered, which is what lets `plane` be written to directly — `VTAC.test.ts`
 * pokes pixels into `vtac.buffer` and expects `scroll` and `copyCharacterCell`
 * to move them — and have those writes survive. Operations that relocate a cell
 * therefore move its pixels as well as its description.
 *
 * ## Damage
 *
 * `dirty` answers "which cells has the rasterizer not caught up with"; damage
 * answers "which part of `plane` has changed since the renderer last looked".
 * They differ: a scroll moves pixels for cells that were never dirty. The canvas
 * renderer uses `takeDamage()` to bound its `putImageData`. Writes made straight
 * into `plane` from outside are invisible to damage tracking, by construction.
 */
export class Screen {
  /**
   * Cells across.
   *
   * Not `readonly`: `resize()` is how 80-column mode happens, and it is the
   * only thing that writes this or any of the four below.
   */
  cols!: number
  /** Cells down. */
  rows!: number
  /** Framebuffer width in pixels, `cols * 8`. */
  width!: number
  /** Framebuffer height in pixels, `rows * 8`. */
  height!: number
  /** Number of cells, `cols * rows`. Makes a `Screen` usable as `CellPlanes`. */
  count!: number

  /** `CellKind` per cell. */
  kind!: Uint8Array
  /** Glyph index per cell. */
  codes!: Uint8Array
  /** RGB332 foreground per cell. */
  fg!: Uint8Array
  /** RGB332 background per cell. */
  bg!: Uint8Array
  /** `Attr` bitfield per cell. */
  attrs!: Uint8Array
  /** `count * 64` RGB332 pixels, for `Pixels` cells. */
  pixels!: Uint8Array
  /** Per-cell "needs rasterizing" flag. */
  dirty!: Uint8Array

  /** The RGB332 framebuffer. Row-major, `width * height` bytes. */
  plane!: Uint8Array

  /** Phase of the 500ms blink clock. `false` hides `Attr.BLINK` cells. */
  blinkOn = true

  private dirtyCount = 0

  private damageMinCol = 0
  private damageMinRow = 0
  private damageMaxCol = -1
  private damageMaxRow = -1

  /** Scratch row used while rasterizing a text cell; avoids per-glyph allocation. */
  private readonly scratch = new Uint8Array(8)

  constructor(cols = 40, rows = 30, fg = 0xff, bg = 0x00) {
    this.resize(cols, rows, fg, bg)

    // The planes start blank and the framebuffer starts filled to match, so
    // nothing is dirty and nothing is damaged: a screen nobody has written to
    // costs the renderer nothing. `resize` damages everything, which is right
    // for a mode switch and wrong for a screen that has never been shown.
    this.takeDamage()
  }

  /**
   * Change the geometry, discarding everything on screen.
   *
   * Every plane is reallocated at the new size and the framebuffer with them,
   * so nothing stale survives a switch and `VTAC.buffer` hands back a view of
   * the right length. Content is *not* carried over: that is DECCOLM's
   * behaviour on real hardware, and it avoids inventing a reflow policy no VT
   * ever had. The whole screen is left damaged, since the renderer's backing
   * store has to be rebuilt at the new size anyway.
   */
  resize(cols: number, rows: number, fg = 0xff, bg = 0x00): void {
    this.cols = cols
    this.rows = rows
    this.width = cols * 8
    this.height = rows * 8
    this.count = cols * rows

    const planes = allocateCellPlanes(cols, rows, fg, bg)
    this.kind = planes.kind
    this.codes = planes.codes
    this.fg = planes.fg
    this.bg = planes.bg
    this.attrs = planes.attrs
    this.pixels = planes.pixels
    this.dirty = planes.dirty

    this.plane = new Uint8Array(this.width * this.height).fill(bg)
    this.dirtyCount = 0
    this.damageAll()
  }

  /** Cell index for a column/row pair. */
  index(col: number, row: number): number {
    return row * this.cols + col
  }

  /** Whether a column/row pair addresses a cell on this screen. */
  contains(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  //
  // WRITING
  //

  /** Put a glyph in a cell, replacing whatever was there. */
  putGlyph(
    col: number,
    row: number,
    code: number,
    fg: number,
    bg: number,
    attrs: number = Attr.NONE
  ): void {
    if (!this.contains(col, row)) return
    const i = this.index(col, row)
    this.kind[i] = CellKind.Text
    this.codes[i] = code & 0xff
    this.fg[i] = fg
    this.bg[i] = bg
    this.attrs[i] = attrs
    this.markDirty(i, col, row)
  }

  /**
   * Write one 8-pixel row of graphics data into a cell.
   *
   * `offset` is the row within the cell, 0–7. Bit 7 of `data` is the leftmost
   * pixel. Rows the stream has not written keep whatever the cell showed before
   * — v1's behaviour, since it wrote into a framebuffer that already held the
   * previous content — so a cell that was text is first materialized into its
   * pixel block, then overwritten a row at a time.
   */
  putPixelRow(
    col: number,
    row: number,
    offset: number,
    data: number,
    fg: number,
    bg: number
  ): void {
    if (!this.contains(col, row)) return
    if (offset < 0 || offset > 7) return

    const i = this.index(col, row)
    if (this.kind[i] !== CellKind.Pixels) {
      this.materialize(i, col, row)
    }

    const base = i * CELL_PIXELS + offset * 8
    for (let x = 0; x < 8; x++) {
      this.pixels[base + x] = ((data >> (7 - x)) & 1) === 1 ? fg : bg
    }
    this.fg[i] = fg
    this.bg[i] = bg
    this.markDirty(i, col, row)
  }

  /** Blank a cell to `bg`, as v1's `clearCharacterCell` did. */
  clearCell(col: number, row: number, fg: number, bg: number): void {
    if (!this.contains(col, row)) return
    const i = this.index(col, row)
    blankCell(this, i, fg, bg)
    this.markDirty(i, col, row)
  }

  /**
   * Copy one cell over another — description, pixel block and rendered pixels
   * alike. The rendered pixels travel too so that anything written straight
   * into `plane` moves with the cell, which is what v1 did by construction.
   */
  copyCell(sourceCol: number, sourceRow: number, destCol: number, destRow: number): void {
    if (!this.contains(sourceCol, sourceRow) || !this.contains(destCol, destRow)) return
    if (sourceCol === destCol && sourceRow === destRow) return

    const s = this.index(sourceCol, sourceRow)
    const d = this.index(destCol, destRow)

    this.kind[d] = this.kind[s]
    this.codes[d] = this.codes[s]
    this.fg[d] = this.fg[s]
    this.bg[d] = this.bg[s]
    this.attrs[d] = this.attrs[s]
    this.pixels.copyWithin(d * CELL_PIXELS, s * CELL_PIXELS, (s + 1) * CELL_PIXELS)

    for (let y = 0; y < 8; y++) {
      const from = (sourceRow * 8 + y) * this.width + sourceCol * 8
      const to = (destRow * 8 + y) * this.width + destCol * 8
      this.plane.copyWithin(to, from, from + 8)
    }

    // If the source has not been rasterized yet the pixels just copied are
    // stale, but the description came with them — so re-render the destination
    // too and both land on the same result.
    if (this.dirty[s] === 1) {
      this.markDirty(d, destCol, destRow)
    } else {
      this.clearDirty(d)
      this.markDamage(destCol, destRow)
    }
  }

  /** Blank every cell to `bg`. v1's `0x0C` and the tail of `reset()`. */
  clear(fg: number, bg: number): void {
    this.kind.fill(CellKind.Text)
    this.codes.fill(BLANK_CODE)
    this.fg.fill(fg)
    this.bg.fill(bg)
    this.attrs.fill(Attr.NONE)
    this.dirty.fill(0)
    this.dirtyCount = 0
    this.plane.fill(bg)
    this.damageAll()
  }

  /**
   * Clear a run of cells, v1's four `deleteTo` destinations.
   *
   * The ranges are v1's exactly, including that `startOfLine` and
   * `startOfScreen` clear the cursor cell itself.
   */
  deleteTo(
    destination: 'startOfLine' | 'endOfLine' | 'startOfScreen' | 'endOfScreen',
    col: number,
    row: number,
    fg: number,
    bg: number
  ): void {
    switch (destination) {
      case 'startOfLine':
        for (let c = 0; c <= col; c++) this.clearCell(c, row, fg, bg)
        break
      case 'endOfLine':
        for (let c = col; c < this.cols; c++) this.clearCell(c, row, fg, bg)
        break
      case 'startOfScreen':
        for (let r = 0; r < row; r++) {
          for (let c = 0; c < this.cols; c++) this.clearCell(c, r, fg, bg)
        }
        for (let c = 0; c <= col; c++) this.clearCell(c, row, fg, bg)
        break
      case 'endOfScreen':
        for (let c = col; c < this.cols; c++) this.clearCell(c, row, fg, bg)
        for (let r = row + 1; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) this.clearCell(c, r, fg, bg)
        }
        break
    }
  }

  /**
   * Shift the whole screen one cell, filling the vacated edge with `bg`.
   *
   * v1's four scroll commands, each now the whole-screen, one-line case of a
   * region operation below. Expressing them that way rather than keeping a
   * second implementation is what stops the two drifting: the plan calls scroll
   * regions crossed with IL/DL "where off-by-one errors hide", and there is no
   * crossing to get wrong if there is only one piece of code.
   */
  scroll(direction: 'left' | 'right' | 'up' | 'down', fg: number, bg: number): void {
    switch (direction) {
      case 'up':
        this.scrollUp(0, this.rows - 1, 1, fg, bg)
        break
      case 'down':
        this.scrollDown(0, this.rows - 1, 1, fg, bg)
        break
      case 'left':
        for (let row = 0; row < this.rows; row++) this.deleteChars(0, row, 1, fg, bg)
        break
      case 'right':
        for (let row = 0; row < this.rows; row++) this.insertChars(0, row, 1, fg, bg)
        break
    }
  }

  //
  // REGIONS AND EDITING
  //
  // What VT-100 mode needs and native mode has no word for. Every one of these
  // takes its bounds as arguments rather than reading a margin off the screen:
  // a scroll region is protocol state, it belongs to the personality that has
  // the concept, and `Screen` stays a store. It also means the alternate screen
  // is still nothing more than a second `Screen`.
  //
  // Rows and columns outside the screen are clamped rather than rejected, which
  // is what real hardware does with a `DECSTBM 1;99` on a 30-row terminal.
  //

  /**
   * Move rows `top`–`bottom` up by `count`, blanking the rows exposed at the
   * bottom of the region.
   *
   * The engine behind LF and IND at the bottom margin, `CSI S` (SU), and — with
   * the cursor row standing in for `top` — DL.
   */
  scrollUp(top: number, bottom: number, count: number, fg: number, bg: number): void {
    const first = Math.max(0, top)
    const last = Math.min(this.rows - 1, bottom)
    if (first > last || count <= 0) return

    const { cols } = this
    const n = Math.min(count, last - first + 1)
    const kept = last - first + 1 - n

    if (kept > 0) {
      this.moveCells(first * cols, (first + n) * cols, kept * cols)
      const stride = this.width * 8
      this.plane.copyWithin(first * stride, (first + n) * stride, (last + 1) * stride)
    }

    for (let row = last - n + 1; row <= last; row++) {
      for (let col = 0; col < cols; col++) this.clearCell(col, row, fg, bg)
    }

    this.markDamage(0, first)
    this.markDamage(cols - 1, last)
  }

  /**
   * Move rows `top`–`bottom` down by `count`, blanking the rows exposed at the
   * top of the region.
   *
   * The engine behind RI at the top margin, `CSI T` (SD), and — with the cursor
   * row standing in for `top` — IL.
   */
  scrollDown(top: number, bottom: number, count: number, fg: number, bg: number): void {
    const first = Math.max(0, top)
    const last = Math.min(this.rows - 1, bottom)
    if (first > last || count <= 0) return

    const { cols } = this
    const n = Math.min(count, last - first + 1)
    const kept = last - first + 1 - n

    if (kept > 0) {
      this.moveCells((first + n) * cols, first * cols, kept * cols)
      const stride = this.width * 8
      this.plane.copyWithin((first + n) * stride, first * stride, (first + kept) * stride)
    }

    for (let row = first; row < first + n; row++) {
      for (let col = 0; col < cols; col++) this.clearCell(col, row, fg, bg)
    }

    this.markDamage(0, first)
    this.markDamage(cols - 1, last)
  }

  /**
   * ICH — open `count` blank cells at `col`, pushing the rest of the row right.
   *
   * Cells pushed past the last column are gone; nothing wraps onto the next
   * row. That is the VT102 behaviour and the reason a terminal can insert into
   * the middle of a line without disturbing anything below it.
   */
  insertChars(col: number, row: number, count: number, fg: number, bg: number): void {
    if (!this.contains(col, row) || count <= 0) return

    const { cols } = this
    const n = Math.min(count, cols - col)
    const kept = cols - col - n

    if (kept > 0) {
      const base = row * cols
      this.moveCells(base + col + n, base + col, kept)
      for (let y = 0; y < 8; y++) {
        const line = (row * 8 + y) * this.width
        this.plane.copyWithin(line + (col + n) * 8, line + col * 8, line + (col + kept) * 8)
      }
    }

    for (let c = col; c < col + n; c++) this.clearCell(c, row, fg, bg)

    this.markDamage(col, row)
    this.markDamage(cols - 1, row)
  }

  /**
   * DCH — remove `count` cells at `col`, pulling the rest of the row left and
   * blanking the cells exposed at the right-hand edge.
   */
  deleteChars(col: number, row: number, count: number, fg: number, bg: number): void {
    if (!this.contains(col, row) || count <= 0) return

    const { cols } = this
    const n = Math.min(count, cols - col)
    const kept = cols - col - n

    if (kept > 0) {
      const base = row * cols
      this.moveCells(base + col, base + col + n, kept)
      for (let y = 0; y < 8; y++) {
        const line = (row * 8 + y) * this.width
        this.plane.copyWithin(line + col * 8, line + (col + n) * 8, line + cols * 8)
      }
    }

    for (let c = cols - n; c < cols; c++) this.clearCell(c, row, fg, bg)

    this.markDamage(col, row)
    this.markDamage(cols - 1, row)
  }

  /**
   * ECH — blank `count` cells at `col` where they stand.
   *
   * Nothing shifts, which is the whole difference from DCH: the row keeps its
   * length and everything to the right of the run stays where it is.
   */
  eraseChars(col: number, row: number, count: number, fg: number, bg: number): void {
    if (count <= 0) return
    const end = Math.min(col + count, this.cols)
    for (let c = Math.max(0, col); c < end; c++) this.clearCell(c, row, fg, bg)
  }

  /** Reset to a blank screen: white on black, nothing dirty, all damaged. */
  reset(): void {
    this.clear(0xff, 0x00)
  }

  //
  // RASTERIZING
  //

  /** Whether any cell is waiting to be rendered into `plane`. */
  get hasDirtyCells(): boolean {
    return this.dirtyCount > 0
  }

  /** Render every dirty cell into `plane`. */
  rasterize(): void {
    if (this.dirtyCount === 0) return
    for (let i = 0; i < this.dirty.length && this.dirtyCount > 0; i++) {
      if (this.dirty[i] === 1) this.rasterizeCell(i)
    }
  }

  /**
   * Set the blink phase, dirtying the cells it changes the appearance of.
   *
   * Nothing sets `Attr.BLINK` in native mode, so this is free until Phase 5.
   */
  setBlink(on: boolean): void {
    if (this.blinkOn === on) return
    this.blinkOn = on
    for (let i = 0; i < this.attrs.length; i++) {
      if ((this.attrs[i] & Attr.BLINK) !== 0) {
        this.markDirty(i, i % this.cols, Math.floor(i / this.cols))
      }
    }
  }

  /**
   * The region of `plane` that has changed since the last call, in cells, or
   * `null` if nothing has. Resets the accumulated damage.
   */
  takeDamage(): CellRect | null {
    if (this.damageMaxCol < this.damageMinCol || this.damageMaxRow < this.damageMinRow) {
      return null
    }
    const rect: CellRect = {
      col: this.damageMinCol,
      row: this.damageMinRow,
      cols: this.damageMaxCol - this.damageMinCol + 1,
      rows: this.damageMaxRow - this.damageMinRow + 1
    }
    this.damageMinCol = 0
    this.damageMinRow = 0
    this.damageMaxCol = -1
    this.damageMaxRow = -1
    return rect
  }

  /** Mark the whole screen as changed — after a resize, or a lost context. */
  damageAll(): void {
    this.damageMinCol = 0
    this.damageMinRow = 0
    this.damageMaxCol = this.cols - 1
    this.damageMaxRow = this.rows - 1
  }

  //
  // INTERNALS
  //

  /**
   * Turn a `Text` cell into a `Pixels` cell holding what it currently shows.
   *
   * The rendered pixels are the honest source: they carry anything written
   * straight into `plane`, which the description does not know about.
   */
  private materialize(i: number, col: number, row: number): void {
    if (this.dirty[i] === 1) this.rasterizeCell(i)

    const base = i * CELL_PIXELS
    for (let y = 0; y < 8; y++) {
      const from = (row * 8 + y) * this.width + col * 8
      for (let x = 0; x < 8; x++) {
        this.pixels[base + y * 8 + x] = this.plane[from + x]
      }
    }
    this.kind[i] = CellKind.Pixels
  }

  /** Render one cell into `plane` and clear its dirty flag. */
  private rasterizeCell(i: number): void {
    const col = i % this.cols
    const row = (i - col) / this.cols
    const top = row * 8 * this.width + col * 8

    if (this.kind[i] === CellKind.Pixels) {
      const base = i * CELL_PIXELS
      for (let y = 0; y < 8; y++) {
        this.plane.set(this.pixels.subarray(base + y * 8, base + y * 8 + 8), top + y * this.width)
      }
      this.clearDirty(i)
      return
    }

    const attrs = this.attrs[i]
    let fg = this.fg[i]
    let bg = this.bg[i]

    if ((attrs & Attr.BOLD) !== 0) fg = brightenRGB332(fg)
    if ((attrs & Attr.REVERSE) !== 0) {
      const swap = fg
      fg = bg
      bg = swap
    }

    // A blinking cell in the dark half of the clock shows nothing at all —
    // glyph and underline both — which is how a VT100's blink looked.
    const hidden = (attrs & Attr.BLINK) !== 0 && !this.blinkOn
    const glyph = CHARACTERS[this.codes[i]]
    const underline = (attrs & Attr.UNDERLINE) !== 0

    for (let y = 0; y < 8; y++) {
      let bits = hidden ? 0x00 : glyph[y]
      if (underline && !hidden && y === 7) bits = 0xff

      for (let x = 0; x < 8; x++) {
        this.scratch[x] = ((bits >> (7 - x)) & 1) === 1 ? fg : bg
      }
      this.plane.set(this.scratch, top + y * this.width)
    }

    this.clearDirty(i)
  }

  private markDirty(i: number, col: number, row: number): void {
    if (this.dirty[i] === 0) {
      this.dirty[i] = 1
      this.dirtyCount++
    }
    this.markDamage(col, row)
  }

  private clearDirty(i: number): void {
    if (this.dirty[i] === 1) {
      this.dirty[i] = 0
      this.dirtyCount--
    }
  }

  private markDamage(col: number, row: number): void {
    if (this.damageMaxCol < this.damageMinCol) {
      this.damageMinCol = col
      this.damageMaxCol = col
      this.damageMinRow = row
      this.damageMaxRow = row
      return
    }
    if (col < this.damageMinCol) this.damageMinCol = col
    if (col > this.damageMaxCol) this.damageMaxCol = col
    if (row < this.damageMinRow) this.damageMinRow = row
    if (row > this.damageMaxRow) this.damageMaxRow = row
  }

  /**
   * Move a run of `length` cells from `from` to `to`, planes and all.
   *
   * The one place cells relocate, and the reason the structure-of-arrays layout
   * was worth it: seven `copyWithin` calls move any number of cells, where v1
   * wrote 64 pixels per cell by hand. `copyWithin` handles overlap in either
   * direction, so a scroll up, a scroll down, an insert and a delete are all
   * this same call with different arguments.
   *
   * `dirtyCount` is adjusted across the destination span rather than recounted
   * over the whole screen — the flags being moved are the only ones that
   * change, and this is already an O(length) operation.
   */
  private moveCells(to: number, from: number, length: number): void {
    for (let i = to; i < to + length; i++) this.dirtyCount -= this.dirty[i]

    this.kind.copyWithin(to, from, from + length)
    this.codes.copyWithin(to, from, from + length)
    this.fg.copyWithin(to, from, from + length)
    this.bg.copyWithin(to, from, from + length)
    this.attrs.copyWithin(to, from, from + length)
    this.dirty.copyWithin(to, from, from + length)
    this.pixels.copyWithin(to * CELL_PIXELS, from * CELL_PIXELS, (from + length) * CELL_PIXELS)

    for (let i = to; i < to + length; i++) this.dirtyCount += this.dirty[i]
  }
}
