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

A fantasy ASCII terminal emulator.

## Features

- Emulates a simple ASCII terminal with 40 columns and 30 rows or 8x8 pixel blocks.
- Controllable via serial port using only standard ASCII data.
- 320 x 240 native pixel display area.
- Uses a classic 8x8 pixel font (IBM PC BIOS / Code Page 437) for character rendering.
- Text or graphics mode support.
- 256 colors available (RGB332).
- Set foreground and background colors for each 8x8 pixel block or 8x1 pixel row.
- Connects via serial port for real-time data communication with Arduino, Raspberry Pi, [6502 computer](https://github.com/acwright/6502), or anything with a serial port!
- Or you can load binary data files directly into the terminal to be parsed and displayed.
- Supports configurable baud rate, parity, data bits, and stop bits.
- Fullscreen mode for immersive terminal experience.
- Adjustable scaling for better visibility.

![VT-AC Demo](https://github.com/acwright/VT-AC/blob/main/images/VT-AC.gif?raw=true)

## Quick Start
1. Install VT-AC globally via NPM:
```
npm install -g vtac-terminal
```
2. Connect a serial device (e.g., Arduino) to your computer.
3. Open VT-AC terminal emulator with the appropriate path to the serial port:
```
vtac -p /dev/ttyUSB0
```
4. Start sending ASCII data from your serial device to see it displayed in the VT-AC terminal!

## Character Set

![VT-AC Character Set](https://github.com/acwright/VT-AC/blob/main/images/characters.png?raw=true)

## Palette

![VT-AC Palette](https://github.com/acwright/VT-AC/blob/main/images/palette.png?raw=true)

## Instruction Set

The VT-AC terminal supports a simple instruction set using standard ASCII values to control its behavior. Below is a summary of the supported instructions:

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
| `0x0E`      |      2     | Set Column       | 2nd byte is column 0 (`$00`) to 39 (`$27`) (Default=`$00`)                          |
| `0x0F`      |      2     | Set Row          | 2nd byte is row 0 (`$00`) to 29 (`$1D`) (Default=`$00`)                             |
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
| `0x1B`      |      1     | ESC              | Reserved for future escape code implementation                                      |
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

## Installation

### From NPM

```
npm install -g vtac-terminal
```

### From Source

1. Clone the repository:
```
git clone https://github.com/acwright/VT-AC.git
cd VT-AC
```

2. Install dependencies:
```
npm install
```

3. Build the project:
```
npm run build
```

4. (Optional) Link globally:
```
npm link
```

## Usage

### Basic Usage

Open the VT-AC terminal emulator with a path to the serial port (9600 baud, no parity, 8 data bits, 1 stop bit by default):

```
vtac -p /dev/ttyUSB0
```

### Fullscreen Mode

```
vtac -p /dev/ttyUSB0 -f
```

### With Scaling

```
vtac -p /dev/ttyUSB0 -s 4
```

### Load Data File

VT-AC can load binary data files directly into the terminal before launch for parsing and display:

```
vtac -l /path/to/data.bin
```

### Connect to Serial Port

```
vtac -p /dev/ttyUSB0 -b 115200 -a none -d 8 -t 1
```

### Command Line Options

- `-v, --version` - Output the current version
- `-h, --help` - Display help information
- `-p, --port <port>` - Path to the serial port (e.g., /dev/ttyUSB0)
- `-b, --baudrate <baudrate>` - Baud rate (default: "9600")
- `-a, --parity <parity>` - Parity (default: "none")
- `-d, --databits <databits>` - Data bits (default: "8")
- `-t, --stopbits <stopbits>` - Stop bits (default: "1")
- `-f, --fullscreen` - Enable fullscreen mode (default: false)
- `-s, --scale <scale>` - Scale (default: "2")
- `-l, --load <load>` - Path to data file to load (e.g. /path/to/data.bin)

## Development

### Run in Development Mode

```
npm run build
node ./dist/index.js -p /dev/ttyUSB0
```

### Run Test Suite

Run all unit tests:

```
npm test
```

Run tests in watch mode:

```
npm run test:watch
```

Run tests with coverage output (text summary + lcov):

```
npm run test:coverage
```

### Release Build

```
git tag vX.Y.Z
git push origin main --tags
npm publish
```

### Project Structure

```
VT-AC/
├── src/
│   ├── index.ts              # CLI entry point
│   └── VT-AC/
│       └── VT-AC.ts          # Core logic
├── dist/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## TODO

- Implement escape sequences for extended control and ANSI support.
- Add support for additional character sets.
- 80 column mode.
- VT-100 terminal emulation.

## License

MIT: [https://github.com/acwright/VT-AC/blob/main/LICENSE](https://github.com/acwright/VT-AC/blob/main/LICENSE)

## Credits

- Inspired By: [http://searle.x10host.com/MonitorKeyboard/index.html](http://searle.x10host.com/MonitorKeyboard/index.html)
- Font Set: [https://github.com/susam/pcface/tree/main/out/oldschool-bios-8x8](https://github.com/susam/pcface/tree/main/out/oldschool-bios-8x8)

