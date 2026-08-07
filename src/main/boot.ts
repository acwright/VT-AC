import { readFileSync, unlinkSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { BOOT_CONFIG_SWITCH } from '../shared/boot'
import type { BootConfig, BootPayload } from '../shared/boot'

/**
 * The main-process half of `vtac`.
 *
 * The CLI left a JSON file and named it on our command line; this reads it, and
 * then reads the data file it points at. Nothing here decides anything about
 * the terminal — the renderer owns that — so this is deliberately just
 * filesystem access on the renderer's behalf, which is the one thing it cannot
 * do itself.
 */

/** The boot config named on this process's command line, if there is one. */
export function bootConfigFrom(argv: string[]): BootConfig | undefined {
  const arg = argv.find((value) => value.startsWith(BOOT_CONFIG_SWITCH))
  if (!arg) return undefined

  const path = arg.slice(BOOT_CONFIG_SWITCH.length)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    console.error('[boot] cannot read boot config:', e)
    return undefined
  }

  // A temp file whose whole life is this launch. Removing it now means a crash
  // between here and the window appearing still leaves nothing behind.
  try {
    unlinkSync(path)
  } catch {
    /* Already gone, or not ours to remove. */
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return parsed as BootConfig
  } catch (e) {
    console.error('[boot] boot config is not valid JSON:', e)
    return undefined
  }
}

/**
 * Read what the config points at.
 *
 * A file that cannot be read is collected rather than thrown: the CLI already
 * checked it before launching, so a failure here happened in the moment
 * between, and a terminal that comes up empty and says why beats a window that
 * never opens.
 */
export async function readBootPayload(config: BootConfig): Promise<BootPayload> {
  const errors: string[] = []

  let load: BootPayload['load']
  if (config.load !== undefined) {
    try {
      load = { label: basename(config.load), bytes: new Uint8Array(await readFile(config.load)) }
    } catch (e) {
      errors.push(`load: cannot read "${config.load}" (${(e as Error).message})`)
    }
  }

  return {
    ...(load ? { load } : {}),
    ...(config.serialPort ? { serialPort: config.serialPort } : {}),
    fullscreen: config.fullscreen === true,
    errors
  }
}
