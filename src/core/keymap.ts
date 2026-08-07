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
  // Phase 5 replaces this branch with the VT-100 table (DECCKM cursor keys,
  // LNM-aware Return, keypad application mode, PF1–PF4). Until it lands,
  // `vt100` transmits what `native` does rather than transmitting nothing.
  void personality
  void modes

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
