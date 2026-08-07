import { onMounted, onUnmounted } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

/**
 * The keyboard.
 *
 * SDL raised two events — `keyDown` for the control keys, `textInput` for
 * composed characters — and v1 handled them separately. The browser delivers
 * both through `keydown`, and `keyToBytes` (Phase 1) already merges the two
 * halves of v1's table, so there is nothing left here but routing.
 *
 * What a key transmits depends on terminal state — the personality, DECCKM,
 * LNM, the keypad mode — so the store answers that question and this composable
 * stays what it always was: routing, plus the rule about whose keystroke it is.
 */

/**
 * True when the keystroke was aimed at a text field — the paste modal's
 * textarea, a settings input — rather than at the terminal.
 *
 * Nothing in Phase 3 has such a field, but the Phase 7 panels do, and a global
 * `keydown` listener that both swallowed and forwarded their keystrokes would
 * make them impossible to type into.
 */
function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (target === null) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useKeyboard(): void {
  const store = useTerminalStore()

  function onKeyDown(event: KeyboardEvent): void {
    if (isEditableTarget(event)) return

    const bytes = store.keyBytes(event)

    // `null` means the key is not the terminal's — a shortcut, a function key,
    // a bare modifier — so the browser keeps it and its default action.
    if (bytes === null) return

    // Anything the terminal claims has its default suppressed whether or not
    // there is a port to send it to. Otherwise Tab walks focus off the canvas
    // and the arrows scroll the page, which is worse than a dropped keystroke
    // and outlives the disconnection that caused it.
    event.preventDefault()

    // v1 returned early on a closed port rather than buffering (index.ts:127).
    if (!store.serialConnected) return

    store.transmit(bytes)
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown)
  })
}
