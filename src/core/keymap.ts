/**
 * Keyboard → bytes on the wire.
 *
 * v1 split this across two SDL handlers: `keyDown` for the control keys and
 * `textInput` for printable characters. The browser delivers both through one
 * `keydown` event, so the two halves merge here — but the resulting byte stream
 * is v1's, unchanged.
 *
 * The signature takes a personality and the mode flags so Phase 5 can add
 * DECCKM, LNM and keypad application mode without touching any caller.
 */

import type { Personality } from './types'

/**
 * The parts of a DOM `KeyboardEvent` this module reads.
 *
 * Structural rather than the DOM type, so the core stays free of `lib.dom` and
 * the tests can run under Jest's node environment. A real `KeyboardEvent` is
 * assignable to it.
 */
export interface KeyEvent {
  /** `KeyboardEvent.key` — 'a', ' ', 'Enter', 'ArrowUp', … */
  key: string
  /**
   * `KeyboardEvent.code` — 'KeyA', 'Numpad7', 'NumpadEnter', …
   *
   * Only the keypad needs it, and only in application mode: `key` alone cannot
   * tell `7` on the number row from `7` on the keypad, and DEC's application
   * keypad gives them different codes.
   */
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/**
 * The terminal mode flags that change what a key transmits.
 *
 * All optional and all defaulting to the reset state, so `native` callers can
 * pass nothing. Phase 5's ANSI dispatch owns the values.
 */
export interface KeyModes {
  /** DECCKM — cursor keys send `ESC O x` in application mode, `ESC [ x` normally. */
  cursorKeys?: 'normal' | 'application'
  /** DECKPAM/DECKPNM — the keypad's application mode. */
  keypad?: 'numeric' | 'application'
  /** LNM — Return transmits CR LF rather than CR alone. */
  newLine?: boolean
}

/** Lowest byte v1 transmits for a printable character. */
export const PRINTABLE_MIN = 0x20

/** Highest byte v1 transmits for a printable character. */
export const PRINTABLE_MAX = 0x7e

/**
 * v1's control-key table, lifted verbatim from `src/index.ts:126-167`, with
 * SDL's key names translated to the DOM's.
 *
 * The arrow codes are VT-AC's own `0x1C`–`0x1F` — the same bytes the protocol
 * uses for CURSOR LEFT/RIGHT/UP/DOWN, so a key press and a command byte are
 * indistinguishable to the far end. That is native mode's design; VT-100 mode
 * (Phase 5) sends the DEC sequences instead.
 */
export const NATIVE_KEYS: Readonly<Record<string, readonly number[]>> = {
  Backspace: [0x08],
  Tab: [0x09],
  Enter: [0x0d, 0x0a],
  Escape: [0x1b],
  ArrowLeft: [0x1c],
  ArrowRight: [0x1d],
  ArrowUp: [0x1e],
  ArrowDown: [0x1f],
  Delete: [0x7f]
}

/**
 * A printable character → its byte, or `null` if it is outside the range v1
 * transmits.
 */
export function charToByte(char: string): number | null {
  if (char.length !== 1) return null
  const code = char.charCodeAt(0)
  return code >= PRINTABLE_MIN && code <= PRINTABLE_MAX ? code : null
}

/**
 * A string → the bytes v1 would have transmitted for it, unprintable
 * characters dropped. Used by the paste path (Phase 7), which sends text
 * through the same rule a keystroke goes through.
 */
export function textToBytes(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const byte = charToByte(char)
    if (byte !== null) bytes.push(byte)
  }
  return bytes
}

/**
 * A key event → the bytes to transmit, or `null` when the key sends nothing.
 *
 * `null` matters: it is the signal to the caller that the browser's default
 * action should be left alone. A key that produces bytes should have its
 * default prevented — otherwise Tab moves focus out of the canvas and the
 * arrows scroll the page.
 */
export function keyToBytes(
  event: KeyEvent,
  personality: Personality = 'native',
  modes: KeyModes = {}
): number[] | null {
  return personality === 'vt100' ? vt100KeyToBytes(event, modes) : nativeKeyToBytes(event)
}

/** v1's keyboard, unchanged. */
function nativeKeyToBytes(event: KeyEvent): number[] | null {
  const mapped = NATIVE_KEYS[event.key]
  if (mapped) return [...mapped]

  // A modifier held down means the keystroke is a shortcut, not text. SDL only
  // raised `textInput` for characters the OS had already composed, so Ctrl-C
  // never reached v1 as `0x63`; the guard preserves that. Shift is excluded —
  // it is how the uppercase letter got composed in the first place.
  if (event.ctrlKey || event.altKey || event.metaKey) return null

  const byte = charToByte(event.key)
  return byte === null ? null : [byte]
}

