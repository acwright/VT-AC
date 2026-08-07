import { onMounted, ref, watch } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

/**
 * The bell.
 *
 * v1 opened an SDL audio device, generated a sine wave into a `Float32Array`
 * sample by sample, enqueued it, and set a `setTimeout` for the duration to
 * pull the next bell off the queue. Web Audio does the sample generation, so
 * what is left is the shape of that arrangement, which is kept exactly:
 *
 * - **one bell at a time**, the rest waiting in `vtac.bellQueue` — the queue
 *   lives in the core, so a program that rings faster than the notes last gets
 *   the same backlog it always did;
 * - duration in **jiffies**, `jiffies / 60` seconds;
 * - amplitude **0.2**, v1's "keep volume at 20% to avoid distortion";
 * - a **linear fade over the final 10%**, which is there to kill the click at
 *   the end of an abruptly-stopped sine and nothing else.
 *
 * State is module-level, so every `useBell()` call shares one `AudioContext`:
 * `App.vue` starts it eagerly under Electron while a browser has to wait for a
 * gesture, and both paths must land on the same graph.
 */

/** v1's `amplitude`, `src/index.ts:232`. */
const AMPLITUDE = 0.2

/** v1 faded over the last tenth of the note, `src/index.ts:236`. */
const FADE_FRACTION = 0.1

let audioCtx: AudioContext | null = null
let master: GainNode | null = null
let playing = false
let disarmGesture: (() => void) | null = null

/** True once the context is actually running — not merely constructed. */
const audioReady = ref(false)

/**
 * Silence, without changing anything upstream of it.
 *
 * Mute belongs on the output node and nowhere else: dropping the bells instead
 * would desynchronise the queue from what the program believes it has rung, and
 * a muted terminal has to behave like an audible one that nobody can hear.
 */
const muted = ref(false)

/** Output level, 0–1, before the per-note amplitude. Phase 7's slider. */
const volume = ref(1)

export function useBell(): {
  audioReady: typeof audioReady
  muted: typeof muted
  volume: typeof volume
  initAudio: () => Promise<boolean>
  armAudioOnFirstGesture: () => void
  ring: () => void
  test: () => void
} {
  const store = useTerminalStore()

  function applyGain(): void {
    if (master === null || audioCtx === null) return
    // A short ramp rather than a jump: a step change in gain is itself a click.
    master.gain.setTargetAtTime(muted.value ? 0 : volume.value, audioCtx.currentTime, 0.01)
  }

  /**
   * Build the audio graph, or resume it. Idempotent, and safe to call from a
   * gesture handler.
   *
   * Returns whether the context ended up running: a browser that has not seen a
   * gesture yet will construct it suspended and resolve `false`, which is the
   * signal to keep waiting rather than to start playing into nothing.
   */
  async function initAudio(): Promise<boolean> {
    if (audioCtx === null) {
      if (typeof AudioContext === 'undefined') return false
      audioCtx = new AudioContext()
      master = audioCtx.createGain()
      master.gain.value = muted.value ? 0 : volume.value
      master.connect(audioCtx.destination)
    }

    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume()
      } catch {
        /* Still suspended; the next gesture gets another go. */
      }
    }

    audioReady.value = audioCtx.state === 'running'
    return audioReady.value
  }

  /**
   * Start the audio graph on the first user gesture of any kind.
   *
   * A browser will not let an `AudioContext` run before one. VT-AC has no play
   * button to hang that on — the terminal is live from the moment it loads —
   * so the first click or keypress anywhere is what arms it.
   */
  function armAudioOnFirstGesture(): void {
    if (audioReady.value || disarmGesture !== null) return

    const events = ['pointerdown', 'keydown', 'touchstart'] as const

    function disarm(): void {
      for (const type of events) window.removeEventListener(type, onGesture, true)
      disarmGesture = null
    }

    async function onGesture(): Promise<void> {
      if (await initAudio()) {
        disarm()
        ring()
      }
    }

    for (const type of events) window.addEventListener(type, onGesture, true)
    disarmGesture = disarm
  }

  /**
   * Play the queued bells, if any and if nothing is already sounding.
   *
   * Called when a bell is enqueued (the store's `parse`) and again as each note
   * ends, which between them is every moment the queue can go from idle to
   * occupied.
   */
  function ring(): void {
    if (playing) return

    const vtac = store.vtac
    if (!vtac.hasQueuedBells()) return

    if (!audioReady.value || audioCtx === null || master === null) {
      // v1 dropped the queue when it could not open an audio device
      // (`src/index.ts:212`), and so does this: bells are notes with a moment
      // to happen in, not messages, and a backlog released on the first click
      // minutes later would be worse than silence. Arm for next time.
      vtac.bellQueue = []
      armAudioOnFirstGesture()
      return
    }

    const bell = vtac.getNextBell()
    if (bell !== undefined) play(bell.frequency, bell.duration)
  }

  /** Ring one bell at the terminal's current settings. Phase 7's Test button. */
  function test(): void {
    store.vtac.bell()
    ring()
  }

  function play(frequency: number, jiffies: number): void {
    if (audioCtx === null || master === null) return

    playing = true

    const seconds = jiffies / 60
    const start = audioCtx.currentTime
    const end = start + seconds
    const fadeFrom = end - seconds * FADE_FRACTION

    const oscillator = audioCtx.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)

    // Flat at full amplitude, then a straight line to zero over the last 10%.
    // The second `setValueAtTime` is what makes it flat: without an anchor at
    // `fadeFrom` the ramp would start from the beginning of the note.
    const envelope = audioCtx.createGain()
    envelope.gain.setValueAtTime(AMPLITUDE, start)
    envelope.gain.setValueAtTime(AMPLITUDE, fadeFrom)
    envelope.gain.linearRampToValueAtTime(0, end)

    oscillator.connect(envelope)
    envelope.connect(master)

    oscillator.onended = (): void => {
      oscillator.disconnect()
      envelope.disconnect()
      playing = false
      ring()
    }

    oscillator.start(start)
    oscillator.stop(end)
  }

  watch([muted, volume], applyGain)

  onMounted(() => {
    store.setBellCallback(ring)

    // Electron has no autoplay policy to satisfy, so the context can be up
    // before the first bell rather than after it. The gesture arming stays as
    // the fallback for the case where it starts suspended anyway.
    if (window.api !== undefined) void initAudio()
    armAudioOnFirstGesture()
  })

  return { audioReady, muted, volume, initAudio, armAudioOnFirstGesture, ring, test }
}
