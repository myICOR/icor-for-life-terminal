import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normaliseSettings, settingDefinitions, controlKeys, isCustom, externalLaunch } from './build/pure.mjs';

test('defaults survive normalisation unchanged', () => {
  assert.deepEqual(normaliseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.scrollback, 10000);
});

test('bad data.json values fall back and the login shell profile is always present', () => {
  const s = normaliseSettings({
    fontSize: 'big', scrollback: -1, cursorStyle: 'blob', renderer: 'gpu', openIn: 'left',
    profiles: [{ name: 'Fish', command: '/opt/fish', args: ['-l', 3], env: { OK: '1', 'bad key': 'x' }, cwd: 'moon' }, { id: 'x' }],
    defaultProfile: 'fish',
  });
  assert.equal(s.fontSize, DEFAULT_SETTINGS.fontSize);
  assert.equal(s.scrollback, 100);
  assert.equal(s.cursorStyle, 'block');
  assert.equal(s.renderer, 'auto');
  assert.equal(s.openIn, 'tab');
  assert.equal(s.profiles[0].id, 'login-shell');
  assert.equal(s.profiles.length, 2);
  assert.deepEqual(s.profiles[1], { id: 'fish', name: 'Fish', command: '/opt/fish', args: ['-l'], env: { OK: '1' }, cwd: 'vault', fixedCwd: '' });
  const scrubbed = normaliseSettings({ profiles: [{ name: 'Sneaky', env: { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: 'x', HOME: '/tmp' } }] });
  assert.deepEqual(scrubbed.profiles[1].env, { HOME: '/tmp' }, 'a profile cannot carry a CLAUDE* name');
  assert.equal(s.defaultProfile, 'fish');
  assert.equal(normaliseSettings(null).defaultProfile, 'login-shell');
});

test('every setting key is on the table exactly once, profiles as the one custom row', () => {
  const input = { settings: DEFAULT_SETTINGS, platform: 'darwin' };
  const keys = controlKeys(input);
  const expected = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'profiles');
  assert.deepEqual([...keys].sort(), expected.sort());
  assert.equal(new Set(keys).size, keys.length);
  const customs = settingDefinitions(input).flatMap((g) => g.items).filter(isCustom);
  assert.deepEqual(customs.map((c) => c.custom), ['profiles']);
});

test('the default profile dropdown offers every profile', () => {
  const s = normaliseSettings({ profiles: [{ name: 'Fish', id: 'fish' }] });
  const item = settingDefinitions({ settings: s, platform: 'linux', pythonResolved: '/usr/bin/python3' }).flatMap((g) => g.items).find((i) => !isCustom(i) && i.control.key === 'defaultProfile');
  assert.deepEqual(item.control.options, { 'login-shell': 'Login shell', fish: 'Fish' });
});

test('the Windows launcher template substitutes and splits', () => {
  assert.deepEqual(externalLaunch('wt.exe -d "{cwd}" {command}', 'C:\\My Vault', ['claude', '--resume', 'x']), {
    file: 'wt.exe',
    args: ['-d', 'C:\\My Vault', 'claude', '--resume', 'x'],
  });
  assert.equal(externalLaunch('   ', 'C:\\v', []), null);
});
