// Node.js script to generate a binary file displaying all 255 characters in VT-AC terminal
const { writeFileSync } = require('fs');

// VT-AC expects bytes 0-31 and 127 as commands, so use Data Next (0x1A) before them
// We'll display characters in a 16x16 grid, centered on a 40x30 display
const GRID_COLS = 16;
const GRID_ROWS = 16;
const DISPLAY_COLS = 40;
const DISPLAY_ROWS = 30;

const HOME = 0x01;
const CLEAR_SCREEN = 0x0C;
const SET_COL = 0x0E;
const SET_ROW = 0x0F;
const FG_COLOR = 0x18;
const BG_COLOR = 0x19;
const DATA_NEXT = 0x1A;

let bytes = [];

// Clear screen and home cursor
bytes.push(CLEAR_SCREEN);
bytes.push(HOME);
// Set foreground to white, background to black
bytes.push(FG_COLOR, 0xFF);
bytes.push(BG_COLOR, 0x00);

// Calculate top-left corner to center the grid
const startRow = Math.floor((DISPLAY_ROWS - GRID_ROWS) / 2);
const startCol = Math.floor((DISPLAY_COLS - GRID_COLS) / 2);

for (let i = 0; i < GRID_ROWS * GRID_COLS; i++) {
  let gridRow = Math.floor(i / GRID_COLS);
  let gridCol = i % GRID_COLS;
  let row = startRow + gridRow;
  let col = startCol + gridCol;
  bytes.push(SET_ROW, row);
  bytes.push(SET_COL, col);

  // If char is a command (0-31 or 127), use Data Next
  if ((i >= 0 && i <= 31) || i === 127) {
    bytes.push(DATA_NEXT, i);
  } else {
    bytes.push(i);
  }
}

// Write to file
writeFileSync('characters.bin', Buffer.from(bytes));
console.log('Binary file "characters.bin" generated.');