/** The cursor keys' final byte, by `KeyboardEvent.key`. */
const VT100_ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D'
}

/**
 * PF1–PF4, on F1–F4.
 *
 * A VT100 has four function keys and they are these. F5 and up send nothing,
 * which leaves the browser's own bindings — refresh, fullscreen — working.
 */
const VT100_FUNCTION_KEYS: Readonly<Record<string, string>> = {
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS'
}

/**
 * The application keypad, by `KeyboardEvent.code`.
 *
 * The letters are not arbitrary: DEC assigned `p`–`y` to the digits, and the
 * punctuation keys take their ASCII code plus 0x40, so `*` `+` `,` `-` `.` `/`
 * become `j` `k` `l` `m` `n` `o`. A PC keypad has `*`, `+` and `/` where a
 * VT100 had a comma, and those three are the ANSI extension of the same rule.
 */
const VT100_KEYPAD: Readonly<Record<string, string>> = {
  Numpad0: '\x1bOp',
  Numpad1: '\x1bOq',
  Numpad2: '\x1bOr',
  Numpad3: '\x1bOs',
  Numpad4: '\x1bOt',
  Numpad5: '\x1bOu',
  Numpad6: '\x1bOv',
  Numpad7: '\x1bOw',
  Numpad8: '\x1bOx',
  Numpad9: '\x1bOy',
  NumpadMultiply: '\x1bOj',
  NumpadAdd: '\x1bOk',
  NumpadSubtract: '\x1bOm',
  NumpadDecimal: '\x1bOn',
  NumpadDivide: '\x1bOo',
  NumpadEnter: '\x1bOM'
}

/**
 * The control characters Ctrl produces, for the keys where it is not simply
 * "clear the top three bits".
 */
const CONTROL_CHARACTERS: Readonly<Record<string, number>> = {
  '@': 0x00,
  ' ': 0x00,
  '[': 0x1b,
  '\\': 0x1c,
  ']': 0x1d,
  '^': 0x1e,
  _: 0x1f,
  '?': 0x7f
}

/** A sequence, as the bytes to put on the wire. */
function sequence(text: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i))
  return bytes
}

function vt100KeyToBytes(event: KeyEvent, modes: KeyModes): number[] | null {
  // The keypad, and only in application mode — in numeric mode its keys are
  // ordinary characters and fall through to the character path below.
  if (modes.keypad === 'application' && event.code !== undefined) {
    const keypad = VT100_KEYPAD[event.code]
    if (keypad !== undefined) return sequence(keypad)
  }

  // DECCKM. `ESC O x` in application mode, `ESC [ x` normally — the single
  // most common reason arrow keys misbehave in a full-screen application, and
  // the reason the mode exists at all.
  const arrow = VT100_ARROWS[event.key]
  if (arrow !== undefined) {
    return sequence(`\x1b${modes.cursorKeys === 'application' ? 'O' : '['}${arrow}`)
  }

  const functionKey = VT100_FUNCTION_KEYS[event.key]
  if (functionKey !== undefined) return sequence(functionKey)

  switch (event.key) {
    case 'Enter':
      // LNM: CR alone normally, CR LF when the host has asked for both. Native
      // mode always sends both, which is v1's rule and stays v1's rule.
      return modes.newLine ? [0x0d, 0x0a] : [0x0d]
    case 'Backspace':
      // BS, which is what the `vt100` terminfo entry's `kbs` says.
      return [0x08]
    case 'Tab':
      return [0x09]
    case 'Escape':
      return [0x1b]
    case 'Delete':
      return [0x7f]
  }

  // Ctrl, which native mode deliberately drops and VT-100 mode cannot.
  //
  // v1 never saw Ctrl-C because SDL only raised `textInput` for composed
  // characters, and native mode keeps that behaviour byte-for-byte. But a
  // VT-100 with no way to send an interrupt is not a terminal anyone can use
  // — `vi`, `htop` and every shell need it — so here Ctrl means what it means
  // on every other terminal: clear the top three bits.
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
    const named = CONTROL_CHARACTERS[event.key]
    if (named !== undefined) return [named]

    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 0x40 && code <= 0x5f) return [code & 0x1f]
    return null
  }

  if (event.ctrlKey || event.altKey || event.metaKey) return null

  const byte = charToByte(event.key)
  return byte === null ? null : [byte]
}
