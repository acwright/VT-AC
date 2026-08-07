import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The CLI's own version — always the version of the app it belongs to, since
 * the shim (Phase 8) runs the CLI bundled inside the currently-installed app
 * rather than a separately-versioned package.
 *
 * `npm_package_version` only exists under an `npm run` script — never true for
 * the installed shim — so this reads `package.json` directly, two directories
 * up from the compiled file both in a checkout (`out/cli/version.js` → repo
 * root) and inside the packaged asar (`/out/cli/version.js` → `/package.json`,
 * the archive root).
 */
export function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? 'dev'
  } catch {
    return 'dev'
  }
}
