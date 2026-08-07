import type { PortInfo, SerialConfig, SerialStatus } from '@shared/types'

/**
 * One interface, two ports: `serialport` over IPC under Electron, the Web
 * Serial API in the browser. The renderer is the same code in both builds and
 * the factory in `serial.ts` picks which one it got.
 */
export interface ISerialService {
  /** Whether this platform can open a serial port at all. */
  isAvailable(): boolean
  /** Electron: the detected ports. Web: always `[]` — see `connect`. */
  listPorts(): Promise<PortInfo[]>
  /**
   * Open a connection.
   *
   * - Electron: `portPath` is required, and comes from the port picker.
   * - Web: `portPath` is ignored. The browser insists on choosing the port
   *   itself, from a user gesture, which is why listing is not offered.
   */
  connect(config: SerialConfig, portPath?: string): Promise<void>
  disconnect(): Promise<void>
  /** Write raw bytes to the open port. */
  send(data: Uint8Array): void
  /** Subscribe to received bytes. Returns an unsubscribe function. */
  onData(cb: (data: Uint8Array) => void): () => void
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatus(cb: (status: SerialStatus) => void): () => void
}
