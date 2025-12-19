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

  buffer: Buffer<ArrayBuffer> = Buffer.alloc(320 * 240).fill(0x00)

  mode: 'text' | 'graphics' = 'text'

  column: number = 0
  row: number = 0
  columnNextByte: boolean = false
  rowNextByte: boolean = false

  cursorChar: number = 0x00 // OFF
  cursorBlinking: boolean = true
  cursorCharNextByte: boolean = false

  dataNextByte: boolean = false

  foregroundColor: number = 0xFF // White
  backgroundColor: number = 0x00 // Black
  foregroundColorNextByte: boolean = false
  backgroundColorNextByte: boolean = false

  //
  // MAIN
  //

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

      this.port.on('data', this.receive)
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

    // Just generate some random pixels when input occurs for now...
    // let offset = 0
    // for (let i = 0; i < 240; i++) {
    //   for (let j = 0; j < 320; j++) {
    //     this.buffer[offset++] = Math.floor(Math.random() * 255)    // RGB332
    //   }
    // }

    // Start the render loop
    this.render()
  }

  render = () => {
    if (!this.window) { return }
    if (this.window.destroyed) { return }

    this.window.render(320, 240, 320, 'rgb332', this.buffer)

    setImmediate(this.render)
  }

  //
  // METHODS
  // 

  bell = () => {
    process.stdout.write('\u0007')
  }

  backspace = () => {
    if (this.column > 0) {
      this.column--
    }
  }

  tab = () => {
    this.column = Math.min((Math.floor(this.column / 4) + 1) * 4, 39)
  }

  lineFeed = () => {
    let nextRow = this.row + 1

    if (nextRow >= 30) {
      nextRow = 29
      // TODO: Scroll data up
    }

    this.row = nextRow
  }

  carriageReturn = () => {
    this.column = 0
  }

  deleteTo = (destination: 'startOfLine' | 'endOfLine' | 'startOfScreen' | 'endOfScreen') => {
    // TODO: Handle delete to
  }

  scroll = (direction: 'left' | 'right' | 'up' | 'down') => {
    // TODO: Handle scroll
  }

  cursor = (direction: 'left' | 'right' | 'up' | 'down') => {
    switch (direction) {
      case 'left':
        if (this.column > 0) {
          this.column--
        }
        break
      case 'right':
        if (this.column < 39) {
          this.column++
        }
        break
      case 'up':
        if (this.row > 0) {
          this.row--
        }
        break
      case 'down':
        if (this.row < 29) {
          this.row++
        }
        break
    }
  }

  delete = () => {
    // TODO: Handle delete
  }

  data = (data: number) => {
    // TODO: Handle data
  }

  //
  // EVENTS
  //

  parse = (data: number) => {
    if (this.cursorCharNextByte) {
      this.cursorChar = data
      this.cursorCharNextByte = false
      return
    }
    if (this.columnNextByte) {
      this.column = data % 40 // 0 to 39
      this.columnNextByte = false
      return
    }
    if (this.rowNextByte) {
      this.row = data % 30 // 0 to 29
      this.rowNextByte = false
      return
    }

    if (this.foregroundColorNextByte) {
      this.foregroundColor = data
      this.foregroundColorNextByte = false
      return
    }
    if (this.backgroundColorNextByte) {
      this.backgroundColor = data
      this.backgroundColorNextByte = false
      return
    }

    if (this.dataNextByte) {
      this.data(data)
      this.dataNextByte = false
      return
    }

    switch(true) {
      case (data == 0x00): // NULL
        break
      case (data == 0x01): // CURSOR HOME
        this.column = 0
        this.row = 0
        break
      case (data == 0x02): // CURSOR CHARACTER
        this.cursorCharNextByte = true
        break
      case (data == 0x03): // CURSOR BLINKING
        this.cursorBlinking = true
        break
      case (data == 0x04): // CURSOR SOLID
        this.cursorBlinking = false
        break
      case (data == 0x05): // RESERVED
        // Reserved for future use
        break
      case (data == 0x06): // RESERVED
        // Reserved for future use
        break
      case (data == 0x07): // BELL
        this.bell()
        break
      case (data == 0x08): // BACKSPACE
        this.backspace()
        break
      case (data == 0x09): // TAB
        this.tab()
        break
      case (data == 0x0A): // LINE FEED
        this.lineFeed()
        break
      case (data == 0x0B): // SCREEN MODE
        this.mode == 'text' ? this.mode = 'graphics' : this.mode = 'text'
        break
      case (data == 0x0C): // CLEAR SCREEN
        this.buffer.fill(0x00)
        break
      case (data == 0x0D): // CARRIAGE RETURN
        this.carriageReturn()
        break
      case (data == 0x0E): // SET COLUMN
        this.columnNextByte = true
        break
      case (data == 0x0F): // SET ROW
        this.rowNextByte = true
        break
      case (data == 0x10): // DELETE TO START OF LINE
        this.deleteTo('startOfLine')
        break
      case (data == 0x11): // DELETE TO END OF LINE
        this.deleteTo('endOfLine')
        break
      case (data == 0x12): // DELETE TO START OF SCREEN
        this.deleteTo('startOfScreen')
        break
      case (data == 0x13): // DELETE TO END OF SCREEN
        this.deleteTo('endOfScreen')
        break
      case (data == 0x14): // SCROLL LEFT
        this.scroll('left')
        break
      case (data == 0x15): // SCROLL RIGHT
        this.scroll('right')
        break
      case (data == 0x16): // SCROLL UP
        this.scroll('up')
        break
      case (data == 0x17): // SCROLL DOWN
        this.scroll('down')
        break
      case (data == 0x18): // FOREGROUND COLOR
        this.foregroundColorNextByte = true
        break
      case (data == 0x19): // BACKGROUND COLOR
        this.backgroundColorNextByte = true
        break
      case (data == 0x1A): // NEXT BYTE AS DATA
        this.dataNextByte = true
        break
      case (data == 0x1B): // ESCAPE
        // Reserved for future ANSI escape code handling
        break
      case (data == 0x1C): // CURSOR LEFT
        this.cursor('left')
        break
      case (data == 0x1D): // CURSOR RIGHT
        this.cursor('right')
        break
      case (data == 0x1E): // CURSOR UP
        this.cursor('up')
        break
      case (data == 0x1F): // CURSOR DOWN
        this.cursor('down')
        break
      case (data >= 0x20 && data <= 0x7E): // ASCII CHARACTERS
        this.data(data)
        break
      case (data == 0x7F): // DELETE
        this.delete()
        break
      case (data >= 0x20 && data <= 0x7E): // EXTENDED CHARACTERS
        this.data(data)
        break
      default:
        break
    }
  }

  transmit = (data: number) => {
    this.port?.write([data], 'hex', (err) => {
      if (err) {
        console.log('Error: ', err.message)
      }
    })
  }

  receive = (data: Buffer<ArrayBuffer>) => {
    for (let i = 0; i < data.length; i++) {
      this.parse(data[i])
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