import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BANNER } from '../../cli/banner'
import { UsageError, parseArgs } from '../../cli/args'

/**
 * `vtac`'s command line is v1's, so what it does with each flag is a
 * compatibility claim: someone with a shell alias or a Makefile written against
 * v1.3.0 gets the same terminal, now in a window. The two new flags and the
 * launch-only rule are the only additions.
 */

const dir = mkdtempSync(join(tmpdir(), 'vtac-args-test-'))
const dataFile = join(dir, 'characters.bin')
writeFileSync(dataFile, Buffer.from([0x41, 0x42, 0x43]))

const parse = (...argv: string[]): ReturnType<typeof parseArgs> => parseArgs(argv)
const config = (...argv: string[]): ReturnType<typeof parseArgs>['config'] => parse(...argv).config

describe('vtac flags', () => {
  it('launches with nothing set when given nothing', () => {
    // The saved settings are the app's own business — a bare `vtac` must not
    // reach in and rewrite the framing, the geometry or the window size.
    expect(config()).toEqual({})
  })

  it('-p names the port to open', () => {
    expect(config('-p', '/dev/ttyUSB0').serialPort).toBe('/dev/ttyUSB0')
    expect(config('--port', '/dev/ttyUSB0').serialPort).toBe('/dev/ttyUSB0')
  })

  it('-f opens fullscreen', () => {
    expect(config('-f').fullscreen).toBe(true)
    expect(config('--fullscreen').fullscreen).toBe(true)
  })

  it('-s sets the window scale', () => {
    expect(config('-s', '4').scale).toBe(4)
    expect(config('--scale', '1').scale).toBe(1)
  })

  it('-l resolves the data file to an absolute path', () => {
    expect(config('-l', dataFile).load).toBe(dataFile)
    expect(config('--load', dataFile).load).toBe(dataFile)
  })

  it('-l refuses a file it cannot read, before anything is launched', () => {
    const missing = join(dir, 'nope.bin')
    expect(() => config('-l', missing)).toThrow(UsageError)
    expect(() => config('-l', missing)).toThrow(`Error loading file: cannot read "${missing}"`)
  })

  it('--app is an escape hatch, not part of the boot config', () => {
    const parsed = parse('--app', '/Applications/VT-AC.app')
    expect(parsed.app).toBe('/Applications/VT-AC.app')
    expect(parsed.config).toEqual({})
  })
})

describe('serial framing', () => {
  it('builds a whole framing from any one flag, starting at v1 defaults', () => {
    // `vtac -b 19200` is 19200 8-N-1 in v1, not 19200 paired with whatever
    // parity happened to be in the settings file.
    expect(config('-b', '19200').settings).toEqual({
      serialConfig: { baudRate: 19200, dataBits: 8, parity: 'none', stopBits: 1 }
    })
  })

  it('takes all four flags together', () => {
    expect(config('-b', '115200', '-a', 'even', '-d', '7', '-t', '2').settings).toEqual({
      serialConfig: { baudRate: 115200, dataBits: 7, parity: 'even', stopBits: 2 }
    })
  })

  it('accepts 1.5 stop bits', () => {
    expect(config('-t', '1.5').settings?.serialConfig?.stopBits).toBe(1.5)
  })

  it('leaves the saved framing alone when no framing flag is given', () => {
    expect(config('-p', '/dev/ttyUSB0').settings).toBeUndefined()
  })

  it("reports v1's messages for the values v1 refused", () => {
    expect(() => config('-d', '9')).toThrow('Error: Invalid Data Bits')
    expect(() => config('-t', '3')).toThrow('Error: Invalid Stop Bits')
    // v1 cast this one without checking it; the text is in its voice.
    expect(() => config('-a', 'odder')).toThrow('Error: Invalid Parity')
  })

  it('refuses a baud rate that is not a number', () => {
    expect(() => config('-b', 'fast')).toThrow('Error: Invalid Baud Rate')
  })
})

describe('the two new flags', () => {
  it('--mode selects a personality', () => {
    expect(config('-m', 'vt100').settings).toEqual({ personality: 'vt100' })
    expect(config('--mode', 'native').settings).toEqual({ personality: 'native' })
  })

  it('--columns selects the geometry', () => {
    expect(config('-c', '80').settings).toEqual({ columns: 80 })
    expect(config('--columns', '40').settings).toEqual({ columns: 40 })
  })

  it('refuses anything else', () => {
    expect(() => config('-m', 'vt220')).toThrow('Error: Invalid Mode')
    expect(() => config('-c', '132')).toThrow('Error: Invalid Columns')
    expect(() => config('-s', '9')).toThrow('Error: Invalid Scale')
  })

  it('carries a whole launch across at once', () => {
    expect(config('-p', '/dev/ttyUSB0', '-b', '19200', '-m', 'vt100', '-c', '80', '-f')).toEqual({
      serialPort: '/dev/ttyUSB0',
      fullscreen: true,
      settings: {
        serialConfig: { baudRate: 19200, dataBits: 8, parity: 'none', stopBits: 1 },
        personality: 'vt100',
        columns: 80
      }
    })
  })
})

describe('the help banner', () => {
  it('is what figlet draws for VT-AC in cricket', () => {
    // Inlined so the packaged CLI has no font files to find at run time
    // (PLAN.md Phase 8). This is the check that the copy stayed a copy.
    const figlet = require('figlet') as { textSync(text: string, options: unknown): string }
    expect(BANNER).toBe(figlet.textSync('VT-AC', { font: 'cricket' }))
  })
})
