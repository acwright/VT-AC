#!/usr/bin/env python3
"""
Run a real program on a pty and pipe it through stdin/stdout.

    python3 scripts/pty-host.py --rows 60 --cols 80 --term ansi -- htop

Everything the program writes comes out of stdout; everything arriving on stdin
goes in as keystrokes. Put a serial port on the other side of those two pipes
and the program is talking to VT-AC — PLAN.md §5.5's acceptance setup, with the
hardware loopback in the middle.

**The serial port is deliberately not here.** An earlier version opened the
device itself and configured it with `termios`, and the link then carried clean
bytes at 9600 and garbage at every rate above it, while the same cables driven
from `serialport` at both ends were byte-perfect at 115200. So the wire belongs
to the one serial implementation the project already trusts, and this script
does the one thing Node cannot: allocate a pty.

Exits when the program does, or on SIGINT.
"""

import argparse
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', type=int, default=30)
    ap.add_argument('--cols', type=int, default=40)
    ap.add_argument('--term', default='ansi')
    ap.add_argument('command', nargs=argparse.REMAINDER)
    args = ap.parse_args()

    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        ap.error('no command given')

    pid, master = pty.fork()
    if pid == 0:
        os.environ['TERM'] = args.term
        os.environ['LINES'] = str(args.rows)
        os.environ['COLUMNS'] = str(args.cols)
        try:
            os.execvp(command[0], command)
        except OSError as e:
            # The traceback would otherwise go down the wire and be drawn on the
            # terminal, which is a confusing way to learn a program is missing.
            sys.stderr.write(f'pty-host: cannot run {command[0]}: {e}\n')
            os._exit(127)

    # The geometry has to reach the child as a winsize, not just as environment:
    # ncurses asks the tty, and a program told 80×60 by $COLUMNS but 80×24 by
    # the kernel draws for 24 rows.
    fcntl.ioctl(master, termios.TIOCSWINSZ,
                struct.pack('HHHH', args.rows, args.cols, 0, 0))

    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

    stdin = sys.stdin.buffer.fileno()
    stdout = sys.stdout.buffer

    try:
        while True:
            ready, _, _ = select.select([master, stdin], [], [], 0.2)
            if master in ready:
                data = os.read(master, 4096)
                if not data:
                    break
                stdout.write(data)
                stdout.flush()
            if stdin in ready:
                data = os.read(stdin, 4096)
                if not data:
                    break
                os.write(master, data)
            if os.waitpid(pid, os.WNOHANG)[0] == pid:
                break
    except OSError:
        pass
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


if __name__ == '__main__':
    main()
