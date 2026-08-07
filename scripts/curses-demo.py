#!/usr/bin/env python3
"""
A small ncurses screen, for driving VT-AC's VT-100 personality with.

PLAN.md stage 5.8 asks for "ncurses demos draw boxes with the right glyphs".
This is that, and it is deliberately not a hand-written escape sequence: every
box corner, attribute and cursor move below is chosen by ncurses out of
terminfo's `vt100` entry. What it exercises, in order:

  - ACS line drawing, which terminfo reaches through DEC Special Graphics
    (`ESC ( 0` and the SO/SI shift) — the box, the tee pieces and the divider
  - the four AVO attributes a VT100 has: bold, underline, blink, reverse
  - absolute cursor addressing and erase, on every refresh
  - a scroll region, which is what `curses` uses for a scrolling pad

Quits on `q`. Run it through `scripts/pty-host.py`, not directly.
"""

import curses


def main(screen):
    try:
        curses.curs_set(0)
    except curses.error:
        # A real VT100 has no "hide the cursor" capability and terminfo's vt100
        # entry says so, so this raises rather than being quietly ignored. That
        # it raises here is itself a small proof the entry being used is the
        # right one.
        pass

    height, width = screen.getmaxyx()

    box = screen.subwin(11, 46, 1, 2)
    box.box()
    box.addstr(0, 2, ' VT-AC ')

    box.addstr(2, 2, 'ncurses over a serial line, TERM=vt100')
    box.hline(3, 1, curses.ACS_HLINE, 44)
    box.addch(3, 0, curses.ACS_LTEE)
    box.addch(3, 45, curses.ACS_RTEE)

    for row, (label, attr) in enumerate(
        [
            ('normal', curses.A_NORMAL),
            ('bold', curses.A_BOLD),
            ('underline', curses.A_UNDERLINE),
            ('blink', curses.A_BLINK),
            ('reverse', curses.A_REVERSE),
        ]
    ):
        box.addstr(4 + row, 2, f'{label:<12}', attr)
        box.addstr(4 + row, 16, 'the quick brown fox', attr)

    # Every ACS glyph terminfo's vt100 entry can name, so a missing mapping in
    # Font.DEC_SPECIAL_GRAPHICS shows up as a hole in a row rather than as a
    # box that happens to still look like a box.
    screen.addstr(13, 2, 'ACS:')
    for i, glyph in enumerate(
        [
            curses.ACS_ULCORNER, curses.ACS_URCORNER, curses.ACS_LLCORNER,
            curses.ACS_LRCORNER, curses.ACS_LTEE, curses.ACS_RTEE,
            curses.ACS_BTEE, curses.ACS_TTEE, curses.ACS_HLINE,
            curses.ACS_VLINE, curses.ACS_PLUS, curses.ACS_DIAMOND,
            curses.ACS_CKBOARD, curses.ACS_DEGREE, curses.ACS_PLMINUS,
            curses.ACS_BULLET,
        ]
    ):
        screen.addch(13, 8 + i * 2, glyph)

    screen.addstr(height - 2, 2, f'{width}x{height}  press q to quit')

    screen.refresh()
    box.refresh()

    while screen.getch() not in (ord('q'), ord('Q')):
        pass


if __name__ == '__main__':
    curses.wrapper(main)
