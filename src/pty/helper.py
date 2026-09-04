# ICOR for Life - Terminal: the pty helper.
#
# Spawned by the plugin as `python3 -c <this file> <cols> <rows> -- <command> [args...]`
# with four pipes. It forks the command onto a real pseudo-terminal and proxies:
#
#   stdin  (fd 0) -> pty master      keystrokes, byte for byte
#   pty master    -> stdout (fd 1)   everything the program draws
#   fd 3          -> TIOCSWINSZ      resize frames, one per line: "resize <cols> <rows>"
#   stderr (fd 2)                    one "ready" line, then only errors
#
# It exists because Node has no pty without a native module and a native module
# cannot ship through the Obsidian directory. It reads nothing from the
# environment, prints nothing of the environment, and opens no socket.
#
# Two platform facts it carries, both measured on macOS: select() on a pty
# master never reports EOF after the child exits, so the child is reaped with
# waitpid(WNOHANG) on every loop; and os.ttyname() raises on a ptmx master, so
# the slave path is never asked for.
import os
import sys
import pty
import select
import fcntl
import termios
import struct
import signal

CTRL_FD = 3
CHUNK = 65536


def fail(message, code=2):
    sys.stderr.write("icor pty helper: %s\n" % message)
    sys.stderr.flush()
    sys.exit(code)


args = sys.argv[1:]
if len(args) < 4 or args[2] != "--":
    fail("usage: <cols> <rows> -- <command> [args...]")
try:
    cols = int(args[0])
    rows = int(args[1])
except ValueError:
    fail("cols and rows must be integers")
argv = args[3:]


def set_window(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))


def exit_status(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


pid, master = pty.fork()
if pid == 0:
    # The resize channel is the helper's, not the shell's: close it before exec
    # so no program in the terminal inherits a stray descriptor.
    try:
        os.close(CTRL_FD)
    except OSError:
        pass
    try:
        os.execvp(argv[0], argv)
    except OSError as exc:
        sys.stderr.write("icor pty helper: cannot run %s: %s\n" % (argv[0], exc.strerror))
        sys.stderr.flush()
        os._exit(127)

set_window(master, cols, rows)
sys.stderr.write("ready\n")
sys.stderr.flush()


def write_all(fd, data):
    view = memoryview(data)
    while len(view):
        try:
            n = os.write(fd, view)
        except BlockingIOError:
            select.select([], [fd], [])
            continue
        view = view[n:]


def drain_master():
    while True:
        try:
            data = os.read(master, CHUNK)
        except OSError:
            return
        if not data:
            return
        write_all(1, data)


def apply_control(line):
    parts = line.split()
    if len(parts) != 3 or parts[0] != b"resize":
        return
    try:
        c = int(parts[1])
        r = int(parts[2])
    except ValueError:
        return
    if c < 1 or r < 1 or c > 10000 or r > 10000:
        return
    set_window(master, c, r)
    try:
        os.kill(pid, signal.SIGWINCH)
    except OSError:
        pass


watched = [master, 0, CTRL_FD]
control_buffer = b""

while True:
    reaped, status = os.waitpid(pid, os.WNOHANG)
    if reaped == pid:
        drain_master()
        sys.exit(exit_status(status))
    try:
        readable, _, _ = select.select(watched, [], [], 0.1)
    except InterruptedError:
        continue
    if master in readable:
        try:
            data = os.read(master, CHUNK)
        except OSError:
            data = b""
        if data:
            write_all(1, data)
        else:
            watched.remove(master)
    if 0 in readable:
        data = os.read(0, CHUNK)
        if data:
            write_all(master, data)
        else:
            watched.remove(0)
            try:
                os.kill(pid, signal.SIGHUP)
            except OSError:
                pass
    if CTRL_FD in readable:
        data = os.read(CTRL_FD, 4096)
        if not data:
            watched.remove(CTRL_FD)
        else:
            control_buffer += data
            while b"\n" in control_buffer:
                line, control_buffer = control_buffer.split(b"\n", 1)
                apply_control(line)
