/**
 * The keyboard in VT-100 mode.
 *
 * Native mode's table is v1's and is covered by `keymap.test.ts`; what matters
 * here is that the same keypress produces different bytes in the two
 * personalities, and that the mode flags the host sets actually reach it.
 */

import { VTAC } from '@core/VTAC'
import { keyToBytes } from '@core/keymap'
import type { KeyEvent, KeyModes } from '@core/keymap'

/** The bytes a key produces in VT-100 mode, as readable text. */
function press(event: KeyEvent, modes: KeyModes = {}): string | null {
  const bytes = keyToBytes(event, 'vt100', modes)
  return bytes === null ? null : String.fromCharCode(...bytes)
}

/** The same, in native mode. */
function pressNative(event: KeyEvent): string | null {
  const bytes = keyToBytes(event, 'native')
  return bytes === null ? null : String.fromCharCode(...bytes)
}

describe('cursor keys', () => {
  it.each([
    ['ArrowUp', 'A'],
    ['ArrowDown', 'B'],
    ['ArrowRight', 'C'],
    ['ArrowLeft', 'D']
  ])('sends %s as ESC [ %s in normal mode', (key, final) => {
    expect(press({ key })).toBe(`\x1b[${final}`)
  })

  it.each([
    ['ArrowUp', 'A'],
    ['ArrowDown', 'B'],
    ['ArrowRight', 'C'],
    ['ArrowLeft', 'D']
  ])('sends %s as ESC O %s under DECCKM', (key, final) => {
    expect(press({ key }, { cursorKeys: 'application' })).toBe(`\x1bO${final}`)
  })

  it('sends VT-AC’s own single bytes in native mode', () => {
    // The same four keys, and the reason both personalities exist: natively an
    // arrow keypress and a CURSOR LEFT command byte are indistinguishable to
    // the far end, which is v1's design.
    expect(pressNative({ key: 'ArrowLeft' })).toBe('\x1c')
    expect(pressNative({ key: 'ArrowRight' })).toBe('\x1d')
    expect(pressNative({ key: 'ArrowUp' })).toBe('\x1e')
    expect(pressNative({ key: 'ArrowDown' })).toBe('\x1f')
  })
})

describe('Return', () => {
  it('sends CR alone', () => {
    expect(press({ key: 'Enter' })).toBe('\r')
  })

  it('sends CR LF under LNM', () => {
    expect(press({ key: 'Enter' }, { newLine: true })).toBe('\r\n')
  })

  it('always sends CR LF in native mode, which is v1’s rule', () => {
    expect(pressNative({ key: 'Enter' })).toBe('\r\n')
  })
})

describe('the other control keys', () => {
  it.each([
    ['Backspace', '\x08'],
    ['Tab', '\x09'],
    ['Escape', '\x1b'],
    ['Delete', '\x7f']
  ])('sends %s unchanged from native mode', (key, expected) => {
    expect(press({ key })).toBe(expected)
    expect(pressNative({ key })).toBe(expected)
  })
})

describe('PF1–PF4', () => {
  it.each([
    ['F1', 'P'],
    ['F2', 'Q'],
    ['F3', 'R'],
    ['F4', 'S']
  ])('sends %s as ESC O %s', (key, final) => {
    expect(press({ key })).toBe(`\x1bO${final}`)
  })

  it('leaves F5 and up to the browser — a VT100 has four function keys', () => {
    expect(press({ key: 'F5' })).toBeNull()
    expect(press({ key: 'F12' })).toBeNull()
  })
})

describe('the keypad', () => {
  it('sends ordinary characters in numeric mode', () => {
    expect(press({ key: '7', code: 'Numpad7' })).toBe('7')
    expect(press({ key: '.', code: 'NumpadDecimal' })).toBe('.')
  })

  it.each([
    ['Numpad0', 'p'],
    ['Numpad5', 'u'],
    ['Numpad9', 'y'],
    ['NumpadMultiply', 'j'],
    ['NumpadAdd', 'k'],
    ['NumpadSubtract', 'm'],
    ['NumpadDecimal', 'n'],
    ['NumpadDivide', 'o'],
    ['NumpadEnter', 'M']
  ])('sends %s as ESC O %s in application mode', (code, final) => {
    expect(press({ key: 'x', code }, { keypad: 'application' })).toBe(`\x1bO${final}`)
  })

  it('leaves the number row alone in application mode', () => {
    expect(press({ key: '7', code: 'Digit7' }, { keypad: 'application' })).toBe('7')
  })

  it('falls back to the key when there is no code to read', () => {
    expect(press({ key: '7' }, { keypad: 'application' })).toBe('7')
  })
})

