/**
 * Types shared across the terminal core.
 *
 * The core is deliberately self-contained: nothing here imports from
 * `src/shared`, so `src/core` compiles under the Jest project, the CLI project
 * and the renderer project alike. Phase 6's `src/shared/types.ts` re-exports
 * `Personality` rather than redeclaring it.
 */

/**
 * Which protocol the terminal speaks.
 *
 * - `native` — VT-AC's own byte protocol, byte-for-byte v1.3.0 (plus the ESC
 *   extensions Phase 4 adds). The default.
 * - `vt100`  — the VT-100/ANSI compatibility mode (Phase 5).
 *
 * The fiction is a terminal that shipped with its own protocol *and* a VT-100
 * mode, which is what a vendor competing with DEC would have done. Where the
 * two disagree, both are kept and this switch selects between them.
 */
export type Personality = 'native' | 'vt100'
