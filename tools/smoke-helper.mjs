/* The pty helper, end to end, outside Obsidian: spawn it the way the plugin
 * does, run the login shell, assert READY arrives, resize on fd 3 and read
 * the new size back from the tty, then see the exit code come through.
 *
 * Every number printed below was measured in this run. There is no silent
 * pass: a timeout or a wrong size fails the process. Windows has no helper,
 * so there it says so and exits 0, which is the one platform statement. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

if (process.platform === 'win32') {
  console.log('smoke: not applicable on win32, the pty helper does not run there');
  process.exit(0);
}

const helper = readFileSync(new URL('../src/pty/helper.py', import.meta.url), 'utf8');
const python = process.env.ICOR_PYTHON ?? 'python3';
const shell = process.env.SHELL || '/bin/sh';
const EXIT_CODE = 7;
const script = `echo READY; read line; stty size; exit ${EXIT_CODE}`;
const started = Date.now();

const child = spawn(python, ['-I', '-c', helper, '100', '30', '--', shell, '-lc', script], {
  stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  env: { ...process.env, TERM: 'xterm-256color' },
});

let out = '';
let err = '';
child.stdout.on('data', (c) => { out += c.toString('utf8'); });
child.stderr.on('data', (c) => { err += c.toString('utf8'); });

const exit = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));

function waitFor(pattern, label, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (pattern.test(out)) return resolve(Date.now() - t0);
      if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${label}\nstdout:\n${out}\nstderr:\n${err}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

try {
  const readyMs = await waitFor(/READY/, 'READY');
  if (!err.startsWith('ready\n')) throw new Error(`helper did not announce ready on stderr first; stderr was: ${JSON.stringify(err)}`);
  child.stdio[3].write('resize 120 40\n');
  await new Promise((r) => setTimeout(r, 150));
  child.stdin.write('\n');
  const sizeMs = await waitFor(/40 120/, 'stty size 40 120');
  const { code, signal } = await exit;
  if (code !== EXIT_CODE) throw new Error(`exit code ${code} (signal ${signal}), expected ${EXIT_CODE}`);
  console.log(`smoke: ${shell} on ${python} pty: READY after ${readyMs} ms, resize 100x30 -> 120x40 confirmed by stty after ${sizeMs} ms, exit ${code} observed, total ${Date.now() - started} ms`);
} catch (e) {
  console.error(`smoke FAILED: ${e.message}`);
  child.kill('SIGKILL');
  process.exit(1);
}
