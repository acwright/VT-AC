VT-100 CONFORMANCE
==================

What VT-AC's `vt100` personality does and does not do, measured rather than
claimed. The measurement is `vttest` — Per Lindberg's VT100 conformance suite,
maintained by Thomas Dickey — run against the packaged application over a
hardware serial link, plus three real programs over the same link.

An honest list of what works beats an unqualified "VT-100 compatible" claim,
which is why this file exists and why the divergences are at the top rather
than in a footnote.

Version tested
--------------

| | |
| --- | --- |
| VT-AC | 2.0.0 |
| `vttest` | 2.7 (20251205) |
| Personality | `vt100`, 80 columns (80×60) |
| Link | Two USB serial adapters wired to each other, 115200 8-N-1 |
| Harness | `node scripts/vttest-run.mjs 1 2 3 6` |

Nothing here was run against `src/core` in isolation. The terminal under test is
the built app: `serialport` at both ends, the Pinia store, the canvas renderer
and the cursor overlay all included, keystrokes typed into the application
window rather than injected at the far end. That is the terminal the release
ships, and it is the only one whose behaviour is worth publishing.

Results
-------

| `vttest` menu item | Result |
| --- | --- |
| 1. Test of cursor movements | **Pass** |
| 2. Test of screen features | **Pass** |
| 3. Test of character sets | **Pass**, with the glyph gaps below |
| 4. Test of double-sized characters | Not supported — see below |
| 5. Test of keyboard | Not run; interactive by design |
| 6. Test of terminal reports | **Pass**, with the two VT220+ reports declined |
| 7. Test of VT52 mode | Not supported — see below |
| 8. Test of VT102 features (Insert/Delete) | **Pass** |
| 9–12 | Not run; VT220/xterm, known-bug and parameter menus |

Items 1, 2, 3 and 6 are the release gate. Item 8 is not part of it and passes
anyway: IL, DL, ICH, DCH and insert mode are VT102 rather than VT100, and were
put in deliberately because ncurses needs them.

### 1 — Cursor movements

All six screens. The border-and-frame screen draws an unbroken frame of `*`
and `+` around all 60 rows and 80 columns, twice — once addressed absolutely and
once by relative movement. Cursor-control characters inside escape sequences,
and leading zeros in parameters, both behave.

The autowrap screen is the one worth naming: A–Z down the left margin against
a–z down the right, in order, which is the **deferred last-column wrap**. Writing
to the last column must not move the cursor off it; the *next* graphic character
wraps first. It is the most commonly botched VT100 behaviour and the plan's
number-two risk, and it is right.

### 2 — Screen features

All fifteen screens: wrap-around, tab set and clear, reverse and normal screen
(DECSCNM), soft and jump scrolling both inside a two-line region and over the
whole screen, origin mode (DECOM), the graphic rendition pattern, and
save/restore cursor.

The rendition pattern draws all sixteen combinations of bold, underline, blink
and reverse. Blinking text is absent from a still capture exactly half the time,
which is what blinking means.

### 3 — Character sets

US ASCII, UK and DEC Special Graphics, each as G0 with SI and as G1 with SO.
Line drawing resolves onto the CP437 glyphs the ROM already has, and so does the
UK set's `£` — both real rather than approximated, which is the argument for
CP437 being the right ROM for this fiction.

Four DEC Special Graphics positions have no CP437 equivalent and draw as blanks:

| Codes | DEC glyph | Why |
| --- | --- | --- |
| `0x62`–`0x65`, `0x68`, `0x69` | HT, FF, CR, LF, NL, VT symbols | CP437 has no control pictures |
| `0x7C` | `≠` | Not in CP437 |

And five collapse onto two glyphs:

| Codes | DEC glyph | Drawn as |
| --- | --- | --- |
| `0x6F`–`0x72` | scan lines 1, 3, 5, 7 | `─` (CP437 `0xC4`) |
| `0x73` | scan line 9 | `_` |

A glyph ROM is a glyph ROM. Nothing is drawn wrongly; six positions are drawn
blank and four horizontal rules share one line.

### 6 — Terminal reports

| Report | Answer |
| --- | --- |
| DSR 5, terminal status | `CSI 0 n` — "TERMINAL OK" |
| DSR 6, cursor position | `CSI <row> ; <col> R`, relative to the top margin under DECOM |
| DA, primary | `CSI ? 1 ; 2 c` — a VT100 with the Advanced Video Option |
| DECID (`ESC Z`) | the same |
| DECREQTPARM (`CSI 0 x` / `CSI 1 x`) | `CSI 2;1;1;112;112;1;0 x` / `CSI 3;…` — no parity, 8 bits, 9600 both ways |
| LNM, `CSI 20 h` / `l` | RETURN sends CR LF when set, CR when reset |
| DA, secondary (`CSI > c`) | **Declined** — VT220 |
| DA, tertiary (`CSI = c`) | **Declined** — VT420 |
| ENQ answerback | Silent — see below |

DECREQTPARM's framing fields are fixed rather than read off the serial port. The
core does not know the baud rate, and a terminal core that had to be told it in
order to answer a DEC report would be the wrong shape; 9600 is VT-AC's own
default framing, so the answer is at least true of the machine as configured.

Deliberate divergences
----------------------

Each of these is a decision, not a gap:

