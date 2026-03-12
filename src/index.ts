#! /usr/bin/env node

import figlet from 'figlet'
import { Command } from 'commander'
import { readFileSync } from 'fs'
import sdl from '@kmamal/sdl'
import { SerialPort } from 'serialport'
import { VTAC } from './VTAC/VTAC'

const VERSION = '1.3.0'

// Parse command line arguments
const program = new Command()
program.showHelpAfterError()
program
  .name('vtac')
  .description('A fantasy ASCII terminal emulator.')
  .version(VERSION, '-v, --version', 'Output the current version')
  .helpOption('-h, --help', 'Output help / options')
  .option('-p, --port <port>', 'Path to the serial port (e.g., /dev/ttyUSB0)')
  .option('-b, --baudrate <baudrate>', 'Baud Rate', '9600')
  .option('-a, --parity <parity>', 'Parity (odd | even | none)', 'none')
  .option('-d, --databits <databits>', 'Data Bits (5 | 6 | 7 | 8)', '8')
  .option('-t, --stopbits <stopbits>', 'Stop Bits (1 | 1.5 | 2)', '1')
  .option('-f, --fullscreen', 'Enable fullscreen mode', false)
  .option('-s, --scale <scale>', 'Scale', '2')
  .option('-l, --load <load>', 'Path to data file to load (e.g. /path/to/data.bin)')
  .addHelpText('beforeAll', figlet.textSync('VT-AC', { font: 'cricket' }) + '\n' + `Version: ${VERSION} | A.C. Wright Design\n`)
  .parse(process.argv)

const options = program.opts()

// Serial port configuration
const port = options.port
const baudRate = parseInt(options.baudrate)
const parity = options.parity as 'odd' | 'even' | 'none'
const dataBits = parseInt(options.databits) as 5 | 6 | 7 | 8
const stopBits = parseFloat(options.stopbits) as 1 | 1.5 | 2

// Validate options
if (dataBits !== 5 && dataBits !== 6 && dataBits !== 7 && dataBits !== 8) {
  console.log('Error: Invalid Data Bits')
  process.exit(1)
}
if (stopBits !== 1 && stopBits !== 1.5 && stopBits !== 2) {
  console.log('Error: Invalid Stop Bits')
  process.exit(1)
}

// Display options
const fullscreen = options.fullscreen
const scale = parseInt(options.scale)

// Create VTAC instance
const vtac = new VTAC()

// Serial port instance
let serialPort: SerialPort | undefined

// Setup serial port connection
if (port) {
  serialPort = new SerialPort({
    path: port,
    baudRate: baudRate,
    parity: parity,
    dataBits: dataBits,
    stopBits: stopBits
  }, (err) => {
    if (err) {
      console.log('Error: ', err.message)
    }
  })

  serialPort.on('data', (data: Buffer<ArrayBuffer>) => {
    for (let i = 0; i < data.length; i++) {
      vtac.parse(data[i])
    }
  })
}

// Load file if specified
if (options.load) {
  try {
    const data = readFileSync(options.load)
    for (let i = 0; i < data.length; i++) {
      vtac.parse(data[i])
    }
  } catch (err) {
    console.log('Error loading file:', err)
  }
}

// Audio playback state
let isBellPlaying = false
let bellAudioDevice: any = undefined

// Rendering state
let lastRenderTime = 0
const targetFrameTime = 1000 / 60 // 60fps = ~16.67ms per frame

// Cursor rendering state
let cursorBlinkTime = 0
let cursorVisible = true
const cursorBlinkInterval = 500 // Blink every 500ms (twice per second)

// Create window
const window = sdl.video.createWindow({
  title: "VT-AC",
  width: VTAC.WIDTH * scale,
  height: VTAC.HEIGHT * scale,
  fullscreen: fullscreen,
  resizable: false
})

// Handle window keyboard events
window.on('keyDown', (event: sdl.Events.Window.KeyDown) => {
  if (!serialPort || !serialPort.isOpen) return
  
  let code: number | undefined
  
  switch (event.key) {
    case 'backspace':
      code = 0x08
      break
    case 'tab':
      code = 0x09
      break
    case 'enter':
    case 'return':
      serialPort.write([0x0D, 0x0A], 'hex')
      return
    case 'escape':
      code = 0x1B
      break
    case 'left':
      code = 0x1C
      break
    case 'right':
      code = 0x1D
      break
    case 'up':
      code = 0x1E
      break
    case 'down':
      code = 0x1F
      break
    case 'delete':
      code = 0x7F
      break
    default:
      break
  }
  
  if (code !== undefined) {
    serialPort.write([code], 'hex')
  }
})

