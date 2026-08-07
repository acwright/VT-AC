import { Command } from 'commander'
import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'
import { BANNER } from './banner'
import { cliVersion } from './version'
import { DEFAULT_SERIAL_CONFIG, MAX_SCALE, MIN_SCALE } from '../shared/types'
import type { AppSettings, Columns, Personality, SerialConfig } from '../shared/types'
import type { BootConfig } from '../shared/boot'

/**
 * `vtac`'s command line: v1's option set verbatim, plus `--mode`, `--columns`
 * and `--app`.
 *
 * Every flag ends up in a `BootConfig` for the app to apply — there is no
 * headless mode and no subcommand, because the window is the output. What this
 * file owns is the translation and the refusals: a bad value is a message in
 * the shell, not a window that opens misconfigured.
 */

/** A bad command line. The entry point prints the message and exits 1. */
export class UsageError extends Error {}

export interface ParsedArgs {
  config: BootConfig
  /** `--app` — where the desktop app is, when it is not where `launch` looks. */
  app?: string
}

/**
 * The option set.
 *
 * `exitOverride` so a bad flag throws instead of ending the process: the entry
 * point decides what to print, and the tests can call this directly. Help and
 * version still write their text first, exactly as commander always did.
 */
export function createProgram(): Command {
  const version = cliVersion()

  return new Command()
    .name('vtac')
    .description('A fantasy VT terminal.')
    .version(version, '-v, --version', 'Output the current version')
    .helpOption('-h, --help', 'Output help / options')
    .showHelpAfterError()
    .exitOverride()
    .option('-p, --port <port>', 'Path to the serial port (e.g., /dev/ttyUSB0)')
    .option('-b, --baudrate <baudrate>', 'Baud Rate', '9600')
    .option('-a, --parity <parity>', 'Parity (odd | even | none)', 'none')
    .option('-d, --databits <databits>', 'Data Bits (5 | 6 | 7 | 8)', '8')
    .option('-t, --stopbits <stopbits>', 'Stop Bits (1 | 1.5 | 2)', '1')
    .option('-f, --fullscreen', 'Enable fullscreen mode', false)
    .option('-s, --scale <scale>', 'Window scale (1 - 6)')
    .option('-l, --load <load>', 'Path to data file to load (e.g. /path/to/data.bin)')
    .option('-m, --mode <mode>', 'Terminal personality (native | vt100)')
    .option('-c, --columns <columns>', 'Column mode (40 | 80)')
    .option('--app <path>', 'Path to the VT-AC application, if it is not where vtac looks')
    .addHelpText('beforeAll', `${BANNER}\nVersion: ${version} | A.C. Wright Design\n`)
}

/** Parse a command line into what the app should launch with. */
export function parseArgs(argv: string[]): ParsedArgs {
  const program = createProgram()
  program.parse(argv, { from: 'user' })

  // Every framing flag carries a default, so `opts()` alone cannot tell
  // `vtac -b 9600` from plain `vtac`. The difference matters: the first is a
  // launch-only override, the second must leave the saved settings alone.
  // Undefined is the source of a flag with no default that nobody typed.
  const given = (name: string): boolean => {
    const source = program.getOptionValueSource(name)
    return source !== undefined && source !== 'default'
  }

  return buildBootConfig(program.opts(), given)
}

/**
 * Flags → `BootConfig`.
 *
 * Split from the parse above so it can be driven with plain objects, and so the
 * validation sits in one readable block. The messages are v1's, character for
 * character, because someone with a script that greps for them is exactly the
 * kind of user this release promises not to break.
 */
