import { ref } from 'vue'
import type { Ref } from 'vue'

/**
 * The window's fullscreen state.
 *
 * Two things ask about it — the control bar's icon and the Settings panel's
 * DISPLAY toggle — and only the main process actually knows, since the window
 * can also be put in and out of fullscreen by F11, the green button or the menu
 * bar. So the state lives here, module-level, fed by main's `fullscreenChanged`
 * event rather than by whoever last pressed something; main saves it.
 *
 * Electron only. A browser tab has the Fullscreen API, but it is gesture-gated,
 * escapable by the browser's own UI and not persisted anywhere — three
 * behaviours the same button would have to explain away. The web build hides it
 * (PLAN.md §Phase 9).
 */

const isFullscreen = ref(false)

/** Set up once, however many components ask for the state. */
let bound = false

function api(): NonNullable<typeof window.api> | undefined {
  return typeof window !== 'undefined' ? window.api : undefined
}

export function useFullscreen(): {
  available: boolean
  isFullscreen: Ref<boolean>
  toggle: () => void
  bind: () => (() => void) | undefined
} {
  const available = api() !== undefined

  function toggle(): void {
    void api()?.window.toggleFullscreen()
  }

  /**
   * Track main's state and bind the keyboard shortcuts. Called once, from
   * `App.vue`; returns its own teardown.
   */
  function bind(): (() => void) | undefined {
    const bridge = api()
    if (bridge === undefined || bound) return undefined
    bound = true

    void bridge.window.isFullscreen().then((value) => {
      isFullscreen.value = value
    })

    // Saving it is main's job, not this listener's: `vtac -f` puts the window
    // in fullscreen for one launch, and from here that is indistinguishable
    // from the user pressing F11. Main knows which of the two happened.
    const off = bridge.window.onFullscreenChanged((value) => {
      isFullscreen.value = value
    })

    // F11 and ⌘↵, captured before the terminal's own keydown handler: neither
    // is a key a VT-100 transmits, but `keyToBytes` is not the place to record
    // that and the capture phase keeps the two rules apart.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'F11' || (event.metaKey && event.key === 'Enter')) {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      off()
      window.removeEventListener('keydown', onKeyDown, true)
      bound = false
    }
  }

  return { available, isFullscreen, toggle, bind }
}
