#! /usr/bin/env node

import figlet from 'figlet'
import { Command } from 'commander'
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
  .option('-d, --databits <databits>', 'Data Bits (1 | 1.5 | 2)', '1')
  .option('-t, --stopbits <stopbits>', 'Stop Bits (1 | 1.5 | 2)', '1')
  .option('-s, --scale <scale>', 'Scale', '2')
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
if (options.scale) {
  vtac.scale = parseInt(options.scale)
}

vtac.launch()