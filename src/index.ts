#! /usr/bin/env node

import figlet from 'figlet'
import { Command } from 'commander'
import { readFileSync } from 'fs'
import { VTAC } from './VTAC/VTAC'

const VERSION = '1.0.0'

const vtac = new VTAC()

const program = new Command()
program.showHelpAfterError()
program
  .name('vtac')
  .description('A fantasy ASCII terminal emulator.')
  .version(VERSION, '-v, --version', 'Output the current version')
  .helpOption('-h, --help', 'Output help / options')
  .option('-p, --path <path>', 'Path to the serial port (e.g., /dev/ttyUSB0)')
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
if (options.path) {
  vtac.path = options.path
}
if (options.baudrate) {
  vtac.baudRate = parseInt(options.baudrate)
}
if (options.parity) {
  vtac.parity = options.parity
}
if (options.databits) {
  const dataBits = parseInt(options.databits)
  if (dataBits == 5 || dataBits == 6 || dataBits == 7 || dataBits == 8) {
    vtac.dataBits = dataBits
  } else {
    console.log('Error: Invalid Data Bits')
  }
}
if (options.stopbits) {
  const stopBits = parseInt(options.stopbits)
  if (stopBits == 1 || stopBits == 1.5 || stopBits == 2) {
    vtac.stopBits = stopBits
  } else {
    console.log('Error: Invalid Stop Bits')
  }
}
if (options.fullscreen) {
  vtac.fullscreen = options.fullscreen
}
if (options.scale) {
  vtac.scale = parseInt(options.scale)
}
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

vtac.launch()