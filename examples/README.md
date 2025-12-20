VT-AC EXAMPLES
==============

This directory contains NodeJS example scripts that generate binary files for use with the VT-AC terminal.

Available Examples
------------------

1. **characters.js**: Displays all 255 characters in a 16 x 16 grid in the center of the terminal.
    - Generated File: `characters.bin`
    - Build: `node characters.js`
    - VT-AC Command: `vtac -l /path/to/characters.bin`
2. **palette.js**: Displays all 255 colors in a 16 x 16 grid in the center of the terminal.
    - Generated File: `palette.bin`
    - Build: `node palette.js`
    - VT-AC Command: `vtac -l /path/to/palette.bin`