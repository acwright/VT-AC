import { WebSettingsService, WEB_SETTINGS_KEY } from '@/services/settings'
import { DEFAULT_APP_SETTINGS } from '@shared/types'
import type { KeyValueStore } from '@/services/settings'

/**
 * The web build's settings store.
 *
 * The renderer is otherwise driven rather than unit-tested — components are
 * verified by running the app — but this one has logic that no amount of
 * clicking around makes obvious: what a half-written or hand-edited value in
 * `localStorage` does to a terminal on the next load. `KeyValueStore` is two
 * methods wide precisely so that can be asked here.
 */

function fakeStore(initial?: string): KeyValueStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string): string | null {
      return key === WEB_SETTINGS_KEY ? this.value : null
    },
    setItem(key: string, value: string): void {
      if (key === WEB_SETTINGS_KEY) this.value = value
    }
  }
}

describe('WebSettingsService', () => {
  it('starts at the defaults when nothing has been stored', async () => {
    const settings = await new WebSettingsService(fakeStore()).get()
    expect(settings).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('round-trips what was set', async () => {
    const store = fakeStore()
    const service = new WebSettingsService(store)

    await service.set({ personality: 'vt100', columns: 80 })

    // A fresh service, because that is what the next page load is.
    const settings = await new WebSettingsService(store).get()
    expect(settings.personality).toBe('vt100')
    expect(settings.columns).toBe(80)
  })

  it('merges partial writes instead of replacing the record', async () => {
    const store = fakeStore()
    const service = new WebSettingsService(store)

    await service.set({ columns: 80 })
    await service.set({ bellMuted: true })

    const settings = await service.get()
    expect(settings.columns).toBe(80)
    expect(settings.bellMuted).toBe(true)
    // Untouched by either write, and still the default rather than dropped.
    expect(settings.serialConfig).toEqual(DEFAULT_APP_SETTINGS.serialConfig)
  })

  it('fills in keys a settings record written by an older build never had', async () => {
    const store = fakeStore(JSON.stringify({ columns: 80 }))
    const settings = await new WebSettingsService(store).get()

    expect(settings.columns).toBe(80)
    expect(settings.personality).toBe(DEFAULT_APP_SETTINGS.personality)
    expect(settings.bellVolume).toBe(DEFAULT_APP_SETTINGS.bellVolume)
  })

  it('falls back to the defaults on a corrupt record, and overwrites it', async () => {
    const store = fakeStore('{ not json')
    const service = new WebSettingsService(store)

    expect(await service.get()).toEqual(DEFAULT_APP_SETTINGS)

    // The bad value is not preserved by the read-modify-write — a terminal that
    // failed to parse its settings once should not do it again on every load.
    await service.set({ columns: 80 })
    expect(await service.get()).toEqual({ ...DEFAULT_APP_SETTINGS, columns: 80 })
  })

  it('keeps working when the browser has no storage at all', async () => {
    // Safari in private mode, and any browser with storage disabled: the
    // setting still applies to this session, it just does not outlive it.
    const service = new WebSettingsService(undefined)

    await expect(service.set({ columns: 80 })).resolves.toBeUndefined()
    expect(await service.get()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('survives a store that throws on write', async () => {
    const store: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      }
    }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(new WebSettingsService(store).set({ columns: 80 })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })
})
