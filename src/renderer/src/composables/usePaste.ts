import { useTerminalStore } from '@/stores/terminal'
import type { KeyEvent } from '@core/keymap'

/**
 * Paste — text sent up the wire as if it had been typed.
 *
 * The EMULATOR's equivalent injects USB HID scancodes into a keyboard
 * controller and has to know about Shift; a terminal has no keyboard of its
 * own, so this is much smaller: every character goes through the same
 * `store.keyBytes` a keystroke does. That is the whole point of routing it that
 * way rather than through `textToBytes` — a newline in the pasted text becomes
 * whatever Return currently transmits, which is `CR LF` in native mode and
 * `CR` alone in VT-100 mode until LNM says otherwise.
 */

/**
 * Bytes per burst, and the pause between bursts — about 3 KB/s.
 *
 * Handing the whole string over at once would be simpler and is what a
 * terminal emulator on a pty can afford. This one talks to a serial device
 * with a finite input buffer and, quite possibly, no flow control: a 4 KB
 * paste arriving in one write is how a microcontroller drops half of it.
 * Chunking is not a throughput limit — the driver buffers anyway — it is a
 * pause the far end can use.
 */
const CHUNK = 32
const GAP_MS = 10

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The key event a pasted character stands in for. */
function keyEventFor(char: string): KeyEvent {
  if (char === '\n') return { key: 'Enter' }
  if (char === '\t') return { key: 'Tab' }
  return { key: char }
}

export function usePaste(): {
  injectText: (text: string) => Promise<void>
  cancel: () => void
} {
  const store = useTerminalStore()

  let cancelled = false

  /**
   * Send `text` to the far end. Resolves when it has all gone out, or when
   * `cancel()` stops it part-way.
   */
  async function injectText(text: string): Promise<void> {
    if (!store.serialConnected) return
    cancelled = false

    // CRLF first, so a pasted Windows line ending is one Return and not two.
    const normalized = text.replace(/\r\n?/g, '\n')

    let burst: number[] = []
    for (const char of normalized) {
      if (cancelled) break

      const bytes = store.keyBytes(keyEventFor(char))
      // Characters the terminal has no way to transmit — anything outside
      // 0x20–0x7E that is not one of the keys above — are dropped rather than
      // approximated. v1's keyboard could not produce them either.
      if (bytes === null) continue
      burst.push(...bytes)

      if (burst.length >= CHUNK) {
        store.transmit(burst)
        burst = []
        await sleep(GAP_MS)
        // The link can go away mid-paste; the rest is addressed to a port that
        // no longer exists.
        if (!store.serialConnected) return
      }
    }

    if (!cancelled && burst.length > 0) store.transmit(burst)
  }

  function cancel(): void {
    cancelled = true
  }

  return { injectText, cancel }
}
