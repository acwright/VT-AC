import { VTAC } from './VTAC'

const pixelIndex = (col: number, row: number, x = 0, y = 0) => {
  return (row * 8 + y) * VTAC.WIDTH + (col * 8 + x)
}

const fillCell = (vtac: VTAC, col: number, row: number, color: number) => {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      vtac.buffer[pixelIndex(col, row, x, y)] = color
    }
  }
}

const expectCellColor = (vtac: VTAC, col: number, row: number, color: number) => {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      expect(vtac.buffer[pixelIndex(col, row, x, y)]).toBe(color)
    }
  }
}

describe('VTAC', () => {
  it('resets state and clears buffer', () => {
    const vtac = new VTAC()

    vtac.column = 12
    vtac.row = 8
    vtac.mode = 'graphics'
    vtac.foregroundColor = 0x22
    vtac.backgroundColor = 0x11
    vtac.bellDuration = 0x10
    vtac.bellFrequency = 0x20
    vtac.buffer.fill(0xAB)

    vtac.reset()

    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
    expect(vtac.offset).toBe(0)
    expect(vtac.mode).toBe('text')
    expect(vtac.foregroundColor).toBe(0xFF)
    expect(vtac.backgroundColor).toBe(0x00)
    expect(vtac.bellDuration).toBe(0x3C)
    expect(vtac.bellFrequency).toBe(0x3D)
    expect(vtac.buffer.every((value) => value === 0x00)).toBe(true)
  })

  it('parses set-column and set-row commands', () => {
    const vtac = new VTAC()

    vtac.parse(0x0E)
    vtac.parse(0x2A)
    vtac.parse(0x0F)
    vtac.parse(0x21)

    expect(vtac.column).toBe(0x2A % VTAC.COLUMNS)
    expect(vtac.row).toBe(0x21 % VTAC.ROWS)
    expect(vtac.offset).toBe(0)
  })

  it('queues and dequeues bell events when bell command is parsed', () => {
    const vtac = new VTAC()

    vtac.parse(0x05)
    vtac.parse(0x1E)
    vtac.parse(0x06)
    vtac.parse(0x2E)
    vtac.parse(0x07)

    expect(vtac.hasQueuedBells()).toBe(true)
    const bell = vtac.getNextBell()
    expect(bell).toBeDefined()
    expect(bell?.duration).toBe(0x1E)
    expect(typeof bell?.frequency).toBe('number')
    expect(bell?.frequency).toBeGreaterThan(0)
    expect(vtac.hasQueuedBells()).toBe(false)
  })

  it('inserts command-range byte as data after data-next instruction', () => {
    const vtac = new VTAC()

    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)

    vtac.parse(0x1A)
    vtac.parse(0x00)

    expect(vtac.column).toBe(1)
    expect(vtac.row).toBe(0)
    expect(vtac.offset).toBe(0)
  })

  it('toggles between text and graphics modes', () => {
    const vtac = new VTAC()

    expect(vtac.mode).toBe('text')

    vtac.parse(0x0B)
    expect(vtac.mode).toBe('graphics')

    vtac.parse(0x0B)
    expect(vtac.mode).toBe('text')
  })

  it('does not queue bell when frequency is invalid or duration is zero', () => {
    const vtac = new VTAC()

    vtac.bellFrequency = 0x00
    vtac.bellDuration = 0x10
    vtac.bell()
    expect(vtac.hasQueuedBells()).toBe(false)

    vtac.bellFrequency = 0x2E
    vtac.bellDuration = 0x00
    vtac.bell()
    expect(vtac.hasQueuedBells()).toBe(false)
  })

  it('handles backspace, tab, line feed, and carriage return edge cases', () => {
    const vtac = new VTAC()
    const scrollSpy = jest.spyOn(vtac, 'scroll')

    vtac.column = 0
    vtac.offset = 7
    vtac.backspace()
    expect(vtac.column).toBe(0)
    expect(vtac.offset).toBe(0)

    vtac.column = 5
    vtac.backspace()
    expect(vtac.column).toBe(4)

    vtac.column = 3
    vtac.tab()
    expect(vtac.column).toBe(4)

    vtac.column = VTAC.COLUMNS - 1
    vtac.tab()
    expect(vtac.column).toBe(VTAC.COLUMNS - 1)

    vtac.row = 0
    vtac.offset = 3
    vtac.lineFeed()
    expect(vtac.row).toBe(1)
    expect(vtac.offset).toBe(0)

    vtac.row = VTAC.ROWS - 1
    vtac.lineFeed()
    expect(vtac.row).toBe(VTAC.ROWS - 1)
    expect(scrollSpy).toHaveBeenCalledWith('up')

    vtac.column = 12
    vtac.offset = 2
    vtac.carriageReturn()
    expect(vtac.column).toBe(0)
    expect(vtac.offset).toBe(0)
  })

  it('clears ranges correctly for all deleteTo destinations', () => {
    const vtac = new VTAC()
    vtac.backgroundColor = 0x11

    fillCell(vtac, 0, 0, 0xAA)
    fillCell(vtac, 1, 0, 0xAA)
    fillCell(vtac, 2, 0, 0xAA)
    fillCell(vtac, 3, 0, 0xAA)
    fillCell(vtac, 4, 0, 0xAA)

    vtac.row = 0
    vtac.column = 2
    vtac.deleteTo('startOfLine')
    expectCellColor(vtac, 0, 0, 0x11)
    expectCellColor(vtac, 1, 0, 0x11)
    expectCellColor(vtac, 2, 0, 0x11)
    expectCellColor(vtac, 3, 0, 0xAA)

    vtac.deleteTo('endOfLine')
    expectCellColor(vtac, 2, 0, 0x11)
    expectCellColor(vtac, 3, 0, 0x11)
    expectCellColor(vtac, 4, 0, 0x11)

    fillCell(vtac, 0, 0, 0xAA)
    fillCell(vtac, 0, 1, 0xAA)
    fillCell(vtac, 1, 1, 0xAA)
    fillCell(vtac, 2, 1, 0xAA)
    fillCell(vtac, 0, 2, 0xAA)

    vtac.row = 1
    vtac.column = 1
    vtac.deleteTo('startOfScreen')
    expectCellColor(vtac, 0, 0, 0x11)
    expectCellColor(vtac, 0, 1, 0x11)
    expectCellColor(vtac, 1, 1, 0x11)
    expectCellColor(vtac, 2, 1, 0xAA)

    vtac.deleteTo('endOfScreen')
    expectCellColor(vtac, 1, 1, 0x11)
    expectCellColor(vtac, 2, 1, 0x11)
    expectCellColor(vtac, 0, 2, 0x11)
  })

  it('scrolls left/right/up/down and clears vacated cells', () => {
    const vtac = new VTAC()
    vtac.backgroundColor = 0x05

    fillCell(vtac, 0, 0, 0x10)
    fillCell(vtac, 1, 0, 0x20)
    fillCell(vtac, 2, 0, 0x30)
    vtac.scroll('left')
    expectCellColor(vtac, 0, 0, 0x20)
    expectCellColor(vtac, 1, 0, 0x30)
    expectCellColor(vtac, VTAC.COLUMNS - 1, 0, 0x05)

    fillCell(vtac, 0, 0, 0x10)
    fillCell(vtac, 1, 0, 0x20)
    vtac.scroll('right')
    expectCellColor(vtac, 1, 0, 0x10)
    expectCellColor(vtac, 0, 0, 0x05)

    fillCell(vtac, 0, 0, 0x60)
    fillCell(vtac, 0, 1, 0x70)
    vtac.scroll('up')
    expectCellColor(vtac, 0, 0, 0x70)
    expectCellColor(vtac, 0, VTAC.ROWS - 1, 0x05)

    fillCell(vtac, 0, 0, 0x80)
    fillCell(vtac, 0, 1, 0x90)
    vtac.scroll('down')
    expectCellColor(vtac, 0, 1, 0x80)
    expectCellColor(vtac, 0, 0, 0x05)
  })

  it('handles cursor movement bounds and delete operation', () => {
    const vtac = new VTAC()
    vtac.offset = 7

    vtac.column = 0
    vtac.cursor('left')
    expect(vtac.column).toBe(0)
    expect(vtac.offset).toBe(0)

    vtac.column = VTAC.COLUMNS - 1
    vtac.cursor('right')
    expect(vtac.column).toBe(VTAC.COLUMNS - 1)

    vtac.row = 0
    vtac.cursor('up')
    expect(vtac.row).toBe(0)

    vtac.row = VTAC.ROWS - 1
    vtac.cursor('down')
    expect(vtac.row).toBe(VTAC.ROWS - 1)

    vtac.backgroundColor = 0x44
    fillCell(vtac, 2, 2, 0x99)
    vtac.column = 2
    vtac.row = 2
    vtac.delete()
    expectCellColor(vtac, 2, 2, 0x44)
  })

  it('dispatches data insertion by mode', () => {
    const vtac = new VTAC()
    const textSpy = jest.spyOn(vtac, 'insertTextData')
    const graphicsSpy = jest.spyOn(vtac, 'insertGraphicsData')

    vtac.mode = 'text'
    vtac.data(0x41)
    expect(textSpy).toHaveBeenCalledWith(0x41)

    vtac.mode = 'graphics'
    vtac.data(0xAA)
    expect(graphicsSpy).toHaveBeenCalledWith(0xAA)
  })

  it('renders text data, advances cursor, wraps, and scrolls at screen end', () => {
    const vtac = new VTAC()
    const scrollSpy = jest.spyOn(vtac, 'scroll')

    vtac.foregroundColor = 0xF0
    vtac.backgroundColor = 0x0F
    vtac.insertTextData(0x41)
    expect(vtac.column).toBe(1)
    expect(vtac.row).toBe(0)
    expect(vtac.offset).toBe(0)

    const renderedPixels = Array.from({ length: 64 }, (_, index) => {
      const x = index % 8
      const y = Math.floor(index / 8)
      return vtac.buffer[pixelIndex(0, 0, x, y)]
    })
    expect(renderedPixels.some((color) => color === 0xF0)).toBe(true)
    expect(renderedPixels.some((color) => color === 0x0F)).toBe(true)

    vtac.column = VTAC.COLUMNS - 1
    vtac.row = 0
    vtac.insertTextData(0x41)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(1)

    vtac.column = VTAC.COLUMNS - 1
    vtac.row = VTAC.ROWS - 1
    vtac.insertTextData(0x41)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(VTAC.ROWS - 1)
    expect(scrollSpy).toHaveBeenCalledWith('up')
  })

  it('renders graphics data rows and wraps offset, column, and row', () => {
    const vtac = new VTAC()
    vtac.foregroundColor = 0xE1
    vtac.backgroundColor = 0x1E

    vtac.insertGraphicsData(0b10100000)
    expect(vtac.buffer[pixelIndex(0, 0, 0, 0)]).toBe(0xE1)
    expect(vtac.buffer[pixelIndex(0, 0, 1, 0)]).toBe(0x1E)
    expect(vtac.buffer[pixelIndex(0, 0, 2, 0)]).toBe(0xE1)
    expect(vtac.offset).toBe(1)

    vtac.column = VTAC.COLUMNS - 1
    vtac.row = VTAC.ROWS - 1
    vtac.offset = 7
    vtac.insertGraphicsData(0xFF)
    expect(vtac.offset).toBe(0)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
  })

  it('copies and clears 8x8 character cells', () => {
    const vtac = new VTAC()
    vtac.backgroundColor = 0x33

    fillCell(vtac, 3, 3, 0xA5)
    fillCell(vtac, 4, 4, 0x5A)
    vtac.copyCharacterCell(3, 3, 4, 4)
    expectCellColor(vtac, 4, 4, 0xA5)

    vtac.clearCharacterCell(4, 4)
    expectCellColor(vtac, 4, 4, 0x33)
  })

  it('honors parse next-byte state handlers', () => {
    const vtac = new VTAC()
    const dataSpy = jest.spyOn(vtac, 'data')

    vtac.cursorCharNextByte = true
    vtac.parse(0x5A)
    expect(vtac.cursorChar).toBe(0x5A)
    expect(vtac.cursorCharNextByte).toBe(false)

    vtac.columnNextByte = true
    vtac.parse(0x99)
    expect(vtac.column).toBe(0x99 % VTAC.COLUMNS)
    expect(vtac.columnNextByte).toBe(false)

    vtac.rowNextByte = true
    vtac.parse(0x77)
    expect(vtac.row).toBe(0x77 % VTAC.ROWS)
    expect(vtac.rowNextByte).toBe(false)

    vtac.bellDurationNextByte = true
    vtac.parse(0x1C)
    expect(vtac.bellDuration).toBe(0x1C)
    expect(vtac.bellDurationNextByte).toBe(false)

    vtac.bellFrequencyNextByte = true
    vtac.parse(0x2E)
    expect(vtac.bellFrequency).toBe(0x2E)
    expect(vtac.bellFrequencyNextByte).toBe(false)

    vtac.foregroundColorNextByte = true
    vtac.parse(0xAA)
    expect(vtac.foregroundColor).toBe(0xAA)
    expect(vtac.foregroundColorNextByte).toBe(false)

    vtac.backgroundColorNextByte = true
    vtac.parse(0xBB)
    expect(vtac.backgroundColor).toBe(0xBB)
    expect(vtac.backgroundColorNextByte).toBe(false)

    vtac.dataNextByte = true
    vtac.parse(0x00)
    expect(dataSpy).toHaveBeenCalledWith(0x00)
    expect(vtac.dataNextByte).toBe(false)
  })

  it('routes parse command bytes to the expected operations', () => {
    const vtac = new VTAC()
    const resetSpy = jest.spyOn(vtac, 'reset')
    const bellSpy = jest.spyOn(vtac, 'bell')
    const backspaceSpy = jest.spyOn(vtac, 'backspace')
    const tabSpy = jest.spyOn(vtac, 'tab')
    const lineFeedSpy = jest.spyOn(vtac, 'lineFeed')
    const carriageReturnSpy = jest.spyOn(vtac, 'carriageReturn')
    const deleteToSpy = jest.spyOn(vtac, 'deleteTo')
    const scrollSpy = jest.spyOn(vtac, 'scroll')
    const cursorSpy = jest.spyOn(vtac, 'cursor')
    const dataSpy = jest.spyOn(vtac, 'data')
    const deleteSpy = jest.spyOn(vtac, 'delete')

    vtac.column = 5
    vtac.row = 6
    vtac.offset = 7
    vtac.parse(0x01)
    expect(vtac.column).toBe(0)
    expect(vtac.row).toBe(0)
    expect(vtac.offset).toBe(0)

    vtac.parse(0x02)
    expect(vtac.cursorCharNextByte).toBe(true)
    vtac.parse(0x5A)
    expect(vtac.cursorChar).toBe(0x5A)

    vtac.parse(0x03)
    expect(vtac.cursorMode).toBe('blinking')

    vtac.parse(0x04)
    expect(resetSpy).toHaveBeenCalled()

    vtac.parse(0x05)
    expect(vtac.bellDurationNextByte).toBe(true)
    vtac.parse(0x10)
    expect(vtac.bellDuration).toBe(0x10)

    vtac.parse(0x06)
    expect(vtac.bellFrequencyNextByte).toBe(true)
    vtac.parse(0x2E)
    expect(vtac.bellFrequency).toBe(0x2E)

    vtac.parse(0x07)
    expect(bellSpy).toHaveBeenCalled()

    vtac.parse(0x08)
    expect(backspaceSpy).toHaveBeenCalled()

    vtac.parse(0x09)
    expect(tabSpy).toHaveBeenCalled()

    vtac.parse(0x0A)
    expect(lineFeedSpy).toHaveBeenCalled()

    const modeBefore = vtac.mode
    vtac.parse(0x0B)
    expect(vtac.mode).not.toBe(modeBefore)

    vtac.backgroundColor = 0x24
    vtac.buffer.fill(0xFF)
    vtac.parse(0x0C)
    expect(vtac.buffer.every((value) => value === 0x24)).toBe(true)

    vtac.parse(0x0D)
    expect(carriageReturnSpy).toHaveBeenCalled()

    vtac.parse(0x0E)
    expect(vtac.columnNextByte).toBe(true)
    vtac.parse(0x21)
    expect(vtac.column).toBe(0x21 % VTAC.COLUMNS)

    vtac.parse(0x0F)
    expect(vtac.rowNextByte).toBe(true)
    vtac.parse(0x22)
    expect(vtac.row).toBe(0x22 % VTAC.ROWS)

    vtac.parse(0x10)
    vtac.parse(0x11)
    vtac.parse(0x12)
    vtac.parse(0x13)
    expect(deleteToSpy).toHaveBeenCalledWith('startOfLine')
    expect(deleteToSpy).toHaveBeenCalledWith('endOfLine')
    expect(deleteToSpy).toHaveBeenCalledWith('startOfScreen')
    expect(deleteToSpy).toHaveBeenCalledWith('endOfScreen')

    vtac.parse(0x14)
    vtac.parse(0x15)
    vtac.parse(0x16)
    vtac.parse(0x17)
    expect(scrollSpy).toHaveBeenCalledWith('left')
    expect(scrollSpy).toHaveBeenCalledWith('right')
    expect(scrollSpy).toHaveBeenCalledWith('up')
    expect(scrollSpy).toHaveBeenCalledWith('down')

    vtac.parse(0x18)
    expect(vtac.foregroundColorNextByte).toBe(true)
    vtac.parse(0xAB)
    expect(vtac.foregroundColor).toBe(0xAB)

    vtac.parse(0x19)
    expect(vtac.backgroundColorNextByte).toBe(true)
    vtac.parse(0xBC)
    expect(vtac.backgroundColor).toBe(0xBC)

    vtac.parse(0x1A)
    expect(vtac.dataNextByte).toBe(true)
    vtac.parse(0x00)
    expect(vtac.dataNextByte).toBe(false)

    const preEscColumn = vtac.column
    const preEscRow = vtac.row
    vtac.parse(0x1B)
    expect(vtac.column).toBe(preEscColumn)
    expect(vtac.row).toBe(preEscRow)

    vtac.parse(0x1C)
    vtac.parse(0x1D)
    vtac.parse(0x1E)
    vtac.parse(0x1F)
    expect(cursorSpy).toHaveBeenCalledWith('left')
    expect(cursorSpy).toHaveBeenCalledWith('right')
    expect(cursorSpy).toHaveBeenCalledWith('up')
    expect(cursorSpy).toHaveBeenCalledWith('down')

    vtac.parse(0x20)
    vtac.parse(0x80)
    expect(dataSpy).toHaveBeenCalledWith(0x20)
    expect(dataSpy).toHaveBeenCalledWith(0x80)

    vtac.parse(0x7F)
    expect(deleteSpy).toHaveBeenCalled()

    const preDefaultColumn = vtac.column
    const preDefaultRow = vtac.row
    vtac.parse(0x100)
    expect(vtac.column).toBe(preDefaultColumn)
    expect(vtac.row).toBe(preDefaultRow)

    vtac.parse(0x00)
    expect(vtac.column).toBe(vtac.column)
  })
})

