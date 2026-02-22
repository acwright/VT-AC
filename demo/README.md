VT-AC DEMO
==========

This folder contains a PlatformIO Arduino demo that streams VT-AC instructions over serial to render a startup screen.

What the demo does
------------------

- Resets VT-AC and enables a blinking cursor
- Prints the VT-AC logo and tagline
- Draws a 16-color bar using VT-AC foreground color commands
- Turns the cursor off when finished

Project target
--------------

- PlatformIO environment: `nanoatmega328`
- Board: Arduino Nano (ATmega328, new bootloader)
- Framework: Arduino
- Serial baud rate: `9600`

Prerequisites
-------------

1. PlatformIO CLI installed (`pio`) or VS Code + PlatformIO extension.
2. Arduino Nano connected by USB.
3. VT-AC installed or built from source.

Build and upload (PlatformIO CLI)
---------------------------------

From the repository root:

1. Build the demo:
	- `pio run -d ./demo`
2. Upload to the Arduino Nano:
	- `pio run -d ./demo -t upload`

If auto-detect fails, specify the upload port:

- `pio run -d ./demo -t upload --upload-port /dev/tty.usbserial-XXXX`

Run with VT-AC
--------------

1. Find your serial port on macOS:
	- `ls /dev/tty.usb* /dev/tty.wchusb*`
2. Start VT-AC and connect to the same port at `9600` baud:
	- Global install: `vtac -p /dev/tty.usbserial-XXXX -b 9600`
	- From source: `node ./dist/index.js -p /dev/tty.usbserial-XXXX -b 9600`

You should see the VT-AC logo, tagline, and color bar rendered by the Arduino sketch.

Using VS Code PlatformIO UI
---------------------------

- Open the `demo` folder in PlatformIO.
- Select environment `nanoatmega328`.
- Run **Build**, then **Upload**.
- Launch VT-AC with the Arduino serial port as shown above.

