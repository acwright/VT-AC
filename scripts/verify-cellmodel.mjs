#!/usr/bin/env node
/**
 * Phase 2 equivalence check: the cell model against the framebuffer it replaced.
 *
 * `VTAC.test.ts` asserts a few dozen pixels. This asserts all 76,800 of them,
 * after every byte of every stream, against v1's actual code — the pre-refactor
 * `VTAC.ts`, pulled out of git rather than reimplemented, so there is no chance
 * of the oracle having absorbed the refactor's assumptions.
 *
 * Streams checked:
 *   - the three `examples/*.bin` files, which is what PLAN.md asks for;
 *   - seeded pseudo-random byte streams, which is what actually exercises the
 *     instruction set — the examples never scroll, never use `deleteTo`, and
 *     never mix text and graphics into the same cell.
 *
 * Usage: node scripts/verify-cellmodel.mjs [--ref <git-ref>] [--verbose]
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')
const REF_INDEX = args.indexOf('--ref')
// The commit before the cell model landed. Its `src/core/VTAC.ts` is v1.3.0's
// terminal with Phase 1's `CHARACTERS` extraction and nothing else.
const REF = REF_INDEX === -1 ? 'HEAD' : args[REF_INDEX + 1]

//
// BUILD — transpile the current core and the reference side by side
//

const work = mkdtempSync(join(tmpdir(), 'vtac-cellmodel-'))
const ts = require('typescript')

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  }).outputText
}

try {
  const coreDir = join(ROOT, 'src', 'core')
  mkdirSync(join(work, 'core'), { recursive: true })

  for (const entry of readdirSync(coreDir)) {
    if (!entry.endsWith('.ts')) continue
    const source = readFileSync(join(coreDir, entry), 'utf8')
    writeFileSync(join(work, 'core', entry.replace(/\.ts$/, '.js')), transpile(source, entry))
  }

  const reference = execFileSync('git', ['show', `${REF}:src/core/VTAC.ts`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  writeFileSync(join(work, 'core', 'VTAC.reference.js'), transpile(reference, 'VTAC.reference.ts'))

  const { VTAC: Current } = require(join(work, 'core', 'VTAC.js'))
  const { VTAC: Reference } = require(join(work, 'core', 'VTAC.reference.js'))

  //
  // STREAMS
  //

  /** Deterministic 32-bit PRNG — mulberry32, so a failure is reproducible. */
  function prng(seed) {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const streams = []

  const examplesDir = join(ROOT, 'examples')
  for (const entry of readdirSync(examplesDir).sort()) {
    if (!entry.endsWith('.bin')) continue
    streams.push({ name: `examples/${entry}`, bytes: readFileSync(join(examplesDir, entry)) })
  }

  // Uniform random bytes hit every command roughly equally, which is nothing
  // like a real stream but is exactly what a differential test wants: the
  // rarely-taken branches (scroll, deleteTo, mode flips mid-cell) get taken.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const random = prng(seed)
    const bytes = Buffer.alloc(4096)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256)
    streams.push({ name: `random/uniform/seed-${seed}`, bytes })
  }

  // A stream weighted towards printable text and line feeds, so the screen
  // fills and scrolls repeatedly rather than being reset every few bytes.
  for (const seed of [11, 12, 13]) {
    const random = prng(seed)
    const bytes = Buffer.alloc(8192)
    for (let i = 0; i < bytes.length; i++) {
      const roll = random()
      if (roll < 0.7) bytes[i] = 0x20 + Math.floor(random() * 0x5f)
      else if (roll < 0.85) bytes[i] = 0x0a
      else bytes[i] = Math.floor(random() * 0x20)
    }
    streams.push({ name: `random/text-heavy/seed-${seed}`, bytes })
  }

  //
  // COMPARE
  //

  const STATE_FIELDS = [
    'column',
    'row',
    'offset',
    'mode',
    'cursorChar',
    'cursorMode',
    'foregroundColor',
    'backgroundColor',
    'bellDuration',
    'bellFrequency'
  ]

  function compare(stream) {
    const current = new Current()
    const reference = new Reference()

    for (let i = 0; i < stream.bytes.length; i++) {
      const byte = stream.bytes[i]
      current.parse(byte)
      reference.parse(byte)

      if (Buffer.compare(current.buffer, reference.buffer) !== 0) {
        const a = current.buffer
        const b = reference.buffer
        let at = 0
        while (at < a.length && a[at] === b[at]) at++
        return {
          byteIndex: i,
          byte,
          detail:
            `pixel ${at} (x=${at % current.width}, y=${Math.floor(at / current.width)}): ` +
            `cell model 0x${a[at].toString(16).padStart(2, '0')}, ` +
            `v1 0x${b[at].toString(16).padStart(2, '0')}`
        }
      }

      for (const field of STATE_FIELDS) {
        if (current[field] !== reference[field]) {
          return {
            byteIndex: i,
            byte,
            detail: `${field}: cell model ${current[field]}, v1 ${reference[field]}`
          }
        }
      }

      if (current.bellQueue.length !== reference.bellQueue.length) {
        return { byteIndex: i, byte, detail: 'bellQueue length diverged' }
      }
    }

    return null
  }

  console.log(`Comparing src/core against ${REF}:src/core/VTAC.ts\n`)

  let failures = 0
  let bytesChecked = 0

  for (const stream of streams) {
    const started = Date.now()
    const failure = compare(stream)
    bytesChecked += stream.bytes.length

    if (failure === null) {
      const elapsed = Date.now() - started
      console.log(
        `  ok    ${stream.name.padEnd(28)} ${String(stream.bytes.length).padStart(6)} bytes` +
          (VERBOSE ? ` (${elapsed}ms)` : '')
      )
    } else {
      failures++
      console.log(`  FAIL  ${stream.name}`)
      console.log(
        `        diverged at byte ${failure.byteIndex} ` +
          `(0x${failure.byte.toString(16).padStart(2, '0')})`
      )
      console.log(`        ${failure.detail}`)
    }
  }

  const total = streams.length
  console.log(
    `\n${total - failures}/${total} streams identical ` +
      `(${bytesChecked.toLocaleString()} bytes, full framebuffer compared after every one)`
  )

  if (failures > 0) {
    console.log('\nThe cell model is not behaviour-preserving. Phase 2 is not done.')
    process.exitCode = 1
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
