import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChildEnv, augmentPath, isScrubbed, findOnPath, splitPathLines, TERM_NAME, DEFAULT_LANG } from './build/pure.mjs';

const input = { platform: 'darwin', home: '/Users/t', vaultPath: '/Users/t/vault', version: '0.1.0', extraPath: ['/x/bin'] };

test('CLAUDE* variables never reach the child', () => {
  const env = buildChildEnv(
    { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', HOME: '/Users/t', PATH: '/usr/bin' },
    input,
  );
  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(env.HOME, '/Users/t');
  assert.ok(isScrubbed('CLAUDE_ANYTHING'));
  assert.ok(!isScrubbed('MY_CLAUDE'));
});

test('the terminal declares itself', () => {
  const env = buildChildEnv({ PATH: '/usr/bin' }, input);
  assert.equal(env.TERM, TERM_NAME);
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.TERM_PROGRAM, 'icor-for-life-terminal');
  assert.equal(env.TERM_PROGRAM_VERSION, '0.1.0');
  assert.equal(env.ICOR_VAULT, '/Users/t/vault');
});

test('LANG comes from the host and is defaulted only when absent', () => {
  assert.equal(buildChildEnv({ LANG: 'de_DE.UTF-8' }, input).LANG, 'de_DE.UTF-8');
  assert.equal(buildChildEnv({}, input).LANG, DEFAULT_LANG);
});

test('PATH puts user extras first, then tool folders, then the host, deduplicated', () => {
  const p = augmentPath('/usr/bin:/opt/homebrew/bin:/x/bin', input).split(':');
  assert.equal(p[0], '/x/bin');
  assert.ok(p.indexOf('/Users/t/.local/bin') < p.indexOf('/usr/bin'));
  assert.equal(p.filter((d) => d === '/opt/homebrew/bin').length, 1);
  assert.equal(p.filter((d) => d === '/x/bin').length, 1);
  assert.ok(p.includes('/sbin'));
});

test('non-string values are dropped, and Windows gets Path too', () => {
  const env = buildChildEnv({ A: undefined, B: 'b', Path: 'C:\\W' }, { ...input, platform: 'win32', home: 'C:\\U\\t' });
  assert.equal(env.A, undefined);
  assert.equal(env.B, 'b');
  assert.equal(env.Path, env.PATH);
  assert.ok(env.PATH.includes('C:\\W'));
});

test('findOnPath probes each folder in order', () => {
  const seen = [];
  const hit = findOnPath('claude', '/a:/b:/c', 'darwin', (p) => { seen.push(p); return p === '/b/claude'; });
  assert.equal(hit, '/b/claude');
  assert.deepEqual(seen, ['/a/claude', '/b/claude']);
  assert.equal(findOnPath('claude', '/a', 'darwin', () => false), null);
  assert.equal(findOnPath('claude', 'C:\\x', 'win32', (p) => p.endsWith('.cmd')), 'C:\\x\\claude.cmd');
});

test('path lines split on newlines and trim', () => {
  assert.deepEqual(splitPathLines(' /a \n\n/b\r\n'), ['/a', '/b']);
});
