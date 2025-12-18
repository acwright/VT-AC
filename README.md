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

Convert a binary file to Wozmon format starting at address 0x0000:

```
vtac <path-to-binary-file>
```

### With Custom Starting Address

Specify a custom starting address in hexadecimal:

```
vtac -a 0x800 <path-to-binary-file>
```

or

```
vtac --address 0x800 <path-to-binary-file>
```

### Redirect Output to File

```
vtac -a 0x800 program.prg > output.txt
```

### Command Line Options

- `-v, --version` - Output the current version
- `-h, --help` - Display help information
- `-a, --address <address>` - Starting address in hexadecimal (default: 0x0000)

## Output Format

The tool outputs binary data in hexadecimal format with 16 bytes per line:

```
0800: AA BB CC DD EE 00 11 22 33 44 55 66 77 88 99 FF
0810: 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 10
```

Each line contains:
- 4-digit hexadecimal address
- Colon separator
- Up to 16 bytes in hexadecimal format, space-separated

## Example

```
# Convert a 6502 program binary starting at address 0x800
bin2woz -a 0x800 /path/to/binary/file.prg > output.txt
```

## Development

### Run in Development Mode

```
npm run build
node ./dist/index.js -a 0x800 <path-to-binary-file>
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

