/**
 * The shape of `window.api`, exposed by the Electron preload via contextBridge
 * and consumed by the renderer's service layer, so TypeScript verifies both
 * sides of the bridge. Present under Electron, absent in the web build — which
 * is how the renderer picks IPC serial over Web Serial.
 *
 * Filled out in Phase 6: `app`, `window`, `boot`, `serial`, `settings`, `cli`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppApi {}
