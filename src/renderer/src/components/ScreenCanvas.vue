<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { blitRGB332, overlayCursor } from '@core/raster'
import { useTerminalStore } from '@/stores/terminal'

/**
 * The screen.
 *
 * v1 rebuilt the whole picture every frame: copy the framebuffer, stamp the
 * cursor into the copy, hand all 76,800 bytes to SDL, sleep, repeat — at 60Hz
 * whether or not a single byte had arrived. Cheap in C, not cheap across a
 * `putImageData`, and pointless besides: a terminal's screen is static almost
 * all the time.
 *
 * So this loop is driven by change instead. `Screen` already knows which
 * rectangle of its plane has moved since the last look, and that rectangle
 * (unioned with wherever the cursor is, or was) is the only region converted to
 * RGBA and the only region uploaded. A screen nobody is writing to costs one
 * cell twice a second for the cursor blink, and a screen nobody is even
 * blinking at costs nothing at all.
 *
 * The `ImageData` and its `Uint32Array` view are allocated once and reused.
 * Allocating 307,200 bytes sixty times a second is the obvious way to make a
 * canvas stutter.
 */

/** Cursor blink and `Attr.BLINK` alike, from v1's `cursorBlinkInterval`. */
const BLINK_INTERVAL_MS = 500

const store = useTerminalStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let image: ImageData | null = null
let raster: Uint32Array | null = null
let frameHandle = 0

// Where the cursor was last painted. The cell under it has to be repainted
// from the plane when it moves or blinks off, and the plane is the only place
// that still knows what was there — the overlay never went into it.
let cursorDrawn = false
let cursorCol = 0
let cursorRow = 0

let blinkOn = true
let blinkAt = 0

// The union of everything needing repaint this frame, in cells. Held here
// rather than rebuilt per frame so the loop allocates nothing at all.
// `maxCol < minCol` is the empty state.
let minCol = 0
let minRow = 0
let maxCol = -1
let maxRow = -1

function resetBounds(): void {
  minCol = 0
  minRow = 0
  maxCol = -1
  maxRow = -1
}

function includeCell(col: number, row: number): void {
  if (maxCol < minCol) {
    minCol = maxCol = col
    minRow = maxRow = row
    return
  }
  if (col < minCol) minCol = col
  if (col > maxCol) maxCol = col
  if (row < minRow) minRow = row
  if (row > maxRow) maxRow = row
}

/**
 * (Re)build the drawing context and the reusable raster.
 *
 * Called on mount and whenever the backing store changes size — which Vue does
 * for us by binding `width`/`height` to the store's geometry, and which wipes
 * the canvas, hence the `damageAll()`.
 */
function allocate(): void {
  const canvas = canvasRef.value
  if (!canvas) return

  // `alpha: false` — nothing behind this canvas is ever meant to show through,
  // and an opaque context skips the compositor's blend on every upload.
  ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  image = ctx.createImageData(canvas.width, canvas.height)
  raster = new Uint32Array(image.data.buffer)
  cursorDrawn = false
  resetBounds()
  store.vtac.screen.damageAll()
}

function frame(now: number): void {
  frameHandle = requestAnimationFrame(frame)
  if (!ctx || !image || !raster) return

  const vtac = store.vtac
  const screen = vtac.screen

  // One 500ms phase drives both blinks. v1 only ran the clock while the cursor
  // was in blinking mode; a free-running phase is indistinguishable on screen
  // and is also what `Attr.BLINK` cells need, which have no such mode.
  if (blinkAt === 0) blinkAt = now
  if (now - blinkAt >= BLINK_INTERVAL_MS) {
    blinkOn = !blinkOn
    blinkAt = now
  }
  screen.setBlink(blinkOn)

  // Bring the plane up to date with the cells, *then* ask what moved: damage
  // accrues when a cell is written, not when it is rendered.
  screen.rasterize()

  resetBounds()
  const damage = screen.takeDamage()
  if (damage !== null) {
    includeCell(damage.col, damage.row)
    includeCell(damage.col + damage.cols - 1, damage.row + damage.rows - 1)
  }

  const showCursor =
    vtac.cursorChar !== 0x00 && (vtac.cursorMode !== 'blinking' || blinkOn)

  // Repaint the old cursor cell when the cursor has left it or gone dark, and
  // the new one whenever it is lit — the raster there holds an overlay, not
  // screen content, so it has to be reconverted from the plane either way.
  if (cursorDrawn && (!showCursor || cursorCol !== vtac.column || cursorRow !== vtac.row)) {
    includeCell(cursorCol, cursorRow)
  }
  if (showCursor) includeCell(vtac.column, vtac.row)

  if (maxCol < minCol) return

  const x = minCol * 8
  const y = minRow * 8
  const width = (maxCol - minCol + 1) * 8
  const height = (maxRow - minRow + 1) * 8

  blitRGB332(screen.plane, raster, screen.width, x, y, width, height)

  if (showCursor) {
    overlayCursor(
      raster,
      screen.width,
      vtac.column,
      vtac.row,
      vtac.cursorChar,
      vtac.foregroundColor,
      vtac.backgroundColor
    )
    cursorDrawn = true
    cursorCol = vtac.column
    cursorRow = vtac.row
  } else {
    cursorDrawn = false
  }

  ctx.putImageData(image, 0, 0, x, y, width, height)
}

onMounted(() => {
  allocate()
  frameHandle = requestAnimationFrame(frame)
})

onUnmounted(() => {
  cancelAnimationFrame(frameHandle)
})

// A new instance or a column-mode switch (Phase 4) means a new backing store.
// `flush: 'post'` so the canvas attributes have already been updated.
watch(
  () => [store.vtac, store.width, store.height],
  () => allocate(),
  { flush: 'post' }
)
</script>

<template>
  <!--
    Two nested boxes, as in the EMULATOR:
    • .screen-outer  takes all the space above the control bar
    • .screen-glass  fills that height at 4:3, deriving its width; max-width
                     clamps it on narrow windows and aspect-ratio recomputes
                     the height to match

    The 4:3 is on the CSS box, not on the backing store — 40×30 and 80×60 are
    both 4:3, so an 80-column switch changes the resolution inside a screen of
    exactly the same size, which is what Phase 4 wants: finer, not bigger.
  -->
  <div class="screen-outer">
    <div class="screen-glass">
      <canvas ref="canvasRef" :width="store.width" :height="store.height" />
    </div>
  </div>
</template>

<style scoped>
.screen-outer {
  flex: 1;
  align-self: stretch;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  box-sizing: border-box;
}

.screen-glass {
  height: 100%;
  aspect-ratio: 4 / 3;
  max-width: 100%;
  /* The bezel edge: one hairline of enclosure around the glass (PLAN.md §2). */
  border: 1px solid var(--vt-trim);
  background: #000;
}

.screen-glass canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* Whole-pixel scaling. The glyphs are 8×8 and must stay 8×8. */
  image-rendering: pixelated;
}
</style>
