import type { PortInfo, SerialConfig, SerialStatus } from '@shared/types'
import type { ISerialService } from './types'

// ── Web Serial typings ───────────────────────────────────────────────────────
//
// `lib.dom` has no Web Serial declarations, and the API is Chromium-only, so
// the two members actually used are declared here rather than by taking on
// `@types/w3c-web-serial` for a dozen lines.

interface WebSerialPort {
  open(options: {
    baudRate: number
    dataBits?: number
    stopBits?: number
    parity?: 'none' | 'even' | 'odd'
  }): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
}

interface WebSerial {
  requestPort(): Promise<WebSerialPort>
}

function webSerial(): WebSerial | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { serial?: WebSerial }).serial
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && 'api' in window && !!window.api
}

// ── Web Serial ───────────────────────────────────────────────────────────────

class WebSerialService implements ISerialService {
  private dataCallbacks = new Set<(d: Uint8Array) => void>()
  private statusCallbacks = new Set<(s: SerialStatus) => void>()
  private port: WebSerialPort | null = null
  private readLoopActive = false

  isAvailable(): boolean {
    return webSerial() !== undefined
  }

  async listPorts(): Promise<PortInfo[]> {
    // Web Serial gates port selection behind its own picker and a user gesture;
    // there is nothing to enumerate. The Settings panel shows a Connect button
    // instead of a list (PLAN.md §Phase 9).
    return []
  }

  async connect(config: SerialConfig, _portPath?: string): Promise<void> {
    const serial = webSerial()
    if (!serial || this.port) return
    this.emitStatus('connecting')
    try {
      const selected = await serial.requestPort()
      await selected.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        // Web Serial takes whole stop bits only; 1.5 has no expression here.
        stopBits: config.stopBits === 2 ? 2 : 1,
        parity: config.parity
      })
      this.port = selected
      this.emitStatus('connected')
      void this.startReadLoop()
    } catch (err) {
      this.emitStatus('error')
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.readLoopActive = false
    if (this.port) {
      try {
        await this.port.close()
      } catch {
        /* already gone */
      }
      this.port = null
    }
    this.emitStatus('disconnected')
  }

  send(data: Uint8Array): void {
    if (!this.port?.writable) return
    const writer = this.port.writable.getWriter()
    void writer.write(data).finally(() => writer.releaseLock())
  }

  onData(cb: (d: Uint8Array) => void): () => void {
    this.dataCallbacks.add(cb)
    return () => this.dataCallbacks.delete(cb)
  }

  onStatus(cb: (s: SerialStatus) => void): () => void {
    this.statusCallbacks.add(cb)
    return () => this.statusCallbacks.delete(cb)
  }

  private emitStatus(status: SerialStatus): void {
    this.statusCallbacks.forEach((cb) => cb(status))
  }

  private async startReadLoop(): Promise<void> {
    this.readLoopActive = true
    while (this.readLoopActive && this.port?.readable) {
      const reader = this.port.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done || !this.readLoopActive) break
          if (value) this.dataCallbacks.forEach((cb) => cb(value))
        }
      } catch {
        // Unplugged, or a read error. Either way the loop below decides.
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
      }
    }
    if (this.readLoopActive) {
      // The stream ended without anyone asking it to — the device went away.
      this.port = null
      this.emitStatus('disconnected')
    }
  }
}

// ── Electron (IPC → serialport in main) ──────────────────────────────────────

class ElectronSerialService implements ISerialService {
  private dataCallbacks = new Set<(d: Uint8Array) => void>()
  private statusCallbacks = new Set<(s: SerialStatus) => void>()

  constructor() {
    // Registered once for the lifetime of this singleton — see the factory.
    window.api!.serial.onData((data) => {
      this.dataCallbacks.forEach((cb) => cb(data))
    })
    window.api!.serial.onStatus((status) => {
      this.statusCallbacks.forEach((cb) => cb(status))
    })
  }

  isAvailable(): boolean {
    return true // the preload always exposes it
  }

  async listPorts(): Promise<PortInfo[]> {
    return window.api!.serial.listPorts()
  }

  async connect(config: SerialConfig, portPath?: string): Promise<void> {
    if (!portPath) {
      throw new Error('Electron serial: a port path is required. Choose one in Settings → SERIAL.')
    }
    try {
      // Copied, not passed through: callers hand us a `ref`'s value, and a Vue
      // reactive object is a Proxy, which the structured clone behind
      // contextBridge/IPC refuses ("An object could not be cloned"). Every
      // field of SerialConfig is a primitive, so a shallow copy is plain again.
      await window.api!.serial.connect(portPath, { ...config })
    } catch (err) {
      // Main pushes `error` on a failed open too, but not on a rejected
      // invoke — an unregistered handler, a destroyed window — and a caller
      // that saw `connecting` needs an ending either way.
      this.statusCallbacks.forEach((cb) => cb('error'))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    await window.api!.serial.disconnect()
    // The definitive status arrives on IPC.SERIAL_STATUS.
  }

  send(data: Uint8Array): void {
    window.api!.serial.send(data)
  }

  onData(cb: (d: Uint8Array) => void): () => void {
    this.dataCallbacks.add(cb)
    return () => this.dataCallbacks.delete(cb)
  }

  onStatus(cb: (s: SerialStatus) => void): () => void {
    this.statusCallbacks.add(cb)
    return () => this.statusCallbacks.delete(cb)
  }
}

// ── Factory (one instance per platform) ──────────────────────────────────────

let _web: WebSerialService | null = null
let _electron: ElectronSerialService | null = null

export function createSerialService(): ISerialService {
  if (isElectron()) {
    _electron ??= new ElectronSerialService()
    return _electron
  }
  _web ??= new WebSerialService()
  return _web
}
