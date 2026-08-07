#! /usr/bin/env node

import { CommanderError } from 'commander'
import { UsageError, parseArgs } from './args'
import { launchApp } from './launch'

/**
 * `vtac [flags]` — open the app with those flags applied.
 *
 * No subcommands, and nothing here prints terminal output: the window is the
 * output (PLAN.md §Divergences). Every flag either describes the window to
 * open, the line to open, or the file to feed it — and all three cross to the
 * app as a `BootConfig`.
 */
async function main(argv: string[]): Promise<number> {
  const { config, app } = parseArgs(argv)
  // `VTAC_APP` is the same escape hatch as `--app`, for a shell profile that
  // knows where an AppImage or a development build lives.
  return launchApp(config, { app: app ?? process.env.VTAC_APP })
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    // Commander has already written the help, the version, or its own complaint
    // about the flag it could not read; only the exit code is left to set.
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode
      return
    }

    // v1 wrote these to stdout. stderr is where they belong — the text is what
    // a script greps for, and it is unchanged.
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    if (!(error instanceof UsageError) && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`)
    }
    process.exitCode = 1
  })
