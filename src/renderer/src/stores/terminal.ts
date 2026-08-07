import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { VTAC } from '@core/VTAC'
import { keyToBytes } from '@core/keymap'
import type { KeyEvent } from '@core/keymap'
import type { Columns } from '@core/VTAC'
import type { Personality } from '@core/types'

/**
 * The terminal, and everything the app needs to talk to it.
 *
 * v1's `src/index.ts` was the whole host: it owned the `VTAC` instance, the
 * serial port, the render loop and the audio device, and wired them to each
 * other directly. This store is the first of those four — the instance and its
 * geometry — and the seam the other three attach to. `ScreenCanvas` reads
 * `vtac.screen` sixty times a second, `useSerial` (Phase 6) supplies the
 * transmit callback and feeds RX bytes to `parse`, and `useBell` takes the
 * bell callback.
 *
 * The `VTAC` instance is held in a `shallowRef`: it is a plain class over typed
 * arrays with nothing reactive in it, and making Vue walk a 300KB framebuffer
 * looking for dependencies would be both pointless and slow. Replacing the ref
 * is still reactive, which is how the canvas notices a new instance.
 */
export const useTerminalStore = defineStore('terminal', () => {
  const vtac = shallowRef(new VTAC())

  // Geometry and personality, mirrored reactively so the canvas can size itself
  // and the control bar (Phase 7) can read them. `VTAC` is a plain class with
  // no reactivity of its own, so anything that can change it — a click, a CLI
  // flag, or an `ESC 0x01` arriving over the wire — has to come back through
  // `sync()`.
  const cols = ref(vtac.value.screen.cols)
  const rows = ref(vtac.value.screen.rows)
  const width = computed(() => cols.value * 8)
  const height = computed(() => rows.value * 8)
  const personality = ref<Personality>(vtac.value.personality)

  function sync(): void {
    cols.value = vtac.value.screen.cols
    rows.value = vtac.value.screen.rows
    personality.value = vtac.value.personality
  }

  /**
   * Switch column mode. The control bar's `40`/`80` readout, and the `-c` flag.
   *
   * Clears the screen and homes the cursor, exactly as `ESC 0x01`/`ESC 0x02`
   * do — this *is* that path, so the two cannot drift apart.
   */
  function setColumns(columns: Columns): void {
    vtac.value.setColumns(columns)
    sync()
  }

  /** Switch personality. The control bar's `VT-AC`/`VT-100` readout, and `-m`. */
  function setPersonality(next: Personality): void {
    vtac.value.setPersonality(next)
    sync()
  }

  /**
   * A key event → the bytes to transmit, or `null` when the key sends nothing.
   *
   * Here rather than in `useKeyboard` because the answer depends on terminal
   * state — the personality, DECCKM, LNM and the keypad mode — and the store is
   * what owns the terminal. Read at keystroke time and never cached: the host
   * can change any of these from inside the byte stream between one keypress
   * and the next, which is exactly what `vi` does on the way in and out.
   */
  function keyBytes(event: KeyEvent): number[] | null {
    const terminal = vtac.value
    const modes = terminal.vt100.modes

    return keyToBytes(event, terminal.personality, {
      cursorKeys: modes.cursorKeys ? 'application' : 'normal',
      keypad: modes.keypadApplication ? 'application' : 'numeric',
      newLine: modes.newLine
    })
  }

  /**
   * Whether there is an open serial port to transmit into.
   *
   * v1 dropped keystrokes on the floor when the port was closed
   * (`src/index.ts:127`) rather than buffering them, and so does v2: a terminal
   * with nothing on the other end has nowhere to put them. Owned by
   * `useSerial` from Phase 6; false until then, which is why typing does
   * nothing in a Phase 3 build.
   */
  const serialConnected = ref(false)

  // Set by the composables that own the far ends of these two wires. Kept out
  // of the reactive surface — they are plumbing, and nothing renders off them.
  let onTransmit: ((bytes: number[]) => void) | null = null
  let onBell: (() => void) | null = null

  /** Register the sink for bytes the terminal sends. `useSerial`, Phase 6. */
  function setTransmitCallback(callback: ((bytes: number[]) => void) | null): void {
    onTransmit = callback
  }

  // The terminal answers `ESC 0x04` — and, from Phase 5, DA and DSR — on the
  // same wire the keyboard uses, so it transmits through the store rather than
  // holding a second reference to the serial link.
  vtac.value.setTransmitCallback((bytes) => transmit(bytes))

  /** Register the handler woken when a bell lands in the queue. `useBell`. */
  function setBellCallback(callback: (() => void) | null): void {
    onBell = callback
  }

  /** Send bytes to the far end. A no-op when nothing has claimed the wire. */
  function transmit(bytes: number[]): void {
    if (bytes.length === 0) return
    onTransmit?.(bytes)
  }

  /**
   * Feed one received byte to the terminal.
   *
   * The bell check rides along here rather than in the render loop, where v1
   * had it. v1 could afford the wait because it was already spinning a
   * `setTimeout` at 60Hz whether or not anything had happened; v2's loop skips
   * frames when nothing changed, so a bell arriving on an otherwise static
   * screen would sit in the queue unheard. Checking the queue depth costs one
   * comparison per byte and rings it the moment it arrives.
   */
  function parse(byte: number): void {
    const terminal = vtac.value
    terminal.parse(byte)
    if (onBell !== null && terminal.bellQueue.length > 0) onBell()

    // `ESC 0x01`/`0x02`/`0x03` change geometry and personality from inside the
    // byte stream, and nothing about `VTAC` is reactive. Two comparisons per
    // byte is the price of not having to poll or wrap every mutation.
    if (terminal.screen.cols !== cols.value || terminal.personality !== personality.value) {
      sync()
    }
  }

  /** Feed a run of received bytes — a serial chunk, a dropped file, a paste. */
  function parseBytes(data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) parse(data[i])
  }

  /**
   * `0x04` — full reset. The control bar's Reset button, Phase 7.
   *
   * Returns to the *configured* geometry and personality rather than to 40
   * columns of native, so a reset undoes what the stream did and not what the
   * user launched with.
   */
  function reset(): void {
    vtac.value.reset()
    sync()
  }

  /** `0x0C` — clear the screen, keeping colours and cursor state. */
  function clear(): void {
    vtac.value.parse(0x0c)
  }

  return {
    vtac,
    cols,
    rows,
    width,
    height,
    personality,
    serialConnected,
    setColumns,
    setPersonality,
    keyBytes,
    setTransmitCallback,
    setBellCallback,
    transmit,
    parse,
    parseBytes,
    reset,
    clear
  }
})
