/* One child process: the Python pty helper wrapping one shell or program.
 *
 * Plain `child_process.spawn`, four pipes, no native module. The helper's
 * source rides in the bundle as a string and is passed to `python3 -c`. Exit
 * is reported on the child's `close` event, which fires only after stdout has
 * been drained into the terminal, so the exit row never appears above output
 * that is still in flight. */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import HELPER_SOURCE from './helper.py';
import { encodeResize } from './frames';

export interface PtySpawn {
  python: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyExit {
  code: number | null;
  signal: string | null;
  /** The helper reported "ready": the pty was created and the command exec'd. */
  ready: boolean;
  /** Everything the helper or the spawn wrote to stderr, capped. */
  stderr: string;
}

const STDERR_CAP = 4000;
const READY_LINE = 'ready\n';

/* `-I` is load-bearing: `python3 -c` puts the working folder first on
 * sys.path, and the helper's imports (pty, termios, ...) are not loaded at
 * interpreter start, so a `termios.py` dropped into a vault folder would run
 * as the user before the shell exists. Isolated mode drops the cwd from
 * sys.path and ignores PYTHON* variables and the user site folder.
 * test/helper-isolated.test.mjs plants that file and proves it never runs. */
export const HELPER_ARGV_PREFIX = ['-I', '-c', HELPER_SOURCE];

export class PtyProcess {
  private readonly child: ChildProcess;
  private readonly control: Writable | null;
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();
  private readonly exitListeners = new Set<(exit: PtyExit) => void>();
  private readonly readyListeners = new Set<() => void>();
  private stderrText = '';
  private readyBuffer = '';
  private closed = false;
  ready = false;
  exit: PtyExit | null = null;

  constructor(spec: PtySpawn) {
    this.child = spawn(
      spec.python,
      [...HELPER_ARGV_PREFIX, String(spec.cols), String(spec.rows), '--', spec.command, ...spec.args],
      { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const extra = this.child.stdio[3] as Writable | null | undefined;
    this.control = extra ?? null;
    this.child.stdout?.on('data', (chunk: Buffer) => {
      for (const l of this.dataListeners) l(chunk);
    });
    this.child.stderr?.on('data', (chunk: Buffer) => this.onStderr(chunk.toString('utf8')));
    this.child.on('error', (err: Error) => this.noteStderr(`${err.message}\n`));
    this.child.stdin?.on('error', () => undefined);
    this.control?.on('error', () => undefined);
    this.child.on('close', (code, signal) => this.onClose(code, signal));
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  private onStderr(text: string): void {
    if (this.ready) {
      this.noteStderr(text);
      return;
    }
    this.readyBuffer += text;
    if (this.readyBuffer.startsWith(READY_LINE)) {
      this.ready = true;
      const rest = this.readyBuffer.slice(READY_LINE.length);
      this.readyBuffer = '';
      for (const l of this.readyListeners) l();
      if (rest) this.noteStderr(rest);
    } else if (this.readyBuffer.length >= READY_LINE.length && !READY_LINE.startsWith(this.readyBuffer)) {
      /* Not the ready line: the helper (or the python stub) is complaining. */
      this.noteStderr(this.readyBuffer);
      this.readyBuffer = '';
    }
  }

  private noteStderr(text: string): void {
    this.stderrText = (this.stderrText + text).slice(-STDERR_CAP);
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    if (this.readyBuffer) this.noteStderr(this.readyBuffer);
    this.exit = { code, signal, ready: this.ready, stderr: this.stderrText.trim() };
    for (const l of this.exitListeners) l(this.exit);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onReady(listener: () => void): () => void {
    if (this.ready) listener();
    else this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onExit(listener: (exit: PtyExit) => void): () => void {
    if (this.exit) listener(this.exit);
    else this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  write(data: string): void {
    if (this.closed) return;
    this.child.stdin?.write(data, 'utf8');
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.control?.write(encodeResize(cols, rows));
  }

  /** Flow control: stop reading the child until the terminal has caught up. */
  pause(): void {
    this.child.stdout?.pause();
  }

  resume(): void {
    this.child.stdout?.resume();
  }

  get alive(): boolean {
    return !this.closed;
  }

  /**
   * Ends the session. SIGHUP to the helper closes the pty master, and the
   * kernel hangs up the shell on the other side of it the way closing a
   * terminal window does. Idempotent.
   */
  kill(signal: NodeJS.Signals = 'SIGHUP'): void {
    if (this.closed) return;
    try {
      this.child.stdin?.end();
    } catch {
      /* already gone */
    }
    try {
      this.child.kill(signal);
    } catch {
      /* already gone */
    }
  }

  dispose(): void {
    this.kill();
    this.dataListeners.clear();
    this.readyListeners.clear();
    this.exitListeners.clear();
  }
}
