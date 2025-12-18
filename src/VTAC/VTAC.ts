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

  buffer: Buffer<ArrayBuffer> = Buffer.alloc(320 * 240 * 3)

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
    console.log(data)

    // Just generate some random pixels when input occurs for now...
    let offset = 0
    for (let i = 0; i < 240; i++) {
      for (let j = 0; j < 320; j++) {
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // R
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // G
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // B
      }
    }
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