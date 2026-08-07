import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_APP_SETTINGS, DEFAULT_SERIAL_CONFIG } from '../../shared/types'
import { SettingsService } from '../../main/settings'

/**
 * `vtac -b 19200 --mode vt100` sets what the Settings panel sets, but for one
 * launch: someone talking to one device has not decided to change what the app
 * does tomorrow. That only holds if a launch value can never reach the file,
 * including by riding along with an unrelated save.
 */

const dir = mkdtempSync(join(tmpdir(), 'vtac-settings-test-'))
const settingsFile = join(dir, 'settings.json')

jest.mock('electron', () => ({
  app: { getPath: () => (global as { __settingsDir?: string }).__settingsDir }
}))

beforeAll(() => {
  ;(global as { __settingsDir?: string }).__settingsDir = dir
})

const onDisk = (): unknown =>
  existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : undefined

describe('SettingsService', () => {
  it('starts at VT-AC v1 defaults — 9600 8-N-1, native, 40 columns', () => {
    expect(new SettingsService().get()).toEqual({
      serialConfig: { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 },
      personality: 'native',
      columns: 40,
      scale: 3,
      fullscreen: false,
      bellMuted: false
    })
  })

  it('serves a launch override without writing it anywhere', () => {
    const settings = new SettingsService()
    settings.override({ personality: 'vt100', columns: 80 })

    expect(settings.get()).toMatchObject({ personality: 'vt100', columns: 80 })
    expect(onDisk()).toBeUndefined()
  })

  it('saves only what was actually chosen, never the launch values alongside it', () => {
    const settings = new SettingsService()
    settings.override({ personality: 'vt100', columns: 80 })

    // The panel writing an unrelated setting must not drag the overrides in —
    // this is how a one-launch `--mode vt100` would become the saved default.
    settings.set({ serialConfig: { ...DEFAULT_SERIAL_CONFIG, baudRate: 19200 } })

    expect(onDisk()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      serialConfig: { ...DEFAULT_SERIAL_CONFIG, baudRate: 19200 }
    })
    // Still in effect for the terminal, still only in memory.
    expect(settings.get().personality).toBe('vt100')
  })

  it('lets a deliberate change win over the launch value for that setting', () => {
    const settings = new SettingsService()
    settings.override({ personality: 'vt100' })
    settings.set({ personality: 'native' })

    // Otherwise the panel would appear to ignore the user for the rest of the
    // session, and the value they chose would be lost at the same time.
    expect(settings.get().personality).toBe('native')
    expect(onDisk()).toMatchObject({ personality: 'native' })
  })

  it('reads back what a previous run saved, filling in anything it predates', () => {
    // A settings.json written before a field existed must not produce an
    // `undefined` column count that the window sizing then divides by.
    new SettingsService().set({ lastPort: '/dev/cu.usbserial-FTDMBHZ7' })

    expect(new SettingsService().get()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      serialConfig: { ...DEFAULT_SERIAL_CONFIG, baudRate: 19200 },
      personality: 'native',
      lastPort: '/dev/cu.usbserial-FTDMBHZ7'
    })
  })
})
