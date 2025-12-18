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

## Installation

### From NPM

```
npm install -g vtac
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

Open the terminal emulator with a path to the serial port:

```
vtac -p /dev/ttyUSB0
```

### With Scaling

```
vtac -p /dev/ttyUSB0 -s 2
```

### Command Line Options

- `-v, --version` - Output the current version
- `-h, --help` - Display help information
- `-p, --path <path>` - Path to the serial port (e.g., /dev/ttyUSB0)
- `-b, --baudrate <baudrate>` - Baud rate (default: "9600")
- `-a, --parity <parity>` - Parity (default: "none")
- `-d, --databits <databits>` - Data bits (default: "8")
- `-t, --stopbits <stopbits>` - Stop bits (default: "1")
- `-s, --scale <scale>` - Scale (default: "2")

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

## License

MIT: [https://github.com/acwright/VT-AC/blob/main/LICENSE](https://github.com/acwright/VT-AC/blob/main/LICENSE)

## Credits

Inspired by: [http://searle.x10host.com/MonitorKeyboard/index.html](http://searle.x10host.com/MonitorKeyboard/index.html)

