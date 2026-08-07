import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { VTAC } from '@core/VTAC'

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

  // Geometry, mirrored reactively so the canvas can size itself. Fixed at
  // 40×30 until Phase 4 makes `setColumns` a thing; the mirror exists now so
  // that when it does, the canvas already follows.
  const cols = ref(vtac.value.screen.cols)
  const rows = ref(vtac.value.screen.rows)
  const width = computed(() => cols.value * 8)
  const height = computed(() => rows.value * 8)

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
    vtac.value.parse(byte)
    if (onBell !== null && vtac.value.bellQueue.length > 0) onBell()
  }

  /** Feed a run of received bytes — a serial chunk, a dropped file, a paste. */
  function parseBytes(data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) parse(data[i])
  }

  /** `0x04` — full reset. The control bar's Reset button, Phase 7. */
  function reset(): void {
    vtac.value.reset()
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
    serialConnected,
    setTransmitCallback,
    setBellCallback,
    transmit,
    parse,
    parseBytes,
    reset,
    clear
  }
})
