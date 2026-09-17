import { DEFAULT_SERIAL_CONFIG } from '../../shared/types'
import type { SerialConfig } from '../../shared/types'

/**
 * What VT-AC actually asks the driver for when it opens a port.
 *
 * The framing fields were always passed and always visible in the panel, so a
 * wrong one shows itself the moment anything is typed. Flow control is the
 * opposite: `serialport` defaults `rtscts` to `false`, which is a working port
 * that quietly drops whatever arrives after the far end asks it to stop — for
 * two releases VT-AC could not do the RTS/CTS the AC6502 documentation asks a
 * terminal for, and nothing on screen said so. The open call is the only place
 * that can be checked, so it is checked here.
 */

interface OpenOptions {
  path: string
  baudRate: number
  dataBits: number
  parity: string
  stopBits: number
  rtscts: boolean
  autoOpen: boolean
}

const mockOpened: OpenOptions[] = []

jest.mock('serialport', () => ({
  SerialPort: class {
    isOpen = false
    constructor(options: OpenOptions) {
      mockOpened.push(options)
    }
    open(callback: (err: Error | null) => void): void {
      this.isOpen = true
      callback(null)
    }
    on(): void {}
    close(callback: (err: Error | null) => void): void {
      this.isOpen = false
      callback(null)
    }
  }
}))

import { SerialService } from '../../main/serial'

const openWith = async (config: SerialConfig): Promise<OpenOptions> => {
  mockOpened.length = 0
  await new SerialService().connect('/dev/cu.usbserial-FTDMBHZ7', config)
  return mockOpened[0]
}

describe('SerialService.connect', () => {
  it('opens with RTS/CTS on, because that is the default', () => {
    // The emulator made the same call for the same reason: a real board and a
    // real terminal do hardware flow control, and a far end that never lowers
    // CTS is unaffected by being listened to.
    return expect(openWith(DEFAULT_SERIAL_CONFIG)).resolves.toMatchObject({ rtscts: true })
  })

  it('opens with RTS/CTS on for a config saved before the option existed', async () => {
    // `settings.json` from v2.0.0, read back and handed over the IPC bridge
    // exactly as stored — no `rtscts` in it at all.
    const saved = { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 } as SerialConfig

    expect(await openWith(saved)).toMatchObject({ rtscts: true })
  })

  it('turns RTS/CTS off when it has been turned off', async () => {
    // A three-wire cable: CTS is not wired, and watching it would mean never
    // sending a byte.
    expect(await openWith({ ...DEFAULT_SERIAL_CONFIG, rtscts: false })).toMatchObject({
      rtscts: false
    })
  })

  it('passes the framing through as chosen, and opens the port itself', async () => {
    expect(
      await openWith({ baudRate: 115200, dataBits: 7, parity: 'even', stopBits: 2, rtscts: true })
    ).toEqual({
      path: '/dev/cu.usbserial-FTDMBHZ7',
      baudRate: 115200,
      dataBits: 7,
      parity: 'even',
      stopBits: 2,
      rtscts: true,
      // The service opens the port in its own callback so a failure can be
      // reported as a status rather than thrown from a constructor.
      autoOpen: false
    })
  })
})