describe('Ctrl', () => {
  // Native mode drops modified keystrokes, because SDL only ever raised
  // `textInput` for composed characters and v1's behaviour is preserved
  // exactly. A VT-100 with no way to send an interrupt is not usable, so this
  // is one place the two personalities deliberately part company.
  it.each([
    ['c', '\x03'],
    ['C', '\x03'],
    ['d', '\x04'],
    ['z', '\x1a'],
    ['a', '\x01']
  ])('sends Ctrl-%s as its control byte', (key, expected) => {
    expect(press({ key, ctrlKey: true })).toBe(expected)
  })

  it.each([
    ['@', '\x00'],
    [' ', '\x00'],
    ['[', '\x1b'],
    ['\\', '\x1c'],
    [']', '\x1d'],
    ['^', '\x1e'],
    ['_', '\x1f'],
    ['?', '\x7f']
  ])('sends Ctrl-%s as its named control character', (key, expected) => {
    expect(press({ key, ctrlKey: true })).toBe(expected)
  })

  it('sends nothing for a Ctrl combination with no control character', () => {
    expect(press({ key: '1', ctrlKey: true })).toBeNull()
  })

  it('leaves Alt and Meta combinations to the host', () => {
    expect(press({ key: 'c', altKey: true })).toBeNull()
    expect(press({ key: 'c', metaKey: true })).toBeNull()
    expect(press({ key: 'c', ctrlKey: true, metaKey: true })).toBeNull()
  })

  it('drops them all in native mode, exactly as v1 did', () => {
    expect(pressNative({ key: 'c', ctrlKey: true })).toBeNull()
  })
})

describe('printable characters', () => {
  it('passes the range v1 transmits', () => {
    expect(press({ key: 'A' })).toBe('A')
    expect(press({ key: ' ' })).toBe(' ')
    expect(press({ key: '~' })).toBe('~')
  })

  it('sends nothing for a key that is not a character', () => {
    expect(press({ key: 'Shift' })).toBeNull()
    expect(press({ key: 'PageUp' })).toBeNull()
  })
})

describe('the modes reaching the keyboard', () => {
  /** Feed a host's sequence, then read the mode flags the keyboard would see. */
  function modesAfter(text: string): KeyModes {
    const vtac = new VTAC()
    vtac.setPersonality('vt100')
    for (let i = 0; i < text.length; i++) vtac.parse(text.charCodeAt(i))

    const modes = vtac.vt100.modes
    return {
      cursorKeys: modes.cursorKeys ? 'application' : 'normal',
      keypad: modes.keypadApplication ? 'application' : 'numeric',
      newLine: modes.newLine
    }
  }

  it('starts every one of them at its power-on value', () => {
    expect(modesAfter('')).toEqual({
      cursorKeys: 'normal',
      keypad: 'numeric',
      newLine: false
    })
  })

  it('follows DECCKM from the byte stream', () => {
    expect(modesAfter('\x1b[?1h').cursorKeys).toBe('application')
    expect(modesAfter('\x1b[?1h\x1b[?1l').cursorKeys).toBe('normal')
  })

  it('follows DECKPAM and DECKPNM', () => {
    expect(modesAfter('\x1b=').keypad).toBe('application')
    expect(modesAfter('\x1b=\x1b>').keypad).toBe('numeric')
  })

  it('follows LNM', () => {
    expect(modesAfter('\x1b[20h').newLine).toBe(true)
  })

  it('makes the arrow keys change what they send, mid-stream', () => {
    // The end-to-end claim: a host turning DECCKM on changes the bytes the
    // very next keypress puts on the wire.
    expect(press({ key: 'ArrowUp' }, modesAfter(''))).toBe('\x1b[A')
    expect(press({ key: 'ArrowUp' }, modesAfter('\x1b[?1h'))).toBe('\x1bOA')
  })

  it('returns them all to power-on on RIS', () => {
    expect(modesAfter('\x1b[?1h\x1b=\x1b[20h\x1bc')).toEqual({
      cursorKeys: 'normal',
      keypad: 'numeric',
      newLine: false
    })
  })
})
