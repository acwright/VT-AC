#include <Arduino.h>

static int PALETTE[16] = { 0x00, 0xBB, 0xFF, 0xC4, 0xE6, 0x64, 0x68, 0xA8, 0xF8, 0x24, 0x2C, 0x38, 0x01, 0x0A, 0x13, 0x7F };

void setup() {
    Serial.begin(9600);

    // Reset everything... just in case
    Serial.write(0x04);
    
    // Use 0x20 (SPACE) as the cursor character
    Serial.write(0x02);
    Serial.write(0x20);

    // Toggle on cursor blinking
    Serial.write(0x03);

    // Delay for 2 seconds
    delay(2000);

    // Move the cursor down 8 rows
    for(int i = 0; i < 8; i++) {
        Serial.write(0x1F);
    }

    // Print the logo
    Serial.println("  ___ ___ _______      _______ _______ ");
    Serial.println(" |   Y   |       |____|   _   |   _   |");
    Serial.println(" |.  |   |.|   | |____|.  |   |.  |___|");
    Serial.println(" |.  |   `-|.  |-'    |.  _   |.  |___ ");
    Serial.println(" |:  |   | |:  |      |:  |   |:  |   |");
    Serial.println("  \\:.. ./  |::.|      |::.|:. |::.. . |");
    Serial.println("   `---'   `---'      `--- ---`-------'");
    Serial.println();

    // Print the tagline
    Serial.write(0x09); // TAB
    Serial.println("A fantasy ASCII terminal emulator");
    Serial.println();

    // Print the color bar
    Serial.write(0x09); // TAB
    Serial.write(0x09); // TAB
    Serial.write(0x09); // TAB

    for (int i = 0; i < 16; i++) {
        // Set the foreground color
        Serial.write(0x18);
        Serial.write(PALETTE[i]);

        // Print the checkerboard character
        Serial.write(0xB1);
    }
    Serial.println();

    // Set the foreground color back to white
    Serial.write(0x18);
    Serial.write(0xFF);

    // Turn off the cursor
    Serial.write(0x02);
    Serial.write(0x00);
}

void loop() {}