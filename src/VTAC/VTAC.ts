import sdl, { Sdl } from '@kmamal/sdl'
import { SerialPort } from 'serialport'

export class VTAC {

  port?: SerialPort
  path?: string
  baudRate: number = 115200
  parity: 'odd' | 'even' | 'none' = 'none'
  dataBits: 5 | 6 | 7 | 8 | undefined = 8
  stopBits: 1 | 1.5 | 2 | undefined = 1

  window?: Sdl.Video.Window
  scale: number = 2
  fullscreen: boolean = false

  buffer: Buffer<ArrayBuffer> = Buffer.alloc(320 * 240 * 3).fill(0x00)

  mode: 'text' | 'graphics' = 'text'

  cursorX: number = 0
  cursorY: number = 0
  cursorChar: number = 0x20 // Space
  cursorBlinking: boolean = true
  cursorCharNextByte: boolean = false
  cursorXNextByte: boolean = false
  cursorYNextByte: boolean = false

  pixelX: number = 0
  pixelY: number = 0
  pixelXNextByte: boolean = false
  pixelYNextByte: boolean = false

  characterNextByte: boolean = false

  fontAttributesNextByte: boolean = false
  fontColorNextByte: boolean = false

  launch = () => {
    if (this.path) { 
      this.port = new SerialPort({
        path: this.path,
        baudRate: this.baudRate,
        parity: this.parity,
        dataBits: this.dataBits,
        stopBits: this.stopBits
      }, (err) => {
        if (err) {
          console.log('Error: ', err.message)
        }
      })

      this.port.on('data', this.onData)
    }

    this.window = sdl.video.createWindow({
      title: "VT-AC",
      width: 320 * this.scale,
      height: 240 * this.scale,
      fullscreen: this.fullscreen,
      resizable: false
    })
    this.window.on('keyDown', this.onKey)
    this.window.on('textInput', this.onText)
    this.window.on('close', (event) => {
      if (this.port && this.port.isOpen) {
        this.port.close()
      }
    })

    this.render()
  }

