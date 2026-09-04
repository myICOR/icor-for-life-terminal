/* H1 from the Vex gate: `python3 -c` puts the working folder first on
   sys.path, so a `termios.py` in the cwd would run as the user before the
   shell exists. The shipped argv carries `-I`; this test plants that file,
   spawns the helper the way the plugin does, and proves the shell starts and
   the planted module never runs. The negative control runs the same probe
   WITHOUT `-I` and requires the marker to appear, so the probe itself is
   known to detect the hole: a gate nobody has watched go red is not a gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { HELPER_ARGV_PREFIX } from './build/pure.mjs';

const python = process.env.ICOR_PYTHON ?? 'python3';

function plant() {
  const cwd = mkdtempSync(join(tmpdir(), 'ict-isolated-'));
  const marker = join(cwd, 'MARKER');
  writeFileSync(
    join(cwd, 'termios.py'),
    `open(${JSON.stringify(marker)}, 'w').write('planted module ran')\nraise SystemExit(99)\n`,
  );
  return { cwd, marker };
}

function runHelper(prefix, cwd) {
  return new Promise((resolve) => {
    const child = spawn(python, [...prefix, '80', '24', '--', '/bin/sh', '-c', 'echo SHELL_UP; exit 0'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString('utf8')));
    child.stderr.on('data', (c) => (err += c.toString('utf8')));
    child.on('close', (code) => resolve({ code, out, err }));
    setTimeout(() => child.kill('SIGKILL'), 15000).unref();
  });
}

test('a termios.py in the working folder never runs: the shell starts, the marker is absent', { skip: process.platform === 'win32' }, async () => {
  const { cwd, marker } = plant();
  try {
    const r = await runHelper(HELPER_ARGV_PREFIX, cwd);
    assert.ok(r.err.startsWith('ready\n'), `helper announced ready; stderr was ${JSON.stringify(r.err)}`);
    assert.match(r.out, /SHELL_UP/, 'the shell ran');
    assert.equal(r.code, 0);
    assert.ok(!existsSync(marker), 'the planted module did not run');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('negative control: without -I the same probe runs the planted module (the probe can see the hole)', { skip: process.platform === 'win32' }, async () => {
  const { cwd, marker } = plant();
  try {
    const withoutIsolation = HELPER_ARGV_PREFIX.filter((a) => a !== '-I');
    const r = await runHelper(withoutIsolation, cwd);
    assert.ok(existsSync(marker), 'the planted termios.py ran in place of the stdlib');
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /SHELL_UP/, 'the shell never started');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
