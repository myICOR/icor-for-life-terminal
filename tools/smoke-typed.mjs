/* Typed text lands on the input line and does NOT run: the live half of
 * `typeText`, outside Obsidian. The helper is spawned the way the plugin
 * spawns it, an interactive shell with no rc files draws its prompt, and the
 * exact bytes the pane sends for a paste (the mode 2004 markers around the
 * text, no Enter) go down stdin. The proof has two halves and both are
 * measured, not assumed:
 *
 *   1. the typed line is echoed back by the shell's line editor, and after a
 *      wait the command it names has NOT run (the file it would create is
 *      absent, the process is still alive);
 *   2. one `\r` later, the SAME line runs (the file exists), so the text was
 *      real input on the line and the Enter was the only thing missing.
 *
 * Windows has no helper, so there it says so and exits 0. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';

if (process.platform === 'win32') {
  console.log('smoke-typed: not applicable on win32, the pty helper does not run there');
  process.exit(0);
}

const helper = readFileSync(new URL('../src/pty/helper.py', import.meta.url), 'utf8');
const python = process.env.ICOR_PYTHON ?? 'python3';
const shell = process.env.SHELL || '/bin/sh';
/* No rc files: the proof is about the line editor, not about anyone's dotfiles. */
const NO_RC = { zsh: ['-f', '-i'], bash: ['--norc', '--noprofile', '-i'] };
const shellArgs = NO_RC[basename(shell)] ?? ['-i'];
const PROMPT = 'SMOKE> ';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const NOT_RUN_WAIT_MS = 600;

const home = mkdtempSync(join(tmpdir(), 'ict-typed-'));
const marker = join(home, 'TYPED_RAN');
const line = `touch ${marker}`;
const started = Date.now();

const child = spawn(python, ['-I', '-c', helper, '200', '30', '--', shell, ...shellArgs], {
  stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  cwd: home,
  env: { ...process.env, HOME: home, TERM: 'xterm-256color', PS1: PROMPT, PROMPT },
});

let out = '';
let err = '';
child.stdout.on('data', (c) => { out += c.toString('utf8'); });
child.stderr.on('data', (c) => { err += c.toString('utf8'); });
const exit = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(test, label, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (test()) return resolve(Date.now() - t0);
      if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${label}\nstdout:\n${JSON.stringify(out)}\nstderr:\n${err}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

/* The line editor may paint attributes around a pasted region; the marker
   name is what must appear, in order, possibly with escapes between words. */
const echoed = () => out.includes(basename(marker));

try {
  const promptMs = await waitFor(() => out.includes(PROMPT), 'the first prompt');
  if (!err.startsWith('ready\n')) throw new Error(`helper did not announce ready first; stderr was ${JSON.stringify(err)}`);

  child.stdin.write(`${PASTE_START}${line}${PASTE_END}`);
  const echoMs = await waitFor(echoed, 'the typed line echoed by the line editor');
  await sleep(NOT_RUN_WAIT_MS);
  if (existsSync(marker)) throw new Error('the typed line RAN without Enter: the marker file exists');
  if (child.exitCode !== null) throw new Error(`the shell ended (code ${child.exitCode}) after the typed text`);
  const promptsBeforeEnter = out.split(PROMPT).length - 1;
  if (promptsBeforeEnter !== 1) throw new Error(`expected exactly one prompt before Enter, saw ${promptsBeforeEnter}`);

  child.stdin.write('\r');
  const ranMs = await waitFor(() => existsSync(marker), 'the same line to run after Enter');
  await waitFor(() => out.split(PROMPT).length - 1 >= 2, 'the second prompt');

  child.stdin.write('exit\r');
  const { code, signal } = await exit;
  if (code !== 0) throw new Error(`exit code ${code} (signal ${signal}), expected 0`);
  console.log(
    `smoke-typed: ${shell} ${shellArgs.join(' ')} on ${python} pty: prompt after ${promptMs} ms, ` +
    `bracketed line echoed after ${echoMs} ms and had NOT run ${NOT_RUN_WAIT_MS} ms later (marker absent, shell alive, one prompt), ` +
    `ran ${ranMs} ms after a single \\r, exit 0, total ${Date.now() - started} ms`,
  );
} catch (e) {
  console.error(`smoke-typed FAILED: ${e.message}`);
  child.kill('SIGKILL');
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