**DECCOLM selects 80 columns in either state.** On a VT100, `CSI ? 3 h` is 132
columns and `CSI ? 3 l` is 80 — *reset is the normal screen*, which is why
`CSI ? 3 l` opens vt100 terminfo's `rs2`, `tput init`, and `vttest` itself.
VT-AC has 40 and 80, and 80 is both the width a VT100 program may assume and the
widest VT-AC has, so it answers the request for normal width and the request for
132 with the same screen. 40 columns is native geometry, reachable from
`ESC 0x01`, the control bar and the settings panel, but not from a sequence
whose reset state a program means as "not narrow". The screen clears and the
cursor homes either way, as DECCOLM does on hardware. **This is the one thing
the conformance run changed about the terminal's protocol behaviour**, and
before it every properly initialised program drew on half a screen.

**No 132-column mode.** The fantasy machine has 40 and 80. See above.

**No double-height or double-width lines** (`ESC # 3`–`ESC # 6`). An 8×8 ROM on a
fixed cell grid cannot draw them, and inventing a half-measure would be worse
than the silence a terminal returns for a sequence it does not have.
`vttest` item 4 therefore shows single-size text where it expects doubles.

**No VT52 mode** (`CSI ? 2 l`, DECANM reset). VT-AC's second personality is its
own native protocol, which is the point of the machine; a third one imitating a
terminal DEC had already superseded is not.

**DECSTR (`CSI ! p`) is unanswered.** It is VT220, and DEC and xterm disagree on
what it does to DECAWM. RIS (`ESC c`) is the reset VT-AC has, and it works.

**ENQ has no answerback message.** A VT100 transmits its stored answerback on
ENQ; the message is empty until someone loads one, and VT-AC has nowhere to load
one from. An empty answerback and no answerback are indistinguishable on the
wire.

**UTF-8 is not decoded.** The glyph ROM is CP437, so a UTF-8 multi-byte sequence
arrives as its individual bytes and draws as that many CP437 glyphs. The first
place anyone running modern ncurses software meets this is `htop`'s sort
indicator, which is a UTF-8 arrow and comes out as two characters. Software that
respects `TERM=vt100` does not hit it; software that assumes a UTF-8 locale does.

Real software
-------------

Over the same loopback, driven by `scripts/vttest-run.mjs --program <name>`:

| Program | Result |
| --- | --- |
| `vi` (`TERM=vt100`) | Opens a file, `G o` appends a line, `ESC :wq` writes and exits. The text is on the screen *and* in the file afterwards — an edit that renders correctly but never reaches the disk looks identical on the glass. |
| ncurses (`scripts/curses-demo.py`, `TERM=vt100`) | Draws a box with tees and a divider, all four AVO attributes, and every ACS glyph terminfo's `vt100` entry names. The line drawing is chosen by ncurses out of the terminal's capabilities, not written out by hand. |
| `htop` (`TERM=ansi`, 80×60) | Renders and refreshes over the wire. `images/VT-AC-htop.gif` is a recording of it, made the same way. |

One small proof the entry in use is the right one: the ncurses demo has to catch
the error from `curs_set(0)`, because a real VT100 has no "hide the cursor"
capability and terminfo's `vt100` entry says so.

What the run changed
--------------------

Four defects, all found by running the suite and none of them reachable from the
unit tests, which were green before it and are green now — each fix brought its
own test back with it:

1. **DECCOLM reset dropped the terminal to 40 columns.** Described above. Every
   screen `vttest` drew was 40 columns wide inside an 80-column framebuffer
   until this was fixed.
2. **DECSC and DECRC did not save the character set.** They saved the cursor,
   the attributes and the colours. `vttest`'s save/restore screen writes five
   characters of line drawing, saves, detours and restores, and the second five
   came back as `q` and `` ` `` instead of `─` and `♦`.
3. **A cleared screen ignored DECSCNM.** `Screen.clear` fills the framebuffer in
   one pass rather than dirtying every cell, which is most of why a full clear
   costs nothing — and it is therefore one of the two places the rasterizer's
   rules have to be restated. On a reversed screen a blank cell is a field of
   *foreground*. Until it was, the light-background screen came out as a
   staircase: every cell the host had written was light and every cell it had
   not was black.
4. **DECREQTPARM was unimplemented.** A VT100 report, not a VT220 one, so it is
   answered rather than declined.

Reproducing this
----------------

```
brew install vttest
npm run build
node scripts/vttest-run.mjs 1 2 3 6      # the gate
node scripts/vttest-run.mjs 8            # VT102 insert/delete
node scripts/vttest-run.mjs --program vi
node scripts/vttest-run.mjs --program curses
```

Every screen lands in `out/vttest/<item>/NN.png` and `NN.txt`. The `.txt` is the
same frame read back out of the canvas — each 8×8 cell matched against
`Font.CHARACTERS` — because deciding whether the cursor is in column 40 by
squinting at a 640×480 screenshot of an 8×8 ROM is how conformance claims get
made up. Two reader artifacts are worth knowing about, since neither is a
terminal defect: an underlined glyph with a descender (`g`, `q`) can come back as
`¿`, and the reader cannot tell a blinking cell in its dark phase from a blank
one.

The port names in the script are this machine's two adapters. `ls /dev/cu.*`
after plugging yours in; USB serial nodes move.
