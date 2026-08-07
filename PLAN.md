# VT-AC v2.0.0 — Implementation Plan

**From:** `vtac-terminal` v1.3.0 — an npm package that opens an SDL window and
speaks a 40×30 pixel-buffer protocol.
**To:** VT-AC v2.0.0 — an Electron desktop app, a GitHub Pages web build, a
`vtac` CLI installed by the app itself, and a terminal that also does 80 columns
and speaks VT-100/ANSI.

## The idea

VT-AC emulates **a VT terminal that could have existed but didn't.** Not a
reproduction of a DEC VT100 — a plausible sibling of one. What makes it a
fantasy machine rather than an emulator is the combination no real terminal
had: DEC's command set and screen model, sitting on a 256-color RGB332
framebuffer, with a CP437 glyph ROM, a pixel-addressable graphics mode, and a
bell with a two-octave note table.

Every decision in this plan is measured against that. Where VT-100 behavior and
VT-AC's native protocol disagree, both are kept and selected by a personality
switch — because the fiction is a terminal that shipped with its own protocol
*and* a VT-100 compatibility mode, which is exactly what a real vendor competing
with DEC would have done.

**SDL is gone.** v1 rendered by handing a raw RGB332 byte buffer to
`sdl.video.createWindow().render(...)`. v2 renders to a `<canvas>` in every
target — desktop, web, and CLI-launched — exactly as the EMULATOR does.
`@kmamal/sdl` is removed from `package.json` in Phase 0 and `src/index.ts` is
deleted in Phase 8.

Reference project: `/Users/acwright/Developer/NodeJS/6502-EMULATOR` (v2.6.1),
which made the same npm-package → Electron + Pages + CLI move. Its architecture
is adopted wherever it fits; §Divergences lists what is deliberately not ported.

---

## Decisions taken

| Decision | Choice |
| --- | --- |
| Rendering | Canvas everywhere. No SDL, no native window rendering |
| 80-column geometry | 640×480, 80×60 cells, same 8×8 font — an exact 2× of today's grid |
| Protocol coexistence | Personality modes: `native` (default, byte-for-byte v1) or `vt100` |
| VT-100 scope | Full — scroll regions, SGR, alt screen, tab stops, line drawing. Target: `vi`, `htop`, ncurses |
| Color scheme | DEC beige enclosure + green phosphor screen (§2) |
| npm retirement | `npm deprecate`, package stays published; repo goes `private: true` |
| CLI surface | All v1 flags, plus `--mode` and `--columns`; every one launches the app |
| UI stack | Vue 3 + Pinia + Tailwind v4, matching the EMULATOR |

### What "behavior does not change" means now

It means this: **with default settings, VT-AC v2.0.0 processes a byte stream
identically to v1.3.0.** Personality defaults to `native`, geometry defaults to
40×30. Everything new is opt-in.

The mechanism that proves it: the existing `VTAC.test.ts` — 531 lines asserting
against `vtac.buffer` pixel contents — **is kept and must pass unmodified**
through every phase below. After the cell-model refactor `buffer` becomes a
derived getter that rasterizes on demand, precisely so those assertions keep
their meaning.

There is exactly **one intentional deviation**, and it is the extension point v1
reserved for it: `0x1B` (ESC) stops being a no-op and becomes the introducer for
native-mode extensions (§Phase 4). The v1 README documents it as "Reserved for
future escape code implementation" — this is that future.

---

## 1. Target architecture

```
VT-AC/
├── build/                      icons + entitlements (electron-builder buildResources)
│   ├── vtac.png                1024×1024 source art (DEC bezel + green screen)
│   ├── gen-icon.mjs            → icon.icns / icon.ico / icon.png / icon.iconset
│   └── entitlements.mac*.plist
├── bin/vtac                    dev entry point for the CLI
├── scripts/dist-{win,linux}.sh cross-platform packaging helpers
├── .github/workflows/          ci.yml, deploy.yml
├── src/
│   ├── core/
│   │   ├── VTAC.ts             the terminal — orchestrates Screen + parsers
│   │   ├── Screen.ts           cell model, geometry, scrolling, rasterizer  ← NEW
│   │   ├── Cell.ts             cell planes + attribute bitfield             ← NEW
│   │   ├── Font.ts             CHARACTERS, DEC Special Graphics → CP437 map
│   │   ├── palette.ts          RGB332 → RGBA; xterm-256 → RGB332            ← NEW
│   │   ├── keymap.ts           key event → bytes, personality-aware         ← NEW
│   │   ├── native/Parser.ts    the v1 protocol + ESC extensions
│   │   └── ansi/
│   │       ├── StateMachine.ts DEC ANSI parser (Williams state machine)     ← NEW
│   │       ├── Dispatch.ts     CSI / ESC / DCS / OSC → Screen operations    ← NEW
│   │       ├── Modes.ts        DECSET/DECRST private + ANSI modes           ← NEW
│   │       └── SGR.ts          attribute and color handling                 ← NEW
│   ├── shared/                 types.ts, boot.ts, api.ts
│   ├── main/                   index.ts, serial.ts, settings.ts, boot.ts, cliShim.ts
│   ├── preload/index.ts
│   ├── cli/                    index.ts, args.ts, launch.ts, version.ts
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.vue
│   │       ├── components/  ScreenCanvas.vue ControlBar.vue SettingsPanel.vue PasteModal.vue
│   │       ├── composables/ useKeyboard.ts useBell.ts useSerial.ts useBoot.ts
│   │       ├── services/    serial.ts (Web Serial | Electron IPC)
│   │       ├── stores/      terminal.ts
│   │       └── style.css    DEC VT design tokens
│   └── tests/
├── electron.vite.config.ts / vite.web.config.ts / electron-builder.yml
└── tsconfig.{json,node,web,cli,core}.json
```

Three build outputs from one renderer:

| Target | Command | Output | Serial |
| --- | --- | --- | --- |
| Desktop | `npm run build` | `out/` → `dist/*.dmg/.exe/.AppImage` | `serialport` in main, over IPC |
| Web | `npm run build:web` | `dist/web/` → GitHub Pages | Web Serial API |
| CLI | `npm run build:cli` | `out/cli/` (packed into the app's asar) | launches the desktop app |

---

## 2. Design system — DEC beige + green screen

Defined once in `src/renderer/src/style.css` as CSS custom properties. Components
read tokens, never literals.

```css
:root {
  /* Screen — the glass */
  --vt-screen:        #0A0F0A;   /* app background, canvas letterbox */
  --vt-phosphor:      #33FF66;   /* primary green: active text, icons, focus */
  --vt-phosphor-dim:  #1A6B33;   /* inactive icons, disabled controls */
  --vt-phosphor-hi:   #A8FFC4;   /* hover / active highlight */

  /* Enclosure — the DEC VT100 case */
  --vt-bezel:         #C8BFA8;   /* beige/putty: icon shell, web page frame */
  --vt-bezel-dark:    #9A9078;   /* bezel shading */
  --vt-trim:          #6E675A;   /* borders, control-bar separators */

  /* Chrome — panels and controls */
  --vt-panel:         #141712;   /* settings panel background */
  --vt-panel-line:    #2A3326;   /* dividers, field borders */
  --vt-text:          #C9D6C9;   /* body text on panel */
  --vt-text-dim:      #6B786B;   /* section headings, labels */

  /* Status */
  --vt-amber:         #FFB000;   /* warnings, connecting */
  --vt-red:           #E5484D;   /* errors, disconnect actions */
}
```

- **App window / web page background** — `--vt-screen`, canvas centered with a
  1px `--vt-trim` inset reading as a bezel edge.
- **Control bar** — icons `--vt-phosphor-dim` at rest, `--vt-phosphor` on hover,
  separators `--vt-trim`. Same shape and behavior as the EMULATOR's bar.
- **Settings panel** — 320px right slide-in on `--vt-panel`; headings
  `--vt-text-dim` at 10px/700/0.1em. The EMULATOR's `SettingsPanel.vue` styles
  carry over with the palette swapped; primary buttons become `--vt-phosphor`.
- **Icon and Pages landing frame** — the beige bezel appears here and only here
  (§Phase 11), so the app UI stays dark and the icon stays readable at 16px.
- **Typeface** — system monospace throughout the chrome. No webfont; the screen's
  glyphs come from `Font.CHARACTERS`, not from CSS.

Screen *contents* are never themed. Foreground/background are protocol state
(`0x18`/`0x19`, or SGR), default `0xFF` on `0x00`.

---

## Phase 0 — Toolchain scaffold, SDL removal

**Goal:** the repo builds an empty Electron app, a web bundle, and a CLI, with the
existing test suite green. No terminal behavior touched.

1. `package.json` → `version: 2.0.0`, `private: true`, `main: ./out/main/index.js`,
   `bin: { "vtac": "./bin/vtac" }`. Drop `types`. **Remove `@kmamal/sdl`.**
2. Add: `electron`, `electron-vite`, `electron-builder`, `vue`, `pinia`,
   `@heroicons/vue`, `tailwindcss` + `@tailwindcss/vite`, `vite-plugin-node-polyfills`,
   `@electron-toolkit/{utils,preload,tsconfig}`, `@vitejs/plugin-vue`, `vue-tsc`.
   Keep `serialport`, `commander`, `figlet`, `jest`, `ts-jest`, `typescript`.
3. Scripts, mirroring the EMULATOR: `dev`, `build`, `build:web`, `build:cli`,
   `preview:web`, `cli`, `pack`, `dist:{mac,win,linux}`, `typecheck`, `test*`, `icons`.
4. `tsconfig.{json,node,web,cli,core}.json`; `electron.vite.config.ts` (aliases
   `@`, `@renderer`, `@core`, `@shared`; `nodePolyfills({ include: ['buffer'] })`);
   `vite.web.config.ts` with `base: '/VT-AC/'`.
5. `git mv src/VTAC/VTAC.ts src/core/VTAC.ts`, `git mv src/VTAC/VTAC.test.ts src/tests/VTAC.test.ts`.
   `src/index.ts` and `src/lib.ts` stay for now — the SDL app remains runnable as a
   reference oracle until Phase 8 deletes it.
6. `jest.config.cjs` → coverage from `src/core`, `src/cli`, `src/main`;
   `moduleNameMapper` for `@core`/`@shared`; transform via `tsconfig.core.json`.

**Done when:** `npm run typecheck` and `npm test` pass unchanged, `npm run dev`
opens a blank Electron window, `npm run build:web` emits `dist/web/`.

---

## Phase 1 — Browser-safe core primitives

**Goal:** everything the SDL host did for free, extracted and tested.

1. **`src/core/palette.ts`**
   - `RGB332_RGBA: Uint32Array(256)` — expand exactly as SDL does. SDL's
     `SDL_expand_byte` tables **truncate**, they do not round:
     `r = floor(((v >> 5) & 7) * 255 / 7)`, `g = floor(((v >> 2) & 7) * 255 / 7)`,
     `b = floor((v & 3) * 255 / 3)`, packed little-endian with `a = 255`.
     The two differ at 3-bit levels 2, 4 and 6 (72/73, 145/146, 218/219);
     `images/palette.png` settles it in favour of truncation, and
     `npm run verify:palette` is that check made repeatable.
   - `XTERM256_TO_RGB332: Uint8Array(256)` — the xterm 256-color cube and
     greyscale ramp quantized to nearest RGB332, for `SGR 38;5;n` (Phase 5).
   - `rgbToRGB332(r, g, b)` — for `SGR 38;2;r;g;b` truecolor.
2. **`src/core/Font.ts`** — `CHARACTERS` moved out of `VTAC.ts` (it is 258 lines
   of the 849), plus `DEC_SPECIAL_GRAPHICS: Record<number, number>` mapping DEC
   line-drawing codepoints `0x5F`–`0x7E` onto the CP437 box glyphs the font
   already has (`0x6A ┘→0xD9`, `0x6B ┐→0xBF`, `0x6C ┌→0xDA`, `0x6D └→0xC0`,
   `0x6E ┼→0xC5`, `0x71 ─→0xC4`, `0x74 ├→0xC3`, `0x75 ┤→0xB4`, `0x76 ┴→0xC1`,
   `0x77 ┬→0xC2`, `0x78 │→0xB3`, …). This mapping is *why* CP437 was the right
   glyph ROM for the fiction — line drawing comes for free.
3. **`src/core/keymap.ts`** — v1's mapping lifted verbatim from `src/index.ts:116-171`:
   `backspace→0x08`, `tab→0x09`, `enter→[0x0D,0x0A]`, `escape→0x1B`,
   `left/right/up/down→0x1C/0x1D/0x1E/0x1F`, `delete→0x7F`, printable `0x20–0x7E`
   passed through. Signature takes a personality so Phase 5 can add DECCKM
   without touching callers:
   `keyToBytes(event, personality, modes): number[] | null`.

**Tests:** `palette.test.ts` (all 256 entries against the SDL formula; spot-check
`0x00`→black, `0xFF`→white, `0xE0`→red, `0x1C`→green, `0x03`→blue), `font.test.ts`
(every DEC line-drawing code resolves to a CP437 glyph that exists, and a drawn
box's corners and edges join up), `keymap.test.ts` (every control key, both ends
of the printable range).

**Risk:** the RGB332 expansion is the one place a no-behavior-change claim could
break while every non-pixel test still passes. `images/palette.png` is ground
truth, and `scripts/verify-palette.mjs` checks against it rather than by eye: it
locates the palette grid in the screenshot, applies the sRGB→Display P3
transform a macOS capture bakes in, and scores both candidate expansions.
Truncation wins 172/256 exact against rounding's 86/256.

---

## Phase 2 — Cell model

**The largest change in the release**, and the prerequisite for 80 columns, ANSI
attributes, and VT-100 scroll regions alike.

**The problem.** Today `insertTextData` rasterizes a glyph directly into the
320×240 byte buffer and forgets what it drew. Nothing can answer "what character
is at row 12, column 3?" — so reverse video, a retroactive attribute change, an
alternate screen buffer, and a column-mode switch that preserves content are all
impossible. The pixel buffer must become *derived* rather than authoritative.

**The design.** Structure-of-arrays, sized `cols × rows`:

```ts
kind:   Uint8Array   // 0 = Text, 1 = Pixels
codes:  Uint8Array   // glyph index (Text cells)
fg:     Uint8Array   // RGB332
bg:     Uint8Array   // RGB332
attrs:  Uint8Array   // BOLD|UNDERLINE|BLINK|REVERSE bitfield
pixels: Uint8Array   // cols*rows*64 — RGB332 pixels for Pixels cells only
dirty:  Uint8Array   // per-cell repaint flag
```

Two cell kinds, because graphics mode demands it: v1 colors each 8-pixel *row*
with the fg/bg in effect when that row arrived, so rows within one cell can
differ. A `Pixels` cell therefore stores its own rendered 8×8 block, which is
exactly what the framebuffer holds today. `Text` cells store a glyph plus colors
and rasterize on demand.

**One thing the sketch above leaves out.** The rasterized plane cannot be a
throwaway: `VTAC.test.ts` writes pixels *into* `vtac.buffer` and then expects
`scroll` and `copyCharacterCell` to move them. So `Screen` keeps the plane as a
persistent framebuffer, only ever re-rendering cells whose description changed,
and `copyCell` moves a cell's rendered pixels alongside its description. Clean
cells are never repainted, which is what lets a write straight into the plane
survive. `buffer` hands back a `Buffer` *view* of that memory, not a copy.

That also splits one concept in two: `dirty` is per-cell, "the rasterizer has
not caught up with this description"; damage is a rectangle, "this part of the
plane changed since the renderer last looked". A scroll moves pixels for cells
that were never dirty, so Phase 3's `putImageData` bounds come from
`takeDamage()`, not from the dirty flags.

**Consequences worth having.** `copyCharacterCell`/`clearCharacterCell` become
plane operations instead of 64 pixel writes each — scrolling gets *faster* than
v1, not slower. A `Screen` instance owns its planes, so an alternate screen
buffer (Phase 5) is a second `Screen`, swapped by reference.

**Work**

1. `src/core/Cell.ts` — plane allocation, the `Attr` bitfield, `blankCell()`.
2. `src/core/Screen.ts` — the planes, plus every operation currently on `VTAC`
   that touches the buffer: `putGlyph`, `putPixelRow`, `clearCell`, `copyCell`,
   `scroll(direction)`, `deleteTo(destination)`, `clear()`.
3. `src/core/Screen.rasterize()` — dirty cells → an RGB332 plane. Text cells
   render `Font.CHARACTERS[code]` with fg/bg, applying `REVERSE` (swap),
   `BOLD` (brighten fg one RGB332 step per channel), `UNDERLINE` (fill row 7),
   `BLINK` (gated on the 500ms clock). Pixels cells `set()` their block directly.
4. `VTAC.ts` keeps its entire public surface — `parse`, `reset`, `scroll`,
   `cursor`, `deleteTo`, `bell`, `column`, `row`, `mode`, `foregroundColor`, … —
   and delegates storage to `Screen`. Every `VTAC.COLUMNS`/`ROWS` reference in
   its own methods becomes `this.screen.cols`/`rows`, so Phase 4 has nothing
   left to chase; the statics stay as the 40-column defaults.
5. **`get buffer()`** on `VTAC` — rasterizes and returns the RGB332 plane as a
   `Buffer`. This is what keeps `VTAC.test.ts` passing unmodified.
6. `screen.test.ts` — the surface `VTAC.test.ts` cannot reach: cell readback,
   the four attributes, a graphics row landing on a glyph, damage accounting,
   and two `Screen`s staying independent, which is the alt-screen premise.

**Done when:** `npm test` passes with **zero edits to `VTAC.test.ts`**, and a
side-by-side run of the examples through v1 and the new core produces
byte-identical `buffer` output.

`npm run verify:cellmodel` is that comparison. The oracle is not the v1 SDL
binary — SDL left with Phase 0, and the binary's value was never the window, it
was the terminal underneath it. The script instead pulls the pre-refactor
`src/core/VTAC.ts` out of git (`--ref`, default `HEAD`), transpiles it and the
current core side by side, and runs both. Using v1's actual code rather than a
reimplementation is what keeps the oracle from absorbing the refactor's
assumptions.

It compares the **whole framebuffer after every byte**, plus cursor, mode,
colors, bell state and queue depth — not just the final image, so a divergence
that later heals is still caught. The three `examples/*.bin` files are the
weakest part of it: they never scroll, never use `deleteTo`, and never mix text
and graphics in one cell. Eleven seeded pseudo-random streams do — eight uniform
over all 256 bytes, three weighted towards text and line feeds so the screen
fills and scrolls repeatedly. 14 streams, 61,532 bytes, all identical.

---

## Phase 3 — Canvas renderer

**Goal:** the Vue app looks and sounds exactly like v1's SDL window.

1. **`stores/terminal.ts`** (Pinia) — owns the `VTAC` instance, `parse(byte)`, a
   transmit callback for the serial link, `serialConnected`, and geometry.
2. **`components/ScreenCanvas.vue`** — a `<canvas>` at native resolution,
   `image-rendering: pixelated`, CSS-scaled to fit while preserving 4:3. A
   `requestAnimationFrame` loop replaces v1's `setTimeout(render, 16.67)`:
   rasterize dirty cells → convert those cells through `RGB332_RGBA` into a
   reused `ImageData` → `putImageData` with the dirty bounding rect. Reuse the
   `ImageData` and its `Uint32Array` view across frames; allocating 307,200
   bytes 60×/sec is the obvious way to make this stutter. A static screen costs
   nothing beyond the cursor cell.
3. **Cursor** — `drawCursor` from v1 `index.ts:258-275` as an overlay on the
   cursor cell (inverted glyph), 500ms blink when `cursorMode === 'blinking'`,
   nothing drawn when `cursorChar === 0x00`.
4. **`composables/useKeyboard.ts`** — `keydown` → `keyToBytes`, printable →
   `textToByte`. Guarded by `serialConnected`, matching v1's early return on a
   closed port. `preventDefault` on Tab and the arrows so the browser doesn't
   move focus instead.
5. **`composables/useBell.ts`** — Web Audio replacing `sdl.audio`, holding v1's
   semantics exactly: one bell at a time with the rest queued in `vtac.bellQueue`;
   duration `jiffies / 60` seconds; amplitude 0.2; linear fade over the final 10%
   to kill the click. `OscillatorNode` + `GainNode` per bell, drained by
   `getNextBell()` on `ended`. `AudioContext` created lazily on first gesture in
   the browser, eagerly under Electron.

**Done when:** `npm run dev`, load `examples/characters.bin` — the grid is
pixel-identical to v1's window. `examples/bell.bin` plays the full note sweep.

---

## Phase 4 — Geometry and 80-column mode

**Goal:** a switchable 80×60 grid at 640×480, an exact 2× of 40×30 at 320×240.

Same 8×8 font, same square pixels, same 4:3 aspect, same 8-rows-per-cell
graphics mode. Only `cols` and `rows` change — so every existing command keeps
its meaning, and `SET COLUMN`/`SET ROW` extend for free since both already take
their operand modulo the dimension (`data % COLUMNS`).

**Work**

1. `VTAC.COLUMNS`/`ROWS`/`WIDTH`/`HEIGHT` become **instance** geometry on
   `Screen` (`cols`, `rows`, `width = cols*8`, `height = rows*8`). The statics
   remain as the 40-column defaults for source compatibility and are marked
   deprecated — `VTAC.test.ts` references them.
2. `setColumns(40 | 80)` — reallocates planes, clears the screen, homes the
   cursor. Clear-on-switch matches DECCOLM on real hardware and avoids inventing
   a reflow policy no VT ever had.
3. **Native-mode ESC extensions.** `0x1B` becomes the introducer:

   | Sequence | Effect |
   | --- | --- |
   | `ESC 0x01` | 40-column mode (320×240) |
   | `ESC 0x02` | 80-column mode (640×480) |
   | `ESC 0x03` | Enter VT-100 personality |
   | `ESC 0x04` | Query — reply with personality, columns, rows |
   | `ESC 0x1B` | Literal `0x1B` as data |

   Unrecognised second bytes are ignored, which keeps the v1 no-op behavior for
   any stream that contained a stray ESC followed by something meaningless.
4. **Renderer** — the canvas backing store resizes on mode change; the CSS size
   does not. 80-column mode therefore looks *finer* in the same window rather
   than making it jump, and `-s scale` keeps meaning "how big is the picture."
5. **Electron** — window sizing keyed to the 40-column logical size, so a
   personality or column switch never resizes the user's window.

**Tests:** `geometry.test.ts` — mode switch clears and homes; `SET COLUMN 79` is
addressable at 80 and wraps modulo at 40; graphics mode still advances 8 rows
per cell in both; the framebuffer is 640×480 after switching.

---

## Phase 5 — Personalities, ANSI, and VT-100

**Goal:** `vi`, `htop`, and ncurses render correctly over a serial link.

### 5.1 Personalities

```ts
type Personality = 'native' | 'vt100'
```

`native` is the default and is byte-for-byte v1 plus the Phase 4 ESC extensions.
`vt100` routes the stream through the ANSI state machine instead. Selected by:

- Settings → TERMINAL → Personality
- `vtac --mode vt100`
- `ESC 0x03` (native → vt100)
- `ESC [ ? 7000 h` (vt100 → native) — a private DEC mode number chosen from a
  range DEC and xterm leave unassigned. **Verify against xterm's `ctlseqs`
  before finalizing**; if 7000 is taken, pick another and document it once.
- `ESC c` (RIS) returns to the configured default personality.

### 5.2 Parser

`src/core/ansi/StateMachine.ts` implements **Paul Williams' DEC ANSI parser** —
the canonical state machine (`GROUND`, `ESCAPE`, `ESC_INTERMEDIATE`, `CSI_ENTRY`,
`CSI_PARAM`, `CSI_INTERMEDIATE`, `CSI_IGNORE`, `DCS_*`, `OSC_STRING`,
`SOS/PM/APC_STRING`). Writing this from the published transition table rather
than ad-hoc regex matching is what makes malformed input behave like real
hardware instead of hanging the parser.

### 5.3 Sequences

**Cursor** — CUU/CUD/CUF/CUB (`A`/`B`/`C`/`D`), CUP/HVP (`H`/`f`), CNL/CPL
(`E`/`F`), CHA (`G`), VPA (`d`), IND/RI/NEL (`ESC D`/`ESC M`/`ESC E`),
DECSC/DECRC (`ESC 7`/`ESC 8`).

**Erase & edit** — ED (`J`) 0/1/2, EL (`K`) 0/1/2, IL (`L`), DL (`M`),
ICH (`@`), DCH (`P`), ECH (`X`). *(IL/DL/ICH/DCH are VT102 rather than VT100 —
included deliberately: `vt-102` is already in the package keywords, ncurses
needs them, and the fiction is a terminal that shipped a bit later than a VT100.)*

**Attributes** — SGR (`m`): 0 reset, 1 bold, 4 underline, 5 blink, 7 reverse,
22/24/25/27 off, 30–37/40–47 basic, 90–97/100–107 bright, `38;5;n`/`48;5;n`
xterm-256 quantized through `XTERM256_TO_RGB332`, `38;2;r;g;b` truecolor
quantized through `rgbToRGB332`. The native `0x18`/`0x19` commands remain the
way to address the RGB332 palette directly — document that distinction, since
`38;5;n` looking like "256 colors, and VT-AC has 256 colors" is a trap.

**Scrolling** — DECSTBM (`r`) top/bottom margins, honored by LF, IND, RI, IL, DL
and auto-wrap alike. This is the sequence full-screen apps lean on hardest.

**Modes** — DECSET/DECRST (`ESC [ ? Ph/l`): DECCKM(1) cursor keys, DECANM(2),
DECCOLM(3) → Phase 4's 40/80 switch, DECSCLM(4), DECSCNM(5) reverse screen,
DECOM(6) origin, DECAWM(7) auto-wrap **with correct deferred last-column wrap**,
DECARM(8), DECTCEM(25) cursor visibility, and alt screen 47/1047/1049.
ANSI modes (`ESC [ Ph/l`): IRM(4) insert/replace, LNM(20).

**Alt screen** — a second `Screen` instance swapped by reference (cheap, thanks
to Phase 2). `1049` saves the cursor, switches, and clears; restoring puts the
primary screen back untouched. Without this `vi` and `htop` scribble over the
scrollback and leave the screen wrecked on exit.

**Tabs** — HTS (`ESC H`), TBC (`g`) 0/3, default stops every 8 columns.
*(Note: v1's native TAB is every 4 columns — `Math.floor(col/4 + 1) * 4`. That
stays as-is in native mode; VT-100 mode uses the standard 8.)*

**Charsets** — SCS (`ESC ( 0`, `ESC ( B`, and the `)` `*` `+` slots), SO/SI
shifting G0/G1, DEC Special Graphics resolved through `Font.DEC_SPECIAL_GRAPHICS`.

**Reports** — DA (`ESC [ c` → `ESC [ ? 1 ; 2 c`, VT100 with AVO), DSR (`ESC [ 6 n`
→ CPR), DECID (`ESC Z`), and DECALN (`ESC # 8`, the screen of `E`s). Replies go
out over the serial transmit callback.

**Reset** — RIS (`ESC c`): full reset to configured defaults.

### 5.4 Keyboard

`keymap.ts` becomes personality- and mode-aware:

| Key | native | vt100 normal | vt100 DECCKM |
| --- | --- | --- | --- |
| ↑ | `0x1E` | `ESC [ A` | `ESC O A` |
| ↓ | `0x1F` | `ESC [ B` | `ESC O B` |
| → | `0x1D` | `ESC [ C` | `ESC O C` |
| ← | `0x1C` | `ESC [ D` | `ESC O D` |
| Enter | `0x0D 0x0A` | `0x0D` (`0x0D 0x0A` when LNM set) | — |

Plus keypad application mode (`ESC =` / `ESC >`) and PF1–PF4 on F1–F4.

### 5.5 Tests

- `ansi/StateMachine.test.ts` — transition coverage driven from the published
  table, including malformed and truncated sequences.
- `ansi/csi.test.ts`, `sgr.test.ts`, `modes.test.ts`, `scrollregion.test.ts`,
  `altscreen.test.ts`, `charset.test.ts`, `keymap.vt100.test.ts`.
- **`vttest` as the acceptance gate.** The classic VT100 conformance suite, run
  against the app over a serial loopback (`socat` pty pair). Menu items 1 (cursor
  movement), 2 (screen features), 3 (character sets) and 6 (terminal reports)
  must pass. Record which items pass in `docs/VT100-CONFORMANCE.md` — an honest
  list of what works beats an unqualified "VT-100 compatible" claim.
- **Real software**, over the same loopback: `vi` opens/edits/exits cleanly,
  `htop` renders and refreshes, `ncurses` demos draw boxes with the right glyphs.

**Risks.** This phase is roughly the size of everything else combined. Two
specifics worth watching: the deferred last-column wrap under DECAWM is the
single most commonly-botched VT100 behavior and the one `vttest` will catch
first; and scroll regions interacting with IL/DL is where off-by-one errors
hide. Both are covered by the conformance gate rather than by hoping.

---

## Phase 6 — Electron main, preload, serial

1. **`src/shared/types.ts`** — `SerialConfig` (defaults **9600 8-N-1**, VT-AC v1's
   default, *not* the EMULATOR's 19200), `SerialStatus`, `PortInfo`,
   `AppSettings { serialConfig, personality, columns, scale, fullscreen, bellMuted, lastPort? }`,
   `DEFAULT_APP_SETTINGS`, `CliShimStatus`, and the `IPC` channel enum.
2. **`src/main/serial.ts`** — the EMULATOR's `SerialService`, ported unchanged.
3. **`src/main/settings.ts`** — the EMULATOR's `SettingsService` including
   `override()`, which is what lets `vtac -b 19200 --mode vt100` apply to one
   launch without rewriting saved defaults.
4. **`src/main/index.ts`** — window sized from saved `scale` (`320·s × 240·s`
   plus control-bar height, default `s = 3` → 960×720 client),
   `backgroundColor: '#0A0F0A'`, 4:3 locked, fullscreen supported, title `VT-AC`.
   IPC for app/window/serial/settings/boot/cli.
5. **`src/preload/index.ts`** + **`src/shared/api.ts`** — `window.api` with
   `app`, `window`, `boot`, `serial`, `settings`, `cli`.
6. **`services/serial.ts`** — the EMULATOR's two-implementation factory
   (`ElectronSerialService` over IPC, `WebSerialService` over `navigator.serial`)
   and **`composables/useSerial.ts`** as an app-lifetime singleton. RX bytes go to
   `store.parse()` instead of `machine.onReceive()`. Keep the 10ms TX coalescing.

**Done when:** the app lists ports, connects at 9600 8-N-1, types into a real
device, and renders the reply.

---

## Phase 7 — Control bar and settings panel

**`components/ControlBar.vue`** — EMULATOR layout (centered flex row, 24px
Heroicons, `--vt-trim` separators), VT-AC's buttons:

| Icon | Action |
| --- | --- |
| `DocumentArrowUpIcon` | Load data file — bytes through `vtac.parse()`, the `-l` equivalent |
| `ArrowPathIcon` | Reset — `vtac.reset()`, identical to `0x04` |
| `TrashIcon` | Clear screen — `0x0C` |
| — | |
| `LinkIcon`/`LinkSlashIcon` | Serial connect/disconnect, tinted by status: dim / `--vt-amber` pulsing / `--vt-phosphor` / `--vt-red` |
| `9600 8N1` | Live framing readout; click opens Settings at the serial section |
| `VT-AC` / `VT-100` | Personality readout; click toggles |
| `40` / `80` | Column readout; click toggles |
| — | |
| `SpeakerWaveIcon`/`SpeakerXMarkIcon` | Bell mute, dimmed until the AudioContext is live (the EMULATOR's `showsMuted` rule) |
| `ClipboardIcon` | Paste text — sends a string byte-by-byte |
| `ArrowsPointingOutIcon` | Fullscreen (Electron; `F11` / `⌘↵` also bound) |
| `Cog6ToothIcon` | Settings |

**`components/SettingsPanel.vue`** — the EMULATOR's panel structure, retargeted:

- **TERMINAL** — personality (VT-AC native / VT-100), columns (40 / 80), and a
  line of help saying plainly that native is v1's protocol and VT-100 is the
  compatibility mode. This is the section that makes the fantasy legible.
- **SERIAL** — status dot + text; Electron: port `<select>` + refresh, baud /
  data bits / parity / stop bits grid; web: a Connect button calling
  `navigator.serial.requestPort()`. Persisted via `settings.set({ serialConfig })`,
  guarded by the EMULATOR's `hydrating` flag so opening the panel never writes
  launch-only values back to disk.
- **DISPLAY** — window scale 1×–6× (Electron only), fullscreen toggle.
- **BELL** — mute, volume, and a Test button that queues one bell.
- **FILES** — loaded data file name, Load, Reload.
- **COMMAND LINE** — the CLI shim install/uninstall button, verbatim from the
  EMULATOR: install path when installed, PATH hint when it lands in
  `~/.local/bin`, "installed by this platform's installer" on Windows.

**`components/PasteModal.vue`** — ported as-is.

---

## Phase 8 — The `vtac` CLI

`vtac [flags]` opens the app with those flags applied. Nothing prints terminal
output — the window *is* the output. This is the main divergence from the
EMULATOR, whose CLI also has headless and debug modes.

**Contract** (`src/shared/boot.ts`) — same mechanism as the EMULATOR: the CLI
writes a `BootConfig` JSON to a temp file, spawns the app with
`--boot-config=<path>`, and main reads it, deletes it, and resolves the payload.

```ts
export interface BootConfig {
  load?: string                    // -l, absolute, verified readable by the CLI
  serialPort?: string              // -p
  fullscreen?: boolean             // -f
  scale?: number                   // -s
  settings?: Partial<AppSettings>  // -b -a -d -t --mode --columns, launch-only
}
export interface BootPayload {
  load?: { label: string; bytes: Uint8Array }
  serialPort?: string
  fullscreen: boolean
  errors: string[]                 // unreadable files: a message, not a dead window
}
```

**Flags — every v1 flag preserved, two added**

| Flag | v2 behavior |
| --- | --- |
| `-p, --port` | `BootConfig.serialPort`; connected before the window shows, so nothing arriving at boot is lost |
| `-b, --baudrate` (9600) | `settings.override({ serialConfig.baudRate })` |
| `-a, --parity` (none) | ditto — validated `odd\|even\|none`, v1's error text |
| `-d, --databits` (8) | ditto — validated `5\|6\|7\|8`, v1's error text |
| `-t, --stopbits` (1) | ditto — validated `1\|1.5\|2`, v1's error text |
| `-f, --fullscreen` | window opens fullscreen |
| `-s, --scale` (2) | window client size `320·s × 240·s` — v1's SDL pixel scale, same resulting picture |
| `-l, --load` | file read by main, bytes fed through `vtac.parse()` after mount |
| `-m, --mode` (native) | **new** — `native\|vt100` |
| `-c, --columns` (40) | **new** — `40\|80` |
| `-v, --version` | `2.0.0` |
| `-h, --help` | figlet `VT-AC` banner + options, as v1 |

Framing, personality and column flags override *for this launch only*. Someone
running `vtac -p /dev/ttyUSB0 --mode vt100` is talking to one device, not
changing what the app does tomorrow — and anything they then change in the panel
persists normally.

**Work**

1. `src/cli/args.ts` — `commander`, v1's option set verbatim plus the two new
   ones and a `--app <path>` escape hatch.
2. `src/cli/launch.ts` — resolve and `accessSync` every path *before* spawning,
   so a typo is an error in the shell rather than a window missing its file;
   locate the app binary (macOS `/Applications/VT-AC.app/Contents/MacOS/VT-AC`
   and the `~/Applications` variant, Linux `vtac` on PATH / AppImage, Windows
   `%LOCALAPPDATA%\Programs\VT-AC\VT-AC.exe`); write the temp config; `spawn`
   detached; exit 0.
3. `src/cli/index.ts` — parse, launch, done. No subcommands.
4. `src/main/boot.ts` — `bootConfigFrom(argv)` + `readBootPayload()`, ported.
5. `composables/useBoot.ts` + `App.vue` mount order: settings (overrides folded
   in) → store init at the right geometry/personality → `serialPort` connect →
   `load` bytes parsed → show.
6. `src/main/cliShim.ts` — **ported verbatim**, `6502` → `vtac`. The
   `ELECTRON_RUN_AS_NODE` trick means no separate Node install and no version
   drift between app and CLI.
7. `bin/vtac` — dev entry; requires `out/cli/index.js`, points at
   `npm run build:cli` when it is missing.
8. **Delete `src/index.ts` and `src/lib.ts`.** SDL is gone from the tree.

**Tests:** `cli/args.test.ts` (each flag → `BootConfig`; the three v1 validation
failures produce v1's messages), `main/boot.test.ts` (round-trip, temp file
deleted, unreadable file lands in `errors`).

**Verify on a packaged build:** `figlet` must resolve from inside the asar when
the shim runs the CLI under `ELECTRON_RUN_AS_NODE`. If electron-builder's `files`
filter drops it, inline the banner as a static string rather than adding a
runtime dependency to the packaged CLI.

---

## Phase 9 — Web build and CI

1. `vite.web.config.ts` — `base: '/VT-AC/'`, `root: src/renderer`,
   `outDir: dist/web`. Single entry; no embed target.
2. Web-mode differences, all handled by the existing `isElectron` checks: Web
   Serial instead of `serialport`; `<input type="file">` instead of a native
   dialog; settings in `localStorage`; no DISPLAY-scale or COMMAND-LINE sections.
3. A note in the SERIAL section when `!('serial' in navigator)` — silent absence
   of a Connect button is worse than a sentence explaining Chrome/Edge over HTTPS.
4. `.github/workflows/deploy.yml` — ported unchanged
   (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `upload-pages-artifact`, `deploy-pages`,
   `concurrency: pages`).
5. `.github/workflows/ci.yml` — typecheck + jest on push and PR.
6. **Manual, one-time:** enable Pages → GitHub Actions in repo settings.

---

## Phase 10 — Icon and branding

1. `build/vtac.png`, 1024×1024: a flat three-quarter VT100 enclosure in
   `--vt-bezel` with `--vt-bezel-dark` shading and a `--vt-trim` base, screen
   recessed in near-black, carrying a green phosphor cursor block and a glyph or
   two drawn from `Font.CHARACTERS` at 8×8, scaled by whole pixels. At 16px what
   survives is beige rectangle + dark screen + green mark — the intended read.
2. `build/gen-icon.mjs` — ported, `6502.png` → `vtac.png`; emits `icon.iconset/`,
   `icon.icns`, `icon.ico`, `icon.png` via `sips`/`iconutil`/`magick`.
3. `src/renderer/public/` — `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`:
   same art, bezel and screen only.
4. `<title>VT-AC</title>`, `theme-color: #0A0F0A`, Open Graph card (1200×630:
   the bezel framing a screen of real terminal output).
5. Fresh `images/VT-AC.gif` of the Electron app for the README — and a second
   showing 80-column VT-100 mode running `htop`, which is the release's headline.

---

## Phase 11 — Packaging

1. `electron-builder.yml` — ported: `appId: com.acwright.vtac`,
   `productName: VT-AC`, `files: [out/**/*]`, `asarUnpack: ['**/*.node']`
   (serialport's native binding), `npmRebuild: true`. Targets: mac dmg arm64
   (hardened runtime, entitlements, notarize), win nsis x64, linux AppImage + deb.
2. `build/entitlements.mac.plist` / `.inherit.plist` — ported. Confirm serial
   access against the EMULATOR's working pair.
3. `scripts/dist-win.sh`, `scripts/dist-linux.sh` — ported.
4. Notarization credentials from the environment, never committed.

**Done when:** `npm run dist:mac` produces a notarized dmg that opens, finds a
serial port, and whose Settings → COMMAND LINE button installs a working `vtac`.

**Risk:** `serialport` is native — it must be rebuilt for Electron's ABI and
unpacked from the asar. This is the most likely "works in dev, broken when
packaged" failure. Test a packaged build during Phase 6, not here.

---

## Phase 12 — Documentation, protocol spec, npm retirement, release

**README rewrite.** The protocol documentation — Character Set, Palette,
Instruction Set, Text Mode, Graphics Mode, Bell, Bell Frequencies — is why the
README is 17KB and it is still correct. It stays, and grows:

| Current | Becomes |
| --- | --- |
| opening blurb | leads with *the fantasy VT terminal* framing, not "a fantasy ASCII terminal emulator" |
| `## Features` | adds 80-column mode, VT-100/ANSI personality, desktop + web |
| `## Instruction Set` | `0x1B` row rewritten from "Reserved" to the ESC extension table (§Phase 4) |
| — | `## Terminal Personalities` — native vs VT-100, what each is for, how to switch |
| — | `## VT-100 Mode` — supported sequences, with `vttest` results linked |
| — | `## 80-Column Mode` — geometry, what changes, what doesn't |
| `## Installation → From NPM` | `## Install` — per-platform downloads, plus "or use it in your browser" |
| `## Usage` (`vtac -l …`) | `## Using the app` — window, control bar, settings panel, screenshots |
| — | `## Command line` — installing the shim from Settings, then the flag table |
| — | `## Web version` — Pages link, Web Serial support, what differs |
| `### Release Build` | `## Development` — `dev`, `build:web`, `cli`, `dist:*` |
| `### Project Structure` | updated to §1's tree |
| `## TODO` | 80-column, VT-100 and ANSI **struck off**; "additional character sets" remains |
| — | `## Migrating from v1.x` — npm deprecated, same flags now launching the app, `npm uninstall -g vtac-terminal`, and the one ESC deviation stated plainly |

**Other docs**

- `docs/VT-AC.html` — **done ahead of this phase.** The printable command card,
  rewritten from the retired `VT-AC.numbers` as hand-editable HTML: it already
  carries the ESC extension table, the 80-column geometry, the personality
  table, and a bell-frequency chart that fills the page the Numbers export
  wasted. Screen renders in the DEC green scheme, print drops to black ink.
  `docs/VT-AC.pdf` is now a generated artifact — regenerate it whenever the
  HTML changes:

  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf=docs/VT-AC.pdf docs/VT-AC.html
  ```

  Worth wiring as an npm script (`docs:card`) alongside the Phase 0 scripts so
  the PDF cannot silently drift from its source.
- Remaining doc work for this phase: confirm the card's VT-100 personality row
  matches whatever private mode number Phase 5 settled on (it currently reads
  `ESC[?7000h`, which Phase 5 flags as needing verification against xterm's
  `ctlseqs`), and re-export the PDF.
- `docs/VT100-CONFORMANCE.md` — new, from Phase 5's `vttest` run.
- `examples/README.md` — "Load from the control bar, drag onto the window, or
  `vtac -l ./characters.bin`". Worth adding an `ansi.js` example generating a
  VT-100-mode demo, alongside the existing three.
- `demo/README.md` — check for stale npm references.

**npm retirement**

```
npm deprecate vtac-terminal "VT-AC is now a desktop app — https://github.com/acwright/VT-AC/releases (web: https://acwright.github.io/VT-AC/)"
```

The package stays published, so nothing anyone already depends on breaks; new
installs get the pointer. `private: true` (Phase 0) prevents an accidental publish.

> Run `npm deprecate` only after v2.0.0 is tagged and the links resolve. It is
> outward-facing and belongs last.

**Release**

1. Tag `v2.0.0`; GitHub release with dmg / exe / AppImage / deb attached.
2. Release notes: the distribution change, 80 columns, VT-100 mode, the
   deprecation, and an explicit statement that native-mode behavior is unchanged
   apart from ESC.
3. Repo description and topics (drop `npm`, add `electron`, `desktop`, `vt100`, `ansi`).

---

## Divergences from the EMULATOR

| EMULATOR feature | VT-AC v2.0.0 |
| --- | --- |
| CLI headless mode, stdout console | **Dropped.** The window is the output |
| `dbg` / `attach`, debug server, WebSocket protocol | **Dropped.** No CPU to inspect |
| `<iframe>` embed target, `embed.html` | **Dropped.** Not requested |
| CF card / NVRAM storage service | **Dropped.** VT-AC has no storage |
| Joystick, gamepad, `JoystickIndicator` | **Dropped** |
| Run / Stop / Reset / Power-cycle controls | **Reduced** to Reset + Clear — a terminal has no CPU to halt |
| Bundled BIOS ROM, auto-boot | **Dropped.** VT-AC starts blank, as v1 does |
| 19200 8-N-1 default | **9600 8-N-1** — VT-AC v1's default |
| Settings panel, CLI shim button, control-bar pattern | **Kept**, as specified |

---

## Sequencing and risk

```
0 ─ 1 ─ 2 ─ 3 ─ 4 ─ 5 ─ 6 ─ 7 ─ 8 ─┬─ 9  (web + CI)
                                    ├─ 10 (icon)
                                    ├─ 11 (packaging)
                                    └─ 12 (docs, npm, release — last)
```

Phases 0→8 are strictly ordered; 9–11 are independent once 8 lands; 12 is last
because it depends on real download URLs.

**Weight.** Phase 5 is roughly the size of 0–4 combined, and Phase 2 is the one
that can quietly break everything. If the release needs to ship sooner, the
honest cut is to land 0–4 and 6–12 as **v2.0.0** (Electron + web + CLI + 80
columns) and hold VT-100 for **v2.1.0** — the personality switch is designed so
that `vt100` can simply not be offered yet.

**The things most likely to go wrong, in order:**

1. **The cell-model refactor** (Phase 2) — it touches every drawing path. The
   unmodified `VTAC.test.ts` plus a byte-identical comparison against the v1 SDL
   binary is the whole safety net; build the comparison script first.
2. **Deferred last-column wrap under DECAWM** (Phase 5) — the most commonly
   botched VT100 behavior, and the first thing `vttest` catches.
3. **Scroll regions × IL/DL** (Phase 5) — where off-by-one errors hide.
4. **RGB332 conversion** (Phase 1) — silently wrong colors pass every test that
   doesn't check pixels. `images/palette.png` is ground truth.
5. **`serialport` in a packaged Electron build** (Phase 11) — native ABI and asar
   unpacking. Test on a packaged build during Phase 6.
6. **`figlet` inside the packaged CLI's asar** (Phase 8) — verify or inline.
7. **Web Serial's narrower support** (Phase 9) — Chromium-only, HTTPS-only,
   user-gesture-gated. Told to the user in the panel rather than discovered.
8. **macOS notarization + serial entitlements** (Phase 11) — the EMULATOR has a
   working pair to copy, which removes most of the difficulty.
