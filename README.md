VT-AC
=====

```
  ___ ___ _______        _______ _______ 
 |   Y   |       |______|   _   |   _   |
 |.  |   |.|   | |______|.  1   |.  1___|
 |.  |   `-|.  |-'      |.  _   |.  |___ 
 |:  1   | |:  |        |:  |   |:  1   |
  \:.. ./  |::.|        |::.|:. |::.. . |
   `---'   `---'        `--- ---`-------'
```

**A VT terminal that could have existed, but didn't.**

Not a reproduction of a DEC VT100 — a plausible sibling of one. What makes VT-AC
a fantasy machine rather than an emulator is the combination no real terminal
had: DEC's command set and screen model, sitting on a 256-colour RGB332
framebuffer, with a CP437 glyph ROM, a pixel-addressable graphics mode, and a
bell with a two-octave note table.

It speaks two protocols, and which one is a switch on the front of the machine.
**Native** is VT-AC's own: single-byte commands, direct colour, graphics mode —
the protocol a vendor would have shipped if it were competing with DEC rather
than copying it. **VT-100** is the compatibility mode that same vendor would have
had to offer to sell any, and it runs `vi`, `htop` and ncurses over a serial
line.

Plug in anything with a serial port — an Arduino, a Raspberry Pi, a
[6502 computer](https://github.com/acwright/6502) — and start sending bytes.

![VT-AC Demo](https://github.com/acwright/VT-AC/blob/main/images/VT-AC.gif?raw=true)

80-column VT-100 mode, running `htop` over a serial link:

![VT-AC running htop in 80-column VT-100 mode](https://github.com/acwright/VT-AC/blob/main/images/VT-AC-htop.gif?raw=true)

## Features

- **Two terminal personalities** — VT-AC native, or VT-100/ANSI compatibility.
- **40 and 80 column modes** — 40 × 30 at 320 × 240, or 80 × 60 at 640 × 480. Same
  8 × 8 font, same square pixels, same 4:3 screen.
- **Full VT-100 emulation** — scroll regions, SGR attributes and colour, the
  alternate screen, tab stops, DEC line drawing, terminal reports. Measured
  against `vttest`; the results are in [docs/VT100-CONFORMANCE.md](docs/VT100-CONFORMANCE.md).
- Classic 8 × 8 IBM PC BIOS / Code Page 437 font for character rendering.
- 256 colours (RGB332), foreground and background settable per 8 × 8 block — or
  per 8 × 1 pixel row in graphics mode.
- Text and graphics modes.
- A bell with configurable duration and a two-octave note table.
- **Desktop app** for macOS, Windows and Linux, **or run it in your browser**
  with no install at all: **[acwright.github.io/VT-AC](https://acwright.github.io/VT-AC/)**
- Serial connection with configurable baud rate, parity, data bits and stop bits.
- Load binary data files straight into the terminal, from the control bar or the
  command line.
- A `vtac` command line that launches the app with flags applied — installed by
  the app itself.
- Fullscreen mode and adjustable window scale.

## Install

Download the latest release for your platform from
**[the releases page](https://github.com/acwright/VT-AC/releases)**:

| Platform | File |
| --- | --- |
| macOS (Apple silicon) | `VT-AC-2.0.0-mac-arm64.dmg` — signed and notarized |
| Windows (x64) | `VT-AC-2.0.0-win-x64.exe` |
| Linux (x64) | `VT-AC-2.0.0-linux-x86_64.AppImage` or `VT-AC-2.0.0-linux-amd64.deb` |

Or **use it in your browser** at
[acwright.github.io/VT-AC](https://acwright.github.io/VT-AC/) — same terminal,
same renderer, serial over the Web Serial API. See [Web version](#web-version).

> **Upgrading from v1.x?** VT-AC is no longer an npm package. See
> [Migrating from v1.x](#migrating-from-v1x).

## Using the app

The window is the terminal, and the strip along the bottom is the control bar.

| Control | What it does |
| --- | --- |
| Load data file | Reads a binary file and feeds it through the parser — the `-l` flag's equivalent |
| Reset | Identical to sending `0x04` |
| Clear screen | Identical to sending `0x0C` |
| Connect / disconnect | Opens the serial port. Tinted by status: dim, amber while connecting, green when open, red on error |
| `9600 8N1` | Live framing readout. Click it to open Settings at the serial section |
| `VT-AC` / `VT-100` | Personality readout. Click to toggle |
| `40` / `80` | Column readout. Click to toggle — this clears the screen, as a mode switch does on real hardware |
| Bell mute | Dimmed until the audio device is live |
| Paste | Sends the clipboard as bytes |
| Fullscreen | `F11` also works |
| Settings | The panel below |

The settings panel slides in from the right:

- **TERMINAL** — personality and column mode, and what each one is.
- **SERIAL** — port, baud rate, data bits, parity, stop bits. Defaults to
  **9600 8-N-1**, VT-AC v1's default.
- **DISPLAY** — window scale 1× to 6×, and fullscreen. Desktop only.
- **BELL** — mute, volume, and a Test button.
- **FILES** — the loaded data file, and Reload.
- **COMMAND LINE** — installs the `vtac` shim. Desktop only.

Changes here are saved. Anything set by a command-line flag applies to that
launch only — see [Command line](#command-line).

## Terminal Personalities

VT-AC parses one of two protocols at a time.

| | **Native** | **VT-100** |
| --- | --- | --- |
| What it is | VT-AC's own protocol — byte-for-byte v1.3.0, plus the ESC extensions | ANSI / VT-100 compatibility mode |
| Commands | Single bytes, `0x00`–`0x1F` | Escape sequences, `ESC [ … ` |
| Colour | Direct RGB332, 256 colours, via `0x18` / `0x19` | SGR, quantized onto the same 256 |
| Graphics mode | Yes | No — VT-100 has no such thing |
| Good for | Microcontrollers, 8-bit machines, anything sending raw bytes | `vi`, `htop`, ncurses, anything that expects a terminal |
| Default | ✓ | |

Switch between them with the control bar's `VT-AC` / `VT-100` readout, the
settings panel, `vtac --mode vt100`, or from the wire:

| From | To | Sequence |
| --- | --- | --- |
| Native | VT-100 | `ESC 0x03` (`1B 03`) |
| VT-100 | Native | `ESC [ ? 7000 h` |
| Either | The launch default | `ESC c` (RIS) |

Each personality is left by a sequence the *other* one cannot express, so neither
is a one-way door. Mode 7000 is VT-AC's own invention, chosen from a range
nobody else has claimed: xterm's `ctlseqs` documents nothing above 2006, DEC's
private modes are all below 100, and the other well-known squatters sit at
1000–1016, 2004 and mintty's 7700s.

The cursor, the two colours and the bell are shared between personalities, so
switching never teleports the cursor or changes what the screen looks like.

## 80-Column Mode

| | 40-column | 80-column |
| --- | --- | --- |
| Grid | 40 × 30 | 80 × 60 |
| Pixels | 320 × 240 | 640 × 480 |
| Font | 8 × 8 | 8 × 8 |
| Aspect | 4:3 | 4:3 |

An exact 2× of the 40-column grid — same font, same square pixels, same
8-rows-per-cell graphics mode. Only the number of cells changes, so every
command keeps its meaning: `SET COLUMN` and `SET ROW` take their operand modulo
the dimension, so they simply address further.

Switching **clears the screen and homes the cursor**, which is what DECCOLM does
on real hardware and avoids inventing a reflow policy no VT ever had.

The window does not resize. 80-column mode looks *finer* in the same window
rather than making it jump, and `-s scale` keeps meaning "how big is the
picture".

Switch with the control bar's `40` / `80` readout, the settings panel,
`vtac --columns 80`, or `ESC 0x01` / `ESC 0x02` from the wire.

## VT-100 Mode

In `vt100` personality the byte stream goes through a DEC ANSI parser instead of
the native one. Supported, in brief:

- **Cursor** — CUU/CUD/CUF/CUB, CUP/HVP, CNL/CPL, CHA, VPA, IND/RI/NEL,
  DECSC/DECRC.
- **Erase and edit** — ED, EL, IL, DL, ICH, DCH, ECH. *(IL/DL/ICH/DCH are VT102
  rather than VT100, and are included deliberately — ncurses needs them.)*
- **Attributes** — SGR 0/1/4/5/7 and their 22/24/25/27 counterparts, 30–37 and
  40–47, bright 90–97 and 100–107, `38;5;n`/`48;5;n` xterm-256, and
  `38;2;r;g;b` truecolour.
- **Scrolling** — DECSTBM scroll regions, honoured by LF, IND, RI, IL, DL and
  auto-wrap alike.
- **Modes** — DECCKM, DECCOLM, DECSCNM, DECOM, DECAWM with correct deferred
  last-column wrap, DECTCEM, the alternate screen (47/1047/1049), IRM, LNM.
- **Character sets** — SCS for US ASCII, UK and DEC Special Graphics, SO/SI
  shifting G0/G1. Line drawing resolves onto glyphs the CP437 ROM already has,
  which is why that ROM was the right choice for this fiction.
- **Tab stops** — HTS, TBC, default every 8 columns.
- **Reports** — DA (`ESC [ ? 1 ; 2 c`, a VT100 with the Advanced Video Option),
  DECID, DSR/CPR, DECREQTPARM, DECALN.
- **Reset** — RIS.

**Two colour models, and this is the trap.** `SGR 38;5;n` looks like "256
colours, and VT-AC has 256 colours", but they are not the same 256: the xterm
palette is quantized onto the RGB332 cube, so neighbouring xterm greys can land
on one VT-AC byte. To address VT-AC's palette exactly, use native mode's `0x18`
and `0x19`.

**What it does not do**, deliberately: 132 columns, double-height and
double-width lines, VT52 mode, DECSTR, the secondary and tertiary device
attributes, and UTF-8 (the glyph ROM is CP437). Each of those is explained,
with the `vttest` results that back the rest of this section, in
**[docs/VT100-CONFORMANCE.md](docs/VT100-CONFORMANCE.md)**.

## Character Set

![VT-AC Character Set](https://github.com/acwright/VT-AC/blob/main/images/characters.png?raw=true)

## Palette

![VT-AC Palette](https://github.com/acwright/VT-AC/blob/main/images/palette.png?raw=true)

## Instruction Set

The native personality is driven by single-byte instructions. A printable command
card is in [docs/VT-AC.pdf](docs/VT-AC.pdf).

| Instruction | # of Bytes | Command          | Description                                                                         |
|-------------|------------|------------------|-------------------------------------------------------------------------------------|
| `0x00`      |      1     | NULL             | No operation                                                                        |          
| `0x01`      |      1     | HOME             | Move cursor to home position (0,0)                                                  |
| `0x02`      |      2     | Cursor Character | 2nd byte is character to use, or `$00` to turn off (Default=`$00`)                  |
| `0x03`      |      1     | Cursor Mode      | Toggle cursor mode between solid/blinking (Default=solid)                           |
| `0x04`      |      1     | Reset            | Reset terminal (text mode, clear screen, cursor home-off-solid, bg=`$00`, fg=`$FF`) |
| `0x05`      |      2     | Bell Duration    | 2nd byte is bell duration in jiffies (i.e., 1/60th of a second) (Default=`$3C`)     |
| `0x06`      |      2     | Bell Frequency   | 2nd byte is bell frequency (Default=`$3D`)                                          |
| `0x07`      |      1     | BELL             | Play bell sound                                                                     |
| `0x08`      |      1     | BS               | Backspace                                                                           |
| `0x09`      |      1     | TAB              | Move cursor to next tab stop                                                        |
| `0x0A`      |      1     | LF               | Line feed (move cursor down, same column)                                           |
| `0x0B`      |      1     | Screen Mode      | Toggle screen mode between text/graphics modes (Default=text)                       |
| `0x0C`      |      1     | Clear Screen     | Clear the screen                                                                    |
| `0x0D`      |      1     | CR               | Carriage return (move cursor to start of line)                                      |
| `0x0E`      |      2     | Set Column       | 2nd byte is column, modulo the column count (Default=`$00`)                         |
| `0x0F`      |      2     | Set Row          | 2nd byte is row, modulo the row count (Default=`$00`)                               |
| `0x10`      |      1     | Delete to SoL    | Delete to start of line                                                             |
| `0x11`      |      1     | Delete to EoL    | Delete to end of line                                                               |
| `0x12`      |      1     | Delete to SoS    | Delete to start of screen                                                           |
| `0x13`      |      1     | Delete to EoS    | Delete to end of screen                                                             |
| `0x14`      |      1     | Scroll Left      | Scroll screen to the left replacing vacated columns with spaces                     |
| `0x15`      |      1     | Scroll Right     | Scroll screen to the right replacing vacated columns with spaces                    |
| `0x16`      |      1     | Scroll Up        | Scroll screen up replacing vacated rows with blank lines                            |
| `0x17`      |      1     | Scroll Down      | Scroll screen down replacing vacated rows with blank lines                          |
| `0x18`      |      2     | Foreground Color | 2nd byte is foreground color 0 (`$00`) to 255 (`$FF`) (Default=`$FF`)               |
| `0x19`      |      2     | Background Color | 2nd byte is background color 0 (`$00`) to 255 (`$FF`) (Default=`$00`)               |
| `0x1A`      |      2     | Data Next        | 2nd byte data not command - Allows 0 (`$00`) to 31 (`$1F`), and 127 (`$7F`) as data |
| `0x1B`      |      2     | ESC              | Escape — 2nd byte selects an extension, see below                                   |
| `0x1C`      |      1     | Cursor Left      | Move the cursor to the left                                                         |
| `0x1D`      |      1     | Cursor Right     | Move the cursor to the right                                                        |
| `0x1E`      |      1     | Cursor Up        | Move the cursor up                                                                  |
| `0x1F`      |      1     | Cursor Down      | Move the cursor down                                                                |
| `0x20`      |      1     | ASCII            | Standard ASCII Characters                                                           |
|   *         |      1     | ASCII            | Standard ASCII Characters                                                           |
| `0x7E`      |      1     | ASCII            | Standard ASCII Characters                                                           |
| `0x7F`      |      1     | DELETE           | Delete at cursor position                                                           |
| `0x80`      |      1     | ASCII            | Extended ASCII Characters                                                           |
|   *         |      1     | ASCII            | Extended ASCII Characters                                                           |
| `0xFF`      |      1     | ASCII            | Extended ASCII Characters                                                           |

### Escape extensions

`0x1B` was reserved in v1.3.0 and documented as "reserved for future escape code
implementation". This is that future, and it is **the one intentional deviation
from v1 in the whole 2.0.0 release**.

| Sequence | Effect |
| --- | --- |
| `ESC 0x01` | 40-column mode (320 × 240) |
| `ESC 0x02` | 80-column mode (640 × 480) |
| `ESC 0x03` | Enter the VT-100 personality |
| `ESC 0x04` | Query — reply with personality, columns and rows |
| `ESC 0x1B` | A literal `0x1B` as data |

The query replies with five bytes: `1B 04`, then the personality, then the column
and row counts as their literal values — `1B 04 00 28 1E` for 40 × 30,
`1B 04 00 50 3C` for 80 × 60. The personality byte always reads `00`, because the
query is a native-mode extension and a terminal in VT-100 mode never reaches it.

**Any other second byte is parsed as an ordinary byte**, which is exactly what v1
did with the byte after its no-op ESC. A v1 stream containing a stray `0x1B`
behaves identically, unless the byte that followed it happened to be `0x01`–`0x04`
or `0x1B`.

## Text Mode

In text mode, each byte sent to the terminal is interpreted and rendered as characters using the standard 8x8 pixel font. 
Each character cell can have its own foreground and background color by first setting the foreground and background colors before sending the next byte to be displayed. 
The terminal supports basic text operations such as cursor movement, line feed, carriage return, and clearing the screen.

The cursor can be controlled using the provided instructions, allowing it to be positioned using row and column commands, turned on or off, and set to solid or blinking mode.

In text mode, in order to display characters with ASCII values from 0 (`$00`) to 31 (``$1F``) or 127 (`$7F`), the "Data Next" instruction must first be sent to indicate that the next byte should be treated as data rather than a command.

## Graphics Mode

The terminal can be switched into graphics mode to display pixel-based graphics. Data is then interpreted as the next byte row (0-7) in the 8x8 pixel block at the cursor position (column, row). 
After sending 8 bytes, the cursor automatically moves to the next column. After reaching the end of the row, it wraps to the beginning of the next row.
After reaching the end of the screen, it wraps back to the top-left corner. If the cursor is moved manually using the set row and set column instructions, the next byte will be rendered at the top row of that position.
In this way, the cursor can be positioned and then a continuous stream of bytes can be sent to the terminal to render pixel data. 

Each byte that is sent can be individually colored using the foreground and background colors, enabling the creation of simple graphics and images.

In graphics mode, in order to send pixel data with ASCII values from 0 (`$00`) to 31 (``$1F``) or 127 (`$7F`), the "Data Next" instruction must first be sent to indicate that the next byte should be treated as pixel data rather than a command.

Graphics mode belongs to the native personality. VT-100 mode has no equivalent,
and a stream that left the terminal in graphics mode before switching
personality still gets text.

## Bell

The terminal includes a bell feature that can be triggered using the BELL instruction. The duration and frequency of the bell sound can be configured using the Bell Duration and Bell Frequency instructions, allowing for customizable audio feedback.

### How It Works

The bell system uses real-time audio synthesis to generate pure sine wave tones at specific frequencies. When a BELL command is received:

1. The current `bellFrequency` and `bellDuration` settings are captured and added to a playback queue
2. If no bell is currently playing, playback begins immediately
3. Bell sounds are played sequentially - each tone completes before the next begins
4. The audio device remains open while processing queued requests for optimal performance

This queue-based approach ensures that rapid sequences of bell commands (like playing musical scales) are handled smoothly without overlap or dropped notes.

### Configuration

**Bell Duration** (`0x05`): Sets the length of the bell tone in jiffies (1/60th of a second)
- Default: `$3C` (60 jiffies = 1 second)
- Range: `$01` to `$FF` (0.017 seconds to 4.25 seconds)
- Example: `$0F` (15 jiffies = 0.25 seconds)

**Bell Frequency** (`0x06`): Sets the musical note to play using hex values from the frequency table below
- Default: `$3D` (C6 = 1046.50 Hz)
- Range: `$01` to `$54` (C1 to B7)
- Example: `$2E` (A4 = 440 Hz - standard concert pitch)

**Bell** (`0x07`): Triggers playback with the current duration and frequency settings

### Usage Example

To play middle C (C4) for half a second:
```
0x05 0x1E  // Set duration to 30 jiffies (0.5 seconds)
0x06 0x25  // Set frequency to C4 (261.63 Hz)
0x07       // Play the bell
```

To play a simple ascending scale:
```
0x05 0x0F  // Set duration to quarter second
0x06 0x25  // C4
0x07       // Play
0x06 0x27  // D4
0x07       // Play
0x06 0x29  // E4
0x07       // Play
```

### Bell Frequencies

| Note | Hex    | Frequency (Hz) | Note | Hex    | Frequency (Hz) | Note | Hex    | Frequency (Hz) | Note | Hex    | Frequency (Hz) |
|------|--------|----------------|------|--------|----------------|------|--------|----------------|------|--------|----------------|
| C1   | `$01`  | 32.70          | C2   | `$0D`  | 65.41          | C3   | `$19`  | 130.81         | C4   | `$25`  | 261.63         |
| C#1  | `$02`  | 34.65          | C#2  | `$0E`  | 69.30          | C#3  | `$1A`  | 138.59         | C#4  | `$26`  | 277.18         |
| D1   | `$03`  | 36.71          | D2   | `$0F`  | 73.42          | D3   | `$1B`  | 146.83         | D4   | `$27`  | 293.66         |
| D#1  | `$04`  | 38.89          | D#2  | `$10`  | 77.78          | D#3  | `$1C`  | 155.56         | D#4  | `$28`  | 311.13         |
| E1   | `$05`  | 41.20          | E2   | `$11`  | 82.41          | E3   | `$1D`  | 164.81         | E4   | `$29`  | 329.63         |
| F1   | `$06`  | 43.65          | F2   | `$12`  | 87.31          | F3   | `$1E`  | 174.61         | F4   | `$2A`  | 349.23         |
| F#1  | `$07`  | 46.25          | F#2  | `$13`  | 92.50          | F#3  | `$1F`  | 185.00         | F#4  | `$2B`  | 369.99         |
| G1   | `$08`  | 49.00          | G2   | `$14`  | 98.00          | G3   | `$20`  | 196.00         | G4   | `$2C`  | 392.00         |
| G#1  | `$09`  | 51.91          | G#2  | `$15`  | 103.83         | G#3  | `$21`  | 207.65         | G#4  | `$2D`  | 415.30         |
| A1   | `$0A`  | 55.00          | A2   | `$16`  | 110.00         | A3   | `$22`  | 220.00         | A4   | `$2E`  | 440.00         |
| A#1  | `$0B`  | 58.27          | A#2  | `$17`  | 116.54         | A#3  | `$23`  | 233.08         | A#4  | `$2F`  | 466.16         |
| B1   | `$0C`  | 61.74          | B2   | `$18`  | 123.47         | B3   | `$24`  | 246.94         | B4   | `$30`  | 493.88         |
|  --  |   --   |   --           |  --  |   --   |   --           |  --  |   --   |   --           |  --  |   --   |   --           |
| C5   | `$31`  | 523.25         | C6   | `$3D`  | 1046.50        | C7   | `$49`  | 2093.00        |      |        |                |
| C#5  | `$32`  | 554.37         | C#6  | `$3E`  | 1108.73        | C#7  | `$4A`  | 2217.46        |      |        |                |
| D5   | `$33`  | 587.33         | D6   | `$3F`  | 1174.66        | D7   | `$4B`  | 2349.32        |      |        |                |
| D#5  | `$34`  | 622.25         | D#6  | `$40`  | 1244.51        | D#7  | `$4C`  | 2489.02        |      |        |                |
| E5   | `$35`  | 659.25         | E6   | `$41`  | 1318.51        | E7   | `$4D`  | 2637.02        |      |        |                |
| F5   | `$36`  | 698.46         | F6   | `$42`  | 1396.91        | F7   | `$4E`  | 2793.83        |      |        |                |
| F#5  | `$37`  | 739.99         | F#6  | `$43`  | 1479.98        | F#7  | `$4F`  | 2959.96        |      |        |                |
| G5   | `$38`  | 783.99         | G6   | `$44`  | 1567.98        | G7   | `$50`  | 3135.96        |      |        |                |
| G#5  | `$39`  | 830.61         | G#6  | `$45`  | 1661.22        | G#7  | `$51`  | 3322.44        |      |        |                |
| A5   | `$3A`  | 880.00         | A6   | `$46`  | 1760.00        | A7   | `$52`  | 3520.00        |      |        |                |
| A#5  | `$3B`  | 932.33         | A#6  | `$47`  | 1864.66        | A#7  | `$53`  | 3729.31        |      |        |                |
| B5   | `$3C`  | 987.77         | B6   | `$48`  | 1975.53        | B7   | `$54`  | 3951.07        |      |        |                |

## Command line

VT-AC installs its own command line. Open **Settings → COMMAND LINE → Install**,
and `vtac` lands on your `PATH`. On Windows the installer does it.

Every flag opens the app with that flag applied. Nothing prints terminal output —
the window *is* the output.

```
vtac -p /dev/ttyUSB0                       # connect on launch
vtac -p /dev/ttyUSB0 -b 115200 -a none -d 8 -t 1
vtac --mode vt100 --columns 80             # 80-column VT-100 mode
vtac -l ./examples/characters.bin          # load a data file
vtac -f -s 4                               # fullscreen, 4× scale
```

| Flag | Description | Default |
| --- | --- | --- |
| `-p, --port <port>` | Path to the serial port, connected before the window shows | |
| `-b, --baudrate <rate>` | Baud rate | `9600` |
| `-a, --parity <parity>` | `odd` \| `even` \| `none` | `none` |
| `-d, --databits <bits>` | `5` \| `6` \| `7` \| `8` | `8` |
| `-t, --stopbits <bits>` | `1` \| `1.5` \| `2` | `1` |
| `-m, --mode <mode>` | `native` \| `vt100` | saved setting |
| `-c, --columns <cols>` | `40` \| `80` | saved setting |
| `-f, --fullscreen` | Open fullscreen | off |
| `-s, --scale <scale>` | Window scale, 1–6 | saved setting |
| `-l, --load <path>` | Data file to parse after launch | |
| `--app <path>` | Where the VT-AC application is, if not where `vtac` looks | |
| `-v, --version` | Print the version | |
| `-h, --help` | Show help | |

**Framing, personality and column flags apply to that launch only.** Someone
running `vtac -p /dev/ttyUSB0 --mode vt100` is talking to one device, not
changing what the app does tomorrow — and anything they then change in the
settings panel persists normally.

`-s` and `-f` follow the same rule from the other direction: leaving `-s` out
means "the size you left it", and `vtac -f` does not make the app open
fullscreen next time.

## Web version

**[acwright.github.io/VT-AC](https://acwright.github.io/VT-AC/)** — the same
terminal and the same renderer, in a browser tab. What differs:

- **Serial is the Web Serial API**, so it needs Chrome or Edge over HTTPS, and a
  click to pick the port. The settings panel says so if your browser lacks it.
- **Files** come from a file picker rather than a native dialog.
- **Settings live in `localStorage`**, so two tabs are two independent terminals
  sharing one origin.
- No window scale, no fullscreen button, and no command-line section — all three
  are the desktop app's.

## Development

```
npm install
npm run dev             # Electron app with hot reload
npm run build:web       # web bundle → dist/web
npm run preview:web     # serve that bundle
npm run cli             # build and run the CLI against a dev app
npm test                # 531 unit tests
npm run typecheck
```

Packaging, one platform each:

```
npm run dist:mac        # signed + notarized dmg
npm run dist:win        # nsis installer, via Wine
npm run dist:linux      # AppImage + deb, via Docker
```

And the checks that are not unit tests:

```
npm run verify:palette                 # RGB332 expansion against images/palette.png
npm run verify:cellmodel               # the cell model against v1's own code, byte for byte
npm run icons                          # regenerate the app icon and web icons
npm run docs:card                      # regenerate docs/VT-AC.pdf from the HTML
node scripts/vttest-run.mjs 1 2 3 6    # VT-100 conformance, over a serial loopback
```

### Project structure

```
VT-AC/
├── build/                      icons, entitlements, and the art generator
├── bin/vtac                    dev entry point for the CLI
├── scripts/                    packaging, verification and capture helpers
├── docs/                       command card, VT-100 conformance
├── src/
│   ├── core/                   the terminal itself — no DOM, no Electron
│   │   ├── VTAC.ts             orchestrates Screen + the two parsers
│   │   ├── Screen.ts           cell model, geometry, scrolling, rasterizer
│   │   ├── Cell.ts             cell planes and the attribute bitfield
│   │   ├── Font.ts             CP437 glyph ROM, DEC Special Graphics map
│   │   ├── palette.ts          RGB332 → RGBA, xterm-256 → RGB332
│   │   ├── keymap.ts           key event → bytes, personality-aware
│   │   └── ansi/               the DEC ANSI parser and its dispatch
│   ├── shared/                 types, boot contract, the preload API
│   ├── main/                   Electron main: window, serial, settings, CLI shim
│   ├── preload/
│   ├── cli/                    the `vtac` command
│   ├── renderer/               Vue 3 + Pinia + Tailwind
│   └── tests/
├── electron.vite.config.ts     desktop build
├── vite.web.config.ts          web build
└── electron-builder.yml        packaging
```

The core is deliberately free of both the DOM and Electron: the same `VTAC`
class runs in the desktop app, the web build and the test suite.

## Migrating from v1.x

**VT-AC is no longer an npm package.** `vtac-terminal` stays published so
nothing that already depends on it breaks, but it is deprecated and will not be
updated. v2.0.0 is a desktop app, a web app, and a CLI the app installs.

1. Remove the old one, or it will win:
   ```
   npm uninstall -g vtac-terminal
   ```
   This matters more than it looks. npm's `bin` directory usually comes *before*
   `/usr/local/bin` on `PATH`, so with both installed a bare `vtac` answers
   `1.3.0` — a correct v2 install that looks broken.
2. [Install v2.0.0](#install).
3. Open **Settings → COMMAND LINE → Install** to get `vtac` back on your `PATH`.

**Every v1 flag still works**, and now launches the app instead of an SDL window.
Two are new: `--mode` and `--columns`. Two changed meaning slightly: `-s` and
`-f` no longer have defaults that would overwrite a remembered window.

**Terminal behaviour is unchanged.** With default settings — `native`
personality, 40 columns — v2.0.0 processes a byte stream identically to v1.3.0.
The v1 test suite still runs unmodified against the new core, and
`npm run verify:cellmodel` compares the two implementations byte for byte over
the whole framebuffer after every byte of 14 streams.

There is exactly one intentional deviation, and it is the extension point v1
reserved for it: **`0x1B` (ESC) is no longer a no-op.** See
[Escape extensions](#escape-extensions).

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## TODO

- Add support for additional character sets.

## License

MIT: [https://github.com/acwright/VT-AC/blob/main/LICENSE](https://github.com/acwright/VT-AC/blob/main/LICENSE)

## Credits

- Inspired By: [http://searle.x10host.com/MonitorKeyboard/index.html](http://searle.x10host.com/MonitorKeyboard/index.html)
- Font Set: [https://github.com/susam/pcface/tree/main/out/oldschool-bios-8x8](https://github.com/susam/pcface/tree/main/out/oldschool-bios-8x8)
- VT-100 conformance measured with [vttest](https://invisible-island.net/vttest/)