  update = (data: number) => {
    if (this.cursorCharNextByte) {
      this.cursorChar = data
      this.cursorCharNextByte = false
      // TODO: Update screen with new cursor character
      return
    }
    if (this.cursorXNextByte) {
      this.cursorX = data % 40 // 0 to 39
      this.cursorXNextByte = false
      // TODO: Update screen with new cursor position
      return
    }
    if (this.cursorYNextByte) {
      this.cursorY = data % 30 // 0 to 29
      this.cursorYNextByte = false
      // TODO: Update screen with new cursor position
      return
    }

    if (this.pixelXNextByte) {
      this.pixelX = data % 160 // 0 to 159
      this.pixelXNextByte = false
      return
    }
    if (this.pixelYNextByte) {
      this.pixelY = data % 60 // 0 to 59
      this.pixelYNextByte = false
      return
    }

    if (this.fontAttributesNextByte) {
      // TODO: Handle set font attributes
      this.fontAttributesNextByte = false
      return
    }
    if (this.fontColorNextByte) {
      // TODO: Handle set font color
      this.fontColorNextByte = false
      return
    }

    if (this.characterNextByte) {
      // TODO: Handle character byte
      this.characterNextByte = false
      return
    }

    switch(true) {
      case (data == 0x00): // NULL
        break
      case (data == 0x01): // CURSOR HOME
        this.cursorX = 0
        this.cursorY = 0
        // TODO: Update screen with new cursor position
        break
      case (data == 0x02): // CURSOR CHARACTER
        this.cursorCharNextByte = true
        break
      case (data == 0x03): // CURSOR BLINKING
        this.cursorBlinking = true
        // TODO: Update screen with new cursor animation
        break
      case (data == 0x04): // CURSOR SOLID
        this.cursorBlinking = false
         // TODO: Update screen with new cursor animation
        break
      case (data == 0x05): // SET GRAPHICS COLUMN
        this.pixelXNextByte = true
        break
      case (data == 0x06): // SET GRAPHICS ROW
        this.pixelYNextByte = true
        break
      case (data == 0x07): // BELL
        // TODO: Play bell sound
        break
      case (data == 0x08): // BACKSPACE
        // TODO: Handle backpsace
        break
      case (data == 0x09): // TAB
        // TODO: Handle tab
        break
      case (data == 0x0A): // LINE FEED
        // TODO: Handle line feed
        break
      case (data == 0x0B): // SCREEN MODE
        this.mode == 'text' ? this.mode = 'graphics' : this.mode = 'text'
        break
      case (data == 0x0C): // CLEAR SCREEN
        // TODO: Handle clear screen
        break
      case (data == 0x0D): // CARRIAGE RETURN
        // TODO: Handle carriage return
        break
      case (data == 0x0E): // SET TEXT COLUMN
        this.cursorXNextByte = true
        break
      case (data == 0x0F): // SET TEXT ROW
        this.cursorYNextByte = true
        break
      case (data == 0x10): // DELETE TO START OF LINE
        // TODO: Handle delete to start of line
        break
      case (data == 0x11): // DELETE TO END OF LINE
        // TODO: Handle delete to end of line
        break
      case (data == 0x12): // DELETE TO START OF SCREEN
        // TODO: Handle delete to start of screen
        break
      case (data == 0x13): // DELETE TO END OF SCREEN
        // TODO: Handle delete to end of screen
        break
      case (data == 0x14): // SCROLL LEFT
        // TODO: Handle scroll left
        break
      case (data == 0x15): // SCROLL RIGHT
        // TODO: Handle scroll right
        break
      case (data == 0x16): // SCROLL UP
        // TODO: Handle scroll up
        break
      case (data == 0x17): // SCROLL DOWN
        // TODO: Handle scroll down
        break
      case (data == 0x18): // SET FONT ATTRIBUTES
        this.fontAttributesNextByte = true
        break
      case (data == 0x19): // SET FONT COLOR
        this.fontColorNextByte = true
        break
      case (data == 0x1A): // NEXT BYTE AS CHARACTER
        this.characterNextByte = true
        break
      case (data == 0x1B): // ESCAPE
        // Reserved for future ANSI escape code handling
        break
      case (data == 0x1C): // CURSOR LEFT
        // TODO: Handle cursor left
        break
      case (data == 0x1D): // CURSOR RIGHT
        // TODO: Handle cursor right
        break
      case (data == 0x1E): // CURSOR UP
        // TODO: Handle cursor up
        break
      case (data == 0x1F): // CURSOR DOWN
        // TODO: Handle cursor down
        break
      case (data >= 0x20 && data <= 0x7E): // ASCII CHARACTERS
        // TODO: Handle ASCII characters
        break
      case (data == 0x7F): // DELETE
        // TODO: Handle delete
        break
      case (data >= 0x20 && data <= 0x7E): // EXTENDED CHARACTERS
        // TODO: Handle extended characters
        break
      default:
        break
    }

    // console.log(data)

    // // Just generate some random pixels when input occurs for now...
    // let offset = 0
    // for (let i = 0; i < 240; i++) {
    //   for (let j = 0; j < 320; j++) {
    //     this.buffer[offset++] = Math.floor(Math.random() * 255)    // R
    //     this.buffer[offset++] = Math.floor(Math.random() * 255)    // G
    //     this.buffer[offset++] = Math.floor(Math.random() * 255)    // B
    //   }
    // }
  }

  render = () => {
    if (!this.window) { return }
    if (this.window.destroyed) { return }

    this.window.render(320, 240, 320 * 3, 'rgb332', this.buffer)

    setImmediate(this.render)
  }

  transmit = (data: number) => {
    this.port?.write([data], 'hex', (err) => {
      if (err) {
        console.log('Error: ', err.message)
      }
    })
  }

  onData = (data: Buffer<ArrayBuffer>) => {
    for (let i = 0; i < data.length; i++) {
      this.update(data[i])
    }
  }

  onKey = (event: sdl.Events.Window.KeyDown) => {
    switch (event.key) {
      case 'backspace':
        this.transmit(0x08)
        break
      case 'tab':
        this.transmit(0x09)
        break
      case 'enter':
      case 'return':
        this.transmit(0x0D)
        this.transmit(0x0A)
        break
      case 'escape':
        this.transmit(0x1B)
        break
      case 'left':
        this.transmit(0x1C)
        break
      case 'right':
        this.transmit(0x1D)
        break
      case 'up':
        this.transmit(0x1E)
        break
      case 'down':
        this.transmit(0x1F)
        break
      case 'delete':
        this.transmit(0x7F)
        break
      default:
        break
    }
  }

