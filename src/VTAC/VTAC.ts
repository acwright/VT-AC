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

  buffer: Buffer<ArrayBuffer> = Buffer.alloc(320 * 240 * 4)

  launch(): void {
    if (this.path) { 
      this.port = new SerialPort({
        path: this.path,
        baudRate: this.baudRate,
        parity: this.parity,
        dataBits: this.dataBits,
        stopBits: this.stopBits
      }, function (err) {
        if (err) {
          return console.log('Error: ', err.message)
        }
      })

      this.port.on('data', function (data) {
        console.log('Data:', data)
      })
    }

    this.window = sdl.video.createWindow({ 
      title: "VT-AC",
      width: 320 * this.scale,
      height: 240 * this.scale
    })

    this.window.on('keyDown', (event) => {
      this.onKey(event)
    })

    this.window.on('textInput', (event) => {
      this.onText(event)
    })

    this.window.on('close', (event) => {
      this.port?.close()
    })

    let offset = 0
    for (let i = 0; i < 240; i++) {
      for (let j = 0; j < 320; j++) {
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // R
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // G
        this.buffer[offset++] = Math.floor(Math.random() * 255)    // B
        this.buffer[offset++] = 255                                // A
      }
    }

    this.window.render(320, 240, 320 * 4, 'rgba32', this.buffer)
  }

  onKey(event: sdl.Events.Window.KeyDown): void {
    switch (event.key) {
      case 'enter':
      case 'return':
        console.log('Return pressed')
        break;
      default:
        break
    }
  }

  onText(event: sdl.Events.Window.TextInput): void {
    console.log(event.text)
  }

}