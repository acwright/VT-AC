import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { UsageError } from './args'
import { BOOT_CONFIG_SWITCH } from '../shared/boot'
import type { BootConfig } from '../shared/boot'

/**
 * Finding the desktop app, and starting it.
 *
 * `vtac` is not a terminal program that happens to open a window — the window
 * is the whole of it. So this hands the config over and gets out of the way:
 * spawn detached, return, leave the shell usable. v1's process stayed alive
 * because it *was* the window; keeping v2's alive would only make the shell
 * look occupied by something it no longer owns.
 */

/** The macOS executable inside an `.app` bundle. */
function macAppBinary(bundle: string): string {
  return join(bundle, 'Contents', 'MacOS', basename(bundle).replace(/\.app$/, ''))
}

/**
 * The Electron binary in a checkout's node_modules.
 *
 * `path.txt` is how the `electron` package records where its download landed,
 * which differs by platform; reading it beats guessing at `dist/Electron.app/…`.
 */
function checkoutElectron(root: string): string | undefined {
  const dir = join(root, 'node_modules', 'electron')
  try {
    const binary = join(dir, 'dist', readFileSync(join(dir, 'path.txt'), 'utf8').trim())
    return existsSync(binary) ? binary : undefined
  } catch {
    return undefined
  }
}

/**
 * Where an installed app lives, by platform.
 *
 * `/usr/local/bin/vtac` and `~/.local/bin/vtac` are deliberately absent: that is
 * where `CliShimService` writes the shim, and a search that found it would have
 * the CLI launch itself forever. The app binary is only ever looked for inside
 * an install directory.
 */
function installedCandidates(): string[] {
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return ['/Applications/VT-AC.app', join(home, 'Applications', 'VT-AC.app')].map(macAppBinary)
    case 'win32': {
      const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
      return [
        join(local, 'Programs', 'VT-AC', 'VT-AC.exe'),
        join('C:\\Program Files', 'VT-AC', 'VT-AC.exe')
      ]
    }
    default:
      // An AppImage can live anywhere, so it is not guessable — that is what
      // `--app` and `VTAC_APP` are for. These cover the deb's install layout,
      // whose executable name Phase 11 settles.
      return ['/opt/VT-AC/vtac', '/opt/VT-AC/vt-ac', '/opt/VT-AC/VT-AC', '/usr/bin/vt-ac']
  }
}

/**
 * Find the desktop app to launch.
 *
 * The installed case needs no search at all: the shim runs this CLI with
 * `ELECTRON_RUN_AS_NODE=1` inside the app's own Electron, so `process.execPath`
 * is already the app binary and launching it without that variable starts the
 * app itself. That is also what keeps the two from ever disagreeing on version.
 */
export function resolveApp(explicit?: string): { command: string; args: string[] } {
  if (explicit) {
    const command = explicit.endsWith('.app') ? macAppBinary(explicit) : explicit
    if (!existsSync(command)) throw new UsageError(`Error: Nothing to run at "${command}"`)
    return { command, args: [] }
  }

  if (process.versions.electron) return { command: process.execPath, args: [] }

  // A checkout: this file is out/cli/launch.js, two levels under the repo root.
  const root = join(__dirname, '..', '..')
  const electron = checkoutElectron(root)
  if (electron) {
    if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
      throw new UsageError('Error: The app is not built — run `npm run build` first')
    }
    return { command: electron, args: [root] }
  }

  const installed = installedCandidates().find((path) => existsSync(path))
  if (installed) return { command: installed, args: [] }

  throw new UsageError(
    'Error: Could not find the VT-AC app. Install it — Settings \u2192 COMMAND LINE \u2192 Install ' +
      'gives you a `vtac` that always finds it — or pass --app <path>, or set VTAC_APP.'
  )
}

/**
 * Hand the config to the app on disk rather than on its command line.
 *
 * Long arguments are quoted differently by every shell and every platform, and
 * a Windows path with a space in it is exactly where that goes wrong. Main
 * deletes the file as soon as it has read it.
 */
function writeBootFile(config: BootConfig): string {
  const path = join(tmpdir(), `vtac-boot-${process.pid}-${randomBytes(4).toString('hex')}.json`)
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  return path
}

/**
 * Launch the app and return.
 *
 * Detached, so closing the shell — or the shell closing itself, which is what
 * `vtac … &` in a script amounts to — does not take the terminal down with it.
 * The wait is for `spawn` or `error` only: both fire within a tick or two, and
 * waiting for one of them is the difference between reporting a missing binary
 * and exiting 0 on a window that never appeared.
 */
export async function launchApp(
  config: BootConfig,
  options: { app?: string } = {}
): Promise<number> {
  const { command, args } = resolveApp(options.app)
  const bootFile = writeBootFile(config)

  // The installed shim sets this to run us as Node; inherited by the child it
  // would start the app as a Node interpreter with no window at all.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(command, [...args, `${BOOT_CONFIG_SWITCH}${bootFile}`], {
    stdio: 'ignore',
    detached: true,
    env
  })

  return new Promise<number>((done, fail) => {
    child.on('spawn', () => {
      child.unref()
      done(0)
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      // Nothing read it, and nothing will — main is what normally removes it.
      try {
        unlinkSync(bootFile)
      } catch {
        /* Not there, or not ours. Either way the launch is the news. */
      }
      fail(
        new UsageError(
          e.code === 'ENOENT'
            ? `Error: Cannot launch "${command}"`
            : `Error: Cannot launch "${command}": ${e.message}`
        )
      )
    })
  })
}