export function buildBootConfig(
  values: Record<string, unknown>,
  given: (name: string) => boolean
): ParsedArgs {
  const text = (name: string): string | undefined => {
    const value = values[name]
    return typeof value === 'string' ? value : undefined
  }

  const settings: Partial<AppSettings> = {}

  // Framing is all-or-nothing: any one of the four flags builds a whole
  // `SerialConfig` from v1's defaults, so `vtac -b 19200` opens 19200 8-N-1
  // exactly as v1 did rather than pairing a new baud rate with whatever parity
  // was left in the settings file. None of them, and the saved framing stands.
  if (given('baudrate') || given('parity') || given('databits') || given('stopbits')) {
    settings.serialConfig = {
      ...DEFAULT_SERIAL_CONFIG,
      baudRate: baudRate(text('baudrate')),
      parity: parity(text('parity')),
      dataBits: dataBits(text('databits')),
      stopBits: stopBits(text('stopbits'))
    }
  }

  if (given('mode')) settings.personality = personality(text('mode'))
  if (given('columns')) settings.columns = columns(text('columns'))

  const load = text('load')

  return {
    ...(text('app') !== undefined ? { app: text('app') } : {}),
    config: {
      ...(load !== undefined ? { load: readable(load) } : {}),
      ...(text('port') !== undefined ? { serialPort: text('port') } : {}),
      ...(values.fullscreen === true ? { fullscreen: true } : {}),
      // Unlike v1, an unspecified scale is not 2 — it is whatever the window
      // was last sized to, which the app now remembers. A flag that silently
      // resized someone's window on every launch would be the worse default.
      ...(given('scale') ? { scale: scale(text('scale')) } : {}),
      ...(Object.keys(settings).length > 0 ? { settings } : {})
    }
  }
}

// ── Values ───────────────────────────────────────────────────────────────────

function baudRate(value: string | undefined): number {
  const rate = Number(value)
  if (!Number.isInteger(rate) || rate <= 0) throw new UsageError('Error: Invalid Baud Rate')
  return rate
}

/**
 * v1 cast this one without checking it, and a bad parity surfaced as whatever
 * `serialport` said when the open failed — which in v2 would be a window with a
 * dead line and nothing on screen to explain it. Checked here, in v1's voice.
 */
function parity(value: string | undefined): SerialConfig['parity'] {
  if (value !== 'odd' && value !== 'even' && value !== 'none') {
    throw new UsageError('Error: Invalid Parity')
  }
  return value
}

function dataBits(value: string | undefined): SerialConfig['dataBits'] {
  const bits = Number.parseInt(value ?? '', 10)
  if (bits !== 5 && bits !== 6 && bits !== 7 && bits !== 8) {
    throw new UsageError('Error: Invalid Data Bits')
  }
  return bits
}

function stopBits(value: string | undefined): SerialConfig['stopBits'] {
  const bits = Number.parseFloat(value ?? '')
  if (bits !== 1 && bits !== 1.5 && bits !== 2) {
    throw new UsageError('Error: Invalid Stop Bits')
  }
  return bits
}

function scale(value: string | undefined): number {
  const factor = Number(value)
  if (!Number.isInteger(factor) || factor < MIN_SCALE || factor > MAX_SCALE) {
    throw new UsageError('Error: Invalid Scale')
  }
  return factor
}

function personality(value: string | undefined): Personality {
  if (value !== 'native' && value !== 'vt100') throw new UsageError('Error: Invalid Mode')
  return value
}

function columns(value: string | undefined): Columns {
  const count = Number.parseInt(value ?? '', 10)
  if (count !== 40 && count !== 80) throw new UsageError('Error: Invalid Columns')
  return count
}

/**
 * A data file, resolved against the shell's working directory and checked here.
 *
 * The app is launched from somewhere else entirely and starts with no console,
 * so a mistyped filename has to fail in the terminal that typed it. Main reads
 * the file again for real — the gap between the two is why `BootPayload` still
 * carries an `errors` list.
 */
function readable(path: string): string {
  const full = resolve(path)
  try {
    accessSync(full, constants.R_OK)
  } catch {
    throw new UsageError(`Error loading file: cannot read "${path}"`)
  }
  return full
}
