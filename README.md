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

## Quick Start
1. Install VT-AC globally via NPM:
```
npm install -g vt-ac
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
| `0x05`      |      1     | N/A              | Reserved for future use                                                             |
| `0x06`      |      1     | N/A              | Reserved for future use                                                             |
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

## Installation

### From NPM

```
npm install -g vt-ac
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
- `-p, --path <path>` - Path to the serial port (e.g., /dev/ttyUSB0)
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