// Handle window text input events
window.on('textInput', (event: sdl.Events.Window.TextInput) => {
  if (!serialPort || !serialPort.isOpen) return
  
  // Convert text to ASCII code
  const text = event.text
  if (text.length === 1) {
    const code = text.charCodeAt(0)
    if (code >= 0x20 && code <= 0x7E) {
      serialPort.write([code], 'hex')
    }
  }
})

// Handle window close
window.on('close', () => {
  if (serialPort && serialPort.isOpen) {
    serialPort.close()
  }
})

// Audio playback function
function playBell(frequency: number, duration: number) {
  // Mark as playing
  isBellPlaying = true
  
  // Open audio device if not already open
  if (!bellAudioDevice) {
    const sampleRate = 44100
    bellAudioDevice = sdl.audio.openDevice(
      { type: 'playback' },
      {
        channels: 1,
        frequency: sampleRate,
        format: 'f32',
        buffered: 4096 // Buffer size must be power of 2
      }
    )
    
    if (!bellAudioDevice) {
      // Fallback to console beep if audio device cannot be opened
      process.stdout.write('\u0007')
      // Clear VTAC queue and stop
      vtac.bellQueue = []
      isBellPlaying = false
      return
    }
    
    // Start playback
    bellAudioDevice.play()
  }
  
  // Convert jiffies (1/60th of a second) to milliseconds
  const durationMs = (duration / 60) * 1000
  
  // Generate sine wave samples
  const sampleRate = 44100
  const numSamples = Math.floor((durationMs / 1000) * sampleRate)
  const samples = new Float32Array(numSamples)
  
  for (let i = 0; i < numSamples; i++) {
    // Generate sine wave: amplitude * sin(2π * frequency * time)
    const time = i / sampleRate
    const amplitude = 0.2 // Keep volume at 20% to avoid distortion
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * time)
    
    // Apply fade out in the last 10% to avoid clicks
    const fadeStartSample = numSamples * 0.9
    if (i > fadeStartSample) {
      const fadeProgress = (i - fadeStartSample) / (numSamples - fadeStartSample)
      samples[i] *= (1 - fadeProgress)
    }
  }
  
  // Enqueue the audio samples
  bellAudioDevice.enqueue(Buffer.from(samples.buffer))
  
  // Process next bell in queue after this one finishes
  setTimeout(() => {
    // Get next bell from VTAC queue
    const nextBell = vtac.getNextBell()
    
    if (nextBell) {
      // Play next bell
      playBell(nextBell.frequency, nextBell.duration)
    } else {
      // No more bells, stop and close audio device
      isBellPlaying = false
      if (bellAudioDevice) {
        bellAudioDevice.clearQueue()
        bellAudioDevice.pause()
        bellAudioDevice.close()
        bellAudioDevice = undefined
      }
    }
  }, durationMs)
}

// Helper function to draw cursor
function drawCursor(renderBuffer: Buffer<ArrayBuffer>) {
  const character = VTAC.CHARACTERS[vtac.cursorChar]
  const startRow = vtac.row * 8
  const startColumn = vtac.column * 8
  
  // Draw cursor character with inverted colors
  for (let y = 0; y < 8; y++) {
    const rowByte = character[y]
    const bufferRowStart = (startRow + y) * VTAC.WIDTH
    
    for (let x = 0; x < 8; x++) {
      const bit = (rowByte >> (7 - x)) & 1
      // Invert the colors: if bit is 1, use background; if 0, use foreground
      const color = bit ? vtac.backgroundColor : vtac.foregroundColor
      renderBuffer[bufferRowStart + startColumn + x] = color
    }
  }
}

// Main render loop
function render() {
  if (window.destroyed) { return }

  const now = Date.now()
  const elapsed = now - lastRenderTime
  
  // Update cursor blink state
  if (vtac.cursorMode === 'blinking') {
    cursorBlinkTime += elapsed
    if (cursorBlinkTime >= cursorBlinkInterval) {
      cursorVisible = !cursorVisible
      cursorBlinkTime = 0
    }
  } else {
    cursorVisible = true
  }
  
  // Create temporary render buffer
  const renderBuffer = Buffer.from(vtac.buffer)
  
  // Draw cursor if visible and cursorChar is not 0x00 (OFF)
  if (cursorVisible && vtac.cursorChar !== 0x00) {
    drawCursor(renderBuffer)
  }
  
  window.render(VTAC.WIDTH, VTAC.HEIGHT, VTAC.WIDTH, 'rgb332', renderBuffer)
  
  lastRenderTime = now
  
  // Check for queued bells and start playback if not already playing
  if (!isBellPlaying && vtac.hasQueuedBells()) {
    const bell = vtac.getNextBell()
    if (bell) {
      playBell(bell.frequency, bell.duration)
    }
  }
  
  // Calculate delay to maintain target frame rate
  const renderTime = Date.now() - now
  const delay = Math.max(0, targetFrameTime - renderTime)
  
  setTimeout(render, delay)
}

// Start render loop
render()