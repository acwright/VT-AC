// Node.js script to generate a binary file that plays all bell notes for a quarter of a second
const { writeFileSync } = require('fs');

// VT-AC Bell Commands
const BELL_DURATION = 0x05;    // Set bell duration (2nd byte in jiffies: 1/60th of a second)
const BELL_FREQUENCY = 0x06;   // Set bell frequency (2nd byte is note value from $01-$54)
const BELL = 0x07;             // Play bell sound

let bytes = [];

// Set bell duration to 0.125 seconds (8 jiffies: 8/60 ≈ 0.133 seconds) - twice as fast as quarter second
const EIGHTH_SECOND = 0x08;
bytes.push(BELL_DURATION, EIGHTH_SECOND);

// Play all notes from C1 ($01) to B7 ($54)
// Total of 84 notes covering 7 octaves
for (let note = 0x01; note <= 0x54; note++) {
  // Set the bell frequency to the current note
  bytes.push(BELL_FREQUENCY, note);
  
  // Play the bell
  bytes.push(BELL);
}

// Write to file
writeFileSync('bell.bin', Buffer.from(bytes));
console.log('Binary file "bell.bin" generated.');