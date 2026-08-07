VT-AC EXAMPLES
==============

This directory contains NodeJS example scripts that generate binary files for use with the VT-AC terminal.

Loading a file
--------------

Three ways, all equivalent — the bytes go through the parser exactly as if they
had arrived over the serial port:

1. **Control bar** — the leftmost button, "Load data file".
2. **Command line** — `vtac -l ./examples/characters.bin`.
3. **Settings panel** — FILES → Load, which also remembers the file so Reload
   can run it again.

Generate a `.bin` first:

```
cd examples
node characters.js
```

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
4. **ansi.js**: Switches the terminal into 80-column VT-100 mode and draws a
   box with DEC line drawing, the four VT100 attributes, ANSI and xterm-256
   colour, and a scroll region. Returns to the native personality at the end.
    - Generated File: `ansi.bin`
    - Build: `node ansi.js`
    - VT-AC Command: `vtac -l /path/to/ansi.bin`

The first three are native-personality files and work exactly as they did in
v1.3.0. `ansi.js` is the one that needs v2: it opens with `ESC 0x02` and
`ESC 0x03`, the escape extensions that select 80 columns and the VT-100
personality, so it configures the terminal itself rather than assuming anything
about how you launched it.

It leaves the screen in 80-column mode on purpose — switching back to 40 clears
the screen, which would wipe the thing you loaded it to look at. Click the
control bar's `80` readout when you have finished.
