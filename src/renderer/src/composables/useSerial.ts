import { ref } from 'vue'
import type { Ref } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import { createSerialService } from '@/services/serial'
import { useSettings } from '@/services/settings'
import { DEFAULT_SERIAL_CONFIG } from '@shared/types'
import type { PortInfo, SerialConfig, SerialStatus } from '@shared/types'

/**
 * The terminal's link to a real serial port.
 *
 * Wired once for the life of the app rather than per component. Two sets of
 * callbacks on the one underlying service would hand every received byte to
 * `store.parse` twice — which for a terminal means every character appearing
 * on screen twice — and a connection is not the Settings panel's to own:
 * opening and closing that panel should not connect or disconnect hardware.
 * `App.vue` holds it; the panel and `vtac -p` drive this
 * same one.
 */
type Serial = {
  available: boolean
  status: Ref<SerialStatus>
  /** The last error a connect attempt produced, for the panel to show. */
  error: Ref<string | null>
  /**
   * The framing the next connection will use, and the one the control bar
   * reads out as `9600 8N1`.
   *
   * Shared rather than owned by the Settings panel, because two things now
   * display it and a readout that disagreed with the panel two clicks away
   * would be worse than no readout. Hydrated from settings at start-up
   * (`App.vue`) and edited in place by the panel.
   */
  config: Ref<SerialConfig>
  /**
   * The port path to open — the panel's selection, and `lastPort` at start-up.
   * Empty under the web build, where the browser's picker owns port identity.
   */
  port: Ref<string>
  listPorts: () => Promise<PortInfo[]>
  connect: (config?: SerialConfig, portPath?: string) => Promise<void>
  disconnect: () => Promise<void>
}

let shared: Serial | undefined

function createSerial(): Serial {
  const store = useTerminalStore()
  const service = createSerialService()
  const settings = useSettings()

  const status = ref<SerialStatus>('disconnected')
  const error = ref<string | null>(null)
  const available = service.isAvailable()
  const config = ref<SerialConfig>({ ...DEFAULT_SERIAL_CONFIG })
  const port = ref('')

  // Outgoing bytes are buffered and flushed every 10 ms rather than sent one
  // IPC message at a time. A burst — a paste, or several reports answered while
  // handling one serial chunk — becomes a single write, and 10 ms is well
  // inside a keystroke.
  //
  // This only stays safe because the window disables background throttling
  // (`main/index.ts`): Chromium otherwise clamps timers in an unfocused
  // renderer to a second or more, and a terminal that defers its DA or DSR
  // reply that long hangs the `vi` or `htop` waiting on it.
  //
  // Held here rather than inside the status handler so that reconnecting does
  // not leave an orphaned timer writing into a closed port.
  let txBuf: number[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    flushTimer = null
    if (txBuf.length === 0) return
    service.send(new Uint8Array(txBuf))
    txBuf = []
  }

  function queue(bytes: number[]): void {
    for (const byte of bytes) txBuf.push(byte)
    flushTimer ??= setTimeout(flush, 10)
  }

  // Received bytes go straight into the terminal. `parseBytes` rings the bell
  // and picks up an in-band geometry change per byte, so a chunk needs no
  // special handling here.
  service.onData((bytes) => {
    store.parseBytes(bytes)
  })

  service.onStatus((s) => {
    status.value = s
    store.serialConnected = s === 'connected'
    if (s === 'connected') {
      error.value = null
      store.setTransmitCallback(queue)
    } else {
      // Drop whatever was still queued: those bytes were addressed to a port
      // that no longer exists, and delivering them to the next one would be
      // worse than losing them.
      txBuf = []
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      store.setTransmitCallback(null)
    }
  })

  async function listPorts(): Promise<PortInfo[]> {
    try {
      return await service.listPorts()
    } catch (err) {
      console.warn('[useSerial] listPorts failed:', err)
      return []
    }
  }

  /**
   * Open the line.
   *
   * Both arguments default to the shared state above, so the control bar's link
   * button is `connect()` with nothing to know — and `vtac -p` still
   * gets to name a port explicitly.
   */
  async function connect(
    settings: SerialConfig = config.value,
    portPath: string | undefined = port.value || undefined
  ): Promise<void> {
    error.value = null
    try {
      await service.connect(settings, portPath)
      // Remembered so the picker opens on the device actually in use, and so a
      // relaunch finds the same line. Web has no path to remember — the browser
      // owns port identity.
      if (portPath !== undefined) {
        port.value = portPath
        void settings.set({ lastPort: portPath })
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[useSerial] connect failed:', err)
    }
  }

  async function disconnect(): Promise<void> {
    await service.disconnect()
  }

  return { available, status, error, config, port, listPorts, connect, disconnect }
}

export function useSerial(): Serial {
  shared ??= createSerial()
  return shared
}
