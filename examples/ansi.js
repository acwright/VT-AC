// Node.js script to generate a binary file demonstrating VT-AC's VT-100 personality
//
// Unlike the other three examples, this one starts in the native personality and
// switches: the first two bytes are ESC 0x02 (80 columns) and ESC 0x03 (VT-100),
// which is exactly how a host on the wire would ask for it. Everything after
// that is ANSI, and the last thing it sends is ESC [ ? 7000 h -- VT-AC's private
// mode for returning to the native protocol.
//
// The 80-column screen stays up deliberately: going back to 40 would clear it,
// as a column switch always does. Click the control bar's 80 readout when you
// have finished looking at it.
//
// Everything written below is ASCII. The screen is a CP437 ROM, so a UTF-8
// middle dot or arrow pasted into a string here would arrive as its individual
// bytes and draw as that many CP437 glyphs -- the same thing that happens to
// htop's sort indicator, and the reason this file uses '-' for a separator.
const { writeFileSync } = require('fs');

const ESC = 0x1B;

// --- Native personality: the two escape extensions ------------------------
const bytes = [ESC, 0x02, ESC, 0x03]; // 80 columns, then VT-100

// --- Everything below is ANSI --------------------------------------------
const out = [];
const push = (text) => out.push(...Buffer.from(text, 'latin1'));

const CSI = '\x1b[';
const sgr = (...codes) => `${CSI}${codes.join(';')}m`;
const at = (row, col) => `${CSI}${row};${col}H`;

// DEC Special Graphics is designated into G1 and reached with SO/SI, so the
// box below is drawn the way a VT100 host draws one: shift out, draw, shift in.
const G1_GRAPHICS = '\x1b)0';
const SO = '\x0e';
const SI = '\x0f';

// The DEC line-drawing codes, by the ASCII letter that selects them.
const TL = 'l', TR = 'k', BL = 'm', BR = 'j';
const H = 'q', V = 'x', LT = 't', RT = 'u';

push(`${CSI}2J`); // erase the whole screen
push(G1_GRAPHICS);

const WIDTH = 62;
const box = (row, col, width, height) => {
  push(at(row, col) + SO + TL + H.repeat(width - 2) + TR + SI);
  for (let i = 1; i < height - 1; i++) {
    push(at(row + i, col) + SO + V + SI + ' '.repeat(width - 2) + SO + V + SI);
  }
  push(at(row + height - 1, col) + SO + BL + H.repeat(width - 2) + BR + SI);
};

box(2, 9, WIDTH, 16);

// A divider with tee pieces, so the corners are not the only join being tested.
push(at(5, 9) + SO + LT + H.repeat(WIDTH - 2) + RT + SI);

push(at(3, 11) + sgr(1) + 'VT-AC' + sgr(0) + '  -  VT-100 personality, 80 columns');
push(at(4, 11) + 'Line drawing, attributes and colour, all over ANSI.');

// The four attributes a VT100 with the Advanced Video Option can draw, which
// are exactly the four VT-AC's rasterizer implements.
const attributes = [
  [0, 'normal'],
  [1, 'bold'],
  [4, 'underline'],
  [5, 'blink'],
  [7, 'reverse']
];
attributes.forEach(([code, label], i) => {
  push(at(7 + i, 11) + sgr(code) + label.padEnd(12) + 'the quick brown fox' + sgr(0));
});

// The eight ANSI colours as foregrounds, then as backgrounds. These are SGR
// colours quantized onto VT-AC's RGB332 palette — see the README's note on why
// `38;5;n` is not the same 256 colours the native 0x18 command addresses.
push(at(13, 11) + 'colour');
for (let c = 0; c < 8; c++) push(at(13, 24 + c * 3) + sgr(30 + c) + '###');
for (let c = 0; c < 8; c++) push(at(14, 24 + c * 3) + sgr(40 + c) + '   ');
push(sgr(0));

push(at(16, 11) + 'xterm-256 ramp');
// 0xDB is CP437's full block, which is what a solid swatch is here.
for (let i = 0; i < 24; i++) push(at(16, 27 + i) + sgr(38, 5, 232 + i) + '\xdb');
push(sgr(0));

// A scroll region, which is the sequence full-screen applications lean on
// hardest — three lines fed into a two-line region, so the first scrolls away.
push(`${CSI}19;20r`);
push(at(19, 11) + 'scroll region [19..20]:');
push(at(20, 11) + 'this line scrolls away\r\n');
push(at(20, 11) + 'and this one is left\r\n');
push(`${CSI}r`); // release the region

push(at(23, 11) + 'Press the VT-AC / VT-100 readout to switch back by hand.');
push(at(25, 1));

// --- Back to the native personality --------------------------------------
push(`${CSI}?7000h`);

writeFileSync('ansi.bin', Buffer.from([...bytes, ...out]));
console.log('Binary file "ansi.bin" generated.');