  onText = (event: sdl.Events.Window.TextInput) => {
    switch (event.text) {
      case ' ':
        this.transmit(0x20)
        break
      case '!':
        this.transmit(0x21)
        break
      case '"':
        this.transmit(0x22)
        break
      case '#':
        this.transmit(0x23)
        break
      case '$':
        this.transmit(0x24)
        break
      case '%':
        this.transmit(0x25)
        break
      case '&':
        this.transmit(0x26)
        break
      case '\'':
        this.transmit(0x27)
        break
      case '(':
        this.transmit(0x28)
        break
      case ')':
        this.transmit(0x29)
        break
      case '*':
        this.transmit(0x2A)
        break
      case '+':
        this.transmit(0x2B)
        break
      case ',':
        this.transmit(0x2C)
        break
      case '-':
        this.transmit(0x2D)
        break
      case '.':
        this.transmit(0x2E)
        break
      case '/':
        this.transmit(0x2F)
        break
      case '0':
        this.transmit(0x30)
        break
      case '1':
        this.transmit(0x31)
        break
      case '2':
        this.transmit(0x32)
        break
      case '3':
        this.transmit(0x33)
        break
      case '4':
        this.transmit(0x34)
        break
      case '5':
        this.transmit(0x35)
        break
      case '6':
        this.transmit(0x36)
        break
      case '7':
        this.transmit(0x37)
        break
      case '8':
        this.transmit(0x38)
        break
      case '9':
        this.transmit(0x39)
        break
      case ':':
        this.transmit(0x3A)
        break
      case ';':
        this.transmit(0x3B)
        break
      case '<':
        this.transmit(0x3C)
        break
      case '=':
        this.transmit(0x3D)
        break
      case '>':
        this.transmit(0x3E)
        break
      case '?':
        this.transmit(0x3F)
        break
      case '@':
        this.transmit(0x40)
        break
      case 'A':
        this.transmit(0x41)
        break
      case 'B':
        this.transmit(0x42)
        break
      case 'C':
        this.transmit(0x43)
        break
      case 'D':
        this.transmit(0x44)
        break
      case 'E':
        this.transmit(0x45)
        break
      case 'F':
        this.transmit(0x46)
        break
      case 'G':
        this.transmit(0x47)
        break
      case 'H':
        this.transmit(0x48)
        break
      case 'I':
        this.transmit(0x49)
        break
      case 'J':
        this.transmit(0x4A)
        break
      case 'K':
        this.transmit(0x4B)
        break
      case 'L':
        this.transmit(0x4C)
        break
      case 'M':
        this.transmit(0x4D)
        break
      case 'N':
        this.transmit(0x4E)
        break
      case 'O':
        this.transmit(0x4F)
        break
      case 'P':
        this.transmit(0x50)
        break
      case 'Q':
        this.transmit(0x51)
        break
      case 'R':
        this.transmit(0x52)
        break
      case 'S':
        this.transmit(0x53)
        break
      case 'T':
        this.transmit(0x54)
        break
      case 'U':
        this.transmit(0x55)
        break
      case 'V':
        this.transmit(0x56)
        break
      case 'W':
        this.transmit(0x57)
        break
      case 'X':
        this.transmit(0x58)
        break
      case 'Y':
        this.transmit(0x59)
        break
      case 'Z':
        this.transmit(0x5A)
        break
      case '[':
        this.transmit(0x5B)
        break
      case '\\':
        this.transmit(0x5C)
        break
      case ']':
        this.transmit(0x5D)
        break
      case '^':
        this.transmit(0x5E)
        break
      case '_':
        this.transmit(0x5F)
        break
      case '`':
        this.transmit(0x60)
        break
      case 'a':
        this.transmit(0x61)
        break
      case 'b':
        this.transmit(0x62)
        break
      case 'c':
        this.transmit(0x63)
        break
      case 'd':
        this.transmit(0x64)
        break
      case 'e':
        this.transmit(0x65)
        break
      case 'f':
        this.transmit(0x66)
        break
      case 'g':
        this.transmit(0x67)
        break
      case 'h':
        this.transmit(0x68)
        break
      case 'i':
        this.transmit(0x69)
        break
      case 'j':
        this.transmit(0x6A)
        break
      case 'k':
        this.transmit(0x6B)
        break
      case 'l':
        this.transmit(0x6C)
        break
      case 'm':
        this.transmit(0x6D)
        break
      case 'n':
        this.transmit(0x6E)
        break
      case 'o':
        this.transmit(0x6F)
        break
      case 'p':
        this.transmit(0x70)
        break
      case 'q':
        this.transmit(0x71)
        break
      case 'r':
        this.transmit(0x72)
        break
      case 's':
        this.transmit(0x73)
        break
      case 't':
        this.transmit(0x74)
        break
      case 'u':
        this.transmit(0x75)
        break
      case 'v':
        this.transmit(0x76)
        break
      case 'w':
        this.transmit(0x77)
        break
      case 'x':
        this.transmit(0x78)
        break
      case 'y':
        this.transmit(0x79)
        break
      case 'z':
        this.transmit(0x7A)
        break
      case '{':
        this.transmit(0x7B)
        break
      case '|':
        this.transmit(0x7C)
        break
      case '}':
        this.transmit(0x7D)
        break
      case '~':
        this.transmit(0x7E)
        break
      default:
        break
    }
  }

}