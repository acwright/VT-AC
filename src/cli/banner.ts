/**
 * v1's help banner — `figlet.textSync('VT-AC', { font: 'Cricket' })`, frozen.
 *
 * Inlined rather than generated at run time, which PLAN.md Phase 8 names as the
 * alternative to verifying that `figlet` resolves from inside the packaged
 * app's asar. The installed `vtac` runs this file through the app's own
 * Electron with `ELECTRON_RUN_AS_NODE=1`, and figlet reads its font files off
 * disk at call time — exactly the shape of dependency that survives `npm run
 * cli` and fails once packaged. The banner is a constant; a constant is what it
 * should be.
 *
 * Regenerate with:
 *   npx figlet -f Cricket VT-AC
 */
export const BANNER = [
  '  ___ ___ _______        _______ _______ ',
  ' |   Y   |       |______|   _   |   _   |',
  ' |.  |   |.|   | |______|.  1   |.  1___|',
  " |.  |   `-|.  |-'      |.  _   |.  |___ ",
  ' |:  1   | |:  |        |:  |   |:  1   |',
  '  \\:.. ./  |::.|        |::.|:. |::.. . |',
  "   `---'   `---'        `--- ---`-------'",
  '                                         '
].join('\n')
