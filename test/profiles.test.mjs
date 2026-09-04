import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCwd, resolveShell, parseEnvLines, parseArgs, formatArgs, loginShellProfile, findProfile, profileId } from './build/pure.mjs';

const ctx = { vaultPath: '/v', activeFileDir: '/v/notes', home: '/h' };

test('the cwd rule: vault, active file, fixed, home', () => {
  assert.deepEqual(resolveCwd({ cwd: 'vault', fixedCwd: '' }, ctx), { cwd: '/v', fellBack: false });
  assert.deepEqual(resolveCwd({ cwd: 'active-file', fixedCwd: '' }, ctx), { cwd: '/v/notes', fellBack: false });
  assert.deepEqual(resolveCwd({ cwd: 'active-file', fixedCwd: '' }, { ...ctx, activeFileDir: null }), { cwd: '/v', fellBack: true });
  assert.deepEqual(resolveCwd({ cwd: 'fixed', fixedCwd: '/opt/x' }, ctx), { cwd: '/opt/x', fellBack: false });
  assert.deepEqual(resolveCwd({ cwd: 'fixed', fixedCwd: 'sub/dir' }, ctx), { cwd: '/v/sub/dir', fellBack: false });
  assert.deepEqual(resolveCwd({ cwd: 'fixed', fixedCwd: '~/Dev' }, ctx), { cwd: '/h/Dev', fellBack: false });
  assert.deepEqual(resolveCwd({ cwd: 'fixed', fixedCwd: '  ' }, ctx), { cwd: '/v', fellBack: true });
  assert.deepEqual(resolveCwd({ cwd: 'home', fixedCwd: '' }, ctx), { cwd: '/h', fellBack: false });
});

test('the login shell is $SHELL, else the platform default', () => {
  assert.equal(resolveShell({ SHELL: '/bin/zsh' }, 'linux'), '/bin/zsh');
  assert.equal(resolveShell({}, 'darwin'), '/bin/zsh');
  assert.equal(resolveShell({ SHELL: ' ' }, 'linux'), '/bin/bash');
  assert.equal(resolveShell({ ComSpec: 'C:\\cmd.exe' }, 'win32'), 'C:\\cmd.exe');
  assert.deepEqual(loginShellProfile().args, ['-l']);
});

test('env lines and args parse and round-trip', () => {
  assert.deepEqual(parseEnvLines('A=1\n# c\nbad\n=x\nB=x=y\n 1A=no'), { A: '1', B: 'x=y' });
  assert.deepEqual(parseArgs(`-l -c "echo hi there" 'a b' plain`), ['-l', '-c', 'echo hi there', 'a b', 'plain']);
  assert.deepEqual(parseArgs(formatArgs(['-l', 'two words', ''])), ['-l', 'two words', '']);
});

test('profiles are found by id with the first as fallback, and ids are unique', () => {
  const p = [loginShellProfile(), { ...loginShellProfile(), id: 'fish', name: 'Fish' }];
  assert.equal(findProfile(p, 'fish').name, 'Fish');
  assert.equal(findProfile(p, 'nope').id, 'login-shell');
  assert.equal(findProfile([], 'nope').id, 'login-shell');
  assert.equal(profileId('My Shell!', ['my-shell']), 'my-shell-2');
});
