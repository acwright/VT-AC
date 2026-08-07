import type { BootPayload } from '@shared/boot'

/**
 * What `vtac` launched this window with, if anything.
 *
 * Fetched once and shared: main reads the files on the first ask and hands the
 * same promise to every later one, so a hot reload during development cannot
 * replay a data file into a terminal that already has it.
 *
 * Null in the web build and whenever the app was opened by hand. Every caller
 * treats that as "start normally", so there is no separate flag for it.
 */
let pending: Promise<BootPayload | null> | undefined

export function bootPayload(): Promise<BootPayload | null> {
  pending ??= window.api ? window.api.boot.get().catch(() => null) : Promise.resolve(null)
  return pending
}
