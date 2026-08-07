/**
 * Colour, extracted from the SDL host.
 *
 * v1 never converted anything: it handed SDL a raw RGB332 byte buffer and let
 * SDL expand it. v2 renders to a `<canvas>`, so the expansion has to live here
 * — and it has to be *SDL's* expansion, or every colour shifts slightly while
 * every non-pixel test still passes. That is the Phase 1 risk, and
 * `images/palette.png` is the ground truth that settles it.
 *
 * SDL expands a partial byte with `SDL_expand_byte`, a lookup table generated
 * by **truncating** division:
 *
 *     3 bits → 0, 36, 72, 109, 145, 182, 218, 255      floor(i * 255 / 7)
 *     2 bits → 0, 85, 170, 255                          floor(i * 255 / 3)
 *
 * Note this is `floor`, not `round` — they differ at 3-bit levels 2, 4 and 6
 * (72/73, 145/146, 218/219). `scripts/verify-palette.mjs` checks the committed
 * screenshot against both and the truncating form wins on every ramp value:
 *
 *     level   0    1    2    3    4    5    6    7
 *     floor   0   36   72  109  145  182  218  255   ← matches palette.png
 *     round   0   36   73  109  146  182  219  255
 *
 * (PLAN.md §Phase 1 specifies `round`. It is wrong; this file follows the
 * screenshot, which the plan itself names as ground truth.)
 */

/** Expand an `bits`-wide channel value to the full 0–255 range, as SDL does. */
export function expandChannel(value: number, bits: number): number {
  const max = (1 << bits) - 1
  return Math.floor((value * 255) / max)
}

/** The eight red/green levels an RGB332 byte can express. */
export const RGB332_LEVELS_3 = Uint8Array.from({ length: 8 }, (_, i) => expandChannel(i, 3))

/** The four blue levels an RGB332 byte can express. */
export const RGB332_LEVELS_2 = Uint8Array.from({ length: 4 }, (_, i) => expandChannel(i, 2))

/** Split an RGB332 byte into its 8-bit components. */
export function rgb332ToRGB(value: number): [number, number, number] {
  return [
    RGB332_LEVELS_3[(value >> 5) & 0x07],
    RGB332_LEVELS_3[(value >> 2) & 0x07],
    RGB332_LEVELS_2[value & 0x03]
  ]
}

// Canvas `ImageData` is always RGBA in byte order. The renderer writes whole
// pixels through a Uint32Array view of it, which means the packing has to match
// the host's endianness — little on every platform this ships to, but the check
// costs one comparison at module load and removes the caveat.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04

/**
 * RGB332 → a 32-bit pixel ready to write into `ImageData`, alpha forced opaque.
 *
 * Indexed by the RGB332 byte, so the renderer's hot loop is a table lookup:
 * `out[i] = RGB332_RGBA[buffer[i]]`.
 */
export const RGB332_RGBA = new Uint32Array(256)

for (let value = 0; value < 256; value++) {
  const [r, g, b] = rgb332ToRGB(value)
  RGB332_RGBA[value] = LITTLE_ENDIAN
    ? ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
}

/** Nearest representable level index for one channel of an 8-bit colour. */
function quantizeChannel(value: number, levels: Uint8Array): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < levels.length; i++) {
    const distance = Math.abs(levels[i] - value)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/**
 * 24-bit colour → the nearest RGB332 byte, for `SGR 38;2;r;g;b` truecolour.
 *
 * RGB332's channels are independent, so choosing each channel's nearest level
 * independently *is* the nearest colour under any per-channel-separable metric,
 * Euclidean included — no search over 256 candidates required.
 */
export function rgbToRGB332(r: number, g: number, b: number): number {
  return (
    (quantizeChannel(r, RGB332_LEVELS_3) << 5) |
    (quantizeChannel(g, RGB332_LEVELS_3) << 2) |
    quantizeChannel(b, RGB332_LEVELS_2)
  )
}

/**
 * One step brighter, per channel — how the rasterizer renders `Attr.BOLD`.
 *
 * A VT100 rendered bold as extra beam intensity, which on an RGB332 framebuffer
 * has one honest analogue: raise each channel to the next representable level.
 * Channels already at maximum stay put, so bold on white is white rather than
 * wrapping to black.
 */
export function brightenRGB332(value: number): number {
  const r = Math.min(((value >> 5) & 0x07) + 1, 0x07)
  const g = Math.min(((value >> 2) & 0x07) + 1, 0x07)
  const b = Math.min((value & 0x03) + 1, 0x03)
  return (r << 5) | (g << 2) | b
}

/** The xterm 256-colour palette, as 24-bit RGB. */
function xterm256RGB(index: number): [number, number, number] {
  // 0–15: the ANSI system colours, at xterm's default intensities.
  const SYSTEM: ReadonlyArray<[number, number, number]> = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255]
  ]
  if (index < 16) return SYSTEM[index]

  // 16–231: a 6×6×6 cube on xterm's non-linear level ramp.
  if (index < 232) {
    const CUBE = [0, 95, 135, 175, 215, 255]
    const n = index - 16
    return [CUBE[Math.floor(n / 36) % 6], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]]
  }

  // 232–255: the 24-step greyscale ramp.
  const grey = 8 + (index - 232) * 10
  return [grey, grey, grey]
}

/**
 * xterm-256 index → RGB332, for `SGR 38;5;n` / `48;5;n` (Phase 5).
 *
 * Worth being clear about, because it is a trap: "256 colours, and VT-AC has
 * 256 colours" is a coincidence, not a correspondence. `38;5;n` addresses
 * *xterm's* palette and lands on whichever RGB332 byte is nearest; the native
 * `0x18`/`0x19` commands are the way to address VT-AC's palette directly.
 */
export const XTERM256_TO_RGB332 = new Uint8Array(256)

for (let index = 0; index < 256; index++) {
  const [r, g, b] = xterm256RGB(index)
  XTERM256_TO_RGB332[index] = rgbToRGB332(r, g, b)
}
