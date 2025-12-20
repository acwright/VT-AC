// Node.js script to generate a binary file displaying all 255 colors in VT-AC terminal
const { writeFileSync } = require('fs');

// VT-AC constants
// We'll display characters in a 16x16 grid, centered on a 40x30 display
const COLS = 40;
const ROWS = 30;
const BLOCK_SIZE = 8; // 8x8 pixel blocks
const COLORS = 255;
const HOME = 0x01;
const LINE_FEED = 0x0A;
const SCREEN_MODE = 0x0B;
const CLEAR_SCREEN = 0x0C;
const SET_COL = 0x0E;
const SET_ROW = 0x0F;
const FG_COLOR = 0x18;

// Grid size for palette display
const PALETTE_COLS = 16;
const PALETTE_ROWS = 16;

// Center the palette grid
const startCol = Math.floor((COLS - PALETTE_COLS) / 2);
const startRow = Math.floor((ROWS - PALETTE_ROWS) / 2);

let bytes = [];

// Clear screen and home cursor
bytes.push(CLEAR_SCREEN);
bytes.push(HOME);
// Screen Mode: graphics
bytes.push(SCREEN_MODE);
// Set starting cursor position
bytes.push(SET_COL, startCol); // Set column
bytes.push(SET_ROW, startRow); // Set row

let color = 0;
for (let r = 0; r < PALETTE_ROWS; r++) {
	for (let c = 0; c < PALETTE_COLS; c++) {
		if (color > COLORS) break;
    bytes.push(FG_COLOR, color); // Foreground color
		for (let i = 0; i < BLOCK_SIZE; i++) {
		  bytes.push(0xFF); // Data Next, then 0xFF (all 8 pixels on)
	  }
		color++;
	}
  bytes.push(LINE_FEED); // Line feed
  bytes.push(SET_COL, startCol); // Set column
}

// Write to file
writeFileSync('palette.bin', Buffer.from(bytes));
console.log('Binary file "palette.bin" generated.');
