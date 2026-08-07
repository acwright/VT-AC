import type {
  AppSettings,
  CliShimStatus,
  PortInfo,
  SerialConfig,
  SerialStatus
} from './types'

/**
 * The shape of `window.api`, exposed by the Electron preload via contextBridge
 * and consumed by the renderer's service layer, so TypeScript verifies both
 * sides of the bridge. Present under Electron, absent in the web build — which
 * is how the renderer picks IPC serial over Web Serial.
 */
export interface AppApi {
  app: {
    getVersion(): Promise<string>
  }
  window: {
    toggleFullscreen(): Promise<void>
    isFullscreen(): Promise<boolean>
    onFullscreenChanged(callback: (value: boolean) => void): () => void
  }
  boot: {
    /**
     * The file and settings `vtac` launched this window with — null when the
     * app was opened any other way. Main has already read the files.
     *
     * Always null until Phase 8 gives the CLI something to write.
     */
    get(): Promise<unknown | null>
  }
  serial: {
    listPorts(): Promise<PortInfo[]>
    connect(path: string, config: SerialConfig): Promise<void>
    disconnect(): Promise<void>
    /** Send bytes to the connected port. Fire-and-forget for latency. */
    send(data: Uint8Array): void
    onData(callback: (data: Uint8Array) => void): () => void
    onStatus(callback: (status: SerialStatus) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(partial: Partial<AppSettings>): Promise<void>
  }
  cli: {
    status(): Promise<CliShimStatus>
    install(): Promise<{ ok: boolean; message: string }>
    uninstall(): Promise<{ ok: boolean; message: string }>
  }
}
