import {
  NATIVE_KEYS,
  PRINTABLE_MAX,
  PRINTABLE_MIN,
  charToByte,
  keyToBytes,
  textToBytes,
  type KeyEvent
} from '@core/keymap'

const press = (key: string, modifiers: Partial<KeyEvent> = {}): number[] | null =>
  keyToBytes({ key, ...modifiers })

describe('keyToBytes — native', () => {
  it('sends v1s control codes', () => {
    expect(press('Backspace')).toEqual([0x08])
    expect(press('Tab')).toEqual([0x09])
    expect(press('Enter')).toEqual([0x0d, 0x0a])
    expect(press('Escape')).toEqual([0x1b])
    expect(press('ArrowLeft')).toEqual([0x1c])
    expect(press('ArrowRight')).toEqual([0x1d])
    expect(press('ArrowUp')).toEqual([0x1e])
    expect(press('ArrowDown')).toEqual([0x1f])
    expect(press('Delete')).toEqual([0x7f])
  })

  it('sends the arrows as the protocols own cursor commands', () => {
    // 0x1C-0x1F are CURSOR LEFT/RIGHT/UP/DOWN in the instruction set. A key
    // press and a command byte are deliberately the same thing in native mode.
    expect(press('ArrowLeft')).toEqual([0x1c])
    expect(press('ArrowDown')).toEqual([0x1f])
  })

  it('passes every printable character through', () => {
    for (let code = PRINTABLE_MIN; code <= PRINTABLE_MAX; code++) {
      expect(press(String.fromCharCode(code))).toEqual([code])
    }
  })

  it('covers both ends of the printable range', () => {
    expect(press(' ')).toEqual([0x20])
    expect(press('~')).toEqual([0x7e])
  })

  it('leaves Shift alone, since it is how the character was composed', () => {
    expect(press('A', { shiftKey: true })).toEqual([0x41])
    expect(press('?', { shiftKey: true })).toEqual([0x3f])
  })

  it('sends nothing for a shortcut', () => {
    // SDL only raised textInput for composed characters, so Ctrl-C never
    // reached v1 as 0x63.
    expect(press('c', { ctrlKey: true })).toBeNull()
    expect(press('v', { metaKey: true })).toBeNull()
    expect(press('a', { altKey: true })).toBeNull()
  })

  it('still sends mapped control keys when a modifier is held', () => {
    // The guard is about text composition, not about the control keys — v1's
    // keyDown handler ran regardless of modifiers.
    expect(press('Enter', { ctrlKey: true })).toEqual([0x0d, 0x0a])
    expect(press('ArrowUp', { shiftKey: true })).toEqual([0x1e])
  })

  it('sends nothing for keys outside the protocol', () => {
    expect(press('F1')).toBeNull()
    expect(press('Home')).toBeNull()
    expect(press('PageUp')).toBeNull()
    expect(press('Shift')).toBeNull()
    expect(press('CapsLock')).toBeNull()
    expect(press('Dead')).toBeNull()
    expect(press('é')).toBeNull() // above the printable range
  })

  it('defaults to the native personality', () => {
    expect(keyToBytes({ key: 'ArrowUp' })).toEqual(keyToBytes({ key: 'ArrowUp' }, 'native'))
  })

  it('accepts mode flags without needing them yet', () => {
    expect(keyToBytes({ key: 'Enter' }, 'native', { cursorKeys: 'application' })).toEqual([
      0x0d, 0x0a
    ])
  })

  it('returns a fresh array the caller cannot use to corrupt the table', () => {
    const bytes = press('Enter')
    expect(bytes).not.toBeNull()
    bytes![0] = 0x00
    expect(press('Enter')).toEqual([0x0d, 0x0a])
    expect(NATIVE_KEYS.Enter).toEqual([0x0d, 0x0a])
  })
})

describe('charToByte', () => {
  it('accepts the printable range and nothing else', () => {
    expect(charToByte(' ')).toBe(0x20)
    expect(charToByte('~')).toBe(0x7e)
    expect(charToByte('\x1f')).toBeNull()
    expect(charToByte('\x7f')).toBeNull()
    expect(charToByte('é')).toBeNull()
    expect(charToByte('')).toBeNull()
    expect(charToByte('ab')).toBeNull()
  })
})

describe('textToBytes', () => {
  it('sends a string byte by byte', () => {
    expect(textToBytes('VT-AC')).toEqual([0x56, 0x54, 0x2d, 0x41, 0x43])
  })

  it('drops what the terminal cannot transmit', () => {
    expect(textToBytes('a\nb\tc')).toEqual([0x61, 0x62, 0x63])
    expect(textToBytes('naïve')).toEqual([0x6e, 0x61, 0x76, 0x65])
  })

  it('handles an empty string', () => {
    expect(textToBytes('')).toEqual([])
  })
})
