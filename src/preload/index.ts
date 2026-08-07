import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// `window.api` gains app / window / boot / serial / settings / cli in Phase 6.
// Until then it exists only so the renderer's `isElectron` check — the same
// check that selects Web Serial in the browser build — has something to find.
const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
