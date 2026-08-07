import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOOT_CONFIG_SWITCH } from '../../shared/boot'
import type { BootConfig } from '../../shared/boot'
import { bootConfigFrom, readBootPayload } from '../../main/boot'

/**
 * The CLI and main only ever meet through a temp file, so this is the whole of
 * that contract: what the CLI wrote arrives, the file does not outlive the
 * launch, and a file that has gone missing in between is a message rather than
 * a window that never opens.
 */

const dir = mkdtempSync(join(tmpdir(), 'vtac-boot-test-'))

let n = 0
function bootFile(config: unknown): string {
  const path = join(dir, `boot-${n++}.json`)
  writeFileSync(path, typeof config === 'string' ? config : JSON.stringify(config))
  return path
}

describe('bootConfigFrom', () => {
  it('is undefined when nothing launched us with a config', () => {
    expect(bootConfigFrom(['/path/to/electron', '.'])).toBeUndefined()
  })

  it('round-trips what the CLI wrote', () => {
    const config: BootConfig = {
      load: '/tmp/characters.bin',
      serialPort: '/dev/ttyUSB0',
      fullscreen: true,
      scale: 4,
      settings: {
        serialConfig: { baudRate: 19200, dataBits: 8, parity: 'none', stopBits: 1 },
        personality: 'vt100',
        columns: 80
      }
    }
    const path = bootFile(config)

    expect(bootConfigFrom(['electron', `${BOOT_CONFIG_SWITCH}${path}`])).toEqual(config)
  })

  it('deletes the file as soon as it has read it', () => {
    const path = bootFile({ fullscreen: true })

    bootConfigFrom([`${BOOT_CONFIG_SWITCH}${path}`])

    expect(existsSync(path)).toBe(false)
  })

  it('starts normally when the file is gone or is not JSON', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(bootConfigFrom([`${BOOT_CONFIG_SWITCH}${join(dir, 'never-written.json')}`])).toBeUndefined()
    expect(bootConfigFrom([`${BOOT_CONFIG_SWITCH}${bootFile('{ not json')}`])).toBeUndefined()
    // Valid JSON, but not an object — `null` would otherwise pass a typeof test.
    expect(bootConfigFrom([`${BOOT_CONFIG_SWITCH}${bootFile('null')}`])).toBeUndefined()

    error.mockRestore()
  })
})

describe('readBootPayload', () => {
  it('reads the data file, labelled with its name', async () => {
    const path = join(dir, 'characters.bin')
    writeFileSync(path, Buffer.from([0x41, 0x42, 0x43]))

    const payload = await readBootPayload({ load: path })

    expect(payload.load).toEqual({ label: 'characters.bin', bytes: new Uint8Array([0x41, 0x42, 0x43]) })
    expect(payload.errors).toEqual([])
  })

  it('passes the port and fullscreen through', async () => {
    expect(await readBootPayload({ serialPort: '/dev/ttyUSB0', fullscreen: true })).toEqual({
      serialPort: '/dev/ttyUSB0',
      fullscreen: true,
      errors: []
    })
  })

  it('is a bare start when the config asked for nothing', async () => {
    expect(await readBootPayload({})).toEqual({ fullscreen: false, errors: [] })
  })

  it('collects an unreadable file instead of refusing to boot', async () => {
    const missing = join(dir, 'deleted-since-the-cli-checked.bin')

    const payload = await readBootPayload({ load: missing, serialPort: '/dev/ttyUSB0' })

    expect(payload.load).toBeUndefined()
    expect(payload.errors).toHaveLength(1)
    expect(payload.errors[0]).toContain(missing)
    // The rest of the launch still happens — this is a terminal missing its
    // file, not a dead window.
    expect(payload.serialPort).toBe('/dev/ttyUSB0')
  })
})
