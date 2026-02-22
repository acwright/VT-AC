VT-AC EXAMPLES
==============

This directory contains NodeJS example scripts that generate binary files for use with the VT-AC terminal.

Using the `-l` Option
---------------------

The `-l` option loads a binary file into VT-AC at startup.

1. Generate an example `.bin` file from this directory:
    - `node characters.js`
2. Run VT-AC and load the generated file:
    - If installed globally: `vtac -l ./examples/characters.bin`
    - From source checkout: `node ./dist/index.js -l ./examples/characters.bin`

Available Examples
------------------

1. **bell.js**: Generates a binary file that causes the terminal to emit all bell sounds when loaded.
    - Generated File: `bell.bin`
    - Build: `node bell.js`
    - VT-AC Command: `vtac -l /path/to/bell.bin`
2. **characters.js**: Displays all 255 characters in a 16 x 16 grid in the center of the terminal.
    - Generated File: `characters.bin`
    - Build: `node characters.js`
    - VT-AC Command: `vtac -l /path/to/characters.bin`
3. **palette.js**: Displays all 255 colors in a 16 x 16 grid in the center of the terminal.
    - Generated File: `palette.bin`
    - Build: `node palette.js`
    - VT-AC Command: `vtac -l /path/to/palette.bin`