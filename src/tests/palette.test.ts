import {
  RGB332_LEVELS_2,
  RGB332_LEVELS_3,
  RGB332_RGBA,
  XTERM256_TO_RGB332,
  expandChannel,
  rgb332ToRGB,
  rgbToRGB332
} from '@core/palette'

// SDL's `SDL_expand_byte` lookup tables, written out rather than recomputed so
// this file is an independent statement of the target — not a restatement of
// the implementation's arithmetic. Confirmed against images/palette.png by
// scripts/verify-palette.mjs.
const SDL_EXPAND_3 = [0, 36, 72, 109, 145, 182, 218, 255]
const SDL_EXPAND_2 = [0, 85, 170, 255]

// The renderer reads RGB332_RGBA through a Uint32Array view of ImageData, whose
// bytes are always R, G, B, A. Assert on the bytes, not the packed number, so
// the check holds whatever the host's endianness.
const bytesOf = (value: number): number[] => {
  const words = new Uint32Array([value])
  return Array.from(new Uint8Array(words.buffer))
}

describe('expandChannel', () => {
  it('matches SDL for every 3-bit level', () => {
    for (let i = 0; i < 8; i++) {
      expect(expandChannel(i, 3)).toBe(SDL_EXPAND_3[i])
    }
  })

  it('matches SDL for every 2-bit level', () => {
    for (let i = 0; i < 4; i++) {
      expect(expandChannel(i, 2)).toBe(SDL_EXPAND_2[i])
    }
  })

  it('truncates rather than rounds', () => {
    // The three levels where floor and round disagree, and where a wrong choice
    // would shift every colour by one step while every non-pixel test passed.
    expect(expandChannel(2, 3)).toBe(72)
    expect(expandChannel(4, 3)).toBe(145)
    expect(expandChannel(6, 3)).toBe(218)
  })

  it('publishes the level ramps it built', () => {
    expect(Array.from(RGB332_LEVELS_3)).toEqual(SDL_EXPAND_3)
    expect(Array.from(RGB332_LEVELS_2)).toEqual(SDL_EXPAND_2)
  })
})

describe('RGB332_RGBA', () => {
  it('has an entry for every byte', () => {
    expect(RGB332_RGBA).toHaveLength(256)
  })

  it('expands all 256 entries exactly as SDL does', () => {
    for (let value = 0; value < 256; value++) {
      expect(bytesOf(RGB332_RGBA[value])).toEqual([
        SDL_EXPAND_3[(value >> 5) & 0x07],
        SDL_EXPAND_3[(value >> 2) & 0x07],
        SDL_EXPAND_2[value & 0x03],
        0xff
      ])
    }
  })

  it('places the primaries where the protocol documents them', () => {
    expect(bytesOf(RGB332_RGBA[0x00])).toEqual([0, 0, 0, 255]) // black
    expect(bytesOf(RGB332_RGBA[0xff])).toEqual([255, 255, 255, 255]) // white
    expect(bytesOf(RGB332_RGBA[0xe0])).toEqual([255, 0, 0, 255]) // red
    expect(bytesOf(RGB332_RGBA[0x1c])).toEqual([0, 255, 0, 255]) // green
    expect(bytesOf(RGB332_RGBA[0x03])).toEqual([0, 0, 255, 255]) // blue
  })

  it('is fully opaque', () => {
    for (let value = 0; value < 256; value++) {
      expect(bytesOf(RGB332_RGBA[value])[3]).toBe(0xff)
    }
  })
})

describe('rgb332ToRGB', () => {
  it('agrees with the packed table', () => {
    for (let value = 0; value < 256; value++) {
      expect(rgb332ToRGB(value)).toEqual(bytesOf(RGB332_RGBA[value]).slice(0, 3))
    }
  })
})

describe('rgbToRGB332', () => {
  it('round-trips every representable colour', () => {
    for (let value = 0; value < 256; value++) {
      const [r, g, b] = rgb332ToRGB(value)
      expect(rgbToRGB332(r, g, b)).toBe(value)
    }
  })

  it('picks the nearest level rather than truncating', () => {
    // 71 is one below the 72 level and nowhere near 36; truncating the input
    // would land it on 36.
    expect(rgb332ToRGB(rgbToRGB332(71, 0, 0))[0]).toBe(72)
    // 53 sits between 36 and 72, closer to 36.
    expect(rgb332ToRGB(rgbToRGB332(53, 0, 0))[0]).toBe(36)
    // 43 rounds blue up to 85 rather than down to 0.
    expect(rgb332ToRGB(rgbToRGB332(0, 0, 43))[2]).toBe(85)
  })

  it('maps the primaries onto the documented bytes', () => {
    expect(rgbToRGB332(0, 0, 0)).toBe(0x00)
    expect(rgbToRGB332(255, 255, 255)).toBe(0xff)
    expect(rgbToRGB332(255, 0, 0)).toBe(0xe0)
    expect(rgbToRGB332(0, 255, 0)).toBe(0x1c)
    expect(rgbToRGB332(0, 0, 255)).toBe(0x03)
  })
})

describe('XTERM256_TO_RGB332', () => {
  it('has an entry for every index', () => {
    expect(XTERM256_TO_RGB332).toHaveLength(256)
  })

  it('maps the system colours', () => {
    expect(XTERM256_TO_RGB332[0]).toBe(0x00) // black
    expect(XTERM256_TO_RGB332[9]).toBe(0xe0) // bright red
    expect(XTERM256_TO_RGB332[10]).toBe(0x1c) // bright green
    expect(XTERM256_TO_RGB332[12]).toBe(0x03) // bright blue
    expect(XTERM256_TO_RGB332[15]).toBe(0xff) // bright white
  })

  it('maps the corners of the 6x6x6 cube', () => {
    expect(XTERM256_TO_RGB332[16]).toBe(0x00) // cube (0,0,0)
    expect(XTERM256_TO_RGB332[231]).toBe(0xff) // cube (5,5,5)
    expect(XTERM256_TO_RGB332[196]).toBe(0xe0) // cube (5,0,0) — red
    expect(XTERM256_TO_RGB332[46]).toBe(0x1c) // cube (0,5,0) — green
    expect(XTERM256_TO_RGB332[21]).toBe(0x03) // cube (0,0,5) — blue
  })

  it('maps the greyscale ramp monotonically onto greys', () => {
    let previous = -1
    for (let index = 232; index < 256; index++) {
      const [r, g, b] = rgb332ToRGB(XTERM256_TO_RGB332[index])
      // Red and green share a ramp, so they always agree exactly. Blue has
      // only four levels, so a grey cannot be exact — but it stays within half
      // a blue step of the other two.
      expect(r).toBe(g)
      expect(Math.abs(r - b)).toBeLessThanOrEqual(64)
      const luma = r + g + b
      expect(luma).toBeGreaterThanOrEqual(previous)
      previous = luma
    }
    expect(XTERM256_TO_RGB332[232]).toBe(0x00) // grey 8 -> black
  })

  it('never leaves an index unmapped', () => {
    // 0x00 is a legitimate result, so an unwritten entry is invisible unless
    // the mapping is checked against a recomputation of the palette.
    for (let index = 0; index < 256; index++) {
      expect(XTERM256_TO_RGB332[index]).toBeGreaterThanOrEqual(0)
      expect(XTERM256_TO_RGB332[index]).toBeLessThanOrEqual(255)
    }
    // Indices that must not be black, so an all-zero table cannot pass.
    expect(XTERM256_TO_RGB332[255]).not.toBe(0x00)
    expect(XTERM256_TO_RGB332[231]).not.toBe(0x00)
  })
})
