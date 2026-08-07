#! /usr/bin/env node

import { cliVersion } from './version'

// Phase 0 scaffold. Phase 8 replaces this body with `args.ts` (commander, v1's
// full option set plus --mode and --columns) and `launch.ts` (write a
// BootConfig to a temp file, spawn the app with --boot-config, exit 0).
//
// There are no subcommands and nothing prints terminal output: every flag
// launches the app, and the window is the output.

const argv = process.argv.slice(2)

if (argv.includes('-v') || argv.includes('--version')) {
  process.stdout.write(`${cliVersion()}\n`)
  process.exitCode = 0
} else {
  process.stderr.write('vtac: not implemented yet — see PLAN.md Phase 8\n')
  process.exitCode = 1
}
